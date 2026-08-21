## Context

All three external benchmarks execute Linux task images. Docker Desktop exposes its Linux engine inside WSL2, so the supported Windows architecture is a Windows host with an integrated WSL2 Ubuntu distribution, not native Windows Python or Windows containers. The existing harness already uses POSIX paths and Linux shell commands; Windows support should preserve that tested path and add host-aware validation and delegation.

## Goals / Non-Goals

**Goals:**

- Make the supported Windows workflow explicit and executable from PowerShell or WSL.
- Fail before builds/model calls when the process is native Windows, WSL1, on `/mnt/<drive>`, using Windows containers, or below hard disk requirements.
- Warn without blocking for sub-recommended CPU/RAM on smoke runs.
- Allow secrets to be read from a permission-restricted WSL env file rather than PowerShell argv.
- Keep all benchmark runtime behavior identical to Linux.

**Non-Goals:**

- Supporting Windows containers or running Harbor/Pier/SWE-bench with Windows Python.
- Installing WSL, Docker Desktop, Node, uv, or credentials without user confirmation.
- Managing Docker disk cleanup or modifying `.wslconfig` automatically.

## Decisions

### Detect the execution host in Python

A `host.py` module reports native Windows, Linux, and WSL1/WSL2 using `platform`, environment markers, and `/proc/sys/kernel/osrelease`. Preflight uses the report so PowerShell delegation and direct WSL commands receive identical behavior.

### Treat WSL ext4 and Linux containers as hard requirements

Real Windows-hosted runs fail when the repository resolves under `/mnt/<drive>` or Docker reports a non-Linux engine. Dry-run turns these into deferred blockers so command/config development remains possible.

### Use preset-specific disk thresholds

Smoke requires 60 GiB, pilot 80 GiB, and full 120 GiB free. The full threshold follows SWE-bench's official guidance; lower presets retain the existing bounded engineering workflow.

### Use env files for PowerShell-to-WSL secrets

`--env-file` is accepted by run, preflight, and resume. The parser reads simple dotenv syntax, merges file values below already-exported process values, and never copies secret values into artifacts. The PowerShell wrapper passes only the env-file path.

### Keep PowerShell a thin validated delegator

`Invoke-KunBench.ps1` validates enum and identifier parameters, confirms the selected distribution is WSL2, then invokes `wsl.exe --exec npm ...` with argument arrays. It never constructs an interpolated Bash command and propagates the WSL exit code.

## Risks / Trade-offs

- [WSL detection varies by release] → Combine kernel and WSL environment markers and test representative strings.
- [Docker Desktop settings UI varies] → Document both WSL settings and Docker's current data location while relying on CLI preflight for truth.
- [Env file permissions on NTFS are unreliable] → Require the env file and repository to live in WSL ext4 and warn/fail under `/mnt`.
- [PowerShell cannot be executed on the development macOS host] → Unit-test parameter/argv generation in Python and add a non-mutating PowerShell syntax check when `pwsh` is available.

## Migration Plan

1. Add host/env-file/path utilities and preflight checks with tests.
2. Add PowerShell wrapper and Windows tutorial.
3. Refresh locks, run Linux/macOS regression gates, and record that real WSL/Docker execution is environment-dependent.

## Open Questions

None. The supported mode is WSL2 Ubuntu with Docker Desktop Linux containers.
