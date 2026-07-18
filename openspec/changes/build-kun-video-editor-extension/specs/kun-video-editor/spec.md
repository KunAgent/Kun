## ADDED Requirements

### Requirement: The video editor ships as a valid Kun extension
The repository SHALL ship a runnable `kun-video-editor` `.kunx` package built only against documented Extension API surfaces. Its manifest MUST declare a Node `main` entry, a browser entry, one `views.rightSidebar` contribution for the editor, one namespaced video-editor Agent profile, every contributed video tool, the activation events for those contributions, and only the permissions required by those declared capabilities. The package SHALL NOT embed a multi-platform FFmpeg distribution.

#### Scenario: The extension package is validated
- **WHEN** the video editor is built and passed to the Kun extension validator and packager
- **THEN** its manifest, Node entry, browser entry, right-sidebar contribution, Agent profile, tool declarations, permissions, and packaged resources SHALL validate and produce an installable `.kunx`

#### Scenario: The user opens the editor
- **WHEN** the enabled extension's right-sidebar contribution is opened from its direct Code rail icon in a trusted workspace
- **THEN** Kun SHALL activate the extension, create an isolated View session, and render the video workbench without importing Kun renderer internals or exposing `window.kunGui`

### Requirement: The same standard package is Kun's local default and reference example
The repository SHALL keep `examples/extensions/kun-video-editor` as the canonical
source example and SHALL bundle the deterministic `.kunx` produced from that
source as Kun's default local video editor. Product packaging MUST place the
archive beside a bounded catalog containing its ID, version, file name, SHA-256,
engine range, API version, and exact permission set. Fresh-profile installation
MUST use the ordinary archive validator, compatibility admission, immutable
package store, registry transaction, state migration, permission snapshot, and
activation lifecycle. The product MUST NOT import example implementation code
into Kun or register its contributions through a private built-in path.

#### Scenario: A fresh Kun profile starts
- **WHEN** the bundled catalog and archive are valid and no video-editor registry entry or prior seed decision exists
- **THEN** Kun SHALL install, select, and globally enable the catalogued `.kunx` through the standard package manager and SHALL leave workspace trust and protected media grants to the normal user-controlled flow

#### Scenario: A standalone package is produced
- **WHEN** maintainers build the release `.kunx` and the product-bundled `.kunx` from the same commit and manifest version
- **THEN** both outputs SHALL pass normal validation and SHALL have identical deterministic archive bytes and SHA-256 identity

#### Scenario: The extension already belongs to the user
- **WHEN** the first bundled-seed pass finds a pre-existing installed or development registry entry
- **THEN** Kun SHALL classify that extension as user-managed and SHALL NOT replace, select, enable, disable, or alter its grants

#### Scenario: The user removes the seeded extension
- **WHEN** a previously seeded package or registry entry is absent on a later start
- **THEN** Kun SHALL retain a removal decision and SHALL NOT reinstall the extension on that or later application versions

#### Scenario: A safe bundled update is available
- **WHEN** a newer catalogued version requests the same permissions, the prior seeded archive fingerprint is still installed, and the prior seeded version remains selected without a development override
- **THEN** Kun SHALL install and select the newer version through the standard version-switch lifecycle while preserving global and workspace enablement decisions

#### Scenario: A bundled update conflicts with user control or trust
- **WHEN** a catalog would downgrade, reuse a version with different bytes, add or change permissions, replace a missing prior seed, override a development source, or supersede a manually selected version
- **THEN** Kun SHALL fail or retain the bundle as unselected according to the documented safe-update policy and SHALL NOT broaden permissions or overwrite the user's selection

### Requirement: The workbench provides a transcript-first editing surface
The right-sidebar View SHALL provide a media library, video or audio player, synchronized transcript, ordered multi-track timeline, caption controls, project revision controls, preview controls, Agent synchronization, and export-job status. The first release MUST support manual editing of talking-head, interview, and podcast projects without requiring an Agent run.

#### Scenario: A user edits without the Agent
- **WHEN** a user imports a supported recording and performs trim, split, delete, reorder, caption, or aspect-ratio operations in the right-sidebar View
- **THEN** the workbench SHALL apply those operations through the project service, refresh the player, transcript, and timeline from the resulting revision, and remain usable without creating an Agent thread

#### Scenario: No project is open
- **WHEN** the right-sidebar View opens without a selected project
- **THEN** it SHALL present project creation and protected media-import actions and SHALL NOT fabricate a timeline or attempt to scan the workspace automatically

