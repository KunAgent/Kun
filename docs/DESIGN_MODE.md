# Design mode (设计模式)

Design mode is a Design task type inside the **Code** (`chat`) workbench, alongside
the top-level **Work** workspace. It is an AI design workstation: you describe a UI, an agent produces a
single-file interactive artifact, a live canvas renders it, and you iterate — with
a first-class, two-way bridge to the coding agent that ships it.

> Implementation history lives in [`DESIGN_MODE_PLAN.md`](../DESIGN_MODE_PLAN.md)
> (the original plan) and the `feat(design): …` commits on `feature/design-mode`.

---

## 1. What it is

The loop:

1. Describe a design in the right pane (with a design-context form: brand color,
   tone, design-system preset, structured tokens).
2. The design agent writes **one self-contained HTML document** to a reserved path
   under `.kun-design/`.
3. The center **canvas** live-renders it (a `<webview>`, refreshed as the agent
   writes).
4. Iterate in place — each turn snapshots a new version.
5. Hand the approved design to the coding agent ("Implement in code"), which
   publishes a shared design system and opens a fresh code thread.

Product positioning:

| Mode | Primary job | Output |
|---|---|---|
| **Code** | Work against a real repository, edit files, run commands, review changes, and ship implementation. | Code diffs, plans, todos, reviews, runnable app changes. |
| **Design** | Turn requirements, references, or existing UI into visual direction before implementation. | UI drafts, interactive HTML prototypes, graph artifacts, exported prototypes, shared `DESIGN_SYSTEM.md`. |
| **Work** | Draft, edit, polish, and export office documents. | Document workspaces, inline completions/edits, `HTML / PDF / DOC / DOCX` exports. |

Design mode is therefore not a legacy painting shortcut. It is the design leg
of Kun's requirement -> design -> plan -> code -> verify loop, sharing the same
runtime, provider configuration, approvals, and thread mechanics as Code and
Work.

Positioning: this is the only one of the surveyed tools where design lives **inside
the coding-agent IDE** with an organic design↔code loop (see §11).

---

## 2. Architecture

Design mode renders inside the Code `Workbench`, alongside Work — `AppShell` only
forks `settings` vs `Workbench`, so no shell change was needed.

- **Route**: `AppRoute` gains `'design'`; `openDesign` / `ensureDesignThreadForWorkspace`
  / `createDesignThread` historically mirrored the internal `write` navigation actions
  (`chat-store-navigation-actions.ts`). The design thread is tracked in a thin
  registry (`design/design-thread-registry.ts`).
- **Tabs**: `WorkspaceModeTabs` renders Code / Work; the shared composer selects Code / Design task type.
- **Three panes** (`components/design/`):
  - `DesignSidebar` — mode tabs + artifact list (per-kind icons, version count,
    implement / delete / rename, provenance + drift badges) + "New design" / "New
    canvas".
  - `DesignCanvas` — the live canvas: preview / code (shiki-highlighted) / live
    (the real running app from code mode) views, viewport switch, device frame,
    light/dark background, export, reload. Early-returns `DesignGraphView` for
    `graph` artifacts.
  - `DesignAgentPanel` — the composer + a collapsible design-context form
    (brand-color picker, tone chips, design-system preset) + iterate/new/busy hint.
- **Store**: `design/design-workspace-store.ts` (thin zustand store) holds artifacts,
  active id, canvas/viewport state, the design context, settings-driven knobs, the
  error banner, and the design-system hash. It is the single owner of artifact
  mutations + on-disk persistence.

### File map

```
src/renderer/src/design/
  design-types.ts               DesignArtifact, DesignArtifactKind ('html'|'graph'),
                                DesignCanvasView, viewports, createDesignArtifactId
  design-context.ts             DesignContext, presets, craft baseline,
                                formatDesignContextLines / formatDesignSystemMarkdown,
                                hashDesignSystem
  design-turn-prompt.ts         buildDesignTurnPrompt / buildDesignFromCodePrompt /
                                buildDesignImageNodePrompt
  design-implement-prompt.ts    buildImplementDesignPrompt (design → code)
  design-graph.ts               node-canvas doc model + topo sort
  design-graph-run.ts           runDesignNode (node → agent turn → await output)
  design-artifact-persistence.ts  meta.json sidecars + reconstruct-from-disk
  design-workspace-store.ts     the store
src/renderer/src/components/design/
  DesignWorkspaceView / DesignSidebar / DesignCanvas / DesignAgentPanel / DesignGraphView
```

