import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { DEFAULT_MODEL, maxOutputTokens } from "@/lib/models";
import { formatSourceBundleForPrompt } from "@/lib/sourceBundle";

const SYSTEM_PROMPT = `You revise generated meeting notes for an NI Customer Success Manager.

Always respond with ONLY the revised Markdown note. Preserve useful structure, keep Salesforce-safe language in the SFDC Activity Entry, and do not invent details.`;

export function buildRegenerationPrompt({
  notes,
  instruction,
  meetingTitle = "Meeting Notes",
  sourceBundle,
}) {
  const sourceBlock = formatSourceBundleForPrompt(sourceBundle);

  return `Revise the generated note according to the CSM's instruction.

Meeting Title: ${meetingTitle}

CSM instruction:
${instruction}

Rules:
- Keep the same meeting and do not add unsupported facts.
- Preserve or improve source citations using only IDs that appear in the source blocks.
- Keep citation markers like [T1] and [N1] out of the SFDC Activity Entry.
- The SFDC Activity Entry is pasted into a Salesforce field: its Summary/Notes block (Summary + Outcomes + Next steps, including the labels) must stay at 120 words or fewer and 800 characters or fewer. This holds even when the instruction asks for more detail or a longer note — put the extra detail in Meeting Notes instead, and trim this block until it fits.
- Meeting Notes has no length limit; prefer expanding it over any other section when more detail is requested.
- Preserve the required note sections unless the instruction explicitly asks for a different organization.
- If the instruction conflicts with the sources, follow the sources and make the note accurate.

${sourceBlock ? `Source blocks:\n${sourceBlock}\n\n` : ""}Current generated note:
${notes}`;
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      notes,
      instruction,
      meetingTitle,
      apiKey,
      model,
      sourceBundle,
    } = body;

    if (!notes?.trim()) {
      return NextResponse.json({ error: "Notes are required" }, { status: 400 });
    }
    if (!instruction?.trim()) {
      return NextResponse.json({ error: "Instruction is required" }, { status: 400 });
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
    const stream = client.messages.stream({
      model: selectedModel,
      max_tokens: maxOutputTokens(selectedModel),
      system: SYSTEM_PROMPT,
      messages: [{
        role: "user",
        content: buildRegenerationPrompt({
          notes,
          instruction,
          meetingTitle,
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
          send({ type: "done", usage: finalMsg.usage, model: selectedModel });
        } catch (err) {
          send({ type: "error", message: err?.message || "Regeneration failed" });
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
    console.error("Error regenerating notes:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to regenerate notes" },
      { status: error?.status || 500 }
    );
  }
}
