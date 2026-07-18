## ADDED Requirements

### Requirement: Video tools expose a compact stable control plane
The extension SHALL expose a bounded, cache-stable set of typed read, inspect, mutate, render, status, cancellation, and undo operations. Capability growth SHALL prefer typed operation variants and resource catalogs over one tool per UI control.

#### Scenario: A new effect parameter is added
- **WHEN** the extension adds a compatible effect to the render catalog
- **THEN** existing tool identities SHALL remain stable and the capability SHALL be discoverable without reordering unrelated tool schemas

### Requirement: Project and timeline reads are windowed and compact
Read operations SHALL return stable IDs, revision, sequences/tracks, requested frame windows, gaps, selected evidence, and only non-default clip fields, with bounded expansion for captions, words, effects, and keyframes.

#### Scenario: Agent reads one long captioned timeline region
- **WHEN** the Agent requests a bounded frame window without caption detail
- **THEN** the result SHALL summarize caption groups and hidden clip counts without emitting every caption or unrelated sequence item

### Requirement: Raw media and composed timeline inspection are distinct
The extension SHALL provide raw media inspection with sampled frames/storyboards, transcript and metadata, and composed timeline inspection with active layers, captions/text, transforms, crop, opacity, effects, keyframes, frame labels, and revision.

#### Scenario: Agent verifies picture-in-picture placement
- **WHEN** the Agent inspects the composed frame after a layout edit
- **THEN** the returned proof SHALL identify the visible clip IDs and show the post-transform composition rather than the unedited source frame

### Requirement: Selection context is explicit and revision-bound
The active project, sequence, playhead, selected clips, transcript words, and selected timeline range SHALL be represented as bounded workspace-scoped state that tools explicitly resolve at a project revision.

#### Scenario: User asks the main Agent to edit the selected range
- **WHEN** the sidebar selection changes and the Agent resolves current video context
- **THEN** the tool SHALL return the current selection and revision or an explicit stale/empty result without reading Webview DOM or injecting volatile state into the system prefix

### Requirement: Agent mutations require evidence and return receipts
The Agent profile SHALL read the current revision before mutation, use source/timing evidence honestly, apply one bounded transaction, consume its receipt, and refresh after a conflict or an invalidated index.

#### Scenario: Transcript lacks timings
- **WHEN** a destructive transcript edit is requested but usable word/segment times are absent
- **THEN** the Agent SHALL request transcription/import or user guidance and SHALL NOT infer destructive ranges from prose alone

### Requirement: Visual claims require current composed proof
Proof, preview, and inspection artifacts SHALL be bound to extension/version, workspace, project, sequence, revision, render IR digest, and capability report. Technical validation SHALL remain distinct from visual inspection.

#### Scenario: Project changes after proof generation
- **WHEN** any render-relevant project state commits after a proof is produced
- **THEN** the sidebar and Agent result SHALL mark that proof stale and SHALL NOT present it as evidence for the current revision

### Requirement: Workspace events synchronize Agent and sidebar safely
Project, selection, receipt, derived-media, analysis, proof, and job events SHALL be bounded, monotonic, workspace-scoped, and attributable. Late responses from an older project/selection generation SHALL not restore stale state.

#### Scenario: User switches projects while a request is in flight
- **WHEN** the older project's request completes after the new project is active
- **THEN** the sidebar SHALL ignore or isolate the late projection and keep the new project authoritative

### Requirement: Read, destructive, cost, and cancellation authority are separate
Read-only inspection/status SHALL not request destructive approval; source-changing edits, external output, remote upload/cost, and cancellation SHALL retain distinct declared side effects and user-facing consent.

#### Scenario: Agent polls an export
- **WHEN** the Agent reads an owned job status repeatedly
- **THEN** polling SHALL remain idempotent and approval-free while cancellation still requires its separate explicit operation
