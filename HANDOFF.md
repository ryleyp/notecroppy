# Notetaker Webapp — Context Handoff

A Next.js 14 (App Router) web app that turns Obsidian meeting notes + transcripts into
structured notes and quarterly account summaries using the Anthropic Claude API.

## How to run
```bash
git pull && npm install && npm run dev   # http://localhost:3000
npm test                                  # 23 vitest unit tests
```

## Git / branches
- Default working branch: `claude/obsidian-meeting-notes-app-lFN0q`
- `main` and that branch are kept in sync (every change is committed to `main`,
  then the feature branch is hard-reset to `main` and force-pushed).
- Remote default branch was the `claude/...` branch — fresh clones check that out.
  Both branches now hold identical, current code.

## Three tabs (Header.jsx)
1. **New Note** — paste/upload a transcript → sanitize/pseudonymize → Claude generates
   Markdown notes → save into a chosen Obsidian folder (`src/app/page.js`). The generated
   note ends with a **## SFDC Activity Entry** section (Type / Subtype / Summary-Outcomes-
   Next steps) produced in the *same* single streamed completion for copy-paste into
   Salesforce — see Key architecture.
2. **Account Status** — pick an account folder, scan the past quarter's notes, generate a
   5-pillar account health summary (`src/components/AccountStatus.jsx`).
3. **SL Status** — same as Account Status but filtered to SystemLink-related notes, with a
   SystemLink-specific prompt (`src/components/SystemLinkStatus.jsx`).

## Key architecture
- **Accounts & aliases** (`src/lib/accounts.js`): `DEFAULT_ACCOUNTS` maps each account to
  name aliases (e.g. Cardinal → `cardinal`, `cad`). Editable in Settings. `detectAccount()`
  resolves the picked folder → account; `textHasAlias()` does whole-word matching.
- **Privacy** (`src/lib/sanitize.js`): `applyCorrections` → `applyReplacements` (real→alias)
  before sending to Claude, `reverseReplacements` (alias→real) on the way back. Word-boundary
  regex avoids alias collisions (ORG_1 vs ORG_12).
- **Durable config**: two files written via `/api/config` —
  `notetaker-config.json` (accounts + corrections, safe to sync) and
  `notetaker-glossary.json` (replacements w/ real names, sensitive).
- **Note loading** (`src/app/api/notes/route.js`): returns the picked folder's notes
  ("obsidian") plus cross-folder notes that mention an account alias ("cross-vault").
  **Skips any folder whose name contains "transcript" or "todo".** Transcript archive
  support was fully removed.
- **Vault scan** (`src/app/api/scan-vault/route.js`): all-time account mention scan,
  folded into Account Status (runs in parallel on Scan Folder).
- **Note generation** (`src/app/api/process/route.js`): one `client.messages.stream` call.
  `buildPrompt` asks for tag line, Executive Summary, Meeting Notes, CS Takeaways, Action
  Items, Next Steps, and finally a **## SFDC Activity Entry** section. The SFDC rules live in
  the `SFDC_ACTIVITY_RULES` block (approved Type→Subtype taxonomy, classification tie-breakers,
  and a CSM persona/voice guide: past tense, no first person, plain non-jargony language,
  ~100-120 words / ≤800 chars, Summary/Outcomes/Next steps only). It is NOT a second API call —
  it is the last section of the same completion, so the existing sanitize/reverse, save, and
  `NotesPreview` rendering all work unchanged. `max_tokens` bumped to 9216 to fit it.

## Synthesis (`src/app/api/synthesize/route.js`)
- **Streams** output via SSE (`client.messages.stream`); both status tabs render text live
  with a "Generating…" → "Ready" heading.
- `buildSynthesisPrompt` (account) and `buildProductPrompt` (SystemLink). Both take
  `accountName` and include **hard scoping rules**: report on the picked account ONLY,
  never mention/compare other customers, use only the relevant parts of cross-folder notes.
- **Model-aware token budget** (`MODEL_CONTEXT`, `fitNotes`): Sonnet 4.6 & Opus = 1M tokens,
  Haiku = 200k. Budget = context − output − overhead, ×4 chars/token, ×0.95 safety.
  Notes sorted newest-first; oldest dropped only if over budget. Per-note cap 300k chars on
  1M models, 80k on 200k models. `droppedCount` surfaced to the UI.

## Token-limit guidance (most recent topic)
The cause of "notes left out" was the **default model is Haiku (200k context)**. Fixes shipped:
- Budget now scales to the model's real context window.
- Settings labels show context size; pre-flight warnings are model-aware and suggest Sonnet.
- **To include the most notes: pick Sonnet 4.6 in Settings (1M context).**
- Possible future work if even 1M isn't enough: map-reduce summarization (summarize note
  batches, then synthesize the summaries) so nothing is ever dropped.

## Settings (`src/components/SettingsPanel.jsx`)
Vault path, transcripts archive path, API key, model selector (Haiku/Sonnet), glossary
replacements, common corrections, and the per-account editor (name / archive folder /
aliases). Vault path must be the **plain** path — no shell escaping/backslashes.

## Recent commit history (newest first)
- Model-aware synthesis token budget (drop fewer notes)
- Require account-name match for cross-folder SL notes
- Scope account/SL summaries to the selected account only
- Stream synthesis output token-by-token with live progress
- Exclude ToDo folders from account summary cross-vault search
- Remove transcript archive support entirely from notes API and UI
