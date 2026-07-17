# Agent Browser Command Map

> Note: Command availability can vary by version. Use `agent-browser help` to confirm.

## Safe defaults (typical)
- `open`, `click`, `dblclick`, `fill`, `type`, `press`, `hover`, `select`
- `check`, `uncheck`, `scroll`, `screenshot`, `snapshot`, `close`
- `back`, `forward`, `reload`
- `wait`, `wait --text`, `wait --url`, `wait --load networkidle`
- `get text`, `get html`, `get value`, `get attr`, `get title`, `get url`
- `find role`, `find text`, `find label`, `find placeholder`

## Sensitive / explicit approval
- `eval` (arbitrary JS execution)
- `download <selector> <path>` (writes to disk)
- `set credentials`, `cookies`, `storage` (stateful secrets)
- `network route` / `network requests` (traffic interception)
- `set headers`, `--proxy` (traffic manipulation)
- `--allow-file-access` (local file access)
- `--executable-path`, `--args`, `--cdp` (custom runtime control)

## Debug and state
- `trace start/stop`, `console`, `errors`, `highlight`
- `state save`, `state load` (treat state files as sensitive)

## Tabs and frames
- `tab`, `tab new`, `tab <n>`, `tab close`
- `frame <selector>`, `frame main`
