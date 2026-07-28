import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import { buildSanitizePrompt, parseEntityList } from "@/lib/privacy";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { firstTextBlock } from "@/lib/models";

export async function POST(request) {
  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Untrusted request origin" },
      { status: error?.status || 403 }
    );
  }

  const body = await request.json();
  const { transcript, apiKey, knownAliases = [] } = body;

  const key = apiKey || process.env.ANTHROPIC_API_KEY;
  if (!key) return NextResponse.json({ entities: [], skipped: true });

  const client = new Anthropic({ apiKey: key });
  const prompt = buildSanitizePrompt(transcript, knownAliases);

  try {
    const msg = await client.messages.create({
      model: "claude-haiku-4-5",
      max_tokens: 512,
      messages: [{ role: "user", content: prompt }],
    });

    const raw = firstTextBlock(msg).trim() || "[]";
    const entities = parseEntityList(raw, knownAliases);
    return NextResponse.json({ entities });
  } catch {
    return NextResponse.json({ entities: [] });
  }
}
