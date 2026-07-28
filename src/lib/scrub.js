function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function lineContainsKeyword(line, keywords) {
  return keywords.some((kw) => {
    const k = (kw || "").trim();
    if (!k) return false;
    const esc = escapeRegex(k);
    const left = /^\w/.test(k) ? "\\b" : "";
    const right = /\w$/.test(k) ? "\\b" : "";
    return new RegExp(`${left}${esc}${right}`, "i").test(line);
  });
}

// Every term tied to another account: its name, aliases, AND keywords.
// Scrubbing only keywords let lines like "Beacon asked about X" bleed into
// other accounts' reports. Internal reports legitimately span accounts, so
// nothing is scrubbed there.
export function getForbiddenKeywords(accountName, allAccounts) {
  if (!accountName || accountName === "Internal") return [];
  const own = new Set(
    (allAccounts || [])
      .filter((a) => a.name === accountName)
      .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
      .filter(Boolean)
      .map((t) => t.toLowerCase())
  );
  return (allAccounts || [])
    .filter((a) => a.name !== accountName && a.name !== "Internal")
    .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
    .filter(Boolean)
    // Never scrub a term the current account also claims (alias collisions).
    .filter((t) => !own.has(t.toLowerCase()));
}

// Replace every occurrence of another account's name/alias/keyword in text.
// Used on note titles before sending, and on generated output as a hard
// backstop — a report about one account must never show another's terms.
export function redactForbiddenTerms(text, accountName, allAccounts, replacement = "█████") {
  const forbidden = getForbiddenKeywords(accountName, allAccounts);
  let out = text || "";
  let count = 0;
  for (const kw of forbidden) {
    const k = (kw || "").trim();
    if (!k) continue;
    const esc = escapeRegex(k);
    const left = /^\w/.test(k) ? "\\b" : "";
    const right = /\w$/.test(k) ? "\\b" : "";
    out = out.replace(new RegExp(`${left}${esc}${right}`, "gi"), () => {
      count++;
      return replacement;
    });
  }
  return { text: out, count };
}

// Scan generated output for terms tied to other accounts. Returns the unique
// offending terms grouped by account, for a post-generation warning.
export function findAccountBleed(text, accountName, allAccounts) {
  if (!text || !accountName || accountName === "Internal") return [];
  const own = new Set(
    (allAccounts || [])
      .filter((a) => a.name === accountName)
      .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
      .filter(Boolean)
      .map((t) => t.toLowerCase())
  );
  const hits = [];
  for (const a of allAccounts || []) {
    if (a.name === accountName || a.name === "Internal") continue;
    const terms = [a.name, ...(a.aliases || []), ...(a.keywords || [])]
      .filter(Boolean)
      .filter((t) => !own.has(t.toLowerCase()))
      .filter((t) => lineContainsKeyword(text, [t]));
    if (terms.length) hits.push({ account: a.name, terms });
  }
  return hits;
}

// Terms belonging to the current account (used to decide whether a block of
// text is anchored to the current account or orphaned).
function getOwnTerms(accountName, allAccounts) {
  return (allAccounts || [])
    .filter((a) => a.name === accountName)
    .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
    .filter(Boolean);
}

// Total whole-word occurrences of any of `terms` in `text`.
export function countTermHits(text, terms) {
  let count = 0;
  for (const t of terms || []) {
    const k = (t || "").trim();
    if (!k) continue;
    const esc = escapeRegex(k);
    const left = /^\w/.test(k) ? "\\b" : "";
    const right = /\w$/.test(k) ? "\\b" : "";
    const m = (text || "").match(new RegExp(`${left}${esc}${right}`, "gi"));
    if (m) count += m.length;
  }
  return count;
}

// Is this note mostly about a different account? Compares whole-note term
// hits for the current account vs every other account. Returns the dominant
// other account's name when its terms clearly outnumber the current
// account's, so the UI can default-exclude the note from the report.
export function assessNoteDominance(note, accountName, allAccounts) {
  if (!accountName || accountName === "Internal") return null;
  const text = `${note.title || ""}\n${note.content || ""}`;
  const ownHits = countTermHits(
    text,
    (allAccounts || [])
      .filter((a) => a.name === accountName)
      .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])])
  );
  let dominant = null;
  for (const a of allAccounts || []) {
    if (a.name === accountName || a.name === "Internal") continue;
    const hits = countTermHits(text, [a.name, ...(a.aliases || []), ...(a.keywords || [])]);
    if (hits >= 2 && hits > ownHits && (!dominant || hits > dominant.hits)) {
      dominant = { account: a.name, hits, ownHits };
    }
  }
  return dominant;
}

