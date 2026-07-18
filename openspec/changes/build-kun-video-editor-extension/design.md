## Context

Kun has one live Agent runtime (`kun serve`) and a versioned `.kunx` platform. Extension Node entrypoints run in isolated child processes, while complex UI runs in sandboxed Webviews and reaches Kun through a sender-bound broker. The current API is intentionally JSON-sized: workspace reads/writes are capped at 8 MiB, View messages are capped at 1 MiB, `kun-extension://` serves immutable package resources only, and ordinary operations have a 60-second deadline. Those constraints are appropriate for normal tools but exclude multi-gigabyte footage, seekable playback, transcription, and long renders.

The target product is a local-first ChatCut-style editing assistant, not a second Agent runtime or a remote black-box generator. The first release focuses on talking-head, interview, and podcast footage, where transcript-driven decisions are useful and verifiable. It must preserve an editable project/timeline and allow both the user and the Agent to modify the same revisioned state.

The Extension Platform is not yet through its final public-release sign-off, but its API reference currently identifies v1.0.0 as stable. This change therefore publishes the additive media/job surface as Extension API v1.1.0 while continuing to negotiate v1.0.0 manifests within major 1.

## Goals / Non-Goals

**Goals:**

- Let an explicitly trusted extension select, inspect, play, process, and export large local media without placing media bytes in JSON IPC, tool history, or extension state.
- Keep file paths, media URLs, View sessions, jobs, and generated artifacts extension/workspace-owned and revocable.
- Give long media operations durable progress, cancellation, terminal fencing, diagnostics, and restart reconciliation.
- Provide a runnable first-party `.kunx` video editor with a right-sidebar UI, frame-native timeline, transcript workflow, Agent profile/tools, subtitles, aspect presets, proof frames, and local FFmpeg export.
- Ship the video editor out of the box while keeping the installed bytes, lifecycle, permission model, and source tree identical to a normal third-party `.kunx` example.
- Preserve Kun's one-runtime, approval, workspace trust, cache-stable tool catalog, and headless invariants.
- Make the new public surface useful to future audio, image-sequence, dataset, and document-rendering extensions rather than hard-coding only one plugin.

**Non-Goals:**

- Building a full Premiere/Resolve replacement, multi-camera conform system, advanced color-grading engine, or arbitrary VFX graph in the first release.
- Claiming robust visual-semantic understanding of arbitrary footage.
- Adding stock search, generative B-roll, AI video/image generation, voice cloning, music generation, or cloud rendering.
- Exposing arbitrary shell execution, raw absolute paths, runtime bearer tokens, Electron IPC, or the complete GUI preload to extensions.
- Bundling one multi-platform FFmpeg executable inside every `.kunx` package.
- Merging the existing MCP, Skill, appearance-pack, and `.kunx` product surfaces.

## Decisions

### 1. Public media access uses opaque handles, never renderer-visible paths

Extension API v1.1 adds `MediaApi` and the permissions `media.read`, `media.process`, and `media.export`. `media.pickFiles` and `media.pickSaveTarget` are interactive operations: a sandboxed View request is intercepted by Electron Main, shown in a Main-owned picker, then registered with Kun using the authenticated View Session and a short-lived operation token. The result contains opaque handle IDs and bounded metadata, not absolute paths.

Kun persists handle records outside extension state with owner extension/version, workspace scope, canonical path, file identity metadata, access mode, creation source, and revocation state. A selected file outside the workspace remains usable only through the handle; the extension does not receive its path. Workspace-relative files may be registered without copying their bytes. Headless callers may reuse valid persisted handles but receive `interaction-required` when a new picker is necessary.

Returning raw paths was rejected because Webviews and tool results would leak ambient filesystem authority. Copying every selected video into the workspace was rejected because multi-gigabyte duplication is slow and changes project storage semantics.

### 2. Seekable playback uses a separate sender-bound `kun-media://` protocol

`media.openViewResource` creates a short-lived lease bound to extension ID/version, media handle, workspace, View Session, WebContents, allowed MIME, access mode, and expiry. Electron Main returns an unguessable `kun-media://` URL only to the owning View. The protocol supports `HEAD` and one bounded `Range` request, returns correct 200/206/416 headers, streams from disk without buffering the whole file, and rejects stale sessions, traversal, changed file identity, cross-extension use, unsupported methods, and excessive concurrent readers.

