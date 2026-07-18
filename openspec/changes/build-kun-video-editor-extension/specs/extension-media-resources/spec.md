## ADDED Requirements

### Requirement: Media capabilities use explicit least-privilege permissions
Kun SHALL expose media access through the manifest permissions `media.read`, `media.process`, and `media.export`. `media.read` SHALL authorize reading only Host-granted media handles, `media.process` SHALL authorize only the brokered `ffprobe` and `ffmpeg` operations defined by this capability, and `media.export` SHALL authorize writing only to Host-granted export targets. Every media operation MUST also enforce current extension identity, exact extension version, workspace enablement and trust, the applicable `workspace.read` or `workspace.write` grant, and any stricter ApprovalGate or user policy at use time.

#### Scenario: Extension requests processing without permission
- **WHEN** an extension without `media.process` calls `context.media.probe` or `context.media.startFfmpegJob`
- **THEN** Kun SHALL reject the call with a stable permission-denied result before discovering or starting an executable

#### Scenario: Permission is revoked after a resource was granted
- **WHEN** a media handle or export target was created while its permissions were valid but an applicable permission or workspace trust grant is later revoked
- **THEN** the next operation using that resource SHALL fail and SHALL NOT treat the earlier grant as continuing authorization

### Requirement: File selection is owned by a protected Host surface
`context.media.pickFiles` and `context.media.pickSaveTarget` SHALL run only through an Electron Main or core-owned protected picker that does not mount extension Webviews, execute host content scripts, render extension-supplied HTML, or expose a raw consent token to the extension. Extension-provided filters and suggested names MUST be schema-valid, bounded hints rather than authorization. A successful import selection SHALL return bounded metadata and opaque media handles; a successful save selection SHALL return an opaque export-target handle. Neither API SHALL disclose an absolute filesystem path to a Webview.

#### Scenario: User selects media files
- **WHEN** an eligible interactive extension request invokes `context.media.pickFiles` and the user confirms files allowed by current policy
- **THEN** Kun SHALL canonicalize the selections, place or confirm them within the active workspace policy, and return only bounded metadata plus opaque handles scoped to the caller

#### Scenario: User cancels a protected picker
- **WHEN** the user dismisses a file or save-target picker without choosing a target
- **THEN** Kun SHALL return a documented cancellation outcome and SHALL NOT create a media handle, export grant, or partial destination file

#### Scenario: Extension attempts to forge a selection
- **WHEN** an extension supplies an absolute path, a forged picker result, or a replayed protected-operation credential instead of completing the Host picker
- **THEN** Kun SHALL reject the request without reading, creating, truncating, or revealing the referenced file

### Requirement: Media handles are opaque and workspace confined
Kun SHALL represent selected inputs and export targets as unguessable opaque handles bound to the owning extension ID, exact extension version, active workspace scope, canonical file identity, access mode, and current grant snapshot. The media APIs MUST NOT accept an absolute path, `file:` URL, traversal segment, symbolic-link escape, device path, network share outside policy, or another extension's handle as a substitute. If a selected import originates outside the active workspace, Kun MUST either copy it into a Host-approved workspace import location or retain it as a Host-managed durable file reference bound only to the opaque handle and explicit selection grant; it SHALL NOT expose the source path or convert it into an ambient workspace grant.

#### Scenario: Caller uses a handle in another workspace
- **WHEN** an extension presents a valid handle after switching to a different workspace or from a run narrowed to a different workspace scope
- **THEN** Kun SHALL return an opaque scope-denied or not-found result without revealing the original workspace or filesystem path

#### Scenario: Canonical path escapes through a symbolic link
- **WHEN** selection, stat, probe, playback, or export resolution canonicalizes outside the granted workspace root through traversal, a symbolic link, or path replacement
- **THEN** Kun SHALL fail closed before opening the escaped resource

#### Scenario: Extension inspects media metadata
- **WHEN** the owner calls `context.media.stat` with a valid readable media handle
- **THEN** Kun SHALL return only the documented bounded metadata, such as media type, byte length, display name, modification identity, and workspace-relative display location, without returning an absolute path

