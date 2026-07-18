## 1. Extension API v1.1 contracts

- [x] 1.1 Bump the public Extension API packages and negotiation fixtures to v1.1 while retaining v1.0 manifest compatibility.
- [x] 1.2 Add media permissions, opaque handle, picker, metadata, probe, FFmpeg job, resource-lease, and error schemas to `@kun/extension-api`.
- [x] 1.3 Add job state, snapshot, filter, page, progress, event, subscription, cancellation, result, and cursor schemas to `@kun/extension-api`.
- [x] 1.4 Add `MediaApi` and `JobsApi` to `ExtensionContext`, the Host client, View-safe method catalog, and public package exports.
- [x] 1.5 Add top-level `generatedArtifacts` schemas to tool/job results and media-handle references to result-preview sources.
- [x] 1.6 Add deterministic fake media and job services, permission enforcement, restart/cancellation controls, and artifact fixtures to `@kun/extension-test`.
- [x] 1.7 Regenerate the manifest/API schema and API reference, update bilingual v1.1 documentation/changelog, and pass public-surface drift checks.

## 2. Durable extension background jobs

- [x] 2.1 Implement an atomic file-backed ExtensionJobStore for owned snapshots, monotonic events, idempotency keys, retention, and startup loading.
- [x] 2.2 Implement the ExtensionJobService state machine with admission, valid transitions, progress coalescing, terminal fencing, quotas, and result/error bounds.
- [x] 2.3 Implement replay-plus-live subscriptions with cursors, bounded queues, overflow/gap responses, cleanup, and terminal completion.
- [x] 2.4 Implement idempotent owner-checked cancellation and core-executor cancellation adapters with bounded cleanup deadlines.
- [x] 2.5 Implement startup reconciliation for queued/running/cancel-intent jobs and explicit interrupted outcomes without unsafe automatic replay.
- [x] 2.6 Fence or reconcile jobs during extension disable, rollback, uninstall, workspace revocation, runtime shutdown, and Extension Host crashes.
- [x] 2.7 Expose `jobs.get/list/subscribe/cancel` through the Extension Host Broker and View boundary with `jobs.manage` authorization.
- [x] 2.8 Compose job storage/service into serve and one-shot runtime factories and expose redacted diagnostics.
- [x] 2.9 Add store, state-machine, cursor/replay, backpressure, quota, cancellation-race, restart, ownership, disablement, headless, and redaction tests.

## 3. Brokered media resources and processing

- [x] 3.1 Implement a persistent media-handle store with owner/version/workspace scope, canonical file identity, read/write mode, external-selection grants, revocation, and redacted projections.
- [x] 3.2 Implement media stat/release operations, current-grant reauthorization, path/symlink/device/output-alias confinement, quotas, and lifecycle cleanup.
- [x] 3.3 Implement Host-controlled ffprobe/ffmpeg discovery, capability diagnostics, scrubbed environment construction, and bounded argument-array process supervision.
- [x] 3.4 Implement `media.probe` with fixed ffprobe JSON arguments, normalized bounded metadata, timeout/cancellation, and path redaction.
- [x] 3.5 Implement validated FFmpeg handle placeholders, protocol/path/filter denial, staging outputs, progress parsing, output/disk quotas, and atomic promotion.
- [x] 3.6 Connect FFmpeg execution to core-owned durable jobs, process-tree cancellation, shutdown recovery, post-output ffprobe validation, and artifact publication.
- [x] 3.7 Implement artifact persistence/availability checks and fresh media-resource lease creation without persisting ephemeral URLs.
- [x] 3.8 Add malicious argument, traversal, symlink, foreign handle, missing executable, output alias, progress flood, quota, cancellation, invalid output, artifact, and headless tests.

## 4. Electron protected pickers and seekable View protocol