---

## 3. Artifact model & durability

A `DesignArtifact` = `{ id, kind, title, relativePath, createdAt, updatedAt,
versions[], implementedAt?, implementedThreadId?, implementedDesignSystemHash? }`.

- **On disk**: each artifact is a directory `.kun-design/<id>/`:
  - HTML artifacts: `v1.html`, `v2.html`, … (the latest is the current document).
  - Graph artifacts: `graph.json` (+ `<nodeId>.html` / `<nodeId>.png` node outputs).
  - `meta.json` — a sidecar mirroring the artifact's metadata.
  - HTML `meta.json` may include `prototypeLinks[]`, the outgoing planned flow
    transitions to other screen artifacts.
- **Durability**: the artifact list used to be in-memory only and was lost on reload.
  Now every mutation (`upsert` / `addVersion` / `markImplemented` / `rename`) writes
  `meta.json`, and on load `rehydrateArtifacts()` rebuilds the list from
  `window.kunGui.listWorkspaceDirectory('.kun-design')` — reading each `meta.json`,
  falling back to reconstructing from the on-disk files when a sidecar is missing.
  `removeArtifact` deletes the whole dir (`deleteWorkspaceEntry`) and a
  session-scoped `removedArtifactIds` guard stops a not-yet-flushed delete from
  resurfacing on the next mount.

---

## 4. The design loop

- `buildDesignTurnPrompt` produces the turn: write ONE standalone HTML document to
  the exact reserved path, build it incrementally (small skeleton then `edit` calls,
  every payload < ~4000 chars), finish with `</html>`. The design context + the craft
  baseline (§10) are appended.
- **Live canvas**: `DesignCanvas` watches the artifact file (`startWriteWorkspaceFileWatch`,
  with a retry while the file does not yet exist) and reloads the webview (not remount)
  once a complete document exists. The webview is used (not `srcdoc`/`blob`) because the
  parent CSP kills inline-script iframes; `authorizeWritePrototype` allow-lists the
  `file://` URL.
- **Iterate-in-place**: when an artifact is active, the next turn passes its current
  version as `basePath` ("read it first, apply ONLY the changes") instead of starting
  fresh; a new version is appended.

---

## 5. Design ↔ code integration (the moat)

This is what makes design mode "organic", not isolated:

1. **Implement in code** (`implementDesignInCode`) — publishes the shared design system
   to `.kun-design/DESIGN_SYSTEM.md`, builds an implement prompt, opens a **fresh code
   thread**, dispatches the turn, and records provenance (`markImplemented`).
2. **Shared design system** — `DESIGN_SYSTEM.md` is the single source of truth both the
   design agent and the code agent read; the design context is injected into both.
3. **Reverse-design** (`sendDesignFromCode`) — turn an existing UI file into an
   iterable HTML mockup (the inverse of implement), closing the round trip. Exposed
   from the file-preview panel ("Redesign").
4. **Requirement → design** (`exploreSddRequirementInDesign`) — a bridge from the SDD
   requirement flow into the design canvas.
5. **Unified preview** — the canvas `live` view shows the real running app served by
   code mode's dev server, so the design canvas and the real product share one surface.
6. **Bidirectional drift** — provenance is two-way:
   - **Design drift** (`updatedAt > implementedAt`) → ⟳ badge ("re-implement").
   - **Code drift** — `implementDesignInCode` snapshots a hash of the published
     `DESIGN_SYSTEM.md` onto the artifact; on load the store re-reads `DESIGN_SYSTEM.md`
     and compares, so an artifact implemented against an **older** shared design system
     shows a ⚠ badge. ✓ = in sync.

---

## 6. Node canvas (graph artifacts)

A `graph` artifact is a small design pipeline on a React Flow canvas
(`DesignGraphView`), persisted as `graph.json`.

- **Node kinds**:
  - `prompt` — carries text / context.
  - `design` — generates an HTML artifact at `.kun-design/<graphId>/<nodeId>.html`.
  - `image` — generates an image at `.kun-design/<graphId>/<nodeId>.png` (multimodal).