### Requirement: Views receive opaque media-resource URLs
`context.media.openViewResource` SHALL exchange a readable media handle for a short-lived, unguessable media-resource URL. The URL MUST be bound to the owning extension ID and version, contribution, workspace, sender WebContents and main frame, authenticated View Session, underlying file identity, expiry, and permitted read mode. The URL SHALL contain no absolute path or reusable runtime credential, SHALL NOT enumerate adjacent files or handles, and SHALL be unusable as a general Node, renderer, or browser network endpoint.

#### Scenario: Bound View opens its media resource
- **WHEN** an authenticated View Session calls `context.media.openViewResource` for its own readable handle and loads the returned URL before expiry
- **THEN** Kun SHALL stream only that bound resource with a validated media type and no filesystem-path disclosure

#### Scenario: Another sender reuses a copied URL
- **WHEN** another extension, contribution, WebContents, frame, workspace, or stale View Session presents a copied media-resource URL
- **THEN** Kun SHALL reject it with an opaque unauthorized or not-found response and SHALL NOT reveal whether the underlying file exists

### Requirement: Media-resource responses implement bounded byte ranges
The media-resource protocol SHALL support `HEAD` and single-range `GET` requests required by Chromium media playback. A satisfiable `Range: bytes=...` request MUST return `206`, `Accept-Ranges: bytes`, an accurate `Content-Range`, the selected byte count, the complete resource length, and the validated content type. Full or open-ended reads MUST stream with backpressure and remain within the effective per-request policy rather than buffering the complete media file. Malformed, unsatisfiable, multiple, over-limit, or non-byte ranges SHALL fail with a standards-compatible bounded response and MUST NOT cause a read outside the canonical resource.

#### Scenario: Player requests a middle byte range
- **WHEN** a bound View sends a valid single byte range wholly inside its media resource
- **THEN** Kun SHALL return exactly the authorized bytes as a `206` response with matching range headers and SHALL keep memory use within the configured stream window

#### Scenario: Player requests an invalid range
- **WHEN** a request uses multiple ranges, starts beyond the resource length, overflows an integer boundary, or exceeds the effective range limit
- **THEN** Kun SHALL return a bounded `416` or documented protocol error without opening unrelated bytes or allocating a buffer proportional to the claimed range

#### Scenario: View probes resource headers
- **WHEN** the bound View sends `HEAD` for an active media-resource URL
- **THEN** Kun SHALL return the same validated length, content type, range support, and cache identity that a corresponding `GET` would use, with no response body

### Requirement: View media access preserves the Webview security boundary
Kun SHALL add the media-resource origin only to the minimum Host-controlled Webview CSP directives needed for local media, image, or track playback. It MUST preserve `connect-src 'none'`, Node integration off, context isolation, Chromium sandboxing, navigation restrictions, and the existing narrow Kun-owned preload. View code SHALL NOT receive a general file API, arbitrary custom-protocol access, direct network capability, `window.kunGui`, Electron IPC, or the broker's underlying handle-to-path mapping.

#### Scenario: Video element loads an authorized URL
- **WHEN** a sandboxed extension View assigns its own active media-resource URL to a supported media element
- **THEN** the Host CSP and protocol handler SHALL permit that resource load without enabling remote fetch, arbitrary local files, or another View's resources

#### Scenario: View attempts direct file or network access
- **WHEN** View code tries a `file:` URL, direct `fetch`, WebSocket, navigation, or an unbound media-resource URL
- **THEN** the CSP, preload boundary, and sender-bound protocol checks SHALL block the attempt regardless of the extension's Node or network grants

### Requirement: Media resources are revocable and lifecycle bounded
Every media handle, export target, and media-resource URL SHALL have an explicit revocation state. Media-resource URLs MUST also have a finite policy-controlled TTL. Kun SHALL revoke affected resources on explicit release, expiry, View Session close or crash, workspace change, workspace trust or permission revocation, extension disable, update, rollback, uninstall, or file-identity mismatch. Revocation MUST prevent new reads immediately and MUST abort or close active streams within the documented cancellation grace without allowing cached authorization to reopen the resource.

