## Context

Kun Video Editor 0.3.0 is both a product-bundled default extension and the Extension API v1.1 reference. It already has a frame-native single-timeline project, optimistic revisions, protected media handles, nine main-Agent tools, brokered FFmpeg jobs, generated artifacts, localization, and a direct right-sidebar View. The current Webview nevertheless lays out a desktop workbench whose minimum column widths exceed the Host's 760 px maximum right panel, so real installations collapse every feature into an unprioritized long page. The player is a bounded source preview rather than the same compositing graph used for export, local transcript analysis is not generally available, and professional timeline/media capabilities are intentionally absent.

This change spans the extension engine, Host entry, Webview, generic Extension API media/job surfaces, Kun runtime brokers, and packaged release gates. It must preserve the single Kun runtime, public `.kunx` lifecycle, workspace trust, cache-stable Agent catalog, protected-path boundary, headless behavior, and third-party reproducibility. Palmier Pro informed the desired editing semantics and verification loop, but its GPLv3 Swift/AVFoundation/Metal implementation, raw-path/non-sandbox assumptions, and closed generation backend are not source dependencies.

## Goals / Non-Goals

**Goals:**

- Make the editor immediately usable in the Host-owned 280–760 px right sidebar, starting with the empty-project state and preserving the main conversation.
- Give users and the main Kun Agent one revision-checked, transaction-based editing domain with compact receipts and composed evidence.
- Deliver P0 transcript-first editing and reliable proof, P1 professional timeline/media foundations, and P2 bounded media intelligence, multicam, interchange, and provider-neutral generation.
- Keep preview, proof, and export semantically aligned through one renderer-neutral timeline IR.
- Keep large media, derived assets, native executables, and credentials behind generic Host/runtime brokers.
- Keep the exact shipped `.kunx` a buildable public example with deterministic packaging and native evidence.

**Non-Goals:**

- Recreating Premiere, Resolve, or Palmier's complete desktop layout inside a sidebar.
- Giving extensions raw filesystem paths, arbitrary shell/network access, private Electron IPC, renderer DOM access, or Kun runtime credentials.
- Copying GPLv3 Palmier source or binding Kun to AVFoundation, Metal, Convex, Palmier accounts, or one AI provider.
- Adding a second visible Agent chat inside the extension; the main Kun conversation remains the natural-language surface.
- Claiming that technical decode/encode success is visual review, or that transcript evidence proves unseen visual content.
- Treating CRDT collaboration, cloud rendering, or unrestricted VFX graphs as P0–P2 requirements.

## Decisions

### 1. The right sidebar is a compact task workspace, not a shrunken desktop editor

At all supported Host widths, the View renders a compact project header, a bounded preview, and one active primary workspace selected by an accessible tablist. Empty/loading/error states live in normal document flow and expose their next action above the fold. Timeline lanes may scroll horizontally inside their own region, but the document body and project controls do not require horizontal scrolling. Wide standalone/result-preview contexts may enhance the layout but do not define the sidebar contract.

Alternative considered: retain the three-column grid and rely on vertical stacking below 860 px. Rejected because the Host panel cannot reach that grid's minimum width and the stacked result hides all task hierarchy.

### 2. One versioned editing domain owns every mutation

The extension engine remains independent from Electron and React. UI actions and Agent tools submit the same typed commands to a per-project serialized command service with `expectedRevision`, validation, one atomic commit, inverse metadata, and a structured receipt. Receipts contain changed/created/removed IDs, compressed uniform shifts, track/sequence changes, notes, and the new revision; they do not echo an unbounded project.

Existing v1 projects migrate deterministically to the next schema. New state adds sequences, active sequence, link groups, keyframe/effect data, selection evidence, derived references, and durable recovery metadata without storing media bytes or reusable paths.

Alternative considered: let the Webview manipulate projected JSON and keep broad Agent mutations separate. Rejected because it duplicates invariants and makes concurrent human/Agent edits unverifiable.

