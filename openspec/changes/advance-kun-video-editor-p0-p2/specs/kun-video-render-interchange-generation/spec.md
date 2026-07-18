## ADDED Requirements

### Requirement: A canonical render IR defines composed output
The engine SHALL compile a validated project sequence and revision into a canonical bounded render IR covering source maps, layer order, canvas/color, transforms, crop, opacity, fades, text/captions, audio mix, nested sequences, effects, keyframes, and output range.

#### Scenario: Preview and export compile the same revision
- **WHEN** composed preview and final export target the same sequence, revision, range, and capability set
- **THEN** their render IR digests and render-relevant semantics SHALL match even when their resolution/bitrate differ

### Requirement: Unsupported render nodes fail visibly
Render backends SHALL negotiate codecs, filters, effects, color modes, fonts, hardware acceleration, and limits before execution. Unsupported required nodes SHALL produce actionable validation instead of being silently ignored or flattened.

#### Scenario: Backend lacks a required caption font or effect
- **WHEN** the IR contains a required node the selected backend cannot render
- **THEN** proof/export SHALL refuse or use an explicitly user-approved fallback and SHALL identify the affected node

### Requirement: Visual and audio properties support bounded keyframes and effects
The project and IR SHALL represent interpolated position, scale, rotation, crop, opacity, volume, effect parameters, text animation, blend/color/effect nodes, and fades with deterministic sampling and schema limits.

#### Scenario: Keyframes are trimmed with a clip
- **WHEN** a clip in/out edit removes part of its visible range
- **THEN** keyframes SHALL be clamped/remapped according to the declared property policy and the receipt SHALL report dropped or synthesized boundary values

### Requirement: Render jobs are durable, owned, atomic, and cancellable
Proof, preview, audio, subtitle, video, interchange, and project-package jobs SHALL be owned by extension/version/workspace/project/sequence/revision and idempotency key, report monotonic progress, fence terminal state, stage all outputs, and atomically promote or roll them back.

#### Scenario: Kun restarts during export
- **WHEN** a non-resumable native process is interrupted by shutdown
- **THEN** the job SHALL reconcile to interrupted, incomplete staging output SHALL not become a valid artifact, and an explicit retry SHALL create or reuse an idempotent safe attempt

### Requirement: Export supports advanced codecs and interchange by capability
The editor SHALL negotiate H.264, H.265, ProRes or portable equivalents, audio/subtitle outputs, resolution/frame-rate/quality settings, and at least one professional timeline interchange adapter after the richer editing model is representable.

#### Scenario: Interchange cannot preserve a project feature
- **WHEN** the target format lacks an equivalent for an effect, nest, caption, or keyframe
- **THEN** export SHALL report a bounded loss/warning manifest and SHALL not claim a lossless round trip

### Requirement: Self-contained project export preserves provenance
A project-package export SHALL snapshot every sequence, project schema, media manifest, chat/Agent receipts as configured, generation lineage, and selected source media with deduplication, missing-media reporting, and atomic completion.

#### Scenario: One external media source is offline
- **WHEN** the user requests a self-contained package with that source unavailable
- **THEN** the job SHALL fail or produce an explicitly incomplete package according to the selected policy and SHALL identify the missing media ID without leaking paths

### Requirement: Generation and upscale use provider-neutral recoverable jobs
Generation adapters SHALL advertise models/capabilities and accept bounded video/image/audio/upscale requests with explicit provider permission, cost/approval, idempotency, references, and output policy. The project SHALL create durable placeholder assets with complete lineage before remote or local work starts.

#### Scenario: Generation returns multiple variants
- **WHEN** an owned generation job completes with more than one valid output
- **THEN** the primary output SHALL replace or resolve the placeholder according to the request, additional variants SHALL enter the media library, and every asset SHALL retain prompt/model/reference/job lineage

#### Scenario: Generation is unavailable
- **WHEN** no permitted provider supports the requested constraints
- **THEN** editing/export SHALL remain available and the request SHALL return a capability/cost/provider result without creating a fake asset

### Requirement: Media execution remains brokered and least-authority
Render and generation orchestration SHALL not expose absolute paths, reusable media URLs, secrets, arbitrary shell, or unrestricted network protocols to the Webview or Agent. Every external upload SHALL be explicit, bounded, and attributable.

#### Scenario: An extension argument attempts path or network injection
- **WHEN** a media job contains an absolute/path-like argument, unsupported protocol, path-loading filter, or undeclared output
- **THEN** the broker SHALL reject it before process launch and record a bounded diagnostic without including sensitive canonical values
