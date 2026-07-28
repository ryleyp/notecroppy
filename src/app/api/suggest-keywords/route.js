import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { detectAccount } from "@/lib/accounts";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { assertTrustedRequest } from "@/lib/requestSafety";

const MAX_FILES_PER_FOLDER = 300;
const MAX_FILE_BYTES = 300_000;

// Generic words that should never become account keywords: common English,
// meeting vocabulary, NI product/role terms shared by every account.
const STOP = new Set(`
the this that they there then them their these those when what where which will would could should shall
have has had from with within without about above after again before being just like know look make more
most much need next some such sure than thank thanks time today took very want week were your yeah okay
right going been also both each into over under our out not now new was for and but you all can get
meeting meetings notes note action items item steps step follow following update updates review reviews
discussion session sessions call calls sync team teams member members plan plans planning quarter year
month monday tuesday wednesday thursday friday saturday sunday january february march april may june july
august september october november december question questions point points thing things talk talked
labview teststand systemlink veristand flexlogger instrumentstudio diadem multisim daqmx rfmx daq pxi vst
national instruments claude obsidian salesforce sfdc outlook excel powerpoint python linux windows github
csm fae ssm qbr ebr roi sle sls gts vla nic emerson training credits license licenses licensing software
hardware server enterprise admin admins customer customers account accounts email newsletter engineer
engineers engineering site sites region attendees outcome demo user users group groups
`.trim().split(/\s+/));

function* mdFiles(dir) {
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  let n = 0;
  for (const e of entries) {
    if (!e.isFile() || !e.name.endsWith(".md")) continue;
    if (++n > MAX_FILES_PER_FOLDER) return;
    yield path.join(dir, e.name);
  }
}

function readCorpus(dir) {
  let text = "";
  for (const f of mdFiles(dir)) {
    try {
      const stat = fs.statSync(f);
      if (stat.size > MAX_FILE_BYTES) continue;
      text += "\n" + fs.readFileSync(f, "utf-8");
    } catch {}
  }
  return text;
}

// Candidate terms: capitalized 1-3 word sequences, acronyms, email domains.
function extractCandidates(text) {
  const counts = new Map();
  const bump = (term) => {
    const t = term.trim();
    if (t.length < 3) return;
    if (STOP.has(t.toLowerCase())) return;
    if (/^\d+$/.test(t)) return;
    counts.set(t, (counts.get(t) || 0) + 1);
  };

  // Capitalized sequences (skip line-initial word — usually sentence case)
  for (const line of text.split("\n")) {
    const re = /\b([A-Z][a-zA-Z0-9'-]{2,}(?:\s+[A-Z][a-zA-Z0-9'-]{2,}){0,2})\b/g;
    let m;
    while ((m = re.exec(line))) {
      if (m.index === 0) continue;
      // Drop multi-word candidates whose every word is stoplisted
      const words = m[1].split(/\s+/);
      if (words.every((w) => STOP.has(w.toLowerCase()))) continue;
      bump(m[1]);
    }
  }
  // Acronyms
  for (const m of text.matchAll(/\b[A-Z]{2,6}\b/g)) bump(m[0]);
  // Email domains
  for (const m of text.matchAll(/@([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)) bump("@" + m[1].toLowerCase());

  return counts;
}

export async function GET(request) {
  try {
    assertTrustedRequest(request);
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Invalid local session" },
      { status: error?.status || 403 }
    );
  }

  const { searchParams } = new URL(request.url);
  const vaultPath = searchParams.get("vaultPath");
  const transcriptsPath = searchParams.get("transcriptsPath");
  let accounts = [];
  try { accounts = JSON.parse(searchParams.get("accounts") || "[]"); } catch {}

  if (!vaultPath || !accounts.length) {
    return NextResponse.json({ error: "vaultPath and accounts are required" }, { status: 400 });
  }

  // Map each folder to an account and build per-account corpora.
  const corpora = {}; // account name -> text
  const addCorpus = (name, dir) => {
    const text = readCorpus(dir);
    if (text.trim()) corpora[name] = (corpora[name] || "") + text;
  };

  // Only scan roots the user approved for this session. Without this, any
  // caller could point the scanner at an arbitrary directory and read back
  // terms harvested from its .md files.
  const roots = [];
  for (const candidate of [vaultPath, transcriptsPath].filter(Boolean)) {
    try {
      roots.push(assertAllowedRoot(candidate, "Scan path"));
    } catch (error) {
      return NextResponse.json(
        { error: error?.message || "Path is not approved for this local session" },
        { status: error?.status || 403 }
      );
    }
  }
  for (const root of roots) {
    let entries;
    try { entries = fs.readdirSync(root, { withFileTypes: true }); } catch { continue; }
    for (const e of entries) {
      if (!e.isDirectory() || e.name.startsWith(".")) continue;
      const byAlias = detectAccount(e.name, accounts);
      const byArchive = accounts.find((a) => a.archiveFolder && e.name.toLowerCase() === a.archiveFolder.toLowerCase());
      const owner = byArchive?.name || (byAlias.name !== "Internal" ? byAlias.name : null);
      if (owner) addCorpus(owner, path.join(root, e.name));
    }
  }

  // Existing terms across ALL accounts are never suggested.
  const existing = new Set(
    accounts.flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
      .filter(Boolean)
      .map((t) => t.toLowerCase())
  );

  const perAccount = {};
  for (const [name, text] of Object.entries(corpora)) perAccount[name] = extractCandidates(text);

  const suggestions = {};
  for (const [name, counts] of Object.entries(perAccount)) {
    const out = [];
    for (const [term, count] of counts) {
      if (count < 3) continue;
      if (existing.has(term.toLowerCase())) continue;
      // Distinctive: rare in every other account's corpus.
      let elsewhere = 0;
      for (const [other, otherCounts] of Object.entries(perAccount)) {
        if (other === name) continue;
        elsewhere += otherCounts.get(term) || 0;
      }
      if (elsewhere > count * 0.2) continue;
      out.push({ term, count });
    }
    out.sort((a, b) => b.count - a.count);
    suggestions[name] = out.slice(0, 20);
  }

  return NextResponse.json({ suggestions });
}
