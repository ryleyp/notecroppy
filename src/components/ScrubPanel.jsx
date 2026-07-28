"use client";

// Collapsible orange panel listing lines flagged by the keyword scrubber.
// Checked lines are "restored" (kept) — unchecked lines are removed before
// notes are sent to Claude.
export default function ScrubPanel({ scrubReport, restoredIds, setRestoredIds, open, setOpen, idPrefix, className = "" }) {
  if (!scrubReport.length) return null;

  return (
    <div className={`${className} rounded-lg border border-orange-200 bg-orange-50 overflow-hidden`}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 text-xs text-orange-800 hover:bg-orange-100 transition-colors"
      >
        <span>
          {restoredIds.size > 0
            ? `${scrubReport.length - restoredIds.size} of ${scrubReport.length} flagged line${scrubReport.length !== 1 ? "s" : ""} will be scrubbed`
            : `${scrubReport.length} line${scrubReport.length !== 1 ? "s" : ""} will be scrubbed (keyword filter)`}
        </span>
        <svg className={`w-3 h-3 flex-shrink-0 transition-transform ${open ? "rotate-90" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>
      </button>
      {open && (
        <ul className="divide-y divide-orange-100 max-h-52 overflow-y-auto">
          {scrubReport.map((item) => (
            <li key={item.id} className="flex gap-2 items-start px-3 py-1.5">
              <input
                type="checkbox"
                id={`${idPrefix}${item.id}`}
                checked={restoredIds.has(item.id)}
                onChange={(e) => {
                  const next = new Set(restoredIds);
                  if (e.target.checked) next.add(item.id);
                  else next.delete(item.id);
                  setRestoredIds(next);
                }}
                className="mt-0.5 flex-shrink-0 accent-orange-600"
              />
              <label htmlFor={`${idPrefix}${item.id}`} className="text-xs cursor-pointer leading-relaxed">
                <span className="font-mono text-orange-500 mr-1">{item.noteDate}</span>
                <span className="text-orange-700 mr-1 font-medium">{item.noteTitle} —</span>
                <span className="text-gray-700">{item.line.trim()}</span>
              </label>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <p className="px-3 py-1.5 text-xs text-orange-600 border-t border-orange-100">
          Check a line to keep it — unchecked lines are removed before sending to Claude.
        </p>
      )}
    </div>
  );
}
