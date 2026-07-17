# Agent Browser Overview

## 1) What it is
- A fast Rust-based headless browser automation CLI with a Node.js fallback.
- Designed for AI agents to navigate, click, type, and snapshot pages via structured commands.
- Uses a background daemon and Playwright for browser control.

## 2) Install and setup (hardened)
- Pin the version you trust:
  - `npm install -g agent-browser@<version>`
- Prefer a dedicated environment or container for installs.
- Avoid running with elevated OS privileges.
- Install browser runtime:
  - `agent-browser install`
- Linux dependencies (if needed):
  - `agent-browser install --with-deps`
  - or `npx playwright install-deps chromium`

## 3) Browser engines
- Chromium is the default browser engine.
- Firefox and WebKit are supported through Playwright.

## 4) Snapshot concept
- `snapshot` returns a structured view with stable element refs.
- Refs are designed for compact, deterministic automation.

## 5) Sessions
- The CLI supports multiple sessions so agents can isolate work.

## 6) Security posture
- Treat the CLI as high privilege; run with strict allowlists.
- Avoid file access and arbitrary script execution unless required.
- Keep profiles and state files ephemeral by default.
