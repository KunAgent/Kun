# Command Reference

## Edge/Node Functions Initialization

For projects needing server-side functions, run before first deploy:

```bash
edgeone makers init
```

Pure static projects skip this.

## Local Development

```bash
edgeone makers dev    # http://localhost:8088/
```

## Environment Variables

```bash
edgeone makers env ls          # List all
edgeone makers env pull        # Pull to local .env
edgeone makers env add KEY val # Add
edgeone makers env rm KEY      # Remove
```

## Project Linking

```bash
edgeone makers link
edgeone makers link --name <project> -t <token>   # Non-interactive
```

## Token Management

| Task | How |
|------|-----|
| Save token | Stored in `.edgeone/.token` (auto-added to `.gitignore`) |
| Update token | Delete `.edgeone/.token`, then deploy again — prompted to enter and save a new one |
| Use saved token | Automatic — the agent reads `.edgeone/.token` before each token deploy |

## Full Command Reference (Makers)

| Action | Command |
|--------|---------|
| Install CLI | `npm install -g edgeone@latest` |
| Check version | `edgeone -v` (require >= 1.6.7) |
| Login (China, browser) | `edgeone login --site china` |
| Login (Global, browser) | `edgeone login --site global` |
| Login (token, auto-site) | `edgeone login --token <token>` |
| View login info | `edgeone whoami` |
| Logout | `edgeone logout` |
| Switch account | `edgeone switch` |
| Init functions | `edgeone makers init` |
| Local dev | `edgeone makers dev` |
| Link project | `edgeone makers link` |
| Link (non-interactive) | `edgeone makers link --name <project> -t <token>` |
| Deploy | `edgeone makers deploy` |
| Deploy new project | `edgeone makers deploy -n <name>` |
| Deploy preview | `edgeone makers deploy -e preview` |
| Deploy with token | `edgeone makers deploy -t <token>` |
| Deploy (JSON, Agent/CI) | `edgeone makers deploy -n <name> -t <token> --json` |

## Makers Commands (Agent Projects)

For projects with `agents/` directory (AI Agent endpoints). `edgeone makers` commands auto-handle agent runtime build.

| Action | Command |
|--------|---------|
| Makers dev (interactive) | `edgeone makers dev` |
| Makers dev (non-interactive) | `edgeone makers dev --name <project> --skip-env-sync -t <token>` |
| Makers dev (custom port) | `edgeone makers dev --port 3000` |
| Makers link | `edgeone makers link --name <project> -t <token>` |
| Makers deploy | `edgeone makers deploy -n <name> -t <token>` |
| Makers deploy (JSON) | `edgeone makers deploy -n <name> -t <token> --json` |
| Makers deploy (preview) | `edgeone makers deploy -n <name> -t <token> --json -e preview` |
| Makers env pull | `edgeone makers env pull -t <token>` |
| Makers env set | `edgeone makers env set <KEY> <VALUE>` |

## Non-Interactive Flags

| Flag | Applies to | Purpose |
|------|-----------|---------|
| `--name <project>` / `-n` | dev, link, deploy | Skip interactive project selection |
| `--skip-env-sync` | dev | Skip "sync env vars?" prompt |
| `-t <token>` | dev, link, deploy, env | Token auth (skip browser login) |
| `--json` | deploy | Machine-readable JSON output (single line) |
| `--port <number>` | dev | Custom frontend port |
| `-e preview\|production` | deploy | Target environment |

**Token precedence** (highest to lowest):
1. `-t <token>` flag on the command
2. `EDGEONE_PAGES_API_TOKEN` environment variable
3. `.edgeone/.token` file (saved token)
4. Browser login state
