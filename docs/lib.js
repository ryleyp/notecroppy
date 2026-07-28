// Pure logic for the GitHub Pages web app.
//
// Kept free of DOM and network access so it can be loaded straight into the
// browser as an ES module (no build step) and unit-tested with vitest.

export const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";

const MONTHS = new Set([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
]);

const GENERIC_TERMS = new Set([
  "Action Items",
  "Customer Success",
  "Detailed Notes",
  "Executive Summary",
  "Follow Up",
  "Meeting Notes",
  "Next Steps",
]);

const COMMON_ACRONYMS = ["API", "CEO", "CSV", "JSON", "PDF", "QBR", "URL"];

const DETECTION_PATTERNS = [
  // Company names: capitalized words leading up to a company suffix. Every word
  // before the suffix must itself be capitalized so lowercase filler is not
  // swallowed — "Dana Fields from Acme Systems" yields "Acme Systems", not the
  // whole phrase.
  { type: "org", regex: /\b(?:[A-Z][A-Za-z0-9&.,'-]{0,20}\s){1,4}(?:Inc|LLC|Ltd|Corp|Corporation|Company|Systems|Technologies|University|Hospital|Labs?|Group|Division|Team)\b/g },
  { type: "org", regex: /\b[A-Z]{2,6}\b/g },
  { type: "person", regex: /\b(?:[A-Z][a-z]+|[A-Z]\.)\s+(?:[A-Z][a-z]+|[A-Z]\.)(?:\s+[A-Z][a-z]+)?\b/g },
  { type: "org", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
  { type: "org", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
];

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Match a term as a whole word where possible. Boundaries are only added on
// sides where the term edge is itself a word character, so "C++" still matches
// while "ORG_1" never matches inside "ORG_12".
export function termPattern(term) {
  const escaped = escapeRegExp(term);
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "gi");
}

// Replace via a function so `$&`, `$1` and friends in a replacement value are
// treated as literal text rather than regex substitution patterns.
function replaceAllLiteral(text, term, value) {
  return String(text ?? "").replace(termPattern(term), () => value);
}

export function parseCorrections(raw) {
  return String(raw || "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const parts = line.split("=>");
      if (parts.length < 2) return null;
      return {
        find: parts[0].trim(),
        replace: parts.slice(1).join("=>").trim(),
      };
    })
    .filter((rule) => rule && rule.find);
}

export function applyCorrections(text, corrections = []) {
  let next = text || "";
  for (const rule of corrections) {
    next = replaceAllLiteral(next, rule.find, rule.replace);
  }
  return next;
}

export function aliasPrefix(type) {
  return type === "person" ? "PERSON" : "ORG";
}

export function nextAlias(terms, type) {
  const prefix = aliasPrefix(type);
  const used = terms
    .filter((term) => String(term.alias || "").startsWith(`${prefix}_`))
    .map((term) => Number(String(term.alias).split("_")[1]))
    .filter(Number.isFinite);
  return `${prefix}_${Math.max(0, ...used) + 1}`;
}

function makeId() {
  const cryptoRef = globalThis.crypto;
  return cryptoRef?.randomUUID ? cryptoRef.randomUUID() : `${Date.now()}-${Math.random()}`;
}

// Appends to `terms` in place (and returns the added term, or null when the
// text is empty or already tracked).
export function addTerm(terms, text, type = "person") {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (!clean) return null;
  const exists = terms.some((term) => term.original.toLowerCase() === clean.toLowerCase());
  if (exists) return null;

  const term = {
    id: makeId(),
    enabled: true,
    original: clean,
    restored: clean,
    type,
    alias: nextAlias(terms, type),
  };
  terms.push(term);
  return term;
}

function isLikelyTerm(candidate, type) {
  if (candidate.length < 3) return false;
  if (GENERIC_TERMS.has(candidate)) return false;
  if (MONTHS.has(candidate.split(" ")[0])) return false;
  if (/^\d+$/.test(candidate)) return false;
  if (type === "org" && /^[A-Z]{2,6}$/.test(candidate) && COMMON_ACRONYMS.includes(candidate)) return false;
  return true;
}

// Scans text for names, orgs, emails and phone numbers worth anonymizing and
// adds each new hit to `terms`. Returns the number of terms added.
export function detectTerms(terms, text) {
  let added = 0;
  for (const pattern of DETECTION_PATTERNS) {
    for (const match of String(text || "").matchAll(pattern.regex)) {
      const candidate = match[0].trim();
      if (!isLikelyTerm(candidate, pattern.type)) continue;
      if (addTerm(terms, candidate, pattern.type)) added += 1;
    }
  }
  return added;
}

// Enabled terms, longest original first so "Acme Systems" is replaced before
// a bare "Acme" can chew up part of it.
export function activeReplacements(terms) {
  return terms
    .filter((term) => term.enabled && term.original && term.alias)
    .slice()
    .sort((a, b) => b.original.length - a.original.length);
}

export function anonymize(text, terms) {
  let next = text || "";
  for (const term of activeReplacements(terms)) {
    next = replaceAllLiteral(next, term.original, term.alias);
  }
  return next;
}

export function restore(text, terms) {
  let next = text || "";
  const byAliasLength = activeReplacements(terms).sort((a, b) => b.alias.length - a.alias.length);
  for (const term of byAliasLength) {
    next = replaceAllLiteral(next, term.alias, term.restored || term.original);
  }
  return next;
}

export function defaultTitle(mode) {
  return mode === "email" ? "Email Thread" : "Meeting Notes";
}

export function buildPrompt({ mode = "meeting", title, date, context, source } = {}) {
  const noteTitle = String(title || "").trim() || defaultTitle(mode);
  const noteDate = date || todayIso();
  const noteType = mode === "email" ? "Email Thread" : "Meeting";
  const kind = mode === "email" ? "email thread" : "meeting transcript";

  return `Create an Obsidian-ready Markdown note from the ${kind} below.

Rules:
- Use only the source content and user context.
- Preserve anonymization aliases exactly as written, such as PERSON_1 and ORG_1.
- Do not invent decisions, owners, dates, product names, or follow-up items.
- If information is missing, write "Not stated."
- Keep the note concise but complete enough to be useful later.

Metadata:
- Title: ${noteTitle}
- Date: ${noteDate}
- Type: ${noteType}

User context:
${String(context || "").trim() || "Not stated."}

Return this Markdown structure:

# ${noteTitle}

Date: ${noteDate}
Type: ${noteType}

## Summary

## Decisions

## Action Items

- [ ] [owner or Not stated] - [task] - [due date or Not stated]

## Customer / Stakeholder Notes

## Detailed Notes

## Follow-Up Questions

Source:
${source || ""}`;
}

export function buildFilename({ title, date, mode = "meeting" } = {}) {
  const rawTitle = String(title || "").trim() || defaultTitle(mode);
  const cleanTitle = rawTitle
    .replace(/[^a-z0-9]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "note";
  return `${date || todayIso()}-${cleanTitle}.md`;
}

export function textFromMessage(data) {
  return (data?.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

// Incremental SSE reader for the Messages API streaming format. Feed it raw
// chunks in order; it buffers partial events and returns the text deltas found
// in each chunk. Throws on an `error` event so callers surface API failures.
export function createStreamParser() {
  let buffer = "";

  return function push(chunk) {
    buffer += chunk || "";
    const events = buffer.split("\n\n");
    buffer = events.pop() ?? "";

    let text = "";
    for (const event of events) {
      for (const line of event.split("\n")) {
        if (!line.startsWith("data:")) continue;
        const payload = line.slice(5).trim();
        if (!payload || payload === "[DONE]") continue;

        let data;
        try {
          data = JSON.parse(payload);
        } catch {
          continue;
        }

        if (data.type === "error") {
          throw new Error(data.error?.message || "Claude stream failed.");
        }
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
          text += data.delta.text || "";
        }
      }
    }
    return text;
  };
}