#### Scenario: View closes during playback
- **WHEN** the View Session that owns a media-resource URL closes or loses its lease while a range response is active
- **THEN** Kun SHALL revoke the URL, terminate the active stream within policy, and reject subsequent ranges

#### Scenario: File is replaced after URL issuance
- **WHEN** the canonical path now resolves to a different file identity than the identity bound to the handle or URL
- **THEN** Kun SHALL reject access instead of serving the replacement under the stale authorization

#### Scenario: Owner explicitly releases a resource
- **WHEN** the owning extension releases a media handle or media-resource URL more than once
- **THEN** Kun SHALL make release idempotent and SHALL leave the resource unavailable after the first successful revocation

### Requirement: ffprobe execution is brokered and schema bounded
`context.media.probe` SHALL resolve a readable media handle to a Host-controlled `ffprobe` invocation and return a versioned, size-bounded schema for container, stream, duration, time-base, frame-rate, dimensions, rotation, codec, channel, and disposition metadata supported by Kun. Kun MUST select only a Host-discovered and policy-approved executable, invoke it without a shell, construct all file arguments from the bound handle, use a minimal Host-controlled environment, bound execution time and stdout/stderr bytes, and redact local paths from results, errors, logs, and audit projections.

#### Scenario: Probe succeeds for a granted video
- **WHEN** an extension with `media.read` and `media.process` probes its valid video handle
- **THEN** Kun SHALL return normalized schema-valid metadata without exposing the invoked executable path or source filesystem path

#### Scenario: ffprobe is unavailable or emits invalid output
- **WHEN** no approved `ffprobe` is discoverable, the process exceeds its limits, or its output violates the public probe schema
- **THEN** Kun SHALL return a stable unavailable, limit, or invalid-output result, terminate the owned process, and SHALL NOT fall back to an extension-supplied binary

### Requirement: ffmpeg jobs accept handles and argument arrays only
`context.media.startFfmpegJob` SHALL accept a validated argument array plus named input media handles and named output-target handles, and MAY accept a bounded map of SRT/WebVTT text outputs containing only an allowlisted MIME, bounded UTF-8 content, and a named Host-granted output handle. It SHALL return an extension-owned background-job reference rather than waiting for transcoding in a general Host operation. Kun MUST substitute Host-resolved paths only at the final spawn boundary, MUST keep text-output content out of executable arguments, and MUST reject raw absolute or relative file paths, URLs, network protocols, device inputs, response files, executable overrides, environment expansion, or any argument that could independently open an undeclared input or output. Media and text outputs in one request MUST be staged, promoted, consumed, or rolled back as one output transaction. The broker SHALL invoke only the Host-approved `ffmpeg` executable with `shell: false`; an extension SHALL NOT use this API to run another executable or arbitrary command.

#### Scenario: Extension starts a valid export
- **WHEN** an authorized request supplies readable input handles, writable export targets, and a schema-valid argument array referencing only those named resources
- **THEN** Kun SHALL create a durable media job, spawn the approved `ffmpeg` without a shell, and associate every process and output with that job, extension, and workspace

#### Scenario: Export includes a subtitle sidecar
- **WHEN** an authorized request supplies a bounded SRT or WebVTT text output beside a declared media output
- **THEN** Kun SHALL write the exact UTF-8 subtitle content only to its named export grant, stage and atomically promote it with the media output, keep it out of shell and FFmpeg arguments, and validate it before publishing any generated artifact

#### Scenario: Arguments contain an undeclared path or protocol
- **WHEN** an argument attempts to read or write an absolute path, traversal path, `file:` or network URL, capture device, response file, filter script, or any resource not represented by the declared handles
- **THEN** Kun SHALL reject the request before process creation and SHALL leave every input and output untouched

#### Scenario: Export target lacks write authorization
- **WHEN** a job maps an output to a read-only handle, a consumed or expired save target, another extension's handle, or a destination outside current workspace policy
- **THEN** Kun SHALL reject the job before creating or truncating the destination