- [x] 4.1 Add shared IPC/runtime schemas for protected media pick, save-target pick, selection registration, lease creation/revocation, and media diagnostics.
- [x] 4.2 Add Main-owned file/save dialogs with bounded filters, extension/View/workspace binding, cancellation, protected operation tokens, and no renderer-visible paths.
- [x] 4.3 Register selections and save targets with Kun through authenticated runtime routes and return only opaque media handles to the owning View.
- [x] 4.4 Implement the privileged `kun-media://` scheme and sender/View-bound lease resolver with safe MIME, file-identity, TTL, and concurrency checks.
- [x] 4.5 Implement streaming `HEAD`, full `GET`, and bounded single-range `GET` responses with correct 200/206/416 headers and backpressure.
- [x] 4.6 Extend the Kun-owned Extension Webview preload/transport and CSP for media APIs and `kun-media:` playback while preserving network, navigation, Node, and bridge isolation.
- [x] 4.7 Revoke leases/streams on View close/crash, workspace change, permission change, extension lifecycle changes, expiry, and file replacement.
- [x] 4.8 Add IPC sender, consent, picker forgery, copied URL, stale session, range parsing, memory/backpressure, CSP, revocation, and packaged Chromium tests.

## 5. Generated artifact and renderer integration

- [x] 5.1 Validate extension `generatedArtifacts` against media/job ownership and translate them into canonical persisted ToolHost generated-file metadata.
- [x] 5.2 Extend Kun event/history serialization and mapper logic to retain artifact identity, availability, provenance, media handle, and legacy generated-file compatibility.
- [x] 5.3 Extend result-preview matching/open payloads to use artifact/media-handle references and mint fresh View leases instead of paths or data URLs.
- [x] 5.4 Add Host-controlled open/reveal behavior for available artifacts and explicit unavailable presentation for revoked, missing, or replaced files.
- [x] 5.5 Add tool-result, replay/restart, unavailable artifact, cross-extension denial, result-preview, open/reveal, and mapper regression tests.

## 6. Kun video editor project engine

- [x] 6.1 Scaffold the buildable React + Node `examples/extensions/kun-video-editor` package and add it to extension example validation.
- [x] 6.2 Define runtime schemas for frame-native projects, rational frame rates, assets, tracks, items, captions, transcripts, revisions, operations, render presets, and migrations.
- [x] 6.3 Implement confined atomic project creation/load/list/save, optimistic revision checks, immutable revision snapshots, undo/redo, and bounded history.
- [x] 6.4 Implement deterministic timeline validation and operations for add/split/trim/delete/reorder/track placement, overlap policy, transforms, captions, and canvas presets.
- [x] 6.5 Implement deterministic `timeline.md` generation, revision/digest validation, and transcript-range-to-timeline edit application without rewriting source media.
- [x] 6.6 Implement SRT/VTT/JSON transcript import, local transcriber capability detection, timed segment validation, filler/silence range handling, and explicit unavailable behavior.
- [x] 6.7 Implement FFmpeg render-plan generation for proof frames, simple composed previews, H.264 MP4, optional burned captions, audio, and SRT/VTT artifacts.
- [x] 6.8 Add project schema, rational frame math, invalid reference, revision conflict, undo/redo, operation, script staleness, transcript timing, subtitle escaping, render-plan, and path tests.

## 7. Video editor Agent profile and tools

- [x] 7.1 Declare the right-sidebar View, private `video-editor` Agent profile, nine stable tools, activation events, settings, result preview, and least-privilege permissions in the manifest.
- [x] 7.2 Implement `video-project`, `video-read-script`, and revision-aware bounded project/script projections.
- [x] 7.3 Implement `video-probe`, protected media import, asset creation, metadata persistence, thumbnails, and waveform requests.
- [x] 7.4 Implement `video-transcribe`, `video-apply-script`, and `video-update-timeline` with structured schemas, transactionality, provenance, and change events.
- [x] 7.5 Implement `video-render`, read-only `video-render-status`, and destructive `video-render-cancel` over durable media jobs with pinned revision/preset, cancellation, proof/export validation, and generated artifacts.
- [x] 7.6 Implement profile instructions that align creative choices, read before write, edit structure first, avoid unrequested additions, verify proof, and state unsupported visual/generative limits.
- [x] 7.7 Add manifest/catalog, handler schema, approval class, project race, stale revision, cancellation, headless, artifact, and stable tool-history tests.

