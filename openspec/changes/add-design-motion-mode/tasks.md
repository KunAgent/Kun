## 1. Motion Model and Persistence

- [x] 1.1 Add versioned typed motion timelines, tracks, keyframes, easing, properties, operations, and guardrail constants.
- [x] 1.2 Implement immutable normalization, owning-frame resolution, track lookup, lifecycle pruning, and deterministic ID helpers.
- [x] 1.3 Extend canvas persistence with strict bounded motion parsing and legacy-compatible round-trip serialization.
- [x] 1.4 Preserve live motion mutations during asynchronous loaded-document merge and document synchronization.
- [x] 1.5 Implement the pure timeline/easing/spring evaluator and playback boundary calculations.

## 2. Document Mutation and Undo

- [x] 2.1 Extend canvas undo/redo changes with grouped motion before/after patches and motion-only history entries.
- [x] 2.2 Add CanvasShapeStore motion replacement/update APIs and atomic shape-plus-motion undo application.
- [x] 2.3 Prune deleted shape/subtree tracks in the same undoable transaction and prevent orphan tracks during document lifecycle changes.
- [x] 2.4 Add the transient Motion editor/playback store and reset it safely on document switches.
- [x] 2.5 Implement manual track/keyframe CRUD, timeline configuration, preset expansion, stagger, and Auto-key mutation helpers.

## 3. Canvas Preview Runtime

- [x] 3.1 Add non-destructive native SVG motion wrappers without replacing existing static shape transforms, filters, or opacity semantics.
- [x] 3.2 Add equivalent motion target wrappers for HTML, running-app, and SVG artifact frame containers.
- [x] 3.3 Implement RAF playback/scrub application, canvas-to-screen portal conversion, reset behavior, and once/loop/ping-pong transport.
- [x] 3.4 Disable conflicting canvas editing while playing and keep paused/scrubbed selection projection aligned.
- [x] 3.5 Coordinate outer Design Motion preview with the existing standalone SVG inner player.
- [x] 3.6 Publish bounded standalone SVG player state and commands through a transient shape-keyed bridge.

## 4. Motion Authoring UI

- [x] 4.1 Add a Design-only Motion toolbar toggle, active-frame resolution, and Select-tool handoff.
- [x] 4.2 Build the bottom Motion dock shell, shared bottom inset, transport, duration/rate/playback controls, Auto-key, and reduced-motion feedback.
- [x] 4.3 Build layer/property rows, timeline ruler, keyframe diamonds, selection, drag-to-retime, add/delete controls, and empty states.
- [x] 4.4 Add selected keyframe time/value/easing editing including cubic-bezier, hold, and spring options.
- [x] 4.5 Add Fade, Move, Scale, and Rotate preset controls with deterministic multi-selection stagger.
- [x] 4.6 Add inspector keyframe indicators and route supported inspector/canvas edits through Auto-key.
- [x] 4.7 Isolate timeline Delete, Space, and selection shortcuts from existing canvas shortcuts and validate dock accessibility labels.
- [x] 4.8 Show selected SVG internal animation as a separately labelled read-only preview lane with dedicated transport and clear container-Motion guidance.

## 5. Kun Motion Tools and Context

- [x] 5.1 Add bounded Design-only Kun motion mutation tool definitions and register them in the runtime tool catalog.
- [x] 5.2 Add renderer `motionOps` extraction, replay dispatch, validation, execution, errors, undo grouping, and operation journaling.
- [x] 5.3 Register Motion in the renderer design tool protocol and Design mode surface descriptions.
- [x] 5.4 Add bounded motion timeline/track summaries and stable IDs to the canvas snapshot and Design turn prompt.
- [x] 5.5 Update Design agent guidance to distinguish frame/layer Motion from standalone SVG animation and Prototype navigation.

## 6. Handoff, Accessibility, and Compatibility

- [x] 6.1 Include bounded motion summaries and reduced-motion notes in Design handoff/resource surfaces.
- [x] 6.2 Preserve existing Prototype playback, Code whiteboard, artifact portals, and standalone SVG playback when Motion mode is closed.
- [x] 6.3 Ensure reduced-motion preference prevents automatic playback while retaining editing and deterministic scrub/end-state inspection.

## 7. Verification

- [x] 7.1 Add model, persistence, normalization, evaluator, easing, spring, and playback-mode unit tests.
- [x] 7.2 Add mutation, preset, Auto-key, delete/prune, grouped undo/redo, and late-load merge tests.
- [x] 7.3 Add native/portal wrapper, toolbar, dock, inspector, keyboard isolation, and reduced-motion component/helper tests.
- [x] 7.4 Add Kun tool advertisement/schema/budget tests plus renderer replay, protocol, snapshot, prompt, and journal tests.
- [x] 7.5 Run focused Vitest suites, `npm run typecheck`, `npm run build:kun`, and `npm run build`; separate any baseline failures.
- [ ] 7.6 Run the Electron Design-mode smoke flow for authoring, scrubbing, playback modes, persistence, undo/redo, native/portal targets, UI scaling, and regressions.
- [x] 7.7 Add SVG player bridge and Motion dock regression tests, then rerun focused typecheck/lint/build validation.
