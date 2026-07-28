import { NextResponse } from "next/server";
import { assertTrustedOrigin, assertTrustedRequest } from "@/lib/requestSafety";

// Module-level store — single-user local app, fine for this use case
let pending = null;

export async function POST(request) {
  try {
    assertTrustedOrigin(request);

    const { transcript, title } = await request.json();
    if (!transcript) return NextResponse.json({ ok: false, error: "No transcript" }, { status: 400 });
    pending = { transcript, title: title || "", ts: Date.now() };
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false }, { status: 400 });
  }
}

export async function GET(request) {
  try {
    // Browser polling is protected. Shortcut POSTs remain origin-checked only so
    // the existing macOS shortcut can still deposit a transcript.
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  if (!pending) return NextResponse.json({ ok: true, pending: false });
  const data = pending;
  pending = null;
  return NextResponse.json({ ok: true, pending: true, transcript: data.transcript, title: data.title });
}
