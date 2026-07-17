---
name: notebooklm-studio
description: "Import sources (URLs, YouTube, files, text) into Google NotebookLM and generate artifacts: podcasts, videos, reports, quizzes, flashcards, mind maps, slide decks, infographics, data tables. Use when users want to study from web content, create learning materials from URLs or documents, generate quizzes from articles, or produce study aids."
description_zh: "NotebookLM 学习工作室：导入多种来源，生成播客、测验、抽认卡、思维导图等学习产物"
description_en: "NotebookLM Studio: import sources and generate podcasts, quizzes, flashcards, mind maps and more"
version: 2.1.3
homepage: https://clawhub.ai/skills/notebooklm-studio
allowed-tools: Read,Write,Bash
---

# NotebookLM Studio

Import sources into NotebookLM, generate user-selected artifacts via CLI, download results locally.

## Inputs

Collect from user message (ask only for missing fields):

- **Sources**: URLs, YouTube links, text notes, or file attachments (PDF, Word, audio, image, Google Drive link)
- **Artifacts**: User selects from 9 types (no default — always ask):
  - `audio` (podcast), `video`, `report`, `quiz`, `flashcards`, `mind-map`, `slide-deck`, `infographic`, `data-table`
- **Language** (optional, default: `zh_Hant`): applied via `notebooklm language set`
- **Artifact options**: format, style, length, difficulty, etc.
- **Custom instructions** (optional): passed as description to generate commands

## Workflow

**Steps are sequential gates — do NOT skip or combine steps.**

0. **Auth precheck** — Verify the session is valid:
   ```
   notebooklm auth check --test --json
   ```

1. **Parse input & configure artifacts** —
   - 1a. Select artifacts
   - 1b. Discuss options (ASK / OFFER / SILENT priority levels)

2. **Derive slug** — Generate a short kebab-case slug for the notebook name and output directory.

3. **Create notebook** —
   ```
   notebooklm create "<slug> <YYYYMMDD>"
   notebooklm use <notebook_id>
   mkdir -p ./output/<slug>
   ```

4. **Set language** — `notebooklm language set <confirmed_language>`

5. **Add sources** — For each source: `notebooklm source add "<url_or_filepath>"`

6. **Generate artifacts** — Two-tier strategy:
   - **Tier 1 (Immediate)**: mind-map, report, quiz, flashcards, data-table, infographic — use `--wait`
   - **Tier 2 (Deferred)**: slide-deck, video, audio — use `--json`, capture `task_id` for polling

7. **Download Tier 1** — Each artifact into `./output/<slug>/`

8. **Report + Deliver Tier 1** — Present completed artifacts to user

9. **Poll + Deliver Tier 2** — Wait for deferred artifacts, download and deliver as each completes

## Artifact Types

| Type | Tier | Typical Time |
|------|------|-------------|
| mind-map | 1 | Instant |
| report | 1 | 1-2 min |
| quiz | 1 | 1-2 min |
| flashcards | 1 | 1-2 min |
| data-table | 1 | 1-2 min |
| infographic | 1 | 2-5 min |
| slide-deck | 2 | 5-15 min |
| video | 2 | 10-30 min |
| audio (podcast) | 2 | 10-30 min |

## Requirements

- `notebooklm` CLI (`notebooklm-py`)
- `ffmpeg` (for audio compression)
- `playwright` (for browser automation)

## Error Handling

- **Auth errors**: Caught by step 0 precheck. Re-login if expired.
- **Tier 1 failure**: Retry up to 2 times, then include failure note in delivery.
- **Tier 2 failure**: Notify user per-artifact. Tier 1 already delivered.
- **Timeout recovery**: Never re-generate on timeout. Re-check status, re-wait if still processing.

## Delivery Template

1. Selection rationale (≤3 bullets)
2. Artifact list with paths/status
3. Key takeaways (3-5 bullets)
4. Failures + fallback note (if any)
5. One discussion question