### Requirement: Projects use a durable explicit media-editing model
Each project SHALL be persisted below `.kun-video/projects/<project-id>/` with a schema-versioned `project.json` as its authoritative state. The model MUST contain stable project identity and settings, an `assets` collection, ordered `tracks`, timeline `items`, timed `captions`, a monotonic `currentRevision`, and `revisions` containing parent revision, author kind, source operation, timestamp, and reversible change metadata. Assets MUST retain their probe metadata and a durable opaque media handle or workspace-relative reference; items MUST reference an asset and track and record source and timeline ranges; captions MUST retain stable identity, text, timing, and style or placement data.

#### Scenario: A project is reopened
- **WHEN** Kun reopens a compatible project after the View or application has been closed
- **THEN** the extension SHALL reconstruct the same assets, track order, item ranges, captions, settings, current revision, and undo history without relying on a previous Webview session or ephemeral media URL

#### Scenario: A project contains a dangling reference
- **WHEN** validation finds an item with a missing asset or track, an invalid caption range, a missing current revision, or an unsupported schema version
- **THEN** the extension SHALL refuse to mutate or render the invalid project, preserve the on-disk data, and return a structured diagnostic identifying the invalid field and supported recovery path

### Requirement: Timeline arithmetic is deterministic and validated
Project, item, caption, preview, and export placement SHALL use non-negative integer frames as the canonical timeline representation, while probed frame rates SHALL be stored as numerator and denominator values. Source metadata and transcript interchange SHALL retain bounded integer microseconds where supplied, but every applied edit MUST snap deterministically to project frames. Every committed item MUST have positive frame duration, an in-bounds source range, and valid referenced identities; every committed caption MUST have positive duration within the composed timeline. Derived ordering and output duration SHALL be deterministic for identical project data.

#### Scenario: An edit would exceed source bounds
- **WHEN** a manual or Agent operation requests a negative range, a zero-duration item, or an item end beyond the referenced asset duration
- **THEN** the whole operation SHALL fail validation without advancing the project revision or partially changing the timeline

#### Scenario: A frame rate is fractional
- **WHEN** an imported asset reports a rational rate such as `30000/1001`
- **THEN** frame-snapped edits and render arguments SHALL be derived from the stored rational rate rather than a rounded floating-point frame rate

### Requirement: Media import is probed before it enters a project
The extension SHALL import media only from a host-authorized selection or previously granted project asset and SHALL invoke `ffprobe` through the brokered media-executable service. A successful probe MUST record bounded machine-readable container and stream metadata including duration, stream kinds, codecs, dimensions, rational frame rate, sample rate, channel count, and rotation when present. File extensions or client-supplied metadata SHALL NOT be treated as proof that media is supported.

#### Scenario: A supported recording is imported
- **WHEN** the user selects a readable local recording with at least one usable audio or video stream and `ffprobe` completes successfully
- **THEN** the extension SHALL create a stable asset, persist normalized probe metadata, add the requested initial timeline items, and commit one project revision

#### Scenario: Probe finds no usable media
- **WHEN** `ffprobe` fails, times out, returns malformed data, or reports no supported audio or video stream
- **THEN** the import SHALL fail with a bounded diagnostic, no project item SHALL reference the candidate file, and the source file SHALL remain unchanged

#### Scenario: FFmpeg tooling is unavailable
- **WHEN** the host cannot discover an allowed `ffprobe` or `ffmpeg` executable
- **THEN** the editor SHALL remain open, identify the unavailable local capability and remediation, and disable only operations that require that executable rather than reporting a successful probe, preview, or export

### Requirement: Transcription is local, timed, and asset-addressable
The extension SHALL provide a transcription operation for project assets with audio using a configured local ASR backend. Transcription output MUST contain stable segment identities, source-asset time ranges, text, detected or selected language, and word-level time ranges when the backend provides them. The default MVP SHALL NOT upload media or transcript content to a remote transcription service, and an unavailable local backend MUST produce an explicit capability error rather than synthetic transcript text.

#### Scenario: A local transcription completes
- **WHEN** a project asset with audio is submitted to an available local ASR backend
- **THEN** the background operation SHALL persist validated timed segments against that asset, regenerate the current transcript projection, and report the project revision and transcription provenance

#### Scenario: The local transcriber is not installed
- **WHEN** transcription is requested without an available configured local ASR backend
- **THEN** the operation SHALL fail with a stable `transcriber_unavailable`-style outcome and SHALL NOT send the asset to a network destination or invent untimed text

### Requirement: timeline.md is a reviewable revision-bound projection
The extension SHALL generate `.kun-video/projects/<project-id>/timeline.md` deterministically from the authoritative project and asset transcripts. The document MUST identify the project ID and source revision and MUST include stable asset, item, segment or caption identities with source and timeline timecodes alongside the ordered spoken text. `timeline.md` SHALL be suitable for bounded Agent inspection but SHALL NOT become a second silently mutable source of project truth.

