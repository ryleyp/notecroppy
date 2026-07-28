"use client";

import { useState, useEffect } from "react";
import { StepBadge } from "@/components/MeetingDetails";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";

const folderCache = new Map();

export default function FolderSelector({ vaultPath, selectedFolder, onSelect, onSettingsClick, stepNumber = 3 }) {
  const [folders, setFolders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [search, setSearch] = useState("");

  useEffect(() => {
    if (!vaultPath) {
      setFolders([]);
      setError(null);
      setLoading(false);
      return;
    }
    const cached = folderCache.get(vaultPath);
    if (cached) {
      setFolders(cached);
      setError(null);
      setLoading(false);
      return;
    }
    let canceled = false;
    setLoading(true);
    setError(null);
    approveLocalPaths({ vaultPath })
      .then(() => apiFetch(`/api/folders?vaultPath=${encodeURIComponent(vaultPath)}`))
      .then((r) => r.json())
      .then((data) => {
        if (data.error) throw new Error(data.error);
        const nextFolders = data.folders || [];
        folderCache.set(vaultPath, nextFolders);
        if (!canceled) setFolders(nextFolders);
      })
      .catch((e) => {
        if (!canceled) setError(e.message);
      })
      .finally(() => {
        if (!canceled) setLoading(false);
      });
    return () => {
      canceled = true;
    };
  }, [vaultPath]);

  const filteredFolders = folders.filter((f) =>
    f.path.toLowerCase().includes(search.toLowerCase()) ||
    f.name.toLowerCase().includes(search.toLowerCase())
  );

  const selectedFolderObj = folders.find((f) => f.path === selectedFolder);

  return (
    <div className="card p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-3">
          <StepBadge n={stepNumber} />
          <div>
            <h2 className="text-base font-semibold text-gray-900">Destination Folder</h2>
            <p className="text-xs text-gray-500">Pick where to save the note in your vault</p>
          </div>
        </div>

        {selectedFolderObj && (
          <div className="hidden sm:flex items-center gap-2 text-sm bg-obsidian-50 text-obsidian-700 rounded-lg px-3 py-1.5 border border-obsidian-200">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
            <span className="font-medium max-w-xs truncate text-xs">
              {selectedFolderObj.path || "(Vault root)"}
            </span>
            <svg className="w-4 h-4 text-obsidian-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
        )}
      </div>

      {!vaultPath ? (
        <div className="flex items-center justify-between gap-4 bg-amber-50 rounded-lg p-4 border border-amber-200">
          <div className="flex items-center gap-3 text-sm text-amber-800">
            <svg className="w-5 h-5 text-amber-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            Configure your vault path in Settings first to browse folders.
          </div>
          {onSettingsClick && (
            <button onClick={onSettingsClick} className="btn-secondary text-xs whitespace-nowrap">
              Open Settings
            </button>
          )}
        </div>
      ) : loading ? (
        <div className="flex items-center gap-2 text-sm text-gray-500 py-4">
          <svg className="animate-spin w-4 h-4" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          Loading vault folders...
        </div>
      ) : error ? (
        <div className="text-sm text-red-600 bg-red-50 rounded-lg p-3 border border-red-200">
          {error}
        </div>
      ) : (
        <div className="space-y-3">
          <input
            type="text"
            className="input"
            placeholder="Search folders..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          <div className="border border-gray-200 rounded-lg divide-y divide-gray-100 overflow-hidden">
            {filteredFolders.length === 0 ? (
              <p className="px-4 py-6 text-sm text-gray-500 text-center">No folders found</p>
            ) : (
              <div className="max-h-72 overflow-y-auto">
                {filteredFolders.map((folder) => (
                  <button
                    key={folder.path}
                    onClick={() => onSelect(folder.path)}
                    className={`w-full text-left py-2.5 text-sm transition-colors hover:bg-gray-50 flex items-center gap-2 ${
                      selectedFolder === folder.path
                        ? "bg-obsidian-50 text-obsidian-700 font-medium"
                        : "text-gray-700"
                    }`}
                    style={{ paddingLeft: `${Math.max((folder.depth + 1) * 16 + 12, 16)}px`, paddingRight: "12px" }}
                  >
                    <svg
                      className={`w-4 h-4 flex-shrink-0 ${selectedFolder === folder.path ? "text-obsidian-500" : "text-gray-400"}`}
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                    </svg>
                    <span className="truncate">{folder.path || folder.name}</span>
                    {selectedFolder === folder.path && (
                      <svg className="w-4 h-4 ml-auto flex-shrink-0 text-obsidian-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                      </svg>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>

          {!selectedFolder && (
            <p className="text-xs text-gray-400">No folder selected — note will save to vault root.</p>
          )}
        </div>
      )}
    </div>
  );
}
