# Private configuration

This repository is public. Account names, aliases, keywords, EA/EP numbers, and
the pseudonymization glossary are all customer data, so none of them live in
source. The committed defaults in `src/lib/accounts.js` are fictional
placeholders (Acme Aerospace, Beacon Systems, Cardinal Defense, Delta
Microsystems) that exist only so a fresh clone runs and demos.

## Loading the real roster

1. Start the app (`npm run dev`) and open **Settings**.
2. Click **Import config** and choose `private/notetaker-accounts.json`.
3. Review the accounts that appear, then click **Save Settings**.

Saving writes the roster to `notetaker-config.json` in your transcripts folder,
which is where the app reads it from on every subsequent start — on that
machine you only import once.

## EA / EP numbers

Each account carries an `agreements` array of its EA/EP numbers:

```json
{
  "name": "Example Account",
  "agreements": [
    { "type": "EA", "number": "EA-12345", "keywords": ["training", "credits"] },
    { "type": "EP", "number": "EP-67890", "keywords": [] }
  ]
}
```

`keywords` decide which agreement gets suggested for a given meeting: an
agreement matches when any of its keywords appears as a whole word in the
transcript. **An entry with an empty `keywords` array always applies** to that
account, which is what you want when an account has exactly one agreement.
Matching runs client-side against the original transcript, before
pseudonymization, so it is exact.

Matched numbers are offered in the SFDC Activity Entry when notes are
generated.

Add them either way:

- **In the app** — Settings → Accounts → **+ Add EA / EP number**, then Save
  Settings. This is the easier path and writes straight to
  `notetaker-config.json`.
- **In the file** — fill in the `agreements` arrays in
  `private/notetaker-accounts.json`, then Import config → Save Settings.

> Your real EA/EP numbers were never committed to this repository, so the
> seed file ships with empty `agreements` arrays rather than invented
> placeholders — a wrong agreement number would flow into a real Salesforce
> entry. `_agreements_example` in that file shows the exact shape; keys
> beginning with `_` are ignored on import.

## What lives where

| Data | Location | Committed? |
|---|---|---|
| Placeholder accounts | `src/lib/accounts.js` | Yes — fictional |
| Real accounts, aliases, keywords, agreements | `notetaker-config.json` in your transcripts folder | No |
| Pseudonymization glossary (real people's names) | `notetaker-glossary.json` in your transcripts folder | No |
| Anthropic API key | browser `sessionStorage`, or `.env.local` | No |
| Seed copy of the real roster for a new machine | `private/notetaker-accounts.json` | No — `/private/` is gitignored |

`private/`, `notetaker-config.json`, `notetaker-glossary.json`, and any
`notetaker-settings-*.json` export are all gitignored. Verify before pushing:

```bash
git check-ignore -v private/notetaker-accounts.json
```

## Moving to a new machine

Settings → **Export config** writes `notetaker-settings-<date>.json` with the
full configuration. That file contains real names and is gitignored by the
same rules — move it over an out-of-band channel, not through this repo. The
API key is excluded from the export unless you explicitly tick the checkbox.

## Where account names still reach the model

Account names are sent to the Anthropic API at request time as part of the
prompt — they are scoping instructions for the report ("report on X only,
never mention Y"). That is unchanged and unavoidable given what the app does.
The point of this setup is that the names travel from your local config, not
from a public git history.

Two routes build those instructions from the configured roster rather than a
hardcoded list:

- `src/app/api/process/route.js` — `buildTagCategories(accounts)` injects
  account names and their keywords (as division tags) into the tagging prompt.
- `src/app/api/synthesize/route.js` — `buildExclusionList(...)` builds the
  cross-account exclusion rules from `allAccounts`.

If you add an account in Settings, both pick it up with no code change.
