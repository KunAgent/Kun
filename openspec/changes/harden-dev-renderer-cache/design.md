## Context

The Electron development window loads the renderer from Vite. Vite serves optimized dependencies with long-lived immutable browser cache headers, while Electron keeps its Chromium HTTP cache between development sessions. If Vite regenerates the optimizer output without changing the browser hash, Electron can reuse an older entry module that imports chunks no longer present on disk. A history item that first mounts the lazy Markdown renderer then exposes the mismatch as a failed dynamic import.

The visual smoke-test renderer starts a second Vite process. Its configuration currently uses Vite's default cache directory, so it can read or rewrite the same optimized-dependency cache as the primary development server.

## Goals / Non-Goals

**Goals:**

- Prevent the Electron development renderer from reusing stale HTTP module responses.
- Make renderer reloads bypass the browser cache in development mode.
- Isolate auxiliary Vite optimizer state from the primary development server.
- Preserve packaged-application caching and reload behavior.

**Non-Goals:**

- Change the Markdown renderer, Streamdown integration, or lazy-import boundaries.
- Add a local Markdown fallback.
- Change production session/cache behavior.
- Redesign the development or smoke-test launch flows.

## Decisions

### Disable Chromium HTTP caching for the Vite-backed renderer

The main process will append Chromium's `disable-http-cache` command-line switch when `ELECTRON_RENDERER_URL` identifies a development renderer. This happens before Electron becomes ready, which is early enough for Chromium network configuration and covers all Vite modules rather than only the currently failing dependency. Once Electron is ready, the default Session's existing HTTP cache will be cleared before the main window loads so stale entries from earlier runs are removed as well as bypassed.

The packaged path does not set the switch, so normal application caching remains unchanged.

### Centralize development-aware renderer reloads

A small main-process helper will choose `webContents.reloadIgnoringCache()` for a Vite-backed development renderer and `webContents.reload()` otherwise. The window reload command and main-window recovery reload will use this helper. The renderer error boundary will invoke the existing main-process reload command when the preload bridge is available, with `window.location.reload()` retained only as a browser-safe fallback.

Centralizing the decision keeps the development-versus-packaged behavior testable without starting Electron.

### Give each auxiliary Vite run a temporary optimizer cache

The auxiliary renderer Vite configuration will require an explicit cache directory from the smoke launcher. The launcher will place it under its already unique temporary root. Vite can create the directory as needed, and the existing temporary-root cleanup removes it after the run.

This avoids sharing `node_modules/.vite` with the main development server and avoids leaving new cache artifacts in the repository.

## Risks / Trade-offs

- Disabling the Chromium HTTP cache can make development reloads slightly slower. Vite's server-side transforms and optimizer cache still operate, and correctness is more important for this path.
- The error boundary depends on the preload bridge in Electron. Its existing location reload remains available when the component is rendered outside Electron.
- A smoke run uses more temporary disk space because it owns an optimizer cache. The directory is scoped to the run and removed with its temporary root.

## Migration Plan

No user-data migration is required. Development startup removes only Chromium's recreatable HTTP cache, not user settings or conversation data. The behavior is development-only except for retaining the existing packaged reload path. Rollback consists of removing the development command-line switch, cache clear, reload helper usage, and auxiliary cache-directory override.
