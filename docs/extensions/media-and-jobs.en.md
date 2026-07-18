# Extension media and background jobs

> 中文：[扩展媒体与后台任务](./media-and-jobs.md)

Extension API v1.1 established the Host-brokered local-media and durable-job
baseline. Extension API v1.2.0 adds bounded
text and OTIO, scheduling hints, real local audio/visual analysis, and atomic
ZIP archives. An extension must negotiate the matching API and capability; the
presence of a type does not imply that an older Host can execute it.

These APIs are for video, audio, image-sequence, analysis, and rendering
extensions that should not move large files through JSON IPC. They expose
neither local paths and native processes nor a generic background worker.

## Authority model

Declare only the permissions the extension actually uses:

| Permission | Authority |
| --- | --- |
| `media.read` | Read Host-granted opaque media handles, including `stat`, `readText`, and View leases |
| `media.process` | Query media capabilities, allocate disposable cache targets, and use bounded FFmpeg/audio/visual-analysis brokers |
| `media.export` | Select and write Host-granted export destinations, including archive output |
| `jobs.manage` | Observe and cancel jobs owned by the extension |
| `workspace.read` / `workspace.write` | Required in addition to the matching read, process, or export grant |

An FFmpeg job requires `media.read`, `media.process`, `media.export`,
`jobs.manage`, `workspace.read`, and `workspace.write`. Audio analysis does not
write output; it requires read, process, job management, and `workspace.read`.
An archive reads inputs and writes output, so it requires `media.read`,
`media.export`, `jobs.manage`, `workspace.read`, and `workspace.write`. Each
method still reauthorizes its specific operation at invocation time.

Every call checks the active extension, exact version where required,
workspace, trust, permissions, owner, and file identity. A handle is not ambient
filesystem authority. A trusted Node extension remains trusted native code;
these brokers do not turn arbitrary extension code into an operating-system
sandbox.

## Protected selection

`context.media.pickFiles()` and `pickSaveTarget()` open Main-owned dialogs. The
extension supplies bounded display filters and a suggested name, not a path or
authorization. Cancellation creates no handle, destination, or partial file. A
successful response contains `MediaMetadata` with an opaque `handleId`; it does
not contain an absolute path.

Picker APIs need an interactive desktop View. Headless tools should return an
interaction-required checkpoint and ask the user to open the editor. They must
not launch a dialog, select a default path, or invent a grant.

## Metadata, bounded text, and playback

`media.stat()` returns bounded metadata. `media.probe()` uses a fixed ffprobe
JSON profile and returns normalized container and stream fields. It does not
return the executable path, source path, environment, or raw diagnostic log.

`media.readText()` reads strict UTF-8 through a readable handle. The pending
v1.2 maximum and default are both 2 MiB; callers can reduce `maxBytes`. A file
whose declared or actual size exceeds the limit, or whose bytes are not valid
UTF-8, fails explicitly. This supports bounded SRT/VTT, JSON, and OTIO
documents. It returns no path and neither parses nor trusts media references in
the document automatically.

In a sandboxed View, exchange a readable handle with
`media.openViewResource()`. The returned `kun-media://` URL is short-lived and
bound to the extension, exact View Session, contribution, sender main frame,
workspace, and file identity. Do not persist the URL; persist the handle or
artifact reference and request a fresh lease after reopening.

Chromium playback supports `HEAD`, full `GET`, and one bounded byte Range. The
Host streams with backpressure. Copied URLs, multiple ranges, stale sessions,
expired leases, replaced files, and foreign senders are rejected. The View CSP
allows `kun-media:` only for media while preserving `connect-src 'none'`,
context isolation, sandboxing, navigation restrictions, and Node integration
off.

Call `media.release()` when a handle or lease is no longer needed. Disable,
update, rollback, uninstall, permission changes, workspace changes, View
closure/crash, expiry, and file replacement also revoke affected resources.

## Capability negotiation and cache targets

Call `media.getCapabilities()` before offering a codec, filter, muxer, or
analysis operation. The snapshot contains only FFmpeg/ffprobe availability, a
redacted version, and allowlisted features such as H.264/H.265, ProRes/FFV1,
AAC/FLAC/PCM, caption/color filters, and common muxers; it never returns an
executable path. When a feature is absent, provide an actionable fallback or
disabled state. Do not silently change codec, ignore an effect, or describe
technical success as visual verification.

