export function aliasesFromReplacements(replacements = []) {
  return replacements
    .map((r) => r?.alias)
    .filter(Boolean);
}

export function buildSanitizePrompt(transcript, knownAliases = []) {
  const aliasList = knownAliases.length ? knownAliases.join(", ") : "none";

  return `Extract sensitive proper nouns from this text that should be anonymized before sending to an AI.

INCLUDE:
- Person names (first, last, or full names)
- Company and organization names
- Military branch or government agency names
- Division or business unit names

DO NOT INCLUDE:
- NI Software products: NI, LabVIEW, TestStand, SystemLink, DIAdem, FlexLogger, VeriStand, NI-DAQmx, LabWindows/CVI, Measurement Studio, NI-VISA, OpenTestBed
- Generic terms, job titles, locations, or common words
- Placeholder aliases already present in the text: ${aliasList}
- Any placeholder matching PERSON_#, ORG_#, PERSON_10, ORG_10, etc.

Return ONLY a JSON array, no explanation. Each item: {"text": "exact term", "type": "person" or "org"}
If nothing found, return [].

TEXT:
${transcript}`;
}

export function parseEntityList(rawText, knownAliases = []) {
  const raw = rawText?.trim() || "[]";
  const match = raw.match(/\[[\s\S]*\]/);
  const parsed = match ? JSON.parse(match[0]) : [];
  const aliases = new Set(knownAliases.map((a) => a.toLowerCase()));

  return parsed
    .filter((item) => item && typeof item.text === "string")
    .map((item) => ({
      text: item.text.trim(),
      type: item.type === "person" ? "person" : "org",
    }))
    .filter((item) => item.text && !aliases.has(item.text.toLowerCase()))
    .filter((item) => !/^(PERSON|ORG)_\d+$/i.test(item.text));
}
