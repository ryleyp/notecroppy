const DEFAULT_CHUNK_CHARS = 950;

function cleanText(value) {
  return (value || "").replace(/\r\n/g, "\n").replace(/\t/g, " ").trim();
}

function normalizeChunk(value) {
  return value.replace(/\n{3,}/g, "\n\n").trim();
}

function splitLongParagraph(paragraph, maxChars) {
  if (paragraph.length <= maxChars) return [paragraph];
  const sentences = paragraph.match(/[^.!?\n]+[.!?]*/g) || [paragraph];
  const chunks = [];
  let current = "";

  for (const sentence of sentences) {
    const next = current ? `${current} ${sentence.trim()}` : sentence.trim();
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = sentence.trim();
    } else {
      current = next;
    }
  }

  if (current) chunks.push(current);
  return chunks;
}

export function makeSourceBlocks(text, { prefix, label, maxChars = DEFAULT_CHUNK_CHARS }) {
  const cleaned = cleanText(text);
  if (!cleaned) return [];

  const paragraphs = cleaned
    .split(/\n\s*\n/g)
    .flatMap((paragraph) => splitLongParagraph(normalizeChunk(paragraph), maxChars))
    .filter(Boolean);

  const blocks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    const next = current ? `${current}\n\n${paragraph}` : paragraph;
    if (next.length > maxChars && current) {
      blocks.push(current);
      current = paragraph;
    } else {
      current = next;
    }
  }
  if (current) blocks.push(current);

  return blocks.map((content, index) => ({
    id: `${prefix}${index + 1}`,
    label,
    content,
  }));
}

export function buildSourceBundle({ transcript = "", rawNotes = "", emailThread = "" } = {}) {
  const transcriptSources = makeSourceBlocks(transcript, { prefix: "T", label: "Transcript" });
  const rawNoteSources = makeSourceBlocks(rawNotes, { prefix: "N", label: "Raw notes" });
  const emailSources = makeSourceBlocks(emailThread, { prefix: "E", label: "Email thread" });
  return {
    transcriptSources,
    rawNoteSources,
    emailSources,
    allSources: [...transcriptSources, ...rawNoteSources, ...emailSources],
  };
}

export function formatSourceBundleForPrompt(sourceBundle) {
  const sources = sourceBundle?.allSources || [];
  if (!sources.length) return "";

  return sources
    .map((source) => `[${source.id}] ${source.label}\n${source.content}`)
    .join("\n\n");
}

export function mapSourceBundle(sourceBundle, mapper) {
  const mapOne = (source) => ({ ...source, content: mapper(source.content) });
  const transcriptSources = (sourceBundle?.transcriptSources || []).map(mapOne);
  const rawNoteSources = (sourceBundle?.rawNoteSources || []).map(mapOne);
  const emailSources = (sourceBundle?.emailSources || []).map(mapOne);
  return {
    transcriptSources,
    rawNoteSources,
    emailSources,
    allSources: [...transcriptSources, ...rawNoteSources, ...emailSources],
  };
}

export function extractReferencedSourceIds(markdown) {
  const found = new Set();
  const regex = /\[([TNE]\d+)\]/g;
  let match;
  while ((match = regex.exec(markdown || ""))) {
    found.add(match[1]);
  }

  return [...found].sort((a, b) => {
    const priority = { T: 0, N: 1, E: 2 };
    const prefixCompare = (priority[a[0]] ?? 9) - (priority[b[0]] ?? 9);
    if (prefixCompare !== 0) return prefixCompare;
    return Number(a.slice(1)) - Number(b.slice(1));
  });
}

export function sourceExcerpt(source, maxChars = 420) {
  const content = cleanText(source?.content || "");
  if (content.length <= maxChars) return content;
  return `${content.slice(0, maxChars).trimEnd()}...`;
}
