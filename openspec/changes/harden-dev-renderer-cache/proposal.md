## Why

The Electron development renderer can reuse an immutable Vite optimized-dependency response after Vite has regenerated the underlying chunk graph with the same browser hash. Opening a history item that first mounts the lazy Markdown renderer then requests a removed chunk, causing a full-app error instead of rendering the conversation.

## What Changes

- Prevent the main Electron renderer from reusing stale HTTP module responses while connected to the Vite development server.
- Make application reload commands bypass the browser cache in development mode.
- Give auxiliary development-renderer Vite processes isolated dependency cache directories so they cannot mutate the main development server's optimizer cache.
- Keep packaged application cache and reload behavior unchanged.

## Capabilities

### New Capabilities

- `dev-renderer-cache-coherence`: Defines cache isolation and cache-bypassing behavior for Electron and auxiliary Vite development renderer sessions.

### Modified Capabilities

None.

## Impact

- Electron main-process startup and reload command handling in `src/main`.
- The isolated development renderer Vite configuration used by visual smoke tests.
- Main-process and script-level tests covering development versus packaged behavior and cache-directory selection.
