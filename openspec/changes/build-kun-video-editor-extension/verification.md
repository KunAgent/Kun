# Verification audit

Date: 2026-07-13

This audit records local evidence for every requirement in this change. It does
not treat workflow wiring or mocked platform tests as native packaged evidence.

## Extension background jobs

| Requirement | Local evidence | Status |
| --- | --- | --- |
| Core-owned execution boundary | `extension-job-service.test.ts`, broker tests | Pass |
| Durable admission before acknowledgement | job store/service tests | Pass |
| Stable typed public API | Extension API schema and package tests | Pass |
| Durable extension/workspace ownership | job store/service ownership tests | Pass |
| Consistent state and event persistence | job store recovery tests | Pass |
| Ordered, replayable, bounded progress/events | subscription and backpressure tests | Pass |
| Idempotent cancellation propagated to work | job service and media process cancellation tests | Pass |
| Exactly one terminal fence | terminal race tests | Pass |
| Quotas and retention | quota/retention tests | Pass |
| Explicit safe restart reconciliation | startup recovery tests | Pass |
| Host crashes do not duplicate jobs | runtime lifecycle tests | Pass |
| Disable/uninstall fences jobs | package lifecycle and runtime tests | Pass |
| Renderer-free operation | headless broker/runtime tests | Pass |
| Bounded secret-safe diagnostics | diagnostic/redaction tests | Pass |
| Deterministic SDK/runtime testing | `@kun/extension-test` and core suites | Pass |

## Extension media resources

| Requirement | Local evidence | Status |
| --- | --- | --- |
| Explicit least-privilege permissions | manifest/schema/broker authorization tests | Pass |
| Protected Host-owned file selection | picker and IPC sender tests | Pass |
| Opaque workspace-confined handles | media handle traversal/symlink/ownership tests | Pass |
| Opaque View resource URLs | `kun-media` protocol and lease tests | Pass |
| Bounded byte ranges | protocol 200/206/416 and streaming tests | Pass |
| Preserved Webview security boundary | CSP, bridge and packaged desktop smoke tests | Pass |
| Revocable lifecycle-bounded resources | lease lifecycle tests | Pass |
| Brokered schema-bounded ffprobe | ffprobe service and real native smoke | Pass |
| Handle/argument-array-only ffmpeg | validator and malicious argument tests | Pass |
| Supervised cancellable media processes | process-tree cancellation tests | Pass |
| First-class validated artifacts | artifact service and mapper tests | Pass |
| Artifact identity survives lease refresh | persistence/replay/preview tests | Pass |
| Explicit bounded quotas/failures | process/media quota tests | Pass |
| Path-redacted auditability | diagnostic and error redaction tests | Pass |
| Deterministic non-interactive headless behavior | headless media tests | Pass |
| Public contract/release drift prevention | schema/docs/example/release gates | Pass |

## Kun video editor

| Requirement | Local evidence | Status |
| --- | --- | --- |
| Valid installable Kun extension | build/validate/pack/install/doctor/uninstall smoke | Pass |
| Transcript-first workbench | Webview state/component tests | Pass |
| Durable explicit project model | project service persistence/reopen tests | Pass |
| Deterministic timeline arithmetic | rational frame and operation tests | Pass |
| Probe-before-import | video tool/media broker tests | Pass |
| Local timed asset-addressable transcription | transcript import/capability tests | Pass |
| Revision-bound `timeline.md` | script digest/staleness tests | Pass |
| Bounded Agent toolset | manifest/catalog/profile tests | Pass |
| Shared manual/Agent revision channel | conflict and synchronization tests | Pass |
| Immutable source media and revision history | project operation/history tests | Pass |
| Deterministic captions/aspect ratios | subtitle/render-plan tests | Pass |
| Revision-bound inspectable proof | proof staleness tests | Pass |
| Cancellable background export | render/job cancellation tests | Pass |
| Verified generated export artifacts | post-probe/artifact tests | Pass |
| Confined paths and executable calls | path/process/FFmpeg security tests | Pass |
| MVP-accurate product language | profile, README and unsupported-request tests | Pass |
| Headless editing/rendering | installed `.kunx` `kun exec` and media smoke | Pass |
| Automated end-to-end workflow coverage | example and extension release gates | Pass |

## Native packaged sign-off

| Platform | Evidence on this worktree | Status |
| --- | --- | --- |
| macOS | Real local ffprobe/FFmpeg import, proof, cancellation, H.264 and post-probe pass; packaged runner is wired to exercise sender-bound `kun-media` load/seek and emit commit-bound artifact evidence. | Packaged CI pending |
| Windows | Native runner, process-tree cleanup, packaged media playback and commit-bound evidence are fail-closed in PR/release workflows. | Packaged CI pending |
| Linux | Native AppImage runner, FUSE-free extraction checks, packaged media playback and commit-bound evidence are fail-closed in PR/release workflows. | Packaged CI pending |

The implementation is locally release-gate clean. Task 10.5 remains open until
the same commit is pushed and all three native packaged runners upload their
evidence artifacts; this file intentionally does not fabricate that sign-off.