### Requirement: Brokered media processes are supervised and cancellable
Kun SHALL own the complete `ffprobe` or `ffmpeg` process tree, use bounded pipes and event rates, parse progress into schema-valid monotonic job events, and apply configured concurrency, runtime, CPU where supported, output-byte, log-byte, and cancellation limits. Cancellation, extension disablement, workspace revocation, shutdown, timeout, or terminal failure MUST stop the process tree within policy, close handles and listeners, discard late events, and reconcile any partial output according to the background-job contract. Unknown process outcomes MUST NOT be reported as successful exports.

#### Scenario: User cancels an active transcode
- **WHEN** cancellation reaches a running ffmpeg job
- **THEN** Kun SHALL request graceful termination, enforce process-tree cleanup after the cancellation grace, mark the job with the documented terminal outcome, and SHALL NOT publish a partial file as a generated artifact

#### Scenario: ffmpeg floods diagnostic output
- **WHEN** ffmpeg produces stderr, progress, or log output faster or larger than the configured limits
- **THEN** Kun SHALL apply backpressure, coalesce or truncate only as documented, and terminate or fail the owning job without growing an unbounded in-memory queue

### Requirement: Generated media is a first-class validated artifact
Extension tool and job terminal results SHALL support a top-level `generatedArtifacts` collection. Each entry MUST use a versioned public schema containing an opaque artifact reference, owning extension and workspace attribution, source job or invocation reference, display name, media kind, validated MIME type, byte length, completion identity, and a durable media or export handle; it SHALL NOT contain an absolute path. Kun MUST validate that each artifact is a completed, existing output owned by the caller and confined to the active workspace before committing the result. Invalid, partial, missing, symlink-escaped, or foreign outputs SHALL fail artifact publication with a stable structured error.

#### Scenario: Tool returns a completed video export
- **WHEN** an extension tool returns `generatedArtifacts` for a successfully finalized output that it owns
- **THEN** Kun SHALL persist the validated artifact with the tool result and thread history, project it through renderer mapping, and expose preview, open, and reveal actions through Host-mediated resource APIs

#### Scenario: Tool fabricates an artifact reference
- **WHEN** a tool result names a nonexistent file, raw path, unfinished job output, another extension's artifact, or a resource outside the bound workspace
- **THEN** Kun SHALL reject artifact publication and SHALL NOT turn the value into an open or reveal action

### Requirement: Artifact identity survives ephemeral playback URLs
Kun SHALL persist durable opaque artifact identity separately from short-lived View media-resource URLs. A trusted consumer MAY request a fresh View-bound URL for an available artifact after the previous URL expires, but MUST pass the same current ownership, workspace, permission, and file-identity checks. Deletion, revocation, or missing output SHALL project the artifact as explicitly unavailable and SHALL NOT silently substitute another same-named file.

#### Scenario: Thread reopens after playback URL expiry
- **WHEN** a user reopens a thread containing an available generated artifact after its prior media-resource URL has expired
- **THEN** Kun SHALL mint a new sender-bound URL for the active View and preserve the artifact's original attribution and metadata

#### Scenario: Persisted artifact file was deleted
- **WHEN** history references a generated artifact whose bound file identity is no longer available
- **THEN** Kun SHALL show an unavailable artifact state and SHALL NOT expose a stale URL or search the workspace for a replacement by name

### Requirement: Media quotas and failures are explicit and bounded
Kun SHALL apply configurable limits to picker file count and metadata, active handles and URLs, URL lifetime, range size and concurrency, streamed bytes and rate, probe processes, ffmpeg jobs, process runtime, progress and log events, output bytes, temporary storage, and generated-artifact count and metadata. User or platform policy MAY tighten these limits. Every breach MUST return a stable structured error carrying the applicable limit category and retryability without leaking paths, arguments containing sensitive business data, process environment, or unrelated extension usage. Cleanup SHALL release quota idempotently after cancellation, terminal completion, revocation, crash, and restart reconciliation.

#### Scenario: Extension exceeds concurrent media limit
- **WHEN** an extension attempts to create a range stream, probe, URL, or processing job beyond its effective concurrency quota
- **THEN** Kun SHALL reject or defer it according to the documented policy without degrading another extension or starting untracked work

