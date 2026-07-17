---
name: edgeone-makers-deploy
description: >-
  This skill deploys frontend and full-stack projects to EdgeOne Makers (Tencent EdgeOne).
  Trigger this skill whenever deployment is part of the task — whether as the primary intent
  or a secondary step. Examples: "deploy my app", "publish this site", "push this live",
  "create a preview deployment", "deploy to EdgeOne", "ship to production",
  "go live", "release", "publish a new version", "redeploy",
  "上线", "发布", "发一版", "重新部署",
  "搭建并部署", "开发并上线", "build and deploy", "create and deploy".
  ⚠️ Also trigger when any agent is about to execute `edgeone makers deploy` or `edgeone makers deploy`
  commands — the skill contains critical rules for parsing deploy output and presenting access URLs.
  Do NOT trigger for post-deployment runtime errors (e.g. CORS issues, 500 errors after deploy —
  use edgeone-makers-dev for troubleshooting).
metadata:
  author: edgeone
  version: "2.1.0"
---

# EdgeOne Makers Deployment Skill

Deploy any project to **EdgeOne Makers**.

## ⛔ Critical Rules (never skip)

1. **CLI version >= `1.6.7`** — reinstall if lower. Versions below `1.6.7` lack the non-interactive fixes (whoami fail-fast, `--json` output) and will hang in Agent/CI environments. Never proceed with an outdated version.
2. **Never truncate the deploy URL** — `EDGEONE_DEPLOY_URL` includes query parameters required for access. Always output the **complete** URL.
3a. **Prefer `--json` when running non-interactively** — in Agent/CI/headless contexts, always pass `--json` to `deploy` so the result is a single machine-readable line; no need to scrape colored/`\r`-animated stdout. See **Parse Deploy Output**.
3b. **Use `edgeone whoami` to check login status** — on CLI >= 1.6.7, `whoami` fails fast (exit 1) when not logged in instead of hanging. If it exits 0, the user is already logged in and `-t` is not needed. **Do NOT** check `cat .edgeone/.token` — CLI stores credentials in `~/.edgeone/<hash>` files, not a fixed `.token` path.
4. **⚠️ 部署地址必须醒目地放在回复最前面** — 部署完成后，完整的访问 URL 是用户最关心的核心交付物。必须做到：① 放在回复正文的第一行或第一个独立区块；② 使用醒目的格式（如大标题 + 代码块）；③ 绝不能把地址埋在长段落中间让用户去找。示例格式：
   ```
   🌐 线上地址：https://my-project-abc123.edgeone.cool?<auth_query_params>
   ```
   然后再附上其他说明（控制台地址、注意事项等）。
5. **Ask the user to choose China or Global site** before browser login. Never assume. (Token login via `edgeone login --token` auto-detects site, no need to ask.)
6. **Auto-detect the login method** — browser login in desktop environments, token login in headless/remote/CI environments. Follow the decision table below.
7. **After token login, ask if the user wants to save the token locally** for future use.
8. **Before triggering any browser popup (login / registration), explain the reason and the benefits to the user first** — never silently launch a browser window.

---

## Environment Setup

Before executing **any** `edgeone` CLI command (install, login, deploy, etc.), set the following environment variable in the current shell session:

```bash
export PAGES_SOURCE=skills
```

Or prefix each command inline:

```bash
PAGES_SOURCE=skills edgeone makers deploy
```

This tells the platform that the deployment is triggered from an AI skill context.

---

## Deployment Flow

Run these checks first, then follow the decision table:

```bash
# Check 0: Set environment variable (required before any edgeone command)
export PAGES_SOURCE=skills

# Check 1: CLI installed and correct version? (must be >= 1.6.7)
edgeone -v

# Check 2: Already logged in? (CLI >= 1.6.7 whoami fails fast, won't hang)
edgeone whoami
# If exit 0 → logged in, no -t needed
# If exit 1 → not logged in, need token or browser login

# Check 3: Project already linked?
cat edgeone.json 2>/dev/null
```

### Decision Table

| CLI version | Login status | Action |
|-------------|-------------|--------|
| Not installed or < 1.6.7 | — | → Go to **Install CLI** |
| `>= 1.6.7` ✓ | Logged in (or token present) | → Go to **Deploy** |
| `>= 1.6.7` ✓ | Not logged in, has saved token | → Go to **Deploy with Token** (use saved token) |
| `>= 1.6.7` ✓ | Not logged in, no saved token, **interactive desktop** | → Go to **Login** (browser) |
| `>= 1.6.7` ✓ | Not logged in, no saved token, **non-interactive (Agent/CI/headless)** | → Ask user for a **token**; browser login is unavailable and `deploy` will fail fast with a token hint |

---

## Install CLI

```bash
npm install -g edgeone@latest
```

Verify: `edgeone -v` — confirm output is `1.6.7` or higher. Retry installation if not. (Versions < 1.6.7 hang on `whoami`/login in non-interactive environments and lack `--json`.)

---

## Login

### 0. Explain the registration/login step

