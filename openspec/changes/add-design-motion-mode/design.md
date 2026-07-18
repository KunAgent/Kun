## Context

The Design whiteboard persists one version-2 `CanvasDocument` and renders three different substrates: native SVG canvas shapes, HTML/running-app DOM portals, and SVG artifact portals with their own inner animation player. The existing undo stack only records shape patches, the persistence parser explicitly allowlists top-level fields, and the asynchronous document-load merge currently reconciles only live shape changes.

Existing animation support is not a Motion authoring model: standalone SVG artifacts use declarative SMIL, Prototype playback navigates between HTML screens, and generated HTML may contain opaque CSS animation. The new capability must preserve those paths while giving both the user and Kun one typed, seekable timeline source of truth.

Kun tools cannot synchronously inspect renderer Zustand state. They return durable structured output which the renderer replays and applies. Therefore motion reads must come from the bounded canvas snapshot included in the turn prompt, while mutations travel through dedicated renderer-applied operations.

## Goals / Non-Goals

**Goals:**

- Integrate a Figma-like Motion mode into the current Design canvas, selection, toolbar, inspector, persistence, undo, and agent workflows.
- Support per-frame timelines, typed tracks, keyframes, easing, presets, Auto-key, and deterministic once/loop/ping-pong playback.
- Preview native shapes and whole artifact/running-app frame containers without mutating persistent shapes on animation frames.
- Keep agent and manual edits on the same validated canonical model.
- Preserve legacy canvas documents and existing Prototype and standalone SVG animation behavior.

**Non-Goals:**

- Editing elements inside an HTML/running-app webview in the first release; an artifact frame is one motion target.
- Replacing Prototype navigation or implementing screen-to-screen Smart Animate.
- Replacing the inner SMIL/CSS timeline of a standalone SVG artifact.
- MP4, GIF, WebM, Lottie, or GSAP source export in this change.
- Treating CSS, GSAP source, or generated HTML as the editable timeline source of truth.

## Decisions

### 1. Store a versioned motion document at `CanvasDocument.motion`

`CanvasDocument` remains version 2. It gains an optional `motion` value with its own version:

```ts
type CanvasMotionDocument = {
  version: 1
  timelines: Record<string, CanvasMotionTimeline>
}

type CanvasMotionTimeline = {
  id: string
  frameId: string
  durationMs: number
  playback: 'once' | 'loop' | 'ping-pong'
  tracks: CanvasMotionTrack[]
}
```

A track has a stable ID, `targetShapeId`, supported property, `set | offset | scale` operation, numeric base value, optional delay/span, and sorted typed numeric keyframes. Easing is a tagged union for linear, ease-in/out/in-out, hold, cubic-bezier, and deterministic spring parameters.

Keeping motion at the document level avoids duplicating keyframes inside shapes, lets one frame own timing, and allows shape deletion/reparenting to maintain references transactionally. Keeping CanvasDocument at v2 avoids a broad coordinate migration; `motion.version` carries future motion migrations.

Alternative considered: one `motion.json` per artifact. This maps poorly to native shapes and root-canvas timelines and introduces a second persistence race. A later exporter can derive an artifact-local file from the canonical document.

### 2. Scope timelines by owning frame, with root fallback

The active timeline is the selected frame, the nearest owning ancestor frame of a selected shape, or the canvas root when no frame owns the selection. Ownership is resolved by walking `parentId`, not by trusting the denormalized `frameId` field, which is not updated by every reparent path.

Native descendants are normal layer targets. HTML, running-app, and SVG artifact frames are targetable as whole containers, but their inner DOM/vector elements are outside the first-release contract.

### 3. Separate persistent motion data from transient playback/editor state

Persistent timelines live in `useCanvasShapeStore.document.motion`. A new transient motion store holds whether the dock is open, active timeline/frame, playhead, direction, playing state, rate, Auto-key, timeline zoom, and selected track/keyframe IDs.

The transient store is reset on document change and never enters `canvas.json`. Playback updates only transient time and DOM preview nodes; it does not call `updateShape`, enqueue persistence, or add undo entries.

