import { mergeCorrections } from "@/lib/sanitize";

export function mergeReplacements(replacements = [], additions = []) {
  const merged = [...replacements];
  const byOriginal = new Map();

  merged.forEach((replacement, index) => {
    const original = String(replacement?.original || "").trim();
    if (original) byOriginal.set(original.toLowerCase(), index);
  });

  for (const addition of additions) {
    const original = String(addition?.original || "").trim();
    if (!original) continue;

    const key = original.toLowerCase();
    if (byOriginal.has(key)) {
      merged[byOriginal.get(key)] = { ...merged[byOriginal.get(key)], ...addition, original };
    } else {
      byOriginal.set(key, merged.length);
      merged.push({ ...addition, original });
    }
  }

  return merged;
}

export function mergeFileConfigIntoSettings(settings, config) {
  if (!config) return settings;

  return {
    ...settings,
    replacements: mergeReplacements(
      settings.replacements || [],
      Array.isArray(config.replacements) ? config.replacements : []
    ),
    corrections: mergeCorrections(
      settings.corrections || [],
      Array.isArray(config.corrections) ? config.corrections : []
    ),
    accounts: config.accounts?.length ? config.accounts : settings.accounts,
  };
}
