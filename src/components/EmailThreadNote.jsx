"use client";

import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import FolderSelector from "@/components/FolderSelector";
import ModelPicker from "@/components/ModelPicker";
import SanitizeReview from "@/components/SanitizeReview";
import {
  applyCorrections,
  applyReplacements,
  assignAliases,
  correctionFromRestoredItem,
  mergeCorrections,
  reverseReplacements,
} from "@/lib/sanitize";
import { aliasesFromReplacements } from "@/lib/privacy";
import { buildSourceBundle, mapSourceBundle } from "@/lib/sourceBundle";
import { apiFetch } from "@/lib/apiClient";
import { FAST_MODEL, calcCost, formatCost } from "@/lib/models";

function todayIso() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function filenameTitle(threadDate, threadTitle) {
  const title = threadTitle.trim() || "Email Thread";
  return `${threadDate || todayIso()} - Email - ${title}`;
}

function inferTitleFromThread(text) {
  const subject = text.match(/^subject:\s*(.+)$/im)?.[1]?.trim();
  if (!subject) return "";
  return subject.replace(/^(re|fw|fwd):\s*/i, "").trim();
}

export default function EmailThreadNote({ settings, onSettingsPatch, onSettingsClick }) {
  const [threadTitle, setThreadTitle] = useState("");
  const [threadDate, setThreadDate] = useState(todayIso());
  const [threadContext, setThreadContext] = useState("");
  const [emailThread, setEmailThread] = useState("");
  const [selectedFolder, setSelectedFolder] = useState("");
  const [model, setModel] = useState(FAST_MODEL);
  const [pendingReview, setPendingReview] = useState(null);
  const [processing, setProcessing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [note, setNote] = useState("");
  const [savedPath, setSavedPath] = useState("");
  const [cost, setCost] = useState(null);

  const wordCount = emailThread.trim() ? emailThread.trim().split(/\s+/).length : 0;
  const canCreate = emailThread.trim() && !processing && !saving;

  function clearOutput() {
    setPendingReview(null);
    setNote("");
    setSavedPath("");
    setError(null);
    setCost(null);
  }

  function handleThreadChange(value) {
    clearOutput();
    setEmailThread(value);
    if (!threadTitle) {
      const inferred = inferTitleFromThread(value);
      if (inferred) setThreadTitle(inferred);
    }
  }

  async function runSanitizeDetection() {
    const savedReplacements = settings.replacements || [];
    const correctedTitle = applyCorrections(threadTitle, settings.corrections || []);
    const correctedThread = applyCorrections(emailThread, settings.corrections || []);
    const correctedContext = applyCorrections(threadContext, settings.corrections || []);

    const scanText = [
      applyReplacements(correctedTitle, savedReplacements),
      applyReplacements(correctedThread, savedReplacements),
      applyReplacements(correctedContext, savedReplacements),
    ].filter((part) => part && part.trim()).join("\n\n");

    setProcessing(true);
    setError(null);
    try {
      let newEntities = [];
      let scanSkipped = !settings.aiPrivacyScan;
      if (settings.aiPrivacyScan) {
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
          const data = await res.json();
          if (data.skipped) scanSkipped = true;
          newEntities = data.entities || [];
        } catch {
          scanSkipped = true;
        }
      }

      if (newEntities.length > 0) {
        setPendingReview(assignAliases(newEntities, savedReplacements));
        return;
      }

      if (scanSkipped && settings.aiPrivacyScan) {
        setError("Sensitivity scan skipped — set your API key in Settings to enable name/company detection.");
      }
      await createAndSave(savedReplacements);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewConfirm(confirmed, toSave) {
    let updatedSettings = settings;
    const correctionsToSave = toSave.map(correctionFromRestoredItem).filter(Boolean);

    if (toSave.length > 0 || correctionsToSave.length > 0) {
      const newReplacements = [
        ...(settings.replacements || []),
        ...toSave.map((r) => ({ original: r.text, alias: r.alias, restored: r.restored || r.text })),
      ];
      const newCorrections = correctionsToSave.length
        ? mergeCorrections(settings.corrections || [], correctionsToSave)
        : settings.corrections || [];
      updatedSettings = onSettingsPatch({
        replacements: newReplacements,
        corrections: newCorrections,
      });
    }

    setPendingReview(null);

    const replacements = [
      ...(updatedSettings.replacements || []),
      ...confirmed
        .filter((c) => !(updatedSettings.replacements || []).some((r) => r.original === c.text))
        .map((c) => ({ original: c.text, alias: c.alias, restored: c.restored || c.text })),
    ];

    setProcessing(true);
    try {
      await createAndSave(replacements);
    } finally {
      setProcessing(false);
    }
  }

  async function handleReviewSkip() {
    setPendingReview(null);
    setProcessing(true);
    try {
      await createAndSave(settings.replacements || []);
    } finally {
      setProcessing(false);
    }
  }

  async function createAndSave(replacements) {
    if (!emailThread.trim()) return;
    if (!settings.vaultPath) {
      onSettingsClick();
      return;
    }

    setSavedPath("");
    setCost(null);
    setError(null);
    setNote("");

    const correctedTitle = applyCorrections(threadTitle, settings.corrections || []);
    const correctedThread = applyCorrections(emailThread, settings.corrections || []);
    const correctedContext = applyCorrections(threadContext, settings.corrections || []);
    const sanitizedTitle = replacements.length ? applyReplacements(correctedTitle, replacements) : correctedTitle;
    const sanitizedThread = replacements.length ? applyReplacements(correctedThread, replacements) : correctedThread;
    const sanitizedContext = replacements.length ? applyReplacements(correctedContext, replacements) : correctedContext;
    const sourceBundle = buildSourceBundle({ emailThread: sanitizedThread, rawNotes: sanitizedContext });
    const displaySourceBundle = replacements.length
      ? mapSourceBundle(sourceBundle, (content) => reverseReplacements(content, replacements))
      : sourceBundle;

    try {
      const res = await apiFetch("/api/email-thread", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          emailThread: sanitizedThread,
          threadTitle: sanitizedTitle || "Email Thread",
          threadDate,
          context: sanitizedContext,
          apiKey: settings.apiKey || undefined,
          model,
          sourceBundle,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Email note generation failed");

      const restoredNote = replacements.length ? reverseReplacements(data.note, replacements) : data.note;
      setNote(restoredNote);
      if (data.usage) setCost(calcCost(data.usage, model));

      setSaving(true);
      const saveRes = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: restoredNote,
          vaultPath: settings.vaultPath,
          folderPath: selectedFolder,
          meetingTitle: filenameTitle(threadDate, correctedTitle || "Email Thread"),
        }),
      });
      const saveData = await saveRes.json();
      if (!saveRes.ok) throw new Error(saveData.error || "Save failed");
      setSavedPath(saveData.savedPath);
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }

    return displaySourceBundle;
  }

  function handleNewThread() {
    setThreadTitle("");
    setThreadDate(todayIso());
    setThreadContext("");
    setEmailThread("");
    setPendingReview(null);
    setNote("");
    setSavedPath("");
    setError(null);
    setCost(null);
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4 mb-5">
          <div>
            <h2 className="text-base font-semibold text-gray-900">Email Thread Note</h2>
            <p className="text-xs text-gray-500 mt-0.5">Paste a customer thread and save a dated decisions note to Obsidian</p>
          </div>
          {note && (
            <button type="button" onClick={handleNewThread} className="btn-secondary text-xs">New Thread</button>
          )}
        </div>

        <div className="grid sm:grid-cols-[1fr_auto] gap-3 mb-4">
          <div>
            <label className="label">Thread Title</label>
            <input
              className="input"
              value={threadTitle}
              onChange={(event) => {
                clearOutput();
                setThreadTitle(event.target.value);
              }}
              placeholder="e.g. SystemLink license cleanup follow-up"
            />
          </div>
          <div>
            <label className="label">Note Date</label>
            <input
              type="date"
              className="input"
              value={threadDate}
              onChange={(event) => {
                clearOutput();
                setThreadDate(event.target.value);
              }}
            />
          </div>
        </div>

        <div className="mb-4">
          <label className="label">CSM Context <span className="font-normal text-gray-400">(optional)</span></label>
          <textarea
            className="input resize-y text-xs leading-relaxed"
            rows={3}
            value={threadContext}
            onChange={(event) => {
              clearOutput();
              setThreadContext(event.target.value);
            }}
            placeholder="Anything the email thread won't explain on its own: account, project, stakeholder roles, or what you need the note to emphasize."
          />
        </div>

        <div>
          <label className="label">Email Thread</label>
          <textarea
            className="input resize-y font-mono text-xs leading-relaxed"
            rows={16}
            value={emailThread}
            onChange={(event) => handleThreadChange(event.target.value)}
            placeholder="Paste the thread here, including subject/from/date lines if you have them..."
          />
          <div className="mt-2 flex items-center justify-between text-xs text-gray-500">
            <span>{wordCount.toLocaleString()} words</span>
            {emailThread && (
              <button type="button" onClick={() => setEmailThread("")} className="text-red-500 hover:text-red-700">Clear</button>
            )}
          </div>
        </div>
      </div>

      <FolderSelector
        vaultPath={settings.vaultPath}
        selectedFolder={selectedFolder}
        onSelect={(folder) => {
          clearOutput();
          setSelectedFolder(folder);
        }}
        onSettingsClick={onSettingsClick}
        stepNumber={2}
      />

      {pendingReview && (
        <SanitizeReview
          detected={pendingReview}
          savedReplacements={settings.replacements || []}
          onConfirm={handleReviewConfirm}
          onSkip={handleReviewSkip}
        />
      )}

      {error && (
        <div className="card p-4 border-l-4 border-l-red-400">
          <p className="text-sm font-medium text-red-800">Error</p>
          <p className="text-sm text-red-700 mt-0.5">{error}</p>
        </div>
      )}

      {!pendingReview && (
        <div className="card p-4 flex items-center justify-between gap-3">
          <ModelPicker model={model} setModel={setModel} />

          <button
            type="button"
            onClick={runSanitizeDetection}
            disabled={!canCreate}
            className="btn-primary flex-1 py-3 text-base"
          >
            {processing ? "Anonymizing and generating..." : saving ? "Saving..." : "Create Email Note"}
          </button>
        </div>
      )}

      {savedPath && (
        <div className="card p-4 border-l-4 border-l-green-400">
          <div className="flex items-center justify-between gap-3">
            <p className="text-sm text-green-700">
              Saved to <code className="font-mono text-xs bg-green-50 px-1.5 py-0.5 rounded">{savedPath}</code>
            </p>
            {cost && <span className="text-xs text-gray-400 font-mono">{formatCost(cost)}</span>}
          </div>
        </div>
      )}

      {note && (
        <div className="card overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-200 bg-gray-50 flex items-center justify-between">
            <h2 className="section-header mb-0">Generated Email Note</h2>
            <button
              type="button"
              onClick={() => navigator.clipboard.writeText(note).catch(() => {})}
              className="btn-secondary text-xs"
            >
              Copy
            </button>
          </div>
          <div className="p-6 markdown-preview max-h-[650px] overflow-y-auto">
            <ReactMarkdown remarkPlugins={[remarkGfm]}>{note}</ReactMarkdown>
          </div>
        </div>
      )}
    </div>
  );
}
