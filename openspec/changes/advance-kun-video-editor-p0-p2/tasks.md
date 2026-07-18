## 1. P0 right-sidebar Webview usability

- [x] 1.1 Fix the Host `webview` flex-height contract so an Extension View fills the available right-panel body instead of exposing a short guest viewport over Host background
- [x] 1.2 Replace the video editor's unreachable desktop grid with a 280–760 px dock shell, compact project header, visible empty/error states, bounded preview, and one primary workspace
- [x] 1.3 Add accessible Script, Clips, Timeline, Properties, and Output workspace navigation with persisted active workspace and no duplicate chat surface
- [x] 1.4 Complete English/Simplified-Chinese copy, live theme/locale/direction behavior, focus order, keyboard tab behavior, reduced motion, and high-contrast states for the new shell
- [x] 1.5 Add semantic Host/Webview regression tests for flex fill, 280/360/560/760 px contracts, empty/active/error states, navigation, locale/theme, and accessibility
- [x] 1.6 Exercise the real right-sidebar View in development and packaged macOS builds and capture actionable visual evidence at narrow and preferred widths
- [x] 1.7 Redesign the complete sidebar workbench from an ImageGen visual reference and local OpenReel/Palmier interaction research, then implement the compact project chrome, preview transport, icon navigation, timeline hierarchy, contextual editing bar, and responsive empty state without changing editor authority contracts
- [x] 1.8 Generate and version a dedicated ImageGen reference for initial setup plus every primary workspace, then align the live initialization, Script, Clips, Timeline, Properties, and Output layouts at current Host widths and advance the bundled extension patch version so existing managed installs receive the redesign
- [x] 1.9 Audit the current Host rendering against all six versioned ImageGen references and refine shared chrome, preview/status/navigation composition, per-workspace hierarchy, typography, spacing, colors, and control states until the live 760–920 px and 280–360 px layouts closely match the intended design without fabricating media or capability state

## 2. P0 shared editing command and project migration

- [x] 2.1 Define schema-v2 project, sequence, link-group, selection, keyframe/effect, derived-reference, receipt, and migration contracts with bounded limits
- [x] 2.2 Implement deterministic v1-to-v2 migration, future-version refusal, golden fixtures, backup snapshots, and round-trip validation
- [x] 2.3 Refactor UI and Agent mutations onto one per-project serialized command service with expected revisions, transaction validation, atomic commit, and attributable events
- [x] 2.4 Implement bounded mutation receipts with created/changed/removed IDs, compressed shifts, sequence/track changes, proof invalidation, and localized notes
- [x] 2.5 Implement Agent-owned undo fencing separately from ordinary user undo/redo and cover intervening manual edits
- [x] 2.6 Harden project recovery for unreadable manifests, offline/revoked/changed media, relink, source preservation, cache-only cleanup, and restart reconciliation

## 3. P0 Agent inspect–mutate–verify loop

- [x] 3.1 Add compact windowed project/timeline reads that omit defaults, summarize captions, expose gaps/sequences/selection, and report hidden counts at a revision
- [x] 3.2 Add raw media inspection with bounded metadata, sampled frames/storyboard, transcript paging, word timestamps, and honest capability/index status
- [x] 3.3 Add composed timeline inspection with visible clip/caption IDs, frame labels, revision/IR digest, and proof artifacts
- [x] 3.4 Return mutation receipts from edit tools, refresh after revision conflicts/index invalidation, and require evidence before destructive transcript edits
- [x] 3.5 Add explicit active project/sequence/playhead/clip/word/range context resolution without DOM access or stable-prefix mutation
- [x] 3.6 Update the private Agent profile and main-Agent tool catalog while retaining bounded cache-stable schemas and separate read/write/destructive/cost/cancel authority
- [x] 3.7 Synchronize project, selection, receipt, proof, derived-media, and job events across View and Agent with monotonic generations and stale-response fencing

## 4. P0 transcript, captions, and derived media

- [x] 4.1 Define provider-neutral transcript adapter/result contracts for imported SRT/VTT/JSON and negotiated local ASR with word provenance and source fingerprints
- [x] 4.2 Implement and package at least one supported local ASR path per claimed target or return a tested actionable unavailable state without upload/fabrication
- [x] 4.3 Implement source-aware word, filler, silence, and explicit-range planners that map through trim, speed, links, and project frames transactionally
- [x] 4.4 Build editable caption/text clips from transcript timing, punctuation, word limits, rendered-width bounds, styles, positions, word timing, and optional animation
- [x] 4.5 Add generic derived-record contracts and stores with dependency graph, source identity, producer version, status, ownership, bytes, pinning, invalidation, and recovery
- [x] 4.6 Add brokered waveform, thumbnail, progressive filmstrip, proxy, proof, and preview jobs with deduplication, cancellation, priority, backoff, quotas, and LRU eviction
- [x] 4.7 Surface transcript/caption/derived progress, partial results, storage use, errors, relink, retry, and safe cleanup in the sidebar

## 5. P0 canonical render IR and reliable proof

- [x] 5.1 Define and validate a canonical render IR for source maps, layers, canvas/color, transforms, crop, opacity, fades, text/captions, audio mix, nests, effects, keyframes, and ranges
- [x] 5.2 Compile existing project/timeline behavior to the IR and refactor FFmpeg proof, preview, audio, subtitle, and H.264 plans to consume it
- [x] 5.3 Implement capability negotiation and actionable unsupported-node reports without silent flattening
- [x] 5.4 Use compiler-proven source/proxy fast paths for interactive playback and composed revision-bound proxies/proofs otherwise
- [x] 5.5 Bind proof/preview artifacts to project/sequence/revision/IR digest/backend capabilities and invalidate them on render-relevant commits
- [x] 5.6 Add executable FFmpeg fixtures comparing preview/proof/export semantics and distinguishing technical validation from visual evidence

