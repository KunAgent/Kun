---
name: agent-browser-core
description: OpenClaw skill for the agent-browser CLI (Rust-based with Node.js fallback) enabling AI-friendly web automation with snapshots, refs, and structured commands.
description_zh: "基于 agent-browser CLI 的 AI 友好型网页自动化"
description_en: "AI-friendly web automation via agent-browser CLI with snapshots & refs"
version: 1.0.1
allowed-tools: Bash
---

# Agent Browser Skill (Core)

## Purpose
Provide an advanced, production-ready playbook for using agent-browser to automate web tasks via CLI and structured commands.

## Best fit
- You need deterministic automation for AI agents.
- You want compact snapshots with refs and JSON output.
- You prefer a fast CLI with Node.js fallback.

## Not a fit
- You require a full SDK or custom JS integration.
- You must stream large uploads or complex media workflows.

## Quick orientation
- Read `references/agent-browser-overview.md` for install, architecture, and core concepts.
- Read `references/agent-browser-command-map.md` for command categories and flags.
- Read `references/agent-browser-safety.md` for high-risk controls and safe mode rules.
- Read `references/agent-browser-workflows.md` for recommended AI workflows.
- Read `references/agent-browser-troubleshooting.md` for common issues and fixes.

## Required inputs
- Installed agent-browser CLI and browser runtime.
- Target URLs and workflow steps.
- Session or profile strategy if authentication is required.

## Expected output
- A clear command sequence and operational guardrails for automation.

## Operational notes
- Snapshot early, act via refs, then snapshot again after DOM changes.
- Use `--json` for machine parsing and scripting.
- Use waits and load-state checks before actions.
- Close tabs or sessions when done to release resources.

## Safe mode defaults
- Do not use `eval`, `--allow-file-access`, custom `--executable-path`, or arbitrary `--args` without explicit approval.
- Avoid `network route`, `set credentials`, and cookie/storage mutations unless the task requires it.
- Allowlist domains and block localhost or private network targets.

## Security notes
- Treat tokens and credentials as secrets.
- Avoid `--allow-file-access` unless explicitly required.
