"use client";

import { useRef, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { calcCost, contextLimit, estimateUsage } from "@/lib/models";
import { detectAccount } from "@/lib/accounts";
import { aliasesFromReplacements } from "@/lib/privacy";
import {
  applyCorrections,
  applyReplacements,
  assignAliases,
  mergeCorrections,
  reverseReplacements,
} from "@/lib/sanitize";
import { inferNextMappingSection } from "@/lib/contactMapping";
import { apiFetch } from "@/lib/apiClient";

const TODAY = new Date().toISOString().split("T")[0];
const SOURCE_RANGES = [
  { id: "recent", label: "Last 3 months" },
  { id: "all", label: "All history" },
];

// Stakeholder maps run longer than the default note summary.
const ESTIMATED_OUTPUT_TOKENS = 4000;
const SCAN_SOURCE_CHAR_LIMIT = 4500;
const SCAN_TOTAL_CHAR_LIMIT = 120000;

function threeMonthsAgoLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function dedupeEntities(entities) {
  const seen = new Set();
  const out = [];
  for (const entity of entities || []) {
    const text = String(entity?.text || "").trim();
    if (!text) continue;
    const key = text.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ text, type: entity.type === "person" ? "person" : "org" });
  }
  return out;
}

function typeFromAlias(alias) {
  return String(alias || "").toUpperCase().startsWith("PERSON_") ? "person" : "org";
}

function includesTerm(text, term) {
  return term && text.toLowerCase().includes(term.toLowerCase());
}

function savedReplacementsInSources(notes, replacements) {
  const sourceText = (notes || []).map((n) => `${n.title || ""}\n${n.content || ""}`).join("\n").toLowerCase();
  return (replacements || [])
    .filter((r) => includesTerm(sourceText, r.original || "") || includesTerm(sourceText, r.restored || ""))
    .map((r) => ({
      text: r.original,
      type: typeFromAlias(r.alias),
      alias: r.alias,
      restored: r.restored || r.original,
      context: "",
      enabled: true,
      saved: true,
    }));
}

function buildMappingScanText(notes, corrections, replacements) {
  let total = 0;
  const chunks = [];
  const clean = (text) => applyReplacements(applyCorrections(text || "", corrections), replacements);

  for (const note of notes || []) {
    if (total >= SCAN_TOTAL_CHAR_LIMIT) break;
    const header = `### ${note.date || "undated"} - ${clean(note.title || note.filename || "Untitled")}`;
    const body = clean(note.content || "").slice(0, SCAN_SOURCE_CHAR_LIMIT);
    const chunk = `${header}\n${body}`;
    chunks.push(chunk);
    total += chunk.length;
  }

  return chunks.join("\n\n---\n\n").slice(0, SCAN_TOTAL_CHAR_LIMIT);
}

