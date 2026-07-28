import { NextResponse } from "next/server";
import Anthropic from "@anthropic-ai/sdk";
import fs from "fs";
import path from "path";
import { assertAllowedRoot } from "@/lib/pathAllowlist";
import { resolveInsideDirectory } from "@/lib/fileSafety";
import { assertTrustedRequest } from "@/lib/requestSafety";
import { applyCorrections, applyReplacements } from "@/lib/sanitize";
import { firstTextBlock, FAST_MODEL } from "@/lib/models";
import {
  CONTACT_INDEX_DIR,
  CONTACT_INDEX_FILE,
  accountIndexKey,
  mergeFacts,
  noteFingerprint,
  parseContactFacts,
  sourceKey,
  stableSourceId,
} from "@/lib/contactMapping";

const EXTRACT_BATCH_CHAR_LIMIT = 60_000;

function emptyIndex() {
  return { version: 1, updatedAt: null, accounts: {}, sources: {} };
}

function contactIndexPath(vaultPath) {
  const dir = resolveInsideDirectory(vaultPath, CONTACT_INDEX_DIR, "Contact map index folder");
  return path.join(dir, CONTACT_INDEX_FILE);
}

function readIndex(vaultPath) {
  try {
    const filePath = contactIndexPath(vaultPath);
    if (!fs.existsSync(filePath)) return emptyIndex();
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    return {
      ...emptyIndex(),
      ...parsed,
      accounts: parsed.accounts || {},
      sources: parsed.sources || {},
    };
  } catch {
    return emptyIndex();
  }
}

function writeIndex(vaultPath, index) {
  const dir = resolveInsideDirectory(vaultPath, CONTACT_INDEX_DIR, "Contact map index folder");
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, CONTACT_INDEX_FILE), JSON.stringify({ ...index, updatedAt: new Date().toISOString() }, null, 2), "utf-8");
}

function normalizeNote(note) {
  const key = sourceKey(note);
  return {
    id: stableSourceId(note),
    key,
    fingerprint: noteFingerprint(note),
    date: note.date || "",
    title: note.title || note.filename || "Untitled",
    source: note.source || "obsidian",
    sourceLabel: note.sourceLabel || "",
    content: note.content || "",
    filename: note.filename || "",
    relativePath: note.relativePath || note.filename || "",
  };
}

function sanitizeNote(note, corrections, replacements) {
  return {
    ...note,
    title: applyReplacements(applyCorrections(note.title, corrections), replacements),
    content: applyReplacements(applyCorrections(note.content, corrections), replacements),
  };
}

function buildExtractionPrompt(notes, accountName, allAccounts, mappingContext = []) {
  const acct = accountName && accountName !== "Internal" ? accountName : "selected account";
  const otherAccounts = (allAccounts || [])
    .filter((account) => account?.name && account.name !== accountName && account.name !== "Internal")
    .map((account) => `- ${account.name}: ${(account.aliases || []).join(", ")}`)
    .join("\n") || "none";
  const context = (mappingContext || [])
    .filter((item) => item?.label && item?.context)
    .map((item) => `- ${item.label}: ${item.context}`)
    .join("\n") || "none";
  const blocks = notes.map((note) => (
    `### ${note.id}\nDate: ${note.date || "undated"}\nTitle: ${note.title}\nSource label: ${note.sourceLabel || note.source}\n\n${note.content}`
  )).join("\n\n---\n\n");

  return `Extract structured customer contact and site mapping facts for ${acct}.

Return ONLY valid JSON with this shape:
{"facts":[{"type":"person|site|org|relationship","name":"canonical visible name or alias","aliases":["optional"],"role":"optional","organization":"optional","site":"optional","relationship":"optional","evidence":"short source-grounded detail","confidence":"high|medium|low","sourceId":"S_ABC12345"}]}

Rules:
- Extract only facts relevant to ${acct}.
- Include customer people, customer teams/orgs, NI/internal contacts tied to the account, sites, labs, campuses, buildings, locations, and person-site relationships.
- Do not include other customer accounts. Other accounts to exclude:
${otherAccounts}
- Do not invent facts. Every fact must have a short evidence string and the sourceId it came from.
- If context below clarifies a name, role, site, or exclusion, use it as guidance without adding unsupported facts.

User context:
${context}

Sources:
${blocks}`;
}

function chunkNotes(notes) {
  const batches = [];
  let current = [];
  let chars = 0;
  for (const note of notes) {
    const size = note.title.length + note.content.length + 200;
    if (current.length && chars + size > EXTRACT_BATCH_CHAR_LIMIT) {
      batches.push(current);
      current = [];
      chars = 0;
    }
    current.push(note);
    chars += size;
  }
  if (current.length) batches.push(current);
  return batches;
}

