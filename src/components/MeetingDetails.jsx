"use client";

import { useRef } from "react";

export default function MeetingDetails({ meetingTitle, setMeetingTitle, meetingContext, setMeetingContext }) {
  const rawNotesRef = useRef(null);

  function appendToRawNotes(text) {
    const prefix = meetingContext.trim() ? "\n" : "";
    setMeetingContext(`${meetingContext}${prefix}${text}`);
    requestAnimationFrame(() => rawNotesRef.current?.focus());
  }

  function insertBullet() {
    appendToRawNotes("- ");
  }

  function insertTimestamp() {
    const time = new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    appendToRawNotes(`- ${time} - `);
  }

  return (
    <div className="card p-6">
      <div className="flex items-center gap-3 mb-5">
        <StepBadge n={1} />
        <div>
          <h2 className="text-base font-semibold text-gray-900">Meeting Details</h2>
          <p className="text-xs text-gray-500">Give your notes a title (include the date in the title)</p>
        </div>
      </div>

      <div>
        <label className="label">Meeting Title</label>
        <input
          type="text"
          className="input"
          placeholder="e.g. 2026-06-05 - Acme Kickoff"
          value={meetingTitle}
          onChange={(e) => setMeetingTitle(e.target.value)}
          autoFocus
        />
        {meetingTitle && (
          <p className="mt-2 text-xs text-gray-400">
            Generated notes will be saved as{" "}
            <span className="font-mono bg-gray-100 px-1.5 py-0.5 rounded text-gray-600">
              {meetingTitle}.md
            </span>
          </p>
        )}
      </div>

      <div className="mt-4">
        <div className="flex items-center justify-between gap-3 mb-2">
          <label className="label mb-0">Raw Notes &amp; Context <span className="font-normal text-gray-400">(optional)</span></label>
          <div className="flex items-center gap-2">
            <button type="button" onClick={insertBullet} className="btn-secondary text-xs px-2.5 py-1.5">Bullet</button>
            <button type="button" onClick={insertTimestamp} className="btn-secondary text-xs px-2.5 py-1.5">Timestamp</button>
            {meetingContext && (
              <button
                type="button"
                onClick={() => setMeetingContext("")}
                className="text-xs text-gray-500 hover:text-red-600"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <textarea
          ref={rawNotesRef}
          className="input resize-y text-xs leading-relaxed"
          rows={7}
          placeholder={"e.g. Quarterly sync with Dana (Acme EA admin) and Jordan. Follow-up to the June SystemLink migration briefing.\nMy notes: Dana wants SL Pro rollout confirmed before August; sounded frustrated about Data Bridge re-ingestion."}
          value={meetingContext}
          onChange={(e) => setMeetingContext(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-between text-xs text-gray-400">
          <span>{meetingContext.trim() ? meetingContext.trim().split(/\s+/).length.toLocaleString() : 0} words</span>
          <span>Used as source IDs N1, N2, ... when notes are generated</span>
        </div>
      </div>
    </div>
  );
}

export function StepBadge({ n }) {
  return (
    <span className="flex-shrink-0 w-7 h-7 rounded-full bg-obsidian-600 text-white text-sm font-bold flex items-center justify-center">
      {n}
    </span>
  );
}
