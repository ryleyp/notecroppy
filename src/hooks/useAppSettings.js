"use client";

import { useEffect, useState } from "react";
import { DEFAULT_ACCOUNTS } from "@/lib/accounts";
import { mergeFileConfigIntoSettings } from "@/lib/settings";
import { apiFetch, approveLocalPaths } from "@/lib/apiClient";

const BROWSER_KEY = "obsidian-notes-settings";
const API_KEY_KEY = "obsidian-notes-api-key";

export const EMPTY_SETTINGS = {
  vaultPath: "",
  transcriptsPath: "",
  apiKey: "",
  aiPrivacyScan: true,
  replacements: [],
  corrections: [],
  accounts: DEFAULT_ACCOUNTS,
  ownerNames: [],
};

// Settings live in three places, deliberately:
//   - localStorage  everything except the API key
//   - sessionStorage  the API key only, so it dies with the tab
//   - notetaker-config.json / notetaker-glossary.json in the transcripts
//     folder, so the glossary and account roster survive a cache clear and
//     travel between machines
export function useAppSettings({ onSettingsSaved } = {}) {
  const [settings, setSettings] = useState(EMPTY_SETTINGS);
  const [showSettings, setShowSettings] = useState(false);
  const [initialModel, setInitialModel] = useState(null);

  function persistBrowserSettings(nextSettings) {
    const settingsToPersist = { ...nextSettings };
    delete settingsToPersist.apiKey;
    localStorage.setItem(BROWSER_KEY, JSON.stringify(settingsToPersist));
  }

  // Write the portable glossary (replacements, corrections, accounts) to a file.
  function persistConfig(s) {
    const dir = s.transcriptsPath || s.vaultPath;
    if (!dir) return;
    approveLocalPaths(s)
      .then(() => apiFetch("/api/config", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          path: dir,
          config: {
            accounts: s.accounts || DEFAULT_ACCOUNTS,
            corrections: s.corrections || [],
            ownerNames: s.ownerNames || [],
          },
          glossary: {
            replacements: s.replacements || [],
          },
        }),
      }))
      .catch(() => {});
  }

  useEffect(() => {
    let base;
    try {
      const stored = localStorage.getItem(BROWSER_KEY);
      if (stored) {
        const parsed = JSON.parse(stored);
        const { apiKey: oldPersistedApiKey, ...persistedSettings } = parsed;
        const sessionApiKey = sessionStorage.getItem(API_KEY_KEY) || "";
        base = { ...EMPTY_SETTINGS, ...persistedSettings, apiKey: sessionApiKey };
        setSettings(base);
        // Migration: earlier builds persisted the key to localStorage.
        if (oldPersistedApiKey) {
          localStorage.setItem(BROWSER_KEY, JSON.stringify(persistedSettings));
        }
        if (parsed.model) setInitialModel(parsed.model);
        if (!parsed.vaultPath) setShowSettings(true);
      } else {
        setShowSettings(true);
      }
    } catch {
      setShowSettings(true);
    }

    // Merge the durable config file (source of truth across machines).
    const dir = base?.transcriptsPath || base?.vaultPath;
    if (!dir) return;
    (async () => {
      try {
        await approveLocalPaths(base);
        const res = await apiFetch(`/api/config?path=${encodeURIComponent(dir)}`);
        const data = await res.json();
        if (data.config) {
          setSettings((prev) => {
            const merged = mergeFileConfigIntoSettings(prev, data.config);
            persistBrowserSettings(merged);
            return merged;
          });
        }
      } catch {
        // File-based glossary is best-effort; localStorage remains the fallback.
      }
    })();
  }, []);

  // Targeted accounts update (e.g. the bleed-feedback flow adding keywords)
  // without opening the full settings panel.
  function updateAccounts(accounts) {
    setSettings((prev) => {
      const merged = { ...prev, accounts };
      persistBrowserSettings(merged);
      persistConfig(merged);
      return merged;
    });
  }

  async function saveSettings(newSettings) {
    const { apiKey, ...settingsToPersist } = newSettings;
    const merged = { replacements: [], ...settingsToPersist, apiKey };
    try {
      await approveLocalPaths(merged);
      setSettings(merged);
      localStorage.setItem(BROWSER_KEY, JSON.stringify(settingsToPersist));
      if (apiKey) sessionStorage.setItem(API_KEY_KEY, apiKey);
      else sessionStorage.removeItem(API_KEY_KEY);
      persistConfig(merged);
      setShowSettings(false);
      onSettingsSaved?.(merged);
    } catch (error) {
      alert(`Failed to approve local paths: ${error.message}`);
    }
  }

  // Applies a settings patch, persisting to both browser and config file, and
  // returns the merged result.
  //
  // The merge is computed from the current `settings` rather than inside the
  // setState updater: callers need the merged object back immediately (the
  // sanitize flow feeds the new replacement list straight into generation),
  // and an updater function is not guaranteed to have run by the time this
  // returns.
  function applySettingsPatch(patch) {
    const next = { ...settings, ...patch };
    setSettings(next);
    persistBrowserSettings(next);
    persistConfig(next);
    return next;
  }

  return {
    settings,
    setSettings,
    showSettings,
    setShowSettings,
    initialModel,
    saveSettings,
    updateAccounts,
    applySettingsPatch,
    persistBrowserSettings,
    persistConfig,
  };
}
