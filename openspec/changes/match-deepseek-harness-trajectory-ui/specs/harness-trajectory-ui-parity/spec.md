## ADDED Requirements

### Requirement: Frozen Harness geometry
Kun SHALL reproduce the frozen Harness trajectory toolbar, timeline, ledger, request boundary, inspector, and responsive geometry within one CSS pixel while retaining Kun semantic theme colors.

#### Scenario: Wide trajectory
- **WHEN** the trajectory center has desktop width
- **THEN** it renders a 32px toolbar, 50px timeline, 30px table header/records, dense Event/Content columns, and a docked 320–440px default inspector

#### Scenario: Narrow trajectory
- **WHEN** the table container crosses 620px or the center crosses 760px
- **THEN** type labels collapse to icons at 620px and the inspector becomes a right overlay no wider than 420px at 760px

### Requirement: Harness ledger projection
Kun SHALL project real request and Session data into System, User, Context, Compacted, Assistant, Tool, and Subtool cells with Turn rails, request boundaries, stable IDs, inline Tool results, and no duplicate request rows.

#### Scenario: Assistant tool step
- **WHEN** one model step emits reasoning/text and one or more tools
- **THEN** the ledger renders one Assistant followed by merged Tool lifecycles and associates the request-number boundary with that step

### Requirement: Harness timeline interaction
The timing overview SHALL support sequence and recorded-duration projections, TTFT/decoding segments, range selection, zoom, clear, pan, edge pan, delayed tooltips, turn boundaries, and synchronized record selection.

#### Scenario: Select timeline record
- **WHEN** a user clicks a timing span
- **THEN** any range selection clears, the matching ledger record scrolls into view, and its inspector opens

#### Scenario: Focus interval
- **WHEN** a user drags an inclusive interval
- **THEN** records outside the interval are visually de-emphasized without being removed from the ledger

### Requirement: Folding, search, and virtualization
Kun SHALL provide separate whole-ledger Turn and Assistant-call folding, local incremental loaded-window search, tail following, stable history prepend anchors, and Harness virtual row sizing above 100 logical records.

#### Scenario: Prepend history
- **WHEN** an older page is inserted before selected and visible records
- **THEN** semantic selection, row keys, inspector, and visible scroll anchor remain unchanged

### Requirement: Harness record inspector
Kun SHALL expose record-specific tabs and rich Markdown, JSON, Schema, source, image, Prompt Diff, usage, option, and timing presentation while preserving not-captured, truncated, evicted, interrupted, running, and error states.

#### Scenario: Inspect tool
- **WHEN** a Tool row with arguments, result, schema, timing, and images is selected
- **THEN** Summary, Payload, Result, Schema, and Timing tabs render only data belonging to that Tool/request relationship

#### Scenario: Inspect message Raw and Source
- **WHEN** a User, Context, Assistant, or Compacted row is inspected
- **THEN** Raw renders ordered content blocks without the Session-item envelope, Source renders only recorded producer provenance when available, and neither section exposes provider metadata, credential fields, or inline binary payloads

### Requirement: Floating composer integration
Trajectory mode SHALL keep Chat and Composer mounted, float the Composer over the full-height ledger, and reserve the measured Composer height plus 16px in ledger and inspector scrollers.

#### Scenario: Composer height changes
- **WHEN** the composer grows because of text, attachments, or controls
- **THEN** final trajectory rows and inspector content remain scrollable above the new composer edge

### Requirement: Compatible trajectory API
Kun SHALL return trajectory schema v2 on existing routes, accept existing filter/query parameters, normalize schema v1 responses in the renderer, and leave persistent trace files unchanged.

#### Scenario: Open legacy page
- **WHEN** the renderer receives a schema-v1 trajectory page
- **THEN** it converts available records into the v2 renderer model and marks unavailable parity fields without failing the conversation

### Requirement: Visual and behavioral evidence
The implementation SHALL include reference-derived unit coverage and deterministic Electron screenshots for wide/narrow, light/dark, empty/loading/running/error/history/long-list/inspector states.

#### Scenario: Default light comparison
- **WHEN** the fixed parity fixture is captured in the default light theme
- **THEN** masked pixel difference from the frozen reference is at most one percent and every fixed geometry assertion differs by at most one pixel
