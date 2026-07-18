# Kun Video Editor P0-P2 Completion Evidence

This file is the completion audit for `advance-kun-video-editor-p0-p2`. It maps
each change-local scenario to authoritative implementation and direct test
evidence. Command results and package identities are recorded only after the
final source tree has been rebuilt.

## Evidence rules

- A source file alone is not treated as scenario completion; every row names a
  direct test or packaged smoke that exercises the behavior.
- Technical encode/decode evidence is not represented as human visual review.
- An optional local capability may be unavailable when the unavailable result
  is explicit, actionable, and tested.
- Local packaged claims in this audit are limited to macOS arm64. Other targets
  require their own CI-produced native evidence before release claims include
  them.

## Sidebar workbench scenarios

| Requirement / scenario | Authoritative implementation | Direct evidence |
| --- | --- | --- |
| Usable at every Host sidebar width / narrow empty project | `src/renderer/src/extensions/ExtensionWebview.tsx`; `examples/extensions/kun-video-editor/src/webview/app.tsx`; `styles.css` | `webview-responsive.test.ts`; `webview-component.test.tsx` (primary first-screen action); `smoke-packaged-video-editor-layout.cjs` at 280 px |
| Usable at every Host sidebar width / preferred-width active project | Same Host/View shell and responsive styles | `webview-responsive.test.ts`; `smoke-development-video-editor-layout.cjs`; `smoke-packaged-video-editor-layout.cjs` at 760 px |
| Primary workspace navigation / change active workspace | `app.tsx`; `controller.ts`; `model.ts` persisted `activeWorkspace` | `webview-component.test.tsx` (roving tab selection); `webview-controller.test.tsx` (persisted workspace) |
| Explicit empty/loading/error/recovery / initialization fails after appearance loads | `controller.ts`; `app.tsx`; `i18n.ts` | `webview-controller.test.tsx` (appearance-preserving initialization failure and recovery); `webview-component.test.tsx` (localized recovery action) |
| Compact preview and status / long transcript at narrow width | `app.tsx` transcript window; `styles.css` bounded transcript scroller | `webview-responsive.test.ts`; `webview-component.test.tsx` (long transcript in 280 px sidebar) |
| Natural language remains in main Kun conversation / Agent changes active project | `controller.ts` workspace-scoped project events; no extension chat surface | `webview-controller.test.tsx` (newest active project fencing); `smoke-packaged-video-editor-desktop.cjs` (main-Agent ToolHost round trip) |
| Appearance follows Host / locale changes live | `controller.ts`; `i18n.ts`; theme variables in `styles.css` | `webview-controller.test.tsx` (live theme/language); `webview-component.test.tsx` (Simplified Chinese and Kun theme) |
| Accessibility follows Host / keyboard-only navigation | `app.tsx` tablist/tabpanel/focus handling; reduced-motion/high-contrast styles | `webview-component.test.tsx` (roving keyboard tabs and landmarks); `webview-responsive.test.ts` |

## Editing-domain scenarios

| Requirement / scenario | Authoritative implementation | Direct evidence |
| --- | --- | --- |
| Migratable frame-native model / schema-v1 opens | `engine/schema.ts`; `engine/project-service.ts` | `schema-v2-migration.test.ts` (golden migration, immutable backup, round trip) |
| Migratable frame-native model / future schema opens | Same migration boundary | `schema-v2-migration.test.ts` (future-version refusal and preservation) |
| Multiple/nested sequences / alternate cut | `engine/sequences.ts`; shared command service | `sequences.test.ts` (create/duplicate/activate/rename/delete-safe state) |
| Multiple/nested sequences / nesting cycle | `engine/sequences.ts`; `engine/nested-render.ts` | `sequences.test.ts` (cycle/depth refusal and nested render expansion) |
| One command service / human-Agent revision race | `engine/command-service.ts`; Host `video-tools.ts` | `command-service-v2.test.ts`; `video-tools.test.ts` (serialized manual/Agent race) |
| One command service / invalid batch member | Transaction validation in `command-service.ts` | `command-service-v2.test.ts` (atomic rollback) |
| Bounded actionable receipts / large ripple shift | `engine/timeline-edit-planners.ts`; receipt compression in command service | `timeline-edit-receipt.test.ts`; `command-service-v2.test.ts` |
| Agent undo fencing / user edits after Agent | Command provenance and inverse fencing | `command-service-v2.test.ts`; `video-tools.test.ts` (intervening manual work) |
| Deterministic edit semantics / snap | `engine/timeline-snap.ts`; `engine/timeline-geometry.ts` | `timeline-snap.test.ts` |
| Deterministic edit semantics / overwrite intersection | `engine/timeline-edit-planners.ts` | `timeline-edit-planners.test.ts` (split/trim/source continuity) |
| Recovery preserves source/evidence / unreadable metadata | `engine/project-service.ts`; recovery snapshots and relink logic | `project-recovery-v2.test.ts` |

## Agent verification scenarios