#### Scenario: A timeline projection is regenerated
- **WHEN** a committed edit changes item order, source ranges, captions, or transcript-visible content
- **THEN** the extension SHALL atomically regenerate `timeline.md` for the new revision so its identity, timecodes, and text agree with `project.json`

#### Scenario: A stale script is applied
- **WHEN** `video-apply-script` receives a projection or structured script based on a revision other than the project's current revision
- **THEN** it SHALL return a revision conflict and SHALL NOT reinterpret the stale timecodes against the newer timeline

#### Scenario: timeline.md is edited outside the extension
- **WHEN** the sidecar contents no longer match their recorded project revision or deterministic projection
- **THEN** the extension SHALL require explicit validation and application through the script operation and SHALL NOT silently overwrite `project.json` from arbitrary Markdown

### Requirement: The Agent profile exposes a bounded editing toolset
The manifest-declared video-editor profile SHALL use Kun's single Agent runtime and SHALL limit video work to the extension tools `video-project`, `video-probe`, `video-transcribe`, `video-read-script`, `video-apply-script`, `video-update-timeline`, `video-render`, `video-render-status`, and `video-render-cancel`. Tool inputs MUST use bounded project, asset, revision, item, preset, render, or job identifiers and structured edit operations; they SHALL NOT accept arbitrary absolute paths, shell command text, FFmpeg argument strings, or caller-selected extension identities. Read-only tools SHALL be declared as reads, while project mutation and render start SHALL declare write policy and render cancellation SHALL use its separate destructive tool.

#### Scenario: The Agent opens an existing project
- **WHEN** the profile calls `video-project` or `video-read-script` with a project ID in its granted workspace
- **THEN** the tool SHALL return a bounded schema-valid project or script projection including the current revision and SHALL NOT expose unrelated workspace files

#### Scenario: The Agent submits structured edits
- **WHEN** the profile calls `video-apply-script` or `video-update-timeline` with a current expected revision and valid structured operations
- **THEN** the tool SHALL apply the operations transactionally, return the new revision plus changed stable identities and a bounded summary, and preserve valid Kun tool-call history

#### Scenario: The Agent supplies command text as a media operation
- **WHEN** a video tool input contains an arbitrary executable path, shell fragment, or untyped FFmpeg switches instead of the declared structured schema
- **THEN** schema validation SHALL reject the invocation before any executable or project mutation is dispatched

### Requirement: Manual and Agent changes share one revision channel
The View, extension commands, and Agent tools SHALL read and mutate projects through the same revision-aware project service. Every mutation MUST provide the expected current revision and commit atomically as a new revision with `manual`, `agent`, or `system` provenance. The extension SHALL publish bounded project-change events so open Views refresh player, transcript, timeline, captions, and job affordances after either manual or Agent changes.

#### Scenario: An Agent edit completes while the View is open
- **WHEN** an Agent tool commits a new revision for the project displayed in a live right-sidebar View
- **THEN** the View SHALL receive the revision event and render the authoritative new project state without requiring a reload or maintaining a divergent Webview-only timeline

#### Scenario: Manual and Agent edits race
- **WHEN** a manual edit and an Agent edit both use the same expected revision and one commits first
- **THEN** the second edit SHALL receive a revision conflict with the new current revision and SHALL NOT overwrite, merge by guess, or partially apply over the first edit

#### Scenario: A user undoes an Agent edit
- **WHEN** the current revision contains reversible Agent-authored operations and the user invokes undo
- **THEN** the project service SHALL commit a new provenance-linked revision that reverses those operations while retaining the original revision in history

### Requirement: Transcript edits preserve source media and revision history
Deleting filler words, silence, repeated takes, or selected transcript ranges SHALL be represented as reversible timeline operations over asset source ranges. The extension MUST NOT rewrite or delete imported source media as part of an ordinary edit, and automatic filler or silence removal SHALL expose the detected ranges before or in the committed revision metadata.

#### Scenario: The Agent removes filler words
- **WHEN** a valid timed transcript identifies filler ranges and the Agent applies their removal at the current revision
- **THEN** the extension SHALL split or trim affected items deterministically, preserve unaffected source ranges and captions, and record the removed ranges in a reversible Agent-authored revision

#### Scenario: A transcript segment lacks usable timing
- **WHEN** a requested text-based deletion cannot be mapped unambiguously to timed asset ranges
- **THEN** the operation SHALL fail or request a more precise range and SHALL NOT guess a destructive cut from text order alone

