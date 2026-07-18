## ADDED Requirements

### Requirement: Kun Video Editor is a direct right-sidebar extension
The bundled Kun Video Editor manifest SHALL declare one primary `views.rightSidebar` editor View with a packaged icon. It SHALL NOT require a generic extension launcher, a full-page View, or a Composer action to enter the editor.

#### Scenario: Trusted video extension is discovered
- **WHEN** `kun-examples.kun-video-editor` is enabled and trusted for the active workspace
- **THEN** its packaged video icon and localized title SHALL appear directly in Code mode's vertical right rail and clicking it SHALL open the editor in an independent tab beside the main conversation

### Requirement: Docked editor remains a complete usable workbench
The video Webview SHALL provide project selection, player, timeline, media and transcript controls, inspector, captions, revision history, preview, render jobs, and export in a responsive docked layout. It MUST remain keyboard reachable and usable at the Host's minimum supported extension-panel width.

#### Scenario: Editor opens at the preferred docked width
- **WHEN** the video editor View opens in the right panel
- **THEN** its controls SHALL reflow into a bounded vertical workflow without horizontal page overflow or hiding the current project and revision

### Requirement: Docked editor follows Kun appearance settings
The video Webview SHALL apply Kun's current theme, text direction, and locale independently from project and job availability. It SHALL provide complete English and Simplified Chinese user-visible copy and SHALL react to Kun appearance changes while the panel remains open.

#### Scenario: Project loading fails during initialization
- **WHEN** Kun reports a Chinese locale and light theme but the first video project request fails
- **THEN** the editor SHALL still render its failure and recovery UI in Chinese with the light theme

#### Scenario: User changes Kun language while the editor is open
- **WHEN** the user changes Kun from English to Simplified Chinese or back
- **THEN** the open video editor SHALL update its labels and document language without recreating the View Session

### Requirement: Main conversation is the primary Agent surface
The docked video editor SHALL identify the main Kun conversation as the primary place to ask for Agent editing. The panel SHALL expose the active project and revision to the registered video tools and SHALL show bounded synchronization status instead of requiring a second embedded Agent prompt surface.

#### Scenario: User asks the main Agent to edit the open video
- **WHEN** the user selects a project in the video panel and asks the main Agent to modify it
- **THEN** the Agent SHALL be able to resolve the active project, read its current revision and script, invoke the existing video tools, and cause the open panel to refresh

### Requirement: Video package remains a public extension example
The migrated video editor SHALL continue to build, validate, test, and package only through documented Extension API surfaces. Its deterministic bundled archive and release fixtures SHALL use a new version identity and SHALL not be imported privately by Kun product code.

#### Scenario: Default bundle is rebuilt
- **WHEN** the repository builds bundled extensions
- **THEN** the catalog and `.kunx` archive SHALL contain the right-sidebar manifest, packaged icon, Host entry, Webview assets, and unchanged least-authority permission set under the new version

### Requirement: Real media editing is executable across supported FFmpeg versions
The video editor SHALL produce executable proof, preview, and H.264/AAC export plans for imported media. Duration arguments MUST use FFmpeg-supported values, media binding names MUST remain within the public API schema after repeated splits, crop and transform geometry MUST be valid, and an ordinary sequential timeline of at least 30 clips MUST remain within broker argument limits.

#### Scenario: User exports a heavily cut interview
- **WHEN** a supported video is split into at least 30 sequential timeline items and exported
- **THEN** the render SHALL complete to a playable media artifact without invalid duration, binding-name, crop, or filter-graph errors

#### Scenario: Optional caption rendering is unavailable
- **WHEN** the selected FFmpeg binary lacks the filter needed for burned captions
- **THEN** the editor SHALL report that capability before starting the render and SHALL offer a supported no-burn or sidecar workflow

### Requirement: Transcript import is a complete panel workflow
The docked editor SHALL let the user select and import SRT, WebVTT, and supported transcript JSON through the public native picker and bounded media text-read APIs. It SHALL show localized parsing and local-transcriber availability feedback and SHALL never require a user to type opaque asset identifiers or microsecond ranges manually for the normal workflow.

#### Scenario: User imports subtitles from the panel
- **WHEN** the user selects a valid SRT, VTT, or transcript JSON file
- **THEN** the editor SHALL import its segments, release the temporary media handle, display the resulting transcript, and allow caption generation

#### Scenario: Transcript input is invalid
- **WHEN** the selected text is oversized, non-UTF-8, or cannot be parsed
- **THEN** the editor SHALL preserve the current project and show an actionable error in Kun's current language

### Requirement: Player represents the edited timeline
The panel player SHALL map the project playhead to the correct timeline item, source asset, trimmed source time, playback speed, ordering, and cut boundary. It SHALL switch media leases as necessary and preview captions active at the current project time. A deterministic script projection SHALL be read-only unless a documented editable format is supported.

#### Scenario: User previews reordered and trimmed clips
- **WHEN** the playhead crosses between reordered clips with trims and speed changes
- **THEN** the player SHALL load the corresponding source asset and seek to the mapped source time rather than treating project time as raw media time

### Requirement: Project-scoped panel state never leaks across selections
Selecting, creating, or receiving an Agent-selected project SHALL make that project authoritative and SHALL clear or filter media leases, scripts, jobs, artifacts, and edit state owned by the previous project. Late asynchronous responses MUST NOT overwrite a newer selection. Undo and redo controls SHALL use authoritative Host capability flags.

#### Scenario: Agent changes the active project while the panel is open
- **WHEN** an Agent tool creates or selects another active project
- **THEN** the panel SHALL switch to that project, release stale media access, and ignore any late response for the previous project

#### Scenario: One stored project is corrupt
- **WHEN** project discovery encounters one unreadable project file
- **THEN** healthy projects SHALL remain selectable and the corrupt entry SHALL produce an isolated diagnostic

### Requirement: Result previews and artifacts are project aware
Preview, proof, render jobs, caption sidecars, and result-preview Views SHALL use the current project, requested caption mode, and actual contribution identity. Jobs and artifacts shown in the workbench MUST be filtered or labeled by project and SHALL remain recoverable after closing and reopening the panel.

#### Scenario: User requests a captioned proof
- **WHEN** the current project uses burned captions and the required capability is available
- **THEN** the proof frame SHALL include captions and the result-preview contribution SHALL open that artifact without rendering the entire editor workbench
