## ADDED Requirements

### Requirement: WSL2 execution boundary
Windows-hosted real benchmark runs SHALL execute inside a WSL2 distribution and SHALL reject native Windows and WSL1 execution.

#### Scenario: Native PowerShell invokes Python directly
- **WHEN** preflight detects native Windows rather than WSL2
- **THEN** it fails with instructions to run through the WSL wrapper or an Ubuntu shell

### Requirement: Linux Docker engine
Windows-hosted real runs SHALL require a reachable Docker Desktop engine reporting Linux containers and an amd64-compatible target.

#### Scenario: Docker is in Windows container mode
- **WHEN** Docker reports `OSType=windows`
- **THEN** preflight fails before building Kun or starting a model turn

### Requirement: WSL filesystem and resources
Preflight SHALL reject repositories under `/mnt/<drive>` for real runs, SHALL apply 60/80/120 GiB disk thresholds for smoke/pilot/full, and SHALL report CPU and memory recommendations.

#### Scenario: Repository is stored on the C drive mount
- **WHEN** the resolved repository path begins with `/mnt/c/`
- **THEN** preflight directs the user to clone under the WSL home filesystem

### Requirement: Secret-safe Windows delegation
The harness SHALL accept a WSL-local env file and the PowerShell wrapper SHALL delegate arguments without placing API key values in its command line.

#### Scenario: PowerShell starts a real smoke
- **WHEN** the user supplies a WSL repo path and env-file path
- **THEN** the wrapper passes only paths and validated options to `wsl.exe`, while Python loads the secret inside WSL

### Requirement: Complete Windows tutorial
The repository SHALL document installation, WSL/Docker configuration, resource allocation, repository placement, environment setup, all-suite commands, per-suite commands, recovery, and common failures using authoritative links.

#### Scenario: First-time Windows user follows the guide
- **WHEN** the user completes the documented gold/oracle and dry-run checks
- **THEN** they have an actionable path to run each Kun benchmark without native-Windows path ambiguity
