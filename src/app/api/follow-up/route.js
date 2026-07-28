import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { DEFAULT_MODEL } from "@/lib/models";
import { formatSourceBundleForPrompt } from "@/lib/sourceBundle";

const SYSTEM_PROMPT = `You draft concise, customer-ready follow-up emails for an NI Customer Success Manager.

Use a warm, plain, professional CSM voice. Do not invent commitments, dates, links, pricing, attendees, or outcomes. Respond with only the email draft in Markdown.`;

export function buildFollowUpPrompt({
  notes,
  meetingTitle = "Meeting",
  audience = "customer",
  tone = "warm-professional",
  instructions = "",
  sourceBundle,
}) {
  const sourceBlock = formatSourceBundleForPrompt(sourceBundle);

  return `Draft a follow-up email from the CSM after this meeting.

Meeting Title: ${meetingTitle}
Audience: ${audience}
Tone: ${tone}
${instructions?.trim() ? `Additional instruction from the CSM:\n${instructions.trim()}\n` : ""}

Rules:
- Include a subject line.
- Keep it concise and useful.
- Lead with thanks and the meeting outcome.
- Include only follow-ups, asks, owners, due dates, and context supported by the generated note or source blocks.
- Separate CSM-owned actions from customer-owned actions when both exist.
- Do not include source citation markers in the email.
- Avoid internal-only commentary, account strategy, raw sentiment analysis, or anything that should not be customer-visible.

${sourceBlock ? `Source blocks for verification:\n${sourceBlock}\n\n` : ""}Generated meeting note:
${notes}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      notes,
      meetingTitle,
      apiKey,
      model,
      audience = "customer",
      tone = "warm-professional",
      instructions = "",
      sourceBundle,
    } = body;

    if (!notes?.trim()) {
      return NextResponse.json({ error: "Notes are required" }, { status: 400 });
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
      max_tokens: 8_000,
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildFollowUpPrompt({
          notes,
          meetingTitle,
          audience,
          tone,
          instructions,
          sourceBundle,
        }),
      }],
    });

    const draft = msg.content
      .filter((part) => part.type === "text")
      .map((part) => part.text)
      .join("\n")
      .trim();

    return NextResponse.json({ draft, usage: msg.usage, model: selectedModel });
  } catch (error) {
    console.error("Follow-up draft error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to draft follow-up" },
      { status: error?.status || 500 }
    );
  }
}