#### Scenario: Output crosses its byte quota
- **WHEN** an ffmpeg output or temporary media file grows beyond the effective byte limit
- **THEN** Kun SHALL terminate the owning job, reconcile or remove the incomplete output, release reservations, and return a quota-exceeded terminal outcome

### Requirement: Media operations are auditable without disclosing local paths
Kun SHALL attribute selection, handle creation, URL minting, range denial, probe, ffmpeg spawn, cancellation, revocation, export, and artifact publication to extension ID and version, workspace scope, operation or job ID, opaque resource reference, policy decision, elapsed time, and bounded outcome. Logs, diagnostics, errors, persisted events, renderer projections, and tool history MUST redact absolute paths, raw protocol credentials, consent material, complete ffmpeg command lines containing user data, and unbounded ffprobe or ffmpeg output. Documentation MUST state that broker controls constrain public media APIs but do not represent arbitrary Node extension code as an operating-system sandbox.

#### Scenario: Broker rejects a malicious invocation
- **WHEN** a media request fails permission, scope, argument, quota, or canonicalization validation
- **THEN** Kun SHALL record a redacted extension-attributed outcome that is useful for diagnosis without recording the protected path or reusable resource credential

### Requirement: Headless behavior is deterministic and non-interactive
`context.media.stat`, `context.media.probe`, and `context.media.startFfmpegJob` SHALL operate under `kun serve` and supported CLI execution for already valid workspace-scoped handles without Electron, a renderer, or a Webview. `context.media.pickFiles`, `context.media.pickSaveTarget`, and `context.media.openViewResource` require protected desktop or authenticated View interaction and MUST return a structured `interaction-required` or unavailable outcome in pure headless mode; they SHALL NOT launch a GUI, invent a selection, expose a path, or auto-approve a grant. Headless processing MUST retain the same permissions, quotas, cancellation, job persistence, artifact validation, and audit rules as desktop execution.

#### Scenario: Headless job uses existing handles
- **WHEN** a headless Agent tool starts processing with valid pre-existing input and output handles and all current grants
- **THEN** Kun SHALL run and persist the brokered job without requiring a View and SHALL publish completed artifacts through the same result contract

#### Scenario: Headless call needs a new picker decision
- **WHEN** a pure headless caller invokes a picker or lacks the protected selection required to continue
- **THEN** Kun SHALL return interaction-required with bounded continuation guidance and SHALL NOT open Electron or choose a default file

### Requirement: Public media contracts and release tests prevent drift
Kun SHALL publish versioned TypeScript types, runtime schemas, generated JSON Schema where applicable, API reference, capability and error documentation, and changelog coverage for all `context.media` methods, permissions, handles, range behavior, job handoff, and `generatedArtifacts`. `@kun/extension-test` MUST provide deterministic fakes for protected selection, handle ownership and revocation, metadata, probe output, ffmpeg job creation, quota and permission failures, cancellation, missing executables, and artifact validation without requiring real media tools by default. Runtime and release tests MUST cover schema drift, canonicalization and symbolic-link escape, sender and View Session isolation, CSP behavior, HTTP ranges and backpressure, TTL and revocation, malicious ffmpeg arguments, process-tree cleanup, headless behavior, result persistence, and renderer artifact actions.

#### Scenario: SDK schema and runtime diverge
- **WHEN** a checked-in type, generated schema, documentation example, Webview bridge payload, Host broker payload, or renderer artifact projection no longer matches the runtime source schema
- **THEN** CI SHALL fail and identify the stale contract before release

#### Scenario: Packaged desktop validates View playback security
- **WHEN** the packaged desktop smoke runs against a real Chromium extension View
- **THEN** it SHALL prove valid range playback works while copied URLs, stale sessions, direct network access, arbitrary local paths, and post-revocation requests remain blocked

#### Scenario: Supported platform validates native media execution
- **WHEN** release validation runs on macOS, Windows, or Linux
- **THEN** that host-native job SHALL test approved ffprobe and ffmpeg discovery, argument-only spawn, cancellation and process-tree cleanup, output confinement, artifact publication, and the documented unavailable path without claiming that one operating system simulates another