## 8. Right-sidebar video editing Webview

- [x] 8.1 Implement the public Host client bindings and bounded View state for media handles, jobs, project changes, Agent runs, theme, locale, reconnect, and errors.
- [x] 8.2 Build the responsive docked right-sidebar shell with media library, Player, transcript, multi-track timeline, inspector, captions, revisions, preview, Agent synchronization, and export/job regions.
- [x] 8.3 Implement project creation/open, protected import, media lease playback, missing capability states, and stale/revoked resource recovery.
- [x] 8.4 Implement manual select/split/trim/delete/reorder/track/caption/aspect edits through the revision-aware service with conflict refresh and undo/redo.
- [x] 8.5 Implement synchronized transcript/timeline seeking, `timeline.md` review/apply, caption editing, and explicit transcript-only understanding boundaries.
- [x] 8.6 Implement Agent create/subscribe/steer/cancel UI, project-change refresh, bounded event windows, approval/user-input states, and editable review checkpoints.
- [x] 8.7 Implement proof-frame/preview presentation, stale-proof warnings, export target selection, job progress/cancel/reconnect, and generated-artifact open/reveal.
- [x] 8.8 Add accessible keyboard/focus behavior, reduced motion, high contrast, loading/empty/error/interaction-required states, virtualization, and localization strings.
- [x] 8.9 Add Webview component/state tests for manual editing, Agent synchronization, conflicts, media revocation, job reconnect/cancel, proof staleness, unsupported requests, and accessibility.

## 9. Documentation, examples, and security review

- [x] 9.1 Write bilingual media/job API, permission, picker, protocol, FFmpeg availability, artifact, headless, and troubleshooting documentation.
- [x] 9.2 Write the video editor quick start, supported MVP workflows, local dependency setup, privacy model, limitations, project format, Agent prompts, and recovery guide.
- [x] 9.3 Add runnable fixtures and example build/typecheck/test/validate/pack coverage without remote ASR or generative services.
- [x] 9.4 Extend release/security gates for API v1.1/v1.0 negotiation, media protocol isolation, native process cleanup, extension install, headless tools, and desktop View playback.
- [x] 9.5 Review licenses, FFmpeg discovery/distribution language, source-media non-modification, logs/redaction, disk cleanup, and Node-extension trust disclosures.

## 10. Validation and handoff

- [x] 10.1 Run focused SDK, job, media, Electron bridge, renderer mapper, video engine/tool, Webview, schema, and documentation tests and fix introduced failures.
- [x] 10.2 Run `npm run typecheck`, `npm run test`, `npm run build:kun`, `npm run build`, `npm run check:extension-examples`, and the Extension release gate with baseline failures separated.
- [x] 10.3 Build, validate, pack, install, doctor, activate, headlessly invoke, and uninstall the `kun-video-editor` `.kunx` using deterministic media fixtures.
- [x] 10.4 Smoke real ffprobe/FFmpeg import, proof, cancellation, H.264 export, post-probe, artifact preview/open/reveal, and project reopen on the local host.
- [ ] 10.5 Record or obtain native macOS, Windows, and Linux packaged media/security smoke evidence and complete the final requirement-by-requirement audit.

## 11. Bundled default and reference distribution

- [x] 11.1 Define the bounded bundled-extension catalog and atomic seed-ledger contracts, including seeded, user-managed, removed, and safe-upgrade semantics.
- [x] 11.2 Extend the deterministic video-editor packer so product resources and standalone release output reuse the same validated `.kunx` bytes.
- [x] 11.3 Add a generic Kun bundled-extension seeder that installs through `ExtensionPackageManager`, preserves trust and user choices, and reports non-fatal diagnostics.
- [x] 11.4 Wire development and packaged Electron resource discovery into `kun serve` without importing or hard-coding video-editor contributions.
- [x] 11.5 Add catalog, first-run, idempotency, permission-change, disable, uninstall, rollback, development-source, packaging-layout, and archive-identity tests.
- [x] 11.6 Update the reference documentation and release/security gates, then run focused tests, typecheck, build, and packaged-resource validation.
