import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { DEFAULT_MODEL, firstTextBlock, maxOutputTokens } from "@/lib/models";
import { buildSourceBundle, formatSourceBundleForPrompt } from "@/lib/sourceBundle";

const SYSTEM_PROMPT = `You turn customer-success email threads into concise Obsidian notes for an NI Customer Success Manager.

Use only the provided email-thread and CSM context sources. Do not invent decisions, owners, dates, commitments, links, prices, or attendees. Keep internal strategy and customer-visible facts clearly separated. Always respond with only Markdown.`;

export function buildEmailThreadPrompt({
  emailThread,
  threadTitle = "Email Thread",
  threadDate,
  context = "",
  sourceBundle,
}) {
  const title = threadTitle || "Email Thread";
  const sources = sourceBundle || buildSourceBundle({ emailThread, rawNotes: context });
  const sourceBlock = formatSourceBundleForPrompt(sources) || `[E1] Email thread\n${emailThread}`;

  return `Create an Obsidian note from this email thread.

Thread Title: ${title}
Thread Date: ${threadDate || "Not specified"}

SOURCE BLOCKS:
${sourceBlock}

Rules:
- Use only source block IDs above as citations.
- Cite every factual bullet or factual paragraph with [E#] or [N#].
- Do not include citation markers in the raw Source Email section.
- Capture what the thread contains, what changed, what was decided, and what follow-up is needed.
- If no decision was made, write "No explicit decisions in this thread."
- If an item is a proposal, request, or opinion rather than a decision, label it that way.
- Skip signatures, legal disclaimers, repeated quoted history, and email-client boilerplate.
- Do not include personal updates or unrelated chatter.
- Do not include YAML frontmatter.

Generate exactly this structure:

# ${threadDate ? `${threadDate} - ` : ""}${title}

<tag line: list extracted tags inline as #email-thread plus any explicit product/account/topic tags>

---

## Thread Summary

Write 2-4 concise bullets describing the business-relevant content of the thread.

---

## Decisions

List explicit decisions as bullets. Include who decided or agreed if stated.

---

## Open Questions

List unresolved questions, asks, blockers, or missing information.

---

## Action Items

List action items as Markdown task checkboxes. Format:
- [ ] [Action item description] — **Owner:** [Name or Team] | **Due:** [Date or "TBD"]

---

## Customer Success Takeaways

Capture account-planning implications, risks, adoption signals, renewal/expansion relevance, stakeholder signals, and sensitive context the CSM should remember.

---

## Source Email Content

Summarize the thread chronologically, newest-to-oldest if the source makes that clear. Preserve the substance of important asks, replies, decisions, and commitments, but do not copy long disclaimers or signatures.`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      emailThread,
      threadTitle,
      threadDate,
      context = "",
      apiKey,
      model,
      sourceBundle,
    } = body;

    if (!emailThread?.trim()) {
      return NextResponse.json({ error: "Email thread is required" }, { status: 400 });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return NextResponse.json(
        { error: "Anthropic API key is required. Add it in Settings or set ANTHROPIC_API_KEY in .env.local" },
        { status: 400 }
      );
    }

    const client = new Anthropic({ apiKey: key });
    const selectedModel = model || DEFAULT_MODEL;
    const msg = await client.messages.create({
      model: selectedModel,
      max_tokens: maxOutputTokens(selectedModel),
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildEmailThreadPrompt({
          emailThread,
          threadTitle,
          threadDate,
          context,
          sourceBundle,
        }),
      }],
    });

    const note = firstTextBlock(msg).trim();

    return NextResponse.json({ note, usage: msg.usage, model: selectedModel });
  } catch (error) {
    console.error("Email thread note error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to create email thread note" },
      { status: error?.status || 500 }
    );
  }
}
