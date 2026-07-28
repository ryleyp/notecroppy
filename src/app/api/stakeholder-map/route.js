import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { dateSortValue } from "@/lib/synthesisPolicy";
import {
  factsToMarkdown,
  mergeFacts,
  sourceSummariesFromFacts,
} from "@/lib/contactMapping";
import {
  DEFAULT_MODEL,
  budgetChars as modelBudgetChars,
  contextLimit as contextTokens,
  maxOutputTokens,
} from "@/lib/models";

function budgetChars(model) {
  return modelBudgetChars(model, 10_000);
}

function sourceTag(note) {
  return note.source && note.source !== "obsidian" ? ` [${note.sourceLabel || note.source}]` : "";
}

function noteDateKey(note) {
  return dateSortValue(note.date);
}

function fitNotes(notes, model, extraPromptChars = 0) {
  const perNoteCap = contextTokens(model) >= 1_000_000 ? 300_000 : 80_000;
  const maxChars = Math.max(0, budgetChars(model) - extraPromptChars);
  const capped = notes.map((n) => ({
    ...n,
    content: n.content.length > perNoteCap
      ? `${n.content.slice(0, perNoteCap)}\n\n[truncated - source exceeds per-source limit]`
      : n.content,
  }));

  let total = 0;
  const kept = [];
  for (const n of capped) {
    const size = (n.title?.length || 0) + n.content.length + 200;
    if (total + size > maxChars && kept.length > 0) break;
    kept.push(n);
    total += size;
  }

  return { kept, dropped: notes.length - kept.length };
}

function fitFacts(facts, model, extraPromptChars = 0) {
  const maxChars = Math.max(0, budgetChars(model) - extraPromptChars);
  const merged = mergeFacts(facts);
  let total = 0;
  const kept = [];

  for (const fact of merged) {
    const size = Object.values(fact).flat().join(" ").length + 120;
    if (total + size > maxChars && kept.length > 0) break;
    kept.push(fact);
    total += size;
  }

  return { kept, dropped: merged.length - kept.length };
}

function tagSameDayNotes(notes) {
  const dateCounts = {};
  for (const n of notes) dateCounts[n.date] = (dateCounts[n.date] || 0) + 1;
  const dateIndex = {};
  return notes.map((n) => {
    if (dateCounts[n.date] > 1) {
      dateIndex[n.date] = (dateIndex[n.date] || 0) + 1;
      const pos = dateIndex[n.date];
      const total = dateCounts[n.date];
      const label = pos === 1 ? " *(earliest same-day source)*" : pos === total ? " *(latest same-day source)*" : ` *(same-day source ${pos} of ${total})*`;
      return { ...n, _dayLabel: label };
    }
    return { ...n, _dayLabel: "" };
  });
}

function buildExclusionList(accountName, allAccounts) {
  if (!allAccounts?.length) return "";
  const others = allAccounts.filter((a) => a.name !== accountName && a.name !== "Internal");
  if (!others.length) return "";

  const accountLines = others.map((a) => {
    const aliases = (a.aliases || []).join(", ");
    return aliases ? `  - ${a.name} (also referred to as: ${aliases})` : `  - ${a.name}`;
  });

  const keywordLines = others
    .filter((a) => a.keywords?.length)
    .map((a) => `  - ${a.keywords.join(", ")} -> belong to ${a.name}, do not include in this map`);

  let out = `\nOther customer accounts - do not include them in this map:\n${accountLines.join("\n")}\n`;
  if (keywordLines.length) {
    out += `\nForbidden keywords tied to other accounts:\n${keywordLines.join("\n")}\n`;
  }
  return out;
}

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function lineContainsKeyword(line, keywords) {
  return keywords.some((kw) => {
    const esc = escapeRegex(kw.trim());
    const left = /^\w/.test(kw) ? "\\b" : "";
    const right = /\w$/.test(kw) ? "\\b" : "";
    return new RegExp(`${left}${esc}${right}`, "i").test(line);
  });
}

function scrubForbiddenKeywords(notes, accountName, allAccounts) {
  const forbidden = (allAccounts || [])
    .filter((a) => a.name !== accountName && a.name !== "Internal")
    .flatMap((a) => a.keywords || [])
    .filter(Boolean);
  if (!forbidden.length) return notes;
  return notes.map((n) => ({
    ...n,
    content: n.content
      .split("\n")
      .filter((line) => !lineContainsKeyword(line, forbidden))
      .join("\n"),
  }));
}

