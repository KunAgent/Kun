# Team Setup

How to define agents, assign roles, select models, and isolate workspaces.

## Define Roles First, Then Agents

Start with the work, not the agents. List the types of work, then create roles to cover them.

**Minimal team (2 agents):**
```
Orchestrator — routes tasks, tracks state
Builder      — executes work
```

**Standard team (3-4 agents):**
```
Orchestrator — routes, prioritizes, reports to stakeholders
Builder      — produces artifacts (code, docs, configs)
Reviewer     — verifies quality, catches gaps
Ops          — scheduled tasks, health checks, mechanical work
```

**Rule:** One agent, one primary role. An agent can do secondary work, but its role determines what it's optimized for.

## Model Selection Per Role

Match model cost to the cognitive demands of the role.

| Role | Needs | Model tier |
|------|-------|-----------|
| Orchestrator | Judgment, prioritization, multi-context reasoning | Top tier (e.g., Claude Opus, GPT-4.5) |
| Builder | Code generation, following specs, producing artifacts | Mid-to-top tier depending on complexity |
| Reviewer | Critical analysis, catching edge cases, feasibility | Top tier — reviewers catch what builders miss |
| Ops | Following templates, running scripts, dispatching | Cheapest reliable model (e.g., GPT-4o-mini, Haiku) |

**Don't waste expensive models on mechanical work.** Cron-based standups, file organization, and template-following tasks don't need frontier reasoning.

## Workspace Isolation

Each agent operates in its own workspace to prevent interference.

```
/workspace/
├── agents/
│   ├── builder/          — Builder's personal workspace
│   │   └── SOUL.md       — Builder's identity and instructions
│   ├── reviewer/         — Reviewer's personal workspace
│   │   └── SOUL.md
│   └── ops/
│       └── SOUL.md
├── shared/               — Shared across all agents
│   ├── specs/            — Requirements and specifications
│   ├── artifacts/        — Build outputs
│   ├── reviews/          — Review notes and feedback
│   └── decisions/        — Architecture and product decisions
```

**Rules:**
- Agents read/write their own workspace freely
- Agents write deliverables to `/shared/` — never to personal workspaces
- Agents can read any shared directory
- Orchestrator can read all workspaces for oversight

## Identity Files (SOUL.md)

Each agent gets a SOUL.md that defines:

1. **Role and scope** — What this agent does and doesn't do
2. **Communication style** — How it writes comments, reports, asks questions
3. **Boundaries** — What requires escalation vs. autonomous action
4. **Team context** — Who else is on the team and how to interact with them

Example SOUL.md for a builder agent:

```markdown
# SOUL.md — Builder

I build what the specs say. My job is execution, not product decisions.

## Scope
- Implement features per approved specs
- Write tests for what I build
- Document non-obvious decisions in code comments
- Hand off with clear verification steps

## Boundaries
- Spec unclear? Ask the orchestrator, don't guess
- Architecture change needed? Propose it, don't just do it
- Blocked for >10 minutes? Comment on the task and move on

## Handoff Format
Every completed task includes:
1. What I changed and why
2. File paths for all artifacts
3. How to test/verify
4. Known limitations
```

## Adding a New Agent

1. Create the workspace directory
2. Write its SOUL.md
3. Update the team protocol with its role
4. Verify it has the capabilities it needs (browser, tools, API access)
5. Start with a small task to validate the setup before loading it into the rotation
