# Troubleshooting

## CLI runs but no browser opens
- Run `agent-browser install` to download Chromium.
- On Linux, run `agent-browser install --with-deps` if dependencies are missing.

## Native binary not available
- The CLI falls back to the Node.js daemon automatically.
- Ensure Node.js is installed and available.

## Debugging
- Use `--headed` to see the browser UI.
- Use `--debug` for verbose logs.

## Instability in DOM targeting
- Resnapshot after any navigation or DOM changes.
- Prefer refs from `snapshot` over brittle CSS selectors.
