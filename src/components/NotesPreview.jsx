"use client";

import { Children, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { formatCost } from "@/lib/models";
import { extractReferencedSourceIds, sourceExcerpt } from "@/lib/sourceBundle";

function textFromChildren(children) {
  return Children.toArray(children)
    .map((child) => (typeof child === "string" ? child : ""))
    .join("");
}

function Paragraph({ children }) {
  const text = textFromChildren(children).trim();
  if (/^(#[a-z][a-z0-9-]*\s*)+$/i.test(text)) {
    return (
      <div className="mb-2 flex flex-wrap gap-1">
        {text.split(/\s+/).map((tag) => (
          <span
            key={tag}
            className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
            style={{ background: "#FFF3C4", color: "#7A3500" }}
          >
            {tag}
          </span>
        ))}
      </div>
    );
  }

  return <p>{children}</p>;
}

export default function NotesPreview({
  notes,
  onNotesChange,
  onSave,
  saving,
  saved,
  savedPath,
  streaming,
  onCancel,
  onRetry,
  canRetry,
  todosSaved,
  sfdcReportSaved,
  cost,
  sourceBundle,
  onRegenerate,
  regenerating,
  regenerateError,
  onGenerateFollowUp,
  followUpDraft,
  followUpLoading,
  followUpError,
  followUpCost,
}) {
  const [viewMode, setViewMode] = useState("preview");
  const [regenerationInstruction, setRegenerationInstruction] = useState("");
  const [followUpAudience, setFollowUpAudience] = useState("customer");
  const [followUpTone, setFollowUpTone] = useState("warm-professional");
  const [followUpInstructions, setFollowUpInstructions] = useState("");
  const editable = typeof onNotesChange === "function";
  const sources = useMemo(() => sourceBundle?.allSources || [], [sourceBundle]);
  const referencedIds = useMemo(() => extractReferencedSourceIds(notes), [notes]);
  const referencedSources = useMemo(() => {
    const byId = new Map(sources.map((source) => [source.id, source]));
    return referencedIds.map((id) => byId.get(id)).filter(Boolean);
  }, [referencedIds, sources]);

  const copyToClipboard = () => {
    navigator.clipboard.writeText(notes).catch(() => {});
  };

  const copyFollowUp = () => {
    navigator.clipboard.writeText(followUpDraft || "").catch(() => {});
  };

  function submitRegeneration() {
    const instruction = regenerationInstruction.trim();
    if (!instruction || !onRegenerate) return;
    onRegenerate(instruction);
  }

  function submitFollowUp() {
    if (!onGenerateFollowUp) return;
    onGenerateFollowUp({
      audience: followUpAudience,
      tone: followUpTone,
      instructions: followUpInstructions,
    });
  }

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-gray-50">
        <div className="flex items-center gap-2 flex-wrap">
          <h2 className="section-header mb-0">Generated Notes</h2>
          {cost && !streaming && (
            <span className="text-xs text-gray-400 font-mono">{formatCost(cost)}</span>
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
              onClick={() => setViewMode("preview")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "preview" ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Preview
            </button>
            <button
              onClick={() => setViewMode("raw")}
              className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                viewMode === "raw" ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              Markdown
            </button>
            {sources.length > 0 && (
              <button
                onClick={() => setViewMode("sources")}
                className={`px-3 py-1.5 text-xs font-medium transition-colors ${
                  viewMode === "sources" ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
                }`}
              >
                Sources
              </button>
            )}
          </div>
          <button onClick={copyToClipboard} className="btn-secondary text-xs px-3 py-1.5">
            Copy
          </button>
          {streaming && onCancel && (
            <button onClick={onCancel} className="btn-secondary text-xs px-3 py-1.5">
              Cancel
            </button>
          )}
          {!streaming && canRetry && onRetry && (
            <button onClick={onRetry} className="btn-secondary text-xs px-3 py-1.5">
              Retry
            </button>
          )}
        </div>
      </div>

      <div className="p-6">
        {viewMode === "preview" ? (
          <div className="markdown-preview max-h-[600px] overflow-y-auto">
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              components={{
                p: Paragraph,
                a: ({ children, ...props }) => (
                  <a {...props} target="_blank" rel="noreferrer">
                    {children}
                  </a>
                ),
              }}
            >
              {notes}
            </ReactMarkdown>
          </div>
        ) : viewMode === "sources" ? (
          <SourcePanel sources={sources} referencedSources={referencedSources} referencedIds={referencedIds} />
        ) : editable ? (
          <textarea
            className="input min-h-[600px] resize-y font-mono text-xs leading-relaxed"
            value={notes}
            onChange={(e) => onNotesChange(e.target.value)}
            spellCheck={false}
          />
        ) : (
          <pre className="max-h-[600px] overflow-y-auto whitespace-pre-wrap text-xs font-mono leading-relaxed text-gray-700">
            {notes}
          </pre>
        )}
      </div>

      {!streaming && (onRegenerate || onGenerateFollowUp) && (
        <div className="px-6 py-4 border-t border-gray-200 bg-white grid lg:grid-cols-2 gap-4">
          {onRegenerate && (
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Ask for Changes</h3>
                {regenerating && (
                  <span className="text-xs text-obsidian-600 font-medium">Rewriting...</span>
                )}
              </div>
              <textarea
                className="input resize-y text-xs leading-relaxed"
                rows={3}
                placeholder="e.g. Make the action items more concrete and tighten the SFDC summary."
                value={regenerationInstruction}
                onChange={(event) => setRegenerationInstruction(event.target.value)}
              />
              {regenerateError && <p className="mt-2 text-xs text-red-600">{regenerateError}</p>}
              <button
                type="button"
                onClick={submitRegeneration}
                disabled={regenerating || !regenerationInstruction.trim()}
                className="btn-secondary text-xs mt-3"
              >
                {regenerating ? "Rewriting..." : "Regenerate Notes"}
              </button>
            </div>
          )}

          {onGenerateFollowUp && (
            <div className="rounded-lg border border-gray-200 p-4">
              <div className="flex items-center justify-between gap-3 mb-2">
                <h3 className="text-sm font-semibold text-gray-900">Follow-Up Draft</h3>
                {followUpCost && <span className="text-xs text-gray-400 font-mono">{formatCost(followUpCost)}</span>}
              </div>
              <div className="grid grid-cols-2 gap-2 mb-2">
                <select className="input text-xs" value={followUpAudience} onChange={(event) => setFollowUpAudience(event.target.value)}>
                  <option value="customer">Customer</option>
                  <option value="internal">Internal team</option>
                  <option value="mixed">Customer plus NI owners</option>
                </select>
                <select className="input text-xs" value={followUpTone} onChange={(event) => setFollowUpTone(event.target.value)}>
                  <option value="warm-professional">Warm professional</option>
                  <option value="concise-direct">Concise direct</option>
                  <option value="technical">Technical</option>
                  <option value="executive">Executive</option>
                </select>
              </div>
              <textarea
                className="input resize-y text-xs leading-relaxed"
                rows={2}
                placeholder="Optional: include only CSM-owned next steps, or make it customer-ready."
                value={followUpInstructions}
                onChange={(event) => setFollowUpInstructions(event.target.value)}
              />
              {followUpError && <p className="mt-2 text-xs text-red-600">{followUpError}</p>}
              <div className="flex items-center gap-2 mt-3">
                <button
                  type="button"
                  onClick={submitFollowUp}
                  disabled={followUpLoading}
                  className="btn-secondary text-xs"
                >
                  {followUpLoading ? "Drafting..." : "Draft Follow-Up"}
                </button>
                {followUpDraft && (
                  <button type="button" onClick={copyFollowUp} className="btn-secondary text-xs">Copy Draft</button>
                )}
              </div>
              {followUpDraft && (
                <pre className="mt-3 max-h-60 overflow-y-auto whitespace-pre-wrap rounded-lg bg-gray-50 border border-gray-200 p-3 text-xs leading-relaxed text-gray-700">
                  {followUpDraft}
                </pre>
              )}
            </div>
          )}
        </div>
      )}

      <div className="px-6 py-4 border-t border-gray-200 bg-gray-50 flex items-center justify-between gap-4">
        {saved ? (
          <div className="flex flex-col gap-1.5 flex-1">
            <div className="flex items-center gap-2 text-sm text-green-700 bg-green-50 rounded-lg px-3 py-2 border border-green-200">
              <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              <span>Saved to <code className="font-mono text-xs bg-green-100 px-1 rounded">{savedPath}</code></span>
            </div>
            {todosSaved && (
              <div className="flex items-center gap-2 text-sm text-blue-700 bg-blue-50 rounded-lg px-3 py-2 border border-blue-200">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                </svg>
                <span>{todosSaved.count} item{todosSaved.count !== 1 ? "s" : ""} added to <code className="font-mono text-xs bg-blue-100 px-1 rounded">{todosSaved.path}</code></span>
              </div>
            )}
            {sfdcReportSaved && (
              <div className="flex items-center gap-2 text-sm text-teal-700 bg-teal-50 rounded-lg px-3 py-2 border border-teal-200">
                <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 17v-2m3 2v-4m3 4v-6m2 10H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                </svg>
                <span>SFDC activity added to <code className="font-mono text-xs bg-teal-100 px-1 rounded">{sfdcReportSaved.path}</code></span>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-gray-500">Ready to save to your Obsidian vault.</p>
        )}

        <button
          onClick={onSave}
          disabled={saving || saved || streaming}
          className="btn-success whitespace-nowrap"
        >
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

function SourcePanel({ sources, referencedSources, referencedIds }) {
  const displayed = referencedSources.length ? referencedSources : sources;

  return (
    <div className="max-h-[600px] overflow-y-auto space-y-3">
      <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
        <p className="text-sm font-medium text-gray-800">
          {referencedSources.length
            ? `${referencedSources.length} cited source${referencedSources.length !== 1 ? "s" : ""}`
            : "No source IDs found in the generated note yet"}
        </p>
        {referencedIds.length > 0 && (
          <p className="mt-1 text-xs text-gray-500">Referenced IDs: {referencedIds.join(", ")}</p>
        )}
      </div>

      {displayed.map((source) => (
        <div key={source.id} className="rounded-lg border border-gray-200 p-4 bg-white">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <span className="font-mono text-xs rounded bg-gray-100 px-2 py-1 text-gray-700">[{source.id}]</span>
              <span className="text-xs font-medium text-gray-500">{source.label}</span>
            </div>
            {referencedIds.includes(source.id) && (
              <span className="text-[11px] uppercase tracking-wide text-obsidian-600 font-semibold">cited</span>
            )}
          </div>
          <p className="whitespace-pre-wrap text-xs leading-relaxed text-gray-700">{sourceExcerpt(source)}</p>
        </div>
      ))}
    </div>
  );
}
