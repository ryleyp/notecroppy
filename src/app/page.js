"use client";

import { useState, useEffect } from "react";
import Header from "@/components/Header";
import SettingsPanel from "@/components/SettingsPanel";
import MeetingDetails from "@/components/MeetingDetails";
import TranscriptInput from "@/components/TranscriptInput";
import FolderSelector from "@/components/FolderSelector";
import NotesPreview from "@/components/NotesPreview";
import EmailThreadNote from "@/components/EmailThreadNote";
import AccountStatus from "@/components/AccountStatus";
import SystemLinkStatus from "@/components/SystemLinkStatus";
import CSMActivityReport from "@/components/CSMActivityReport";
import StakeholderMap from "@/components/StakeholderMap";
import SanitizeReview from "@/components/SanitizeReview";
import SpeakerReview from "@/components/SpeakerReview";
import ModelPicker from "@/components/ModelPicker";
import { looksSpeakerLabeled } from "@/lib/speakers";
import { FAST_MODEL, MODEL_OPTIONS } from "@/lib/models";
import { useAppSettings } from "@/hooks/useAppSettings";
import { useSpeakerDetection } from "@/hooks/useSpeakerDetection";
import { useSanitizeReview } from "@/hooks/useSanitizeReview";
import { useNoteGeneration } from "@/hooks/useNoteGeneration";
import { useNoteSaving } from "@/hooks/useNoteSaving";

function Spinner({ className = "w-5 h-5" }) {
  return (
    <svg className={`animate-spin ${className}`} fill="none" viewBox="0 0 24 24">
      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
    </svg>
  );
}

