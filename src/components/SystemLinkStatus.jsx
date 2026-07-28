"use client";

import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import { textHasAlias, detectAccount } from "@/lib/accounts";
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

const SL_PRODUCT = {
  name: "SystemLink",
  aliases: ["systemlink", "sls", "sle", "system link", "sl", "sl pro"],
};

function threeMonthsAgoLabel() {
  const d = new Date();
  d.setMonth(d.getMonth() - 3);
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function noteHasSL(note) {
  return SL_PRODUCT.aliases.some((a) => textHasAlias(note.content + " " + note.title, a));
}

// A note qualifies for SL Status if it mentions SystemLink AND is tied to the
// selected account. Notes in the account's own folder are account-scoped by
// location; cross-folder notes must additionally mention an account alias.
function noteMatchesSL(note, accountAliases) {
  if (!noteHasSL(note)) return false;
  if (note.source !== "cross-vault") return true;
  const text = note.content + " " + note.title;
  return (accountAliases || []).some((a) => textHasAlias(text, a));
}

export default function SystemLinkStatus({ settings, onSettingsClick }) {
  const wf = useReportWorkflow({
    settings,
    storageKey: "report:sl-status",
    saveTitle: () => `SystemLink Status ${TODAY}`,
    filterNotes: (note, acct) => noteMatchesSL(note, acct.aliases),
    synthesizeExtras: () => ({ productFocus: SL_PRODUCT }),
  });

  const scrub = {
    scrubReport: wf.scrubReport,
    restoredIds: wf.restoredIds,
    setRestoredIds: wf.setRestoredIds,
    open: wf.scrubOpen,
    setOpen: wf.setScrubOpen,
  };
  const folderLabel = wf.selectedFolder || "(Vault root)";
  const excludedCount = wf.rawNotes && wf.loadedNotes ? wf.rawNotes.length - wf.loadedNotes.length : 0;

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
                <h3 className="text-base font-semibold text-gray-900">SystemLink — Quarter Range</h3>
                <HistoryMenu history={wf.history} onOpen={wf.openHistoryItem} />
              </div>
              <p className="text-sm text-gray-500">
                Scanning <span className="font-medium text-gray-700">{folderLabel}</span> for notes dated{" "}
                <span className="font-medium text-gray-700">{threeMonthsAgoLabel()}</span> or later,
                then filtering to notes mentioning{" "}
                <span className="font-medium text-gray-700">SystemLink, SLS, SLE</span>.
              </p>

              {wf.loadedNotes !== null && (
                <div className="mt-3 space-y-1">
                  {wf.loadedNotes.length === 0 ? (
                    <p className="text-sm text-amber-700 bg-amber-50 rounded-lg px-3 py-2 border border-amber-200 inline-block">
                      No notes mentioning SystemLink found in the past 3 months.
                      {excludedCount > 0 && ` (${excludedCount} account note${excludedCount !== 1 ? "s" : ""} found but none mention SL.)`}
                    </p>
                  ) : (
                    <>
                      <p className="text-sm font-medium text-green-700">
                        {wf.loadedNotes.length} note{wf.loadedNotes.length !== 1 ? "s" : ""} mention SystemLink
                        {excludedCount > 0 && (
                          <span className="font-normal text-gray-400"> · {excludedCount} other account note{excludedCount !== 1 ? "s" : ""} excluded</span>
                        )}
                      </p>
                      <CountsBadges counts={wf.loadCounts} />
                      <NoteList
                        notes={wf.loadedNotes}
                        excludedFiles={wf.excludedFiles}
                        onToggle={wf.toggleNoteExcluded}
                        noteRisks={wf.noteRisks}
                      />
                    </>
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
              buttonLabel="Generate SystemLink Status"
            />
          )}

          {wf.activeNotes?.length > 0 && wf.showConfirm && (
            <PreflightPanel
              intro={
                <>Sending <strong>{wf.activeNotes.length}</strong> SystemLink-related notes to Claude.
                {excludedCount > 0 && ` ${excludedCount} non-SL notes excluded.`}</>
              }
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
            readyTitle="SystemLink Status Ready"
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
