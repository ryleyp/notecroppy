"use client";

import { useMemo, useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import ActivityPreview from "@/components/ActivityPreview";
import { detectAccount } from "@/lib/accounts";
import { reverseReplacements } from "@/lib/sanitize";
import { apiFetch } from "@/lib/apiClient";
import { useReportWorkflow, TODAY } from "@/hooks/useReportWorkflow";
import { ScanButton, CountsBadges, NoteList, GeneratePanel, PreflightPanel, OutputHeader, HistoryMenu, BleedWarning, StrictToggle } from "@/components/ReportSections";
import { parseActivityRows, rowsToNDJSON, rowsToMarkdown } from "@/lib/activityRows";

function toISO(d) {
  return d.toISOString().split("T")[0];
}

function defaultRangeStart() {
  const d = new Date();
  d.setMonth(d.getMonth() - 4);
  return toISO(d);
}

// NI fiscal year starts in October; FY is named for the year it ends in
// (FY26 = Oct 2025 – Sep 2026). Q1 = Oct–Dec, Q2 = Jan–Mar, Q3 = Apr–Jun,
// Q4 = Jul–Sep. Current fiscal quarter plus the three before it, newest first.
const FY_START_MONTH = 9; // October, 0-indexed

function quarterPresets() {
  const now = new Date();
  let fy = now.getFullYear() + (now.getMonth() >= FY_START_MONTH ? 1 : 0);
  let q = Math.floor(((now.getMonth() - FY_START_MONTH + 12) % 12) / 3); // 0..3
  const presets = [];
  for (let i = 0; i < 4; i++) {
    const startMonth = FY_START_MONTH + q * 3; // months past Jan of fy-1; may exceed 11
    presets.push({
      label: `Q${q + 1} FY${String(fy).slice(2)}`,
      start: toISO(new Date(fy - 1, startMonth, 1)),
      end: toISO(new Date(fy - 1, startMonth + 3, 0)),
    });
    q--;
    if (q < 0) { q = 3; fy--; }
  }
  return presets;
}

function prettyDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

// Candidate account-identifying terms in a row's text (capitalized sequences),
// used to prefill the bleed-feedback panel.
const GENERIC = new Set(["CSM", "FAE", "The", "This", "That", "Region", "Attendees", "Outcome", "Type", "Subtype", "NI", "EA", "ROI", "QBR", "EBR", "SLE", "SLS", "LabVIEW", "TestStand", "SystemLink", "Python", "Linux"]);

function extractCandidateTerms(row, ownTerms) {
  const text = `${row.title} ${row.comments}`;
  const own = new Set((ownTerms || []).map((t) => t.toLowerCase()));
  const found = new Set();
  for (const m of text.matchAll(/\b([A-Z][a-zA-Z0-9'-]{2,}(?:\s+[A-Z][a-zA-Z0-9'-]{2,}){0,2})\b/g)) {
    const t = m[1];
    if (GENERIC.has(t) || own.has(t.toLowerCase())) continue;
    if (t.split(/\s+/).every((w) => GENERIC.has(w))) continue;
    found.add(t);
  }
  return [...found].slice(0, 6);
}

