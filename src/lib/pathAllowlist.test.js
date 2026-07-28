import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { allowConfiguredPaths, allowDirectory, assertAllowedRoot } from "@/lib/pathAllowlist";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-allowlist-"));
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("path allowlist", () => {
  it("allows approved roots and rejects unapproved siblings", () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    const sibling = path.join(root, "vault2");
    fs.mkdirSync(vault);
    fs.mkdirSync(sibling);

    allowDirectory(vault, "Vault path");

    expect(assertAllowedRoot(vault, "Vault path")).toBe(vault);
    expect(() => assertAllowedRoot(sibling, "Sibling")).toThrow("not been approved");
  });

  it("returns warnings for optional archive paths that do not exist", () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);

    const result = allowConfiguredPaths({
      vaultPath: vault,
      transcriptsPath: path.join(root, "missing"),
    });

    expect(result.allowed.vaultPath).toBe(vault);
    expect(result.warnings[0]).toMatch(/does not exist/);
  });
});