`media.createCacheTarget({ format, purpose })` allocates a Host-owned disposable
output grant for waveforms, thumbnails, filmstrips, proxies, proofs, and
previews. The extension selects a bounded format and purpose, not a path, and
does not need `media.export` merely to allocate cache. Project state should
store opaque derived IDs, dependencies, and provenance rather than cache paths;
cleanup, quotas, pinning, LRU, and invalidation remain explicit policies.

## Brokered FFmpeg, scheduling, and text outputs

`media.startFfmpegJob()` accepts an argument array and named handle bindings.
Resource placeholders occupy a complete argument:

```ts
const { job } = await context.media.startFfmpegJob({
  arguments: [
    '-i', '{{input:source}}',
    '-c:v', 'libx264',
    '-pix_fmt', 'yuv420p',
    '{{output:video}}'
  ],
  inputs: { source: inputHandleId },
  outputs: { video: exportTargetHandleId },
  textOutputs: {
    captions: {
      handleId: subtitleTargetHandleId,
      mimeType: 'application/x-subrip',
      content: generatedSrt
    }
  },
  scheduling: {
    priority: 'export',
    maxAttempts: 1,
    retryBaseDelayMs: 250
  },
  idempotencyKey: `project-${projectId}-revision-${revision}`
})
```

The Host substitutes canonical paths only at the final spawn boundary. Shell
syntax, raw paths, URLs, protocols, devices, response files, executable
overrides, path-loading filters, and Host-reserved options are rejected. Kun
uses only a configured or sanitized-PATH executable, `shell: false`, a scrubbed
environment, bounded logs and progress, sibling staging, byte/time quotas,
process-tree cancellation, post-output validation, and atomic promotion.

Optional `scheduling` has hint semantics only; the Host always owns concurrency
and execution. Priorities in ascending order are `background`, `user`,
`interactive`, and `export`; equal priority is FIFO. `maxAttempts` is limited to
1–3 and defaults to 1. Kun retries only a failure explicitly classified as
transient after the prior attempt has rolled back completely, using bounded
backoff. Ordinary encode/validation failures, cancellation, and unknown side
effects are never retried automatically. Idempotency binds the complete
canonical request, not only the caller's friendly key; changed handles,
arguments, metadata, revision, or scheduling cannot alias an earlier job.

`textOutputs` is a bounded map of UTF-8 sidecars that belong to the same
transaction as media output. An SRT/VTT item is limited to 192 KiB. v1.2 also
accepts `application/x-otio+json` and limits all text output combined to 2 MiB.
OTIO must be bounded valid JSON with a supported `SerializableCollection.1` or
`Timeline.1` root; each `target_url` must be a bounded opaque `kun-media://`
reference. With no FFmpeg input, output, or arguments, a text-only job is
allowed. Text never enters the native command line. All declared outputs are
staged, validated, promoted, consumed, or rolled back together, preventing a
half-published export.

Kun does not bundle FFmpeg in every `.kunx`. Install a compatible Host FFmpeg
or use an application-managed override. Editing remains available when native
tools are missing, while probe, rendering, and decode-dependent analysis return
an explicit unavailable state.

## Durable jobs, cancellation, and restart

Only core capabilities create jobs; extensions cannot register arbitrary
workers. Use `jobs.get()`, `jobs.list()`, `jobs.subscribe()`, and
`jobs.cancel()`. Snapshots and monotonic events persist across renderer and
runtime restarts. A subscription first replays after the supplied cursor and
then delivers live events. When `replayGap` is true, replace local state with
the returned snapshot before continuing.

Cancellation is idempotent, and a completed job keeps its terminal outcome. A
job in the queue or retry backoff can be cancelled before a native process
starts. Running cancellation waits for the process tree to close, staging to be
removed, and reservations to be released before settling. Terminal fencing
rejects late progress and output.

If Kun restarts with an unknown FFmpeg, audio-analysis, or archive attempt, the
job recovers as `interrupted` and incomplete staging rolls back; output that
already won the durable terminal commit remains complete. Inspect the project
revision, input identity, and destination before starting an explicit new
attempt or the same canonical idempotent request. Never assume partial output
is resumable.

## Real local audio analysis

`media.getAudioAnalysisCapabilities()` reports `silence`, `beat-grid`, and
`sync-features` separately. `media.startAudioAnalysisJob()` accepts only bounded
algorithm parameters and opaque input handles. Observe and cancel the result
through the ordinary Jobs API. Results preserve a source fingerprint, algorithm
version, `local: true`, and `networkUsed: false`:

