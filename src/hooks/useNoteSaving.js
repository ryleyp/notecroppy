"use client";

import { useCallback, useState } from "react";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { matchVaultFolder } from "@/lib/accounts";
import { apiFetch } from "@/lib/apiClient";

// Writing to the vault: the note itself, plus the two best-effort weekly
// side files (todos and the SFDC activity report), plus the transcript-only
// save path.
export function useNoteSaving({ settings, meeting }) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [savedPath, setSavedPath] = useState("");
  const [todosSaved, setTodosSaved] = useState(null);
  const [sfdcReportSaved, setSfdcReportSaved] = useState(null);

  const [savingTranscript, setSavingTranscript] = useState(false);
  const [transcriptSaved, setTranscriptSaved] = useState(false);
  const [transcriptSavedPath, setTranscriptSavedPath] = useState("");

  // When no folder is picked, infer one from the content; fall back to the
  // vault's Internal folder.
  async function resolveAutoFolder(content) {
    const { selectedFolder } = meeting;
    if (!settings.vaultPath || selectedFolder) return selectedFolder;
    try {
      const res = await apiFetch(`/api/folders?vaultPath=${encodeURIComponent(settings.vaultPath)}`);
      const data = await res.json();
      const folders = (data.folders || []).filter((f) => f.path !== "");
      const matched = matchVaultFolder(content, folders, settings.accounts);
      if (matched) return matched;
      const internal = folders.find((f) => f.name.toLowerCase().includes("internal"));
      return internal?.path || "";
    } catch {
      return selectedFolder;
    }
  }

  const clearSaved = useCallback(() => {
    setSaved(false);
    setSavedPath("");
    setTodosSaved(null);
    setSfdcReportSaved(null);
  }, []);

  async function saveNote(notes) {
    const { meetingTitle } = meeting;
    if (!notes || !settings.vaultPath) return;
    setSaving(true);
    try {
      const folderPath = await resolveAutoFolder(`${meetingTitle} ${notes}`);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notes, vaultPath: settings.vaultPath, folderPath, meetingTitle }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setSaved(true);
      setSavedPath(data.savedPath);

      // Append this note's action items to the weekly todos file.
      try {
        const todosRes = await apiFetch("/api/todos", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            notes,
            vaultPath: settings.vaultPath,
            meetingTitle,
            ownerNames: settings.ownerNames || [],
          }),
        });
        const todosData = await todosRes.json();
        if (todosData.count > 0) setTodosSaved({ count: todosData.count, path: todosData.savedPath });
      } catch {
        // Todos extraction is best-effort.
      }

      // Append the SFDC Activity Entry to this week's report file.
      try {
        const reportRes = await apiFetch("/api/sfdc-report", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ notes, vaultPath: settings.vaultPath, meetingTitle }),
        });
        const reportData = await reportRes.json();
        if (reportData.savedPath) setSfdcReportSaved({ path: reportData.savedPath });
      } catch {
        // Weekly report append is best-effort.
      }
    } catch (e) {
      alert(`Failed to save: ${e.message}`);
    } finally {
      setSaving(false);
    }
  }

  async function saveTranscript(replacements) {
    const { transcript, meetingTitle } = meeting;
    if (!transcript.trim() || !settings.vaultPath) return;
    const withCorrections = applyCorrections(transcript, settings.corrections || []);
    const corrected = replacements.length
      ? reverseReplacements(applyReplacements(withCorrections, replacements), replacements)
      : withCorrections;

    setSavingTranscript(true);
    try {
      const title = meetingTitle || "Transcript";
      const folderPath = await resolveAutoFolder(`${title} ${corrected}`);
      const res = await apiFetch("/api/save", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: `# ${title}\n\n${corrected}`,
          vaultPath: settings.vaultPath,
          folderPath,
          meetingTitle: title,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Save failed");
      setTranscriptSaved(true);
      setTranscriptSavedPath(data.savedPath);

      if (settings.transcriptsPath) {
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: corrected,
            meetingTitle: title,
            transcriptsPath: settings.transcriptsPath,
            folder: folderPath || undefined,
            accounts: settings.accounts || [],
          }),
        }).catch(() => {});
      }
    } catch (e) {
      alert(`Failed to save transcript: ${e.message}`);
    } finally {
      setSavingTranscript(false);
    }
  }

  const clearTranscriptSaved = useCallback(() => {
    setTranscriptSaved(false);
    setTranscriptSavedPath("");
  }, []);

  function reset() {
    clearSaved();
    clearTranscriptSaved();
  }

  return {
    saving,
    saved,
    savedPath,
    todosSaved,
    sfdcReportSaved,
    savingTranscript,
    transcriptSaved,
    transcriptSavedPath,
    saveNote,
    saveTranscript,
    clearSaved,
    clearTranscriptSaved,
    reset,
  };
}
