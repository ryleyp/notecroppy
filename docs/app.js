/* global Blob, URL, crypto, document, fetch, localStorage, navigator, sessionStorage */

const STORAGE_KEY = "notecroppy:web:v1";
const API_KEY_KEY = "notecroppy:web:anthropic-key";
const DEFAULT_ENDPOINT = "https://api.anthropic.com/v1/messages";
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

const state = {
  mode: "meeting",
  terms: [],
  lastMarkdown: "",
};

function el(id) {
  return document.getElementById(id);
}

function setStatus(message, type = "") {
  const node = el("status");
  node.textContent = message;
  node.className = `status ${type}`.trim();
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function termPattern(term) {
  const escaped = escapeRegExp(term);
  const left = /^\w/.test(term) ? "\\b" : "";
  const right = /\w$/.test(term) ? "\\b" : "";
  return new RegExp(`${left}${escaped}${right}`, "gi");
}

function parseCorrections() {
  return el("corrections").value
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

function applyCorrections(text, corrections) {
  let next = text || "";
  for (const rule of corrections) {
    next = next.replace(termPattern(rule.find), rule.replace);
  }
  return next;
}

function aliasPrefix(type) {
  return type === "person" ? "PERSON" : "ORG";
}

function nextAlias(type) {
  const prefix = aliasPrefix(type);
  const used = state.terms
    .filter((term) => term.alias.startsWith(`${prefix}_`))
    .map((term) => Number(term.alias.split("_")[1]))
    .filter(Number.isFinite);
  return `${prefix}_${Math.max(0, ...used) + 1}`;
}

function addTerm(text, type = "person") {
  const clean = String(text || "").trim().replace(/\s+/g, " ");
  if (!clean) return;
  const exists = state.terms.some((term) => term.original.toLowerCase() === clean.toLowerCase());
  if (exists) return;
  state.terms.push({
    id: crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`,
    enabled: true,
    original: clean,
    restored: clean,
    type,
    alias: nextAlias(type),
  });
}

function detectTerms() {
  const corrections = parseCorrections();
  const source = applyCorrections(el("sourceText").value, corrections);
  const patterns = [
    { type: "org", regex: /\b[A-Z0-9][A-Za-z0-9&.,' -]{2,42}\s(?:Inc|LLC|Ltd|Corp|Corporation|Company|Systems|Technologies|University|Hospital|Labs?|Group|Division|Team)\b/g },
    { type: "org", regex: /\b[A-Z]{2,6}\b/g },
    { type: "person", regex: /\b(?:[A-Z][a-z]+|[A-Z]\.)\s+(?:[A-Z][a-z]+|[A-Z]\.)(?:\s+[A-Z][a-z]+)?\b/g },
    { type: "org", regex: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi },
    { type: "org", regex: /\b(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]?\d{3}[-.\s]?\d{4}\b/g },
  ];

  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern.regex)) {
      const candidate = match[0].trim();
      if (candidate.length < 3 || GENERIC_TERMS.has(candidate) || MONTHS.has(candidate.split(" ")[0])) continue;
      if (/^\d+$/.test(candidate)) continue;
      if (pattern.type === "org" && /^[A-Z]{2,6}$/.test(candidate) && ["API", "CEO", "CSV", "JSON", "PDF", "QBR", "URL"].includes(candidate)) continue;
      addTerm(candidate, pattern.type);
    }
  }

  renderTerms();
  persistDraft();
  setStatus(state.terms.length ? `Found ${state.terms.length} anonymization term${state.terms.length === 1 ? "" : "s"}.` : "No likely terms found.");
}

function renderTerms() {
  const list = el("termsList");
  list.innerHTML = "";
  if (!state.terms.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "No terms yet.";
    list.appendChild(empty);
    return;
  }

  for (const term of state.terms) {
    const row = document.createElement("div");
    row.className = "term-card";
    row.dataset.id = term.id;

    const enabled = document.createElement("input");
    enabled.type = "checkbox";
    enabled.checked = term.enabled;
    enabled.dataset.field = "enabled";
    row.appendChild(enabled);

    const original = document.createElement("input");
    original.type = "text";
    original.value = term.original;
    original.dataset.field = "original";
    original.setAttribute("aria-label", "Original term");
    row.appendChild(original);

    const alias = document.createElement("input");
    alias.type = "text";
    alias.value = term.alias;
    alias.dataset.field = "alias";
    alias.setAttribute("aria-label", "Alias");
    row.appendChild(alias);

    const remove = document.createElement("button");
    remove.type = "button";
    remove.className = "remove-term";
    remove.textContent = "x";
    remove.setAttribute("aria-label", `Remove ${term.original}`);
    row.appendChild(remove);

    const restored = document.createElement("input");
    restored.type = "text";
    restored.value = term.restored;
    restored.dataset.field = "restored";
    restored.setAttribute("aria-label", "Restored value");
    row.appendChild(restored);

    const type = document.createElement("select");
    type.dataset.field = "type";
    type.setAttribute("aria-label", "Term type");
    type.innerHTML = '<option value="person">Person</option><option value="org">Organization</option>';
    type.value = term.type;
    row.appendChild(type);

    list.appendChild(row);
  }
}

function replacements() {
  return state.terms
    .filter((term) => term.enabled && term.original && term.alias)
    .slice()
    .sort((a, b) => b.original.length - a.original.length);
}

function anonymize(text) {
  let next = text;
  for (const term of replacements()) {
    next = next.replace(termPattern(term.original), term.alias);
  }
  return next;
}

function restore(text) {
  let next = text;
  for (const term of replacements().sort((a, b) => b.alias.length - a.alias.length)) {
    next = next.replace(termPattern(term.alias), term.restored || term.original);
  }
  return next;
}

function buildPrompt(sanitizedSource) {
  const title = anonymize(el("sourceTitle").value.trim()) || (state.mode === "email" ? "Email Thread" : "Meeting Notes");
  const date = el("sourceDate").value || todayIso();
  const context = anonymize(applyCorrections(el("sourceContext").value.trim(), parseCorrections()));
  const kind = state.mode === "email" ? "email thread" : "meeting transcript";

  return `Create an Obsidian-ready Markdown note from the ${kind} below.

Rules:
- Use only the source content and user context.
- Preserve anonymization aliases exactly as written, such as PERSON_1 and ORG_1.
- Do not invent decisions, owners, dates, product names, or follow-up items.
- If information is missing, write "Not stated."
- Keep the note concise but complete enough to be useful later.

Metadata:
- Title: ${title}
- Date: ${date}
- Type: ${state.mode === "email" ? "Email Thread" : "Meeting"}

User context:
${context || "Not stated."}

Return this Markdown structure:

# ${title}

Date: ${date}
Type: ${state.mode === "email" ? "Email Thread" : "Meeting"}

## Summary

## Decisions

## Action Items

- [ ] [owner or Not stated] - [task] - [due date or Not stated]

## Customer / Stakeholder Notes

## Detailed Notes

## Follow-Up Questions

Source:
${sanitizedSource}`;
}

async function callAnthropic(prompt) {
  const apiKey = el("apiKey").value.trim();
  if (!apiKey) throw new Error("Add your Anthropic API key in Generation settings.");

  const response = await fetch(el("apiEndpoint").value.trim() || DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: JSON.stringify({
      model: el("model").value,
      max_tokens: 5000,
      system: "You write precise, source-grounded Obsidian Markdown notes. Respond with only Markdown.",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Claude request failed with HTTP ${response.status}`);
  }

  const data = await response.json();
  return (data.content || [])
    .filter((block) => block.type === "text")
    .map((block) => block.text)
    .join("\n")
    .trim();
}

async function generate() {
  const source = el("sourceText").value.trim();
  if (!source) {
    setStatus("Paste a transcript or email thread first.", "error");
    return;
  }

  const button = el("generate");
  button.disabled = true;
  button.textContent = "Generating...";
  setStatus("Preparing anonymized request...");

  try {
    const corrections = parseCorrections();
    const corrected = applyCorrections(source, corrections);
    const sanitizedSource = anonymize(corrected);
    const markdown = await callAnthropic(buildPrompt(sanitizedSource));
    const restored = applyCorrections(restore(markdown), corrections);
    state.lastMarkdown = restored;
    el("output").value = restored;
    el("preview").textContent = restored;
    persistDraft();
    setStatus("Generated Markdown is ready.", "ok");
  } catch (error) {
    setStatus(error.message || "Generation failed.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Generate Note";
  }
}

function filename() {
  const rawTitle = el("sourceTitle").value.trim() || (state.mode === "email" ? "Email Thread" : "Meeting Notes");
  const cleanTitle = rawTitle.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").slice(0, 80) || "note";
  return `${el("sourceDate").value || todayIso()}-${cleanTitle}.md`;
}

async function copyOutput() {
  const output = el("output").value;
  if (!output) return;
  await navigator.clipboard.writeText(output);
  setStatus("Copied Markdown to clipboard.", "ok");
}

function downloadOutput() {
  const output = el("output").value;
  if (!output) return;
  const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename();
  link.click();
  URL.revokeObjectURL(url);
  setStatus("Downloaded Markdown file.", "ok");
}

function persistDraft() {
  const draft = {
    mode: state.mode,
    terms: state.terms,
    sourceTitle: el("sourceTitle").value,
    sourceDate: el("sourceDate").value,
    sourceContext: el("sourceContext").value,
    sourceText: el("sourceText").value,
    corrections: el("corrections").value,
    model: el("model").value,
    apiEndpoint: el("apiEndpoint").value,
    output: el("output").value,
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(draft));
  if (el("rememberKey").checked && el("apiKey").value) {
    sessionStorage.setItem(API_KEY_KEY, el("apiKey").value);
  } else {
    sessionStorage.removeItem(API_KEY_KEY);
  }
}

function loadDraft() {
  el("sourceDate").value = todayIso();
  el("apiEndpoint").value = DEFAULT_ENDPOINT;
  el("apiKey").value = sessionStorage.getItem(API_KEY_KEY) || "";
  el("rememberKey").checked = Boolean(el("apiKey").value);

  try {
    const draft = JSON.parse(localStorage.getItem(STORAGE_KEY) || "null");
    if (!draft) return;
    state.mode = draft.mode || "meeting";
    state.terms = Array.isArray(draft.terms) ? draft.terms : [];
    el("sourceTitle").value = draft.sourceTitle || "";
    el("sourceDate").value = draft.sourceDate || todayIso();
    el("sourceContext").value = draft.sourceContext || "";
    el("sourceText").value = draft.sourceText || "";
    el("corrections").value = draft.corrections || "";
    el("model").value = draft.model || "claude-haiku-4-5";
    el("apiEndpoint").value = draft.apiEndpoint || DEFAULT_ENDPOINT;
    el("output").value = draft.output || "";
    el("preview").textContent = draft.output || "";
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

function setMode(mode) {
  state.mode = mode;
  document.querySelectorAll(".segment").forEach((button) => {
    button.classList.toggle("is-active", button.dataset.mode === mode);
  });
  el("sourceTextLabel").textContent = mode === "email" ? "Email thread" : "Transcript";
  persistDraft();
}

function clearAll() {
  state.terms = [];
  state.lastMarkdown = "";
  ["sourceTitle", "sourceContext", "sourceText", "corrections", "output"].forEach((id) => {
    el(id).value = "";
  });
  el("sourceDate").value = todayIso();
  el("preview").textContent = "";
  renderTerms();
  persistDraft();
  setStatus("Cleared.");
}

function wireEvents() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  el("scanTerms").addEventListener("click", detectTerms);
  el("addTerm").addEventListener("click", () => {
    addTerm(el("manualTerm").value, el("manualType").value);
    el("manualTerm").value = "";
    renderTerms();
    persistDraft();
  });
  el("generate").addEventListener("click", generate);
  el("clearAll").addEventListener("click", clearAll);
  el("copyOutput").addEventListener("click", copyOutput);
  el("downloadOutput").addEventListener("click", downloadOutput);
  ["sourceTitle", "sourceDate", "sourceContext", "sourceText", "corrections", "model", "apiEndpoint", "apiKey", "rememberKey"].forEach((id) => {
    el(id).addEventListener("input", persistDraft);
    el(id).addEventListener("change", persistDraft);
  });
  el("output").addEventListener("input", () => {
    el("preview").textContent = el("output").value;
    persistDraft();
  });
  el("termsList").addEventListener("input", updateTermFromEvent);
  el("termsList").addEventListener("change", updateTermFromEvent);
  el("termsList").addEventListener("click", (event) => {
    if (!event.target.classList.contains("remove-term")) return;
    const id = event.target.closest(".term-card").dataset.id;
    state.terms = state.terms.filter((term) => term.id !== id);
    renderTerms();
    persistDraft();
  });
}

function updateTermFromEvent(event) {
  const row = event.target.closest(".term-card");
  if (!row || !event.target.dataset.field) return;
  const term = state.terms.find((item) => item.id === row.dataset.id);
  if (!term) return;
  const field = event.target.dataset.field;
  term[field] = field === "enabled" ? event.target.checked : event.target.value;
  if (field === "type") {
    term.alias = nextAlias(term.type);
    renderTerms();
  }
  persistDraft();
}

loadDraft();
wireEvents();
setMode(state.mode);
renderTerms();
