## ADDED Requirements

### Requirement: Kun exposes a bounded Design motion tool
Kun SHALL advertise a structured `design_motion` tool only in GUI Design canvas turns. The tool SHALL support setting timeline properties, applying presets, upserting tracks or keyframes, and removing tracks or timelines through renderer-applied operations.

#### Scenario: Tool is advertised in Design mode
- **WHEN** a Kun turn has both GUI canvas and Design mode context
- **THEN** `design_motion` is advertised with canonical property, easing, timing, target, and preset schemas

#### Scenario: Tool is hidden outside Design mode
- **WHEN** a Kun turn is not attached to the GUI Design canvas
- **THEN** `design_motion` is not advertised

### Requirement: Agent motion edits share the manual source of truth
Agent-authored motion operations SHALL pass through the same validation, mutation, persistence, undo, and preview paths as Motion dock edits and SHALL NOT generate a second CSS, GSAP, or HTML-only timeline source.

#### Scenario: Apply an agent preset
- **WHEN** `design_motion` applies a valid preset to shape IDs from the current snapshot
- **THEN** editable canonical tracks appear in the Motion dock and the change is persisted as one operation batch

#### Scenario: Upsert a keyframe
- **WHEN** `design_motion` provides a valid timeline, target, property, timestamp, typed value, and easing
- **THEN** the renderer creates or updates the matching keyframe and previews the same result as a manual edit

### Requirement: Agent motion operations are validated and journaled
The renderer SHALL validate target existence, frame scope, supported properties, finite values, duration bounds, track limits, and keyframe limits before applying agent motion operations. Applied or partially applied batches SHALL produce operation-journal results with affected IDs and actionable errors.

#### Scenario: Agent references an unknown shape
- **WHEN** a motion operation targets a shape ID not present in the active canvas snapshot
- **THEN** that operation is rejected with available-target guidance and no stale track is persisted

#### Scenario: Agent sends an oversized batch
- **WHEN** a motion tool request exceeds its operation, track, keyframe, argument-byte, or duration limits
- **THEN** the request is rejected before mutation with a bounded structured error

#### Scenario: Successful agent edit is replayed
- **WHEN** the same durable tool block is encountered again through SSE replay or renderer remount
- **THEN** existing canvas replay guards prevent duplicate motion mutations and journal entries

### Requirement: Motion context is visible to subsequent agent turns
The Design turn prompt SHALL include a bounded summary of active motion timelines so the agent can edit existing motion by stable frame, shape, track, and keyframe IDs.

#### Scenario: Continue editing existing motion
- **WHEN** a later Design turn begins after motion has been authored
- **THEN** the prompt includes enough stable identifiers and timing summaries to update existing tracks without recreating the timeline blindly
