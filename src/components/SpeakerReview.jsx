"use client";

import { useState } from "react";
import { parseSpeakerTurns, buildLabeledTranscript, mergeUp } from "@/lib/speakers";

const PALETTE = [
  "bg-obsidian-50 text-obsidian-700 border-obsidian-200",
  "bg-amber-50 text-amber-700 border-amber-200",
  "bg-blue-50 text-blue-700 border-blue-200",
  "bg-rose-50 text-rose-700 border-rose-200",
  "bg-green-50 text-green-700 border-green-200",
  "bg-purple-50 text-purple-700 border-purple-200",
];

export default function SpeakerReview({ rawText, onConfirm, onSkip }) {
  const [turns, setTurns] = useState(() => parseSpeakerTurns(rawText));
  const [names, setNames] = useState(() => {
    const map = {};
    for (const t of parseSpeakerTurns(rawText)) if (!(t.label in map)) map[t.label] = t.label;
    return map;
  });

  const uniqueLabels = [...new Set(turns.map((t) => t.label))];
  const colorFor = (label) => PALETTE[uniqueLabels.indexOf(label) % PALETTE.length];

  function updateTurnText(i, text) {
    setTurns((prev) => prev.map((t, idx) => (idx === i ? { ...t, text } : t)));
  }

  function handleMergeUp(i) {
    setTurns((prev) => mergeUp(prev, i));
  }

  function handleConfirm() {
    onConfirm(buildLabeledTranscript(turns, names));
  }

  return (
    <div className="card p-6">
      <div className="flex items-start justify-between mb-4">
        <div>
          <h3 className="text-base font-semibold text-gray-900">Speaker Review</h3>
          <p className="text-sm text-gray-500 mt-0.5">
            Claude inferred {uniqueLabels.length} speaker{uniqueLabels.length !== 1 ? "s" : ""} from conversational
            patterns — this is a best-effort guess, not real diarization. Rename speakers to real names and fix any
            wrong turn breaks below, then confirm.
          </p>
        </div>
        <button onClick={onSkip} className="text-xs text-gray-400 hover:text-gray-600 whitespace-nowrap ml-4">
          Skip — use original transcript
        </button>
      </div>

      {uniqueLabels.length > 0 && (
        <div className="mb-4 flex flex-wrap gap-3">
          {uniqueLabels.map((label) => (
            <div key={label} className="flex items-center gap-1.5">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${colorFor(label)}`}>{label}</span>
              <span className="text-gray-300">→</span>
              <input
                type="text"
                value={names[label] || label}
                onChange={(e) => setNames((prev) => ({ ...prev, [label]: e.target.value }))}
                placeholder="Real name (optional)"
                className="text-xs px-2 py-1 rounded border border-gray-200 w-32 focus:outline-none focus:border-obsidian-400"
              />
            </div>
          ))}
        </div>
      )}

      <div className="space-y-1 mb-5 max-h-96 overflow-y-auto pr-1">
        {turns.map((turn, i) => (
          <div key={i}>
            {i > 0 && (
              <div className="flex justify-center -my-1">
                <button
                  onClick={() => handleMergeUp(i)}
                  title="Merge with the turn above (fixes a wrong break)"
                  className="text-[10px] text-gray-300 hover:text-obsidian-600 px-2"
                >
                  ⌃ merge up
                </button>
              </div>
            )}
            <div className="flex gap-2 items-start p-2 rounded-lg border border-gray-100 bg-white">
              <span className={`flex-shrink-0 mt-1 text-xs font-medium px-2 py-0.5 rounded-full border ${colorFor(turn.label)}`}>
                {names[turn.label] || turn.label}
              </span>
              <textarea
                value={turn.text}
                onChange={(e) => updateTurnText(i, e.target.value)}
                rows={Math.min(6, Math.max(1, Math.ceil(turn.text.length / 80)))}
                className="flex-1 text-xs leading-relaxed border-0 focus:outline-none resize-y bg-transparent"
              />
            </div>
          </div>
        ))}
      </div>

      <button onClick={handleConfirm} className="btn-primary w-full py-3 text-base">
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" />
        </svg>
        Apply speaker labels to transcript
      </button>
    </div>
  );
}
