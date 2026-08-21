## Why

The benchmark harness runs Linux containers and currently documents only a generic Docker host. Windows users need a supported, testable WSL2 path that detects native-Windows misuse, Docker Desktop integration problems, NTFS-mounted workspaces, and undersized resources before expensive benchmark work starts.

## What Changes

- Add Windows/WSL2 host detection and Windows-specific preflight checks for WSL version, Linux containers, architecture, filesystem location, memory, CPU, and preset-specific disk capacity.
- Add an optional secret env-file input so PowerShell can delegate real runs into WSL without putting API keys in command arguments.
- Add a PowerShell wrapper for preflight, dry-run, build, run, resume, validate, and summarize operations inside a chosen WSL distribution.
- Add tests for native Windows, WSL1/WSL2, `/mnt/c` paths, Docker OS type, resource warnings, env files, path normalization, and PowerShell command construction.
- Add a complete Windows 10/11 + Docker Desktop + WSL2 tutorial with setup, resource tuning, execution, troubleshooting, and official source links.

## Capabilities

### New Capabilities

- `windows-agent-benchmark-host`: Supported Windows-hosted execution of all three Kun benchmarks through Docker Desktop's WSL2 Linux engine.

### Modified Capabilities

None.

## Impact

- Extends the isolated `benchmarks/agent-evals` Python package and lock.
- Adds a PowerShell script under `scripts/benchmarks` and a Windows operator guide.
- Does not add Windows containers or native PowerShell/Python execution of the Linux benchmark harnesses.
