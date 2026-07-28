import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { POST } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-save-route-"));
  return tmpRoot;
}

function postSave(body, origin = "http://localhost:3000") {
  return POST(new Request("http://localhost/api/save", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin,
      "x-notetaker-session": getSessionToken(),
    },
    body: JSON.stringify(body),
  }));
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/save", () => {
  it("saves notes and avoids overwriting an existing file", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notesDir = path.join(vault, "Notes");
    fs.mkdirSync(notesDir, { recursive: true });
    allowDirectory(vault, "Vault path");
    fs.writeFileSync(path.join(notesDir, "Weekly Sync.md"), "old");

    const response = await postSave({
      notes: "# Weekly Sync",
      vaultPath: vault,
      folderPath: "Notes",
      meetingTitle: "Weekly Sync",
    });
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.savedPath).toBe(path.join("Notes", "Weekly Sync (1).md"));
    expect(fs.readFileSync(path.join(notesDir, "Weekly Sync (1).md"), "utf-8")).toBe("# Weekly Sync");
  });

  it("blocks sibling path traversal that shares the vault path prefix", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const sibling = path.join(root, "vault2");
    fs.mkdirSync(vault);
    fs.mkdirSync(sibling);
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "outside",
      vaultPath: vault,
      folderPath: "../vault2",
      meetingTitle: "Escape",
    });
    const data = await response.json();

    expect(response.status).toBe(403);
    expect(data.error).toMatch(/outside/);
    expect(fs.existsSync(path.join(sibling, "Escape.md"))).toBe(false);
  });

  it("rejects untrusted browser origins", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    allowDirectory(vault, "Vault path");

    const response = await postSave({
      notes: "nope",
      vaultPath: vault,
      meetingTitle: "Blocked",
    }, "https://example.com");

    expect(response.status).toBe(403);
  });

  it("rejects unapproved local roots even with a valid token", async () => {
    const root = makeTmp();
    const vault = path.join(root, "unapproved");
    fs.mkdirSync(vault);

    const response = await postSave({
      notes: "nope",
      vaultPath: vault,
      meetingTitle: "Blocked",
    });

    expect(response.status).toBe(403);
  });
});
