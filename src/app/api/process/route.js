import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { looksSpeakerLabeled } from "@/lib/speakers";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { DEFAULT_MODEL, maxOutputTokens } from "@/lib/models";
import { buildSourceBundle, formatSourceBundleForPrompt } from "@/lib/sourceBundle";

const SYSTEM_PROMPT = `You are an expert meeting notes specialist working for a Customer Success Manager (CSM) at NI (National Instruments). The person who recorded this meeting is that CSM — their job is driving adoption, expansion, and renewal of NI products at large customer accounts.

Domain context — interpret the transcript through this lens:
- NI Software: LabVIEW, TestStand, SystemLink (Server/Enterprise/SLE/SLS), FlexLogger, VeriStand, DIAdem, InstrumentStudio, DAQmx, driver stacks, Enterprise Agreements (EA), training credits, license/entitlement management.
- NI Hardware: PXI, CompactDAQ/cDAQ, CompactRIO/cRIO, VST, SMU, oscilloscopes, RF instrumentation, and how hardware attach relates to software adoption.
- Test & measurement engineering: automated test systems, HIL, validation/production test, instrument control, measurement data management. Terms like "DAQ", "rigs", "test stands", "sequences", and "drivers" mean their T&M sense, not general IT.
- Ambiguous transcription of product names should resolve to the closest NI product (e.g. "test stand" in a software context is likely TestStand).

Your notes must be extremely thorough — do not omit any important information, decisions, or discussions from the transcript. Frame relevance from the CSM's perspective: customer adoption signals, license/EA questions, support issues, expansion or renewal implications, and commitments the CSM made. Honor section-specific word limits even when the rest of the note should stay detailed.

Do NOT include personal updates, personal check-ins, or personal anecdotes (e.g. weekend plans, health updates, family news, personal status). Focus only on business-relevant content.

Always respond with ONLY the Markdown content, no preamble or explanation.`;

// Account names are customer data, so they are injected from the caller's
// configured account list rather than hardcoded into the prompt. Each
// account's keywords double as its division/business-unit tags.
function buildAccountTagLines(accounts = []) {
  const named = accounts.filter((a) => a?.name && a.name !== "Internal");
  if (!named.length) {
    return "- Accounts / customers: any company or customer name that is clearly a customer or account being discussed\n";
  }

  const aliasList = named
    .flatMap((a) => [a.name, ...(a.aliases || [])])
    .filter(Boolean)
    .map((t) => t.toLowerCase());

  let out = `- Accounts / customers: ${[...new Set(aliasList)].join(", ")} — and any other company or customer name that is clearly a customer or account being discussed\n`;

  for (const a of named) {
    const divisions = (a.keywords || []).filter(Boolean);
    if (divisions.length) {
      out += `- ${a.name} divisions or business units (only if explicitly called out): ${divisions.join(", ")}\n`;
    }
  }
  return out;
}

function buildTagCategories(accounts) {
  const accountLines = buildAccountTagLines(accounts);
  return `
Extract tags ONLY if explicitly mentioned in the transcript. Use lowercase, no spaces (use hyphens for multi-word).

Categories to check:
- Cities: austin, dallas, houston, denver, seattle, chicago, boston, san-francisco, new-york, nashville, atlanta, phoenix, minneapolis, raleigh, detroit, los-angeles, portland, columbus, indianapolis, etc.
- US States: texas, colorado, washington, california, illinois, massachusetts, ohio, georgia, michigan, tennessee, north-carolina, florida, arizona, minnesota, oregon, etc.
- NI Software: systemlink, labview, teststand, diadem, flexlogger, veristand, ni-daqmx, labwindows-cvi, measurement-studio, ni-visa, opentestbed, etc.
- Software / Dev languages & tools: python, c, c-plus-plus, matlab, java, javascript, typescript, dotnet, rust, sql, r, julia, simulink, etc.
- Other tools or platforms mentioned prominently (e.g. github, azure, aws, jira, confluence, salesforce)
${accountLines}- CS program terms: proficiencyplan, flexcredits, snowsupport, enterpriseagreement — tag if these programs or concepts are explicitly discussed
- Training: tag as proficiencyplans if training, onboarding, skill-building, or learning resources for NI tools are discussed

Only include a tag if that city/state/technology is actually discussed — not just briefly mentioned in passing.`;
}

