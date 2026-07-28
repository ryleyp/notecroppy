import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

const CONFIG_FILE = "notetaker-config.json";
const GLOSSARY_FILE = "notetaker-glossary.json";

function readJSON(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, "utf-8")); } catch { return null; }
}

function writeJSON(filePath, data) {
  fs.writeFileSync(filePath, JSON.stringify(data, null, 2), "utf-8");
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const dir = searchParams.get("path");
  if (!dir) return NextResponse.json({ error: "path is required" }, { status: 400 });

  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  let base;
  try {
    base = assertAllowedRoot(dir, "Config folder");
  } catch (error) {
    return NextResponse.json({ config: null });
  }
  const cfg = readJSON(path.join(base, CONFIG_FILE));
  const gls = readJSON(path.join(base, GLOSSARY_FILE));

  if (!cfg && !gls) return NextResponse.json({ config: null });

  return NextResponse.json({
    config: {
      accounts: cfg?.accounts ?? undefined,
      corrections: cfg?.corrections ?? undefined,
      replacements: gls?.replacements ?? cfg?.replacements ?? undefined,
    },
  });
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const { path: dir, config, glossary } = body;
    if (!dir) return NextResponse.json({ error: "path is required" }, { status: 400 });

    const base = assertAllowedRoot(dir, "Config folder");

    // Config file — accounts and corrections, no personal names
    if (config) {
      const existing = readJSON(path.join(base, CONFIG_FILE)) || {};
      writeJSON(path.join(base, CONFIG_FILE), {
        ...existing,
        ...(config.accounts !== undefined && { accounts: config.accounts }),
        ...(config.corrections !== undefined && { corrections: config.corrections }),
      });
    }

    // Glossary file — replacements with real names, keep separate
    const replacements = glossary?.replacements ?? config?.replacements;
    if (replacements !== undefined) {
      writeJSON(path.join(base, GLOSSARY_FILE), { replacements });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Save failed" },
      { status: error?.status || 500 }
    );
  }
}