### Requirement: Captions and social aspect ratios have deterministic output
The editor SHALL support editable caption entries, sidecar WebVTT or SRT export, optional burned-in captions, and the aspect-ratio presets `16:9`, `9:16`, and `1:1`. Composition settings MUST record output dimensions and an explicit fit, crop, or pad policy; the MVP default SHALL use deterministic geometry and SHALL NOT imply AI face tracking or automatic subject-aware reframing. Player preview, proof renders, and final export SHALL use the same revision-bound caption and composition settings.

#### Scenario: A project is changed to portrait
- **WHEN** the user selects `9:16` with a declared crop or pad policy
- **THEN** the workbench SHALL persist the composition change as a revision and preview and export SHALL derive identical output geometry from that setting

#### Scenario: Burned captions are exported
- **WHEN** a completed export requests burned captions and a sidecar subtitle file
- **THEN** caption text and timing from the selected project revision SHALL appear in the rendered video and the generated subtitle artifact with deterministic escaping and time ordering

### Requirement: Preview and proof are revision-bound and inspectable
The extension SHALL support player playback through protected media resources and SHALL generate bounded preview assets such as thumbnails, waveform data, selected proof frames, or a low-resolution proof clip through brokered media operations. Every generated proof MUST identify the project revision, time or range, composition preset, caption mode, generation status, and artifact identity. A project or render-setting change SHALL mark older proof as stale.

#### Scenario: A proof frame is generated
- **WHEN** a user or Agent requests a proof frame for a valid timeline time at the current revision
- **THEN** the extension SHALL return an inspectable image artifact and metadata that bind it to that exact revision, time, and composition rather than returning only an unverified success message

#### Scenario: A proof becomes stale
- **WHEN** the project advances beyond the revision used for an existing proof
- **THEN** the View and Agent tool result SHALL identify that proof as stale and SHALL NOT present it as evidence for the current timeline

#### Scenario: Proof generation fails
- **WHEN** FFmpeg exits unsuccessfully or the expected preview artifact cannot be validated
- **THEN** the operation SHALL report failure and SHALL NOT claim that the frame, captions, crop, or final composition was visually verified

### Requirement: Export uses cancellable background jobs
`video-render` SHALL start an extension-owned background export job rather than block an Agent tool invocation or Webview request for the render duration. Starting a job MUST pin the project revision, output preset, caption mode, and destination grant and MUST return a job ID promptly. Read-only `video-render-status` and the View SHALL expose persisted state, bounded progress and diagnostics, cancellation state, and exactly one terminal outcome. Destructive `video-render-cancel` SHALL be the only Agent tool that requests cancellation. Closing the View SHALL NOT by itself terminate an authorized export.

#### Scenario: An export starts
- **WHEN** a valid current project revision and output preset are submitted to `video-render`
- **THEN** the operation SHALL enqueue a background job, return its job ID and pinned render inputs, and emit progress independently of the initiating Agent or View request

#### Scenario: An export is cancelled
- **WHEN** an authorized user or owning Agent operation cancels an active export job
- **THEN** cancellation SHALL reach the brokered FFmpeg process tree, fence late success, remove or quarantine incomplete output, and persist one cancelled terminal outcome

#### Scenario: The View closes during export
- **WHEN** the right-sidebar View is disposed while its export job is running
- **THEN** the job SHALL remain queryable and continue under background-job policy until completion, explicit cancellation, or another defined terminal failure

### Requirement: Completed exports become verified generated artifacts
The default video export SHALL produce a broadly playable H.264 MP4 with configured audio handling, and the extension SHALL additionally produce audio-only or subtitle artifacts when a supported request selects them. Before an export job becomes completed, the extension MUST verify the output with `ffprobe`, confirm that required streams and a positive bounded duration exist, and register each surviving output through the generated-artifact contract with project ID, pinned revision, media type, size, duration, and safe open or reveal actions.

#### Scenario: A video export completes successfully
- **WHEN** FFmpeg exits successfully and output probing confirms the required video and configured audio streams for the pinned revision
- **THEN** the job SHALL complete with a validated video artifact that appears in Kun history and result preview and can be opened or revealed through host-controlled actions

#### Scenario: FFmpeg exits zero but output is invalid
- **WHEN** the expected output is missing, empty, outside the destination grant, or fails post-render stream validation
- **THEN** the job SHALL end as failed, SHALL NOT register a generated artifact, and SHALL retain only bounded safe diagnostics