export default function CSMActivityReport({ settings, onSettingsClick, onAccountsUpdate }) {
  const [rangeStart, setRangeStart] = useState(defaultRangeStart());
  const [rangeEnd, setRangeEnd] = useState(TODAY);
  const [verifying, setVerifying] = useState(false);
  const [bleedRow, setBleedRow] = useState(null); // row index being flagged
  const [bleedAccount, setBleedAccount] = useState("");
  const [bleedTerms, setBleedTerms] = useState("");

  const wf = useReportWorkflow({
    settings,
    storageKey: "report:ea-activity",
    saveTitle: () => `EA Activity Report ${TODAY}`,
    buildNotesParams: (params) => {
      params.set("startDate", rangeStart);
      params.set("endDate", rangeEnd);
    },
    synthesizeExtras: () => ({ promptType: "csm-activity", rangeStart, rangeEnd }),
  });

  const rows = useMemo(() => parseActivityRows(wf.output), [wf.output]);
  const accountName = detectAccount(wf.selectedFolder, settings.accounts).name;

  // note title (lowercased) -> origin, so the table can badge cross-folder sources
  const sourceInfo = useMemo(() => {
    const map = {};
    for (const n of wf.loadedNotes || []) {
      map[(n.title || "").toLowerCase()] = { source: n.source, sourceLabel: n.sourceLabel };
    }
    return map;
  }, [wf.loadedNotes]);

  function updateRow(i, patch) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    wf.setOutput(rowsToNDJSON(next));
  }

  function handleRangeChange(start, end) {
    setRangeStart(start);
    setRangeEnd(end);
    // Loaded notes were fetched for the old range — force a re-scan.
    wf.invalidateNotes();
  }

  function handleResume() {
    wf.handleSynthesize({
      append: true,
      extraBody: { resumeRows: rows.map(({ eventDate, title }) => ({ eventDate, title })) },
    });
  }

  // Second-pass audit: check each row against its cited source.
  async function handleVerify() {
    if (!rows.length || !wf.activeNotes?.length) return;
    setVerifying(true);
    try {
      const res = await apiFetch("/api/verify-rows", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          rows,
          notes: wf.activeNotes,
          accountName,
          allAccounts: settings.accounts || [],
          replacements: settings.replacements || [],
          corrections: settings.corrections || [],
          restoredIds: [...wf.restoredIds],
          apiKey: settings.apiKey || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Verification failed");
      const reps = settings.replacements || [];
      const next = rows.map((r, i) => {
        const v = (data.verdicts || []).find((x) => x.index === i);
        if (!v) return r;
        const reason = reps.length ? reverseReplacements(v.reason || "", reps) : v.reason || "";
        return { ...r, verify: v.supported ? "passed" : "failed", verifyReason: reason };
      });
      wf.setOutput(rowsToNDJSON(next));
    } catch (e) {
      alert(`Verification failed: ${e.message}`);
    } finally {
      setVerifying(false);
    }
  }

  // Bleed feedback: user marks a row as another account's content.
  function openBleedPanel(i) {
    const row = rows[i];
    const ownTerms = (settings.accounts || [])
      .filter((a) => a.name === accountName)
      .flatMap((a) => [a.name, ...(a.aliases || []), ...(a.keywords || [])]);
    setBleedRow(i);
    setBleedAccount("");
    setBleedTerms(extractCandidateTerms(row, ownTerms).join(", "));
  }

  function confirmBleed() {
    const terms = bleedTerms.split(",").map((s) => s.trim()).filter(Boolean);
    if (bleedAccount && terms.length && onAccountsUpdate) {
      const nextAccounts = (settings.accounts || []).map((a) => {
        if (a.name !== bleedAccount) return a;
        const existing = (a.keywords || []).map((k) => k.toLowerCase());
        return { ...a, keywords: [...(a.keywords || []), ...terms.filter((t) => !existing.includes(t.toLowerCase()))] };
      });
      onAccountsUpdate(nextAccounts);
    }
    // Remove the misattributed row regardless.
    wf.setOutput(rowsToNDJSON(rows.filter((_, idx) => idx !== bleedRow)));
    setBleedRow(null);
  }

  const otherAccounts = (settings.accounts || []).filter((a) => a.name !== accountName && a.name !== "Internal");
  const scrub = { scrubReport: wf.scrubReport, restoredIds: wf.restoredIds, setRestoredIds: wf.setRestoredIds, open: wf.scrubOpen, setOpen: wf.setScrubOpen };
  const folderLabel = wf.selectedFolder || "(Vault root)";

  return (
    <div className="space-y-4">
      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={wf.selectedFolder}
        onSelect={wf.selectFolder}
        onSettingsClick={onSettingsClick}
      />

      {settings.vaultPath && !wf.output && (
        <div className="card p-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-3 mb-1">
                <h3 className="text-base font-semibold text-gray-900">EA Activity Report</h3>
                <HistoryMenu history={wf.history} onOpen={wf.openHistoryItem} />
              </div>
              <p className="text-sm text-gray-500">
                Scanning <span className="font-medium text-gray-700">{folderLabel}</span> for notes dated{" "}
                <span className="font-medium text-gray-700">{prettyDate(rangeStart)}</span> through{" "}
                <span className="font-medium text-gray-700">{prettyDate(rangeEnd)}</span>, then generating a CSM activity table.
              </p>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <input
                  type="date"
                  value={rangeStart}
                  max={rangeEnd}
                  onChange={(e) => handleRangeChange(e.target.value, rangeEnd)}
                  className="input !w-auto text-xs py-1.5"
                />
                <span className="text-xs text-gray-400">to</span>
                <input
                  type="date"
                  value={rangeEnd}
                  min={rangeStart}
                  onChange={(e) => handleRangeChange(rangeStart, e.target.value)}
                  className="input !w-auto text-xs py-1.5"
                />
                <div className="flex gap-1.5 flex-wrap">
                  {quarterPresets().map((p) => {
                    const active = rangeStart === p.start && rangeEnd === p.end;
                    return (
                      <button
                        key={p.label}
                        type="button"
                        onClick={() => handleRangeChange(p.start, p.end)}
                        className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                          active
                            ? "bg-obsidian-600 text-white border-obsidian-600"
                            : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                        }`}
                      >
                        {p.label}
                      </button>
                    );
                  })}
                  <button
                    type="button"
                    onClick={() => handleRangeChange(defaultRangeStart(), TODAY)}
                    className={`px-2.5 py-1 rounded-full text-xs font-medium border transition-colors ${
                      rangeStart === defaultRangeStart() && rangeEnd === TODAY
                        ? "bg-obsidian-600 text-white border-obsidian-600"
                        : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    Last 4 months
                  </button>
                </div>
              </div>

              {wf.loadedNotes !== null && (
                <div className="mt-3">
                  {wf.loadedNotes.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No notes found in this folder for the selected date range.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {wf.loadedNotes.length} note{wf.loadedNotes.length !== 1 ? "s" : ""} in the selected range
                      </p>
                      <CountsBadges counts={wf.loadCounts} />
                      <NoteList notes={wf.loadedNotes} excludedFiles={wf.excludedFiles} onToggle={wf.toggleNoteExcluded} noteRisks={wf.noteRisks} />
                    </div>
                  )}
                </div>
              )}

              {wf.loadError && <p className="mt-2 text-sm text-red-600">{wf.loadError}</p>}
            </div>

            <div className="flex flex-col items-end">
              <ScanButton loading={wf.loading} scanned={wf.loadedNotes !== null} onClick={wf.handleLoadNotes} disabled={wf.loading || !settings.vaultPath} />
              <StrictToggle strict={wf.strictFolderOnly} setStrict={wf.setStrictFolderOnly} disabled={wf.loading} />
            </div>
          </div>

          {wf.activeNotes?.length > 0 && !wf.showConfirm && (
            <GeneratePanel
              scrub={scrub}
              model={wf.model}
              setModel={wf.setModel}
              synthError={wf.synthError}
              onGenerate={() => wf.setShowConfirm(true)}
              synthesizing={wf.synthesizing}
              buttonLabel="Generate EA Activity Report"
            />
          )}

          {wf.activeNotes?.length > 0 && wf.showConfirm && (
            <PreflightPanel
              intro={<>Sending <strong>{wf.activeNotes.length}</strong> notes to Claude to generate an EA Engagement Activity Report table.</>}
              notes={wf.activeNotes}
              loadCounts={wf.loadCounts}
              model={wf.model}
              setModel={wf.setModel}
              scrub={scrub}
              onCancel={() => wf.setShowConfirm(false)}
              onConfirm={() => wf.handleSynthesize()}
              synthesizing={wf.synthesizing}
            />
          )}
        </div>
      )}

      {(wf.output || wf.synthesizing) && (
        <div className="space-y-4">
          <OutputHeader
            synthesizing={wf.synthesizing}
            readyTitle="EA Activity Report Ready"
            onReset={wf.handleReset}
            droppedCount={wf.droppedCount}
            restoredFromStorage={wf.restoredFromStorage}
            history={wf.history}
            onOpenHistory={wf.openHistoryItem}
          />
          {wf.partial && !wf.synthesizing && (
            <div className="flex items-center justify-between gap-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <span>{wf.synthError || "Generation stopped early — partial output kept."}</span>
              {wf.activeNotes?.length ? (
                <button onClick={handleResume} className="btn-secondary text-xs px-3 py-1 whitespace-nowrap">
                  Resume generation
                </button>
              ) : (
                <span className="text-gray-500 whitespace-nowrap">Re-scan the folder to resume.</span>
              )}
            </div>
          )}
          <BleedWarning
            output={wf.output}
            accountName={detectAccount(wf.selectedFolder, settings.accounts).name}
            allAccounts={settings.accounts || []}
            streaming={wf.synthesizing}
            redactedCount={wf.redactedCount}
          />
          {bleedRow !== null && rows[bleedRow] && (
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
              <p className="text-xs font-semibold text-red-800">
                Flag bleed: "{rows[bleedRow].title}"
              </p>
              <p className="text-xs text-red-700">
                Which account does this actually belong to? The terms below will be added to that
                account's keywords so future reports scrub and redact them automatically. The row is removed either way.
              </p>
              <div className="flex flex-wrap gap-2 items-center">
                <select
                  value={bleedAccount}
                  onChange={(e) => setBleedAccount(e.target.value)}
                  className="input !w-auto text-xs py-1.5"
                >
                  <option value="">(don't add keywords)</option>
                  {otherAccounts.map((a) => (
                    <option key={a.name} value={a.name}>{a.name}</option>
                  ))}
                </select>
                <input
                  type="text"
                  value={bleedTerms}
                  onChange={(e) => setBleedTerms(e.target.value)}
                  placeholder="Terms to add as keywords, comma-separated"
                  className="input flex-1 text-xs py-1.5 min-w-48"
                />
                <button onClick={confirmBleed} className="btn-primary text-xs px-3 py-1.5">
                  {bleedAccount ? "Add keywords & remove row" : "Remove row"}
                </button>
                <button onClick={() => setBleedRow(null)} className="btn-secondary text-xs px-3 py-1.5">Cancel</button>
              </div>
            </div>
          )}
          {wf.output && (
            <ActivityPreview
              rows={rows}
              rawText={wf.output}
              streaming={wf.synthesizing}
              onUpdateRow={updateRow}
              onSave={() => wf.handleSave(rows.length ? rowsToMarkdown(rows) : wf.output)}
              saving={wf.saving}
              saved={wf.saved}
              savedPath={wf.savedPath}
              cost={wf.synthCost}
              sourceInfo={sourceInfo}
              onVerify={handleVerify}
              verifying={verifying}
              onFlagBleed={openBleedPanel}
            />
          )}
          {wf.synthesizing && !wf.output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for Claude…</div>
          )}
        </div>
      )}
    </div>
  );
}
