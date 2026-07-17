---
name: makers-cli
description: >-
  EdgeOne Makers CLI command reference.
  Use when running edgeone CLI commands for dev, build, deploy, env management.
metadata:
  author: edgeone
  version: "1.0.0"
---

# EdgeOne Makers CLI Reference

## Install

```bash
npm install -g edgeone
```

Verify: `edgeone -v`

## Commands

| Command | Description |
|---------|-------------|
| `edgeone makers dev` | Start local dev server (agent runtime + frontend) |
| `edgeone makers build` | Build agents + frontend into `.edgeone/` |
| `edgeone makers deploy` | Build and deploy to EdgeOne Makers |
| `edgeone makers deploy -n <name>` | Deploy as a new project |
| `edgeone makers deploy -t <token>` | Deploy with API token (CI/headless) |
| `edgeone makers deploy -e preview` | Deploy to preview environment |
| `edgeone makers link` | Link local project to remote EdgeOne project |
| `edgeone makers env pull` | Pull remote env vars to local `.env` |
| `edgeone makers env set <KEY> <VALUE>` | Set a remote environment variable |
| `edgeone makers env ls` | List remote environment variables |
| `edgeone makers env rm <KEY>` | Remove a remote environment variable |
| `edgeone login` | Login (browser-based) |
| `edgeone login --site china` | Login to China site |
| `edgeone login --site global` | Login to Global site |
| `edgeone whoami` | Check current login status |

## Environment Variable

Before any `edgeone` command, set:

```bash
export PAGES_SOURCE=skills
```

Or inline: `PAGES_SOURCE=skills edgeone makers dev`

## Common Workflows

### First-time setup
```bash
npm install -g edgeone
edgeone login
edgeone makers link
edgeone makers env pull
edgeone makers dev
```

### Deploy
```bash
edgeone makers deploy
```

### Set env vars for production
```bash
edgeone makers env set WSA_API_KEY "your-key"
edgeone makers env set SUPABASE_URL "https://xxx.supabase.co"
```
