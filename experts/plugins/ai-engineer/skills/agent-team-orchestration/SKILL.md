---
name: agent-team-orchestration
description: "Orchestrate multi-agent teams with defined roles, task lifecycles, handoff protocols, and review workflows. Use when: (1) Setting up a team of 2+ agents with different specializations, (2) Defining task routing and lifecycle (inbox → spec → build → review → done), (3) Creating handoff protocols between agents, (4) Establishing review and quality gates, (5) Managing async communication and artifact sharing between agents."
description_zh: "多智能体团队编排：角色定义、任务流转、交接协议与质量门禁"
description_en: "Orchestrate multi-agent teams with roles, task lifecycles, handoffs, and review workflows"
version: 1.0.0
homepage: https://clawhub.ai/skills/agent-team-orchestration
allowed-tools: Read,Write,Bash
---

# Agent Team Orchestration

Production playbook for running multi-agent teams with clear roles, structured task flow, and quality gates.

## Quick Start: Minimal 2-Agent Team

A builder and a reviewer. The simplest useful team.

### 1. Define Roles

```
Orchestrator (you) — Route tasks, track state, report results
Builder agent     — Execute work, produce artifacts
```

### 2. Spawn a Task

```
1. Create task record (file, DB, or task board)
2. Spawn builder with:
   - Task ID and description
   - Output path for artifacts
   - Handoff instructions (what to produce, where to put it)
3. On completion: review artifacts, mark done, report
```

### 3. Add a Reviewer

```
Builder produces artifact → Reviewer checks it → Orchestrator ships or returns
```

That's the core loop. Everything below scales this pattern.

## Core Concepts

### Roles

Every agent has one primary role. Overlap causes confusion.

| Role | Purpose | Model guidance |
|------|---------|---------------|
| **Orchestrator** | Route work, track state, make priority calls | High-reasoning model (handles judgment) |
| **Builder** | Produce artifacts — code, docs, configs | Can use cost-effective models for mechanical work |
| **Reviewer** | Verify quality, push back on gaps | High-reasoning model (catches what builders miss) |
| **Ops** | Cron jobs, standups, health checks, dispatching | Cheapest model that's reliable |

→ *Read [references/team-setup.md](references/team-setup.md) when defining a new team or adding agents.*

### Task States

Every task moves through a defined lifecycle:

```
Inbox → Assigned → In Progress → Review → Done | Failed
```

**Rules:**
- Orchestrator owns state transitions — don't rely on agents to update their own status
- Every transition gets a comment (who, what, why)
- Failed is a valid end state — capture why and move on

→ *Read [references/task-lifecycle.md](references/task-lifecycle.md) when designing task flows or debugging stuck tasks.*

### Handoffs

When work passes between agents, the handoff message includes:

1. **What was done** — summary of changes/output
2. **Where artifacts are** — exact file paths
3. **How to verify** — test commands or acceptance criteria
4. **Known issues** — anything incomplete or risky
5. **What's next** — clear next action for the receiving agent

Bad handoff: *"Done, check the files."*
Good handoff: *"Built auth module at `/shared/artifacts/auth/`. Run `npm test auth` to verify. Known issue: rate limiting not implemented yet. Next: reviewer checks error handling edge cases."*

### Reviews

Cross-role reviews prevent quality drift:

- **Builders review specs** — "Is this feasible? What's missing?"
- **Reviewers check builds** — "Does this match the spec? Edge cases?"
- **Orchestrator reviews priorities** — "Is this the right work right now?"

Skip the review step and quality degrades within 3-5 tasks. Every time.

→ *Read [references/communication.md](references/communication.md) when setting up agent communication channels.*
→ *Read [references/patterns.md](references/patterns.md) for proven multi-step workflows.*

## Reference Files

| File | Read when... |
|------|-------------|
| [team-setup.md](references/team-setup.md) | Defining agents, roles, models, workspaces |
| [task-lifecycle.md](references/task-lifecycle.md) | Designing task states, transitions, comments |
| [communication.md](references/communication.md) | Setting up async/sync communication, artifact paths |
| [patterns.md](references/patterns.md) | Implementing specific workflows (spec→build→test, parallel research, escalation) |

## Common Pitfalls

### Spawning without clear artifact output paths
Agent produces great work, but you can't find it. Always specify the exact output path in the spawn prompt. Use a shared artifacts directory with predictable structure.

### No review step = quality drift
"It's a small change, skip review." Do this three times and you have compounding errors. Every artifact gets at least one set of eyes that didn't produce it.

### Agents not commenting on task progress
Silent agents create coordination blind spots. Require comments at: start, blocker, handoff, completion. If an agent goes silent, assume it's stuck.

### Not verifying agent capabilities before assigning
Assigning browser-based testing to an agent without browser access. Assigning image work to a text-only model. Check capabilities before routing.

### Orchestrator doing execution work
The orchestrator routes and tracks — it doesn't build. The moment you start "just quickly doing this one thing," you've lost oversight of the rest of the team.

## When NOT to Use This Skill

- **Single-agent setups** — Just follow standard AGENTS.md conventions. Team orchestration adds overhead that solo agents don't need.
- **One-off task delegation** — Use `sessions_spawn` directly. This skill is for sustained workflows with multiple handoffs.
- **Simple question routing** — If you're just forwarding a question to a specialist, that's a message, not a workflow.

This skill is for **sustained team workflows** — recurring collaboration patterns where agents depend on each other's output over multiple tasks.
