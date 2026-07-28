# Notecroppy

A local web app that turns meeting transcripts, email threads, and account context into structured Obsidian notes using Claude.

## What it does

Upload or paste a meeting transcript, select a folder in your Obsidian vault, and Claude generates:

1. **Executive Summary** — 3-5 sentence overview of the meeting
2. **Meeting Notes** — Exhaustive bulleted notes covering every important point
3. **NI SW Customer Success Takeaways** — Items your CS team needs to know
4. **Action Items** — Checkbox-style tasks with owner and due date
5. **Next Steps** — Agreed follow-ups and upcoming milestones

Notes are saved directly as `.md` files into your vault, instantly visible in Obsidian.

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Add your Anthropic API key

Create a `.env.local` file in the project root:

```bash
cp .env.example .env.local
```

Then edit `.env.local` and add your key:

```
ANTHROPIC_API_KEY=sk-ant-your-key-here
```

Alternatively, you can enter the API key directly in the app's Settings panel — it's stored only in your browser session.

Get an API key at [console.anthropic.com](https://console.anthropic.com).

### 3. Start the app

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### 4. Configure in the app

- Open **Settings** and enter your Obsidian vault path (e.g. `/Users/yourname/Documents/MyVault`)
- Click **Test Path** to verify it works

## Usage

1. Enter the meeting title and date
2. Paste your transcript or upload a `.txt` file
3. Select the target folder in your vault (right panel)
4. Click **Generate Meeting Notes**
5. Review the preview, then click **Save to Obsidian**

The file is saved as `YYYY-MM-DD - Meeting Title.md` in your chosen folder.

## Requirements

- Node.js 18+
- An Anthropic API key
- Your Obsidian vault accessible on the local file system