export default function Home() {
  const [mode, setMode] = useState("new");

  // Meeting inputs
  const [meetingTitle, setMeetingTitle] = useState("");
  const [transcript, setTranscript] = useState("");
  const [meetingContext, setMeetingContext] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [model, setModel] = useState(FAST_MODEL);

  const meeting = { transcript, meetingTitle, meetingContext, selectedFolder };

  const {
    settings,
    showSettings,
    setShowSettings,
    initialModel,
    saveSettings,
    updateAccounts,
    applySettingsPatch,
  } = useAppSettings({ onSettingsSaved: () => setSelectedFolder("") });

  const saving = useNoteSaving({ settings, meeting });

  const generation = useNoteGeneration({ settings, model, meeting });

  const sanitize = useSanitizeReview({
    settings,
    applySettingsPatch,
    onScanSkipped: generation.setProcessError,
    actions: {
      generate: (replacements) => generation.generate(replacements, { onSaved: saving.clearSaved }),
      saveTranscript: (replacements) => saving.saveTranscript(replacements),
    },
  });

  const speakers = useSpeakerDetection({
    settings,
    onConfirm: (labeledText) => setTranscript(labeledText),
  });

  // Apply the model persisted in settings once it has loaded.
  useEffect(() => {
    if (initialModel) setModel(initialModel);
  }, [initialModel]);



  // Editing the source invalidates a previous transcript-only save.
  const { clearTranscriptSaved } = saving;
  useEffect(() => {
    clearTranscriptSaved();
  }, [transcript, meetingTitle, clearTranscriptSaved]);

  async function handleProcess() {
    if (!transcript.trim()) return;
    if (!settings.vaultPath) { setShowSettings(true); return; }
    generation.setProcessError(null);
    generation.setNotes("");
    saving.clearSaved();
    sanitize.reset();
    await sanitize.run("generate", meeting);
  }

  async function handleSaveTranscriptButton() {
    if (!transcript.trim()) return;
    if (!settings.vaultPath) { setShowSettings(true); return; }
    saving.clearTranscriptSaved();
    sanitize.reset();
    await sanitize.run("saveTranscript", meeting);
  }

  function handleNotesChange(nextNotes) {
    generation.setNotes(nextNotes);
    saving.clearSaved();
    generation.clearFollowUp();
  }

  function handleNewNote() {
    setTranscript("");
    setMeetingContext("");
    setMeetingTitle("");
    generation.reset();
    saving.reset();
    sanitize.reset();
    speakers.reset();
  }

  function handleModeChange(newMode) {
    setMode(newMode);
    setShowSettings(false);
  }

  const modelLabel = MODEL_OPTIONS.find((m) => m.id === model)?.label || "Claude";
  const canProcess = transcript.trim().length > 0 && !generation.processing && !sanitize.sanitizing;

  return (
    <div className="min-h-screen bg-gray-50">
      <Header
        onSettingsClick={() => setShowSettings((v) => !v)}
        isSettingsOpen={showSettings}
        mode={mode}
        onModeChange={handleModeChange}
      />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-4">
        {showSettings && (
          <SettingsPanel
            settings={settings}
            onSave={saveSettings}
            onClose={() => setShowSettings(false)}
          />
        )}

        {/* ── Email Thread mode ── */}
        {mode === "email" && (
          <EmailThreadNote
            settings={settings}
            onSettingsPatch={applySettingsPatch}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}

        {/* ── Account Status mode ── */}
        {mode === "status" && (
          <AccountStatus settings={settings} onSettingsClick={() => setShowSettings(true)} />
        )}

        {/* ── Customer & Site Mapping mode ── */}
        {mode === "mapping" && (
          <StakeholderMap
            settings={settings}
            onSettingsPatch={applySettingsPatch}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}

        {/* ── SystemLink Status mode ── */}
        {mode === "sl-status" && (
          <SystemLinkStatus settings={settings} onSettingsClick={() => setShowSettings(true)} />
        )}

        {/* ── CSM EA Activity Report mode ── */}
        {mode === "csm-activity" && (
          <CSMActivityReport
            settings={settings}
            onAccountsUpdate={updateAccounts}
            onSettingsClick={() => setShowSettings(true)}
          />
        )}

        {/* ── New Note mode ── */}
        {mode === "new" && (
          generation.notes ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h2 className="text-lg font-semibold text-gray-900">Meeting Notes Ready</h2>
                <button onClick={handleNewNote} className="btn-secondary">New Note</button>
              </div>
              <NotesPreview
                notes={generation.notes}
                onSave={() => saving.saveNote(generation.notes)}
                onNotesChange={handleNotesChange}
                saving={saving.saving}
                saved={saving.saved}
                savedPath={saving.savedPath}
                streaming={generation.processing}
                onCancel={generation.cancel}
                onRetry={() => generation.retry({ onSaved: saving.clearSaved })}
                canRetry={!generation.processing}
                todosSaved={saving.todosSaved}
                sfdcReportSaved={saving.sfdcReportSaved}
                cost={generation.noteCost}
                sourceBundle={generation.sourceBundle}
                onRegenerate={(instruction) => generation.regenerate(instruction, { onSaved: saving.clearSaved })}
                regenerating={generation.regenerating}
                regenerateError={generation.regenerateError}
                onGenerateFollowUp={generation.generateFollowUp}
                followUpDraft={generation.followUpDraft}
                followUpLoading={generation.followUpLoading}
                followUpError={generation.followUpError}
                followUpCost={generation.followUpCost}
              />
            </div>
          ) : (
            <>
              <MeetingDetails
                meetingTitle={meetingTitle}
                setMeetingTitle={setMeetingTitle}
                meetingContext={meetingContext}
                setMeetingContext={setMeetingContext}
              />

              <TranscriptInput
                transcript={transcript}
                setTranscript={setTranscript}
                onTitleSuggest={(suggested) => { if (!meetingTitle) setMeetingTitle(suggested); }}
              />


              {transcript.trim() && !speakers.pending && (
                <div className="card p-4 flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-gray-800">Distinguish speakers</p>
                    <p className="text-xs text-gray-500 mt-0.5">
                      {looksSpeakerLabeled(transcript)
                        ? "This transcript has speaker labels — notes will attribute statements to the right person."
                        : "No speaker labels detected. Claude can infer likely speaker turns from conversational patterns (best-effort, not real diarization)."}
                    </p>
                    {speakers.error && <p className="text-xs text-red-600 mt-1">{speakers.error}</p>}
                  </div>
                  <button
                    onClick={() => speakers.detect(transcript)}
                    disabled={speakers.detecting}
                    className="btn-secondary whitespace-nowrap"
                  >
                    {speakers.detecting ? (
                      <>
                        <Spinner className="w-4 h-4" />
                        Analyzing…
                      </>
                    ) : looksSpeakerLabeled(transcript) ? "Re-detect speakers" : "Detect Speakers"}
                  </button>
                </div>
              )}

              {speakers.pending && (
                <SpeakerReview
                  rawText={speakers.pending}
                  onConfirm={speakers.confirm}
                  onSkip={speakers.skip}
                />
              )}

              <FolderSelector
                vaultPath={settings.vaultPath}
                selectedFolder={selectedFolder}
                onSelect={setSelectedFolder}
                onSettingsClick={() => setShowSettings(true)}
              />

              {sanitize.pendingReview && (
                <SanitizeReview
                  detected={sanitize.pendingReview}
                  savedReplacements={settings.replacements || []}
                  onConfirm={sanitize.confirm}
                  onSkip={sanitize.skip}
                />
              )}

              {generation.processError && (
                <div className="card p-4 border-l-4 border-l-red-400">
                  <div className="flex gap-3">
                    <svg className="w-5 h-5 text-red-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <div>
                      <p className="text-sm font-medium text-red-800">Error</p>
                      <p className="text-sm text-red-700 mt-0.5">{generation.processError}</p>
                    </div>
                  </div>
                </div>
              )}

              {!sanitize.pendingReview && (
                <div className="space-y-2">
                  <div className="flex items-center gap-3">
                    <ModelPicker model={model} setModel={setModel} />

                    <button
                      onClick={handleProcess}
                      disabled={!canProcess}
                      className="btn-primary flex-1 py-3.5 text-base"
                    >
                      {sanitize.sanitizing ? (
                        <>
                          <Spinner />
                          Scanning for sensitive terms...
                        </>
                      ) : generation.processing ? (
                        <>
                          <Spinner />
                          Analyzing with Claude {modelLabel}...
                        </>
                      ) : (
                        <>
                          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
                          </svg>
                          Generate Meeting Notes
                        </>
                      )}
                    </button>
                  </div>

                  {/* Save transcript only */}
                  <div className="flex items-center justify-end gap-2 min-h-[1.5rem]">
                    {saving.transcriptSaved ? (
                      <span className="text-xs text-green-600 flex items-center gap-1">
                        <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                        </svg>
                        Transcript saved to <code className="font-mono bg-green-50 px-1 rounded">{saving.transcriptSavedPath}</code>
                      </span>
                    ) : (
                      <button
                        onClick={handleSaveTranscriptButton}
                        disabled={saving.savingTranscript || sanitize.sanitizing || !transcript.trim() || !settings.vaultPath}
                        className="text-xs text-gray-500 hover:text-gray-700 disabled:opacity-40 disabled:cursor-not-allowed underline underline-offset-2"
                      >
                        {saving.savingTranscript
                          ? "Saving..."
                          : sanitize.sanitizing && sanitize.pendingAction === "saveTranscript"
                            ? "Scanning for names..."
                            : "Save transcript without generating notes"}
                      </button>
                    )}
                  </div>
                </div>
              )}
            </>
          )
        )}
      </main>
    </div>
  );
}
