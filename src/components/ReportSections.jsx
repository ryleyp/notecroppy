"use client";

import { useMemo, useState } from "react";
import ScrubPanel from "@/components/ScrubPanel";
import ModelPicker from "@/components/ModelPicker";
import { contextLimit, estimateUsage } from "@/lib/models";
import { findAccountBleed } from "@/lib/scrub";

export function Spinner({ className = "w-4 h-4" }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export function ScanButton({ loading, scanned, onClick, disabled }) {
  return (
    <button onClick={onClick} disabled={disabled} className="btn-secondary whitespace-nowrap">
      {loading ? (<><Spinner /> Scanning...</>) : scanned ? "Re-scan" : "Scan Folder"}
    </button>
  );
}

export function CountsBadges({ counts, className = "" }) {
  if (!counts) return null;
  return (
    <div className={`flex gap-3 text-xs text-gray-500 flex-wrap ${className}`}>
      {counts.obsidian > 0 && <span>📝 {counts.obsidian} Obsidian</span>}
      {counts.transcripts > 0 && <span>📄 {counts.transcripts} Transcripts</span>}
      {counts.crossVault > 0 && <span>🔍 {counts.crossVault} Cross-folder</span>}
    </div>
  );
}

// When excludedFiles/onToggle are provided, each note gets an include
// checkbox — unchecking drops that note from what is sent to Claude
// (useful for multi-account internal meetings that don't belong in an
// account-scoped report).
export function NoteList({ notes, excludedFiles, onToggle, noteRisks }) {
  const selectable = excludedFiles instanceof Set && typeof onToggle === "function";
  return (
    <ul className="text-xs text-gray-500 space-y-0.5 max-h-32 overflow-y-auto">
      {notes.map((n) => {
        const excluded = selectable && excludedFiles.has(n.filename);
        const risk = noteRisks?.[n.filename];
        return (
          <li key={n.filename} className={`flex gap-2 items-center ${excluded ? "opacity-40 line-through" : ""}`}>
            {selectable && (
              <input
                type="checkbox"
                checked={!excluded}
                onChange={() => onToggle(n.filename)}
                title={excluded ? "Excluded — click to include" : "Included — click to exclude from this report"}
                className="flex-shrink-0 accent-obsidian-600"
              />
            )}
            <span className="font-mono text-gray-400 flex-shrink-0">{n.date}</span>
            <span className="truncate">{n.title}</span>
            {risk && (
              <span
                title={`Mentions ${risk.account} ${risk.hits}× vs this account ${risk.ownHits}× — auto-excluded, check to include anyway`}
                className="flex-shrink-0 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1.5"
              >
                mostly {risk.account}?
              </span>
            )}
            {n.source !== "obsidian" && (
              <span className="text-gray-400 flex-shrink-0 italic">{n.sourceLabel}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// Per-run isolation switch: skip cross-folder search so only the account's
// own folder feeds the report.
export function StrictToggle({ strict, setStrict, disabled }) {
  return (
    <label className={`flex items-center gap-1.5 text-xs mt-2 ${disabled ? "text-gray-300" : "text-gray-500 cursor-pointer"}`}>
      <input
        type="checkbox"
        checked={strict}
        disabled={disabled}
        onChange={(e) => setStrict(e.target.checked)}
        className="accent-obsidian-600"
      />
      Account folder only
      <span title="Skips cross-folder search. Strictest isolation — multi-account notes from other folders never enter the report. Re-scan after changing.">ⓘ</span>
    </label>
  );
}

// The section shown after a successful scan, before pre-flight:
// scrub panel, model picker, error, and the big generate button.
export function GeneratePanel({ scrub, model, setModel, synthError, onGenerate, synthesizing, buttonLabel }) {
  return (
    <div className="mt-5 pt-5 border-t border-gray-100">
      <ScrubPanel {...scrub} idPrefix="pre-" className="mb-4" />
      <div className="flex items-center gap-3 mb-4">
        <span className="text-xs text-gray-500 font-medium">Model</span>
        <ModelPicker model={model} setModel={setModel} />
      </div>
      {synthError && (
        <p className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg px-3 py-2 border border-red-200">{synthError}</p>
      )}
      <button onClick={onGenerate} disabled={synthesizing} className="btn-primary w-full py-3 text-base">
        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
        </svg>
        {buttonLabel}
      </button>
    </div>
  );
}

// Pre-flight confirm: token/cost estimate, compact model picker, scrub, confirm.
export function PreflightPanel({ intro, notes, loadCounts, model, setModel, scrub, onCancel, onConfirm, synthesizing }) {
  const est = estimateUsage(notes, model);
  const limit = contextLimit(model);
  const warnAt = limit - 20_000;
  return (
    <div className="mt-5 pt-5 border-t border-gray-100">
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-800">Pre-flight check</h4>
        <ModelPicker model={model} setModel={setModel} compact />
      </div>
      <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 space-y-3 text-sm">
        {intro && <p className="text-xs text-gray-600">{intro}</p>}
        <CountsBadges counts={loadCounts} className="text-gray-600" />
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
            Input is near or over this model's {(limit / 1000).toLocaleString()}k token limit — oldest notes will be trimmed automatically to fit. Switch models above to include more notes.
          </p>
        )}
        <p className="text-xs text-amber-700">
          Sanitized note content will be sent to Claude. Names in your glossary are replaced before sending.
        </p>
      </div>
      <ScrubPanel {...scrub} idPrefix="" className="mt-3" />
      <div className="flex gap-3 mt-3">
        <button onClick={onCancel} className="btn-secondary flex-1">Cancel</button>
        <button onClick={onConfirm} disabled={synthesizing} className="btn-primary flex-1 py-3">
          {synthesizing ? (<><Spinner className="w-5 h-5" /> Synthesizing…</>) : "Confirm — Send to Claude"}
        </button>
      </div>
    </div>
  );
}

export function OutputHeader({ synthesizing, readyTitle, onReset, droppedCount, restoredFromStorage, history, onOpenHistory, onVerify, verifying, verifyDisabled }) {
  return (
    <>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-gray-900">
            {synthesizing ? "Generating…" : readyTitle}
          </h2>
          {synthesizing && <Spinner className="w-4 h-4 text-teal-600" />}
          {!synthesizing && restoredFromStorage && (
            <span className="text-xs text-gray-400 border border-gray-200 rounded-full px-2 py-0.5">restored from last session</span>
          )}
        </div>
        {!synthesizing && (
          <div className="flex items-center gap-2">
            {onVerify && (
              <button
                onClick={onVerify}
                disabled={verifying || verifyDisabled}
                title={verifyDisabled ? "Re-scan the folder first — verification needs the source notes loaded" : "Second-pass audit: a fast model checks the report against the scanned sources for misattributed or unsupported claims"}
                className="btn-secondary text-xs px-3 py-1.5"
              >
                {verifying ? "Verifying…" : "Verify vs sources"}
              </button>
            )}
            {history && onOpenHistory && <HistoryMenu history={history} onOpen={onOpenHistory} />}
            <button onClick={onReset} className="btn-secondary">Start Over</button>
          </div>
        )}
      </div>
      {droppedCount > 0 && (
        <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
          {droppedCount} older note{droppedCount !== 1 ? "s" : ""} were excluded to stay within the model's context limit. The summary covers your most recent notes.
        </p>
      )}
    </>
  );
}

// Results of the report-level source audit. null = not run; [] = clean.
export function VerifyFindings({ findings }) {
  if (findings === null || findings === undefined) return null;
  if (!findings.length) {
    return (
      <p className="text-xs text-green-700 bg-green-50 border border-green-200 rounded-lg px-3 py-2">
        ✓ Verification passed — no misattributed, unsupported, or contradicted claims found.
      </p>
    );
  }
  const label = { misattributed: "Misattributed", unsupported: "Unsupported", contradiction: "Contradicts sources" };
  return (
    <div className="rounded-lg border border-red-200 bg-red-50 p-3 space-y-2">
      <p className="text-xs font-semibold text-red-800">
        ⚠ Verification found {findings.length} issue{findings.length !== 1 ? "s" : ""} — review before saving or filing:
      </p>
      {findings.map((f, i) => (
        <div key={i} className="text-xs text-red-700">
          <span className="font-medium">[{label[f.problem] || f.problem}]</span>{" "}
          {f.quote && <em>"{f.quote}"</em>}
          {f.reason && <span className="text-red-600"> — {f.reason}</span>}
        </div>
      ))}
    </div>
  );
}

// Post-generation account isolation status. Generated output is hard-redacted
// by the workflow hook; this reports how much was redacted, and — as a
// failsafe for content that bypassed redaction (e.g. reports saved before
// redaction existed and reopened from history) — warns if other-account terms
// are still present.
export function BleedWarning({ output, accountName, allAccounts, streaming, redactedCount = 0 }) {
  const hits = useMemo(
    () => (streaming ? [] : findAccountBleed(output, accountName, allAccounts)),
    [output, accountName, allAccounts, streaming]
  );
  if (streaming || (!hits.length && !redactedCount)) return null;
  return (
    <div className="space-y-2">
      {redactedCount > 0 && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2">
          <p className="text-xs text-blue-700">
            🔒 {redactedCount} mention{redactedCount !== 1 ? "s" : ""} of other accounts {redactedCount !== 1 ? "were" : "was"} automatically redacted (shown as █████). Consider deleting those rows/sections before filing.
          </p>
        </div>
      )}
      {hits.length > 0 && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-3 py-2 space-y-1">
          <p className="text-xs font-semibold text-red-800">
            ⚠ Account bleed detected — this report mentions terms tied to other accounts:
          </p>
          {hits.map((h) => (
            <p key={h.account} className="text-xs text-red-700">
              • <span className="font-medium">{h.account}</span>: {h.terms.join(", ")}
            </p>
          ))}
          <p className="text-xs text-red-600">
            Review before pasting into Salesforce. Edit the offending rows/sections, or regenerate.
          </p>
        </div>
      )}
    </div>
  );
}

// Collapsible list of previously saved reports (from localStorage history).
export function HistoryMenu({ history, onOpen }) {
  const [open, setOpen] = useState(false);
  if (!history?.length) return null;
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="btn-secondary text-xs px-3 py-1.5">
        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        History ({history.length})
      </button>
      {open && (
        <div className="absolute right-0 mt-1 w-80 max-h-72 overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg z-20">
          {history.map((h, i) => (
            <button
              key={i}
              onClick={() => { onOpen(h); setOpen(false); }}
              className="w-full text-left px-3 py-2 hover:bg-gray-50 border-b border-gray-100 last:border-0"
            >
              <div className="text-xs font-medium text-gray-800 truncate">{h.title}</div>
              <div className="text-xs text-gray-400">
                {new Date(h.ts).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
                {h.path ? ` · ${h.path}` : ""}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
