"use client";

import { MODEL_OPTIONS } from "@/lib/models";

// Shared model selector. `compact` renders the one-line variant used in the
// pre-flight header; the default renders label + sublabel stacked.
export default function ModelPicker({ model, setModel, compact = false }) {
  return (
    <div className="flex rounded-lg border border-gray-200 bg-white overflow-hidden">
      {MODEL_OPTIONS.map((m) => (
        <button
          key={m.id}
          type="button"
          onClick={() => setModel(m.id)}
          className={`${compact ? "px-3 py-1" : "px-3 py-1.5"} text-left transition-colors ${
            model === m.id ? "bg-obsidian-600 text-white" : "text-gray-600 hover:bg-gray-50"
          }`}
        >
          {compact ? (
            <>
              <span className="text-xs font-medium">{m.label}</span>
              <span className={`text-xs ml-1 ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>
                {m.sub.split("·")[1]?.trim() || m.sub}
              </span>
            </>
          ) : (
            <>
              <div className="text-xs font-medium leading-tight">{m.label}</div>
              <div className={`text-xs leading-tight ${model === m.id ? "text-obsidian-200" : "text-gray-400"}`}>{m.sub}</div>
            </>
          )}
        </button>
      ))}
    </div>
  );
}
