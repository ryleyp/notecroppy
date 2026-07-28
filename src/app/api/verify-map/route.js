import { NextResponse } from "next/server";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { verifyStakeholderMapDocument } from "@/lib/contactMapping";

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { map = "", facts = [], accountName, allAccounts = [] } = body;

    if (!map.trim()) {
      return NextResponse.json({ findings: [{ severity: "warning", message: "Map is empty." }] });
    }

    return NextResponse.json({
      findings: verifyStakeholderMapDocument(map, facts, accountName, allAccounts),
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to verify map" },
      { status: error?.status || 500 }
    );
  }
}
