# Kun Video Editor

Kun Video Editor is a local-first, transcript-oriented editor for talking-head,
interview, podcast, and short-form projects. It is the reference Kun Extension
example for a self-registering right-sidebar View, main-Agent coordination,
protected media handles, durable jobs, generated artifacts, and provider-neutral
optional capabilities. Kun desktop ships the exact same deterministic `.kunx`
as its default local extension; there is no private built-in implementation
behind the example.

The editor preserves an editable, revisioned project. It never rewrites source
media during ordinary edits. Its project engine is independent from Electron,
Kun renderer internals, and the Extension Host, so the same project and tool
logic can run in the desktop View or headlessly when all required grants already
exist.

## Current reference scope

The example now demonstrates the complete P0-P2 extension architecture rather
than a form-only MVP:

- a 280-760 px docked sidebar with Script, Clips, Timeline, Properties, and
  Output workspaces, live Kun locale/theme updates, keyboard navigation, and
  explicit empty/loading/error/recovery states;
- a schema-v2, frame-native, multi-sequence project model with deterministic v1
  migration, nested sequences, optimistic revisions, atomic commands, bounded
  receipts, manual undo/redo, and Agent-owned undo fencing;
- protected video, audio, still, and supported animation import; folders,
  relink, metadata, transcripts, captions, keyframes, bounded effects, spatial
  timeline interaction, linked A/V, ripple/overwrite editing, and multicam;
- compact Agent inspection of raw media, project windows, selection, composed
  proofs, receipts, jobs, and analysis evidence without Webview DOM access;
- quota-managed waveform, thumbnail, filmstrip, proxy, proof, and preview jobs,
  plus local VAD, speaker attribution, beat/downbeat markers, sync analysis,
  bounded denoise metadata, and an opt-in real-frame visual index when its
  reviewed local adapter is present;
- one canonical render IR used by proof, preview, audio, subtitle, H.264,
  negotiated advanced-codec, and project-package paths, with visible
  unsupported-node reports instead of silent flattening;
- durable OpenTimelineIO interchange and atomic self-contained project packages
  with stable IDs, explicit loss manifests, provenance, cancellation, and
  restart reconciliation; and
- provider-neutral image, video, audio, and upscale placeholders and controls.
  Generation remains honestly unavailable until an approved local/BYOK/remote
  Broker is configured and any upload/cost boundary is explicitly confirmed.