Before triggering any login flow, explain to the user **why** this step is needed and **what** to expect. Do not silently launch a browser window.

Tell the user:

> You need to log in or register an EdgeOne Makers account. Here's what to expect:
> - **Why login is required**: Deployment uploads your build output to your own account, generating a unique access URL and project record.
> - **What you get for free**: EdgeOne Makers offers a free tier with global CDN acceleration, automatic HTTPS, and custom domain binding — typically more than enough for personal projects.
> - **What happens next**: I'll run `edgeone login`, and your default browser will open the Tencent Cloud login page. Please complete the login/registration and authorize access, then come back here.
> - **If you get stuck**: If the browser doesn't open, or the CLI keeps waiting after you've logged in, let me know — I'll switch to Token login instead.

If the user does not respond for an extended period (e.g., more than 1–2 minutes), **proactively ask** about their status (whether the browser opened, any errors, or if they want to switch to Token login). Do not wait indefinitely.

### 1. Ask the user to choose a site, then ALWAYS pass `--site`

Use the IDE's selection control (`ask_followup_question`) before running any login command:

> Choose your EdgeOne Makers site:
> - **China** — For users in mainland China (console.cloud.tencent.com)
> - **Global** — For users outside China (console.intl.cloud.tencent.com)

⚠️ **CRITICAL**: After the user chooses, you MUST invoke login with an explicit
`--site <china|global>` flag (e.g. `edgeone login --site china`).
**NEVER run a bare `edgeone login` (without `--site`) when driven by an Agent / skill.**
On CLI >= 1.6.7, a bare `login` in a non-interactive context fails fast asking for
`--site` (it no longer pops an interactive site-picker that would hang). The site choice
is meant to happen here in the conversation, not inside the CLI.

### 2. Detect environment and choose login method

| Condition | Method |
|-----------|--------|
| Local desktop IDE (VS Code, Cursor, WorkBuddy, etc.) | **Browser Login** |
| Remote / SSH / container / CI / cloud IDE / headless | **Token Login** |
| User explicitly requests token | **Token Login** |

#### Browser Login

```bash
# China site
edgeone login --site china

# Global site
edgeone login --site global
```

Wait for the user to complete browser auth. The CLI prints a success message when done.

⚠️ **Browser Session Reuse Trap**: If the user previously logged into a **different site** (e.g., logged into Global site before, now trying China site, or vice versa), the browser may **silently reuse the old Tencent Cloud session**. The CLI will appear to succeed, but actually binds to the wrong account — subsequent `deploy` will fail with auth errors or `whoami` shows an unexpected account.

If this happens, guide the user to:
1. Click "**Sign in with a different account**" on the login page; or
2. Log out from **all Tencent Cloud consoles** (both `console.cloud.tencent.com` and `console.intl.cloud.tencent.com`) first, then re-run `edgeone login`.

#### Token Login

Two methods available:

**Method A: `edgeone login --token` (persistent, recommended)**

```bash
edgeone login --token <token>
```

Auto-detects china/global from the token — no `--site` flag needed. Persists login state for subsequent commands.

**Method B: Pass `-t` directly in deploy (per-invocation)**

Token is used for that single deploy only; no persistent login state is saved.

```bash
edgeone makers deploy -t <token>
```

⚠️ **Important**: `edgeone whoami` does NOT support a `-t` flag. Do NOT attempt to verify a token with `whoami -t <token>`. When the user provides a token, skip login checks entirely and go straight to deploy.

Guide the user to obtain a token:
1. Go to the console:
   - **China**: https://console.cloud.tencent.com/edgeone/pages?tab=settings
   - **Global**: https://console.intl.cloud.tencent.com/edgeone/pages?tab=settings
2. Find **API Token** → **Create Token** → Copy it

⚠️ Remind the user: the token has account-level permissions. Never commit it to a repository.

### 3. Offer to save the token locally

After the user provides a token, ask:

> Save this token locally for future deployments?
> - **Yes** — Save to `.edgeone/.token` (auto-used next time)
> - **No** — Use for this deployment only

**If Yes:**

```bash
mkdir -p .edgeone
echo "<token>" > .edgeone/.token
grep -q '.edgeone/.token' .gitignore 2>/dev/null || echo '.edgeone/.token' >> .gitignore
```

Confirm to the user: "✅ Token saved to `.edgeone/.token` and added to `.gitignore`."

---

## Deploy

### Browser-authenticated deploy (Makers projects)

```bash
# Project already linked (edgeone.json exists)
edgeone makers deploy

# New project (no edgeone.json)
edgeone makers deploy -n <project-name>
```

`<project-name>`: auto-generate from the project directory name. The first deploy creates `edgeone.json` automatically.

### Token-based deploy (Makers projects)

First check for a saved token:

```bash
cat .edgeone/.token 2>/dev/null
```

- Saved token found → use it, tell the user: "Using saved token from `.edgeone/.token`"
- No saved token → ask the user to provide one (see Token Login above)

```bash
# Project already linked
edgeone makers deploy -t <token>

# New project
edgeone makers deploy -n <project-name> -t <token>
```

