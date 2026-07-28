"use client";

import { useState } from "react";
import { formatCost } from "@/lib/models";
import { rowsToMarkdown } from "@/lib/activityRows";

const COMMENT_LIMIT = 800;

const COLUMNS = [
  { key: "eventDate", label: "Event Date" },
  { key: "title", label: "Title" },
  { key: "type", label: "Type" },
  { key: "subtype", label: "Subtype" },
  { key: "comments", label: "Comments" },
];

export default function ActivityPreview({ rows, rawText, streaming, onUpdateRow, onSave, saving, saved, savedPath, cost, sourceInfo, onVerify, verifying, onFlagBleed }) {
  const [viewMode, setViewMode] = useState("table");
  const [copiedKey, setCopiedKey] = useState(null);
  const [editing, setEditing] = useState(null); // "row-col" key

  const copy = (text, key) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey((k) => (k === key ? null : k)), 1200);
    }).catch(() => {});
  };

  const markdown = rows.length ? rowsToMarkdown(rows) : rawText;
  const reviewCount = rows.filter((r) => r.review).length;
  const failedCount = rows.filter((r) => r.verify === "failed").length;

  // Look up where a row's cited source note came from (cross-folder = risky).
  const sourceMeta = (row) => {
    if (!sourceInfo || !row.sourceTitle) return null;
    const st = row.sourceTitle.toLowerCase();
    for (const [title, meta] of Object.entries(sourceInfo)) {
      if (title.includes(st) || st.includes(title)) return meta;
    }
    return null;
  };

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="section-header mb-0">EA Activity Table</h2>
          {cost && !streaming && (
            <span className="text-xs text-gray-400 font-mono">{formatCost(cost)}</span>
          )}
          {rows.length > 0 && (
            <span className="text-xs text-gray-400">{rows.length} activit{rows.length !== 1 ? "ies" : "y"}</span>
          )}
          {!streaming && reviewCount > 0 && (
            <span className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5">
              ⚠ {reviewCount} row{reviewCount !== 1 ? "s" : ""} to review
            </span>
          )}
          {!streaming && failedCount > 0 && (
            <span className="text-xs text-red-700 bg-red-50 border border-red-200 rounded-full px-2 py-0.5">
              ✗ {failedCount} failed verification
            </span>
          )}
          {streaming && (
            <span className="flex items-center gap-1 text-xs text-obsidian-600 font-medium">
              <svg className="animate-spin w-3 h-3" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Generating...
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
            <button
              onClick={() => setViewMode("table")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "table" ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              SFDC View
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "raw" ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Markdown
            </button>
          </div>
          {onVerify && rows.length > 0 && !streaming && (
            <button
              onClick={onVerify}
              disabled={verifying}
              className="btn-secondary text-xs px-3 py-1.5"
              title="Second-pass audit: a fast model checks each row against its cited source to confirm it's genuinely this account's activity"
            >
              {verifying ? "Verifying…" : "Verify vs sources"}
            </button>
          )}
          <button onClick={() => copy(markdown, "all")} className="btn-secondary text-xs px-3 py-1.5">
            {copiedKey === "all" ? "Copied!" : "Copy All"}
          </button>
        </div>
      </div>

      <div className="p-6">
        {viewMode === "raw" ? (
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-[600px] overflow-y-auto leading-relaxed">
            {markdown}
          </pre>
        ) : rows.length === 0 ? (
          <pre className="text-xs font-mono text-gray-700 whitespace-pre-wrap max-h-[600px] overflow-y-auto leading-relaxed">
            {rawText || "Waiting for rows…"}
          </pre>
        ) : (
          <>
            <p className="text-xs text-gray-400 mb-2">
              Click a cell to copy it for Salesforce entry. Click a comment to edit it in place.
              {reviewCount > 0 && " Rows marked ⚠ need a classification double-check."}
            </p>
            <div className="overflow-x-auto max-h-[600px] overflow-y-auto">
              <table className="w-full text-xs border-collapse">
                <thead>
                  <tr className="bg-gray-100">
                    {COLUMNS.map((c) => (
                      <th key={c.key} className="border border-gray-200 px-2 py-1.5 text-left font-semibold sticky top-0 bg-gray-100">{c.label}</th>
                    ))}
                    <th className="border border-gray-200 px-2 py-1.5 sticky top-0 bg-gray-100" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, r) => (
                    <tr key={r} className={row.verify === "failed" ? "bg-red-50" : row.review ? "bg-amber-50" : r % 2 === 1 ? "bg-gray-50" : ""}>
                      {COLUMNS.map((c) => {
                        const key = `${r}-${c.key}`;
                        const text = row[c.key] || "";
                        const isComment = c.key === "comments";
                        const isTitle = c.key === "title";
                        const meta = isTitle ? sourceMeta(row) : null;
                        const over = isComment && text.length > COMMENT_LIMIT;
                        const isEditing = editing === key;

                        if (isComment && isEditing) {
                          return (
                            <td key={c.key} className="border border-gray-200 p-1 align-top w-2/5">
                              <textarea
                                autoFocus
                                defaultValue={text}
                                rows={Math.max(4, Math.ceil(text.length / 70))}
                                onBlur={(e) => { onUpdateRow(r, { comments: e.target.value }); setEditing(null); }}
                                className="input w-full text-xs font-normal leading-relaxed"
                              />
                              <p className="text-[10px] text-gray-400 mt-0.5">Click away to apply</p>
                            </td>
                          );
                        }

                        return (
                          <td
                            key={c.key}
                            onClick={() => (isComment ? setEditing(key) : copy(text, key))}
                            title={isComment ? "Click to edit" : "Click to copy"}
                            className={`border border-gray-200 px-2 py-1.5 align-top cursor-pointer transition-colors hover:bg-obsidian-50 ${
                              copiedKey === key ? "bg-green-50" : ""
                            } ${isComment ? "w-2/5" : ""}`}
                          >
                            {copiedKey === key && <span className="text-green-600 font-medium mr-1">✓ Copied</span>}
                            {text}
                            {isTitle && row.sourceTitle && (
                              <div className="mt-0.5 text-[10px] text-gray-400">
                                from: {row.sourceTitle}
                                {meta?.source === "cross-vault" && (
                                  <span className="ml-1 text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-1" title="Source note came from another folder — double-check attribution">
                                    cross-folder
                                  </span>
                                )}
                              </div>
                            )}
                            {isComment && (
                              <div className="mt-1 flex items-center gap-2">
                                <span className={`font-mono text-[10px] ${over ? "text-red-600 font-bold" : "text-gray-400"}`}>
                                  {text.length}/{COMMENT_LIMIT}{over ? " — over limit" : ""}
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); copy(text, `${key}-copy`); }}
                                  className="text-[10px] text-gray-400 hover:text-gray-600 underline"
                                >
                                  {copiedKey === `${key}-copy` ? "copied!" : "copy"}
                                </button>
                              </div>
                            )}
                          </td>
                        );
                      })}
                      <td className="border border-gray-200 px-1 py-1.5 align-top">
                        <div className="flex flex-col items-center gap-1">
                          <button
                            onClick={() => copy(COLUMNS.map((c) => row[c.key] || "").join("\t"), `row-${r}`)}
                            title="Copy row (tab-separated)"
                            className="text-gray-400 hover:text-gray-600 p-0.5"
                          >
                            {copiedKey === `row-${r}` ? (
                              <svg className="w-3.5 h-3.5 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                              </svg>
                            ) : (
                              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                              </svg>
                            )}
                          </button>
                          {row.review && (
                            <span title={row.reviewReason || "Classification uncertain"} className="text-amber-600 cursor-help">⚠</span>
                          )}
                          {row.verify === "passed" && (
                            <span title={row.verifyReason || "Verified against source"} className="text-green-600 cursor-help">✓</span>
                          )}
                          {row.verify === "failed" && (
                            <span title={row.verifyReason || "Not supported by cited source"} className="text-red-600 cursor-help">✗</span>
                          )}
                          {onFlagBleed && (
                            <button
                              onClick={() => onFlagBleed(r)}
                              title="This row is another account's content — teach the filter and remove it"
                              className="text-gray-300 hover:text-red-500 text-xs"
                            >
                              ⚑
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some((r) => r.review && r.reviewReason) && !streaming && (
              <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-amber-800">Classification notes from Claude:</p>
                {rows.map((row, r) => row.review && row.reviewReason ? (
                  <p key={r} className="text-xs text-amber-700">• <span className="font-medium">{row.title}</span>: {row.reviewReason}</p>
                ) : null)}
              </div>
            )}
            {rows.some((r) => r.verify === "failed") && !streaming && (
              <div className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 space-y-1">
                <p className="text-xs font-semibold text-red-800">Rows that failed source verification — likely misattributed, review before filing:</p>
                {rows.map((row, r) => row.verify === "failed" ? (
                  <p key={r} className="text-xs text-red-700">• <span className="font-medium">{row.title}</span>: {row.verifyReason || "not supported by cited source"}</p>
                ) : null)}
              </div>
            )}
          </>
        )}
      </div>

      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-4">
        {saved ? (
          <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200 flex-1">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
            <span>Saved to <code className="font-mono text-xs bg-green-100 px-1 rounded">{savedPath}</code></span>
          </div>
        ) : (
          <p className="text-sm text-gray-500">Ready to save to your Obsidian vault.</p>
        )}

        <button onClick={onSave} disabled={saving || saved || streaming} className="btn-success whitespace-nowrap">
          {saving ? (
            <>
              <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Saving...
            </>
          ) : saved ? (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              Saved!
            </>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7H5a2 2 0 00-2 2v9a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-3m-1 4l-3 3m0 0l-3-3m3 3V4" />
              </svg>
              Save to Obsidian
            </>
          )}
        </button>
      </div>
    </div>
  );
}
