"use client";

import { useState } from "react";
import { apiFetch } from "@/lib/apiClient";

export default function VaultScan({ settings, onSettingsClick }) {
  const [scanning, setScanning] = useState(false);
  const [results, setResults] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});

  async function handleScan() {
    if (!settings.vaultPath) { onSettingsClick(); return; }
    setScanning(true);
    setError(null);
    setResults(null);
    setExpanded({});
    try {
      const params = new URLSearchParams({ vaultPath: settings.vaultPath });
      if (settings.transcriptsPath) params.set("transcriptsPath", settings.transcriptsPath);
      if (settings.accounts?.length) params.set("accounts", JSON.stringify(settings.accounts));
      const res = await apiFetch(`/api/scan-vault?${params}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Scan failed");
      setResults(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setScanning(false);
    }
  }

  function toggle(key) {
    setExpanded((prev) => ({ ...prev, [key]: !prev[key] }));
  }

  return (
    <div className="space-y-4">
      <div className="card p-6">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-base font-semibold text-gray-900 mb-1">Vault-Wide Account Scan</h3>
            <p className="text-sm text-gray-500 mb-1">
              Searches every Markdown file in your vault and transcript archive for account mentions.
              Keywords are the <strong>aliases</strong> configured per account in Settings.
            </p>
            {results && (
              <p className="text-xs text-gray-400">
                {results.total.toLocaleString()} file{results.total !== 1 ? "s" : ""} scanned
                {results.truncated ? " (limit reached — not all files checked)" : ""}
              </p>
            )}
          </div>
          <button onClick={handleScan} disabled={scanning} className="btn-secondary whitespace-nowrap">
            {scanning ? (
              <>
                <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Scanning…
              </>
            ) : results ? "Re-scan" : "Scan All Files"}
          </button>
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
      </div>

      {results?.results.map((r, i) => {
        const key = `acct-${i}`;
        const open = expanded[key];
        return (
          <div key={key} className="card overflow-hidden">
            <button
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
              onClick={() => toggle(key)}
            >
              <div className="flex items-center gap-3">
                <span className={`inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold ${r.files.length > 0 ? "bg-green-100 text-green-700" : "bg-gray-100 text-gray-400"}`}>
                  {r.files.length}
                </span>
                <div>
                  <span className="text-sm font-semibold text-gray-900">{r.account.name}</span>
                  {r.account.aliases?.length > 0 && (
                    <span className="ml-2 text-xs text-gray-400">{r.account.aliases.join(", ")}</span>
                  )}
                </div>
              </div>
              <svg className={`w-4 h-4 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>
            {open && (
              <div className="border-t border-gray-100 px-4 pb-3">
                {r.files.length === 0 ? (
                  <p className="py-3 text-xs text-gray-400">No files found mentioning this account.</p>
                ) : (
                  <ul className="divide-y divide-gray-50 text-xs text-gray-600">
                    {r.files.map((f, j) => (
                      <li key={j} className="py-1.5 flex gap-3">
                        <span className="font-mono text-gray-400 flex-shrink-0 w-24">{f.date || "—"}</span>
                        <span className="flex-1 truncate" title={f.path}>{f.title}</span>
                        <span className="text-gray-400 flex-shrink-0 italic">{f.location}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        );
      })}

      {results?.unmatched.length > 0 && (
        <div className="card overflow-hidden">
          <button
            className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            onClick={() => toggle("unmatched")}
          >
            <div className="flex items-center gap-3">
              <span className="inline-flex items-center justify-center w-6 h-6 rounded-full text-xs font-bold bg-gray-100 text-gray-500">
                {results.unmatched.length}{results.unmatched.length === 200 ? "+" : ""}
              </span>
              <span className="text-sm font-semibold text-gray-500">Unmatched files</span>
              <span className="text-xs text-gray-400">no configured account alias found</span>
            </div>
            <svg className={`w-4 h-4 text-gray-400 transition-transform ${expanded.unmatched ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {expanded.unmatched && (
            <div className="border-t border-gray-100 px-4 pb-3">
              <ul className="divide-y divide-gray-50 text-xs text-gray-600">
                {results.unmatched.map((f, j) => (
                  <li key={j} className="py-1.5 flex gap-3">
                    <span className="font-mono text-gray-400 flex-shrink-0 w-24">{f.date || "—"}</span>
                    <span className="flex-1 truncate" title={f.path}>{f.title}</span>
                    <span className="text-gray-400 flex-shrink-0 italic">{f.location}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
