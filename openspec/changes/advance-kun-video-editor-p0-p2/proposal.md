## Why

Kun Video Editor currently proves the Extension API, protected-media, revision, Agent-tool, and durable-job surfaces, but its Webview is not usable at the Host's real 280–760 px right-sidebar widths and its editing, inspection, media-analysis, and render capabilities remain far behind a practical Agent-assisted editor. The bundled extension should become a genuinely useful transcript-first video workbench while continuing to serve as the canonical third-party `.kunx` example rather than gaining private product APIs.

## What Changes

- Replace the desktop-style multi-column Webview with a responsive right-sidebar workbench whose empty, loading, project, editing, and job states remain actionable from 280 through 760 px and follow Kun locale, theme, focus, and accessibility settings.
- Extend the frame-native project model from one simple timeline to durable sequences, linked media, edit receipts, selection context, richer captions, keyframes/effects, derived media, and schema migrations without invalidating existing projects.
- Make manual UI edits and main-Agent edits use one revision-checked video command service with compact reads, structured mutation deltas, Agent-owned undo, inspect-before-edit evidence, and composed proof verification.
- Add transcript-first local workflows: provider-neutral local ASR, word timestamps, silence/filler operations, caption building, waveform/filmstrip generation, and media relink/recovery.
- Add professional editing behavior in bounded stages: spatial timeline drag/trim/split, zoom, snapping, ripple/overwrite, A/V linking, fades, nested sequences, and keyframed visual/audio properties.
- Add bounded media intelligence and advanced workflows: spoken/moment search, VAD/speaker/beat analysis, audio sync, multicam, color/effects, project interchange, and provider-neutral generation/upscale jobs.
- Unify proxy/proof/preview/export around a renderer-neutral timeline IR, with revision-pinned durable jobs, cache quotas/invalidation, atomic output, and technically and visually distinguishable verification.
- Preserve opaque media handles, workspace isolation, least-authority permissions, approval separation, deterministic `.kunx` packaging, and the rule that extensions receive no private renderer, Electron IPC, raw path, token, or DOM access.

## Capabilities

### New Capabilities

- `kun-video-sidebar-workbench`: Responsive, localized, accessible right-sidebar navigation and editing UX for empty and active projects.
- `kun-video-editing-domain`: Versioned project/sequences, shared transactional editing commands, timeline semantics, mutation receipts, undo, migrations, and recovery.
- `kun-video-agent-verification`: Main-Agent project/selection coordination, bounded inspect/search tools, evidence-aware mutations, proof verification, and workspace-scoped events.
- `kun-video-media-intelligence`: Local transcript, captions, waveforms/filmstrips, derived cache/proxy, spoken/moment search, audio analysis, sync, and multicam inputs.
- `kun-video-render-interchange-generation`: Shared render IR, proof/preview/export jobs, effects/keyframes, advanced codecs/interchange, and provider-neutral generation/upscale orchestration.

### Modified Capabilities

None. The repository currently has no archived baseline specs under `openspec/specs`; this change supersedes the completed change-local video-editor requirements with explicit P0–P2 contracts.

## Impact

- Bundled/reference extension: `examples/extensions/kun-video-editor` engine, Host entry, Agent tool contracts, Webview, localization, tests, docs, and package identity.
- Public Extension API where generic capabilities are required: bounded selection/context contribution, derived-media/cache jobs, media analysis, artifacts, and any additional right-sidebar accessibility hooks.
- Kun runtime and Electron Main only for generic brokered media/job executors; no video-editor-specific private import path.
- Renderer contribution discovery and right-panel layout tests, while retaining Host-owned dimensions and View Session isolation.
- Release gates, fixtures, deterministic package catalog, native packaged smoke coverage, and migration/recovery documentation.
