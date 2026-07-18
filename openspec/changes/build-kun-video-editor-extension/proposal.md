## Why

Kun's Extension Platform can host Agent tools and rich Webviews, but it cannot yet support a serious video-editing extension: large workspace media cannot be streamed into an extension View, long transcode jobs do not have a durable lifecycle, and extension-generated media is not surfaced as a first-class artifact. A focused local-first video editor will both deliver a useful ChatCut-style workflow and harden the platform for other media-heavy extensions.

## What Changes

- Add protected media import/export pickers and opaque, revocable media-resource URLs that support bounded HTTP Range reads from granted workspace files.
- Add an extension-owned background-job API with persisted state, progress/event subscription, cancellation, restart recovery, and explicit terminal outcomes.
- Extend extension tool results with validated generated-artifact references that flow through Kun history, renderer mapping, result previews, and open/reveal actions.
- Add a brokered media executable service for `ffprobe`/`ffmpeg` discovery and execution with argument-only invocation, workspace confinement, progress parsing, cancellation, and process-tree cleanup.
- Ship a runnable `kun-video-editor` `.kunx` extension with a right-sidebar React workbench, Agent profile, editable project/timeline model, transcript-oriented editing tools, subtitles, social aspect-ratio presets, preview assets, and background export.
- Bundle that same deterministic `.kunx` as Kun's local default extension and keep its source as the reference example for third-party extension authors. Fresh profiles install it through the ordinary package manager; existing, disabled, removed, rolled-back, or development selections remain user-controlled.
- Keep the first release local-first and optimized for talking-head, interview, and podcast editing; AI video generation, stock search, generative B-roll, and arbitrary visual-scene understanding remain later capabilities.

## Capabilities

### New Capabilities

- `extension-media-resources`: Protected file selection, workspace-scoped media handles, Range-capable View playback, brokered FFmpeg/ffprobe execution, and generated media artifacts.
- `extension-background-jobs`: Extension-owned durable jobs, progress/events, cancellation, lifecycle cleanup, restart reconciliation, quotas, and headless behavior.
- `kun-video-editor`: The local-first Kun video editor extension, including its project/timeline contract, Agent tools, transcript workflow, Webview UX, preview, versioning, and export behavior.

### Modified Capabilities

- None. The Extension Platform capability specs have not yet been archived into `openspec/specs`; this change adds compatible API-v1 minor surfaces without weakening the active platform contracts.

## Impact

- Public SDK and contracts: `packages/extension-api`, `packages/extension-react`, `packages/extension-test`, generated JSON Schema, API reference, and changelog.
- Kun runtime: Extension Host Broker, job/media services, extension tool result normalization, event persistence, runtime composition, diagnostics, and HTTP routes.
- Electron/Main/Preload: protected file dialogs, sender-bound media protocol/range handling, native process supervision, IPC schemas, and cleanup.
- Renderer: extension media client, result-preview/artifact mapping, right-sidebar contribution behavior, and generated-file actions.
- New default extension/example package: one canonical manifest, Node Host, React Webview, timeline engine, FFmpeg adapter, tests, deterministic `.kunx`, bundled-extension catalog, first-run seeding, packaging, and documentation.
- Packaging and validation: target-platform FFmpeg availability checks and native macOS/Windows/Linux smoke coverage; no bundled multi-platform FFmpeg binary is added to `.kunx` packages.
