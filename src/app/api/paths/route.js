import { NextResponse } from "next/server";
import { allowConfiguredPaths, listAllowedRoots } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

export async function POST(request) {
  try {
    assertTrustedRequest(request);
    const body = await request.json();
    const result = allowConfiguredPaths(body);
    return NextResponse.json({ ok: true, ...result, allowedRoots: listAllowedRoots() });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Could not approve local paths" },
      { status: error?.status || 500 }
    );
  }
}
