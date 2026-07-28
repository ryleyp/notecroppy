"use client";

import { useRef, useState } from "react";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { calcCost } from "@/lib/models";
import { detectAccount, suggestAgreements } from "@/lib/accounts";
import { buildSourceBundle, mapSourceBundle } from "@/lib/sourceBundle";
import { apiFetch } from "@/lib/apiClient";

// Reads an SSE body of {type: delta|done|error} events, invoking onDelta with
// the running text. Returns the final usage payload. Shared by generate and
// regenerate, which previously carried near-identical copies of this loop.
async function consumeStream(response, onDelta) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let accumulated = "";
  let buffer = "";
  let usage = null;

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
        onDelta(accumulated);
      } else if (evt.type === "done") {
        usage = evt.usage;
      } else if (evt.type === "error") {
        throw new Error(evt.message);
      }
    }
  }
  return { accumulated, usage };
}

// Owns the generated note and everything that produces or revises it:
// initial generation, regeneration with an instruction, and the follow-up
// email draft.
export function useNoteGeneration({ settings, model, meeting }) {
  const [processing, setProcessing] = useState(false);
  const [processError, setProcessError] = useState(null);
  const [notes, setNotes] = useState("");
  const [noteCost, setNoteCost] = useState(null);
  const [sourceBundle, setSourceBundle] = useState(null);
  const [activeReplacements, setActiveReplacements] = useState([]);
  const [lastGenerationRequest, setLastGenerationRequest] = useState(null);

  const [regenerating, setRegenerating] = useState(false);
  const [regenerateError, setRegenerateError] = useState(null);

  const [followUpDraft, setFollowUpDraft] = useState("");
  const [followUpLoading, setFollowUpLoading] = useState(false);
  const [followUpError, setFollowUpError] = useState(null);
  const [followUpCost, setFollowUpCost] = useState(null);

  const controllerRef = useRef(null);

  function clearFollowUp() {
    setFollowUpDraft("");
    setFollowUpError(null);
    setFollowUpCost(null);
  }

  function sanitizer(replacements) {
    const corrections = settings.corrections || [];
    return (text) => {
      const corrected = applyCorrections(text || "", corrections);
      return replacements.length ? applyReplacements(corrected, replacements) : corrected;
    };
  }

  async function streamGenerateRequest(requestConfig, { onSaved } = {}) {
    const { payload, replacements, displaySourceBundle } = requestConfig;
    const controller = new AbortController();
    controllerRef.current = controller;

    setLastGenerationRequest(requestConfig);
    setSourceBundle(displaySourceBundle || payload.sourceBundle || null);
    setProcessing(true);
    setProcessError(null);
    setRegenerateError(null);
    setNotes("");
    setNoteCost(null);
    clearFollowUp();
    onSaved?.();

    try {
      const res = await apiFetch("/api/process", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        signal: controller.signal,
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Processing failed");
      }

      const { accumulated, usage } = await consumeStream(res, setNotes);
      if (usage) setNoteCost(calcCost(usage, model));
      setNotes(replacements.length ? reverseReplacements(accumulated, replacements) : accumulated);

      if (settings.transcriptsPath) {
        const { transcript, meetingTitle, selectedFolder } = meeting;
        const correctedTranscript = replacements.length
          ? reverseReplacements(applyReplacements(transcript, replacements), replacements)
          : transcript;
        apiFetch("/api/save-transcript", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            transcript: correctedTranscript,
            meetingTitle,
            transcriptsPath: settings.transcriptsPath,
            folder: selectedFolder || undefined,
            accounts: settings.accounts || [],
          }),
        }).catch(() => {});
      }
    } catch (e) {
      setProcessError(e.name === "AbortError" ? "Generation canceled." : e.message);
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      setProcessing(false);
    }
  }

  async function generate(replacements, { onSaved } = {}) {
    setActiveReplacements(replacements);
    const { transcript, meetingTitle, meetingContext, selectedFolder } = meeting;
    const sanitize = sanitizer(replacements);

    const sanitizedTranscript = sanitize(transcript);
    const sanitizedTitle = sanitize(meetingTitle);
    const sanitizedContext = sanitize(meetingContext);

    const promptSourceBundle = buildSourceBundle({
      transcript: sanitizedTranscript,
      rawNotes: sanitizedContext,
    });
    const displaySourceBundle = replacements.length
      ? mapSourceBundle(promptSourceBundle, (content) => reverseReplacements(content, replacements))
      : promptSourceBundle;

    // Match this account's EA/EP numbers against the raw transcript by keyword.
    // Done on the original text (not the pseudonymized copy) so matching is exact.
    const acct = detectAccount(selectedFolder, settings.accounts);
    const account = (settings.accounts || []).find((a) => a.name === acct.name);
    const suggestedAgreements = account ? suggestAgreements(transcript, account) : [];

    await streamGenerateRequest({
      payload: {
        transcript: sanitizedTranscript,
        meetingContext: sanitizedContext,
        meetingTitle: sanitizedTitle,
        apiKey: settings.apiKey || undefined,
        model,
        suggestedAgreements,
        sourceBundle: promptSourceBundle,
        accounts: settings.accounts || [],
      },
      replacements,
      displaySourceBundle,
    }, { onSaved });
  }

  async function regenerate(instruction, { onSaved } = {}) {
    if (!notes.trim()) return;
    const replacements = activeReplacements || [];
    const sanitize = sanitizer(replacements);
    const sanitizedNotes = replacements.length ? applyReplacements(notes, replacements) : notes;

    setRegenerating(true);
    setRegenerateError(null);
    setProcessError(null);
    clearFollowUp();
    onSaved?.();

    try {
      const res = await apiFetch("/api/regenerate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: sanitizedNotes,
          instruction: sanitize(instruction),
          meetingTitle: sanitize(meeting.meetingTitle),
          apiKey: settings.apiKey || undefined,
          model,
          sourceBundle: lastGenerationRequest?.payload?.sourceBundle || null,
        }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Regeneration failed");
      }

      const restore = (text) => (replacements.length ? reverseReplacements(text, replacements) : text);
      const { accumulated, usage } = await consumeStream(res, (text) => setNotes(restore(text)));
      if (usage) setNoteCost(calcCost(usage, model));
      setNotes(restore(accumulated));
    } catch (e) {
      setRegenerateError(e.message);
    } finally {
      setRegenerating(false);
    }
  }

  async function generateFollowUp({ audience, tone, instructions }) {
    if (!notes.trim()) return;
    const replacements = activeReplacements || [];
    const sanitize = sanitizer(replacements);
    const sanitizedNotes = replacements.length ? applyReplacements(notes, replacements) : notes;

    setFollowUpLoading(true);
    setFollowUpError(null);
    setFollowUpDraft("");
    setFollowUpCost(null);
    try {
      const res = await apiFetch("/api/follow-up", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          notes: sanitizedNotes,
          meetingTitle: sanitize(meeting.meetingTitle),
          apiKey: settings.apiKey || undefined,
          model,
          audience,
          tone,
          instructions: sanitize(instructions || ""),
          sourceBundle: lastGenerationRequest?.payload?.sourceBundle || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Follow-up draft failed");
      setFollowUpDraft(replacements.length ? reverseReplacements(data.draft, replacements) : data.draft);
      if (data.usage) setFollowUpCost(calcCost(data.usage, model));
    } catch (e) {
      setFollowUpError(e.message);
    } finally {
      setFollowUpLoading(false);
    }
  }

  function cancel() {
    controllerRef.current?.abort();
  }

  function retry({ onSaved } = {}) {
    if (lastGenerationRequest) streamGenerateRequest(lastGenerationRequest, { onSaved });
  }

  function reset() {
    setNotes("");
    setNoteCost(null);
    setProcessError(null);
    setRegenerateError(null);
    setActiveReplacements([]);
    setLastGenerationRequest(null);
    setSourceBundle(null);
    clearFollowUp();
  }

  return {
    notes,
    setNotes,
    processing,
    processError,
    setProcessError,
    noteCost,
    sourceBundle,
    activeReplacements,
    regenerating,
    regenerateError,
    followUpDraft,
    followUpLoading,
    followUpError,
    followUpCost,
    clearFollowUp,
    generate,
    regenerate,
    generateFollowUp,
    cancel,
    retry,
    reset,
  };
}