### Requirement: All media paths and executable calls remain confined
Project files, imported working copies, transcripts, caches, previews, temporary filter data, and default exports SHALL resolve inside the active project's `.kun-video` workspace subtree unless the host has issued a protected destination grant. Every path crossing the extension boundary MUST be canonicalized and authorized against the authenticated workspace and extension principal. The extension SHALL reject traversal, absolute-path injection, symbolic-link escape, device files, foreign-workspace handles, expired grants, and source/output aliasing. Executables MUST be invoked with argument arrays through the media broker and MUST NOT use a shell.

#### Scenario: An Agent attempts path traversal
- **WHEN** a project, artifact, or tool request resolves through `..`, a symbolic link, or another encoding to a location outside the granted project or destination root
- **THEN** authorization SHALL reject the request before file access or process launch without disclosing unrelated path contents

#### Scenario: Export destination aliases an input
- **WHEN** canonical path resolution shows that an output or temporary file would overwrite an imported source asset
- **THEN** the export SHALL be rejected or assigned a distinct host-approved output and the original asset SHALL remain unchanged

#### Scenario: A media file was selected outside the workspace
- **WHEN** the protected import picker grants a readable external source
- **THEN** the extension SHALL create an authorized project working copy or host-managed durable import reference according to policy and SHALL NOT persist an unrestricted raw path for later Agent use

### Requirement: Product language stays within the implemented MVP
The manifest, Agent profile instructions, tool descriptions, UI, and results SHALL describe the first release as local transcript-oriented editing for talking-head, interview, and podcast material. They MUST identify arbitrary visual-scene understanding, stock search, generative B-roll, AI video or image generation, motion graphics generation, face tracking, and subject-aware automatic reframing as unsupported unless a later separately granted capability actually implements them. The Agent SHALL NOT infer unseen visual events or report that it inspected a render merely because a command succeeded.

#### Scenario: A user requests semantic visual montage editing
- **WHEN** the MVP is asked to find arbitrary visual actions, generate matching B-roll, or track a subject using capabilities it does not provide
- **THEN** the Agent and View SHALL state the relevant limitation, offer only supported transcript, timing, caption, composition, or proof-frame operations, and SHALL NOT make destructive cuts based on invented visual analysis

#### Scenario: A render has only machine validation
- **WHEN** an export has passed process and `ffprobe` validation but no current proof artifact was inspected by a user or vision-capable model
- **THEN** the result SHALL distinguish its completed technical validation from visual review and SHALL NOT claim visual quality, correct subject framing, or visual inspection

### Requirement: Core editing and rendering operate headlessly
The Node entry, project service, Agent profile, tools, transcription adapter, proof generation, and background export SHALL operate under `kun serve` or supported CLI execution without Electron or a Webview when all required project IDs and grants already exist. Headless operation MUST preserve the same revision conflicts, permissions, approvals, job persistence, cancellation, path confinement, and artifact validation used by the desktop app and MUST NOT auto-approve missing user interaction.

#### Scenario: A headless Agent renders an existing project
- **WHEN** `kun serve` runs the enabled profile with a valid workspace, current project revision, available local executables, and pre-authorized output destination
- **THEN** it SHALL start, observe, and complete or cancel the export through the same project, ToolHost, job, media, and artifact contracts without creating an Electron renderer

#### Scenario: A headless operation requires a picker
- **WHEN** a headless run requests import or export without a pre-existing host grant and the operation requires protected user selection
- **THEN** the operation SHALL return an interaction-required gate or structured failure and SHALL NOT choose a path, broaden workspace access, or synthesize approval

### Requirement: Automated coverage proves the extension workflow
The extension SHALL include deterministic unit, integration, contract, and package smoke coverage. Tests MUST cover manifest validation, project schema and migration rejection, time arithmetic, transcript-to-timeline edits, revision conflicts and undo, manual/Agent event synchronization, subtitle and aspect-ratio arguments, path and symlink escape rejection, proof staleness, background progress and cancellation, post-export probing, generated artifacts, headless execution, and stable failure when local media or transcription executables are absent. Test fixtures SHALL NOT require a remote generative or transcription service.

#### Scenario: Extension CI runs with deterministic fakes
- **WHEN** CI invokes the extension test harness with fake media, ASR, job, and artifact services
- **THEN** it SHALL exercise successful and failing tool and View contracts, cancellation races, revision conflicts, and security boundaries with schema-valid deterministic results

#### Scenario: Supported-platform package smoke runs
- **WHEN** release validation runs on supported macOS, Windows, and Linux environments
- **THEN** it SHALL build, validate, pack, install, activate, and remove the `.kunx`, open or headlessly invoke its declared contributions as applicable, and verify a small local fixture export where the platform media executable is available