function rangeDescriptor(today, sourceRange) {
  const threeMonthsAgo = new Date(today);
  threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
  const rangeLabel = `${threeMonthsAgo.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })} - ${new Date(today).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" })}`;
  if (sourceRange === "all") {
    return {
      label: "All Available History",
      sentence: "all available history",
      empty: "in the provided source set",
    };
  }
  return {
    label: rangeLabel,
    sentence: rangeLabel,
    empty: "this quarter",
  };
}

function mappingContextBlock(mappingContext) {
  const items = (mappingContext || [])
    .map((item) => ({
      label: String(item?.label || "").trim(),
      context: String(item?.context || "").trim(),
    }))
    .filter((item) => item.label && item.context);

  if (!items.length) return "";

  return `\nUser-provided context for mapped names and organizations. Use this as guidance, but do not invent facts beyond the sources:\n${items
    .map((item) => `- **${item.label}:** ${item.context}`)
    .join("\n")}\n`;
}

function previousOutputBlock(previousOutput, continuationSection = "") {
  const text = String(previousOutput || "").trim();
  if (!text) return "";
  const target = continuationSection
    ? ` Focus on finishing or continuing the "${continuationSection}" section first.`
    : "";

  return `\nContinuation mode: a previous attempt stopped before the document was complete. Continue the same Markdown document from exactly where the previous output ended.${target} Do not repeat completed sections unless needed to finish a cut-off bullet or sentence.\n\nPrevious partial output:\n${text}\n`;
}

function mapSkeleton(acct, range, reviewedCount, sourceTypeLine) {
  return `# ${acct} Customer & Site Mapping - ${range.label}

*Mapped from ${reviewedCount} source${reviewedCount !== 1 ? "s" : ""}*

---

## Source Coverage

- **Sources reviewed:** ${reviewedCount}
- **Date range:** ${range.label}
- **Source types:** ${sourceTypeLine}

---

## Customer Stakeholders

- **[Name]** - [role, title, team, or "not stated"]
  - **Aliases / spelling variants:** [aliases or "none noted"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief account-relevant context from that source]
    - [repeat for every source mentioning this person]
  - **Relationship / influence:** [sponsor, champion, end user, admin, evaluator, blocker, unknown, etc.]
  - **Associated sites / teams:** [sites, labs, teams, or "not stated"]
  - **Planning implication:** [next engagement, follow-up, enablement need, risk, or "No planning action noted."]

---

## NI / Internal Contacts Mentioned

- **[Name]** - [role or "not stated"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief context]
  - **Account planning role:** [what they own or influence, or "not stated"]

---

## Site / Lab / Location Map

- **[Site, lab, city, campus, or location name]** - [site context or "not stated"]
  - **Mentioned in:**
    - [YYYY-MM-DD - source title (source label)] - [brief site-relevant context from that source]
    - [repeat for every source mentioning this site/location]
  - **Stakeholders / teams tied to site:** [names or teams, or "not stated"]
  - **NI software footprint / adoption context:** [products, versions, deployment, training, support, or "not stated"]
  - **Risks / blockers:** [site-specific risks or "none noted"]
  - **Site-level planning implication:** [site visit, enablement, deployment, support, renewal, expansion, or "No planning action noted."]

---

## Stakeholder-Site Cross References

- **[Stakeholder] <-> [Site/Lab]** - [relationship and source date/title]

---

## Planning Gaps

- [missing title/contact/site owner/location detail, ambiguity, or source gap that should be clarified]`;
}

