"use client";

import { useState } from "react";
import { applyCorrections, applyReplacements, reverseReplacements } from "@/lib/sanitize";
import { apiFetch } from "@/lib/apiClient";

// Best-effort speaker segmentation for raw dictation, which merges every
// speaker into one stream. Known glossary replacements are applied before the
// call and reversed after, so only terms already in the glossary are protected
// — the same privacy tradeoff the sanitize scan makes.
export function useSpeakerDetection({ settings, onConfirm }) {
  const [detecting, setDetecting] = useState(false);
  const [pending, setPending] = useState(null); // null | segmented text
  const [error, setError] = useState(null);

  async function detect(transcript) {
    if (!transcript.trim()) return;
    setError(null);
    setDetecting(true);
    try {
      const replacements = settings.replacements || [];
      const sanitized = applyReplacements(
        applyCorrections(transcript, settings.corrections || []),
        replacements
      );
      const res = await apiFetch("/api/detect-speakers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ transcript: sanitized, apiKey: settings.apiKey || undefined }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Speaker detection failed");
      setPending(replacements.length ? reverseReplacements(data.segmented, replacements) : data.segmented);
    } catch (e) {
      setError(e.message);
    } finally {
      setDetecting(false);
    }
  }

  function confirm(labeledText) {
    onConfirm?.(labeledText);
    setPending(null);
  }

  function skip() {
    setPending(null);
  }

  function reset() {
    setPending(null);
    setError(null);
  }

  return { detecting, pending, error, detect, confirm, skip, reset };
}
