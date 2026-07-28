export const CONTACT_INDEX_DIR = ".notetaker";
export const CONTACT_INDEX_FILE = "contact-map-index.json";

export const MAPPING_SECTIONS = [
  "Source Coverage",
  "Customer Stakeholders",
  "NI / Internal Contacts Mentioned",
  "Site / Lab / Location Map",
  "Stakeholder-Site Cross References",
  "Planning Gaps",
];

function cleanString(value) {
  return String(value || "").trim();
}

function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function accountIndexKey(accountName, folderPath = "") {
  return `${cleanString(accountName) || "Selected Account"}|${cleanString(folderPath)}`.toLowerCase();
}

export function sourceKey(note) {
  return [
    note?.source || "obsidian",
    note?.sourceLabel || "",
    note?.relativePath || note?.filename || note?.title || "",
  ].join("::");
}

export function noteFingerprint(note) {
  const text = [
    cleanString(note?.title),
    cleanString(note?.date),
    cleanString(note?.content),
    String(note?.mtimeMs || ""),
    String(note?.size || ""),
  ].join("\n");

  return hashText(text);
}

export function stableSourceId(note) {
  return `S_${hashText(sourceKey(note)).toUpperCase()}`;
}

function parseJsonPayload(rawText) {
  const text = cleanString(rawText);
  if (!text) return [];
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1] : text;
  const match = candidate.match(/\{[\s\S]*\}|\[[\s\S]*\]/);
  const parsed = JSON.parse(match ? match[0] : candidate);
  return Array.isArray(parsed) ? parsed : parsed.facts || [];
}

export function normalizeFact(fact, source = {}) {
  const type = ["person", "site", "org", "relationship"].includes(fact?.type) ? fact.type : "person";
  const name = cleanString(fact?.name || fact?.person || fact?.site || fact?.organization);
  const evidence = cleanString(fact?.evidence || fact?.context || fact?.detail || fact?.snippet);
  if (!name || !evidence) return null;

  return {
    id: cleanString(fact?.id) || `${type}:${name.toLowerCase()}:${cleanString(source.sourceId || source.id)}`,
    type,
    name,
    aliases: Array.isArray(fact?.aliases) ? fact.aliases.map(cleanString).filter(Boolean) : [],
    role: cleanString(fact?.role || fact?.title),
    organization: cleanString(fact?.organization || fact?.team),
    site: cleanString(fact?.site || fact?.location),
    relationship: cleanString(fact?.relationship || fact?.influence),
    evidence,
    confidence: cleanString(fact?.confidence || "medium"),
    sourceId: cleanString(fact?.sourceId || source.sourceId || source.id),
    sourceDate: cleanString(fact?.sourceDate || source.date),
    sourceTitle: cleanString(fact?.sourceTitle || source.title),
    sourceLabel: cleanString(fact?.sourceLabel || source.sourceLabel),
  };
}

export function parseContactFacts(rawText, sourcesById = {}, options = {}) {
  let parsed = [];
  try {
    parsed = parseJsonPayload(rawText);
  } catch (error) {
    if (options.throwOnInvalid) throw error;
    return [];
  }
  return parsed
    .map((fact) => normalizeFact(fact, sourcesById[cleanString(fact?.sourceId)] || {}))
    .filter(Boolean);
}

export function mergeFacts(facts = []) {
  const byKey = new Map();
  for (const fact of facts) {
    const normalized = normalizeFact(fact);
    if (!normalized) continue;
    const key = [
      normalized.type,
      normalized.name.toLowerCase(),
      normalized.sourceId || normalized.sourceDate,
      normalized.evidence.toLowerCase(),
    ].join("|");
    if (!byKey.has(key)) byKey.set(key, normalized);
  }
  return [...byKey.values()];
}

