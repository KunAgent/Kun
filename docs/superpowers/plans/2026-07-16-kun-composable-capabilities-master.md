# Kun Composable Capabilities Master Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver resource recovery, expert execution, MoA, Design Context integration, and encrypted Collaboration as independently testable Kun capability extensions.

**Architecture:** Preserve the single `kun serve` runtime and the existing Extension Seam. Execute six ordered plans; each owns a bounded set of contracts and adapters, and shared integration files are changed only in the earliest plan that introduces their stable contribution slot.

**Tech Stack:** Electron 43, React 19, TypeScript 5.8, Zod 4, Zustand 5, Vitest 4, Electron-Vite, Node HTTP/SSE, SQLite, RFC 9420 MLS via OpenMLS binding.

---

## Plan Set

1. `docs/superpowers/plans/2026-07-16-extension-resource-recovery.md`
2. `docs/superpowers/plans/2026-07-16-expert-conversation-mode.md`
3. `docs/superpowers/plans/2026-07-16-moa-virtual-models.md`
4. `docs/superpowers/plans/2026-07-16-design-context-integration.md`
5. `docs/superpowers/plans/2026-07-16-collaboration-workbench.md`
6. `docs/superpowers/plans/2026-07-16-collaboration-network-security.md`

The plans must run in this order. Resource recovery is a hard prerequisite for every capability page. The Collaboration network plan starts only after its Phase 0 MLS, vault, native packaging, and three-client protocol gates pass.

## Specification Coverage

| Design section | Implementing plan |
| --- | --- |
| 4. Resource root cause, locator, packaging, test isolation | Extension Resource Recovery |
| 5-6. Expert mode, queues, snapshots, parallel execution, interruption, recovery | Expert Conversation Mode |
| 7. Virtual models, advisors, aggregation, modalities, accounting, evaluation | MoA Virtual Models |
| 8. Design Context contribution, persistence, bounded injection, route removal | Design Context Integration |
| 9.1, 9.5-9.6 local UX and local execution | Collaboration Workbench |
| 9.2-9.7 server, identity, MLS, TaskKey, sync, remote invocation, artifacts | Collaboration Network Security |
| 10-16 errors, migration, phases, tests, acceptance, invariants | Enforced within every subplan and the final integrated verification task |

### Task 1: Establish Baseline Evidence

**Files:**
- Read: `docs/superpowers/specs/2026-07-16-kun-composable-capabilities-design.md`
- Read: `docs/superpowers/reports/2026-07-16-post-qa-fix-verification.md`
- Test: current repository baseline

- [ ] **Step 1: Capture the dirty-worktree boundary**

```powershell
git status --short --branch
git diff --name-only
```

Expected: record all pre-existing modified/untracked paths; do not reset, clean, or stage them globally.

- [ ] **Step 2: Run the narrow existing extension baseline**

```powershell
npx vitest run kun/src/seam src/shared/seam src/renderer/src/seam
```

Expected: PASS, or record exact baseline failures before changing code.

- [ ] **Step 3: Run type and build baselines**

```powershell
npm run typecheck
npm run build:kun
```

Expected: PASS, or preserve exact baseline failure evidence and separate it from introduced failures.

### Task 2: Execute Plans in Dependency Order

**Files:**
- Modify: only files named by the active subplan
- Test: commands named by the active subplan

- [ ] **Step 1: Complete resource recovery**

```text
Exit evidence: dev and packaged resource locators resolve existing expert/design roots; real user config is untouched by tests.
```

- [ ] **Step 2: Complete expert mode**

```text
Exit evidence: separate five-item activation queues, immutable thread profiles, real child-turn abort, recovery, and Composer E2E.
```

- [ ] **Step 3: Complete MoA virtual models**

```text
Exit evidence: saved presets appear in the normal model picker and use standard streaming/tools/interrupt/usage contracts.
```

- [ ] **Step 4: Complete Design integration**

```text
Exit evidence: Design resources exist only under Design Context and current canvas/preview/export/Code handoff still pass.
```

- [ ] **Step 5: Complete local Collaboration workbench**

```text
Exit evidence: meetings and reception employees support complete local interactions against the existing local Kun service.
```

- [ ] **Step 6: Complete network Collaboration**

```text
Exit evidence: native self-hosted server, invitation, E2EE, cross-member-device sync, scoped employee invocation, and encrypted manual delivery pass three-client acceptance.
```

### Task 3: Final Integrated Verification

**Files:**
- Test: `src/**`, `kun/src/**`, packaging scripts, Electron UI

- [ ] **Step 1: Run all automated quality gates**

```powershell
npm run lint
npm run typecheck
npm run test
npm run build:kun
npm run build
npm audit --audit-level=high
```

Expected: all commands PASS; any baseline-only exception is explicitly listed with unchanged evidence.

- [ ] **Step 2: Build and inspect the Windows package**

```powershell
npm run dist:win
```

Expected: installer builds; packaged resources contain `kun-extensions/experts` and `kun-extensions/design`; native Collaboration dependencies load without unpacking errors.

- [ ] **Step 3: Run desktop acceptance**

```text
Start Kun, verify data pages, expert queue eviction, expert/team execution recovery, MoA selection and degradation, Design Context integration, local meeting/employee interactions, and three-client encrypted Collaboration.
```

- [ ] **Step 4: Review only implementation-owned diffs**

```powershell
git diff --check
git diff --stat
git status --short
```

Expected: no whitespace errors, no generated build output, no logs, no user configuration, and no unrelated cleanup.