### 4. Use a pure evaluator plus substrate-specific motion wrappers

A pure evaluator maps `(motion document, timeline, target shape, time)` to a projection containing x/y/rotation/scale/opacity. It implements segment lookup, operation composition, cubic-bezier inversion, hold behavior, and a deterministic seekable spring curve.

`ShapeDispatcher` gains an outer motion wrapper around the existing static transform so preview transforms do not overwrite SVG presentation transforms. HTML, running-app, and SVG artifact overlays expose equivalent `data-canvas-motion-target` wrappers. A canvas playback controller applies relative transforms and absolute opacity through `requestAnimationFrame` and restores wrapper defaults on reset/exit.

During playback, editing handles and hit testing are disabled to avoid selecting stale static geometry. Paused/scrubbed selection can use evaluated projections. Portal translation is converted from canvas units using the current zoom.

Alternative considered: generated CSS keyframes or GSAP as runtime truth. Both make arbitrary seeking, typed editing, undo, and multi-substrate preview harder and create an additional source of truth. WAAPI/CSS may be added later as export or compositor adapters.

### 5. Compile presets into ordinary tracks

Fade, Move, Scale, and Rotate presets create the same tracks and keyframes as manual authoring. Multi-selection uses stable canvas paint order for deterministic stagger. Reapplying a preset replaces matching property tracks rather than appending duplicate effects.

This keeps the dock fully editable and makes agent-generated motion indistinguishable from manual motion.

### 6. Auto-key intercepts supported edits at the store boundary

When Motion mode and Auto-key are active at a non-zero playhead, supported x/y/rotation/opacity edits are converted into upserts on the active timeline and removed from the base shape patch. Scale remains motion-only because `CanvasShape` has no base scale field. At time zero or with Auto-key disabled, the existing static edit path remains unchanged.

One drag/resize gesture records one grouped motion change. Unsupported fields in the same patch still follow the normal canvas edit path. Editing while playback is running is disabled.

### 7. Extend canvas undo with a motion document patch

`CanvasChange` retains shape patches and adds an optional immutable `{ before, after }` motion patch. Grouped changes preserve the first motion `before` and final `after`; motion-only groups remain valid. Undo/redo applies both parts atomically and restores selection as today.

Shape deletion prunes tracks targeting the deleted subtree in the same change. Duplicate/paste may initially leave motion un-copied, but it must never create orphan tracks; copying motion can be added once clone paths expose a complete old-to-new ID map.

### 8. Strictly parse, normalize, and bound motion

The persistence allowlist gains a dedicated motion parser. It accepts only supported versions/properties/easing, finite numeric values, unique stable IDs, valid target/frame references, ordered unique timestamps, and bounded durations/counts. Initial limits are 100 timelines, 2,000 total tracks, 20,000 total keyframes, 256 keyframes per track, and 600,000 ms duration.

The live-vs-loaded document merge includes motion so late disk reads cannot overwrite a timeline authored during loading. Motion reducers are immutable because several board synchronization helpers shallow-copy top-level document fields.

### 9. Route Kun mutations through dedicated `motionOps`

Kun adds dedicated Design-only motion tools in a separate adapter. They return `motionOps`, not the existing `ops`, so motion requests cannot fall into `ShapeOpSchema` accidentally. The renderer tool replay path dispatches recognized `design_motion_*` blocks to `executeMotionOps` before general shape handling.

Motion operations are semantic and idempotent: timeline identity is frame ID, a manual track is frame + target + property, keyframes upsert by stable ID or timestamp, and deleting a missing item succeeds. One tool block is one undo group and one Canvas operation-journal entry. The existing durable ToolBlock replay guard prevents a remount from applying it twice.

The next Design prompt receives a bounded motion summary from `canvas-snapshot`; no synchronous inspect tool or canvas-path bridge is introduced.

### 10. Integrate the dock without obscuring existing canvas controls

