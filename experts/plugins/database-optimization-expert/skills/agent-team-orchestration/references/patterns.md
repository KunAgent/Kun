# Patterns

Proven multi-agent workflows. Copy and adapt.

## Spec → Review → Build → Test

The full quality loop. Use for any non-trivial feature.

```
1. Orchestrator creates task, assigns to Spec Writer
2. Spec Writer produces spec at /shared/specs/[task]-spec.md
3. Orchestrator assigns spec review to Builder (feasibility check)
4. Builder reviews: "feasible" / "change X because Y"
5. If changes needed → back to Spec Writer → re-review
6. Orchestrator assigns build to Builder
7. Builder produces artifacts at /shared/artifacts/[task]/
8. Orchestrator assigns review to Reviewer
9. Reviewer approves or returns with feedback
10. If returned → Builder fixes → re-review
11. Orchestrator marks Done, reports to stakeholders
```

**Key:** The person who writes the spec doesn't review the build. The person who builds doesn't approve their own work. Cross-role verification is the whole point.

### Minimal version (2 agents):
```
1. Orchestrator writes brief spec
2. Builder implements
3. Orchestrator reviews output
4. Done or return for fixes
```

## Parallel Research

Multiple agents research independently, then merge. Use for broad investigation.

```
1. Orchestrator defines research question + splits into angles
2. Spawn Agent A: "Research [angle 1], write findings to /shared/specs/research-[topic]-a.md"
3. Spawn Agent B: "Research [angle 2], write findings to /shared/specs/research-[topic]-b.md"
4. Wait for both to complete
5. Orchestrator (or designated agent) merges into /shared/specs/research-[topic]-final.md
6. Use merged research to inform next decision
```

**Rules:**
- Define non-overlapping angles to avoid duplicate work
- Set a time/scope limit per agent — research expands to fill available time
- The merge step is mandatory — raw research without synthesis is useless

## Escalation

Agent hits a blocker it can't resolve. Structured escalation prevents stalling.

```
1. Agent comments on task: "Blocked: [specific problem]"
2. Agent continues with other work if possible (don't idle)
3. Orchestrator sees blocker, decides:
   a. Resolve directly (answer the question, provide access)
   b. Reassign to a more capable agent
   c. Escalate to human stakeholder
   d. Deprioritize/defer the task
4. Orchestrator comments decision and unblocks or reassigns
```

**Escalation triggers:**
- Missing access or credentials
- Ambiguous requirements that need product decisions
- Technical blocker outside agent's expertise
- Task exceeds estimated scope by 2x+

**Anti-pattern:** Agent silently struggling for 30 minutes instead of escalating after 10. Set the expectation: escalate early, escalate with context.

## Cron-Based Ops

Scheduled tasks for team health. Assign to the cheapest reliable agent.

### Daily Standup
```
Schedule: Every morning
Agent: Ops

1. Read all open tasks
2. Check for stale tasks (no comment in 24h+)
3. Check for overdue tasks
4. Produce standup summary:
   - What completed yesterday
   - What's in progress
   - What's blocked
   - What's stale
5. Post to orchestrator or team channel
```

### Task Dispatch
```
Schedule: Every few hours (or on trigger)
Agent: Orchestrator

1. Check inbox for new tasks
2. Prioritize by urgency/importance
3. Match to available agents (check capabilities)
4. Assign and spawn
```

### Health Check
```
Schedule: Periodic
Agent: Ops

1. Verify shared directories exist and are writable
2. Check for orphaned tasks (assigned but no agent session)
3. Check for artifact path conflicts
4. Report anomalies to orchestrator
```

## Batch Processing

Multiple similar tasks that can run in parallel.

```
1. Orchestrator creates N tasks from a list
2. Spawn up to M agents in parallel (M ≤ concurrency limit)
3. Each agent picks one task, completes it, writes output
4. Orchestrator collects results as agents finish
5. Spawn next batch if more tasks remain
6. Final aggregation once all tasks complete
```

**Sizing:** Start with 2-3 parallel agents. More isn't always faster — coordination overhead grows.

## Review Rotation

Prevent review fatigue and bias by rotating reviewers.

```
Task produced by Agent A → Reviewed by Agent B
Task produced by Agent B → Reviewed by Agent C
Task produced by Agent C → Reviewed by Agent A
```

**Why:** Same reviewer for the same builder creates blind spots. Rotation catches different things.
