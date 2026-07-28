import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { textHasAlias } from "@/lib/accounts";
import { assertExistingChildDirectory } from "@/lib/fileSafety";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

function parseDateFromFilename(filename) {
  const match = filename.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

function parseDateFromContent(content) {
  const match = content.match(/^#[^\n]*?(\d{4}-\d{2}-\d{2})/m);
  if (!match) return null;
  const d = new Date(match[1]);
  return isNaN(d.getTime()) ? null : d;
}

function dateOutsideWindow(date, cutoff) {
  return (cutoff.start && date < cutoff.start) || (cutoff.end && date > cutoff.end);
}

function readFolder(dir, cutoff, source, sourceLabel, options = {}) {
  const notes = [];
  if (!fs.existsSync(dir)) return notes;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return notes; }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = path.join(dir, entry.name);
    let stat = null;
    try { stat = fs.statSync(filePath); } catch { continue; }

    const filenameDate = parseDateFromFilename(entry.name);
    if (filenameDate && dateOutsideWindow(filenameDate, cutoff)) continue;

    let content = null;
    let date = filenameDate;
    if (!date) {
      try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
      date = parseDateFromContent(content);
    }
    if (!date && options.useMtimeDate) {
      try { date = fs.statSync(filePath).mtime; } catch { continue; }
    }
    if (!date) {
      if (!options.includeUndated) continue;
    } else if (dateOutsideWindow(date, cutoff)) {
      continue;
    }

    if (content === null) {
      try { content = fs.readFileSync(filePath, "utf-8"); } catch { continue; }
    }

    notes.push({
      filename: entry.name,
      relativePath: path.relative(options.basePath || dir, filePath),
      mtimeMs: stat.mtimeMs,
      size: stat.size,
      date: date ? date.toISOString().split("T")[0] : "",
      title: entry.name.replace(/^\d{4}-\d{2}-\d{2}\s*-\s*/, "").replace(/\.md$/, ""),
      content,
      source,
      sourceLabel,
    });
  }
  return notes;
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const vaultPath = searchParams.get("vaultPath");
  const folderPath = searchParams.get("folderPath") || "";
  const transcriptsPath = searchParams.get("transcriptsPath") || "";
  const transcriptFolder = searchParams.get("transcriptFolder") || "";
  const accountAliases = (searchParams.get("accountAliases") || searchParams.get("accountKeyword") || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  if (!vaultPath) {
    return NextResponse.json({ error: "vaultPath is required" }, { status: 400 });
  }

  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  let resolvedVault;
  let targetDir;
  try {
    resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    targetDir = assertExistingChildDirectory(resolvedVault, folderPath, "Folder");
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid folder" },
      { status: error?.status || 500 }
    );
  }

  // Date window: `allTime=true` removes the lower bound; otherwise explicit
  // startDate/endDate (YYYY-MM-DD) take precedence, falling back to a trailing
  // `months` window (default 3).
  const allTime = ["1", "true", "yes"].includes((searchParams.get("allTime") || "").toLowerCase());
  const startParam = searchParams.get("startDate");
  const endParam = searchParams.get("endDate");
  let start = !allTime && startParam ? new Date(startParam) : null;
  if (start && isNaN(start.getTime())) start = null;
  if (!allTime && !start) {
    const monthsParam = parseInt(searchParams.get("months"), 10);
    const months = Number.isFinite(monthsParam) && monthsParam > 0 ? monthsParam : 3;
    start = new Date();
    start.setMonth(start.getMonth() - months);
  }
  let end = endParam ? new Date(endParam) : null;
  if (end && isNaN(end.getTime())) end = null;
  if (end) end.setHours(23, 59, 59, 999);
  const cutoff = { start, end };
  const readOptions = { includeUndated: allTime, basePath: resolvedVault };

  // 1. Primary Obsidian folder notes
  const primaryNotes = readFolder(targetDir, cutoff, "obsidian", folderPath || "Vault root", readOptions);

  // 2. Transcript archive notes for this account. Transcript filenames often
  // do not contain dates, so use modified time as a fallback for archive files.
  let transcriptNotes = [];
  let transcriptWarning = null;
  if (transcriptsPath && transcriptFolder) {
    try {
      const resolvedTranscripts = assertAllowedRoot(transcriptsPath, "Transcripts archive path");
      const transcriptDir = assertExistingChildDirectory(resolvedTranscripts, transcriptFolder, "Transcript folder");
      transcriptNotes = readFolder(transcriptDir, cutoff, "transcript", transcriptFolder, { useMtimeDate: true, includeUndated: allTime, basePath: resolvedTranscripts });
    } catch (error) {
      transcriptWarning = error?.message || "Transcript archive could not be scanned";
    }
  }

  // 3. Cross-vault keyword search (other Obsidian subfolders, skipping transcript folders).
  // A note matches if any account alias appears as a whole word in its content.
  let crossVaultNotes = [];
  if (accountAliases.length) {
    let vaultEntries;
    try { vaultEntries = fs.readdirSync(resolvedVault, { withFileTypes: true }); } catch {}
    if (vaultEntries) {
      const excludeName = folderPath.split("/")[0];
      for (const entry of vaultEntries) {
        if (!entry.isDirectory()) continue;
        if (entry.name.startsWith(".") || entry.name === excludeName) continue;
        if (entry.name.toLowerCase().includes("transcript")) continue;
        if (entry.name.toLowerCase().includes("todo")) continue;
        const subDir = path.join(resolvedVault, entry.name);
        const candidates = readFolder(subDir, cutoff, "cross-vault", entry.name, readOptions);
        for (const note of candidates) {
          if (accountAliases.some((a) => textHasAlias(note.content, a))) {
            crossVaultNotes.push(note);
          }
        }
      }
    }
  }

  const all = [...primaryNotes, ...transcriptNotes, ...crossVaultNotes];
  all.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    // Same day: sort by filename ascending so meeting 1 < 2 < 3 (oldest → newest)
    return a.filename.localeCompare(b.filename);
  });

  return NextResponse.json({
    notes: all,
    total: all.length,
    counts: {
      obsidian: primaryNotes.length,
      transcripts: transcriptNotes.length,
      crossVault: crossVaultNotes.length,
    },
    warning: transcriptWarning,
  });
}