export function factsToMarkdown(facts = []) {
  return mergeFacts(facts)
    .map((fact) => {
      const source = [
        fact.sourceDate || "undated",
        fact.sourceTitle,
        fact.sourceLabel ? `(${fact.sourceLabel})` : "",
      ].filter(Boolean).join(" ");
      const details = [
        fact.role && `role=${fact.role}`,
        fact.organization && `org/team=${fact.organization}`,
        fact.site && `site=${fact.site}`,
        fact.relationship && `relationship=${fact.relationship}`,
        fact.aliases?.length ? `aliases=${fact.aliases.join(", ")}` : "",
        fact.confidence && `confidence=${fact.confidence}`,
      ].filter(Boolean).join("; ");

      return `- **${fact.type}: ${fact.name}**${details ? ` (${details})` : ""}\n  - Source: ${source || fact.sourceId || "unknown source"}\n  - Evidence: ${fact.evidence}`;
    })
    .join("\n");
}

export function sourceSummariesFromFacts(facts = []) {
  const bySource = new Map();
  for (const fact of facts) {
    const key = fact.sourceId || `${fact.sourceDate}|${fact.sourceTitle}|${fact.sourceLabel}`;
    if (!key || bySource.has(key)) continue;
    bySource.set(key, {
      id: fact.sourceId,
      date: fact.sourceDate,
      title: fact.sourceTitle,
      sourceLabel: fact.sourceLabel,
    });
  }
  return [...bySource.values()];
}

export function inferNextMappingSection(markdown = "") {
  const text = cleanString(markdown);
  if (!text) return MAPPING_SECTIONS[0];

  let lastIndex = -1;
  for (let i = 0; i < MAPPING_SECTIONS.length; i++) {
    if (text.includes(`## ${MAPPING_SECTIONS[i]}`)) lastIndex = i;
  }

  if (lastIndex < 0) return MAPPING_SECTIONS[0];
  const lastSection = MAPPING_SECTIONS[lastIndex];
  const afterHeading = text.split(`## ${lastSection}`).pop() || "";
  if (afterHeading.trim().length < 200) return lastSection;
  return MAPPING_SECTIONS[Math.min(lastIndex + 1, MAPPING_SECTIONS.length - 1)];
}

export function verifyStakeholderMapDocument(markdown, facts = [], accountName, allAccounts = []) {
  const text = cleanString(markdown);
  const findings = [];

  for (const section of MAPPING_SECTIONS) {
    if (!text.includes(`## ${section}`)) {
      findings.push({ severity: "warning", message: `Missing section: ${section}` });
    }
  }

  if (/\b(?:PERSON|ORG)_\d+\b/.test(text)) {
    findings.push({ severity: "error", message: "Unrestored anonymization placeholder is still visible." });
  }

  const others = (allAccounts || [])
    .filter((account) => account?.name && account.name !== accountName && account.name !== "Internal")
    .flatMap((account) => [account.name, ...(account.keywords || [])])
    .filter(Boolean);
  for (const term of others) {
    const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`\\b${escaped}\\b`, "i").test(text)) {
      findings.push({ severity: "error", message: `Potential other-account term present: ${term}` });
    }
  }

  const mappedBlocks = text.split(/\n(?=- \*\*)/g).filter((block) => /^- \*\*/.test(block.trim()));
  for (const block of mappedBlocks) {
    if (!/Mentioned in:/i.test(block) && !/Source:/i.test(block)) {
      const label = block.match(/^- \*\*([^*]+)\*\*/)?.[1] || "Mapped item";
      findings.push({ severity: "warning", message: `${label} may be missing source attribution.` });
    }
  }

  if (facts.length > 0) {
    const citedFacts = facts.filter((fact) => {
      const title = cleanString(fact.sourceTitle);
      const date = cleanString(fact.sourceDate);
      return (title && text.includes(title)) || (date && text.includes(date));
    }).length;
    if (citedFacts === 0) {
      findings.push({ severity: "warning", message: "No extracted fact sources appear to be cited in the map." });
    }
  }

  return findings;
}