// Inside anchored transcript-like blocks (no blank lines / headings for
// structure), removing only the literal naming line leaves the surrounding
// conversation context. For large blocks, also drop the lines around each
// forbidden hit unless they explicitly mention the current account.
const RADIUS_MIN_BLOCK = 8;
const SCRUB_RADIUS = 2;

// Context-aware scrub: which line indexes of `content` should be removed.
// Removing only the line that names another account leaves orphaned context
// (site names, action items...) that the model then misattributes to the
// current account. So:
//  - a Markdown heading naming another account takes its whole section
//  - a paragraph (blank-line-delimited block) naming another account is
//    dropped entirely UNLESS it also names the current account, in which
//    case only the offending lines are dropped
export function computeScrubbedLineIndexes(content, accountName, allAccounts) {
  const forbidden = getForbiddenKeywords(accountName, allAccounts);
  const flagged = new Set();
  if (!forbidden.length) return flagged;
  const own = getOwnTerms(accountName, allAccounts);
  const lines = (content || "").split("\n");
  const isHeading = (l) => /^#{1,6}\s/.test(l.trim());

  // Section rule: heading mentions another account → flag until next heading.
  let i = 0;
  while (i < lines.length) {
    if (isHeading(lines[i]) && lineContainsKeyword(lines[i], forbidden)) {
      flagged.add(i);
      let j = i + 1;
      while (j < lines.length && !isHeading(lines[j])) {
        if (lines[j].trim()) flagged.add(j);
        j++;
      }
      i = j;
    } else {
      i++;
    }
  }

  // Paragraph rule: blank-line-delimited blocks.
  let start = null;
  for (let k = 0; k <= lines.length; k++) {
    const blank = k === lines.length || !lines[k].trim();
    if (!blank && start === null) start = k;
    if (blank && start !== null) {
      const block = lines.slice(start, k);
      if (block.some((l) => lineContainsKeyword(l, forbidden))) {
        const anchored = own.length > 0 && block.some((l) => lineContainsKeyword(l, own));
        for (let x = start; x < k; x++) {
          if (!lines[x].trim()) continue;
          if (!anchored || lineContainsKeyword(lines[x], forbidden)) flagged.add(x);
        }
        // Radius rule for large anchored blocks (transcripts): the lines
        // around a forbidden mention are that account's context too.
        if (anchored && block.length >= RADIUS_MIN_BLOCK) {
          for (let x = start; x < k; x++) {
            if (!lineContainsKeyword(lines[x], forbidden)) continue;
            for (let r = Math.max(start, x - SCRUB_RADIUS); r <= Math.min(k - 1, x + SCRUB_RADIUS); r++) {
              if (!lines[r].trim()) continue;
              if (lineContainsKeyword(lines[r], own)) continue;
              flagged.add(r);
            }
          }
        }
      }
      start = null;
    }
  }

  return flagged;
}

// Returns list of lines that would be scrubbed, with stable IDs.
export function buildScrubReport(notes, accountName, allAccounts) {
  const report = [];
  for (const note of notes) {
    const lines = (note.content || "").split("\n");
    const flagged = computeScrubbedLineIndexes(note.content || "", accountName, allAccounts);
    for (const idx of [...flagged].sort((a, b) => a - b)) {
      report.push({
        id: `${note.filename}__${idx}`,
        noteFilename: note.filename,
        noteTitle: note.title,
        noteDate: note.date,
        line: lines[idx],
      });
    }
  }
  return report;
}

// Scrub forbidden keywords from notes, preserving lines whose IDs are restored.
// Note titles are redacted (not droppable) — they reach the prompt as source
// headings, so another account's name in a title would bleed straight through.
export function scrubWithExceptions(notes, accountName, allAccounts, restoredIds = []) {
  const forbidden = getForbiddenKeywords(accountName, allAccounts);
  if (!forbidden.length) return notes;
  const restored = new Set(restoredIds);
  return notes.map((note) => {
    const flagged = computeScrubbedLineIndexes(note.content || "", accountName, allAccounts);
    return {
      ...note,
      title: redactForbiddenTerms(note.title || "", accountName, allAccounts).text,
      content: (note.content || "")
        .split("\n")
        .filter((line, idx) => {
          if (restored.has(`${note.filename}__${idx}`)) return true;
          return !flagged.has(idx);
        })
        .join("\n"),
    };
  });
}