export function buildStakeholderMapPrompt(notes, today, accountName, allAccounts, sourceRange = "recent", mappingContext = [], previousOutput = "", continuationSection = "") {
  const range = rangeDescriptor(today, sourceRange);
  const acct = accountName && accountName !== "Internal" ? accountName : "Selected Account";
  const noteBlocks = notes
    .map((n) => `### ${n.date || "undated"} - ${n.title}${sourceTag(n)}${n._dayLabel || ""}\n\n${n.content}`)
    .join("\n\n---\n\n");

  return `You are a NI Software Customer Success Manager creating a standalone customer stakeholder and site-level planning map for ${acct}.

Analyze the provided Obsidian meeting notes from ${range.sentence}. Extract account-relevant people, customer teams, NI/internal contacts, sites, labs, campuses, cities, buildings, and named locations.

Scope rules:
- Map ${acct} only. If a source contains another customer account, ignore that other account completely.
- Customer stakeholders are highest priority. Include NI/internal contacts only when they own, influence, or are repeatedly tied to this account's engagement.
- Include sites/labs/locations even when no individual stakeholder is tied to them yet.
- Do not invent names, titles, sites, labs, influence levels, relationships, or next steps.
- If duplicate spellings, aliases, or abbreviations clearly refer to the same person/site, merge them under the clearest name and list the aliases.
${buildExclusionList(accountName, allAccounts)}

Sources are in chronological order, oldest first. Within a single day, same-day labels indicate order.

Citation rule: Every mapped person and every mapped site must list every provided source that mentions them. Use source date, title, and source label when present. Do not write "multiple meetings" without enumerating those meetings.
${mappingContextBlock(mappingContext)}
${previousOutputBlock(previousOutput, continuationSection)}

---
SOURCES:

${noteBlocks}

---

Generate the Customer & Site Mapping document using EXACTLY this structure:

${mapSkeleton(acct, range, notes.length, "[summarize account-folder Obsidian meeting notes and cross-folder Obsidian meeting notes represented in the sources]")}

If no account-relevant stakeholders or sites are found, write exactly: "No stakeholder or site details noted ${range.empty}."`;
}

