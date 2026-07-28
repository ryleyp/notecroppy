import { NextResponse } from "next/server";
import { assertTrustedOrigin } from "@/lib/requestSafety";
import { getSessionToken } from "@/lib/sessionToken";

export async function GET(request) {
  try {
    assertTrustedOrigin(request);
    return NextResponse.json({ token: getSessionToken() });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Could not start local session" },
      { status: error?.status || 403 }
    );
  }
}
