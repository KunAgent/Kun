# Default paper workspace

Entering Paper mode on the desktop prepares a local library automatically when
no paper library has been configured. Its stable location is
`<Electron userData>/paper-workspaces/default`. The library remains an ordinary
folder using the existing paper-unit, evidence, comparison, and research files.
There is no separate project registry or network/account setup.

## Selection and recovery

- Existing `write.paperMode.activeLibrary` wins, including legacy settings whose
  active root is missing from the sidebar list. A full list fails safely rather
  than dropping an existing registration.
- A legacy list with no active root selects its first registered folder. Missing
  roots are reported rather than silently choosing another library.
- Initial creation uses a fixed app-owned directory. Concurrent calls share the
  operation, and a settings compare-and-update preserves a newer explicit choice.
- The initialization marker is monotonic. Removing a registration, deleting or
  moving a folder never causes automatic recreation. Restore the folder and
  Retry, or choose its new location with Add folder / Choose folder.
- Removing a workspace removes its registration only. Files are never deleted.
  This change does not add filesystem rename or destructive cleanup controls.
- Existing read-only libraries can be viewed. Import/edit operations retain their
  own write-permission checks. New default creation requires a writable parent;
  managed child symlinks/junctions are rejected.
- The desktop bootstrap is not exposed through the phone allowlist. Loading
  phone document settings does not create or switch a host paper workspace.

The library header always shows the active folder, including with the sidebar
collapsed. Sidebar selection and expansion are separate keyboard-accessible
controls. Empty libraries offer PDF import and paper search. Failed admission
shows Retry and folder recovery instead of a misleading empty library.

## Workspace isolation

Settings transitions settle unsaved documents before changing the mounted root.
Cancel restores the previous selection. A successful transition resets relative
paper selections, metadata, import state, filters, and the research-session
pointer; outgoing sidebar indexes are invalidated. Late index/metadata results
are checked against the current root. Documents keep their existing layout
namespace, and paper evidence, conversations, and memory remain root-scoped.

Library and both search modes share the paper-surface dark hierarchy, derived
from the configurable Kun palette. The dark canvas, history rail, composer,
input borders, text, and focused controls have distinct semantic roles. Light
mode keeps its existing palette.

## Verification

- `npx vitest run src/main/services/paper/paper-workspace-service.test.ts`
  exercises actual temporary directories and JSON settings, including restart,
  concurrent choices, Manager compare-and-update conflicts, read-only roots,
  permission failures, symlink safety, and missing/moved folders.
- `npx vitest run src/renderer/src/paper/paper-workspace-bootstrap.test.ts`
  exercises initial entry, repeat loads, legacy roots, switching, cancellation,
  permission recovery, and registration isolation.
- `node scripts/test-paper-workspace-fixture.mjs` is supplemental DOM wiring
  coverage with real production components, actions, and stores.
- `node scripts/smoke-paper-workspace.mjs` launches native Electron with real
  production components and deterministic offline IPC. It covers persisted
  reload/restart and captures wide/narrow, light/dark library and research views.
- `.github/workflows/paper-workspace-smoke.yml` runs the native harness on macOS
  and Windows and uploads screenshots plus assertion reports for the tested SHA.

The native component harness is not a packaged/full-desktop acceptance test. It
uses fixture IPC and synthetic local folders; filesystem admission is exercised
separately by real-disk tests. It does not contact scholarly services or run a
model request. Inspect the exact-head CI artifacts before claiming native visual
verification, particularly when the local executor cannot launch Electron.
