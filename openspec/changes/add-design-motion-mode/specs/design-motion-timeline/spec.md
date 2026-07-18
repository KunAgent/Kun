## ADDED Requirements

### Requirement: Motion mode is a first-class Design canvas mode
The Design canvas SHALL expose a Motion mode that opens a bottom timeline dock without replacing the current canvas, selection, layers, inspector, Prototype player, or standalone SVG animation workflow.

#### Scenario: Enter Motion mode for a selected frame
- **WHEN** a user selects a frame or a shape inside a frame and opens Motion mode
- **THEN** the timeline dock targets that frame, keeps the current canvas visible, and exposes its animated layers and property tracks

#### Scenario: Enter Motion mode without a frame selection
- **WHEN** a user opens Motion mode without a frame or framed shape selected
- **THEN** the dock targets the canvas root timeline and remains usable for selected top-level shapes

#### Scenario: Exit Motion mode
- **WHEN** a user closes Motion mode
- **THEN** playback stops, preview-only values are cleared, base canvas geometry is restored, and persisted timeline data remains available when Motion mode is reopened

### Requirement: Motion data has one canonical typed representation
The system SHALL store versioned motion data at the CanvasDocument level as per-frame timelines containing bounded typed property tracks and keyframes. Shape objects SHALL remain the source of base geometry and SHALL NOT contain duplicated per-keyframe state.

#### Scenario: Load a document without motion data
- **WHEN** a legacy or current canvas document has no motion field
- **THEN** it loads with an empty motion document and no visual or persistence regression

#### Scenario: Persist and reload valid motion
- **WHEN** a canvas document containing valid timelines is saved and reopened
- **THEN** timeline duration, playback mode, track targets, base values, operations, keyframe times, values, and easing are preserved

#### Scenario: Reject unsafe motion payloads
- **WHEN** persisted motion exceeds duration, timeline, track, keyframe, numeric, or reference validation limits
- **THEN** invalid motion is rejected or sanitized without accepting non-finite values or making the canvas document unusable

### Requirement: Users can author property tracks and keyframes
Motion mode SHALL support `x`, `y`, `rotation`, `scaleX`, `scaleY`, and `opacity` tracks with add, update, delete, select, drag-to-retime, and easing controls. A property SHALL have at most one manual track per target in a timeline.

#### Scenario: Add a property track
- **WHEN** one or more editable shapes are selected and the user adds a supported property
- **THEN** each eligible shape receives a track seeded with base and end keyframes and the new tracks appear beneath their layer rows

#### Scenario: Edit a keyframe
- **WHEN** a user changes a selected keyframe's time, value, or easing
- **THEN** the canonical track is updated, times remain clamped and ordered, and the preview reflects the change immediately

#### Scenario: Remove the final track
- **WHEN** a user removes the last track from a timeline
- **THEN** the empty timeline is removed or normalized without leaving stale playback state

### Requirement: Motion presets compile to editable tracks
The system SHALL provide Fade, Move, Scale, and Rotate presets that materialize as ordinary editable property tracks rather than hidden runtime effects.

#### Scenario: Apply a preset to selected layers
- **WHEN** a user applies a preset to selected editable shapes
- **THEN** the preset creates or replaces the corresponding tracks using the shapes' current base values and the resulting keyframes can be edited like manually created tracks

#### Scenario: Apply a staggered preset
- **WHEN** a preset is applied to multiple selected shapes with stagger enabled
- **THEN** each shape receives deterministic delay timing in canvas paint order while the timeline duration remains valid

### Requirement: Auto-key integrates with existing canvas edits
Motion mode SHALL offer Auto-key. While Auto-key is enabled at a non-zero playhead, supported property edits made through the canvas or inspector SHALL update keyframes in the active timeline as one undoable edit instead of permanently rewriting the base value for every playback frame.

#### Scenario: Record a property change at the playhead
- **WHEN** Auto-key is enabled, the playhead is after zero, and a selected shape's supported property is edited
- **THEN** a keyframe is created or updated at the current time and the base shape value remains unchanged

#### Scenario: Edit with Auto-key disabled
- **WHEN** Auto-key is disabled and a shape property is edited
- **THEN** the normal canvas edit path updates the base shape and any motion preview recomputes from the new base value

### Requirement: Playback and scrubbing are deterministic and non-destructive
The system SHALL provide play, pause, reset, direct scrub, duration, playback-rate, and once/loop/ping-pong controls. Preview evaluation SHALL be deterministic at an arbitrary timestamp and SHALL NOT persist 60-Hz shape updates.

#### Scenario: Scrub a timeline
- **WHEN** a user drags the playhead to a timestamp
- **THEN** supported properties are evaluated with the segment easing and displayed without changing the stored base shape values

#### Scenario: Complete each playback mode
- **WHEN** playback reaches a boundary in once, loop, or ping-pong mode
- **THEN** it respectively pauses at the boundary, wraps to the start, or reverses direction while keeping the playhead valid

#### Scenario: Preview native and portal frame targets
- **WHEN** motion targets a native canvas shape, HTML/SVG artifact frame container, or running-app frame container
- **THEN** the canvas previews the container's supported transform and opacity while preserving portal interaction and clipping behavior

### Requirement: Standalone SVG animation is visible but remains a separate clock
When a selected SVG artifact contains SMIL or CSS animation, Motion mode SHALL expose a bounded read-only summary and dedicated preview transport for that inner animation. The UI SHALL distinguish inner SVG playback from editable outer container Motion and SHALL NOT imply that generated SVG internals are canonical Canvas Motion tracks.

#### Scenario: Select an animated SVG artifact in Motion mode
- **WHEN** the selected SVG artifact reports one or more inner animations
- **THEN** the Motion dock identifies the animation count, duration, looping state, current time, rate, and offers play, pause, restart, and scrub controls

#### Scenario: Author outer Motion around an animated SVG
- **WHEN** an animated SVG artifact is selected and the user applies a Motion preset or adds a supported property
- **THEN** the resulting editable tracks target the whole SVG container while the inner animation remains visible as a separately labelled preview lane

#### Scenario: Inner SVG metadata is loading or unavailable
- **WHEN** the selected SVG preview has not finished inspection or contains no detectable animation
- **THEN** the dock shows an accurate inspecting or no-inner-animation state instead of presenting an unexplained empty timeline

### Requirement: Motion changes participate in persistence and undo
Timeline mutations SHALL use the canvas persistence coordinator and SHALL participate in the existing grouped undo/redo history together with shape mutations and selection restoration.

#### Scenario: Undo a keyframe drag
- **WHEN** a keyframe drag produces multiple pointer updates and the user invokes undo
- **THEN** the complete drag is reverted as one history entry and redo reapplies it

#### Scenario: Delete an animated shape
- **WHEN** a shape is deleted
- **THEN** tracks targeting the deleted shape are removed in the same undoable transaction and undo restores both the shape and its tracks

### Requirement: Motion is accessible and available to handoff
Motion preview and generated handoff SHALL respect reduced-motion preferences, and design context SHALL summarize timelines and animated targets for downstream agent and implementation workflows.

#### Scenario: Reduced motion is requested
- **WHEN** the operating system or preview control requests reduced motion
- **THEN** authored data remains editable while automatic playback is disabled or reduced to immediate end-state preview

#### Scenario: Build design context
- **WHEN** the active canvas contains motion timelines
- **THEN** the agent snapshot and design handoff identify timeline duration, playback mode, target names, properties, and keyframe counts without dumping unbounded raw data
