import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  assertExistingChildDirectory,
  assertExistingDirectory,
  isPathInside,
  sanitizeFilename,
  uniqueFilePath,
} from "@/lib/fileSafety";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-file-safety-"));
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("isPathInside", () => {
  it("rejects sibling paths with the same string prefix", () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const sibling = path.join(root, "vault2");

    expect(isPathInside(vault, sibling)).toBe(false);
    expect(isPathInside(vault, path.join(vault, "notes"))).toBe(true);
  });
});

describe("directory assertions", () => {
  it("resolves existing child folders and rejects traversal", () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const notes = path.join(vault, "notes");
    const sibling = path.join(root, "vault2");
    fs.mkdirSync(notes, { recursive: true });
    fs.mkdirSync(sibling);

    expect(assertExistingDirectory(vault, "Vault path")).toBe(vault);
    expect(assertExistingChildDirectory(vault, "notes")).toBe(notes);
    expect(() => assertExistingChildDirectory(vault, "../vault2")).toThrow("outside");
  });
});

describe("filename helpers", () => {
  it("removes invalid filename characters and creates unique paths", () => {
    const root = makeTmp();
    const first = path.join(root, "Meeting.md");
    fs.writeFileSync(first, "existing");

    expect(sanitizeFilename('Bad:/Name*')).toBe("Bad--Name-");
    expect(uniqueFilePath(first)).toBe(path.join(root, "Meeting (1).md"));
  });
});
