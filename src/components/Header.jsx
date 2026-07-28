"use client";

import { useEffect, useState } from "react";

export default function Header({ onSettingsClick, isSettingsOpen, mode, onModeChange }) {
  const [dark, setDark] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch (e) {}
  };

  return (
    <header className="sticky top-0 z-10 bg-white border-b border-gray-200 shadow-sm">
      <div className="max-w-3xl mx-auto px-4 sm:px-6">
        <div className="flex items-center justify-between h-14">
          <div className="flex items-center gap-3">
            <div className="flex items-center justify-center w-8 h-8 rounded-lg text-white" style={{ backgroundColor: "#BE5103" }}>
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <span className="text-sm font-semibold text-gray-900 hidden sm:block">Obsidian Meeting Notes</span>
          </div>

          <div className="flex items-center gap-2">
            {/* Mode toggle */}
            <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-0.5">
              <button
                onClick={() => onModeChange("new")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "new"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                New Note
              </button>
              <button
                onClick={() => onModeChange("email")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "email"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Email
              </button>
              <button
                onClick={() => onModeChange("status")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "status"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Account Status
              </button>
              <button
                onClick={() => onModeChange("mapping")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "mapping"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                Mapping
              </button>
              <button
                onClick={() => onModeChange("sl-status")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "sl-status"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                SL Status
              </button>
              <button
                onClick={() => onModeChange("csm-activity")}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                  mode === "csm-activity"
                    ? "bg-white text-obsidian-700 shadow-sm"
                    : "text-gray-500 hover:text-gray-700"
                }`}
              >
                EA Activity
              </button>
            </div>

            <button
              onClick={toggleTheme}
              aria-label="Toggle dark mode"
              title={dark ? "Switch to light mode" : "Switch to dark mode"}
              className="flex items-center justify-center w-9 h-9 rounded-lg text-gray-600 hover:bg-gray-100 transition-colors"
            >
              {dark ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
                </svg>
              )}
            </button>

            <button
              onClick={onSettingsClick}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                isSettingsOpen
                  ? "bg-obsidian-50 text-obsidian-700"
                  : "text-gray-600 hover:bg-gray-100"
              }`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
              <span className="hidden sm:inline">Settings</span>
            </button>
          </div>
        </div>
      </div>
    </header>
  );
}
