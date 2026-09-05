## 1. Same-Runtime Control Safety

- [x] 1.1 Propagate the non-secret Runtime instance marker through the built-in shell safe environment while retaining secret filtering.
- [x] 1.2 Reject exact same-instance `kun runtime stop` and `kun runtime restart` before shutdown and document the stable CLI behavior.
- [x] 1.3 Add CLI and shell-environment tests for same-instance, external, unhealthy-discovery, and secret-filtering cases.

## 2. Graceful Lease Handoff

- [x] 2.1 Convert the execution-lease port shutdown contract to an asynchronous release barrier.
- [x] 2.2 Implement generation-safe acquire, renew, release, retry, and parallel idempotent shutdown draining in the Manager lease client.
- [x] 2.3 Close and drain turn admission, then reorder Runtime shutdown so active turns suspend and settle before lease drain, stores, and Runtime unregister.
- [x] 2.4 Add suspended-goal elapsed accounting that runs exactly once without terminal resume hooks or downtime estimates.
- [x] 2.5 Add lease-client, Runtime-ordering, Graph/Direct suspension, and goal-elapsed regression tests.

## 3. Durable Interruption Recovery

- [x] 3.1 Add the optional bounded Turn `terminalCode` contract and persist stable codes through TurnService and Manager expiry paths.
- [x] 3.2 Persist Manager settlement provenance, settle predecessor leases before replacement registration, and reconcile eligible recent new and legacy failures into deterministic interruption checkpoints.
- [x] 3.3 Feed only durably checkpointed thread/turn sources into existing goal and ordinary continuation scheduling with atomic exact-source, child-parent, cooldown, capacity, and eligibility guards.
- [x] 3.4 Add persistence, legacy compatibility, skip-condition, and duplicate-recovery tests.

## 4. Renderer Recovery Semantics

- [x] 4.1 Make explicit null goal/todo snapshots authoritative while preserving undefined-field compatibility in projections and prefetch cache.
- [x] 4.2 Localize `owner_lease_expired`, retain raw details, and allow the existing idle-only Continue fallback.
- [x] 4.3 Add reducer, cache, terminal-state, and runtime-error component regression tests.

## 5. Validation

- [x] 5.1 Validate the OpenSpec change in strict non-interactive mode and keep all authored files within the 700-line gate.
- [x] 5.2 Run focused Kun and renderer tests, Kun build, typecheck, full tests, application build, lint, file-line gate, and diff whitespace checks.

Validation notes: focused recovery tests and changed-file ESLint pass. Full typecheck/build remain blocked by the shared checkout's Zod 4.5.4/4.4.3 split (the default-heap Kun build also exhausts memory), full tests retain unrelated native-module ABI and catalog baselines, and the repository-wide line gate retains the pre-existing 758-line `kun/src/manager/service-manager.test.ts` failure. No changed authored file exceeds 700 lines.
