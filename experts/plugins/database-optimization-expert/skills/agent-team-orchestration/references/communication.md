# Communication

How agents coordinate: sync vs async, spawning vs messaging, and artifact sharing.

## Communication Channels

### Shared Files (Primary — Async)

The default communication method. Persistent, auditable, no timing dependency.

```
/shared/
├── specs/          — Requirements, research, analysis
├── artifacts/      — Build outputs, deliverables
├── reviews/        — Review notes and feedback
├── decisions/      — Architecture and product decisions
```

**Use for:** Deliverables, specs, reviews, decisions — anything another agent needs to find later.

### Task Comments (Async)

Attached to specific tasks. Chronological record of progress.

**Use for:** Status updates, blockers, handoff messages, review feedback.

### sessions_send (Sync — Urgent)

Direct message to a running agent session. Interrupts their current work.

**Use for:**
- Urgent priority changes ("Drop everything, critical bug")
- Quick questions that block progress ("Is feature X in scope?")
- Coordination that can't wait for task comment review

**Don't use for:**
- Routine updates (use task comments)
- Delivering artifacts (use shared files)
- Anything the agent needs to reference later (messages are ephemeral)

## Spawn vs Send

### Spawn a new sub-agent when:
- The task is self-contained with clear inputs and outputs
- You want isolation — the work shouldn't affect other running sessions
- The task needs a different model or capability set
- You're parallelizing — multiple independent tasks at once

### Send to an existing session when:
- The agent is already working on related context
- You need a quick answer, not a full task execution
- The work is a small addition to something already in progress

**Default to spawn.** It's cleaner. Send is for exceptions.

## Spawn Prompt Template

Every spawn includes:

```markdown
## Task: [Title]
**Task ID:** [ID]
**Role:** [What this agent is]
**Priority:** [High/Medium/Low]

### Context
[What the agent needs to know]

### Deliverables
[Exactly what to produce]

### Output Path
[Exact directory/file path for artifacts]

### Handoff
When complete:
1. Write artifacts to [output path]
2. Comment on task with handoff summary
3. Include: what was done, how to verify, known issues
```

**Critical fields:**
- **Output Path** — Without this, you'll lose the work. Always specify.
- **Handoff instructions** — Tell the agent exactly how to signal completion.

## Artifact Conventions

### Naming
```
/shared/artifacts/[task-id]-[short-name]/
/shared/specs/[date]-[topic].md
/shared/decisions/[date]-[title].md
/shared/reviews/[task-id]-review.md
```

### Rules
- All deliverables go to `/shared/` — never to personal agent workspaces
- One directory per task for multi-file outputs
- Include a brief README or summary at the top of the artifact directory if it contains 3+ files
- Overwrite previous versions in place — don't create v2, v3 copies

## Avoiding Communication Failures

**Silent agents:** If an agent doesn't comment within its expected timeframe, assume it's stuck. Check on it or restart the task.

**Lost artifacts:** Always verify the output path exists after a task completes. Agents sometimes write to wrong directories.

**Context gaps:** When spawning, include all context the agent needs. Don't assume it can read other agent sessions or recent conversations. Shared files are the bridge.

**Message timing:** `sessions_send` only works if the target session is active. If unsure, spawn a new session instead.