- **Execution engine** (`runDesignNode` + `runGraph`): **Run** topologically orders the
  nodes (Kahn; cycles are rejected), then runs each `design`/`image` node **in order** —
  collecting upstream nodes' text along incoming edges, dispatching one agent turn, and
  awaiting that node's output before the next. HTML nodes poll the file until it ends in
  `</html>`; image nodes poll the directory until the `.png` appears. Per-node status is
  live (running / done / error); design outputs preview inline (a docked webview panel),
  image outputs render inline (`readWorkspaceImage` → `<img>`).
- Minimap + grid background; hover-delete on nodes; empty-graph hint.

---

## 7. Settings

Design settings are a full slice (`AppSettingsV1.design`, `DesignSettingsV1`, ~20
fields: workspace root, brand/tone/preset, tokens (radius/density/font), model /
provider / reasoning effort, generation prompt, implement stack hint, inject-into-code,
publish-design-system, canvas defaults, live refresh, device frame, …). Rendered as a
multi-card settings tab.

> **Landmine — adding a design settings field touches 9 places** or settings-sync
> infinite-loops: `DesignSettingsV1` + the patch type, `defaultDesignSettings` /
> `normalizeDesignSettings` / `mergeDesignSettings`, the `.strict()`
> `designSettingsPatchSchema` (in `app-ipc-schemas.ts`), `index.ts applySettingsPatch`,
> `settings-utils.ts mergeSettings/coerceRendererSettings`, the store
> `loadDesignSettings`, and the UI. The `.strict()` belongs on the design sub-schema,
> not the top-level envelope.

---

## 8. Export

`design:export-prototype` (main IPC, mirrors `write:export`) exports the current
prototype to a standalone **HTML** file or a **PDF** (rendered via a hidden
`BrowserWindow` + `printToPDF`, reusing the internal Work export pipeline), through a native save
dialog that defaults to the artifact title. Buttons live on the canvas toolbar.

---

## 9. Built-in "design system & craft" skill

`src/main/skill-bundled.ts` seeds a built-in skill into `~/.kun/skills/design-system/`
on first launch (idempotent marker, mirrors `ensureBundledUiPlugins`). Its `SKILL.md`
carries design-system-first thinking and the anti-AI-slop craft baseline, so the agent
auto-gets design guidance (triggers on design prompts, or via `load_skill`). Honors
deletion; appears after the next runtime restart.

---

## 10. Design context, tokens & craft

- **Design context** = brand color, tone, design-system preset, structured tokens
  (radius / density / font), free-form guidelines. It is injected into the design turn,
  the implement turn, and the reverse-design turn.
- **14 presets** (shadcn / radix / material / iOS / fluent / ant / chakra / carbon /
  polaris / bootstrap / geist / brutalism / editorial / none).
- **Craft baseline** (`DESIGN_CRAFT_LINES`) — an anti-AI-slop rubric appended to every
  generation prompt: avoid cream/sand backgrounds, purple→blue gradients, bounce easing,
  nested cards, low-contrast gray-on-tint; verify contrast; provide a
  `prefers-reduced-motion` fallback; use a real type scale and one spacing scale.

---

## 11. Positioning vs reference projects

| Capability | Design mode | AI-CanvasPro | open-design | penpot |
|---|---|---|---|---|
| Paradigm | design mode **inside** a coding-agent IDE | multimodal generative node canvas | agent-native design app | vector design platform |
| Artifact | single-file HTML | text/image/video/audio/3D | web/mobile/decks/video | vector SVG/components |
| **Design ↔ code** | **strong, in-IDE loop** | none | hand-off to code agents | MCP + design-as-code |
| Design system / tokens | presets + structured tokens + `DESIGN_SYSTEM.md` | none | 150 `DESIGN.md` systems | first-class design tokens |
| Export | HTML / PDF | local save | HTML/PDF/PPTX/MP4 | SVG/CSS/HTML/JSON |
| Node canvas | prompt/design/image + run engine | mature (7 node types) | automation | none |
| Collaboration / MCP | — / deferred (§14) | — | parallel sessions | realtime / MCP |

The deliberate **moat** is design↔code; the deliberate **non-goals** are penpot's
vector editor and realtime collaboration (heavy, off the agent-native thesis).

---

## 12. Stitch alignment plan

