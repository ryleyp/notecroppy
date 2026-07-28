import Anthropic from "@anthropic-ai/sdk";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";

const SYSTEM_PROMPT = `You segment raw, undifferentiated meeting transcripts into speaker turns by inferring shifts in who is speaking from conversational context. You have no audio and no ground truth — you are making an informed best-effort guess. Preserve the original wording exactly: never paraphrase, summarize, correct, or omit any text. Output ONLY the segmented transcript in the required format — no preamble, no commentary, no explanation.`;

function buildPrompt(transcript) {
  return `This is a raw meeting transcript with no speaker labels — it was transcribed via on-device dictation, so if multiple people were talking, their speech was merged into one continuous stream with no indication of who said what.

TASK: Re-segment this transcript into speaker turns by detecting likely shifts in who is speaking. Use conversational cues such as:
- Question-and-answer exchanges (the question and its answer are usually different speakers)
- Direct address ("David, what do you think about...")
- A statement that directly responds to, agrees with, or contradicts the immediately preceding statement
- Self-identification (someone stating their own name, e.g. "this is Sarah" or "it's me, John")
- A change in role or perspective (e.g. one person reporting status, another asking a follow-up question)
- Short backchannel responses ("Right, right", "yeah exactly", "got it") that suggest a brief turn from a different speaker

Be conservative — if a shift is not reasonably clear from these cues, keep the text under the same speaker turn rather than inventing a break. Do not assume a fixed number of speakers; infer as many as the evidence clearly supports, but do not over-segment.

RULES:
1. Preserve every word of the original transcript, verbatim, in the original order. Do not summarize, paraphrase, clean up, or omit anything.
2. Label speakers generically as "Speaker 1", "Speaker 2", etc., in order of first appearance — UNLESS a speaker states or is unambiguously identified by their own real name in a way that clearly marks them as the one currently speaking, in which case use that name consistently for that person for the rest of the transcript.
3. Format EVERY turn exactly as: **Label:** followed by that speaker's verbatim text. Separate turns with a single blank line. Output nothing else — no headers, no notes, no summary.

TRANSCRIPT:
${transcript}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { transcript, apiKey, model } = body;

    if (!transcript || !transcript.trim()) {
      return new Response(JSON.stringify({ error: "Transcript is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      return new Response(JSON.stringify({ error: "Anthropic API key is required" }), { status: 400, headers: { "Content-Type": "application/json" } });
    }

    const client = new Anthropic({ apiKey: key });
    const msg = await client.messages.create({
      model: model || "claude-haiku-4-5",
      max_tokens: 8192,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: buildPrompt(transcript) }],
    });

    const segmented = firstTextBlock(msg);
    return new Response(JSON.stringify({ segmented, usage: msg.usage }), { headers: { "Content-Type": "application/json" } });
  } catch (error) {
    return new Response(JSON.stringify({ error: error?.message || "Speaker detection failed" }), { status: error?.status || 500, headers: { "Content-Type": "application/json" } });
  }
}
