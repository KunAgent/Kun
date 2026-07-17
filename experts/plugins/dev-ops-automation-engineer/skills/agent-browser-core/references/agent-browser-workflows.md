# Agent Browser Workflows

## 1) Snapshot-first loop
1. `open <url>`
2. `snapshot -i` and extract refs
3. Act using refs: `click @e12`, `fill @e14 "text"`
4. `snapshot -i` again after DOM changes

## 2) JSON mode for agents
- Prefer `snapshot -i` and `--json` outputs for deterministic parsing.
- Keep a local map of ref -> intent.

## 3) Authentication and reuse
- Log in once and `state save`.
- Reuse with `state load` in later runs.
- Treat state files as secrets and rotate when needed.

## 4) Stability tips
- Wait for load state before actions: `wait --load networkidle`.
- Use `wait --text` or `wait --url` for dynamic flows.
- Prefer refs from `snapshot` over brittle CSS selectors.

## 5) Safe automation loop
- Validate URL against an allowlist before `open`.
- Avoid `eval` and file access unless explicitly approved.
- Prefer read-only operations when possible.
