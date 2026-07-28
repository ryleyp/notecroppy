/* global Blob, URL, document, fetch, localStorage, navigator, sessionStorage, TextDecoder */

import {
  DEFAULT_ENDPOINT,
  activeReplacements,
  addTerm,
  anonymize,
  applyCorrections,
  buildFilename,
  buildPrompt,
  createStreamParser,
  detectTerms,
  nextAlias,
  parseCorrections,
  restore,
  textFromMessage,
  todayIso,
} from "./lib.js";

const STORAGE_KEY = "notecroppy:web:v1";
const API_KEY_KEY = "notecroppy:web:anthropic-key";
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

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

function corrections() {
  return parseCorrections(el("corrections").value);
}

function scanForTerms() {
  const source = applyCorrections(el("sourceText").value, corrections());
  const added = detectTerms(state.terms, source);

  renderTerms();
  persistDraft();

  if (!state.terms.length) {
    setStatus("No likely terms found.");
    return;
  }
  const plural = state.terms.length === 1 ? "" : "s";
  setStatus(
    added
      ? `Found ${added} new term${added === 1 ? "" : "s"} (${state.terms.length} total).`
      : `No new terms; ${state.terms.length} already tracked term${plural}.`,
  );
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
    enabled.setAttribute("aria-label", `Anonymize ${term.original}`);
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

function requestBody(prompt, stream) {
  return JSON.stringify({
    model: el("model").value,
    max_tokens: 5000,
    stream,
    system: "You write precise, source-grounded Obsidian Markdown notes. Respond with only Markdown.",
    messages: [{ role: "user", content: prompt }],
  });
}

async function callAnthropic(prompt, onDelta) {
  const apiKey = el("apiKey").value.trim();
  if (!apiKey) throw new Error("Add your Anthropic API key in Generation settings.");

  const streaming = typeof onDelta === "function";
  const response = await fetch(el("apiEndpoint").value.trim() || DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": "2023-06-01",
      "anthropic-dangerous-direct-browser-access": "true",
    },
    body: requestBody(prompt, streaming),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Claude request failed with HTTP ${response.status}`);
  }

  if (!streaming || !response.body) {
    return textFromMessage(await response.json());
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const push = createStreamParser();
  let markdown = "";

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const delta = push(decoder.decode(value, { stream: true }));
    if (!delta) continue;
    markdown += delta;
    onDelta(markdown);
  }

  return markdown.trim();
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
    const rules = corrections();
    const sanitizedSource = anonymize(applyCorrections(source, rules), state.terms);
    const prompt = buildPrompt({
      mode: state.mode,
      title: anonymize(el("sourceTitle").value.trim(), state.terms),
      date: el("sourceDate").value,
      context: anonymize(applyCorrections(el("sourceContext").value.trim(), rules), state.terms),
      source: sanitizedSource,
    });

    setStatus(
      state.terms.length
        ? `Streaming from Claude with ${activeReplacements(state.terms).length} term(s) anonymized...`
        : "Streaming from Claude...",
    );

    // Aliases are only reversed once the note is complete: a partial stream can
    // split an alias across chunks, so restoring mid-stream would corrupt it.
    const markdown = await callAnthropic(prompt, (partial) => {
      el("output").value = partial;
      el("preview").textContent = partial;
    });

    const finished = applyCorrections(restore(markdown, state.terms), rules);
    state.lastMarkdown = finished;
    el("output").value = finished;
    el("preview").textContent = finished;
    persistDraft();
    setStatus("Generated Markdown is ready.", "ok");
  } catch (error) {
    setStatus(error.message || "Generation failed.", "error");
  } finally {
    button.disabled = false;
    button.textContent = "Generate Note";
  }
}

async function loadFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;

  if (file.size > MAX_UPLOAD_BYTES) {
    setStatus("That file is larger than 5 MB. Paste the relevant part instead.", "error");
    return;
  }

  try {
    el("sourceText").value = await file.text();
    if (!el("sourceTitle").value.trim()) {
      el("sourceTitle").value = file.name.replace(/\.(txt|md|markdown|vtt|srt)$/i, "").replace(/[_-]+/g, " ").trim();
    }
    persistDraft();
    setStatus(`Loaded ${file.name}.`, "ok");
  } catch {
    setStatus("Could not read that file.", "error");
  }
}

async function copyOutput() {
  const output = el("output").value;
  if (!output) return;
  try {
    await navigator.clipboard.writeText(output);
    setStatus("Copied Markdown to clipboard.", "ok");
  } catch {
    setStatus("Clipboard blocked by the browser. Select the text and copy manually.", "error");
  }
}

function downloadOutput() {
  const output = el("output").value;
  if (!output) return;
  const blob = new Blob([output], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = buildFilename({
    title: el("sourceTitle").value,
    date: el("sourceDate").value,
    mode: state.mode,
  });
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
    button.setAttribute("aria-selected", String(button.dataset.mode === mode));
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

function updateTermFromEvent(event) {
  const row = event.target.closest(".term-card");
  if (!row || !event.target.dataset.field) return;
  const term = state.terms.find((item) => item.id === row.dataset.id);
  if (!term) return;

  const field = event.target.dataset.field;
  term[field] = field === "enabled" ? event.target.checked : event.target.value;
  if (field === "type") {
    term.alias = nextAlias(state.terms.filter((item) => item.id !== term.id), term.type);
    renderTerms();
  }
  persistDraft();
}

function wireEvents() {
  document.querySelectorAll(".segment").forEach((button) => {
    button.addEventListener("click", () => setMode(button.dataset.mode));
  });
  el("scanTerms").addEventListener("click", scanForTerms);
  el("addTerm").addEventListener("click", () => {
    addTerm(state.terms, el("manualTerm").value, el("manualType").value);
    el("manualTerm").value = "";
    renderTerms();
    persistDraft();
  });
  el("manualTerm").addEventListener("keydown", (event) => {
    if (event.key === "Enter") {
      event.preventDefault();
      el("addTerm").click();
    }
  });
  el("sourceFile").addEventListener("change", loadFile);
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

loadDraft();
wireEvents();
setMode(state.mode);
renderTerms();
