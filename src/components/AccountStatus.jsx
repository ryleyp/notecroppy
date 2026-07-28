"use client";

import { useState } from "react";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { detectAccount } from "@/lib/accounts";
import { useReportWorkflow, TODAY } from "@/hooks/useReportWorkflow";
import {
  ScanButton,
  CountsBadges,
  NoteList,
  GeneratePanel,
  PreflightPanel,
  OutputHeader,
  HistoryMenu,
  BleedWarning,
  StrictToggle,
  VerifyFindings,
} from "@/components/ReportSections";
import { apiFetch } from "@/lib/apiClient";

function threeMonthsAgoLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

export default function AccountStatus({ settings, onSettingsClick }) {
  const [vaultScanOpen, setVaultScanOpen] = useState(false);

  const wf = useReportWorkflow({
    settings,
    storageKey: "report:account-status",
    saveTitle: () => `Account Status ${TODAY}`,
    // Vault-wide all-time scan for files mentioning this account.
    loadExtras: async (acct) => {
      if (!acct.aliases?.length) return null;
      const scanParams = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (settings.transcriptsPath) scanParams.set("transcriptsPath", settings.transcriptsPath);
      scanParams.set("accounts", JSON.stringify([{ name: acct.name, archiveFolder: acct.archiveFolder, aliases: acct.aliases || [] }]));
      try {
        const res = await apiFetch(`/api/scan-vault?${scanParams}`);
        const data = await res.json();
        if (res.ok && data.results?.[0]?.files?.length) {
          return { files: data.results[0].files, total: data.total };
        }
      } catch {}
      return null;
    },
  });

  const scrub = {
    scrubReport: wf.scrubReport,
    restoredIds: wf.restoredIds,
    setRestoredIds: wf.setRestoredIds,
    open: wf.scrubOpen,
    setOpen: wf.setScrubOpen,
  };
  const folderLabel = wf.selectedFolder || "(Vault root)";
  const vaultScan = wf.extras;

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
                <h3 className="text-base font-semibold text-gray-900">Quarter Range</h3>
                <HistoryMenu history={wf.history} onOpen={wf.openHistoryItem} />
              </div>
              <p className="text-sm text-gray-500">
                Scanning <span className="font-medium text-gray-700">{folderLabel}</span> for notes dated{" "}
                <span className="font-medium text-gray-700">{threeMonthsAgoLabel()}</span> or later.
              </p>

              {wf.loadedNotes !== null && (
                <div className="mt-3">
                  {wf.loadedNotes.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No notes with dates in the past 3 months found in this folder.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      <p className="text-sm font-medium text-green-700">
                        Found {wf.loadedNotes.length} note{wf.loadedNotes.length !== 1 ? "s" : ""} in the past quarter
                      </p>
                      <CountsBadges counts={wf.loadCounts} />
                      <NoteList
                        notes={wf.loadedNotes}
                        excludedFiles={wf.excludedFiles}
                        onToggle={wf.toggleNoteExcluded}
                        noteRisks={wf.noteRisks}
                      />
                    </div>
                  )}

                  {vaultScan && (
                    <div className="mt-2 pt-2 border-t border-gray-100">
                      <button
                        onClick={() => setVaultScanOpen((v) => !v)}
                        className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-700"
                      >
                        <svg className={`w-3.5 h-3.5 transition-transform ${vaultScanOpen ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                        </svg>
                        {vaultScan.files.length} file{vaultScan.files.length !== 1 ? "s" : ""} mention this account across all time
                      </button>
                      {vaultScanOpen && (
                        <ul className="mt-1.5 text-xs text-gray-500 space-y-0.5 max-h-40 overflow-y-auto pl-5">
                          {vaultScan.files.map((f, i) => (
                            <li key={i} className="flex gap-2">
                              <span className="font-mono text-gray-400 flex-shrink-0">{f.date || "-"}</span>
                              <span className="truncate">{f.title}</span>
                              <span className="text-gray-400 flex-shrink-0 italic">{f.location}</span>
                            </li>
                          ))}
                        </ul>
                      )}
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
              buttonLabel="Generate Account Status"
            />
          )}

          {wf.activeNotes?.length > 0 && wf.showConfirm && (
            <PreflightPanel
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
            readyTitle="Account Status Ready"
            onReset={wf.handleReset}
            droppedCount={wf.droppedCount}
            restoredFromStorage={wf.restoredFromStorage}
            history={wf.history}
            onOpenHistory={wf.openHistoryItem}
            onVerify={wf.handleVerifyReport}
            verifying={wf.verifying}
            verifyDisabled={!wf.activeNotes?.length}
          />
          {wf.summarizedCount > 0 && (
            <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-lg px-3 py-2">
              {wf.summarizedCount} older note{wf.summarizedCount !== 1 ? "s" : ""} were compressed first so newer full notes and older context could both inform the report.
            </p>
          )}
          <VerifyFindings findings={wf.verifyFindings} />
          {wf.partial && wf.synthError && (
            <p className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{wf.synthError}</p>
          )}
          <BleedWarning
            output={wf.output}
            accountName={detectAccount(wf.selectedFolder, settings.accounts).name}
            allAccounts={settings.accounts || []}
            streaming={wf.synthesizing}
            redactedCount={wf.redactedCount}
          />
          {wf.output && (
            <NotesPreview
              notes={wf.output}
              onNotesChange={wf.handleOutputChange}
              onSave={() => wf.handleSave()}
              saving={wf.saving}
              saved={wf.saved}
              savedPath={wf.savedPath}
              cost={wf.synthCost}
              streaming={wf.synthesizing}
              onCancel={wf.handleCancelSynthesis}
              onRetry={wf.handleRetrySynthesis}
              canRetry={!!wf.lastSynthesisRequest && !wf.synthesizing}
            />
          )}
          {wf.synthesizing && !wf.output && (
            <div className="card p-6 text-sm text-gray-500 animate-pulse">Waiting for Claude...</div>
          )}
        </div>
      )}
    </div>
  );
}
