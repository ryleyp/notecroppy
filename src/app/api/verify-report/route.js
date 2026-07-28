import Anthropic from "@anthropic-ai/sdk";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { scrubWithExceptions } from "@/lib/scrub";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";

const MAX_SOURCE_CHARS = 300_000;
const MAX_REPORT_CHARS = 60_000;

// Second-pass audit for narrative reports (Account Status / SL Status):
// checks the generated Markdown against the source notes for misattributed,
// unsupported, or contradicted claims.
export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { report, notes = [], accountName, allAccounts = [], replacements = [], corrections = [], restoredIds = [], apiKey } = body;

    if (!report || !notes.length || !accountName) {
      return new Response(JSON.stringify({ error: "report, notes, and accountName are required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const clean = (t) => applyReplacements(applyCorrections(t || "", corrections), replacements);

    // Same sanitize + scrub pipeline generation used, so both sides align.
    const sanitized = notes.map((n) => ({ ...n, title: clean(n.title), content: clean(n.content) }));
    const scrubbed = scrubWithExceptions(sanitized, accountName, allAccounts, restoredIds);

    let total = 0;
    const sources = scrubbed.filter((n) => (total += n.content.length) <= MAX_SOURCE_CHARS);
    const sourceBlocks = sources.map((n) => `### ${n.date} — ${n.title}\n\n${n.content}`).join("\n\n---\n\n");
    const cleanReport = clean(report).slice(0, MAX_REPORT_CHARS);

    const prompt = `You are auditing a customer-success report about the account **${accountName}** against the source notes it was generated from.

Find real problems only — do not nitpick phrasing. Problem types:
- "misattributed": the report presents content as ${accountName}'s that the sources do not explicitly tie to ${accountName} (e.g. it came from a multi-account internal meeting and the surrounding source text never names ${accountName})
- "unsupported": a specific factual claim (name, number, decision, date, status) that does not appear in the sources
- "contradiction": the report states something the sources contradict (e.g. reports an old status a newer source reversed)

SOURCES:

${sourceBlocks}

REPORT TO AUDIT:

${cleanReport}

OUTPUT — one JSON object per line (NDJSON), no other text. For each problem:
{"quote":"short excerpt from the report showing the problem","problem":"misattributed","reason":"short explanation, cite the source date when possible"}
If the report is fully supported, output exactly one line:
{"quote":"","problem":"none","reason":"clean"}
Report at most 10 problems, most serious first.`;

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 3000,
      system: "You are a meticulous auditor. Respond with only newline-delimited JSON objects — no preamble.",
      messages: [{ role: "user", content: prompt }],
    });

    const text = firstTextBlock(msg);
    const findings = [];
    for (const line of text.split("\n")) {
      const t = line.trim();
      if (!t.startsWith("{")) continue;
      try {
        const f = JSON.parse(t);
        if (f.problem && f.problem !== "none") {
          findings.push({ quote: f.quote || "", problem: f.problem, reason: f.reason || "" });
        }
      } catch {}
    }

    return new Response(JSON.stringify({ findings: findings.slice(0, 10), usage: msg.usage }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Verification failed" }), { status: 500, headers: { "Content-Type": "application/json" } });
  }
}