Reference: [Stitch - Design with AI](https://stitch.withgoogle.com/) and Google
Labs' March 18, 2026 announcement describe Stitch as an AI-native infinite
software-design canvas for natural-language UI creation, project-wide design
agent reasoning, images/text/code as canvas context, Agent Manager parallel
directions, DESIGN.md import/export, instant prototype playback, voice critiques,
and MCP/developer-tool export.

Kun should align by strengthening the same workflow spine while keeping the
in-IDE design-to-code advantage:

1. **Canvas maturity first**: selection, lock/visibility, nudge, snap, grouping,
   resize, rotate, layer order, device frames, and keyboard handling must feel
   predictable before adding larger agent flows. Locked or hidden layers are
   non-editable across hit-test, marquee, inspector, delete/duplicate, drag, and
   keyboard nudge. Keyboard editing now includes group/ungroup, stable block
   layer ordering, and ancestor-root normalization for duplicate/delete. The
   inspector exposes multi-selection align and distribute controls backed by the
   same shape ops the design agent can call. Resize handles now use the same
   object/grid snap guides as move gestures, while only moving the dragged edge.
   Move snapping now ignores hidden layers and descendants of hidden parents, so
   invisible board content cannot create ghost alignment pulls.
   The layers panel now flattens the board into a predictable top-to-bottom tree,
   supports collapsing frame/group subtrees, and exposes explicit lock/visibility
   controls for screen readers and tooltips.
   Rectangle, ellipse, frame, and screen-frame creation now use the same snap
   guide system while preserving strict square/circle drawing when Shift is held.
   Arrow and line endpoints snap to grid/object guide positions during creation,
   while Shift keeps its independent angle-lock behavior.
   The zoom menu now exposes explicit grid and object-snap toggles, so users can
   inspect or draw freely without changing hidden state.
   The canvas now includes a minimap navigator that shows visible top-level
   board content, highlights selected layers, and recenters the viewport by
   click/drag for multi-screen and multi-direction boards.
   Text creation supports both click-to-edit and drag-to-size snapped note boxes
   so board text can act as first-class design context.
   Arrow/line point editing now supports vertex drag, midpoint insertion, and
   Option/Alt-click or double-click vertex deletion for path cleanup.
   Drag-created shapes, text boxes, screens, lines, and freehand strokes now
   record one undo entry using their final bounds/points, so redo restores the
   object the user actually drew instead of the pointer-down preview.
   Cmd/Ctrl+D now duplicates the editable selection roots as one selected block
   with a single undo/redo entry, matching the copy/paste and Alt/Option-drag
   interaction model; cloned frame subtrees now rewrite internal frame
   ownership so descendants point at the new frame, not the source.
   Shape copy/cut/paste now works for editable selection roots, preserves full
   subtrees, offsets repeat pastes, and keeps cut and paste undo/redo as single
   canvas changes; image paste remains the fallback when no shape clipboard
   exists.
   Freehand strokes are simplified on commit to preserve the drawn contour while
   keeping render/persistence/AI-snapshot payloads bounded.
   Rotation now has visible corner handles, undo grouping, and 15°/45° modifier
   snapping instead of relying on the inspector field alone. Spacebar pan is a
   true temporary hand tool and restores the previous drawing/editing tool on
   release; middle-mouse drag also temporarily routes to the hand tool for
   infinite-board navigation without changing the active drawing/editing tool.
   Alt/Option-drag duplicates the current editable selection only once the
   pointer really moves, drags the copy, and records duplicate+move as a single
   undoable canvas change. Shift-dragging an existing selection now locks
   movement to the dominant horizontal or vertical axis while preserving
   same-axis snapping.
   Shift/Cmd/Ctrl marquee selection adds hits to the existing selection instead
   of replacing it; Alt/Option marquee subtracts hits from the current
   selection. Marquee results are normalized to editable root layers so parent
   and child overlaps do not create mixed selections. Fit-all now frames
   visible board content, while fit-selection uses the same editable-root
   selection semantics as marquee/duplicate/delete.
2. **Infinite board as project memory**: the board is the source of visual
   context for screens, references, image slots, text notes, tokens, components,
   and generated variants. Agent snapshots should stay compact but preserve
   selected layers, nearby screens, and design-system bindings. Canvas snapshots
   now mark `selected`, `inView`, and `nearSelection` shapes and, when capped,
   prioritize those local-context layers before older/offscreen board content.
   Line/freehand vertices are sampled per shape with `pointsOmitted` reported so
   long annotations do not dominate the prompt.
3. **Parallel directions**: build on `variant-matrix`, `add-screens`, and
   multi-page mode to support named exploration branches ("directions") that can
   be generated, compared, accepted, or archived on the board. Multi-page runs
   now stamp their generated screens with a shared direction id/name and the
   design sidebar exposes those direction groups with persisted accept/archive
   controls. Archived directions move out of the main direction list into a
   restore-able archived section. The sidebar now exposes a comparison summary
   for active directions: screen coverage, prototype links, implemented count,
   shared screens, and per-direction unique screens. It can open a visual
   side-by-side compare overlay with one live HTML preview column per direction
   and synchronized switching for shared or partially covered screen names.
   Remaining work: pixel/style diff overlays plus richer archive filtering.
4. **Google-compatible DESIGN.md**: root `DESIGN.md` is the canonical public
   project theme. The Design canvas discovers and validates it, projects it as
   a deterministic specimen board, and maps compatible tokens into native
   canvas state. Kun-generated project handoff lives at
   `.kun-design/HANDOFF.md`; legacy `.kun-design/DESIGN.md` and
   `.kun-design/design-system.json` remain compatibility/migration inputs and
   never compete as theme sources. Per-artifact `DESIGN.md` files remain local
   implementation notes rather than project themes.
5. **Prototype playback**: HTML screen frames now persist planned
   `prototypeLinks[]` from the multi-page planner's `linksTo` metadata, render
   those links as a non-editing flow overlay on the board, and expose a Play
   overlay for stepping through generated screens from the selected frame.
   Generated HTML links whose `href` matches the planned flow are captured in
   Play mode and route to the target screen. Unknown local/relative prototype
   links are now captured as missing targets instead of letting the webview drift
   away; the player can seed the design rail with a request to create and wire
   the missing next screen. Remaining work: deeper stateful interaction capture
   for non-navigation controls.
6. **Voice and critique loop**: route voice input into the design rail and let
   the agent run a critique/repair pass against the selected screen, frame, or
   whole board. The canvas toolbar now exposes a local critique entry point:
   it runs the design-system lint pass against the current editable selection
   subtree (or the whole board when nothing is selected), stashes findings into
   the next canvas prompt, opens the design rail, and seeds a focused repair
   request. Voice input remains the next layer on top of that repair loop.
7. **MCP/developer-tool bridge**: ship the deferred design-artifacts MCP server
   once packaged-startup verification is available, then expose read-only
   artifact/design-system resources to coding tools.

---

## 13. Extension seams

The discriminated unions are designed so later phases **add a case**, never rewrite:
`DesignArtifactKind` (`'html' | 'graph'` — penpot is a future member),
`DesignCanvasView` (`'preview' | 'code' | 'live'`), `DesignGraphNodeKind`
(`'prompt' | 'design' | 'image'`). The canvas renderer and the turn builder branch on
these.

---

## 14. Deferred: MCP exposure (the plan)

Exposing design artifacts to agents over MCP is fully mapped but intentionally not
shipped — it touches `main/index.ts`'s startup child-process gating in ~6 sites (the
most startup-critical file) and cannot be verified without a packaged run. The plan:

