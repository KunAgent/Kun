## Why

Kun has a working one-shot CLI, but it does not yet expose the complete, reproducible input and limit controls needed by unattended coding-agent benchmarks. The repository also lacks a first-party harness that can package the local Kun build, run established benchmark environments, preserve trajectories and patches, and produce comparable results with one command.

## What Changes

- Extend `kun run` with file/stdin prompts, explicit reasoning and service-tier selection, and per-run turn limits.
- Fix value-flag parsing so endpoint and benchmark options never leak into positional prompts.
- Add a pinned Python evaluation package with shared Kun execution, artifact, redaction, resume, summary, and JSONL-to-ATIF support.
- Add official suite drivers for SWE-bench Verified, DeepSWE v1.1, and Terminal-Bench 2.1.
- Add a reproducible Linux x64 standalone Kun builder and a single npm entry point for preflight, build, run, resume, validate, summarize, and dry-run operations.
- Add contract tests, fake-environment integration tests, and operator documentation. Real paid benchmark execution remains an explicit environment-dependent operation.

## Capabilities

### New Capabilities

- `benchmark-agent-cli`: Reproducible non-interactive Kun execution with bounded prompt input, model controls, machine-readable lifecycle output, and isolated run limits.
- `agent-benchmark-harness`: One-command, pinned and resumable orchestration for SWE-bench, DeepSWE, and Terminal-Bench with secure artifacts, trajectories, validation, and summaries.

### Modified Capabilities

None.

## Impact

- Affects the Kun CLI parser and one-shot turn request construction.
- Adds an isolated Python 3.12 benchmark project plus a separate locked SWE-bench Python 3.11 environment.
- Adds Harbor 0.21.0 and Pier 0.3.0 import-path adapters without adding either framework to the desktop application's runtime dependencies.
- Adds benchmark scripts, Docker packaging support, ignored run artifacts, package scripts, tests, and documentation.
