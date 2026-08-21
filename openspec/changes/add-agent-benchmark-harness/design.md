## Context

Kun already exposes `kun run`, local coding tools, JSON/JSONL output, and standalone Linux archives. SWE-bench, DeepSWE, and Terminal-Bench use different orchestration contracts: SWE-bench scores prediction patches, DeepSWE uses Pier plus committed-work artifacts, and Terminal-Bench uses Harbor installed agents and ATIF trajectories. The benchmark tooling must stay outside the Electron production dependency graph, preserve secrets, pin external contracts, and remain useful when Docker is unavailable by supporting deterministic dry runs and fake environments.

## Goals / Non-Goals

**Goals:**

- Make one-shot Kun turns safe to drive from unattended harnesses with explicit input, model, and limit controls.
- Share one execution, event, redaction, artifact, and reporting core across all three benchmarks.
- Produce official native outputs: SWE-bench predictions, DeepSWE/Pier artifacts, and Terminal-Bench/Harbor trajectories.
- Make every run pinned, resumable, auditable, and invocable from one npm command.
- Validate the engineering without requiring a paid live run or a currently available Docker daemon.

**Non-Goals:**

- Uploading leaderboard submissions or managing cloud accounts.
- Adding Harbor, Pier, or SWE-bench to the desktop application's production runtime.
- Claiming benchmark task success from a successful Kun turn.
- Replacing the official benchmark verifiers or modifying their tasks.

## Decisions

### Keep benchmark dependencies in an isolated Python project

`benchmarks/agent-evals` owns a Python 3.12 package and lock for Harbor/Pier. SWE-bench runs through a separate Python 3.11 locked environment because its supported interpreter range differs. The top-level package script delegates to this project; production npm dependencies remain unchanged.

Alternative: implement everything in TypeScript. Rejected because the official harnesses and import-path agent contracts are Python-native and wrapping them would add more compatibility code.

### Use a shared environment protocol and two framework adapters

A small environment protocol abstracts upload, exec, and download. SWE-bench's Docker runner implements it directly. Harbor and Pier expose thin native agent classes that delegate to the same executor. The two framework classes remain separate because their installed-agent lifecycle and model classes are similar but not identical.

Alternative: patch or fork Harbor/Pier to register Kun. Rejected because both accept import-path agents and a local adapter is easier to pin and test.

### Package the exact worktree build as a Linux standalone archive

An Ubuntu 22.04/amd64 builder with Node 22.23.1 invokes the existing Kun standalone packaging flow. The runner verifies archive SHA-256 and runtime build ID before uploading it to task environments. A verified `--kun-archive` override avoids rebuilding during resume or remote execution.

Alternative: install Kun source and npm dependencies in every task. Rejected because it is slow, network-dependent, and risks native ABI drift.

### Treat runtime JSONL as the canonical trajectory source

The executor persists raw JSONL and stderr separately. A converter uses authoritative item snapshots plus usage and lifecycle events to build ATIF v1.7 without duplicating streamed deltas. The raw events always remain available if framework schema conversion fails.

### Make secrets runtime-only

The benchmark package resolves `KUN_BENCH_*` environment variables, passes the API key only through the agent process environment, redacts configured values from captured text, and records only endpoint host and non-secret model settings in manifests. Commands never place the key in argv.

### Separate task reward from infrastructure success

The unified command returns success when every selected trial reached its official verifier, even if reward is zero. Missing images, invalid patches, CLI crashes, conversion failures, or verifier infrastructure failures are terminal engineering errors and return non-zero.

## Risks / Trade-offs

- [Native archive incompatibility across task images] → Build on Ubuntu 22.04, run archive preflight inside every suite environment, and accept a preverified override.
- [Upstream CLI/schema drift] → Pin exact versions/commits, keep suite-specific command builders, and fail when reported versions or dataset digests differ.
- [Large prompt or shell quoting failures] → Add `--prompt-file`, upload the instruction as a file, and never interpolate it into shell command text.
- [Partial/duplicate JSONL events] → Retain raw lines, use stable item/call IDs and seq ordering, and test replay/idempotency.
- [Docker or disk unavailable] → Provide dry-run/fake-environment gates and an actionable structured preflight blocker; never claim a real smoke passed.
- [Source checkout is dirty during integration] → Work only in the isolated worktree and use fast-forward-only integration with overlap and ancestry proof.

## Migration Plan

1. Add backward-compatible CLI options and tests.
2. Add isolated benchmark package, adapters, suite drivers, presets, and documentation.
3. Run local non-Docker gates and record the real-environment blocker.
4. Rebase the worktree branch onto current local `develop`, rerun gates, and fast-forward merge only when source changes do not overlap.
5. Remove the worktree and branch only after ancestry proof.

Rollback is a normal revert of the benchmark commits; existing `kun run` callers remain compatible.

## Open Questions

None. Terminal-Bench 2.1, engineering-only local acceptance, and explicit environment-variable model configuration are locked by the approved plan.
