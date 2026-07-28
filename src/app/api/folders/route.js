import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

function getFoldersRecursive(dirPath, basePath, depth = 0, maxDepth = 5) {
  if (depth > maxDepth) return [];
  const folders = [];
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      // Skip hidden folders and Obsidian system folders
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dirPath, entry.name);
      const relativePath = path.relative(basePath, fullPath);
      folders.push({
        name: entry.name,
        path: relativePath,
        depth,
      });
      const children = getFoldersRecursive(fullPath, basePath, depth + 1, maxDepth);
      folders.push(...children);
    }
  } catch {
    // Skip unreadable directories
  }
  return folders;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const vaultPath = searchParams.get("vaultPath");

  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  if (!vaultPath) {
    return NextResponse.json({ error: "vaultPath is required" }, { status: 400 });
  }

  let resolved;
  try {
    resolved = assertAllowedRoot(vaultPath, "Vault path");
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid vault path" },
      { status: error?.status || 500 }
    );
  }

  // Include root as an option
  const folders = [
    { name: "(Vault root)", path: "", depth: -1 },
    ...getFoldersRecursive(resolved, resolved),
  ];

  return NextResponse.json({ folders });
}