### 3. Timeline behavior is implemented as pure planning engines

Snap, ripple, overwrite, link propagation, sequence nesting, keyframe sampling, caption mapping, and multicam switching are pure functions over validated frame-native values. Command handlers apply their plans transactionally. This keeps browser interaction, headless tools, render planning, and tests deterministic.

Alternative considered: encode behavior only in pointer handlers or FFmpeg command construction. Rejected because UI-only logic cannot be reused or safely driven by an Agent.

### 4. The Agent uses a compact inspect–mutate–verify protocol

The stable tool surface remains bounded rather than mirroring every UI button. Read tools support windows, IDs, summaries, and omission of default fields. Dedicated inspection distinguishes raw media from the composed timeline. Mutation tools return receipts; verification tools render revision-bound storyboards/proof frames with visible clip IDs and frame labels. Agent-owned undo refuses to undo intervening manual edits.

Selection/playhead/timeline-range context is explicit project/View state retrieved through a tool or a bounded context reference. It is not injected into the stable system prefix and does not grant DOM access.

Alternative considered: expand directly to dozens of tools or inject all View state into every prompt. Rejected due tool-prefix churn, token cost, stale context, and excess authority.

### 5. The Webview never hosts a duplicate chat

The panel shows active project/revision, selected evidence, last command receipt, proof freshness, job state, and an action that helps the user continue in the main Kun conversation. Workspace-scoped extension events keep it synchronized with main-Agent edits. A future generic composer-context API may attach a bounded selection, but the extension cannot create a private renderer channel.

### 6. Transcript-first analysis is provider-neutral and local by default

Transcript adapters normalize imported SRT/VTT/JSON and supported local ASR into sentence and word timestamps with provenance, language, confidence, model identity, and source fingerprint. Silence/filler removal and caption building plan edits in source time, then map through trim/speed to project frames. Cloud transcription requires an explicit separately permissioned provider; it is never an implicit fallback.

### 7. Derived media and proxies are a generic, quota-managed graph

Thumbnails, filmstrips, waveforms, transcripts, embeddings, analysis, proxies, proofs, and previews are derived nodes keyed by source file identity plus normalized parameters and engine version. The runtime owns execution, concurrency, cancellation, in-flight deduplication, failure backoff, byte accounting, LRU eviction, and invalidation. Project state stores opaque derived IDs and provenance, not cache paths. Export work has priority over background indexing.

Alternative considered: copy Palmier's unbounded path/mtime caches into the extension. Rejected because large cross-platform projects need quotas, invalidation, and revocation.

### 8. One renderer-neutral IR drives preview, proof, and export

The editing model compiles to a canonical render IR describing sources, frame/time maps, layers, transforms, crops, opacity, fades, captions/text, effects, keyframes, audio mix, nests, and output color/canvas settings. A brokered FFmpeg backend is the first implementation. The Webview may use a source/proxy fast path only when the compiler proves equivalence; otherwise it displays a revision-bound composed preview/proof. Capability negotiation marks unsupported nodes instead of silently flattening them.

Alternative considered: make CSS playback authoritative and separately generate FFmpeg filters. Rejected because preview/export drift makes both human and Agent review unreliable.

### 9. Advanced editing and analysis arrive behind the same public contracts

P1 adds spatial timeline interaction, waveform/filmstrip, snap/ripple/overwrite, A/V linking, fades, sequences, and bounded keyframes/effects. P2 adds spoken/moment search, VAD/speaker/beat analysis, sync, multicam, color/effects, codecs/interchange, and generation/upscale. These extend project commands, analysis job kinds, and render IR nodes; they do not create private built-in routes.

### 10. Generation is a recoverable provider adapter, not an editor dependency

Generation/upscale providers advertise models and capabilities through a generic adapter. A request creates a durable placeholder asset with prompt/model/reference lineage, cost/approval state, idempotency key, and job ID. Completion replaces the placeholder or adds variants without mutating source media; restart reconciliation reports interrupted/failed/ready honestly. Local and BYOK adapters are first-class, and the editing core works without any provider.

