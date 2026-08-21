## 1. Non-interactive Kun CLI

- [x] 1.1 Add validated prompt-file/stdin loading and prompt-source conflict handling to `kun run`.
- [x] 1.2 Add reasoning, service-tier, and one-shot turn-limit flags and fix value-option positional parsing.
- [x] 1.3 Add CLI parser and mock-provider lifecycle tests for file input, limits, JSONL, failures, and shutdown.

## 2. Benchmark Package Core

- [x] 2.1 Create the isolated Python package, dependency pins, presets, and top-level npm command.
- [x] 2.2 Implement configuration, preflight, secret redaction, manifests, run state, resume, validation, and summaries.
- [x] 2.3 Implement the shared environment executor and deterministic Linux standalone Kun archive builder contract.
- [x] 2.4 Implement Kun JSONL parsing, usage aggregation, and ATIF v1.7 trajectory conversion.

## 3. Framework and Suite Adapters

- [x] 3.1 Implement Harbor and Pier import-path agents with archive upload, secure configuration, logging, and DeepSWE commit capture.
- [x] 3.2 Implement the pinned SWE-bench generation, patch validation, predictions, and official evaluation driver.
- [x] 3.3 Implement the pinned DeepSWE/Pier and Terminal-Bench/Harbor command drivers.
- [x] 3.4 Implement the unified preflight/build/run/resume/validate/summarize/dry-run CLI and stable exit semantics.

## 4. Tests and Documentation

- [x] 4.1 Add Python unit and fake-environment contract tests for executors, adapters, trajectories, artifacts, recovery, and suite commands.
- [x] 4.2 Track the SWE-bench evaluation document and add the unified three-benchmark operator guide.
- [x] 4.3 Add ignore rules and document the real Docker/disk/model prerequisites and deferred live-smoke status.

## 5. Validation and Integration

- [x] 5.1 Run dry-run, Python, CLI, typecheck, build, file-line, and diff validation gates; distinguish baseline failures.
- [x] 5.2 Commit scoped changes, rebase onto current local `develop`, rerun applicable gates, and fast-forward integrate safely.
- [x] 5.3 Prove merged ancestry, remove the temporary worktree/branch, and report the deferred real-smoke blockers.