- `silence` uses a fixed `silencedetect` profile and returns bounded intervals
  with threshold provenance.
- `beat-grid` decodes authorized media to bounded mono PCM and computes
  conservative onset/autocorrelation beat and downbeat evidence. Weak or
  constant signals return no markers rather than a fabricated grid.
- `sync-features` extracts a bounded PCM energy envelope from two distinct
  handles. An extension may use a fixed seed, confidence threshold, and preview
  to plan synchronization, but must refuse automatic apply at low confidence.

These jobs upload no audio and accept no command, filter, path, or URL. Missing
FFmpeg or PCM primitives produce `AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE` or
`AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE` with remediation. There is no implicit
cloud fallback.

## Real local visual analysis

The pending v1.2 visual surface is opt-in, verifiable, and deliberately narrow:

- `media.getVisualModelStatus()` returns immutable adapter/model/package
  identity and install state. `media.installVisualModel()` installs only a
  Kun-managed package whose digest, signature, and receipt verify. The current
  implementation copies a small bundled algorithm descriptor, so its receipt
  says `packageSource: 'bundled'` and `downloadVerified: false`; it does not
  claim a download occurred.
- `media.analyzeVisualFrames()` accepts at most 16 bounded time ranges. The Host
  decodes 32×32 RGB frames from real authorized media with a fixed profile and
  produces a 24-dimensional, interpretable color, brightness, saturation,
  contrast, and edge descriptor with source fingerprint and algorithm
  provenance. It is not a random hash or a neural semantic embedding claim.
- `media.embedVisualQuery()` accepts only documented color, brightness,
  temperature, contrast, and detail concepts and labels scoring as
  `uncalibrated-cosine`. People, objects, actions, and arbitrary prose return
  `VISUAL_QUERY_UNSUPPORTED`; use filename or transcript search instead.

Analysis and query are bounded Host requests with `AbortSignal`, not generic
extension-registered workers. If an extension builds a moment index, it must
persist immutable sample/adapter/source fingerprints, progress, and
completeness itself, and discard mismatches after cancellation, adapter-identity
change, or source replacement. Inference stays local, accepts no URL, exposes
no raw path, and uses no network.

## OTIO import and export

OTIO export uses a Host-granted save target and an
`application/x-otio+json` text-only durable job, so it receives the same atomic
promotion, cancellation, and restart fencing as media output. Before commit,
an extension should produce stable ID/timecode mapping and a bounded loss
manifest. If the format cannot represent a nest, effect, caption, or keyframe,
it must not claim a lossless round trip.

For import, the user first selects the document and the extension calls
`media.readText({ handleId, maxBytes })` for at most 2 MiB of strict UTF-8.
`readText` is not an arbitrary filesystem entry point and does not resolve
external media URLs. The extension must validate OTIO schema, depth, node
count, time ranges, and opaque references again, show an import/loss preview,
and create a new project only after explicit confirmation. Missing media uses a
protected picker/relink flow; paths in the document never authorize access.

## Atomic archive jobs

`media.startArchiveJob()` creates a core-owned deterministic ZIP job. A request
contains a Host-granted output handle and at most 512 entries with unique,
normalized POSIX relative paths. Entries may reference readable media handles
or contain `application/json`, OTIO JSON, Markdown, or plain text. Combined
inline UTF-8 is limited to 2 MiB. Absolute paths, backslashes, `.`/`..`,
duplicates, input/output aliases, and unauthorized handles are rejected before
writing.

The Host writes private staging with a fixed ZIP time and stable entry order,
then validates size, entries, SHA-256, and output identity before atomic
promotion. Success returns a new readable `generatedMedia` handle plus entry,
input, and archive byte counts and a digest; it returns no path. Cancellation
and non-terminal restart roll back staging, backup, and output reservation.
An archive that already completed durably commits its terminal state during
recovery.

## Provider-neutral generation boundary

The Media API exposes no arbitrary Provider URL, credential, upload, or generic
remote worker. Kun Video Editor's generation/upscale control plane is a
replaceable provider adapter, while the editing core remains fully available
without a Provider:

- A catalog exposes only provider/model identity, image/video/audio/upscale
  capabilities, reference limits, privacy policy, and cost range—never a secret
  or endpoint.
- Remote and BYOK work requires separate confirmation of provider permission,
  media upload, and maximum cost. UI checkboxes express intent only. Actual
  authority is a one-use Host receipt bound to owner, the complete request
  digest, quote, permissions, uploaded asset IDs, amount, and expiry.