| Requirement / scenario | Authoritative implementation | Direct evidence |
| --- | --- | --- |
| Compact stable control plane / new effect parameter | `host/tool-contracts.ts`; generic typed operations in `video-tools.ts` | `video-tools.test.ts` (catalog stability and strict Host boundary); `effects-keyframe-operations.test.ts` |
| Windowed compact reads / long captioned region | `engine/inspection.ts`; inspection tools | `inspection.test.ts` (window, hidden counts, caption summaries); `video-tools.test.ts` |
| Raw and composed inspection differ / picture-in-picture proof | `engine/inspection.ts`; `engine/render-ir.ts` | `inspection.test.ts` (raw paging versus composed proof); `render-ir.test.ts` |
| Explicit revision-bound selection / selected-range request | public composer context plus `context.update/read` | `inspection.test.ts`; `webview-controller.test.tsx` (bounded selection updates); extension API composer-context tests |
| Evidence-aware mutations / transcript has no timings | transcript planners and destructive-tool guard in `video-tools.ts` | `video-tools.test.ts` (continuous timed evidence required); `transcript-adapters-planner.test.ts` |
| Current composed proof / project changes after proof | proof provenance and invalidation in render/project services | `inspection.test.ts`; `video-tools.test.ts` (stale artifact withdrawn as current evidence) |
| Workspace synchronization / project switch during request | monotonic generations and project-load fencing in `controller.ts` | `webview-controller.test.tsx` (late project loads and startup events cannot overwrite current state) |
| Separate authority / Agent polls export | manifest approval classes and status/cancel tools | `video-tools.test.ts` (read-only status; mismatched cancel refusal); manifest/catalog tests |

## Media-intelligence scenarios

| Requirement / scenario | Authoritative implementation | Direct evidence |
| --- | --- | --- |
| Transcript adapters / no local transcriber | `engine/transcript-adapters.ts`; negotiated Host transcript path | `transcript-adapters-planner.test.ts`; `video-tools.test.ts` (actionable unavailable result) |
| Word/silence source mapping / repeated word removal | `engine/transcript-edit-planner.ts`; source/frame mapping | `transcript-adapters-planner.test.ts`; `timeline-state-operations.test.ts` |
| Editable captions / trim and speed | `engine/caption-builder.ts`; caption operations | `caption-builder.test.ts`; `subtitles-render-plan.test.ts` |
| Quota graph / source identity changes | `engine/derived-media.ts`; Host derived service | `derived-media.test.ts` (descendant invalidation and relink scoping) |
| Quota graph / quota exceeded | Same quota/LRU store | `derived-media.test.ts` (LRU/pinning); `video-tools.test.ts` (oversized result rejection) |
| Progressive visuals / long source during export | `engine/derived-media-jobs.ts`; priority scheduler | `derived-media.test.ts` (export priority, pause/resume, dedupe, cancel); `derived-media-service.test.ts` |
| Search source ranges / spoken match | `engine/media-search.ts` | `media-search.test.ts` (paged spoken results and transactional insertion) |
| Local attributable audio analysis / insufficient sync confidence | `engine/audio-analysis.ts`; Host analysis service/broker | `audio-analysis.test.ts`; `video-tools.test.ts` (qualified move and uncertain refusal) |
| Multicam coverage / angle not recording | `engine/multicam.ts`; `multicam-project.ts`; `multicam-render.ts` | `multicam.test.ts` (partial coverage clamp/refusal); `multicam-integration.test.ts` |

The audio-analysis requirement also names VAD/silence, speaker identity,
beat/downbeat, denoise metadata, and synchronization. Their cross-cutting
provenance, bounds, caching, and honest unavailable behavior are covered by
`audio-analysis.test.ts`, `kun-audio-analysis-broker.test.ts`,
`media-intelligence-host.test.ts`, and the analysis cases in
`video-tools.test.ts`.

## Render, interchange, and generation scenarios

| Requirement / scenario | Authoritative implementation | Direct evidence |
| --- | --- | --- |
| Canonical composed IR / preview and export same revision | `engine/render-ir.ts`; `render-plan.ts` | `render-ir.test.ts` (identical IR/backend semantics); `render-plan-ffmpeg.test.ts` |
| Visible unsupported nodes / missing font or effect | IR capability negotiation and Webview capability details | `render-ir.test.ts`; `webview-component.test.tsx` (affected-node guidance); packaged native optional-capability evidence |
| Bounded keyframes/effects / trim keyframes | `engine/keyframes.ts`; `effects.ts`; command operations | `keyframes.test.ts`; `effects-keyframe-operations.test.ts` |
| Durable atomic jobs / restart during export | Kun extension media job/artifact services; extension render tracking | Kun media job/process/artifact tests; `video-tools.test.ts` (reconcile/cancel/late completion) |
| Advanced codecs/interchange / feature loss | `engine/advanced-render.ts`; OTIO adapter/services | `advanced-render.test.ts`; `otio-interchange.test.ts` (bounded explicit loss manifest) |
| Self-contained project export / offline media | `engine/project-package.ts`; archive/export services | `project-package.test.ts` (fail versus explicitly incomplete policy) |
| Provider-neutral generation / multiple variants | `engine/generation.ts`; Host generation control plane | `generation-engine.test.ts`; `generation-host.test.ts` |
| Provider-neutral generation / unavailable | Same catalog/control plane | `generation-engine.test.ts`; `generation-host.test.ts`; `video-tools.test.ts` |
| Least-authority execution / path or network injection | Kun media brokers and strict extension Host schemas | Kun media process/job tests; `generation-host.test.ts`; `video-tools.test.ts` |

## Final command and package record

This section is intentionally completed last so it always describes the exact
working tree audited above.

| Gate | Final result |
| --- | --- |
| Documentation, schema, examples | Pending final source freeze |
| Extension typecheck/unit/component/integration/build/validate | Pending final source freeze |
| SDK and release gate | Pending final source freeze |
| Top-level typecheck/test/build and Kun build/test | Pending final source freeze |
| Deterministic bundled/release archive identity | Pending final source freeze |
| Packaged macOS arm64 layout/native/desktop smokes | Pending final source freeze |
| Windows/Linux native evidence | Not claimed locally; must be supplied by target CI before a multi-platform release claim |