const SFDC_ACTIVITY_RULES = `
Rules for the SFDC Activity Entry section:

APPROVED TYPE AND SUBTYPE OPTIONS (Subtype must come from the chosen Type's list)
- Training or Support Webinar: Other
- Internal Alignment and Collaboration: Account Planning, Account Team Kickoff, Product Feedback
- Onboarding & Kick-off: EA Admin Onboarding, EA End-User Kick-off, Other
- Strategic Relationship Management: EA Admin Sync, Escalation / Risk Management, QBR / EBR, Product Roadmap Review, SystemLink Enterprise Governance, Other
- User Groups: Demo Day, User Group, Other
- Value Realization and Success Stories: Case Study, Customer Testimonial, Outcome Review, SystemLink ROI Review, Other
- Other

CLASSIFICATION RULES
- Identify the primary purpose of the meeting before choosing a type.
- Use the most specific valid type and subtype the transcript (or the CSM's context/notes) supports.
- Subtype must come from the chosen type's list; if none fit, use "Other" within that type.
- Top-level "Other" type always outputs "Subtype: Other".
- A product-led session (NI presenting/demoing) is a demo, not a User Group. "User Group" means customer-led.
- Prefer "Account Planning" or "Other" for internal-only work, with an outcome-focused description.
- Tie-breakers when two types fit: (1) match the primary purpose, not a topic that just came up; (2) if the meeting spans onboarding and training, classify by account stage — new/ramping accounts default to Onboarding & Kick-off; (3) if risk or escalation is the reason for the meeting, Escalation / Risk Management wins over a routine sync; (4) if still tied, pick the type reflecting the strategic outcome.

SUMMARY/NOTES RULES
- Exactly three labeled lines, in this order: Summary, Outcomes, Next steps. No other headings or sections inside this block.
- HARD LIMIT: the entire Summary/Notes block — Summary + Outcomes + Next steps combined, including the labels — must be at most 120 words and 800 characters or fewer. This is a Salesforce field limit, not a target. Draft, count the words, then trim until it is 120 or fewer: cut the weakest detail, not the outcomes or next steps. Never exceed it.
- This block is pasted into a plain-text SFDC Comment field, so keep each section as a labeled run of plain sentences ("Summary: ...", "Outcomes: ...", "Next steps: ...") — no bullets, no bold, no sub-lists inside it.
- Past tense, no first person ("I"/"we").
- Persona: write like a CSM in their late twenties/around 27, a couple years into the role, with an engineering degree — reads like notes typed up right after the call, not an AI-cleaned recap. Plain, conversational-professional language, not heavy business jargon (avoid "synergy," "leverage," "circle back," "bandwidth," "actionable," "value-add," etc.). Grounded and direct, no stiff transitions or corporate filler.
- Lead with outcome and business value, not meeting logistics.
- Outcomes: if the transcript has no clear outcome, write "Outcomes: None stated" — never invent one.
- Next steps: only the CSM's own owned actions (skip customer/other-team to-dos unless they gate a CSM action), top 1-3, phrased as concrete actions. If none, write "Next steps: None".
- Do not invent attendees, regions, outcomes, or next steps that aren't supported by the transcript or the CSM's own context/notes.
- Exclude raw internal complaints/blame, speculative pricing or forecast figures, and anything the account team wouldn't want visible in CRM.`;

