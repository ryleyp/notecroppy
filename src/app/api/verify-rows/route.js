import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { scrubWithExceptions } from "@/lib/scrub";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";

const MAX_SOURCE_CHARS = 300_000;

// Second-pass audit: for each generated activity row, ask a fast model
// whether the cited source actually ties the activity to the account.
// Catches misattribution that term filters can't see (orphaned context
// rewritten to sound like the current account).
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { rows = [], notes = [], accountName, allAccounts = [], replacements = [], corrections = [], restoredIds = [], apiKey } = body;

    if (!rows.length || !notes.length || !accountName) {
      return new Response(JSON.stringify({ error: "rows, notes, and accountName are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const clean = (t) => applyReplacements(applyCorrections(t || "", corrections), replacements);

    // Same sanitize + scrub pipeline the report generation used.
    const sanitized = notes.map((n) => ({ ...n, title: clean(n.title), content: clean(n.content) }));
    const scrubbed = scrubWithExceptions(sanitized, accountName, allAccounts, restoredIds);

    // Only send sources that rows actually cite (matched by title or date).
    const cited = new Set();
    for (const r of rows) {
      const st = clean(r.sourceTitle).toLowerCase();
      for (const n of scrubbed) {
        const title = (n.title || "").toLowerCase();
        if ((st && (title.includes(st) || st.includes(title))) || n.date === r.eventDate) cited.add(n);
      }
    }
    let sources = [...(cited.size ? cited : scrubbed)];
    let total = 0;
    sources = sources.filter((n) => (total += n.content.length) <= MAX_SOURCE_CHARS);

    const sourceBlocks = sources.map((n) => `### ${n.date} — ${n.title}\n\n${n.content}`).join("\n\n---\n\n");
    const claims = rows.map((r, i) =>
      `${i}. [${r.eventDate}] "${clean(r.title)}" (${r.type} / ${r.subtype}) — cited source: "${clean(r.sourceTitle) || "none"}"\n   Comment: ${clean(r.comments)}`
    ).join("\n");

    const prompt = `You are auditing an EA activity report for the account **${accountName}**. Each numbered claim below was generated from the sources. Your job: verify each claim is genuinely ${accountName}'s activity, explicitly supported by the sources.

Mark supported=false when:
- the activity in the claim cannot be found in the sources, OR
- the source content it's based on is not explicitly tied to ${accountName} (e.g. it came from a multi-account internal meeting and the surrounding text never names ${accountName}), OR
- the claim materially embellishes or repurposes source content

Mark supported=true only when the source text explicitly connects the described activity to ${accountName}.

SOURCES:

${sourceBlocks}

CLAIMS TO VERIFY:

${claims}

OUTPUT — one JSON object per line (NDJSON), no other text, one line per claim:
{"index":0,"supported":true,"reason":"short explanation citing the source date"}`;

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 4000,
      system: "You are a meticulous auditor. Respond with only newline-delimited JSON objects — no preamble.",
      messages: [{ role: "user", content: prompt }],
    });

    const text = firstTextBlock(msg);
    const verdicts = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const v = JSON.parse(t);
        if (Number.isInteger(v.index)) verdicts.push({ index: v.index, supported: !!v.supported, reason: v.reason || "" });
      } catch {}
    }

    return new Response(JSON.stringify({ verdicts, usage: msg.usage }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Verification failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