async function extractBatch(client, batch, accountName, allAccounts, mappingContext) {
  const sourcesById = Object.fromEntries(batch.map((note) => [note.id, {
    sourceId: note.id,
    date: note.date,
    title: note.title,
    sourceLabel: note.sourceLabel,
  }]));

  const msg = await client.messages.create({
    model: FAST_MODEL,
    max_tokens: 12_000,
    messages: [{ role: "user", content: buildExtractionPrompt(batch, accountName, allAccounts, mappingContext) }],
  });

  return parseContactFacts(firstTextBlock(msg), sourcesById, { throwOnInvalid: true });
}

function notesForExtraction(notes, index, accountKey, { changedOnly = false, force = false } = {}) {
  const lastMappedAt = index.accounts?.[accountKey]?.lastMappedAt || null;
  const lastMappedTime = lastMappedAt ? new Date(lastMappedAt).getTime() : 0;
  const reusable = [];
  const changed = [];
  const skipped = [];

  for (const note of notes) {
    const cached = index.sources[note.key];
    const unchanged = cached?.fingerprint === note.fingerprint;
    const extractedTime = cached?.extractedAt ? new Date(cached.extractedAt).getTime() : 0;
    const includeCached = unchanged && !force;

    if (changedOnly && includeCached && lastMappedTime && extractedTime <= lastMappedTime) {
      skipped.push(note);
      continue;
    }

    if (includeCached) reusable.push({ note, cached });
    else changed.push(note);
  }

  return { reusable, changed, skipped, lastMappedAt };
}

export async function POST(request) {
  try {
    assertTrustedRequest(request);

    const body = await request.json();
    const {
      action = "extract",
      notes = [],
      vaultPath,
      folderPath = "",
      apiKey,
      accountName,
      allAccounts = [],
      replacements = [],
      corrections = [],
      mappingContext = [],
      changedOnly = false,
      force = false,
      savedPath = "",
    } = body;

    if (!vaultPath) return NextResponse.json({ error: "vaultPath is required" }, { status: 400 });
    const resolvedVault = assertAllowedRoot(vaultPath, "Vault path");
    const index = readIndex(resolvedVault);
    const acctKey = accountIndexKey(accountName, folderPath);
    index.accounts[acctKey] = index.accounts[acctKey] || {};

    if (action === "markMapped") {
      index.accounts[acctKey] = {
        ...index.accounts[acctKey],
        lastMappedAt: new Date().toISOString(),
        lastSavedPath: savedPath || index.accounts[acctKey].lastSavedPath || "",
      };
      writeIndex(resolvedVault, index);
      return NextResponse.json({ ok: true, lastMappedAt: index.accounts[acctKey].lastMappedAt });
    }

    if (!Array.isArray(notes) || notes.length === 0) {
      return NextResponse.json({ facts: [], stats: { totalSources: 0, reusedSources: 0, extractedSources: 0, skippedSources: 0, batches: 0 } });
    }

    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return NextResponse.json({ error: "Anthropic API key is required for fact extraction" }, { status: 400 });

    const normalized = notes.map(normalizeNote).map((note) => sanitizeNote(note, corrections, replacements));
    const { reusable, changed, skipped, lastMappedAt } = notesForExtraction(normalized, index, acctKey, { changedOnly, force });
    const facts = reusable.flatMap(({ cached }) => cached.facts || []);

    const client = new Anthropic({ apiKey: key });
    const batches = chunkNotes(changed);
    for (const batch of batches) {
      const extracted = await extractBatch(client, batch, accountName, allAccounts, mappingContext);
      const bySource = new Map();
      for (const fact of extracted) {
        const list = bySource.get(fact.sourceId) || [];
        list.push(fact);
        bySource.set(fact.sourceId, list);
      }
      for (const note of batch) {
        const noteFacts = bySource.get(note.id) || [];
        facts.push(...noteFacts);
        index.sources[note.key] = {
          fingerprint: note.fingerprint,
          extractedAt: new Date().toISOString(),
          date: note.date,
          title: note.title,
          source: note.source,
          sourceLabel: note.sourceLabel,
          relativePath: note.relativePath,
          facts: noteFacts,
        };
      }
    }

    writeIndex(resolvedVault, index);

    return NextResponse.json({
      facts: mergeFacts(facts),
      stats: {
        totalSources: normalized.length,
        reusedSources: reusable.length,
        extractedSources: changed.length,
        skippedSources: skipped.length,
        batches: batches.length,
        changedOnly: !!changedOnly,
        lastMappedAt,
        indexPath: `${CONTACT_INDEX_DIR}/${CONTACT_INDEX_FILE}`,
      },
    });
  } catch (error) {
    return NextResponse.json(
      { error: error?.message || "Failed to extract contact facts" },
      { status: error?.status || 500 }
    );
  }
}

export {
  buildExtractionPrompt,
  chunkNotes,
  notesForExtraction,
};