The extension Webview CSP adds `media-src 'self' kun-media:` while `connect-src` remains broker-only. Closing the View, revoking the handle, changing workspace, disabling/uninstalling the extension, or reaching expiry revokes the lease. The protocol never serves directories and never exposes canonical paths in response headers or errors.

Reusing `kun-extension://` was rejected because that protocol is intentionally confined to immutable package resources and has a small-resource policy. Base64/Blob transfer over View messages was rejected because it defeats Range playback and message limits.

### 3. Kun owns a generic extension job store; core capabilities own executors

Extension API v1.1 adds `JobsApi` with `get`, `list`, `subscribe`, and `cancel` under `jobs.manage`. Jobs are owned by extension/workspace and expose queued, running, completed, failed, cancelled, or interrupted state; monotonic events; progress; bounded result/artifacts; timestamps; and a single terminal outcome. Records and event cursors persist under the Kun data directory, not extension state.

In v1.1, extensions do not register arbitrary resumable job handlers. Core brokers create supported job kinds, initially `media.ffprobe` and `media.ffmpeg`. This keeps process ownership, cancellation, resource limits, and recovery inside `kun serve`. Later APIs can add negotiated executor kinds without changing job observation semantics.

If Kun restarts while a media process is running, the old process tree is terminated during shutdown when possible and the nonterminal record becomes `interrupted`; the caller may start a new job explicitly. Automatic retry is rejected because a renderer cannot generally prove that an output was not partially written or externally consumed.

### 4. FFmpeg is a brokered executable, not general shell access

The media broker resolves `ffprobe` and `ffmpeg` from a host-configured override, packaged resource when one exists, or sanitized `PATH`, then records version/build capabilities. Calls use `execFile`/`spawn` with `shell: false`, `-nostdin`, a scrubbed environment, bounded stdout/stderr, deadlines, cancellation, and cross-platform process-tree termination.

`media.probe` accepts an input handle and invokes a fixed ffprobe JSON profile. `media.startFfmpegJob` accepts input/output handles, an argument array, token placeholders, and optional bounded SRT/WebVTT `textOutputs`. A text output contains only a named Host-granted export handle, an allowlisted subtitle MIME, and bounded UTF-8 content; it never becomes an FFmpeg argument. Kun substitutes canonical paths only for declared handles, rejects absolute/path-like extension arguments where a handle is required, disables network inputs/protocols, restricts path-loading filters for v1, validates every output target, writes media and text outputs to sibling staging files, and atomically promotes or rolls back the output set. FFmpeg `-progress pipe:1` updates the owning Job.

A declarative editor-only renderer was rejected because other extensions need common media operations. Arbitrary shell was rejected because it cannot provide path confinement or reliable process cleanup. Bundling FFmpeg in `.kunx` was rejected because of per-file/package limits and platform/architecture variance; packaged Kun may add target-specific FFmpeg resources later without changing the broker API.

### 5. Generated artifacts are a typed ToolResult field

`ToolResultSchema` gains optional `generatedArtifacts`, whose entries contain an opaque artifact ID, media handle ID or workspace-relative path, name, MIME, byte size, dimensions/duration when known, and provenance (`jobId`, tool invocation, extension/version). The Extension Host Broker validates ownership and existence before committing the tool result, then maps artifacts into the canonical internal `generatedFiles` projection used by renderer history.

Result-preview sources gain an optional artifact/media-handle reference. Built-in and extension previews request a fresh View lease instead of receiving a path or data URL. Legacy built-in `generatedFiles` and extension results without artifacts remain compatible.

Keeping artifacts inside arbitrary `content` JSON was rejected because the renderer cannot safely distinguish a real file from extension-supplied metadata and current mapping misses nested values.

### 6. The video editor uses a frame-native, revisioned project model

The first-party extension lives at `examples/extensions/kun-video-editor` and is included in example validation/packing gates. Its workspace data lives under `.kun-video/`:

