# Legal Builder Hub Plugin


**Every community skill is surfaced raw before install, scanned for prompt-injection patterns, and evaluated against the Legal Skill Design Framework. The plugin helps you find and evaluate; you decide what to trust.**

## Who this is for

Everyone using the other legal plugins. This is the app store.

## First run: cold-start

Asks your practice type, industry, team size, tooling comfort. Recommends a starter pack of community skills that match. Installs the ones you pick.

```
/legal-builder-hub:cold-start-interview
```

Your configuration is stored at `~/.codebuddy/plugins/config/legal-workflows/legal-builder-hub/practice-profile.md` and survives plugin updates.

## Security posture

Installed community skills run with your access to client data, matter files, and your team's playbook. The hub treats every install and every update as a trust decision. Four layers of defense, none of which is sufficient on its own:

- **Raw source, not summary:** the installer shows you the full raw `SKILL.md` — not an AI summary — before anything is written. A summary is a convenience; a skill that does something dodgy has to do it in text the raw display will show.
- **Heuristic scans:** both the installer and `skills-qa` scan the skill for prompt-injection patterns (override/authority claims, out-of-scope reads and writes, external URLs, hidden unicode, shell execution, credential asks). These are AI-heuristic scans, explicitly labeled as such — a clean scan is not a security audit, it is a prompt to read the text yourself.
- **Human approval, every time:** nothing is written to disk without a fresh typed `yes`. Approval is not inferred from earlier messages. For defense in depth, the installer recommends running the fetch / analysis in a read-only subagent so Write capabilities only become available after approval.



## Prerequisites


## Commands

| Command | Does |
|---|---|
| `/legal-builder-hub:cold-start-interview` | Practice profile + starter pack recommendation |
| `/legal-builder-hub:related-skills-surfacer` | Suggest skills based on what you've been doing |

## Skills

| Skill | Purpose |
|---|---|
| **cold-start-interview** | Practice profile → starter pack |
| **disable** | Disable a community skill without removing its files; re-enable later |
| **skills-qa** | Evaluate a skill against the Legal Skill Design Framework — design, failure modes, trust surface, and a prompt-injection heuristic scan |
| **related-skills-surfacer** | Surface related community skills after a task (direct or via hook) |

## Interactive commands vs. scheduled agents

The commands above run when you invoke them — for when you're working a matter. The agents below run on a schedule — for what moves while you're not looking:

| Agent | What it watches | Default cadence |
|---|---|---|

## Watched registries (default)

The default allowlist ships with the community registries we've reviewed pre-configured. Edit `references/allowlist-default.yaml` in the repo, or your per-install allowlist at `~/.codebuddy/plugins/config/legal-workflows/legal-builder-hub/allowlist.yaml`, to add, remove, or switch between restrictive and permissive modes.

- **lpm-skills** — Legal project management (Scott Margetts / LegalOps Consulting) — `github.com/legalopsconsulting/lpm-skills`
- **Lawvable / awesome-legal-skills** — Curated list of AI agent skills for legal work — `github.com/lawvable/awesome-legal-skills`
- **Lawvable / agent-skills** — Curated collection of agent skills for legal work — `github.com/lawvable/agent-skills`

## How it learns


## Notes

- Community skills are read before install. You see the **raw** SKILL.md — not a summary — before you accept.
- Auto-update is off by default. Turn it on per-skill if you trust the source.
- The related-skills-surfacer runs inside other plugins: when you're doing a task, it checks if the community has something relevant.
- Enterprise / firm deployments: set `mode: restrictive` in `allowlist.yaml` and populate the `registries`, `publishers`, and `connectors` lists. In restrictive mode the installer refuses to fetch, analyze, or install anything from an unlisted source.
