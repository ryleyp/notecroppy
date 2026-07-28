import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  assertExistingChildDirectory,
  assertExistingDirectory,
  sanitizeFilename,
  uniqueFilePath,
} from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { notes, vaultPath, folderPath, meetingTitle } = body;

    if (!notes) return NextResponse.json({ error: "Notes content is required" }, { status: 400 });
    if (!vaultPath) return NextResponse.json({ error: "Vault path is required" }, { status: 400 });

    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Target folder");

    const title = sanitizeFilename(meetingTitle || "Meeting Notes");
    const filename = `${title}.md`;
    const filePath = path.join(targetDir, filename);
    const finalPath = uniqueFilePath(filePath);

    fs.writeFileSync(finalPath, notes, "utf-8");

    const relativeSavedPath = path.relative(resolvedVault, finalPath);
    return NextResponse.json({ savedPath: relativeSavedPath, filename: path.basename(finalPath) });
  } catch (error) {
    console.error("Error saving note:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to save note" },
      { status: error?.status || 500 }
    );
  }
}