```text
.kun-video/
  projects/<project-id>/project.json
  projects/<project-id>/timeline.md
  cache/<project-id>/thumbnails/
  cache/<project-id>/waveforms/
  exports/
```

`project.json` contains schema version, canvas/fps, assets, video/audio/caption tracks, timeline items, transcript references, current revision, and bounded revision metadata. Assets represent sources; items reference assets and own track placement, source in/out, duration, speed, transform, opacity, and fades. Timeline positions are integer frames; seconds are display/import values only. Same-track overlap is rejected, while higher video tracks layer and audio tracks mix.

Writes use optimistic revision checks and atomic replacement. Agent tools and the Webview call the same project service, so neither silently overwrites the other. Undo/redo selects retained immutable revision snapshots; cache files are derived and disposable.

An EDL-only model was rejected because it cannot represent captions, transforms, or editable overlays. Storing raw media in extension state was rejected because of quotas and duplication.

### 7. The Agent edits through a small stable tool surface

The manifest contributes a private `video-editor` Agent profile and fewer than sixteen tools so the thread receives direct, cache-stable schemas:

- `video-project`: create/open/read project and revision metadata.
- `video-probe`: register/probe selected assets and create thumbnails/waveforms.
- `video-transcribe`: create or import timestamped transcript/caption data.
- `video-read-script`: produce the editable `timeline.md` projection.
- `video-apply-script`: validate a script revision and apply transcript-derived cuts/reordering.
- `video-update-timeline`: apply explicit typed track/item/canvas/caption patches.
- `video-render`: start preview-frame or export jobs.
- `video-render-status`: inspect owned jobs without side effects.
- `video-render-cancel`: explicitly cancel an owned job under destructive approval policy.

The profile instructs the Agent to read current revision before mutation, align on creative choices, edit structure before decoration, avoid unrequested enhancements, verify project structure plus composed proof frames, and stop at an editable review checkpoint unless export is requested. It never claims visual understanding from transcript-only evidence.

### 8. The Webview is a real editor, with bounded first-release scope

The extension contributes `views.rightSidebar` as its only primary surface. Its manifest-declared icon and localized title register in Code mode's vertical right rail; selecting the launcher opens the docked editor in an independent tab beside the main conversation. The React Webview contains Agent synchronization status, Player, Media Library, Transcript, Timeline, inspector, jobs/export status, and undo/redo. It uses public theme/locale/state/media/jobs/Agent APIs only and remains useful without an active Agent run.

Initial manual editing covers selection, split, trim, delete, reorder, track placement, captions, canvas aspect presets, and revision navigation. Preview uses source playback for simple selections plus broker-generated proxy/proof frames for composed state; export uses FFmpeg jobs. Unsupported timeline effects remain visible as validation warnings rather than being silently flattened or discarded.

### 9. Transcription is provider-pluggable and does not duplicate secrets

The extension defines a transcript adapter interface. The initial implementation can import SRT/VTT/JSON transcripts and can invoke an explicitly configured local `whisper-cli` through the media job broker when available. If no transcriber is available, the UI reports a capability requirement and still permits manual timeline editing. Cloud ASR is not silently enabled and secrets are not stored in extension state.

Kun's existing Electron-only speech service is not imported as a private extension API. A future public speech broker can implement the same adapter contract.

### 10. One canonical `.kunx` is both the default extension and the reference example

`examples/extensions/kun-video-editor` remains the only source tree for the video editor. The deterministic packer builds and validates that tree through the public Extension CLI, then writes the same archive bytes to the standalone release output and to a generated bundled-extension resource directory. A bounded catalog beside the bundled archive records its stable extension ID, version, archive name, SHA-256, Kun engine range, API version, and exact permissions. Electron passes only that product resource directory to `kun serve`; the runtime does not import the example source or hard-code its contributions.

Kun owns a generic bundled-extension seeder in front of `ExtensionPackageManager`. On a fresh profile, it verifies the catalog and archive, calls the ordinary `installArchive` transaction with the catalog as expected metadata, grants the shipped permission set, selects and globally enables the package, and records a separate atomic seed ledger. It does not create a second registry format, bypass manifest compatibility or integrity checks, special-case activation, or grant workspace trust. A user still reviews and grants the extension's permissions for each trusted workspace before its View or tools can access workspace resources.