### 11. Security and concurrency remain stricter than reference editors

All media/output access uses owner/version/workspace-bound opaque handles and short-lived View leases. Native processing runs without a shell, with allowlisted protocols/filters, bounded arguments/output, deadlines, cancellation, staging, and atomic promotion. Every mutation includes a project revision; every job includes ownership, revision, and idempotency. Read status is approval-free; cancellation, destructive edits, remote cost, and external export remain separately classified.

### 12. Validation is layered and evidence-based

Pure engines receive property/unit tests; Webview behavior gets semantic component and width-contract tests; Host/runtime brokers get security and recovery integration tests; FFmpeg fixtures execute render IR paths when capabilities exist; and packaged native smokes open the real right-sidebar View at narrow and preferred widths. Release evidence distinguishes skipped optional capabilities from passing behavior.

## Risks / Trade-offs

- [P0–P2 scope can turn the example into an unmaintainable monolith] → Keep engine, adapters, Host bridge, and Webview modules separate; land capability slices with migrations and explicit limits.
- [A 280 px sidebar cannot expose every professional control simultaneously] → Use one primary tab, compact preview, contextual inspector, keyboard actions, and Host-owned widening/focus behavior without DOM intrusion.
- [A richer project schema can strand 0.3.0 projects] → Provide deterministic migrations, golden fixtures, forward-version refusal, backup snapshots, and rollback-compatible source media.
- [Preview fast paths may diverge from final render] → Require compiler-proven equivalence and show proof revision/capability status; otherwise use composed proxies.
- [Local ASR/embeddings/proxies consume CPU, memory, and disk] → Quotas, priority gates, concurrency limits, LRU eviction, cancellation, model opt-in, and storage diagnostics.
- [More tools reduce model cache efficiency] → Prefer compact typed operations, windowed reads, resource catalogs, and additive tool versions at new session boundaries.
- [Generation can incur cost or upload private media] → Separate network/provider permissions, explicit user approval/cost display, bounded references, provenance, and no automatic cloud fallback.
- [Cross-platform FFmpeg capabilities vary] → Runtime feature probes, target-specific evidence, portable fallbacks, and actionable disabled states.
- [Node extension code is not an OS sandbox] → Keep the existing high-risk disclosure and audit the bundled package; brokers constrain compliant extensions but are not represented as containment.
- [Palmier-inspired behavior could accidentally copy GPL implementation] → Use behavior-level specifications, independently authored TypeScript, and no source copying.

## Migration Plan

1. Ship the sidebar shell fix with semantic tests while preserving the 0.3.0 project/tool contracts.
2. Add schema v2 migrations, shared command receipts, compact inspection, and render IR behind compatible projections; migrate fixture projects on load and keep originals recoverable.
3. Add local transcript and derived-media broker jobs, then spatial timeline interaction and sequence/keyframe/effect commands.
4. Add media intelligence, sync/multicam, interchange, and provider adapters incrementally with capability probes and permission review.
5. Advance the extension/API version only when the same deterministic archive passes example gates, runtime integration, and native packaged smokes on each claimed platform.

Rollback selects the previous installed extension version without deleting workspace projects, source grants, exports, or derived metadata. Newer project schema is never silently opened by an older engine; users can restore a retained pre-migration snapshot or export a self-contained/interchange project.

## Open Questions

- Whether the first cross-platform composed interactive preview should use short proxy segments through the existing FFmpeg broker or introduce a generic frame-stream decoder API; proof/export semantics do not depend on this choice.
- Which local ASR/model packages can be product-bundled per target without unacceptable installer size or license obligations; imported transcripts remain the guaranteed fallback.
- Which interchange format (OTIO, FCPXML, or both) becomes the first writable and readable adapter after the P1 editing model stabilizes.
