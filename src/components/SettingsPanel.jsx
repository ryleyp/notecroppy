"use client";

import { useState, useRef } from "react";
import { DEFAULT_ACCOUNTS } from "@/lib/accounts";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";
import ModelPicker from "@/components/ModelPicker";

const CONFIG_VERSION = 1;

// Turn a persisted account (array fields) back into a form row (text fields).
function accountToFormRow(a) {
  return {
    name: a.name || "",
    archiveFolder: a.archiveFolder || "",
    aliasesText: (a.aliases || []).join(", "),
    keywordsText: (a.keywords || []).join(", "),
    agreements: (a.agreements || []).map((g) => ({
      type: g.type === "EP" ? "EP" : "EA",
      number: g.number || "",
      keywordsText: (g.keywords || []).join(", "),
    })),
  };
}

export default function SettingsPanel({ settings, onSave, onClose }) {
  const [form, setForm] = useState({
    vaultPath: settings.vaultPath || "",
    transcriptsPath: settings.transcriptsPath || "",
    apiKey: settings.apiKey || "",
    aiPrivacyScan: settings.aiPrivacyScan !== false,
    ownerNamesText: (settings.ownerNames || []).join(", "),
    model: settings.model || "claude-haiku-4-5",
    replacements: settings.replacements || [],
    corrections: settings.corrections || [],
    // Edit aliases/keywords as comma-separated strings; split on save.
    accounts: (settings.accounts?.length ? settings.accounts : DEFAULT_ACCOUNTS).map(accountToFormRow),
  });
  const [newFind, setNewFind] = useState("");
  const [newReplace, setNewReplace] = useState("");
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);
  const [newOriginal, setNewOriginal] = useState("");
  const [newAlias, setNewAlias] = useState("");
  const [suggesting, setSuggesting] = useState(false);
  const [suggestions, setSuggestions] = useState(null); // { account: [{term,count}] }
  const [suggestError, setSuggestError] = useState(null);
  const [pickedTerms, setPickedTerms] = useState(new Set()); // "account||term"
  const [includeKeyInExport, setIncludeKeyInExport] = useState(false);
  const [importMsg, setImportMsg] = useState(null); // { ok, message }
  const importInputRef = useRef(null);

  function formAccounts() {
    return form.accounts
      .filter((a) => a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        archiveFolder: a.archiveFolder.trim(),
        aliases: a.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
        keywords: a.keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
      }));
  }

  async function handleSuggestKeywords() {
    if (!form.vaultPath.trim()) return;
    setSuggesting(true);
    setSuggestError(null);
    setSuggestions(null);
    setPickedTerms(new Set());
    try {
      const params = new URLSearchParams({
        vaultPath: form.vaultPath.trim(),
        accounts: JSON.stringify(formAccounts()),
      });
      if (form.transcriptsPath.trim()) params.set("transcriptsPath", form.transcriptsPath.trim());
      const res = await apiFetch(`/api/suggest-keywords?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setSuggestions(data.suggestions || {});
    } catch (e) {
      setSuggestError(e.message);
    } finally {
      setSuggesting(false);
    }
  }

  function togglePicked(account, term) {
    setPickedTerms((prev) => {
      const key = `${account}||${term}`;
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function addPickedKeywords() {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a) => {
        const terms = [...pickedTerms]
          .map((k) => k.split("||"))
          .filter(([acct]) => acct === a.name.trim())
          .map(([, term]) => term);
        if (!terms.length) return a;
        const existing = a.keywordsText.split(",").map((s) => s.trim()).filter(Boolean);
        const merged = [...existing, ...terms.filter((t) => !existing.some((e) => e.toLowerCase() === t.toLowerCase()))];
        return { ...a, keywordsText: merged.join(", ") };
      }),
    }));
    setPickedTerms(new Set());
    setSuggestions(null);
  }

  function handleChange(field, value) {
    setForm((f) => ({ ...f, [field]: value }));
    setTestResult(null);
  }

  async function handleTestVault() {
    if (!form.vaultPath.trim()) return;
    setTesting(true);
    setTestResult(null);
    try {
      await approveLocalPaths({
        vaultPath: form.vaultPath.trim(),
        transcriptsPath: form.transcriptsPath.trim(),
      });
      const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(form.vaultPath.trim())}`);
      const data = await res.json();
      if (res.ok) {
        setTestResult({ ok: true, message: `Found ${data.folders.length} folders in vault.` });
      } else {
        setTestResult({ ok: false, message: data.error });
      }
    } catch {
      setTestResult({ ok: false, message: "Could not connect to server." });
    } finally {
      setTesting(false);
    }
  }

  function addReplacement() {
    const orig = newOriginal.trim();
    const alias = newAlias.trim();
    if (!orig || !alias) return;
    if (form.replacements.some((r) => r.original.toLowerCase() === orig.toLowerCase())) return;
    setForm((f) => ({ ...f, replacements: [...f.replacements, { original: orig, alias }] }));
    setNewOriginal("");
    setNewAlias("");
  }

  function removeReplacement(i) {
    setForm((f) => ({ ...f, replacements: f.replacements.filter((_, idx) => idx !== i) }));
  }

  function addCorrection() {
    const find = newFind.trim();
    if (!find) return;
    setForm((f) => ({ ...f, corrections: [...f.corrections, { find, replace: newReplace }] }));
    setNewFind("");
    setNewReplace("");
  }

  function removeCorrection(i) {
    setForm((f) => ({ ...f, corrections: f.corrections.filter((_, idx) => idx !== i) }));
  }

  function updateAccount(i, field, value) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a, idx) => (idx === i ? { ...a, [field]: value } : a)),
    }));
  }

  function addAccount() {
    setForm((f) => ({ ...f, accounts: [...f.accounts, { name: "", archiveFolder: "", aliasesText: "", keywordsText: "", agreements: [] }] }));
  }

  function removeAccount(i) {
    setForm((f) => ({ ...f, accounts: f.accounts.filter((_, idx) => idx !== i) }));
  }

  function addAgreement(accountIdx) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a, idx) =>
        idx === accountIdx ? { ...a, agreements: [...(a.agreements || []), { type: "EA", number: "", keywordsText: "" }] } : a
      ),
    }));
  }

  function updateAgreement(accountIdx, agrIdx, field, value) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a, idx) =>
        idx === accountIdx
          ? { ...a, agreements: a.agreements.map((g, gi) => (gi === agrIdx ? { ...g, [field]: value } : g)) }
          : a
      ),
    }));
  }

  function removeAgreement(accountIdx, agrIdx) {
    setForm((f) => ({
      ...f,
      accounts: f.accounts.map((a, idx) =>
        idx === accountIdx ? { ...a, agreements: a.agreements.filter((_, gi) => gi !== agrIdx) } : a
      ),
    }));
  }

  // Convert the form's account rows (with comma-separated text fields) back
  // into the canonical persisted account shape.
  function serializeAccounts() {
    return form.accounts
      .filter((a) => a.name.trim())
      .map((a) => ({
        name: a.name.trim(),
        archiveFolder: a.archiveFolder.trim(),
        aliases: a.aliasesText.split(",").map((s) => s.trim()).filter(Boolean),
        keywords: a.keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
        agreements: (a.agreements || [])
          .filter((g) => g.number.trim())
          .map((g) => ({
            type: g.type === "EP" ? "EP" : "EA",
            number: g.number.trim(),
            keywords: g.keywordsText.split(",").map((s) => s.trim()).filter(Boolean),
          })),
      }));
  }

  function handleSave() {
    onSave({
      vaultPath: form.vaultPath.trim(),
      transcriptsPath: form.transcriptsPath.trim(),
      apiKey: form.apiKey.trim(),
      aiPrivacyScan: form.aiPrivacyScan,
      ownerNames: form.ownerNamesText.split(",").map((n) => n.trim()).filter(Boolean),
      model: form.model,
      replacements: form.replacements,
      corrections: form.corrections,
      ownerNames: form.ownerNamesText.split(",").map((n) => n.trim()).filter(Boolean),
      accounts: serializeAccounts(),
    });
  }

  // Download the current (in-form, unsaved-edits-included) config as JSON.
  // API key is excluded unless the user opts in — it's a credential and the
  // glossary already contains real names, so the file is sensitive either way.
  function handleExport() {
    const config = {
      _type: "notetaker-settings",
      version: CONFIG_VERSION,
      exportedAt: new Date().toISOString(),
      vaultPath: form.vaultPath.trim(),
      transcriptsPath: form.transcriptsPath.trim(),
      model: form.model,
      replacements: form.replacements,
      corrections: form.corrections,
      accounts: serializeAccounts(),
      ...(includeKeyInExport && form.apiKey.trim() ? { apiKey: form.apiKey.trim() } : {}),
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    const stamp = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `notetaker-settings-${stamp}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }

  function handleImportFile(file) {
    if (!file) return;
    setImportMsg(null);
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const cfg = JSON.parse(e.target.result);
        if (cfg._type && cfg._type !== "notetaker-settings") {
          throw new Error("This file isn't a Notetaker settings export.");
        }
        setForm((f) => ({
          ...f,
          vaultPath: typeof cfg.vaultPath === "string" ? cfg.vaultPath : f.vaultPath,
          transcriptsPath: typeof cfg.transcriptsPath === "string" ? cfg.transcriptsPath : f.transcriptsPath,
          model: cfg.model || f.model,
          apiKey: typeof cfg.apiKey === "string" && cfg.apiKey ? cfg.apiKey : f.apiKey,
          replacements: Array.isArray(cfg.replacements) ? cfg.replacements : f.replacements,
          corrections: Array.isArray(cfg.corrections) ? cfg.corrections : f.corrections,
          ownerNamesText: Array.isArray(cfg.ownerNames) ? cfg.ownerNames.join(", ") : f.ownerNamesText,
          accounts: Array.isArray(cfg.accounts) && cfg.accounts.length
            ? cfg.accounts.map(accountToFormRow)
            : f.accounts,
        }));
        const counts = [
          Array.isArray(cfg.accounts) ? `${cfg.accounts.length} accounts` : null,
          Array.isArray(cfg.replacements) ? `${cfg.replacements.length} replacements` : null,
          Array.isArray(cfg.corrections) ? `${cfg.corrections.length} corrections` : null,
        ].filter(Boolean).join(", ");
        setImportMsg({ ok: true, message: `Loaded ${counts || "config"}. Review, then click Save Settings to apply.` });
        setTestResult(null);
      } catch (err) {
        setImportMsg({ ok: false, message: `Could not import: ${err.message}` });
      }
    };
    reader.onerror = () => setImportMsg({ ok: false, message: "Could not read the file." });
    reader.readAsText(file);
  }

  return (
    <div className="card p-6 mb-6">
      <div className="flex items-center justify-between mb-5">
        <h2 className="section-header mb-0">Settings</h2>
        <button onClick={onClose} className="text-gray-400 hover:text-gray-600">
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>
      </div>

      <div className="space-y-5">
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div>
              <p className="text-sm font-medium text-gray-800">Backup &amp; transfer</p>
              <p className="text-xs text-gray-500">Export all settings (accounts, keywords, EA/EP numbers, glossary, corrections) to a file, or import one on another machine.</p>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              <button onClick={handleExport} className="btn-secondary text-xs whitespace-nowrap">Export config</button>
              <button onClick={() => importInputRef.current?.click()} className="btn-secondary text-xs whitespace-nowrap">Import config</button>
              <input
                ref={importInputRef}
                type="file"
                accept="application/json,.json"
                className="hidden"
                onChange={(e) => { handleImportFile(e.target.files[0]); e.target.value = ""; }}
              />
            </div>
          </div>
          <label className="flex items-center gap-1.5 text-xs text-gray-500 mt-2 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={includeKeyInExport}
              onChange={(e) => setIncludeKeyInExport(e.target.checked)}
              className="w-3.5 h-3.5 rounded accent-obsidian-600"
            />
            Include API key in export (the file also contains real names from your glossary — keep it private)
          </label>
          {importMsg && (
            <p className={`text-xs mt-2 ${importMsg.ok ? "text-green-600" : "text-red-600"}`}>
              {importMsg.ok ? "✓ " : "✗ "}{importMsg.message}
            </p>
          )}
        </div>

        <div>
          <label className="label">Obsidian Vault Path</label>
          <p className="text-xs text-gray-500 mb-2">
            The full path to your Obsidian vault folder on your machine. Example:{" "}
            <code className="bg-gray-100 px-1 rounded">/Users/yourname/Documents/MyVault</code>
          </p>
          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="/Users/yourname/Documents/MyVault"
              value={form.vaultPath}
              onChange={(e) => handleChange("vaultPath", e.target.value)}
            />
            <button
              className="btn-secondary whitespace-nowrap"
              onClick={handleTestVault}
              disabled={testing || !form.vaultPath.trim()}
            >
              {testing ? "Testing..." : "Test Path"}
            </button>
          </div>
          {testResult && (
            <p className={`mt-2 text-sm ${testResult.ok ? "text-green-600" : "text-red-600"}`}>
              {testResult.ok ? "✓ " : "✗ "}
              {testResult.message}
            </p>
          )}
        </div>

        <div>
          <label className="label">Transcripts Archive Path</label>
          <p className="text-xs text-gray-500 mb-2">
            Folder where raw transcripts are saved after each generation. Change this to move where transcripts go. Subfolders are created automatically per account using each account's “Archive folder” name below (unmatched meetings go to Internal Transcripts). This folder also holds the portable config/glossary files.
          </p>
          <input
            type="text"
            className="input"
            placeholder="/Users/yourname/Documents/Claude"
            value={form.transcriptsPath}
            onChange={(e) => handleChange("transcriptsPath", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Anthropic API Key</label>
          <p className="text-xs text-gray-500 mb-2">
            Your API key from{" "}
            <span className="font-medium">console.anthropic.com</span>. Stored only for this browser session.
            Alternatively, set <code className="bg-gray-100 px-1 rounded">ANTHROPIC_API_KEY</code> in{" "}
            <code className="bg-gray-100 px-1 rounded">.env.local</code>.
          </p>
          <input
            type="password"
            className="input"
            placeholder="sk-ant-..."
            value={form.apiKey}
            onChange={(e) => handleChange("apiKey", e.target.value)}
          />
        </div>

        <label className="flex items-start gap-3 rounded-lg border border-gray-200 bg-gray-50 p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded accent-obsidian-600"
            checked={form.aiPrivacyScan}
            onChange={(e) => handleChange("aiPrivacyScan", e.target.checked)}
          />
          <span>
            <span className="block text-sm font-medium text-gray-800">Use Claude to detect new sensitive terms</span>
            <span className="block text-xs text-gray-500 mt-0.5">
              Saved replacements are applied first. New, unsaved names may be sent to Claude during this scan; turn this off to use only your saved/manual replacements.
            </span>
          </span>
        </label>

        <div>
          <label className="label">Your names (for action-item matching)</label>
          <p className="text-xs text-gray-500 mb-2">
            Comma-separated. Action items and next steps naming you — or a Customer Success / CSM role — are collected into the weekly ToDos file. Leave blank to match on role terms only.
          </p>
          <input
            type="text"
            className="input"
            placeholder="e.g. Jordan, Jordy"
            value={form.ownerNamesText}
            onChange={(e) => handleChange("ownerNamesText", e.target.value)}
          />
        </div>

        <div>
          <label className="label">Default Model</label>
          <p className="text-xs text-gray-500 mb-2">
            Opus is the most capable; Sonnet balances quality and cost; Haiku is the cheapest and fastest.
          </p>
          <ModelPicker model={form.model} setModel={(id) => handleChange("model", id)} />
        </div>

        <div>
          <label className="label">Privacy Replacements</label>
          <p className="text-xs text-gray-500 mb-3">
            These terms are always anonymized before sending transcripts to Claude. You can also add terms during the per-transcript review.
          </p>

          {form.replacements.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {form.replacements.map((r, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1">{r.original}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-mono text-xs text-obsidian-700 bg-obsidian-50 px-1.5 py-0.5 rounded">{r.alias}</span>
                  <button
                    onClick={() => removeReplacement(i)}
                    className="text-gray-400 hover:text-red-500 ml-1"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="Original (e.g. Acme)"
              value={newOriginal}
              onChange={(e) => setNewOriginal(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReplacement()}
            />
            <input
              type="text"
              className="input w-36"
              placeholder="Alias (e.g. ORG_A)"
              value={newAlias}
              onChange={(e) => setNewAlias(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addReplacement()}
            />
            <button
              onClick={addReplacement}
              disabled={!newOriginal.trim() || !newAlias.trim()}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="label">Common Corrections</label>
          <p className="text-xs text-gray-500 mb-3">
            Automatically fix recurring transcription errors before generating or saving (e.g. voice memo mishears "in" as "NI").
          </p>

          {form.corrections.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {form.corrections.map((c, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1">{c.find}</span>
                  <span className="text-gray-400">→</span>
                  <span className="font-medium text-gray-800 flex-1">{c.replace || <em className="text-gray-400">(delete)</em>}</span>
                  <button onClick={() => removeCorrection(i)} className="text-gray-400 hover:text-red-500 ml-1">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-2">
            <input
              type="text"
              className="input flex-1"
              placeholder="Find (e.g. in NI)"
              value={newFind}
              onChange={(e) => setNewFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCorrection()}
            />
            <input
              type="text"
              className="input flex-1"
              placeholder="Replace with (e.g. NI)"
              value={newReplace}
              onChange={(e) => setNewReplace(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCorrection()}
            />
            <button
              onClick={addCorrection}
              disabled={!newFind.trim()}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>

        <div>
          <label className="label">Accounts</label>
          <p className="text-xs text-gray-500 mb-3">
            Each account maps name aliases to a transcript archive subfolder. Aliases drive
            cross-folder search and auto-filing of vault-root notes. Keywords are account-specific
            terms (e.g. program names, product lines) that will be excluded from other accounts'
            summaries. EA / EP numbers let you tie each Enterprise Agreement or Purchase to the
            keywords that identify it, so the right number can be surfaced when those terms come up.
          </p>

          <div className="space-y-3">
            {form.accounts.map((a, i) => (
              <div key={i} className="rounded-lg border border-gray-200 bg-gray-50 p-3 space-y-2">
                <div className="flex gap-2">
                  <input
                    type="text"
                    className="input flex-1"
                    placeholder="Account name (e.g. Acme Aerospace)"
                    value={a.name}
                    onChange={(e) => updateAccount(i, "name", e.target.value)}
                  />
                  <button
                    onClick={() => removeAccount(i)}
                    className="text-gray-400 hover:text-red-500 flex-shrink-0"
                    title="Remove account"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <input
                  type="text"
                  className="input"
                  placeholder="Archive folder (e.g. Acme Transcripts)"
                  value={a.archiveFolder}
                  onChange={(e) => updateAccount(i, "archiveFolder", e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Aliases, comma-separated (e.g. acme, aac)"
                  value={a.aliasesText}
                  onChange={(e) => updateAccount(i, "aliasesText", e.target.value)}
                />
                <input
                  type="text"
                  className="input"
                  placeholder="Keywords to exclude from other accounts (e.g. F-35, skunk works)"
                  value={a.keywordsText}
                  onChange={(e) => updateAccount(i, "keywordsText", e.target.value)}
                />

                {/* EA / EP agreement numbers, each tied to identifying keywords */}
                <div className="pt-2 mt-1 border-t border-gray-200">
                  <p className="text-xs font-medium text-gray-600 mb-1.5">EA / EP Numbers</p>
                  {(a.agreements || []).length > 0 && (
                    <div className="space-y-2 mb-2">
                      {a.agreements.map((g, gi) => (
                        <div key={gi} className="flex gap-2 items-start">
                          <select
                            value={g.type}
                            onChange={(e) => updateAgreement(i, gi, "type", e.target.value)}
                            className="input !w-16 flex-shrink-0"
                            title="Agreement type"
                          >
                            <option value="EA">EA</option>
                            <option value="EP">EP</option>
                          </select>
                          <input
                            type="text"
                            className="input w-32 flex-shrink-0"
                            placeholder="Number"
                            value={g.number}
                            onChange={(e) => updateAgreement(i, gi, "number", e.target.value)}
                          />
                          <input
                            type="text"
                            className="input flex-1"
                            placeholder="Keywords to look for, comma-separated"
                            value={g.keywordsText}
                            onChange={(e) => updateAgreement(i, gi, "keywordsText", e.target.value)}
                          />
                          <button
                            onClick={() => removeAgreement(i, gi)}
                            className="text-gray-400 hover:text-red-500 flex-shrink-0 mt-2"
                            title="Remove this number"
                          >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  <button
                    onClick={() => addAgreement(i)}
                    className="text-xs text-obsidian-600 hover:text-obsidian-700 font-medium"
                  >
                    + Add EA / EP number
                  </button>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-2 mt-3">
            <button onClick={addAccount} className="btn-secondary">
              + Add account
            </button>
            <button
              onClick={handleSuggestKeywords}
              disabled={suggesting || !form.vaultPath.trim()}
              className="btn-secondary"
              title="Scan each account's folders for distinctive terms (sites, programs, contacts) to add as keywords"
            >
              {suggesting ? "Scanning notes…" : "🔍 Suggest keywords from my notes"}
            </button>
          </div>
          {suggestError && <p className="mt-2 text-sm text-red-600">{suggestError}</p>}

          {suggestions && (
            <div className="mt-3 rounded-lg border border-obsidian-200 bg-obsidian-50 p-3 space-y-3">
              <p className="text-xs text-gray-700">
                Terms that appear often in one account's notes and rarely elsewhere. Check the ones that
                are genuinely account-specific (sites, programs, people), then add them as keywords —
                they'll be scrubbed and redacted from every other account's reports.
              </p>
              {Object.entries(suggestions).every(([, terms]) => !terms.length) && (
                <p className="text-xs text-gray-500">No distinctive terms found — folders may be empty or terms already covered.</p>
              )}
              {Object.entries(suggestions).map(([account, terms]) =>
                terms.length ? (
                  <div key={account}>
                    <p className="text-xs font-semibold text-gray-800 mb-1">{account}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {terms.map(({ term, count }) => {
                        const picked = pickedTerms.has(`${account}||${term}`);
                        return (
                          <button
                            key={term}
                            type="button"
                            onClick={() => togglePicked(account, term)}
                            className={`px-2 py-0.5 rounded-full text-xs border transition-colors ${
                              picked
                                ? "bg-obsidian-600 text-white border-obsidian-600"
                                : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                            }`}
                            title={`${count} occurrences`}
                          >
                            {picked ? "✓ " : ""}{term} <span className={picked ? "text-obsidian-200" : "text-gray-400"}>×{count}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : null
              )}
              <div className="flex gap-2">
                <button onClick={addPickedKeywords} disabled={!pickedTerms.size} className="btn-primary text-xs px-3 py-1.5">
                  Add {pickedTerms.size || ""} selected as keywords
                </button>
                <button onClick={() => { setSuggestions(null); setPickedTerms(new Set()); }} className="btn-secondary text-xs px-3 py-1.5">
                  Dismiss
                </button>
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 pt-2 border-t border-gray-100">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={handleSave}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}