The seed ledger distinguishes `seeded`, `user-managed`, and `removed` ownership. A pre-existing registry entry is adopted as user-managed and never overwritten. If a previously seeded package disappears, the seeder records removal and never resurrects it, including after a later application update. Global and workspace disablement remain unchanged. A selected development source remains selected, and a manually selected or rolled-back installed version is not replaced.

A newer bundled version is installed automatically only when the previous seeded version and archive fingerprint are still present and its requested permission set is unchanged. The new package becomes selected only when the previous seeded version was selected and no development source is active; otherwise it is retained as an unselected installed version. The seeder never downgrades, never replaces different bytes under the same version, and never auto-accepts added permissions. Catalog, compatibility, integrity, or install failures are reported as bounded startup diagnostics while Kun continues with the last valid registry state.

Copying an extracted package directly into the registry was rejected because it would bypass the lifecycle and make the example misleading. Importing extension code into the renderer or runtime was rejected because it would turn a public extension into a hidden built-in feature. Reinstalling on every launch was rejected because it would defeat user ownership.

## Risks / Trade-offs

- [Serving local media to a Webview expands the Electron attack surface] → Use an unguessable, sender/View-bound protocol lease, strict MIME/method/Range handling, file-identity checks, concurrent-reader limits, CSP, and revocation tests.
- [A trusted Node extension can still bypass brokers with `fs` or `child_process`] → Preserve the existing high-risk Node disclosure; broker APIs improve least-authority integrations but are not represented as an OS sandbox.
- [FFmpeg arguments can hide filesystem or network access inside filters] → Substitute only declared handles, deny network protocols and path-loading filters in v1, run without a shell, test adversarial filter graphs, and fail closed on unknown constructs.
- [System FFmpeg availability varies] → Provide explicit diagnostics and capability detection; keep editing/project functions available; do not claim export support until probe succeeds.
- [Large footage and proxy generation can exhaust disk/CPU] → Add per-extension concurrent-job quotas, byte/time limits, disk-space preflight, cache budgets, explicit cleanup, and user-visible estimates.
- [Restart cannot safely resume arbitrary encodes] → Mark jobs interrupted, remove staging outputs, and require explicit restart instead of automatic retry.
- [Transcript edits can create unnatural cuts] → Preserve source ranges and revisions, show waveform/transcript context, render proof frames/audio previews, and keep undo/redo.
- [A default right-sidebar extension can destabilize startup or release gates] → Keep it isolated behind the standard `.kunx` lifecycle, make seeding idempotent and non-fatal, use pure timeline-engine tests, fake media/jobs in Webview tests, and native packaged smokes for the broker boundary.
- [API v1.1 documentation and fixtures can drift] → Regenerate Schema/API reference, retain v1.0 negotiation fixtures, and gate public export fingerprints/changelog.

## Migration Plan

1. Add v1.1 SDK schemas, permissions, Media/Jobs interfaces, fake services, compatibility fixtures, and documentation while leaving existing v1.0 extensions unchanged.
2. Implement runtime media-handle/job stores and FFmpeg broker with unit/integration tests, then compose them into serve/headless runtimes.
3. Add Main protected pickers, `kun-media://`, IPC/View methods, generated-artifact mapping, and Electron security tests behind the existing extension admission boundary.
4. Add the video editor extension, timeline engine, tools, Webview, docs, and example gates; test first with fake media services and system FFmpeg fixtures.
5. Build the same deterministic `.kunx` into the product resource catalog, seed it through the standard package manager, and verify first install, upgrade, disablement, removal, rollback, and development-source preservation.
6. Run typecheck, targeted tests, Extension release gates, build, and native packaged desktop smokes on macOS, Windows, and Linux.

Rollback removes the new extension and disables v1.1-only methods while preserving v1.0 extension registry/state. Media handle/job records are additive and can be ignored by older builds; incomplete staging outputs are safe to delete. Project files are workspace-local and schema-versioned, so uninstalling the extension does not delete user projects or exports.

## Open Questions

None. The first-release scope, trust model, local execution boundary, job recovery semantics, FFmpeg dependency policy, project model, and non-generative product boundary are fixed by this design.
