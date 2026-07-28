# Sharing This App — Setup Guide for a Friend

This is a **local web app**. It runs on your own computer and reads your
Obsidian vault directly off your hard drive. There is no website to visit
and no shared cloud version — you run your own copy. This guide takes you
from zero to a working app.

---

## What you need first

1. **Node.js 18 or newer** — check by running `node -v` in a terminal.
   If you don't have it, install from [nodejs.org](https://nodejs.org)
   (pick the "LTS" version).
2. **An Anthropic API key** — your own, not the person who shared this with
   you. Get one at [console.anthropic.com](https://console.anthropic.com).
   The key is tied to billing, so everyone uses their own.
3. **An Obsidian vault** on your computer (a folder of `.md` notes).

---

## Getting the code

### If you were given a GitHub link
```bash
git clone <the-repo-url>
cd notetaker-webapp
```

### If you were sent a zip file
Unzip it, then open a terminal in that folder. (The zip should NOT contain
`node_modules` or a `.env.local` file — you'll create those below.)

---

## Setup (one time)

From inside the project folder:

### 1. Install dependencies
```bash
npm install
```

### 2. Add your API key
Copy the example env file:
```bash
cp .env.example .env.local
```
Then open `.env.local` in any text editor and paste your key:
```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```
(You can also skip this and paste the key into the app's Settings panel
instead — it's stored only in your browser.)

### 3. Start the app
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) in your browser.

### 4. Point it at your vault
- Open **Settings** in the app
- Enter the full path to your Obsidian vault
  (e.g. `/Users/yourname/Documents/MyVault`)
- Click **Test Path** to confirm it works

---

## Running it day to day

Each time you want to use it:
```bash
cd notetaker-webapp
npm run dev
```
Then open http://localhost:3000. Close the terminal when you're done.

(On Mac there's also a `Start Notetaker.command` file you can double-click
to launch it without typing commands.)

---

## What the app does

It has several tabs:
- **New Note** — paste a meeting transcript, get structured Obsidian notes
- **Account Status** — quarterly account summary from your notes
- **SL Status** — SystemLink-focused account summary
- **EA Activity** — generates an activity table for Salesforce reporting

---

## Things you'll probably want to change

This app was built for a specific NI Software CS workflow. Some parts are
tailored and you may want to adjust them:

- **Accounts** (Settings) — set up your own account names, aliases, and
  keywords. Aliases drive cross-folder search; keywords keep one account's
  terms out of another account's summary.
- **EA Activity taxonomy** — the Type/Subtype categories in the EA Activity
  tab are specific to NI's Salesforce setup. If your categories differ,
  they're defined in `src/app/api/synthesize/route.js` (look for
  `buildCSMActivityPrompt`).
- **Report structure** — the Account Status pillars and sections are also
  in `src/app/api/synthesize/route.js`.

---

## Important notes

- **Never share your API key.** It's tied to your billing. If you got this
  app from someone, do not reuse their key — get your own.
- **It only works on your machine with your vault.** Nothing is uploaded or
  shared; your notes stay local. Notes are sent to Anthropic's API only when
  you click Generate.
- **Privacy:** the app pseudonymizes names from your glossary before sending
  text to Claude, and reverses them in the output.

---

## Troubleshooting

- **"command not found: npm"** — Node.js isn't installed. See step 1 above.
- **Blank page / port in use** — something else is on port 3000. Stop it, or
  the app will pick another port (check the terminal output for the URL).
- **"API key required"** — add your key to `.env.local` or paste it into
  Settings.
- **Vault path won't validate** — make sure it's the full absolute path to
  the vault folder, and that the folder exists.