This is a bounded reference editor and extension-development example, not a
drop-in replacement for Premiere Pro or Resolve. See [Limitations](#limitations)
before planning a production workflow.

## Local requirements

- Node.js 22 and npm (the versions used by this repository).
- For repository commands, a built Kun Extension API and Kun CLI from this
  checkout. For a standalone project, the CLI must come from the matching Kun
  installation and the required `@kun` packages must exist in its npm registry.
- `ffprobe` and `ffmpeg` on a Host-approved executable path for probing,
  thumbnails, proofs, previews, and exports. H.264 export requires `libx264`;
  burned captions additionally require the `drawtext` filter. Verify both with
  `ffmpeg -hide_banner -encoders` and `ffmpeg -hide_banner -filters`.
- No cloud account is required. Timed SRT, VTT, and JSON transcripts work
  locally. If a negotiated local transcriber is unavailable,
  `video-transcribe` returns `transcriber_unavailable` and uploads nothing.
- Visual indexing is opt-in. Kun accepts only the reviewed, signed local adapter
  receipt and decodes bounded real frames through the media broker. A missing
  adapter or unsupported semantic query returns an actionable unavailable state;
  the example never substitutes random or hash-derived "embeddings".
- Denoise analysis is metadata-only: a negotiated local adapter may publish a
  source-fingerprinted noise floor, RMS/peak levels, at most 32 spectral bands,
  confidence, and a 0-36 dB preview suggestion. It never changes audio or
  auto-applies a filter. The current public Kun media Broker has no verified
  noise-profile primitive, so the bundled adapter reports
  `denoise_metadata_algorithm_unavailable` instead of deriving fake levels from
  VAD or filenames.
- Generation providers are optional. The extension owns no provider secret and
  has no ambient network permission. An injected Host Broker must publish its
  bounded catalog and enforce the declared privacy, reference, approval, and
  cost policy before a request can run.

FFmpeg is not embedded in the `.kunx` package. Install it using the normal
package manager for the current operating system, or configure a Host-approved
path. Availability must be checked independently on each target platform; one
machine is not evidence for another.

On macOS, use `brew install ffmpeg-full`: the smaller Homebrew `ffmpeg` formula
does not provide the caption filter required by this example. Kun also searches
the keg-only `/opt/homebrew/opt/ffmpeg-full/bin` and
`/usr/local/opt/ffmpeg-full/bin` prefixes so a Finder launch does not depend on
an interactive shell PATH.

## Install the release package

Fresh Kun desktop profiles install and globally enable the product-bundled
archive through the standard `.kunx` validator, immutable package store,
registry, migration, and activation lifecycle. Workspace trust, protected media
selection, and export targets are not auto-granted. Disabling is preserved,
uninstalling is honored permanently, and a selected development or rolled-back
version is not overwritten by the bundled updater.

The product resource archive and downloadable release archive are built from
this directory by the same deterministic packer and have the same SHA-256 for a
given commit and manifest version. This keeps every capability demonstrated here
available to third-party authors through documented Extension API surfaces.

Each stable and daily Kun GitHub Release publishes the platform-independent
`kun-video-editor-0.4.4.kunx` asset beside the desktop installers and the three
native evidence JSON files. Download the `.kunx` from the same release as the
Kun build you are running; do not copy an archive from an untrusted mirror.

Validate and install the downloaded package with the Kun Extension CLI:

```bash
kun extension validate ./kun-video-editor-0.4.4.kunx
kun extension install ./kun-video-editor-0.4.4.kunx
```

Review and accept the declared permissions, enable the extension in a trusted
workspace, then choose **Kun Video Editor** from Code mode's vertical right rail. Kun opens it in its own right-workspace tab. Installation validates the archive's
integrity manifest; it does not install FFmpeg, enable cloud ASR, or grant media
paths. Media import and export still require protected Host pickers.

Repository maintainers can reproduce the release archive at the fixed output
path and verify an already downloaded copy with:

```bash
npm run pack:kun-video-editor
npm run verify:kun-video-editor-package -- --input dist
```

The pack command builds and validates the extension twice and refuses to publish
unless both `.kunx` archives have the same byte length and SHA-256 digest.

## Quick start for contributors

From the repository root:

```bash
npm ci
npm run build:extensions
npm run build:kun
npm --prefix examples/extensions/kun-video-editor run typecheck
npm --prefix examples/extensions/kun-video-editor run test
npm --prefix examples/extensions/kun-video-editor run build
npm --prefix examples/extensions/kun-video-editor run validate
npm --prefix examples/extensions/kun-video-editor run pack
```

The repository-wide example gate runs typecheck, tests, build, manifest
validation, Kun validation, and packing for every example into a temporary
directory:

```bash
npm run check:extension-examples
```

The repository `validate` and `pack` commands resolve the checked-out
`kun/dist/cli/serve-entry.js` through a helper anchored to its own file
location. They therefore work through `npm --prefix` from any caller directory,
but are intentionally repository-only.

For a standalone extension, first verify the v1.2 packages used by this example:

```bash
kun extension --help
npm view @kun/extension-api@1.2.0 version
npm view @kun/extension-test@1.2.0 version
```

Only continue with a published scaffold and `npm install` when those checks
return versions. An `E404` means the configured registry does not yet provide
the standalone SDK artifacts; use this repository checkout instead. Do not use
repository `file:` aliases in a portable project, and do not install the
unrelated unscoped npm package named `kun` as the Kun Agent CLI.

Generate the deterministic local audio/transcript fixture into a disposable
directory when exercising a manual flow:

```bash
npm --prefix examples/extensions/kun-video-editor run fixture:generate -- \
  --output /tmp/kun-video-editor-fixture
```

The generator uses only Node.js. It does not download media, contact ASR, or
invoke a generative service.

## Desktop workflow

1. Use the default installed extension, or build and install the `.kunx` with the
   Kun Extension CLI. Grant it in a trusted workspace, then choose its direct
   item from Code mode's vertical right rail. The editor opens in an independent tab beside the main conversation.
2. Create a project. The compact header remains available while Script, Clips,
   Timeline, Properties, or Output is active. Select the frame rate and one of
   the supported canvas presets.
3. Use the protected import action. Kun owns the native picker and returns an
   opaque handle; the View never receives an absolute path.
4. Probe the source before adding it to the project. Unsupported or malformed
   media is rejected without changing the source.
5. Import the deterministic fixture SRT/VTT/JSON or another timed transcript.
   Untimed prose is not enough for automatic destructive cuts.
6. Edit in the spatial timeline, or ask the main Kun Agent to resolve the active
   project and selection, inspect bounded evidence, and submit structured edits
   at the current revision. The View and Agent share project/selection/job events
   with monotonic generations; the extension does not add a second chat box.
7. Review the mutation receipt and current proof or preview. A stale proof is not
   evidence for a newer revision. Local analysis suggestions remain attributable
   and confidence-gated until explicitly applied.
8. Use Output to negotiate a codec, export OTIO, or create a project package.
   Every destination comes from a protected picker and every long operation has
   durable status and an explicit cancel action.
9. If a generation Broker is configured, review the provider, references,
   privacy/upload boundary, and maximum cost before confirming. Generated
   variants remain source-preserving assets and require an explicit insertion.
10. Treat successful FFmpeg/ffprobe or document validation as technical
   validation. Inspect the current proof or exported media before claiming
   visual quality.

## Headless workflow

The project engine and the declared Agent tools can run under `kun serve`
without a Webview. Headless import, playback URL minting, or save-target
selection does not open a dialog. A headless run must already have valid
workspace-scoped media and output handles; otherwise the tool returns
`interaction-required`.

A safe headless sequence is:

1. call `video-project` to create or read a project;
2. call `video-probe` with an existing `mediaHandleId`;
3. import a timed transcript with `video-transcribe`;
4. call `video-read-script` and retain its revision and digest;
5. apply explicit timed edits with `video-apply-script` or
   `video-update-timeline` using that expected revision;
6. call `video-render` with a pre-authorized media output handle and, for
   `sidecar` or `both`, a separate SRT/VTT output handle; and
7. poll without approval with read-only `video-render-status`; and
8. cancel explicitly with destructive `video-render-cancel` when requested.

The same pattern applies to analysis, interchange, generation, and project
packages: start with the dedicated write/cost authority, poll through a read-only
status tool, and cancel through the separately authorized cancel tool. A
headless tool cannot manufacture local-model opt-in, upload consent, cost
approval, a media grant, or an export target.

Headless execution uses the same permission, revision, path, job, and artifact
checks as desktop execution. It never fabricates picker consent.

## Supported workflows

- Remove explicitly timed filler words, silences, or repeated takes while
  retaining reversible source ranges.
- Reorder transcript-backed interview or podcast sections.
- Trim or ripple/overwrite a talking-head recording, preserve linked A/V, and
  add editable captions, text animation, keyframes, or bounded effects.
- Create alternate and nested sequences, organize richer media, and conform a
  source-preserving multicam program after reviewing sync confidence.
- Search filenames and spoken ranges; opt in to local visual-moment indexing;
  review VAD, speaker, beat, denoise-metadata, or sync evidence before applying
  a suggestion. Denoise recommendations remain metadata-only.
- Produce horizontal, portrait, or square output with deterministic fit, crop,
  or pad geometry.
- Generate a proof frame or low-resolution review preview before export.
- Export H.264, negotiated H.265/ProRes-equivalent targets, AAC audio, sidecar
  subtitles, OTIO JSON, or a self-contained project package through cancellable
  durable jobs.
- When an approved Broker exists, request bounded image/video/audio/upscale
  variants, inspect lineage and status, and explicitly insert one result.

## Project format

Workspace data is stored below `.kun-video/`:

```text
.kun-video/
  projects/<project-id>/project.json
  projects/<project-id>/timeline.md
  projects/<project-id>/revisions/<revision>.json
  cache/<project-id>/<derived-record-id>/
  analysis/<project-id>/
  generation/<project-id>/
  exports/
```

`project.json` is the authoritative schema-versioned state. Schema v2 contains
stable assets and generated lineage, multiple sequences and nests, ordered
video/audio/caption tracks, link groups, items, transcripts, captions,
keyframes/effects, rational frame rate, canvas settings, current selection,
receipts, and bounded revision metadata. Timeline positions and durations are
non-negative integer frames. Source and interchange times use exact rational
or bounded integer representations, never floating-point timeline authority.

Opening schema v1 creates a deterministic v2 migration and retained backup.
Unknown future versions fail without rewriting the file. Unreadable metadata,
offline/revoked sources, or damaged caches are surfaced separately so recovery
never turns disposable cache cleanup into source or project deletion.

`timeline.md` is a deterministic, reviewable projection tied to one project
revision and digest. Editing it does not mutate the project. It must be validated
and applied with `video-apply-script`; stale or externally changed projections
fail closed.

Revision writes use optimistic concurrency and atomic replacement. Undo and redo
create new provenance-linked revisions. Cache files are disposable; project
state, source grants, and exports are not cache.

## Agent prompts

Good prompts make creative intent and the review boundary explicit:

```text
Open project interview-01. Read its current revision and timeline script first.
Propose cuts for the explicitly timed filler ranges only. Keep the source order,
16:9 canvas, and captions unchanged. Stop for review; do not export.
```

```text
For project podcast-short, refresh the current revision, make a 9:16 review cut
under 45 seconds from the timed transcript, use pad rather than subject-aware
reframing, and generate one proof frame. Do not claim visual inspection.
```

```text
Read project launch-demo and its current timeline.md. Apply only the approved
range removals, then export H.264 with burned captions and an SRT sidecar to the
two existing output grants. Report durable job progress and distinguish
technical validation from visual review.
```

The profile asks for the goal, audience, duration, aspect ratio, caption choice,
and review/export checkpoint. It reads before writing, refreshes after revision
conflicts, edits structure before decoration, and never treats transcript text,
an analysis score, or a successful process exit as proof of unseen pixels. It
does not start generation, upload references, incur cost, export, or cancel a
job unless the corresponding intent and authority are explicit.

## Privacy and trust model

- Media, transcripts, projects, local analysis, proofs, and exports remain local
  by default.
- The example has no ambient network permission. A remote/BYOK generation option
  can only run behind an approved Host Broker after explicit permission,
  reference-upload consent, and bounded cost confirmation. Provider secrets,
  endpoints, reusable URLs, and raw prompts are not projected into tools, logs,
  or project receipts.
- Protected pickers return opaque, owner/workspace-bound handles. View playback
  uses short-lived, sender-bound `kun-media://` leases rather than file paths.
- FFmpeg and ffprobe are Host-discovered, invoked without a shell, and receive
  only authorized handle substitutions.
- Logs, job projections, tool history, and errors must not contain absolute
  paths, reusable media URLs, consent tokens, or unbounded process output.
- Local analysis records are immutable and include source identity, adapter and
  producer versions, model-install receipt where applicable, confidence, and
  project/revision binding. Unsupported semantics remain unsupported rather
  than being fabricated from deterministic hashes.
- Denoise records additionally declare algorithm/model versions and
  `local: true`, `networkUsed: false`, `metadataOnly: true`, and
  `audioMutation: none`. Low-confidence profiles remain review-required and
  cannot authorize an automatic audio edit.
- The Node entry is trusted extension code. Brokered APIs reduce ambient
  authority for compliant code; they are not an operating-system sandbox for an
  arbitrary Node extension. Review the package and requested permissions before
  installation.

## Recovery guide

| Symptom | Safe recovery |
| --- | --- |
| `interaction-required` | Open the desktop editor and complete the protected picker, or reuse a still-valid existing handle. Do not pass a path. |
| `transcriber_unavailable` | Import timed SRT, VTT, or JSON. No fallback text is generated and no media is uploaded. |
| Visual adapter unavailable or query unsupported | Explicitly opt in and install the reviewed signed local adapter, or use filename/spoken search. Arbitrary people/actions are not inferred by the bundled low-level descriptor. |
| `denoise_metadata_algorithm_unavailable` | Continue editing unchanged or use a Host build that negotiates a verified local noise-profile adapter. Do not infer noise levels from VAD, transcript text, or filenames. |
| Generation unavailable | Configure an approved Host generation Broker. Do not add provider credentials, endpoints, paths, or consent tokens to a tool request or project file. |
| FFmpeg/ffprobe unavailable or missing `drawtext`/`libx264` | Install a build with the required capabilities (on macOS, `ffmpeg-full`), verify it locally, and restart Kun. Project editing remains available. |
| Revision conflict | Call `video-project` and `video-read-script` again, review the newer revision, then resubmit structured edits with the new expected revision. |
| Stale `timeline.md` or proof | Regenerate it from the current project revision. Never reinterpret old timecodes or present an old proof as current. |
| Media handle or playback lease revoked | Reopen the project and request a fresh authorized handle/lease. Do not search by filename or reuse a copied URL. |
| Render cancelled or interrupted | Inspect the durable terminal state, remove/quarantine incomplete staging output, then explicitly start a new job. Do not assume the prior output completed. |
| OTIO import reports losses | Review the bounded loss manifest and preview digest, then explicitly confirm import into a new project ID. Import never silently overwrites the current project. |
| Project-package source missing | Choose the declared missing-media policy. `fail` leaves the destination unpublished; a manifest-only result records the omission and provenance. |
| Artifact unavailable | Confirm the bound export still exists and has not been replaced. Mint a fresh View lease only after current ownership and file identity checks pass. |
| Invalid project or unsupported schema | Preserve the project directory, inspect the structured validation error, restore a retained revision or migrate with a supported version. Do not hand-edit unknown schema fields in place. |
| Damaged derived cache | Close the View, delete only the affected `.kun-video/cache/<project-id>/` subtree, reopen, and regenerate thumbnails/waveforms. Never delete project state or source media as cache cleanup. |

## Limitations

The bundled visual adapter is an interpretable low-level frame descriptor, not
arbitrary scene, identity, face, object, or action recognition. It must not infer
unseen actions from a transcript or treat a process exit as visual review.
Semantic moment search beyond the installed adapter's declared capabilities
returns an actionable unavailable result.

Multicam, effects, color, keyframes, text animation, and OTIO mappings are
bounded catalogs rather than unrestricted NLE/VFX surfaces. OTIO export records
features it cannot preserve; import requires an explicit preview and creates a
new project. Provider-neutral generation demonstrates lifecycle, approval,
variants, lineage, and insertion, but ships no provider subscription, model
weights, stock library, voice clone, face tracking, or subject-aware automatic
reframing.

Transcript-based destructive edits require usable timing. Advanced codecs,
filters, local transcription, and optional models depend on capabilities
available on the current Host. Platform support is claimed only where the
current native packaged evidence exists; a successful macOS run is not Windows
or Linux evidence.

## Reusing this architecture

Third-party extension authors should copy the boundaries, not private Kun
internals:

1. Register a `views.rightSidebar` contribution and keep the View useful at
   280-760 px. Use commands/events for View-to-Host coordination and keep natural
   language in the main Kun conversation.
2. Put deterministic domain logic in a renderer/Electron-independent module.
   Route UI and Agent mutations through one revisioned command service and
   return bounded receipts.
3. Declare stable, small Agent tools split by read, write/destructive, cost, and
   cancellation authority. Resolve explicit composer context; never inspect the
   Webview DOM.
4. Use protected media handles, fixed broker profiles, durable jobs, atomic
   outputs, generated artifacts, and restart reconciliation. Never accept a path
   or reusable lease URL from a tool or View payload.
5. Treat analysis and provider support as negotiated optional capabilities with
   immutable provenance. Be honest when a model, codec, executable, approval,
   or platform proof is absent.
6. Test pure engines, Host contracts, View states and widths, security
   confinement, restart/cancel behavior, deterministic packing, and a real
   packaged application before claiming the capability.