export default function StakeholderMap({ settings, onSettingsClick, onSettingsPatch }) {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [loadedSources, setLoadedSources] = useState(null);
  const [loadCounts, setLoadCounts] = useState(null);
  const [loadWarning, setLoadWarning] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [strictFolderOnly, setStrictFolderOnly] = useState(false);
  const [sourceRange, setSourceRange] = useState("recent");
  const [privacyScanning, setPrivacyScanning] = useState(false);
  const [privacyScanError, setPrivacyScanError] = useState(null);
  const [mappingReviewItems, setMappingReviewItems] = useState(null);
  const [extractingFacts, setExtractingFacts] = useState(false);
  const [factError, setFactError] = useState(null);
  const [mappingFacts, setMappingFacts] = useState(null);
  const [factStats, setFactStats] = useState(null);
  const [changedOnly, setChangedOnly] = useState(false);
  const [forceExtract, setForceExtract] = useState(false);

  const [mapping, setMapping] = useState(false);
  const [mapError, setMapError] = useState(null);
  const [mapPartial, setMapPartial] = useState(false);
  const [output, setOutput] = useState("");
  const [verifyingMap, setVerifyingMap] = useState(false);
  const [verifyFindings, setVerifyFindings] = useState(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [mapCost, setMapCost] = useState(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const mapControllerRef = useRef(null);
  const [lastMapRequest, setLastMapRequest] = useState(null);
  const [model, setModel] = useState(settings.model || "claude-haiku-4-5");
  const [newFind, setNewFind] = useState("");
  const [newReplace, setNewReplace] = useState("");

  const corrections = settings.corrections || [];

  function updateCorrections(nextCorrections) {
    if (!onSettingsPatch) return;
    onSettingsPatch({ corrections: nextCorrections });
    setLastMapRequest((request) => request ? { ...request, corrections: nextCorrections } : request);
  }

  function handleAddCorrection() {
    const find = newFind.trim();
    if (!find) return;
    const addition = { find, replace: newReplace };
    const nextCorrections = mergeCorrections(corrections, [addition]);
    updateCorrections(nextCorrections);
    setNewFind("");
    setNewReplace("");
    if (output) {
      setOutput((current) => applyCorrections(current, [addition]));
      setSaved(false);
      setSavedPath("");
    }
  }

  function handleRemoveCorrection(index) {
    updateCorrections(corrections.filter((_, i) => i !== index));
  }

  function handleStrictFolderOnlyChange(checked) {
    setStrictFolderOnly(checked);
    clearLoadedMappingSources();
  }

  function handleSourceRangeChange(nextRange) {
    if (nextRange === sourceRange) return;
    setSourceRange(nextRange);
    clearLoadedMappingSources();
  }

  function clearLoadedMappingSources() {
    setLoadedSources(null);
    setLoadCounts(null);
    setLoadWarning(null);
    setLoadError(null);
    setOutput("");
    setSaved(false);
    setSavedPath("");
    setShowConfirm(false);
    setDroppedCount(0);
    setMapError(null);
    setMapPartial(false);
    setMapCost(null);
    setLastMapRequest(null);
    setPrivacyScanError(null);
    setMappingReviewItems(null);
    setFactError(null);
    setMappingFacts(null);
    setFactStats(null);
    setVerifyFindings(null);
  }

  function updateReviewItem(index, field, value) {
    setMappingReviewItems((items) => (items || []).map((item, i) => i === index ? { ...item, [field]: value } : item));
  }

  function updateFactItem(index, field, value) {
    setMappingFacts((facts) => (facts || []).map((fact, i) => i === index ? { ...fact, [field]: value } : fact));
  }

  async function handleLoadSources() {
    if (!settings.vaultPath) return;
    setLoading(true);
    setLoadError(null);
    setLoadWarning(null);
    setLoadedSources(null);
    setLoadCounts(null);
    setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setDroppedCount(0);
    setMapPartial(false);
    setPrivacyScanError(null);
    setMappingReviewItems(null);
    setFactError(null);
    setMappingFacts(null);
    setFactStats(null);
    setVerifyFindings(null);

    try {
      const { aliases } = detectAccount(selectedFolder, settings.accounts);
      const params = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (selectedFolder) params.set("folderPath", selectedFolder);
      if (sourceRange === "all") params.set("allTime", "true");
      if (!strictFolderOnly && aliases?.length) params.set("accountAliases", aliases.join(","));

      const res = await apiFetch(`/api/notes?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load sources");

      setLoadedSources(data.notes || []);
      setLoadCounts(data.counts);
      setLoadWarning(data.warning || null);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  async function handleScanNames() {
    if (!loadedSources?.length) return;
    const savedReplacements = settings.replacements || [];
    const corrections = settings.corrections || [];

    setPrivacyScanning(true);
    setPrivacyScanError(null);
    setShowConfirm(false);

    try {
      let newEntities = [];
      let scanSkipped = !settings.aiPrivacyScan;

      if (settings.aiPrivacyScan) {
        const scanText = buildMappingScanText(loadedSources, corrections, savedReplacements);
        try {
          const res = await apiFetch("/api/sanitize", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              transcript: scanText,
              apiKey: settings.apiKey || undefined,
              knownAliases: aliasesFromReplacements(savedReplacements),
            }),
          });
          if (!res.ok) throw new Error("Name scan failed");
          const data = await res.json();
          if (data.skipped) scanSkipped = true;
          newEntities = dedupeEntities(data.entities || []);
        } catch {
          scanSkipped = true;
        }
      }

      const savedItems = savedReplacementsInSources(loadedSources, savedReplacements);
      const savedTexts = new Set(savedItems.map((item) => item.text.toLowerCase()));
      const detectedItems = assignAliases(newEntities, savedReplacements)
        .filter((item) => !savedTexts.has(item.text.toLowerCase()))
        .map((item) => ({
          ...item,
          restored: item.text,
          context: "",
          enabled: true,
          saved: false,
        }));

      setMappingReviewItems([...savedItems, ...detectedItems]);
      if (scanSkipped && settings.aiPrivacyScan) {
        setPrivacyScanError("Name scan skipped - set your API key in Settings to enable AI detection.");
      } else if (!settings.aiPrivacyScan) {
        setPrivacyScanError("AI privacy scan is disabled in Settings. Showing saved glossary terms found in these sources.");
      }
    } finally {
      setPrivacyScanning(false);
    }
  }

  function buildReviewReplacements() {
    const savedReplacements = settings.replacements || [];
    const existing = new Set(savedReplacements.map((r) => String(r.original || "").toLowerCase()));
    const additions = (mappingReviewItems || [])
      .filter((item) => item.enabled && !item.saved && !existing.has(String(item.text || "").toLowerCase()))
      .map((item) => ({
        original: item.text,
        alias: item.alias,
        restored: item.restored || item.text,
      }));
    return [...savedReplacements, ...additions];
  }

  function buildMappingContext(replacements) {
    const corrections = settings.corrections || [];
    return (mappingReviewItems || [])
      .filter((item) => item.context?.trim())
      .map((item) => {
        const label = item.enabled ? (item.alias || item.text) : (item.restored || item.text);
        return {
          label: applyReplacements(applyCorrections(label, corrections), replacements),
          context: applyReplacements(applyCorrections(item.context, corrections), replacements),
        };
      });
  }

  function activeFacts(facts = mappingFacts) {
    return (facts || []).filter((fact) => fact.enabled !== false);
  }

  function normalizedFacts(facts) {
    return (facts || []).map((fact, i) => ({
      ...fact,
      enabled: fact.enabled !== false,
      reviewId: fact.reviewId || `${fact.sourceId || "source"}-${fact.type || "fact"}-${fact.name || "item"}-${i}`,
    }));
  }

  async function handleExtractFacts(options = {}) {
    if (!loadedSources?.length || !settings.vaultPath) return null;
    const account = detectAccount(selectedFolder, settings.accounts);
    const replacements = buildReviewReplacements();
    const mappingContext = buildMappingContext(replacements);

    setExtractingFacts(true);
    setFactError(null);
    setVerifyFindings(null);
    if (!options.keepExisting) {
      setMappingFacts(null);
      setFactStats(null);
    }

    try {
      const res = await apiFetch("/api/contact-facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: loadedSources,
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          apiKey: settings.apiKey || undefined,
          accountName: account.name,
          allAccounts: settings.accounts || [],
          replacements,
          corrections: settings.corrections || [],
          mappingContext,
          changedOnly,
          force: forceExtract,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Fact extraction failed");
      const facts = normalizedFacts(data.facts || []);
      setMappingFacts(facts);
      setFactStats(data.stats || null);
      return facts;
    } catch (error) {
      setFactError(error.message);
      if (options.fallbackToRaw) return null;
      throw error;
    } finally {
      setExtractingFacts(false);
    }
  }

  async function verifyGeneratedMap(mapText, requestPayload) {
    if (!mapText.trim()) return;
    setVerifyingMap(true);
    setVerifyFindings(null);
    try {
      const res = await apiFetch("/api/verify-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          map: mapText,
          facts: requestPayload.facts || [],
          accountName: requestPayload.accountName,
          allAccounts: requestPayload.allAccounts || [],
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      setVerifyFindings(data.findings || []);
    } catch (error) {
      setVerifyFindings([{ severity: "warning", message: error.message }]);
    } finally {
      setVerifyingMap(false);
    }
  }

  async function runMapRequest(requestPayload, options = {}) {
    const append = !!options.append;
    const baseOutput = append ? output : "";
    const controller = new AbortController();
    mapControllerRef.current = controller;
    setLastMapRequest(requestPayload);
    setMapping(true);
    setMapError(null);
    setMapPartial(false);
    if (!append) setOutput("");
    setSaved(false);
    setShowConfirm(false);
    setDroppedCount(0);

    try {
      const res = await apiFetch("/api/stakeholder-map", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(requestPayload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Mapping failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop();
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const evt = JSON.parse(part.slice(6));
          if (evt.type === "delta") {
            accumulated += evt.text;
            setOutput(append ? `${baseOutput}${accumulated}` : accumulated);
          } else if (evt.type === "done") {
            const reps = requestPayload.replacements || settings.replacements || [];
            const requestCorrections = requestPayload.corrections || settings.corrections || [];
            const restored = reps.length ? reverseReplacements(accumulated, reps) : accumulated;
            const nextOutput = append ? `${baseOutput}${restored}` : restored;
            const displayOutput = applyCorrections(nextOutput, requestCorrections);
            setOutput(displayOutput);
            if (evt.truncated) {
              setMapPartial(true);
              setMapError("Generation hit the model output limit. Partial map kept below; continue to finish it.");
            } else {
              await verifyGeneratedMap(displayOutput, requestPayload);
            }
            if (evt.usage) setMapCost(calcCost(evt.usage, evt.model));
            if (evt.droppedCount) setDroppedCount(evt.droppedCount);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
    } catch (e) {
      const message = e.name === "AbortError" ? "Mapping canceled." : e.message;
      if (accumulated.trim()) {
        const reps = requestPayload.replacements || settings.replacements || [];
        const requestCorrections = requestPayload.corrections || settings.corrections || [];
        const restored = reps.length ? reverseReplacements(accumulated, reps) : accumulated;
        const nextOutput = append ? `${baseOutput}${restored}` : restored;
        setOutput(applyCorrections(nextOutput, requestCorrections));
        setMapPartial(true);
        setMapError(`${message} Partial map kept below; continue to finish it.`);
      } else {
        setMapError(message);
      }
    } finally {
      if (mapControllerRef.current === controller) {
        mapControllerRef.current = null;
      }
      setMapping(false);
    }
  }

  async function handleGenerateMap() {
    if (!loadedSources?.length) return;
    const account = detectAccount(selectedFolder, settings.accounts);
    const replacements = buildReviewReplacements();
    let facts = mappingFacts;
    if (!facts) {
      facts = await handleExtractFacts({ fallbackToRaw: true });
    }
    if (changedOnly && !facts) {
      setMapError("Changed-only mapping needs a successful fact extraction first.");
      return;
    }
    const factsForRequest = activeFacts(facts);
    if (changedOnly && facts && factsForRequest.length === 0) {
      setMapError("No changed contact facts found since the last saved map.");
      return;
    }
    await runMapRequest({
      notes: loadedSources,
      facts: factsForRequest,
      apiKey: settings.apiKey || undefined,
      model,
      today: TODAY,
      replacements,
      corrections: settings.corrections || [],
      accountName: account.name,
      allAccounts: settings.accounts || [],
      sourceRange,
      mappingContext: buildMappingContext(replacements),
      incremental: changedOnly,
    });
  }

  function handleCancelMapping() {
    mapControllerRef.current?.abort();
  }

  function handleRetryMapping() {
    if (lastMapRequest) runMapRequest(lastMapRequest);
  }

  function handleContinueMapping() {
    if (!lastMapRequest || !output.trim()) return;
    runMapRequest({
      ...lastMapRequest,
      previousOutput: output,
      continuationSection: inferNextMappingSection(output),
    }, { append: true });
  }

  function handleOutputChange(nextOutput) {
    setOutput(nextOutput);
    setSaved(false);
    setSavedPath("");
    setMapPartial(false);
    setVerifyFindings(null);
  }

  async function handleSave() {
    if (!output || !settings.vaultPath) return;
    setSaving(true);
    try {
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: output,
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          meetingTitle: `Customer Site Mapping ${TODAY}`,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);
      const account = detectAccount(selectedFolder, settings.accounts);
      apiFetch("/api/contact-facts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "markMapped",
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          accountName: account.name,
          savedPath: data.savedPath,
        }),
      }).catch(() => {});
    } catch (e) {
      alert(`Failed to save mapping: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function handleReset() {
    setLoadedSources(null);
    setLoadCounts(null);
    setLoadWarning(null);
    setOutput("");
    setSaved(false);
    setSavedPath("");
    setMapError(null);
    setMapPartial(false);
    setLoadError(null);
    setShowConfirm(false);
    setDroppedCount(0);
    setMapCost(null);
    setLastMapRequest(null);
    setPrivacyScanError(null);
    setMappingReviewItems(null);
    setFactError(null);
    setMappingFacts(null);
    setFactStats(null);
    setVerifyFindings(null);
  }

  const folderLabel = selectedFolder || "(Vault root)";
  const sourceRangeText = sourceRange === "all"
    ? "all available source files"
    : `sources dated ${threeMonthsAgoLabel()} or later`;

  return (
    <div className="space-y-4">
      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={selectedFolder}
        onSelect={(f) => { setSelectedFolder(f); clearLoadedMappingSources(); }}
        onSettingsClick={onSettingsClick}
      />

      {settings.vaultPath && (
        <div className="card p-4">
          <div className="flex items-start justify-between gap-4 mb-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Mapping Corrections</h3>
              <p className="text-xs text-gray-500">
                Applied to source notes before anonymization, then to the generated map before saving.
              </p>
            </div>
            {corrections.length > 0 && (
              <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-1 whitespace-nowrap">
                {corrections.length} rule{corrections.length !== 1 ? "s" : ""}
              </span>
            )}
          </div>

          {corrections.length > 0 && (
            <div className="mb-3 space-y-1.5">
              {corrections.map((correction, i) => (
                <div key={`${correction.find}-${i}`} className="flex items-center gap-2 px-3 py-2 bg-gray-50 rounded-lg border border-gray-200 text-sm">
                  <span className="font-medium text-gray-800 flex-1 truncate">{correction.find}</span>
                  <span className="text-gray-400">-&gt;</span>
                  <span className="font-medium text-gray-800 flex-1 truncate">
                    {correction.replace || <em className="text-gray-400">(delete)</em>}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveCorrection(i)}
                    disabled={mapping}
                    className="text-gray-400 hover:text-red-500 disabled:opacity-50 ml-1"
                    aria-label={`Remove correction for ${correction.find}`}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]">
            <input
              type="text"
              className="input"
              placeholder="Find"
              value={newFind}
              onChange={(e) => setNewFind(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCorrection()}
              disabled={mapping}
            />
            <input
              type="text"
              className="input"
              placeholder="Replace with"
              value={newReplace}
              onChange={(e) => setNewReplace(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && handleAddCorrection()}
              disabled={mapping}
            />
            <button
              type="button"
              onClick={handleAddCorrection}
              disabled={!newFind.trim() || mapping || !onSettingsPatch}
              className="btn-secondary whitespace-nowrap"
            >
              Add
            </button>
          </div>
        </div>
      )}

      {settings.vaultPath && !output && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h3 className="text-base font-semibold text-gray-900 mb-1">Customer & Site Mapping</h3>
              <p className="text-sm text-gray-500">
                Scanning Obsidian meeting notes in <span className="font-medium text-gray-700">{folderLabel}</span>
                {" "}for <span className="font-medium text-gray-700">{sourceRangeText}</span>.
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-3">
                <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {SOURCE_RANGES.map((range) => (
                    <button
                      key={range.id}
                      type="button"
                      onClick={() => handleSourceRangeChange(range.id)}
                      disabled={loading || mapping}
                      className={`px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50 ${
                        sourceRange === range.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      {range.label}
                    </button>
                  ))}
                </div>
                <label className={`flex items-center gap-1.5 text-xs ${loading || mapping ? "text-gray-300" : "text-gray-500 cursor-pointer"}`}>
                  <input
                    type="checkbox"
                    checked={strictFolderOnly}
                    disabled={loading || mapping}
                    onChange={(e) => handleStrictFolderOnlyChange(e.target.checked)}
                    className="accent-obsidian-600"
                  />
                  Account folder only
                  <span title="Skips cross-folder search for a faster, stricter scan. Re-scan after changing.">i</span>
                </label>
              </div>

              {loadedSources !== null && (
                <div className="mt-3">
                  {loadedSources.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No Obsidian meeting notes found for this range.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {loadedSources.length} source{loadedSources.length !== 1 ? "s" : ""} for mapping
                      </p>
                      {loadCounts && (
                        <div className="flex gap-3 text-xs text-gray-500 flex-wrap">
                          {loadCounts.obsidian > 0 && <span>{loadCounts.obsidian} account-folder note{loadCounts.obsidian !== 1 ? "s" : ""}</span>}
                          {loadCounts.crossVault > 0 && <span>{loadCounts.crossVault} cross-folder note{loadCounts.crossVault !== 1 ? "s" : ""}</span>}
                        </div>
                      )}
                      <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
                        {loadedSources.map((n, i) => (
                          <li key={`${n.source}-${n.sourceLabel}-${n.filename}-${i}`} className="flex gap-2">
                            <span className="font-mono text-gray-400 flex-shrink-0">{n.date || "undated"}</span>
                            <span className="truncate">{n.title}</span>
                            {n.source !== "obsidian" && (
                              <span className="text-gray-400 flex-shrink-0 italic">{n.sourceLabel}</span>
                            )}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {loadWarning && (
                    <p className="mt-2 text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                      {loadWarning}
                    </p>
                  )}
                </div>
              )}

              {loadError && <p className="mt-2 text-sm text-red-600">{loadError}</p>}
            </div>

            <button
              onClick={handleLoadSources}
              disabled={loading || !settings.vaultPath}
              className="btn-secondary whitespace-nowrap"
            >
              {loading ? (
                <>
                  <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Scanning...
                </>
              ) : loadedSources !== null ? "Re-scan" : "Scan Sources"}
            </button>
          </div>

          {loadedSources?.length > 0 && !showConfirm && (
            <div className="mt-5 pt-5 border-t border-gray-100">
              <div className="flex items-center gap-3 mb-4">
                <span className="text-xs text-gray-500 font-medium">Model</span>
                <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                  {[
                    { id: "claude-haiku-4-5", label: "Haiku", sub: "Faster - 200k" },
                    { id: "claude-sonnet-5", label: "Sonnet", sub: "Best - 1M ctx" },
                  ].map((m) => (
                    <button
                      key={m.id}
                      type="button"
                      onClick={() => setModel(m.id)}
                      className={`px-3 py-1.5 text-left transition-colors ${
                        model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                      }`}
                    >
                      <div className="text-xs font-medium leading-tight">{m.label}</div>
                      <div className={`text-xs leading-tight ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</div>
                    </button>
                  ))}
                </div>
              </div>
              {mapError && (
                <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">
                  {mapError}
                </p>
              )}
              {privacyScanError && (
                <p className="mb-3 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                  {privacyScanError}
                </p>
              )}

              {mappingReviewItems !== null && (
                <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
                  <div className="flex items-start justify-between gap-4 mb-3">
                    <div>
                      <h4 className="text-sm font-semibold text-gray-900">Names & Context</h4>
                      <p className="text-xs text-gray-500">
                        Checked terms are removed from the AI input with aliases. Context is sent with the map request.
                      </p>
                    </div>
                    <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-1 whitespace-nowrap">
                      {mappingReviewItems.length} term{mappingReviewItems.length !== 1 ? "s" : ""}
                    </span>
                  </div>

                  {mappingReviewItems.length === 0 ? (
                    <p className="text-sm text-gray-500">No names found beyond your saved anonymization list.</p>
                  ) : (
                    <div className="space-y-2 max-h-96 overflow-y-auto pr-1">
                      {mappingReviewItems.map((item, i) => (
                        <div
                          key={`${item.alias}-${item.text}-${i}`}
                          className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)_minmax(0,1.4fr)] ${
                            item.enabled ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={item.enabled}
                            onChange={() => updateReviewItem(i, "enabled", !item.enabled)}
                            disabled={item.saved}
                            className="mt-1 w-4 h-4 accent-obsidian-600"
                            title={item.saved ? "Saved glossary terms are always removed from the AI input" : "Remove this name from the AI input"}
                          />
                          <div className="space-y-2">
                            <div>
                              <div className="text-sm font-medium text-gray-900 truncate">{item.text}</div>
                              <div className="text-xs text-gray-400">
                                {item.type}{item.saved ? " - saved" : ""}
                              </div>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <input
                                type="text"
                                value={item.alias}
                                onChange={(e) => updateReviewItem(i, "alias", e.target.value)}
                                disabled={!item.enabled || item.saved}
                                className="font-mono text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 focus:outline-none focus:border-obsidian-400 disabled:opacity-50"
                                title="Alias sent to Claude"
                              />
                              <input
                                type="text"
                                value={item.restored || item.text}
                                onChange={(e) => updateReviewItem(i, "restored", e.target.value)}
                                disabled={!item.enabled}
                                className="text-xs px-2 py-1 rounded border border-gray-200 bg-gray-50 focus:outline-none focus:border-obsidian-400 disabled:opacity-50"
                                title="Name restored in the final map"
                              />
                            </div>
                          </div>
                          <textarea
                            value={item.context || ""}
                            onChange={(e) => updateReviewItem(i, "context", e.target.value)}
                            rows={3}
                            className="input text-xs resize-y min-h-20"
                            placeholder="Context for mapping: role, site, relationship, influence, do/don't include..."
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}

              <div className="mb-4 rounded-lg border border-gray-200 bg-white p-4">
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <h4 className="text-sm font-semibold text-gray-900">Structured Fact Index</h4>
                    <p className="text-xs text-gray-500">
                      Extract compact contact and site facts first, then generate the map from those facts.
                    </p>
                  </div>
                  {factStats && (
                    <span className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded-full px-2 py-1 whitespace-nowrap">
                      {activeFacts().length} fact{activeFacts().length !== 1 ? "s" : ""}
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-3 mb-3">
                  <label className={`flex items-center gap-1.5 text-xs ${extractingFacts || mapping ? "text-gray-300" : "text-gray-500 cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={changedOnly}
                      disabled={extractingFacts || mapping}
                      onChange={(e) => { setChangedOnly(e.target.checked); setMappingFacts(null); setFactStats(null); }}
                      className="accent-obsidian-600"
                    />
                    Changed since last saved map
                  </label>
                  <label className={`flex items-center gap-1.5 text-xs ${extractingFacts || mapping ? "text-gray-300" : "text-gray-500 cursor-pointer"}`}>
                    <input
                      type="checkbox"
                      checked={forceExtract}
                      disabled={extractingFacts || mapping}
                      onChange={(e) => { setForceExtract(e.target.checked); setMappingFacts(null); setFactStats(null); }}
                      className="accent-obsidian-600"
                    />
                    Force re-extract
                  </label>
                  <button
                    type="button"
                    onClick={() => handleExtractFacts({ keepExisting: true })}
                    disabled={extractingFacts || mapping}
                    className="btn-secondary text-xs px-3 py-1.5"
                  >
                    {extractingFacts ? (
                      <>
                        <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Extracting...
                      </>
                    ) : mappingFacts ? "Refresh Facts" : "Extract Facts"}
                  </button>
                </div>

                {factStats && (
                  <div className="mb-3 flex flex-wrap gap-3 text-xs text-gray-500">
                    <span>{factStats.totalSources} source{factStats.totalSources !== 1 ? "s" : ""}</span>
                    <span>{factStats.reusedSources} reused</span>
                    <span>{factStats.extractedSources} extracted</span>
                    {factStats.skippedSources > 0 && <span>{factStats.skippedSources} unchanged skipped</span>}
                    {factStats.batches > 0 && <span>{factStats.batches} batch{factStats.batches !== 1 ? "es" : ""}</span>}
                  </div>
                )}

                {factError && (
                  <p className="mb-3 text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200">
                    {factError}
                  </p>
                )}

                {mappingFacts !== null && (
                  mappingFacts.length === 0 ? (
                    <p className="text-sm text-gray-500">No contact or site facts found for this run.</p>
                  ) : (
                    <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
                      {mappingFacts.map((fact, i) => (
                        <div
                          key={fact.reviewId || `${fact.sourceId}-${fact.name}-${i}`}
                          className={`grid gap-2 rounded-lg border p-3 sm:grid-cols-[auto_minmax(0,1fr)] ${
                            fact.enabled !== false ? "border-gray-200 bg-white" : "border-gray-100 bg-gray-50 opacity-60"
                          }`}
                        >
                          <input
                            type="checkbox"
                            checked={fact.enabled !== false}
                            onChange={() => updateFactItem(i, "enabled", fact.enabled === false)}
                            className="mt-1 w-4 h-4 accent-obsidian-600"
                            title="Include this fact in the final mapping run"
                          />
                          <div>
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs uppercase tracking-wide text-gray-400">{fact.type}</span>
                              <span className="text-sm font-medium text-gray-900">{fact.name}</span>
                              {fact.sourceTitle && (
                                <span className="text-xs text-gray-400">
                                  {fact.sourceDate || "undated"} - {fact.sourceTitle}
                                </span>
                              )}
                            </div>
                            <p className="text-xs text-gray-600 mt-1">{fact.evidence}</p>
                            {(fact.role || fact.site || fact.relationship) && (
                              <p className="text-xs text-gray-400 mt-1">
                                {[fact.role, fact.site, fact.relationship].filter(Boolean).join(" | ")}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  )
                )}
              </div>

              {mappingReviewItems === null ? (
                <div className="flex gap-3">
                  <button
                    onClick={handleScanNames}
                    disabled={privacyScanning || mapping}
                    className="btn-primary flex-1 py-3 text-base"
                  >
                    {privacyScanning ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        Scanning...
                      </>
                    ) : "Scan Names & Add Context"}
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    disabled={privacyScanning || mapping}
                    className="btn-secondary flex-1 py-3 text-base"
                  >
                    Skip Review
                  </button>
                </div>
              ) : (
                <div className="flex gap-3">
                  <button
                    onClick={handleScanNames}
                    disabled={privacyScanning || mapping}
                    className="btn-secondary flex-1 py-3 text-base"
                  >
                    Re-scan Names
                  </button>
                  <button
                    onClick={() => setShowConfirm(true)}
                    disabled={privacyScanning || mapping}
                    className="btn-primary flex-1 py-3 text-base"
                  >
                    Continue to Pre-flight
                  </button>
                </div>
              )}
            </div>
          )}

          {loadedSources?.length > 0 && showConfirm && (() => {
            const factsForEstimate = activeFacts();
            const estimationSources = factsForEstimate.length
              ? factsForEstimate.map((fact) => ({
                  title: fact.name,
                  content: JSON.stringify(fact),
                }))
              : loadedSources;
            const est = estimateUsage(estimationSources, model, ESTIMATED_OUTPUT_TOKENS);
            const limit = contextLimit(model);
            const warnAt = limit - 20_000;
            const reviewedCount = (mappingReviewItems || []).filter((item) => item.enabled).length;
            const contextCount = (mappingReviewItems || []).filter((item) => item.context?.trim()).length;
            return (
              <div className="mt-5 pt-5 border-t border-gray-100">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-800">Pre-flight check</h4>
                  <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
                    {[
                      { id: "claude-haiku-4-5", label: "Haiku", sub: "200k" },
                      { id: "claude-sonnet-5", label: "Sonnet", sub: "1M" },
                    ].map((m) => (
                      <button
                        key={m.id}
                        type="button"
                        onClick={() => setModel(m.id)}
                        className={`px-3 py-1 text-left transition-colors ${
                          model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                        }`}
                      >
                        <span className="text-xs font-medium">{m.label}</span>
                        <span className={`text-xs ml-1 ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</span>
                      </button>
                    ))}
                  </div>
                </div>
                <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
                  <p className="text-xs text-gray-600">
                    Sending <strong>{factsForEstimate.length || loadedSources.length}</strong>{" "}
                    {factsForEstimate.length ? "structured fact" : "account source"}{(factsForEstimate.length || loadedSources.length) !== 1 ? "s" : ""} to Claude for customer and site mapping.
                  </p>
                  {loadCounts && (
                    <div className="flex gap-4 text-xs text-gray-600 flex-wrap">
                      {loadCounts.obsidian > 0 && <span>{loadCounts.obsidian} account-folder note{loadCounts.obsidian !== 1 ? "s" : ""}</span>}
                      {loadCounts.crossVault > 0 && <span>{loadCounts.crossVault} cross-folder note{loadCounts.crossVault !== 1 ? "s" : ""}</span>}
                    </div>
                  )}
                  <div className="grid grid-cols-2 gap-x-6 gap-y-1 text-xs">
                    <span className="text-gray-500">Est. input</span>
                    <span className={`font-mono ${est.inputTokens > warnAt ? "text-red-600 font-semibold" : "text-gray-700"}`}>~{est.inputTokens.toLocaleString()} tokens</span>
                    <span className="text-gray-500">Est. output</span>
                    <span className="font-mono text-gray-700">~{est.outputTokens.toLocaleString()} tokens</span>
                    <span className="text-gray-500">Context limit</span>
                    <span className="font-mono text-gray-700">{(limit / 1000).toLocaleString()}k tokens ({est.label})</span>
                    <span className="text-gray-500">Est. cost</span>
                    <span className="font-mono text-gray-700">~${est.cost.toFixed(4)}</span>
                  </div>
                  {est.inputTokens > warnAt && (
                    <p className="text-xs text-red-700 font-medium">
                      Input is near or over this model's {(limit / 1000).toLocaleString()}k token limit. Oldest sources will be trimmed automatically to fit.
                    </p>
                  )}
                  <p className="text-xs text-amber-700">
                    Sanitized source content will be sent to Claude. Names in your glossary and selected review terms are replaced before sending and restored afterward.
                  </p>
                  {mappingReviewItems !== null && (
                    <p className="text-xs text-amber-700">
                      Reviewed {reviewedCount} term{reviewedCount !== 1 ? "s" : ""}; {contextCount} context note{contextCount !== 1 ? "s" : ""} will guide the map.
                    </p>
                  )}
                  {factStats && (
                    <p className="text-xs text-amber-700">
                      Fact index reused {factStats.reusedSources} source{factStats.reusedSources !== 1 ? "s" : ""} and extracted {factStats.extractedSources} changed source{factStats.extractedSources !== 1 ? "s" : ""}.
                    </p>
                  )}
                </div>
                <div className="flex gap-3 mt-3">
                  <button onClick={() => setShowConfirm(false)} className="btn-secondary flex-1">
                    Cancel
                  </button>
                  <button onClick={handleGenerateMap} disabled={mapping || extractingFacts} className="btn-primary flex-1 py-3">
                    {mapping || extractingFacts ? (
                      <>
                        <svg className="animate-spin w-5 h-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                        </svg>
                        {extractingFacts ? "Extracting..." : "Mapping..."}
                      </>
                    ) : "Confirm - Send to Claude"}
                  </button>
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {(output || mapping) && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-gray-900">
                {mapping ? "Generating..." : "Customer & Site Map Ready"}
              </h2>
              {mapping && (
                <svg className="animate-spin w-4 h-4 text-teal-600" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
            </div>
            {!mapping && <button onClick={handleReset} className="btn-secondary">Start Over</button>}
          </div>
          {droppedCount > 0 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              {droppedCount} source{droppedCount !== 1 ? "s" : ""} could not fit within the model's context limit.
            </p>
          )}
          {mapError && (
            <div className={`text-xs rounded-lg px-3 py-2 border flex items-center justify-between gap-3 ${
              mapPartial
                ? "text-amber-700 bg-amber-50 border-amber-200"
                : "text-red-700 bg-red-50 border-red-200"
            }`}>
              <span>{mapError}</span>
              {mapPartial && !mapping && (
                <button
                  type="button"
                  onClick={handleContinueMapping}
                  disabled={!lastMapRequest}
                  className="btn-secondary text-xs px-3 py-1.5 whitespace-nowrap"
                >
                  Continue
                </button>
              )}
            </div>
          )}
          {(verifyingMap || verifyFindings) && (
            <div className={`text-xs rounded-lg px-3 py-2 border ${
              verifyFindings?.some((finding) => finding.severity === "error")
                ? "text-red-700 bg-red-50 border-red-200"
                : verifyFindings?.length
                ? "text-amber-700 bg-amber-50 border-amber-200"
                : "text-green-700 bg-green-50 border-green-200"
            }`}>
              {verifyingMap ? (
                <span>Verifying map...</span>
              ) : verifyFindings.length === 0 ? (
                <span>Verification passed: sections, placeholders, account terms, and source citations look clean.</span>
              ) : (
                <div className="space-y-1">
                  <p className="font-medium">Verification findings</p>
                  <ul className="list-disc pl-4 space-y-0.5">
                    {verifyFindings.map((finding, i) => (
                      <li key={`${finding.message}-${i}`}>{finding.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {output && (
            <NotesPreview
              notes={output}
              onNotesChange={handleOutputChange}
              onSave={handleSave}
              saving={saving}
              saved={saved}
              savedPath={savedPath}
              cost={mapCost}
              streaming={mapping}
              onCancel={handleCancelMapping}
              onRetry={handleRetryMapping}
              canRetry={!!lastMapRequest && !mapping}
            />
          )}
          {mapping && !output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for Claude...</div>
          )}
        </div>
      )}
    </div>
  );
}
