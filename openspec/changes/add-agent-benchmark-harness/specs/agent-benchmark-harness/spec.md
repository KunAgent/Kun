## ADDED Requirements

### Requirement: Unified benchmark command
The repository SHALL expose one command supporting preflight, Kun archive build, run, resume, validate, summarize, and dry-run operations for SWE-bench, DeepSWE, Terminal-Bench, or all suites.

#### Scenario: All-suite dry run
- **WHEN** an operator runs the smoke preset for all suites with `--dry-run`
- **THEN** the command validates pins, configuration, task selection, command construction, and artifact layout without Docker or model calls

### Requirement: Pinned official suite contracts
The harness SHALL pin SWE-bench v5.0.1, DeepSWE v1.1 at commit `3cda4081fed96103a6395de39c85e9b20275e307` with Pier 0.3.0, and Terminal-Bench 2.1 with Harbor 0.21.0.

#### Scenario: Upstream identity differs
- **WHEN** an installed harness, task checkout, dataset, or archive does not match the pinned identity
- **THEN** preflight fails before a paid agent turn starts

### Requirement: Official suite outputs
The harness SHALL generate SWE-bench prediction patches for the official evaluator, DeepSWE committed-work artifacts for Pier's separate verifier, and ATIF v1.7 trajectories for Harbor/Pier runs.

#### Scenario: Agent completes with reward zero
- **WHEN** the official verifier completes and reports zero reward
- **THEN** the trial is recorded as an evaluated task failure rather than an infrastructure failure

### Requirement: Secure reproducible artifacts
Every run SHALL record a redacted manifest, raw events, stderr, task results, verifier outputs, and summary under an ignored run directory, and SHALL never serialize configured secrets.

#### Scenario: Secret appears in captured text
- **WHEN** output contains an exact configured secret value
- **THEN** the persisted artifact replaces it with a redaction marker

### Requirement: Idempotent recovery
The harness SHALL resume a matching run without repeating completed trials and SHALL reject resume when pinned inputs or configuration digests drift.

#### Scenario: Resume after interruption
- **WHEN** a run has terminal results for some selected tasks and unchanged manifest inputs
- **THEN** resume executes only unfinished tasks and regenerates deterministic aggregate outputs

### Requirement: Environment-aware preflight
The harness SHALL report actionable blockers for missing Docker, insufficient disk, missing model variables, unsupported architecture, or invalid archives, and SHALL offer a non-executing dry-run path.

#### Scenario: Docker daemon is unavailable
- **WHEN** a real run is requested and Docker cannot be reached
- **THEN** the command exits non-zero with a structured Docker blocker and does not claim any benchmark passed
