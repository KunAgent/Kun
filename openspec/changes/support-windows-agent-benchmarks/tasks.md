## 1. Windows Host Support

- [x] 1.1 Implement native Windows and WSL1/WSL2 detection with WSL path normalization.
- [x] 1.2 Extend Docker inspection for Linux engine and architecture checks.
- [x] 1.3 Add preset-specific disk, WSL filesystem, CPU, and memory preflight reporting.

## 2. Secret-safe Invocation

- [x] 2.1 Add dotenv-compatible `--env-file` support to preflight, run, and resume.
- [x] 2.2 Add a validated PowerShell-to-WSL wrapper for every benchmark command.

## 3. Tests and Documentation

- [x] 3.1 Add unit tests for Windows/WSL detection, preflight policies, env merging, paths, and wrapper contracts.
- [x] 3.2 Write the complete Windows 10/11 + Docker Desktop + WSL2 tutorial and cross-link existing guides.
- [x] 3.3 Refresh dependency locks and run dry-run, Python, lint, typecheck, build, and file-line gates.

## 4. Integration

- [x] 4.1 Commit, rebase onto local `develop`, rerun applicable gates, and fast-forward merge safely.
- [x] 4.2 Prove merged ancestry and remove the temporary worktree/branch.
