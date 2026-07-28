"use client";

import { useEffect, useRef, useState } from "react";
import { detectAccount } from "@/lib/accounts";
import { buildScrubReport, redactForbiddenTerms, assessNoteDominance } from "@/lib/scrub";
import { reverseReplacements } from "@/lib/sanitize";
import { calcCost } from "@/lib/models";
import { apiFetch } from "@/lib/apiClient";

export const TODAY = new Date().toISOString().split("T")[0];

const HISTORY_CAP = 15;

// Shared state + handlers for the three report tabs (Account Status,
// SL Status, EA Activity). Per-tab behavior is injected via options:
//   storageKey       localStorage namespace ("report:status", ...)
//   saveTitle        () => filename title for /api/save
//   filterNotes      (notes, acct) => notes   client-side note filter
//   buildNotesParams (URLSearchParams) => void  extra /api/notes params
//   synthesizeExtras (acct) => object          extra /api/synthesize body
//   loadExtras       async (acct) => any       extra data fetched on scan
//
// The hook also persists the last generated report (and scrub selections)
// to localStorage, keeps partial output when a generation dies mid-stream
// (with append/resume support), and records saved reports into a history
// list the UI can reopen.
export function useReportWorkflow({
  settings,
  storageKey,
  saveTitle,
  filterNotes,
  buildNotesParams,
  synthesizeExtras,
  loadExtras,
}) {
  const [selectedFolder, setSelectedFolder] = useState("");
  const [rawNotes, setRawNotes] = useState(null);
  const [loadedNotes, setLoadedNotes] = useState(null);
  const [excludedFiles, setExcludedFiles] = useState(new Set());
  const [noteRisks, setNoteRisks] = useState({}); // filename -> dominant other account
  const [strictFolderOnly, setStrictFolderOnly] = useState(false);
  const [loadCounts, setLoadCounts] = useState(null);
  const [loadError, setLoadError] = useState(null);
  const [loading, setLoading] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);
  const [extras, setExtras] = useState(null);

  const [synthesizing, setSynthesizing] = useState(false);
  const [synthError, setSynthError] = useState(null);
  const [output, setOutput] = useState("");
  const [partial, setPartial] = useState(false);
  const [redactedCount, setRedactedCount] = useState(0);
  const [verifying, setVerifying] = useState(false);
  const [verifyFindings, setVerifyFindings] = useState(null); // null = not run, [] = clean

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [synthCost, setSynthCost] = useState(null);
  const [droppedCount, setDroppedCount] = useState(0);
  const [summarizedCount, setSummarizedCount] = useState(0);

  const [scrubReport, setScrubReport] = useState([]);
  const [restoredIds, setRestoredIds] = useState(new Set());
  const [scrubOpen, setScrubOpen] = useState(false);

  const [model, setModel] = useState(settings.model || "claude-haiku-4-5");
  const [history, setHistory] = useState([]);
  const [restoredFromStorage, setRestoredFromStorage] = useState(false);

  // Raw (pseudonymized) streamed text — kept for append/resume; `output`
  // holds the display text (names reversed once generation finishes).
  const rawRef = useRef("");
  const synthControllerRef = useRef(null);
  const [lastSynthesisRequest, setLastSynthesisRequest] = useState(null);
  const hydrated = useRef(false);

  // Restore last session on mount.
  useEffect(() => {
    try {
      const s = JSON.parse(localStorage.getItem(storageKey) || "null");
      if (s) {
        if (s.output) {
          setOutput(s.output);
          rawRef.current = s.output;
          setRestoredFromStorage(true);
        }
        if (s.model) setModel(s.model);
        if (s.saved) { setSaved(true); setSavedPath(s.savedPath || ""); }
        if (s.synthCost) setSynthCost(s.synthCost);
        if (s.partial) setPartial(true);
        if (Array.isArray(s.restoredIds)) setRestoredIds(new Set(s.restoredIds));
      }
    } catch {}
    try {
      setHistory(JSON.parse(localStorage.getItem(`${storageKey}:history`) || "[]"));
    } catch {}
    hydrated.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist whenever the durable bits change (not mid-stream).
  useEffect(() => {
    if (!hydrated.current || synthesizing) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({
        output, model, saved, savedPath, synthCost, partial,
        restoredIds: [...restoredIds],
      }));
    } catch {}
  }, [output, model, saved, savedPath, synthCost, partial, restoredIds, synthesizing, storageKey]);

  function acctCtx() {
    return detectAccount(selectedFolder, settings.accounts);
  }

  function invalidateNotes() {
    setRawNotes(null);
    setLoadedNotes(null);
    setLoadCounts(null);
    setShowConfirm(false);
    setScrubReport([]);
    setExtras(null);
    setExcludedFiles(new Set());
    setNoteRisks({});
  }

  // Manually drop a scanned note (e.g. a multi-account internal meeting)
  // from what gets sent to Claude.
  function toggleNoteExcluded(filename) {
    setExcludedFiles((prev) => {
      const next = new Set(prev);
      if (next.has(filename)) next.delete(filename);
      else next.add(filename);
      return next;
    });
  }

  function selectFolder(f) {
    setSelectedFolder(f);
    invalidateNotes();
    setOutput("");
    rawRef.current = "";
    setPartial(false);
    setSaved(false);
    setSummarizedCount(0);
  }

  async function handleLoadNotes() {
    if (!settings.vaultPath) return;
    setLoading(true);
    setLoadError(null);
    invalidateNotes();
    setOutput("");
    rawRef.current = "";
    setPartial(false);
    setSaved(false);
    setScrubOpen(false);

    try {
      const acct = acctCtx();
      const params = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (selectedFolder) params.set("folderPath", selectedFolder);
      // Strict mode: skip cross-folder search entirely — the account's own
      // folder is the only source, eliminating multi-account note risk.
      if (!strictFolderOnly && acct.aliases?.length) params.set("accountAliases", acct.aliases.join(","));
      if (settings.transcriptsPath && acct.archiveFolder) {
        params.set("transcriptsPath", settings.transcriptsPath);
        params.set("transcriptFolder", acct.archiveFolder);
      }
      buildNotesParams?.(params);

      const [notesRes, extraData] = await Promise.all([
        apiFetch(`/api/notes?${params}`),
        loadExtras ? loadExtras(acct) : Promise.resolve(null),
      ]);
      const data = await notesRes.json();
      if (!notesRes.ok) throw new Error(data.error || "Failed to load notes");

      const kept = filterNotes ? data.notes.filter((n) => filterNotes(n, acct)) : data.notes;
      setRawNotes(data.notes);
      setLoadedNotes(kept);
      setLoadCounts(data.counts);
      setScrubReport(buildScrubReport(kept, acct.name, settings.accounts || []));

      // Notes dominated by another account default to excluded — they're the
      // main source of misattributed content. The user can re-include them.
      const risks = {};
      const autoExcluded = new Set();
      for (const n of kept) {
        const dom = assessNoteDominance(n, acct.name, settings.accounts || []);
        if (dom) {
          risks[n.filename] = dom;
          autoExcluded.add(n.filename);
        }
      }
      setNoteRisks(risks);
      setExcludedFiles(autoExcluded);
      if (extraData) setExtras(extraData);
    } catch (e) {
      setLoadError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const activeNotes = loadedNotes ? loadedNotes.filter((n) => !excludedFiles.has(n.filename)) : null;

  // opts.append   — continue on top of existing raw output (resume)
  // opts.extraBody — merged into the request body (e.g. resumeRows)
  async function handleSynthesize(opts = {}) {
    if (!activeNotes?.length) return;
    const controller = new AbortController();
    synthControllerRef.current = controller;
    setLastSynthesisRequest(opts);
    setSynthesizing(true);
    setSynthError(null);
    setSaved(false);
    setShowConfirm(false);
    setPartial(false);
    if (!opts.append) {
      rawRef.current = "";
      setOutput("");
      setDroppedCount(0);
      setSummarizedCount(0);
      setRedactedCount(0);
    }
    setVerifyFindings(null);

    const reps = settings.replacements || [];
    let accumulated = opts.append ? rawRef.current + "\n" : "";
    const acct = acctCtx();

    // Reverse pseudonyms, then hard-redact any other-account terms Claude
    // still produced — a report must never show another account's name.
    const finalize = (text) => {
      const reversed = reps.length ? reverseReplacements(text, reps) : text;
      const red = redactForbiddenTerms(reversed, acct.name, settings.accounts || []);
      setRedactedCount(red.count);
      return red.text;
    };

    try {
      const res = await apiFetch("/api/synthesize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify({
          notes: activeNotes,
          apiKey: settings.apiKey || undefined,
          model,
          today: TODAY,
          replacements: reps,
          corrections: settings.corrections || [],
          accountName: acct.name,
          allAccounts: settings.accounts || [],
          restoredIds: [...restoredIds],
          ...(synthesizeExtras ? synthesizeExtras(acct) : {}),
          ...(opts.extraBody || {}),
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Synthesis failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
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
            rawRef.current = accumulated;
            // Redact live too, so another account's name never even flashes.
            setOutput(redactForbiddenTerms(accumulated, acct.name, settings.accounts || []).text);
          } else if (evt.type === "done") {
            setOutput(finalize(accumulated));
            if (evt.usage) setSynthCost(calcCost(evt.usage, evt.model));
            if (evt.droppedCount) setDroppedCount(evt.droppedCount);
            if (evt.summarizedCount) setSummarizedCount(evt.summarizedCount);
          } else if (evt.type === "error") {
            throw new Error(evt.message);
          }
        }
      }
    } catch (e) {
      const message = e.name === "AbortError" ? "Synthesis canceled." : e.message;
      // Keep whatever streamed before the failure — it was paid for.
      if (accumulated.trim()) {
        setPartial(true);
        setOutput(finalize(accumulated));
        setSynthError(`${message} — partial output kept below.`);
      } else {
        setSynthError(message);
      }
    } finally {
      if (synthControllerRef.current === controller) {
        synthControllerRef.current = null;
      }
      setSynthesizing(false);
    }
  }

  function handleCancelSynthesis() {
    synthControllerRef.current?.abort();
  }

  function handleRetrySynthesis() {
    if (lastSynthesisRequest) handleSynthesize(lastSynthesisRequest);
  }

  function handleOutputChange(nextOutput) {
    setOutput(nextOutput);
    rawRef.current = nextOutput;
    setSaved(false);
    setSavedPath("");
    setPartial(false);
    setVerifyFindings(null);
  }

  // Second-pass audit of the generated Markdown report against the scanned
  // sources (misattributed / unsupported / contradicted claims). Requires
  // the notes to still be loaded — after a refresh, re-scan first.
  async function handleVerifyReport() {
    if (!output || !activeNotes?.length) return;
    setVerifying(true);
    try {
      const acct = acctCtx();
      const reps = settings.replacements || [];
      const res = await apiFetch("/api/verify-report", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          report: output,
          notes: activeNotes,
          accountName: acct.name,
          allAccounts: settings.accounts || [],
          replacements: reps,
          corrections: settings.corrections || [],
          restoredIds: [...restoredIds],
          apiKey: settings.apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      const findings = (data.findings || []).map((f) => ({
        ...f,
        quote: reps.length ? reverseReplacements(f.quote || "", reps) : f.quote,
        reason: reps.length ? reverseReplacements(f.reason || "", reps) : f.reason,
      }));
      setVerifyFindings(findings);
    } catch (e) {
      alert(`Verification failed: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  }

  async function handleSave(contentOverride) {
    const content = contentOverride ?? output;
    if (!content || !settings.vaultPath) return;
    setSaving(true);
    try {
      const title = typeof saveTitle === "function" ? saveTitle() : saveTitle;
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: content,
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          meetingTitle: title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);

      // Store the display state (not the vault-format override) so reopening
      // an EA Activity report restores the interactive row view.
      const entry = { title: data.filename || title, path: data.savedPath, ts: Date.now(), content: output || content };
      setHistory((prev) => {
        const next = [entry, ...prev].slice(0, HISTORY_CAP);
        try { localStorage.setItem(`${storageKey}:history`, JSON.stringify(next)); } catch {}
        return next;
      });
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  function openHistoryItem(item) {
    setOutput(item.content);
    rawRef.current = item.content;
    setSaved(true);
    setSavedPath(item.path);
    setPartial(false);
    setSynthError(null);
    setSynthCost(null);
    setRedactedCount(0);
    setSummarizedCount(0);
    setVerifyFindings(null);
    setRestoredFromStorage(false);
  }

  function handleReset() {
    invalidateNotes();
    setOutput("");
    rawRef.current = "";
    setPartial(false);
    setSaved(false);
    setSavedPath("");
    setSynthError(null);
    setLoadError(null);
    setSynthCost(null);
    setRedactedCount(0);
    setVerifyFindings(null);
    setRestoredIds(new Set());
    setScrubOpen(false);
    setRestoredFromStorage(false);
  }

  return {
    TODAY,
    selectedFolder, selectFolder,
    rawNotes, loadedNotes, activeNotes, excludedFiles, toggleNoteExcluded, noteRisks,
    strictFolderOnly, setStrictFolderOnly, loadCounts, loadError, loading, extras,
    showConfirm, setShowConfirm,
    synthesizing, synthError, output, setOutput, partial, redactedCount,
    verifying, verifyFindings, handleVerifyReport,
    saving, saved, savedPath, synthCost, droppedCount,
    summarizedCount, lastSynthesisRequest,
    scrubReport, restoredIds, setRestoredIds, scrubOpen, setScrubOpen,
    model, setModel,
    history, openHistoryItem, restoredFromStorage,
    invalidateNotes, handleLoadNotes, handleSynthesize, handleCancelSynthesis, handleRetrySynthesis, handleOutputChange, handleSave, handleReset,
  };
}
