import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { GET } from "./route";
import { allowDirectory } from "@/lib/pathAllowlist";
import { getSessionToken } from "@/lib/sessionToken";

let tmpRoot = null;

function makeTmp() {
  tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "notetaker-folders-route-"));
  return tmpRoot;
}

afterEach(() => {
  if (tmpRoot) fs.rmSync(tmpRoot, { recursive: true, force: true });
  tmpRoot = null;
});

describe("/api/folders", () => {
  it("returns relative folder paths without exposing absolute paths", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(path.join(vault, "Customers", "Acme"), { recursive: true });
    allowDirectory(vault, "Vault path");

    const params = new URLSearchParams({ vaultPath: vault });
    const response = await GET(new Request(`http://localhost/api/folders?${params}`, {
      headers: { "x-notetaker-session": getSessionToken() },
    }));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.folders).toContainEqual(expect.objectContaining({
      name: "Acme",
      path: path.join("Customers", "Acme"),
    }));
    expect(data.folders.every((folder) => folder.fullPath === undefined)).toBe(true);
  });

  it("requires a valid local session token", async () => {
    const root = makeTmp();
    const vault = path.join(root, "vault");
    fs.mkdirSync(vault);
    allowDirectory(vault, "Vault path");

    const params = new URLSearchParams({ vaultPath: vault });
    const response = await GET(new Request(`http://localhost/api/folders?${params}`));

    expect(response.status).toBe(401);
  });
});