- A record with prompt/model/reference lineage, idempotency, and placeholder is
  persisted before dispatch. Cancellation, failure, restart, and multiple
  variants retain explicit states, and each output is revalidated as an owned
  opaque handle.
- If no permitted Provider supports the constraints, the result is
  `unavailable`: no fake asset, automatic upload, or silent fallback. Editing
  and export continue to work. The bundled example currently takes this path
  when no approved broker is injected.

A third-party remote adapter must still use public Network/Account/Provider
permissions and protected authorization flows. It must not write tokens to a
project, Webview, job metadata, or logs, and cannot use
`media.startFfmpegJob()` to bypass network policy.

## Generated artifacts

Successful FFmpeg-broker jobs publish top-level `generatedArtifacts`. An artifact has a
durable opaque identity, owner/workspace attribution, media handle, completion
identity, MIME/size metadata, availability, and job or invocation provenance.
It has no local path or lease URL. Tool results may reference only an existing,
completed artifact owned by the caller. Kun validates it again before history
commit and projects missing, replaced, or revoked files as `unavailable`.

Result-preview Views receive artifact and media-handle references and request a
fresh View lease instead of reading a path or data URL. For non-player
artifacts such as SRT/VTT/OTIO, an interactive View can call
`media.performArtifactAction({ artifactId, action: 'open' | 'reveal' })`. Main
derives owner, exact extension version, and workspace from the authenticated
View Session, revalidates the artifact, performs the desktop action, and never
returns a path. Headless and stale, cross-extension, or cross-workspace calls
fail closed.

## Troubleshooting

- `MEDIA_INTERACTION_REQUIRED`: open the desktop View and complete the protected picker.
- `MEDIA_PERMISSION_DENIED`: check both the media permission and matching workspace grant.
- `MEDIA_HANDLE_REVOKED` / `MEDIA_NOT_FOUND`: select the source again or recover the missing output.
- `MEDIA_EXECUTABLE_UNAVAILABLE`: verify Host FFmpeg/ffprobe and the requested codec/filter/muxer feature.
- `MEDIA_INVALID_ARGUMENT` / `MEDIA_INVALID_OUTPUT`: inspect named-handle placeholders, OTIO schema, archive-relative paths, output MIME, and input/output aliases.
- `MEDIA_LIMIT_EXCEEDED`: reduce text, entries, output, frame samples, or concurrency.
- `AUDIO_ANALYSIS_*_UNAVAILABLE`: follow capability remediation to install compatible FFmpeg; no cloud fallback occurs.
- `VISUAL_MODEL_MISSING` / `VISUAL_MODEL_UNVERIFIED`: reinstall and verify through Kun, then rebuild the index.
- `VISUAL_QUERY_UNSUPPORTED`: narrow the query to documented visual concepts or use filename/transcript search.
- Job `interrupted`: inspect project revision, source identity, and destination before an explicit safe retry.
- Video does not seek: request a fresh lease and check that the file was not replaced; never reuse an expired URL.

Logs and diagnostics intentionally redact absolute paths, reusable leases,
provider secrets, environments, complete prompts, and complete native command
lines. Still review business metadata before publishing a support report.

## Distribution, privacy, and cleanup review

- The first-party example source carries its checked-in MIT license. It does
  not copy or redistribute FFmpeg, codecs, model weights, stock media, or
  third-party footage. Bundling FFmpeg or a model later requires separate
  target, codec, model-source, and license review.
- Probe, text/transcript import, timeline editing, audio/visual analysis,
  archive, and rendering are local by default. No cloud ASR or generative
  service is enabled implicitly, and project state contains no provider secret.
- Input handles are read-only. Input/output alias checks and sibling staging
  prevent source footage from being rewritten. Project operations preserve
  source ranges rather than editing source bytes.
- Failed, cancelled, over-quota, and interrupted processing removes staging and
  releases reservations. Completed exports, archives, and projects are user
  data and are not deleted on uninstall; derived-cache cleanup is explicit.
- Audit records contain opaque handle/job/artifact identities plus bounded
  provenance and outcomes, never protected paths, operation tokens, leases,
  Provider credentials, environments, complete prompts, or unbounded native
  output.
- A Node extension can still import `fs` or `child_process` under the existing
  high-risk trust disclosure. Prefer the brokers for least authority, but do
  not describe them as an OS sandbox for arbitrary extension code.