export function buildPrompt(
  transcript,
  meetingTitle,
  suggestedAgreements = [],
  meetingContext = "",
  { sourceBundle, accounts = [] } = {}
) {
  const title = meetingTitle || "Meeting Notes";
  const sources = sourceBundle || buildSourceBundle({ transcript, rawNotes: meetingContext });
  const sourceBlock = formatSourceBundleForPrompt(sources) || `[T1] Transcript\n${transcript}`;

  // Extra background and/or the CSM's own handwritten notes, typed in by the
  // CSM alongside the transcript. Treated as a trusted second source.
  const contextBlock = meetingContext.trim()
    ? `
CONTEXT & NOTES FROM THE CSM (trusted supplemental source — the CSM wrote this themselves):
${meetingContext.trim()}

Use this to interpret the transcript (attendees, roles, account background, meeting purpose) AND as source material in its own right: observations, decisions, or action items that appear only in the CSM's notes belong in the meeting notes and SFDC entry just like transcript content. If the CSM's notes and the transcript conflict, prefer the transcript for what was literally said, but keep the CSM's framing of why it matters. Do not quote the CSM's notes as if someone said them aloud in the meeting.

CONFLICT FLAGGING: If the CSM's notes DIRECTLY conflict with the transcript on a fact — a different number, date, owner, decision, product, or outcome — you MUST surface it. Insert a section titled "## ⚠️ Conflicts With Your Notes" immediately after the Executive Summary (this is an allowed addition to the required structure below). List each conflict as its own bullet: "Your notes say [X], but the transcript says [Y]" — quote or closely paraphrase both sides so the CSM can resolve it. In the body of the notes, use the transcript's version. Do NOT silently pick one side, and do NOT include this section at all when there are no direct conflicts. Differences in emphasis or detail level are not conflicts — only contradictions are.
`
    : "";

  // EA/EP numbers matched to this meeting by keyword (matching done client-side
  // against the raw transcript). Listed in the SFDC entry so they can be copied
  // into Salesforce; Claude only echoes them, it does not invent numbers.
  const agreementBlock = suggestedAgreements.length
    ? `\nEA/EP NUMBERS ON FILE FOR THIS ACCOUNT (matched to this meeting by keyword): ${suggestedAgreements.map((g) => `${g.type} ${g.number}`).join(", ")}. In the SFDC Activity Entry, output an "**EA/EP Number(s):**" line listing the one(s) relevant to what this meeting was actually about, copied verbatim. If more than one clearly applies, list all. Do not invent or alter numbers, and do not list a number if nothing in the meeting relates to it.`
    : `\nNo EA/EP numbers are on file for this account. In the SFDC Activity Entry, output "**EA/EP Number(s):** None on file".`;

  const speakerGuidance = looksSpeakerLabeled(transcript)
    ? `
This transcript has been segmented by speaker — each turn is preceded by a label like **Name:** or **Speaker 1:**. Use these labels to attribute statements, decisions, questions, and commitments to the correct person throughout your notes (e.g. "David raised concerns about..." or "Speaker 2 confirmed..."). Do not blend or merge different speakers' statements together. When listing action item owners, use the specific speaker who committed to the item rather than a generic "team," unless it is genuinely a group commitment. The labels are a best-effort inference from conversational patterns, not verified — if a label is a generic "Speaker N" (no real name was available), it's fine to refer to that person by that label in your notes.
`
    : "";

  return `Please analyze this meeting transcript and create detailed meeting notes.

Meeting Title: ${title}
${speakerGuidance}${contextBlock}
---
SOURCE BLOCKS:
${sourceBlock}
---

${buildTagCategories(accounts)}

SOURCE CITATION RULES
- Use only the source block IDs above as citations.
- Add citations to every factual bullet or factual paragraph outside the SFDC Activity Entry, using markers like [T1] or [N1].
- Put citations at the end of the sentence or bullet they support.
- Use [N#] for claims that come from the CSM's raw notes/context and [T#] for transcript claims.
- If a point is synthesized from multiple sources, cite each relevant source, e.g. [T2] [N1].
- Do not put citation markers inside the SFDC Activity Entry because it is copied into Salesforce.

Generate the meeting notes with EXACTLY this structure. Do NOT include a YAML frontmatter block.

Length: Meeting Notes is the section of record and has no length limit — make it as long as the
material genuinely warrants. The only capped section in this note is the SFDC Activity Entry, whose
limit is a Salesforce field constraint and still applies exactly as specified above.

# ${title}

<tag line: list extracted tags inline as #tag1 #tag2 #tag3>

---

## Executive Summary

Write 3-5 sentences capturing the overall purpose, key outcomes, and most important decisions from this meeting. This is a scannable overview, so keep it tight even though the notes below are exhaustive.

---

## Meeting Notes

Provide exhaustive bulleted notes covering everything of substance in the sources. This is the section of record: someone who missed the meeting should be able to read it instead of the transcript and miss nothing that matters.

- Cover every topic discussed, in the order it came up. Use sub-bullets to keep related detail together under its topic.
- Capture the specifics that get lost in summaries: names, numbers, dates, versions, product names, license and entitlement details, system and environment details, error messages, quantities, and timelines.
- Record decisions with the reasoning behind them, not just the outcome, and note who made or drove each one.
- Record open questions, disagreements, unresolved threads, and anything explicitly deferred — mark them as unresolved rather than implying closure.
- Preserve the substance of notable exchanges: what was asked, what the answer was, and any concern, objection, hesitation, or enthusiasm expressed.
- Where a speaker is identifiable, attribute the point to them.

Skip only true noise: filler, verbatim repetition, small talk, and personal updates or check-ins. When in doubt about whether a detail belongs, include it — length is not a concern in this section. Do not compress detail out to save space, and do not editorialize or invent anything absent from the sources.

---

## Things NI SW Customer Success Should Take Note Of

Flag the most important items for NI Software's Customer Success team. Include: adoption signals, product usage concerns, customer frustrations or praise, risks to renewal or expansion, opportunities for CS to engage, and any commitments made to the customer. Be concise — one clear bullet per point, no filler.

---

## Sentiment & Vibe

Read between the lines and capture the human dynamics of the meeting — the things a CSM should remember about relationships, not just facts. Cover whichever of these the transcript actually supports (skip the rest):
- **Overall tone** — one line: how did the meeting feel? (collaborative, tense, rushed, energized, going through the motions...)
- **People** — who was enthusiastic, skeptical, frustrated, disengaged, or under pressure, and about what. Note shifts mid-meeting ("warmed up once X came up").
- **Product relationships** — attitudes toward specific NI (or competitor) products: genuine enthusiasm vs. polite interest, fatigue, distrust, or growing reliance.
- **Team & org dynamics** — tension or deference between attendees, who defers to whom, internal champions or blockers, signs of organizational pressure (budget, deadlines, reorgs) leaking into the conversation.
- **Callouts** — anything worth remembering before the next interaction: a sore subject to avoid, a win to reference, a person who needs extra attention, an unspoken concern that never got voiced directly.

Ground every observation in something actually said or evident in the transcript — cite the moment briefly ("pushed back twice on the migration timeline"). Do not psychoanalyze or invent feelings that aren't supported. If the transcript genuinely gives no sentiment signal, write "No notable sentiment signals in this transcript."

---

## User-Level Callouts

Call out specific customer users, stakeholders, sponsors, admins, evaluators, champions, blockers, or NI/internal contacts who matter to account planning. Include only people actually mentioned in the transcript. For each person, capture role/team if stated, relationship or influence if stated, account-relevant context, and any follow-up implication. If no specific people are mentioned, write "Nothing noted."

- **[Name]** — [role/team or "not stated"]: [account-relevant context and planning implication]

---

## Site-Level Callouts

Call out specific customer sites, labs, campuses, buildings, cities, or named locations mentioned in the transcript. Include only locations actually mentioned. For each site/location, capture associated people or teams if stated, NI software/product context if stated, risks/blockers, and any site-level planning implication. If no specific sites or locations are mentioned, write "Nothing noted."

- **[Site / lab / location]** — [site context, associated stakeholders/teams, software context, and planning implication]

---

## Action Items

List all action items as Markdown task checkboxes. For each item include who owns it and a due date if mentioned. Format:
- [ ] [Action item description] — **Owner:** [Name or Team] | **Due:** [Date or "TBD"]

---

## Next Steps

List the agreed-upon next steps, upcoming milestones, follow-up meetings, or planned deliverables in priority order.

---

## SFDC Activity Entry

A Salesforce-ready activity entry for this meeting, following the rules below. Output EXACTLY this shape and nothing else in this section — no extra headings, bullets, or commentary.

The instruction to write exhaustively applies to Meeting Notes and NOT to this section. This section is pasted into a Salesforce field: the Summary/Notes block (Summary + Outcomes + Next steps, including the labels) must be 120 words or fewer and 800 characters or fewer. Write the block, count the words, and trim until it fits before you output it. Detail that does not fit belongs in Meeting Notes above, not here.

**Type:** <one approved type>
**Subtype:** <matching subtype from that type's list>
**EA/EP Number(s):** <relevant number(s) from the list below, or "None on file">

**Summary/Notes:**
Summary: <what was covered and what happened>
Outcomes: <explicit outcomes, or "None stated">
Next steps: <the CSM's own 1-3 owned actions, or "None">
${SFDC_ACTIVITY_RULES}
${agreementBlock}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      transcript,
      meetingTitle,
      apiKey,
      model,
      suggestedAgreements = [],
      meetingContext = "",
      sourceBundle,
      accounts = [],
    } = body;

    if (!transcript || transcript.trim().length === 0) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Anthropic API key is required. Add it in Settings or set ANTHROPIC_API_KEY in .env.local" },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey: key });

    const stream = client.messages.stream({
      model: model || DEFAULT_MODEL,
      max_tokens: maxOutputTokens(model || DEFAULT_MODEL),
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildPrompt(transcript, meetingTitle, suggestedAgreements, meetingContext, {
          accounts,
          sourceBundle,
        }),
      }],
    });

    const encoder = new TextEncoder();
    const readable = new ReadableStream({
      async start(controller) {
        const send = (obj) => controller.enqueue(encoder.encode(`data: ${JSON.stringify(obj)}\n\n`));
        try {
          for await (const chunk of stream) {
            if (chunk.type === "content_block_delta" && chunk.delta.type === "text_delta") {
              send({ type: "delta", text: chunk.delta.text });
            }
          }
          const finalMsg = await stream.finalMessage();
          send({ type: "done", usage: finalMsg.usage, model: model || DEFAULT_MODEL });
        } catch (err) {
          send({ type: "error", message: err?.message || "Processing failed" });
        } finally {
          controller.close();
        }
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      },
    });
  } catch (error) {
    console.error("Error processing transcript:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to process transcript" },
      { status: error?.status || 500 }
    );
  }
}