## 6. P1 professional timeline interaction

- [x] 6.1 Implement pure timeline geometry, hit testing, zoom, scroll, playhead, range selection, and coordinate/time conversion engines
- [x] 6.2 Replace form/list-only timeline editing with spatial lanes, proportional clips/captions, drag placement, resize trim handles, selection, keyboard actions, and bounded virtualization
- [x] 6.3 Add pure sticky snap targets for playhead, clip edges, captions, markers, and beats with visual/haptic-equivalent feedback
- [x] 6.4 Add ripple insert/delete/trim/gap operations and previews across sync-locked tracks with transaction receipts
- [x] 6.5 Add overwrite planning that removes, trims, or splits intersecting clips while preserving source continuity
- [x] 6.6 Add linked A/V groups, sync locks, clip mute/visibility/lock, volume, fades, waveform display, and linked mutation behavior
- [x] 6.7 Add timeline performance tests for long projects, many clips/tracks, narrow sidebar interaction, virtualization, and bounded command/process arguments

## 7. P1 sequences, keyframes, effects, and richer media

- [x] 7.1 Add create/duplicate/rename/select/close/delete-safe sequence commands, active/open sequence state, per-sequence view state, and sidebar navigation
- [x] 7.2 Add nested sequence clips, cycle/depth checks, duration propagation, open/decompose workflows, and nested render/audio behavior
- [x] 7.3 Add image/still and supported animation assets, folders, batch import/organize/relink, generated lineage, and media-library virtualization
- [x] 7.4 Add deterministic keyframe tracks/interpolation for transform, crop, opacity, volume, and effect parameters with trim/split/retime policies
- [x] 7.5 Add bounded text animation, blend/color/effect catalogs, inspector controls, Agent operations, render nodes, and unsupported capability warnings
- [x] 7.6 Add preview source tabs/history, compare/replace workflows, and explicit selection attachment to the main conversation through a public bounded context contract

## 8. P2 media search and local analysis

- [x] 8.1 Add filename and spoken transcript search with bounded source-range results, paging, completeness, and direct preview/insert actions
- [x] 8.2 Add an opt-in local visual embedding/model adapter with verified download/install, frame sampling, immutable index records, progress, cancellation, and moment search
- [x] 8.3 Add local VAD/silence analysis with cached provenance and confidence-aware edit suggestions
- [x] 8.4 Add speaker identity/diarization contracts, model adapter, registry, transcript/caption attribution, and uncertainty handling
- [x] 8.5 Add beat/downbeat analysis, cached markers, timeline snapping, and Agent-readable evidence
- [x] 8.6 Add audio synchronization analysis with seeded correlation, confidence thresholds, preview, transactional apply, and refusal on uncertainty

## 9. P2 multicam, advanced export, and project interchange

- [x] 9.1 Add multicam groups, member/angle labels, sync offsets/confidence, coverage validation, program fragments, switch/merge/layout plans, UI, and Agent tools
- [x] 9.2 Add advanced color/effects needed by the IR with CPU fallback, optional GPU acceleration, deterministic preview/export, and performance limits
- [x] 9.3 Add negotiated H.265, ProRes or portable equivalents, quality/resolution/frame-rate/audio settings, and per-target capability evidence
- [x] 9.4 Add at least one professional interchange adapter with stable ID/timecode mapping, import/export tests, and explicit loss manifests
- [x] 9.5 Add atomic self-contained project-package export with sequences, manifests, selected media, receipts/chat provenance, generation lineage, deduplication, and missing-media policy
- [x] 9.6 Add round-trip and cancellation/restart tests for codecs, nested sequences, text/keyframes/effects, interchange, and project packages

## 10. P2 provider-neutral generation and upscale

- [x] 10.1 Define model catalogs and local/BYOK/remote provider adapter contracts with capabilities, permission, cost, privacy, and reference limits
- [x] 10.2 Implement durable placeholder assets and generation/upscale jobs with prompt/model/reference lineage, idempotency, approval, progress, cancellation, variants, and restart recovery
- [x] 10.3 Add bounded image/video/audio/upscale request and status tools without coupling the editing core to a provider or subscription
- [x] 10.4 Add sidebar generation controls, reference selection, cost/upload confirmation, placeholder/variant states, and editable timeline insertion
- [x] 10.5 Add security tests for provider secrets, media upload consent, URL/protocol/path confinement, job ownership, output validation, and log redaction

## 11. Documentation, examples, release, and completion audit

- [ ] 11.1 Update Extension API schemas/references, quick starts, standalone dependency guidance, manifest localization, migration/recovery, privacy, limitations, and third-party recipes
- [x] 11.2 Advance the extension/package identity and deterministic bundled/release archives only after migrations and permissions are final
- [x] 11.3 Run extension typecheck/unit/component/integration/build/validate/pack/determinism gates and relevant Kun/runtime/renderer suites
- [ ] 11.4 Run top-level typecheck, tests, Kun build, application build, and native packaged smokes on every claimed platform with optional-capability evidence
- [ ] 11.5 Audit every P0–P2 spec scenario against authoritative source, test, package, and runtime evidence; leave no requirement marked complete on indirect or missing proof
