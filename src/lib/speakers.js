// Speaker-turn parsing for transcripts that have been segmented into
// "**Label:** text" turns — either by /api/detect-speakers (a best-effort
// inference from conversational cues, since raw dictation has no real
// speaker signal) or typed in manually.

// Parse "**Label:** text ... **Label2:** text ..." into discrete turns.
// Turn text runs until the next label marker, so multi-line/paragraph
// turns are preserved intact. Falls back to a single unlabeled turn when
// no markers are found at all.
export function parseSpeakerTurns(text) {
  const t = (text || "").trim();
  if (!t) return [];
  const markerRe = /\*\*([^*\n]+?):\*\*[ \t]*/g;
  const matches = [...t.matchAll(markerRe)];
  if (!matches.length) return [{ label: "Speaker 1", text: t }];

  const turns = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const label = m[1].trim();
    const start = m.index + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1].index : t.length;
    const body = t.slice(start, end).trim();
    if (body) turns.push({ label, text: body });
  }
  return turns.length ? turns : [{ label: "Speaker 1", text: t }];
}

// Rebuild the labeled transcript text from turns, applying any renamed
// labels (originalLabel -> displayName) from the review step.
export function buildLabeledTranscript(turns, nameMap = {}) {
  return turns
    .filter((t) => t.text && t.text.trim())
    .map((t) => `**${(nameMap[t.label] || t.label).trim()}:** ${t.text.trim()}`)
    .join("\n\n");
}

// Merge turn[index] into turn[index - 1] — fixes an over-eager turn break
// the model inserted where there wasn't really a speaker change.
export function mergeUp(turns, index) {
  if (index <= 0 || index >= turns.length) return turns;
  const merged = {
    label: turns[index - 1].label,
    text: `${turns[index - 1].text} ${turns[index].text}`.trim(),
  };
  return [...turns.slice(0, index - 1), merged, ...turns.slice(index + 1)];
}

// Quick check for whether a transcript is already in the speaker-labeled
// format (>=2 turn markers) — used to decide whether to show a "re-detect"
// vs "detect" button, and whether /api/process should add attribution
// instructions to the notes prompt.
export function looksSpeakerLabeled(text) {
  const matches = (text || "").match(/\*\*[^*\n]+?:\*\*/g);
  return !!matches && matches.length >= 2;
}
