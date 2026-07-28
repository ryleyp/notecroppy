// Placeholder account configuration — deliberately fictional.
//
// Real account names, aliases, and keywords are customer data and must not
// live in source control. Load the real roster through Settings → Import
// config (see docs/private-config.md); it is then persisted to the portable
// notetaker-config.json in your transcripts folder, which stays local.
//
// These placeholders exist so a fresh clone is runnable and demonstrable.
// Each account maps a set of name aliases (used for cross-vault keyword
// search and folder auto-detection) to a transcript archive subfolder.
export const DEFAULT_ACCOUNTS = [
  { name: "Acme Aerospace", archiveFolder: "Acme Transcripts", aliases: ["acme", "aac"] },
  { name: "Beacon Systems", archiveFolder: "Beacon Transcripts", aliases: ["beacon", "bcn"] },
  { name: "Cardinal Defense", archiveFolder: "Cardinal Transcripts", aliases: ["cardinal", "cad"] },
  { name: "Delta Microsystems", archiveFolder: "Delta Transcripts", aliases: ["delta"] },
];

const INTERNAL = { name: "Internal", archiveFolder: "Internal Transcripts", aliases: [] };

function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Use the provided account list, or fall back to defaults when missing/empty.
function resolve(accounts) {
  return accounts && accounts.length ? accounts : DEFAULT_ACCOUNTS;
}

// Whole-word, case-insensitive test for an alias appearing anywhere in text.
// Word boundaries prevent false positives like "ngc" inside "engcomputer".
export function textHasAlias(text, alias) {
  const a = (alias || "").trim();
  if (!a) return false;
  const esc = escapeRegex(a);
  const left = /^\w/.test(a) ? "\\b" : "";
  const right = /\w$/.test(a) ? "\\b" : "";
  return new RegExp(`${left}${esc}${right}`, "i").test(text || "");
}

// Which of an account's EA/EP agreements apply to a piece of text (a
// transcript). An agreement matches if any of its keywords appears as a
// whole word; an agreement with NO keywords is treated as always applicable
// to its account. Returns [{ type, number }] with duplicate numbers removed.
export function suggestAgreements(text, account) {
  const agreements = account?.agreements || [];
  const out = [];
  const seen = new Set();
  for (const g of agreements) {
    const number = (g.number || "").trim();
    if (!number) continue;
    const keywords = (g.keywords || []).filter(Boolean);
    const hit = keywords.length === 0 || keywords.some((k) => textHasAlias(text, k));
    if (!hit) continue;
    const type = g.type === "EP" ? "EP" : "EA";
    const key = `${type} ${number}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ type, number });
  }
  return out;
}

// Detect which account a selected Obsidian folder name belongs to.
// Uses substring matching since folder names are short and curated
// (e.g. "3. Acme"). Falls back to Internal when nothing matches.
export function detectAccount(folderName, accounts) {
  const f = (folderName || "").toLowerCase();
  for (const acct of resolve(accounts)) {
    if ((acct.aliases || []).some((a) => f.includes(a.toLowerCase()))) {
      return { name: acct.name, archiveFolder: acct.archiveFolder, aliases: acct.aliases || [] };
    }
  }
  return { ...INTERNAL };
}

// Given free text (title + content), pick the best-matching vault folder path.
// Returns null when no account alias appears in the text or no folder matches.
export function matchVaultFolder(text, folders, accounts) {
  for (const acct of resolve(accounts)) {
    const aliases = acct.aliases || [];
    if (!aliases.some((a) => textHasAlias(text, a))) continue;
    const folder = (folders || []).find((fo) => {
      const fn = (fo.name || "").toLowerCase();
      if (acct.obsidianFolder && fn.includes(acct.obsidianFolder.toLowerCase())) return true;
      return aliases.some((a) => fn.includes(a.toLowerCase()));
    });
    if (folder) return folder.path;
  }
  return null;
}