export function buildStakeholderMapFactPrompt(facts, today, accountName, allAccounts, sourceRange = "recent", mappingContext = [], previousOutput = "", continuationSection = "", incremental = false) {
  const range = rangeDescriptor(today, sourceRange);
  const acct = accountName && accountName !== "Internal" ? accountName : "Selected Account";
  const sources = sourceSummariesFromFacts(facts);
  const factBlocks = factsToMarkdown(facts);
  const mode = incremental
    ? "Create an incremental customer and site mapping update from the new or changed facts. Call out what changed and where the standing map may need edits."
    : "Create a complete customer stakeholder and site-level planning map from the extracted facts.";

  return `You are a NI Software Customer Success Manager creating a standalone customer stakeholder and site-level planning map for ${acct}.

${mode}

The facts below were extracted from Obsidian meeting notes before this final synthesis step. Use the extracted facts as the evidence source instead of raw note text.

Scope rules:
- Map ${acct} only. If a fact belongs to another customer account, ignore it.
- Customer stakeholders are highest priority. Include NI/internal contacts only when they own, influence, or are repeatedly tied to this account's engagement.
- Include sites/labs/locations even when no individual stakeholder is tied to them yet.
- Do not invent names, titles, sites, labs, influence levels, relationships, or next steps.
- Merge duplicate spellings, aliases, or abbreviations under the clearest name and list aliases.
${buildExclusionList(accountName, allAccounts)}

Citation rule: Every mapped person and every mapped site must cite every extracted fact/source that mentions them. Use source date, title, and source label when present.
${mappingContextBlock(mappingContext)}
${previousOutputBlock(previousOutput, continuationSection)}

---
EXTRACTED FACTS:

${factBlocks || "No extracted facts."}

---
SOURCE INDEX:

${sources.map((source) => `- ${source.date || "undated"} - ${source.title || source.id || "Untitled"}${source.sourceLabel ? ` (${source.sourceLabel})` : ""}`).join("\n") || "- No sources"}

---

Generate the Customer & Site Mapping document using EXACTLY this structure:

${mapSkeleton(acct, range, sources.length || facts.length, "[summarize the Obsidian source mix represented by the extracted facts]")}

If no account-relevant stakeholders or sites are found, write exactly: "No stakeholder or site details noted ${range.empty}."`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes = [], facts = [], apiKey, model, today, replacements = [], corrections = [], accountName, allAccounts = [], sourceRange = "recent", mappingContext = [], previousOutput = "", continuationSection = "", incremental = false } = body;

    if ((!notes || notes.length === 0) && (!facts || facts.length === 0)) {
      return new Response(JSON.stringify({ error: "No notes or facts provided" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const sanitizedNotes = (notes || []).map((n) => ({
      ...n,
      title: applyReplacements(applyCorrections(n.title || "", corrections), replacements),
      content: applyReplacements(applyCorrections(n.content, corrections), replacements),
    }));
    const sanitizedMappingContext = (mappingContext || [])
      .map((item) => ({
        label: applyReplacements(applyCorrections(item?.label || "", corrections), replacements),
        context: applyReplacements(applyCorrections(item?.context || "", corrections), replacements),
      }))
      .filter((item) => item.label.trim() && item.context.trim());
    const sanitizedPreviousOutput = applyReplacements(applyCorrections(previousOutput || "", corrections), replacements);

    const selectedModel = model || DEFAULT_MODEL;
    const extraPromptChars = sanitizedPreviousOutput.length + sanitizedMappingContext.reduce((sum, item) => sum + item.label.length + item.context.length + 20, 0);
    const sanitizedFacts = mergeFacts((facts || []).map((fact) => ({
      ...fact,
      name: applyReplacements(applyCorrections(fact?.name || "", corrections), replacements),
      aliases: (Array.isArray(fact?.aliases) ? fact.aliases : []).map((alias) => applyReplacements(applyCorrections(alias, corrections), replacements)),
      role: applyReplacements(applyCorrections(fact?.role || "", corrections), replacements),
      organization: applyReplacements(applyCorrections(fact?.organization || "", corrections), replacements),
      site: applyReplacements(applyCorrections(fact?.site || "", corrections), replacements),
      relationship: applyReplacements(applyCorrections(fact?.relationship || "", corrections), replacements),
      evidence: applyReplacements(applyCorrections(fact?.evidence || "", corrections), replacements),
      sourceTitle: applyReplacements(applyCorrections(fact?.sourceTitle || "", corrections), replacements),
      sourceLabel: applyReplacements(applyCorrections(fact?.sourceLabel || "", corrections), replacements),
    })));

    let prompt;
    let dropped = 0;
    let reviewedCount = 0;
    if (sanitizedFacts.length) {
      const fitted = fitFacts(sanitizedFacts, selectedModel, extraPromptChars);
      dropped = fitted.dropped;
      reviewedCount = sourceSummariesFromFacts(fitted.kept).length || fitted.kept.length;
      prompt = buildStakeholderMapFactPrompt(fitted.kept, today || new Date().toISOString().split("T")[0], accountName, allAccounts, sourceRange, sanitizedMappingContext, sanitizedPreviousOutput, continuationSection, incremental);
    } else {
      const scrubbedNotes = scrubForbiddenKeywords(sanitizedNotes, accountName, allAccounts);
      const newestFirst = [...scrubbedNotes].sort((a, b) => noteDateKey(b).localeCompare(noteDateKey(a)));
      const { kept, dropped: droppedNotes } = fitNotes(newestFirst, selectedModel, extraPromptChars);
      dropped = droppedNotes;
      const chronological = [...kept].reverse();
      const taggedNotes = tagSameDayNotes(chronological);
      reviewedCount = kept.length;
      prompt = buildStakeholderMapPrompt(taggedNotes, today || new Date().toISOString().split("T")[0], accountName, allAccounts, sourceRange, sanitizedMappingContext, sanitizedPreviousOutput, continuationSection);
    }

    const client = new Anthropic({ apiKey: key });
    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          const messageStream = client.messages.stream({
            model: selectedModel,
            max_tokens: maxOutputTokens(selectedModel),
            system: "You produce precise customer stakeholder maps and site-level planning indexes from dated account notes. Preserve source attribution. Respond with only the Markdown document - no preamble.",
            messages: [{
              role: "user",
              content: prompt,
            }],
          });

          for await (const event of messageStream) {
            if (event.type === "content_block_delta" && event.delta?.type === "text_delta") {
              send({ type: "delta", text: event.delta.text });
            }
          }

          const final = await messageStream.finalMessage();
          send({
            type: "done",
            noteCount: reviewedCount,
            droppedCount: dropped,
            factCount: sanitizedFacts.length,
            usage: final.usage,
            model: selectedModel,
            stopReason: final.stop_reason,
            truncated: final.stop_reason === "max_tokens",
          });
        } catch (error) {
          send({ type: "error", message: error?.message || "Mapping failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Mapping failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