1. Add read-only `/design/internal/list` + `/design/internal/read` to
   `ScheduleRuntime.handleInternalRequest` (`schedule-runtime.ts`); resolve the
   workspace server-side via `settings.write.activeWorkspaceRoot`; reuse the existing
   bearer-token auth.
2. Add `src/main/design-artifacts-mcp-server.ts` (mirror `claw-schedule-mcp-server.ts`)
   — a stdio MCP server proxying to those endpoints, registering `design_list_artifacts`
   / `design_read_artifact`.
3. Add `design-artifacts-mcp-node-entry.ts`; handle the launch flag in `main/index.ts`
   (generalize `runningClawScheduleMcpServer`'s 6 gate sites).
4. Inject the server into the Kun config in `kun-process.ts` (mirror
   `buildGuiScheduleKunMcpServer`), and package the entry via `package.json`.

---

## 15. Runtime-only behaviors to verify

Typecheck/lint/unit tests cover the code shape, not these (need a real `npm run dev`):

- Artifact rehydration (list survives reload), PDF export (hidden-window `printToPDF`).
- Node-canvas execution (sequential agent turns, live status), image nodes (the agent
  must land the generated image at the node path — `generate_image` writes to
  `.kun/images/` by default, so the node prompt asks it to copy to the reserved
  path; if it doesn't, the node shows an error rather than breaking).
- The built-in design skill activating (appears after a runtime restart).
- The code-drift ⚠ badge appearing after the shared design system changes.