The Design-only toolbar gets a Motion toggle which forces the Select tool and opens a collapsible bottom dock. The viewport defines one bottom UI inset used by the dock, Properties panel, zoom controls, and minimap. Timeline keyboard events are handled inside a `data-motion-timeline` boundary before canvas shortcuts, so Delete, Space, and Cmd/Ctrl+A do not mutate unrelated shapes.

The dock provides transport, duration/rate/playback mode, Auto-key, presets, layer/property rows, diamond keyframes, drag-to-retime, selected keyframe time/value/easing controls, and empty states. Inspector x/y/rotation/opacity controls receive keyframe indicators and use the same mutation adapter.

### 11. Respect reduced motion while preserving authored data

Operating-system reduced-motion disables automatic playback by default and allows immediate scrub/end-state inspection. It never deletes or rewrites motion data. Snapshot/handoff output includes bounded timeline summaries and explicitly carries reduced-motion guidance.

### 12. Bridge standalone SVG playback into the dock without importing its timeline

The SVG artifact overlay remains the owner of its SMIL/CSS player because it has the live iframe, sanitized source metadata, and Web Animations handles. It publishes a transient, bounded playback descriptor keyed by canvas shape ID and registers imperative play, pause, restart, seek, and rate commands. The Motion dock consumes that descriptor only for the currently selected SVG artifact.

The dock labels its editable area as `Container Motion` and renders the SVG descriptor as a separate `SVG internal animation` preview lane. This makes the two clocks visible together without copying generated animation elements into `CanvasDocument.motion`, inventing keyframes from CSS, or weakening the first-release source-of-truth boundary. The bridge is transient and is removed when the SVG portal unmounts; it never enters persistence, undo, snapshots, or Kun motion tools.

Alternative considered: automatically converting SMIL/CSS animation into Canvas Motion tracks. This would lose unsupported attribute/path/filter semantics, produce unstable target IDs, and misrepresent generated source as editable canonical data, so it remains out of scope.

## Risks / Trade-offs

- **[Mixed SVG and portal coordinate systems]** → Use equivalent wrapper contracts and centralized canvas-to-screen conversion; test zoom, resize, rotation, opacity, clipping, and nested frames.
- **[Nested absolute-coordinate frame transforms]** → Keep static shape transforms intact inside the motion wrapper and apply parent motion outside the existing counter-translation hierarchy.
- **[Selection geometry differs from preview]** → Disable editing while playing and use evaluator projections for paused selected targets.
- **[Undo memory grows with full motion snapshots]** → Enforce strict limits and store one immutable before/after document per gesture; a future patch-level timeline diff can optimize large files without changing the model.
- **[Late persistence load overwrites new motion]** → Extend the existing three-way merge and cover the race with a regression test.
- **[Agent output duplicates effects on replay]** → Use deterministic semantic IDs/upserts plus the existing renderer replay guard.
- **[Standalone SVG has an independent clock]** → Treat Design Motion as an outer container transform and pause or leave inner SVG playback independent; never merge its SMIL into the canvas timeline implicitly.
- **[Animated SVG looks like an empty Motion timeline]** → Publish bounded inner-player state to a clearly labelled read-only lane with dedicated controls and explain that presets animate the whole container.
- **[Bottom dock crowds small windows]** → Use a collapsible bounded-height dock and one shared bottom inset; validate dark mode and UI scaling.

## Migration Plan

1. Add optional version-1 motion parsing and empty defaults while preserving all version-1/version-2 canvas documents.
2. Add undo/document mutation primitives and lifecycle cleanup before exposing authoring UI.
3. Add evaluator, wrappers, playback controller, and regression tests.
4. Expose the Motion dock, presets, keyframe editing, Auto-key, and inspector indicators.
5. Add bounded prompt context and Kun motion mutation tools.
6. Rollback can remove the UI/tool advertisement while leaving the optional `motion` field ignored by older builds; existing shapes and artifacts remain intact.

## Open Questions

- Video export, inner HTML element targeting, motion styles/variables, animated components, and Prototype transitions are intentionally deferred to follow-up changes once the native timeline contract is proven.
