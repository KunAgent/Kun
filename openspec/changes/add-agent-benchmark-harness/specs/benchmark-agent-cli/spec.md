## ADDED Requirements

### Requirement: Bounded file and stdin prompts
`kun run` SHALL accept a UTF-8 prompt from `--prompt-file <path>` or `--prompt-file -`, SHALL reject prompt sources used together, and SHALL reject input larger than 2 MiB.

#### Scenario: Run from a prompt file
- **WHEN** a caller supplies exactly one readable prompt file
- **THEN** Kun runs one CLI turn using the complete file content without treating option values as positional text

#### Scenario: Conflicting prompt sources
- **WHEN** a caller supplies both a prompt file and a positional or `--prompt` value
- **THEN** Kun exits with a usage error before creating a runtime

### Requirement: Explicit benchmark model controls
`kun run` SHALL validate and forward an optional reasoning effort and priority service tier to the one-shot turn.

#### Scenario: Reasoning and tier are selected
- **WHEN** valid reasoning and service-tier options are supplied
- **THEN** the created turn records those exact values

### Requirement: Per-run execution limits
`kun run` SHALL accept positive max-step, wall-time, and per-step tool-call overrides without changing persisted defaults for later runs.

#### Scenario: One-shot limits are applied
- **WHEN** a caller supplies valid limit flags
- **THEN** only that embedded runtime uses the supplied turn limits

### Requirement: Machine-readable terminal status
`kun run --jsonl` SHALL preserve public runtime events and emit exactly one terminal `run_finished` record; only a completed turn SHALL exit successfully.

#### Scenario: Turn fails
- **WHEN** the embedded turn settles as failed or aborted
- **THEN** JSONL contains the terminal status and the CLI exits non-zero
