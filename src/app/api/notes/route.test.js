import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-notes-route-"));
  return tmpRoot;
}

function recentDate(daysAgo = 7) {
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  return d;
}

function getNotes(params) {
  return GET(new Request(`http://localhost/api/notes?${params}`, {
    headers: { "x-notetaker-session": getSessionToken() },
  }));
}

afterEach(() => {
  vi.restoreAllMocks();
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/notes", () => {
  it("includes recent transcript archive files for the selected account", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const accountDir = path.join(vault, "Acme");
    const transcripts = path.join(root, "transcripts");
    const transcriptDir = path.join(transcripts, "Acme Transcripts");
    fs.mkdirSync(accountDir, { recursive: true });
    fs.mkdirSync(transcriptDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    allowDirectory(transcripts, "Transcripts archive path");

    const d = recentDate();
    const iso = d.toISOString().split("T")[0];
    fs.writeFileSync(path.join(accountDir, `${iso} - Planning.md`), "# Planning\n\nMet Sam at Acme.");
    const transcriptPath = path.join(transcriptDir, "Quarterly Transcript.md");
    fs.writeFileSync(transcriptPath, "# Quarterly Transcript\n\nSam mentioned the Dallas lab.");
    fs.utimesSync(transcriptPath, d, d);

    const params = new URLSearchParams({
      vaultPath: vault,
      folderPath: "Acme",
      accountAliases: "acme",
      transcriptsPath: transcripts,
      transcriptFolder: "Acme Transcripts",
    });
    const response = await getNotes(params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.counts).toEqual({ obsidian: 1, transcripts: 1, crossVault: 0 });
    expect(data.notes).toEqual(expect.arrayContaining([
      expect.objectContaining({
        title: "Quarterly Transcript",
        source: "transcript",
        sourceLabel: "Acme Transcripts",
      }),
    ]));
  });

  it("skips reading date-prefixed files outside the requested window", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const accountDir = path.join(vault, "Acme");
    fs.mkdirSync(accountDir, { recursive: true });
    allowDirectory(vault, "Vault path");

    const oldPath = path.join(accountDir, "2025-01-01 - Old.md");
    const recentPath = path.join(accountDir, "2026-02-01 - Recent.md");
    fs.writeFileSync(oldPath, "# Old\n\nThis should not be read.");
    fs.writeFileSync(recentPath, "# Recent\n\nThis should be included.");

    const readSpy = vi.spyOn(fs, "readFileSync");

    const params = new URLSearchParams({
      vaultPath: vault,
      folderPath: "Acme",
      startDate: "2026-01-01",
      endDate: "2026-03-31",
    });
    const response = await getNotes(params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notes.map((n) => n.filename)).toEqual(["2026-02-01 - Recent.md"]);
    const readPaths = readSpy.mock.calls.map(([file]) => String(file));
    expect(readPaths).toContain(recentPath);
    expect(readPaths).not.toContain(oldPath);
  });

  it("can include all historical and undated files", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const accountDir = path.join(vault, "Acme");
    fs.mkdirSync(accountDir, { recursive: true });
    allowDirectory(vault, "Vault path");

    fs.writeFileSync(path.join(accountDir, "2024-01-01 - Old Contact.md"), "# Old Contact\n\nMet Pat.");
    fs.writeFileSync(path.join(accountDir, "Undated Contact.md"), "# Contact Notes\n\nDana owns the lab.");

    const params = new URLSearchParams({
      vaultPath: vault,
      folderPath: "Acme",
      allTime: "true",
    });
    const response = await getNotes(params);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.notes.map((n) => n.filename)).toEqual([
      "2024-01-01 - Old Contact.md",
      "Undated Contact.md",
    ]);
    expect(data.notes.find((n) => n.filename === "Undated Contact.md")).toEqual(expect.objectContaining({
      date: "",
      title: "Undated Contact",
    }));
  });
});