The token already contains site info — no `--site` flag needed.

After a successful deploy with a manually-entered token, ask if the user wants to save it (see "Offer to save the token locally" above).

### Deploy to preview environment

```bash
edgeone makers deploy -e preview
```

### Non-interactive / Agent / CI deploy (recommended: `--json`)

When running inside an Agent, CI, or any non-TTY context, **add `--json`** so the final
result is emitted as a single machine-readable line — no scraping of colored stdout:

```bash
edgeone makers deploy -n <project-name> --json
edgeone makers deploy -n <project-name> -t <token> --json
```

### Makers Agent Projects deploy

For projects with `agents/` directory (AI Agent projects), use `edgeone makers deploy` which auto-runs build:

```bash
edgeone makers deploy -n <name> -t <token> --json
edgeone makers deploy -n <name> -t <token> --json -e preview
```

Note: `edgeone makers deploy` automatically runs build before deploying — no separate `edgeone makers build` step needed.

### Build behavior

The CLI auto-detects the framework, runs the build, and uploads the output directory. No manual config needed.

---

## ⚠️ Parse Deploy Output (Critical)

### Preferred: `--json` (CLI >= 1.6.7)

When deploy is run with `--json`, the **last line** of stdout is a single JSON object —
parse that directly, no regex / ANSI cleanup needed:

```json
{"status":"success","url":"https://my-project-abc123.edgeone.cool?<auth_query_params>","type":"preset","projectId":"makers-xxxxxxxx","deploymentId":"dp-xxxx","consoleUrl":"https://console.cloud.tencent.com/edgeone/pages/project/makers-xxxxxxxx/deployment/xxxxxxx"}
```

On failure the last line is `{"status":"error","error":"<message>"}` and the process exits non-zero.

Use `url` (full, with query string), `projectId`, and `consoleUrl` directly.

### Fallback: text output (no `--json`)

After `edgeone makers deploy` succeeds, the CLI outputs:

```
[cli][✔] Deploy Success
EDGEONE_DEPLOY_URL=https://my-project-abc123.edgeone.cool?<auth_query_params>
EDGEONE_DEPLOY_TYPE=preset
EDGEONE_PROJECT_ID=makers-xxxxxxxx
[cli][✔] You can view your deployment in the EdgeOne Makers Console at:
https://console.cloud.tencent.com/edgeone/pages/project/pages-xxxxxxxx/deployment/xxxxxxx
```

**Extraction rules:**

| Field | How to extract | ⛔ Warning |
|-------|---------------|-----------|
| **Access URL** | Full value after `EDGEONE_DEPLOY_URL=` | **Include the full query string** (`?` and everything after) — without these params the page will not load |
| **Project ID** | Value after `EDGEONE_PROJECT_ID=` | — |
| **Console URL** | Line after "You can view your deployment..." | — |

**Show the user — 部署地址必须放在回复最前面、最醒目的位置：**

> 🌐 **线上地址**：`https://my-project-abc123.edgeone.cool?<auth_query_params>`
>
> ---
>
> - **Console URL**: `https://console.cloud.tencent.com/edgeone/pages/project/...`
>
> ℹ️ Note: This preview URL is for quick deployment verification. When accessed from mainland China, the link may become restricted (e.g., 401) after some time or when shared, due to domain ICP filing status or CDN acceleration policies. For long-term stable public access, bind a custom domain with proper ICP filing.

---

## Error Handling

| Error | Solution |
|-------|----------|
| `command not found: edgeone` | Run `npm install -g edgeone@latest` |
| CLI version < 1.6.7 | Reinstall: `npm install -g edgeone@latest`. Older versions hang on whoami/login in non-interactive contexts |
| Browser does not open during login | Switch to token login |
| "not authenticated" / exit 1 from `whoami` (CLI >= 1.6.7) | Expected when not logged in — whoami now fails fast instead of hanging. Run `edgeone login` (desktop) or provide a token |
| Non-interactive deploy says "browser login is unavailable" + exits 1 | Expected fail-fast in Agent/CI/headless with no token. Provide a token via `-t <token>` or set `EDGEONE_PAGES_API_TOKEN` |
| Deploy seems to hang at `[DeployStatus] Deploying...` | On CLI >= 1.6.7 non-TTY emits heartbeat lines; it is NOT stuck. If a wrapper still mis-detects, use `--json` or run in background and poll. Do not kill it |
| Auth error with token | Token may be expired — regenerate at the console |
| Login appears successful but `deploy` reports auth error | Browser reused a session from the wrong site, binding the wrong account. Click "Sign in with a different account" on the login page, or log out from all Tencent Cloud consoles first |
| `edgeone whoami` shows an unexpected account | Browser session reuse. Click "Sign in with a different account" or log out from all consoles and re-login |
| Project name conflict | Use a different name with `-n` |
| Build failure | Check logs — usually missing deps or bad build script |

---

For CLI command reference, environment variables, local dev setup, and token management details, see [references/command-reference.md](references/command-reference.md).
