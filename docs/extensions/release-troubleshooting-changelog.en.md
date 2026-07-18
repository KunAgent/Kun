# Release, Troubleshooting, and API Changelog

> Extension API: v1
> 中文：[发布、故障排查与 API Changelog](./release-troubleshooting-changelog.md)
> Related: [CLI and testing](./cli-testing-debugging.en.md) · [Versioning and migration](./versioning-and-migrations.en.md)

This page is the final gate for releasing a `.kunx` and the starting point for diagnosing extension failures. A public API change must update this Changelog, types, Schema, compatibility matrix, and both documentation languages together.

## Release checklist

### 0. Kun public platform release gate

Kun release owners execute this section; one extension publisher's tests cannot substitute for it. The Extension Platform is not public-release ready while any item remains incomplete:

- [ ] The internal platform gate is removed. No build, environment, or settings switch hides the complete Extension Platform, and `kun extension`, `/v1/extensions/*`, the Extension Center, and authorized workbench contributions are reachable in production builds.
- [ ] The canonical supported-version list, runtime diagnostics, CLI validator, and Host admission share one API/Manifest version source. v1 executes current major 1 only because no previous major exists; when `N > 1`, current `N` and retained-SDK previous `N-1` Host adapter conformance both execute.
- [ ] Current/previous negotiation, future/removed-major rejection, minor-capability negotiation, RPC admission, migration crash recovery, and rollback fixtures pass. Accepting an old Manifest does not substitute for real previous-major Host adaptation behavior.
- [ ] A temporary clean project outside the source tree installs packaged `@kun/extension-api`, React bindings, test harness, and Kun CLI from `.tgz` files only, with no workspace/repository alias. It completes typecheck, a View Manifest, Agent call, tool, streaming Provider, and CLI validate/pack/install/list/doctor/uninstall.
- [ ] UI appearance packs, MCP, and Skills retain their own directories, configuration, Marketplace/settings entry points, runtime Providers, and tests. The `.kunx` registry does not reinterpret, migrate, or delete them.
- [ ] Existing Kun runtime health, thread/turn, HTTP/SSE replay, approval, user-input, usage, workspace, and Provider behavior is non-regressing, with one `kun serve` Agent runtime only.
- [ ] Packaged resources contain the Extension Host runner, CLI, SDK runtime, Manifest Schema/compatibility fixtures, every scaffolder template, Extension Webview/protected-surface preloads, and required production dependencies. A missing after-pack assertion fails the build.
- [ ] A Node 22/npm 10 clean checkout completes `npm ci` with no `node_modules`, `packages/extension-api/dist`, `kun/dist`, or `out`. Bootstrap builds the public Extension API before installing Kun's separate dependency tree and compiling Kun, and the release runner's npm version can reproduce the lockfile.
- [ ] macOS, Windows, and Linux release jobs each run `npm run check:extension-release-gate` and produce installable artifacts. Each platform first completes the packaged Node runtime smoke for local `.kunx` install, the Webview Session API, Agent tool, headless tool, custom Provider/account, and uninstall, then completes real Chromium desktop E2E; Linux also executes the final x86_64 AppImage directly before upload.
- [ ] Daily frontier prereleases and local GitHub/R2 release helpers enforce the same ordering. If the release gate, packaged Node runtime smoke, or desktop Chromium smoke fails, artifact upload, latest promotion, and public publication MUST NOT continue.
- [ ] The Electron/Webview security baseline is revalidated on the pinned Electron: inherited development/runtime overrides are scrubbed; only the packaged renderer and exact `kun-extension://` Webview target are accepted; a real CDP contribution click, body marker, `Reflect.ownKeys` bridge surface, full Theme and runtime View-state round-trips, absence of `kunGui`/Electron/Node, Host-filtered zero loopback-canary requests, user-gesture popup denial with no new target, protocol confinement, sender/session binding, protected consent, and content-script exclusion all pass.
- [ ] The Release evidence record contains the commit, CI run, three-platform artifacts/smoke, compatibility/legacy regression results, and reviewer. A `Blocked` item or an item without evidence cannot be marked complete.

Run the automated gate with `npm run check:extension-release-gate`. It executes its own unit tests, the out-of-tree tarball acceptance project, the current/previous policy, and selected UI Plugin, MCP, Skill, single-runtime, and legacy Provider behavior tests; structural checks and after-pack resource assertions remain complementary. On v1, executable conformance covers major 1 only. Before v2 can ship, the gate fails closed until the retained v1 SDK exists at `packages/extension-api-compat/v1` and `scripts/fixtures/extension-api-conformance/v1.mjs` executes real v1 Host adapter behavior.

After packaging, every platform must run two foundational smoke layers in order. `npm run smoke:packaged-extensions -- --resources <app-resources>` uses the real `app.asar.unpacked` and packaged Node runtime for the `.kunx` lifecycle, Kun Webview Session API, headless/Agent tool, custom Provider/account, doctor, and uninstall. `npm run smoke:packaged-extension-desktop` normally launches the host-native Electron with isolated HOME/userData, clicks the smoke contribution through CDP, and checks the real Chromium Webview security boundary; its fixture explicitly permits only the dynamic canary origin and the isolated guest bypasses the independent protocol CSP so the Host request filter is the control under test. Synchronous children and process-tree cleanup have their own hard timeouts, and runtime/CDP port closure is verified without signalling a stale launcher PID. Linux uses `xvfb-run` when no display exists. Before either Linux desktop smoke, CI independently enables only available user-namespace kernel toggles on the ephemeral runner and requires `unshare --user --map-root-user /bin/true`; this fixed preparation accepts no artifact input. `afterPack` renames the real Electron binary to `<executable>.electron-bin` and writes a fixed product launcher at the original name: normal GUI launches unconditionally prepend `--disable-setuid-sandbox`, while Kun CLI calls with `ELECTRON_RUN_AS_NODE=1` bypass it unchanged. It never uses `--no-sandbox`, so modern user-namespace and seccomp sandboxing remains active. `appImage.executableArgs` affects only `.desktop` and cannot replace the direct-launch entrypoint. CI then runs `npm run smoke:packaged-extension-appimage`: the unique native x64 artifact extracts itself into a fresh empty directory and rejects symlink or containment escapes for `AppRun`, resources, embedded `app.asar`, the product launcher, ELF payload, and single root desktop entry; it also requires `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`. Validated resources come only from that same artifact and no external `app.asar` is appended. The GUI test injects no sandbox flag: it scrubs inherited `APPDIR`/`APPIMAGE`, sets `APPIMAGE_EXTRACT_AND_RUN=1`, and directly launches the AppImage itself. Node orchestration uses `shell: false`; the artifact launcher itself is a fixed `/bin/sh` script whose content is checked exactly. Extraction, synchronous CLI, CDP, and cleanup stages are individually bounded, while the CI AppImage step has a separate 10-minute disaster bound. The local command does not claim one strict end-to-end deadline. Future deb/rpm targets or `app.relaunch()` must re-enter the launcher or explicitly preserve the flag rather than assuming `process.execPath`, which points at `.electron-bin`. Direct AppImage execution depends on an available unprivileged user namespace; on failure, diagnose with `unshare --user --map-root-user /bin/true` and have an administrator adjust the userns/AppArmor policy—never recommend `--no-sandbox`. The first layer uses `ELECTRON_RUN_AS_NODE` and cannot prove desktop Chromium, while the AppImage layer does not replace headless/runtime flows, and a passing `linux-unpacked` launch cannot replace the final AppImage. Self-extraction avoids a FUSE dependency in CI but does not prove FUSE-mounted execution or installer behavior. Workflow configuration and a passing gate are not native Windows/Linux execution evidence. These layers do not emulate another operating system's installer, accessibility, or system Credential Store, so artifact installation and native-platform evidence must come from corresponding native runners or machines.

PR checks must complete these smokes on all three native runners and only validate and upload temporary artifacts; they do not create a Release. `npm run evidence:extension-native` may run only after the final smoke succeeds. Its three platform JSON evidence files must bind the full commit, GitHub run/attempt, canonical artifact, byte size, and SHA-256 and travel with the artifacts. Evidence generation fails closed for missing, extra, wrong-architecture, directory, and symlink candidates. The macOS PR uses an ad-hoc signature without release secrets; the formal release record must still come from the protected workflow after Developer ID signing, notarization, and stapled-ticket validation all pass.

The downloadable `kun-video-editor-*.kunx` is packed before the Linux native lifecycle smoke and that exact regular file is passed through validate, install, activation, render, uninstall, and an unchanged SHA-256 check before upload. Stable and daily publish jobs then validate the downloaded archive again. Manual release helpers require a clean tracked and untracked worktree before any build. The Windows path fetches the remote tag and requires it to identify local `HEAD`; before making a draft public or promoting R2 `latest`, it downloads the tag's complete Release assets and verifies all three evidence JSON files, all six native installers, one shared version/commit, every size and SHA-256, required FFmpeg capabilities, and the unique `.kunx`. Every `Kun-`-named Release asset must match the six final artifacts or the same-version canonical blockmap allowlist; every other extension, architecture, case variant, or version is rejected. Missing Linux evidence therefore blocks both `--publish`/`-Publish` and `--r2-promote`/`-PromoteR2`, and R2 promotion explicitly requires mac, win, and linux manifests so it cannot produce a platform-incomplete `latest`. The single-platform macOS helper's `--r2` only uploads metadata and refuses promotion; promotion must use the Windows path after three-platform verification. Manual cleanup removes old evidence and `.kunx` files because evidence creation is intentionally create-only.

#### Release evidence record

| Evidence | Status (Pass/Blocked/N/A) | Commit, CI run, artifact, or report link | Reviewer/date |
| --- | --- | --- | --- |
| Automated release gate, external tarball project, and current/previous conformance |  |  |  |
| Legacy UI Plugin/MCP/Skill and Kun runtime regression |  |  |  |
| macOS package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Windows package/resource/Node runtime/Chromium desktop smoke |  |  |  |
| Linux package/resource/Node runtime/Chromium desktop/final AppImage smoke |  |  |  |
| Migration, rollback, headless tool, and custom Provider/account |  |  |  |

### 1. Identity and versions

- [ ] `publisher.name` exactly matches the published identity; rename is not treated as an ordinary update.
- [ ] Package `version` is a new valid SemVer; Index never replaces existing-version bytes.
- [ ] `manifestVersion`, `apiVersion`, `engines.kun`, and `stateSchemaVersion` are independently accurate.
- [ ] Tested against the target Kun current/previous API-major range.
- [ ] Deprecated API use is migrated, with replacement/removal horizon in release notes.

### 2. Manifest and permissions

- [ ] `kun extension validate` has no error; warnings are fixed or explicitly assessed.
- [ ] Entry, activation event, contribution/command/tool/Provider/auth references align.
- [ ] Headless contributions have `main`; browser-only code does not claim headless use.
- [ ] Permissions are minimal; hostname/Provider/workspace scopes are not unnecessarily broad.
- [ ] Added permission, Provider input capability, Node/DOM/secret-read has clear disclosure and renewed consent.

### 3. Lifecycle and reliability

- [ ] `activate` returns within deadline without waiting on network/model/user.
- [ ] Every command/listener/tool/Provider/timer/subscription/View registration is disposable.
- [ ] Cancel/dispose is idempotent; late post-terminal output is not committed.
- [ ] Every queue, stream, cache, log, and response has byte/item/time bounds.
- [ ] Host crash, timeout, and circuit-open do not affect Kun or other extensions.
- [ ] Unknown outcomes with possible side effects are not retried automatically.

### 4. UI and security

- [ ] Declarative controls use Host components; complex UI uses Webviews, never Kun React-tree injection.
- [ ] Webview has no Node/custom preload/direct network/remote script/eval; CSP/protocol confinement passes.
- [ ] Theme, locale, zoom, keyboard, screen reader, focus restore, high contrast/reduced motion pass.
- [ ] View close/guest crash/workspace switch/disable cleans sessions.
- [ ] Direct DOM exists only when unavoidable; `hostDom`, isolated world, protected-surface exclusion, and selector-failure containment are present.
- [ ] Credential/permission/approval/secret flows use protected surfaces and Host consent tokens only.

### 5. Agent, tools, and Provider

- [ ] Agent accesses owned threads only; budget clamp, sequence replay, steer/cancel/gates tested.
- [ ] Profile adds only an instruction overlay and does not replace stable system prefix/policy.
- [ ] Tool arguments/output/sideEffects/idempotency are accurate; ApprovalGate/user input cannot be bypassed.
- [ ] Tool catalog canonicalization, epoch/drift, and progressive discovery tested.
- [ ] Provider probe/listModels/every stream event/usage/tool-call/cancellation/backpressure pass.
- [ ] No silent fallback when explicit selected Provider/account/model is unavailable.
- [ ] Provider complete-request data disclosure is clear; errors/logs contain no prompt/secret.

### 6. Accounts, state, and data

- [ ] Multiple accounts, missing/expired/interaction-required, rename/delete tested.
- [ ] API key/OAuth PKCE/device/refresh use protected Account Broker; Webview has no raw secret.
- [ ] Custom-signer secret-read is minimally scoped, audited, and cleared from memory.
- [ ] Global/workspace/View state contains no secret and respects quotas.
- [ ] State migration is transactional across namespaces; failure/crash recovery/rollback fixtures pass.
- [ ] Unavailable Provider preserves Binding/account without credential deletion/rebinding.

### 7. Tests and documentation

- [ ] Typecheck, unit/integration, SDK harness, and example smoke pass.
- [ ] Headless tool/Provider/account path passes with GUI closed.
- [ ] `.kunx` path/ZIP/resources validated on macOS, Windows, and Linux.
- [ ] Packaged Electron Webview/Direct DOM security E2E passes.
- [ ] Manifest/Index JSON snippets, links/anchors, Chinese-English files/headings/snippets align.
- [ ] README/LICENSE/API reference/compatibility matrix/migration/Changelog match SDK.
- [ ] External clean project builds/tests/packs/installs with published SDK/CLI only.

### 8. Package and publication

- [ ] `.kunx` contains Manifest, integrity, README, LICENSE, entries/assets and no secret/link/unrelated file.
- [ ] SHA-256, optional signature, and Index identity/version/engine/API/permissions exactly match.
- [ ] Isolated-profile install → activate → disable → rollback where applicable → uninstall passes.
- [ ] Index uses HTTPS exact-version immutable URL; publication triggers no automatic update checking.
- [ ] Support knows how to collect `doctor --json` and redacted logs.

## Troubleshooting

Start with:

```bash
kun extension validate /path/to/source-or-package --json
kun extension doctor <publisher.name> --json
kun extension logs <publisher.name> --json
```

Check admission → enablement/permission → lifecycle/health → resource/session → business operation. Never “fix” by disabling validation, enabling Webview Node, changing a runtime token, or adding Provider fallback.

### Common problems

| Symptom | Inspect | Correct action |
| --- | --- | --- |
| Package will not install | Manifest path, integrity, ZIP path/link/collision/size, source HTTPS | Fix and repack; never disable validator |
| Incompatible | `engines.kun`, `manifestVersion`, `apiVersion` major/capability | Install compatible Kun/extension or follow migration guide |
| Upgrade asks for consent again | New permission/input capability/signature/source change | Review difference; old consent cannot auto-approve |
| Installed View is missing | Global/workspace enablement, trust, `when`, `ui.views`/`webview`, entry | Correct Manifest/grant/context; opening View triggers activation |
| Command missing | `commands` declaration, activation event, runtime register/dispose, ID namespace | Align local ID and `commands.register` |
| Activation timeout | Network/model/user wait or synchronous heavy work in `activate` | Register quickly and move work into handler |
| Repeated crash/circuit-open | Last error, memory/protocol limit, logs, restart count | Fix crash/limit and explicitly reload/re-enable; no endless restart |
| Blank Webview | `kun-extension://` path, resource root/MIME/CSP, View Session, guest crash | Fix resources/build/CSP; never enable Node/remote script |
| Webview fetch fails | `connect-src 'none'`, `network:<hostname>`, Broker URL/redirect | Use Network Broker with exact grant, not direct fetch |
| Direct DOM stopped working | Kun UI change, private selector, surface match, permission | Fail harmlessly/update extension; migrate to stable View/action |
| Account listing has no secret | Expected | Use authenticated fetch; only Node custom signer requests secret-read |
| Account interaction-required | Expired/revoked refresh, login/unlock, headless | Reauthenticate in protected UI; headless does not auto-open GUI |
| Provider unavailable without fallback | Disable/uninstall/circuit/Binding/model capability | Repair exact Binding/Provider and explicitly retry; this protects privacy |
| Provider stream protocol error | Sequence, event kind, tool fragments, payload, terminal, backpressure | Use SDK types/harness; one terminal and correct acknowledgements |
| Agent cannot read foreign thread | Expected ownership isolation | Use extension-owned threads; there is no implicit adoption API |
| Agent waits for approval/user input | Real protected interaction required | Steering/Webview/content script cannot answer/approve |
| Tool permission denied | Invocation-time workspace/network/account/tool grant revoked | Restore explicit grant or fail tool; catalog membership is not authorization |
| Tool unknown outcome | Host crashed after possible side effect | Inspect external system manually; do not auto-retry non-idempotent work |
| Catalog drift | Pinned tool Schema differs from live registry | New thread or idle-boundary epoch; never hot-edit prefix |
| Migration failed | from/to, namespace, quota, timeout, backup/commit marker | Fix forward migration; old version/state should remain usable |
| Rollback refused | No compatible state snapshot | Keep current version and ship a forward fix; never guess reverse migration |
| Data remains after uninstall | State/log/account reference retained by default | Use separate data-deletion flow after reviewing impact |
| Linux packaging fails at `V8_EXPORT` in `v8-primitive.h` | Whether the Electron native-rebuild command has `-DV8_DEPRECATION_WARNINGS=1` followed by `-UV8_DEPRECATION_WARNINGS` | Package through the repository `electron-builder.config.cjs` and retain the trailing `-U`; do not disable `npmRebuild` or remove the native module |

### Admission failure

Inspect every version dimension in doctor, not just package version. Not executing entry code is correct fail-closed behavior. Future API, API older than current N-1, unknown Manifest, or engine mismatch requires a compatible artifact and cannot be force-loaded.

### Activation/Host failure

Inspect activation cause, deadline, PID, last structured error, memory/message/concurrency/stream limits, and circuit. Top-level module errors and `activate` rejection both count as unhealthy starts. After fixing, use explicit `reload`. A side-effect call is not replayed automatically after restart.

### Webview/Bridge failure

Confirm the resource URL belongs to the extension's selected version/resource root, CSP contains no rejected remote/inline code, sender/session is current, and payload fits Schema/size/rate. Rejection of an old session after workspace change/disablement is expected.

### Provider/Account failure

Check coherent Provider + account + model Binding, account status, Provider Host health, network grant, model capability, and stream terminal. An authentication error needs only account reference/status, never credentials. Headless interaction-required returns continuation instead of hanging.

### State/Rollback failure

Do not hand-edit committed state or immutable package directories after migration failure. Preserve backups/diagnostics and ship a deterministic forward migration. Rollback uses only a retained compatible snapshot.

## Collect support information safely

Ask for:

```bash
kun --version
kun extension doctor <id> --json
kun extension logs <id> --json
```

Also collect `.kunx` SHA-256, source type, reproduction steps, workspace trust/enablement (not workspace content), and expected/actual terminal error code.

Default output redacts known secrets, authorization, runtime/consent tokens, and complete prompts, but review business metadata before publishing. Never request `.env`, Credential Store, API keys, OAuth tokens, complete chats/attachments, or unredacted crash dumps.

## API Changelog

The Changelog records public Extension API, not Kun internal refactors. Each entry includes API version, related Kun release line, Added/Changed/Deprecated/Removed/Fixed/Security, migration actions, and earliest removal major where applicable.

The public surface snapshots below are computed from package entries, public exports, and reachable `.d.ts` declarations. Update them only after this section explains the compatibility impact; changing a hash is not itself a Changelog entry.

<!-- BEGIN GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->
<!-- sdk-surface-snapshot @kun/extension-api@1.2.0 sha256:b30724f4cdc3c9c1a989794a3a120e385c394a8fc6341e27a27742dabf429fbb -->
<!-- sdk-surface-snapshot @kun/extension-react@1.2.0 sha256:e2099a64dc22c05056dca0c599bafdfb22702b6d57e9b60edd2154b165323322 -->
<!-- sdk-surface-snapshot @kun/extension-test@1.2.0 sha256:386c2beca46c240f957af2c92925c410a6d801a3bcc9f87697944d9f6d23337e -->
<!-- END GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->

### v1.2.0 — Media scheduling, local analysis, and project interchange

Compatible Kun: to be locked with the same release line. Do not set an
extension Manifest to `apiVersion: 1.2.0` until the public packages, canonical
supported-version list, and three-platform release gates are complete.

Added:

- The high-risk `webview.external` permission lets a workspace-reviewed View display a remote HTTPS site in an isolated child Webview without the Kun preload; top-level navigation must also match explicit `network:<hostname>` grants.
- `MediaApi.createCacheTarget()` allocates a Host-owned disposable opaque output grant for waveforms, thumbnails, filmstrips, proxies, proofs, and previews. The extension chooses a bounded format and purpose, never a cache path.
- `MediaStartFfmpegJobRequest.scheduling` and `MediaJobScheduling` provide `background` / `user` / `interactive` / `export` priority, 1–3 attempts, and a bounded retry base delay. The Host remains authoritative for concurrency, queueing, and transient classification.
- `application/x-otio+json` text output allows up to 2 MiB of bounded OTIO JSON to export atomically as a text-only durable job, with root, structural-bound, and opaque `kun-media://` target-reference validation.
- `MediaApi.getAudioAnalysisCapabilities()` and `startAudioAnalysisJob()` provide local `silence`, `beat-grid`, and `sync-features` through owner-scoped durable jobs. Results carry source fingerprints, algorithm provenance, `local: true`, and `networkUsed: false`.
- `MediaApi.getVisualModelStatus()`, `installVisualModel()`, `analyzeVisualFrames()`, and `embedVisualQuery()` provide a verifiable bundled-adapter receipt, real bounded frame decode, interpretable visual features, and an explicit unsupported-query result; they make no general semantic-model claim.
- `MediaApi.startArchiveJob()` creates a core-owned deterministic ZIP job from opaque input/output handles, normalized archive-relative paths, and bounded inline text, and returns a digest plus a new readable generated-media handle.
- `UiApi.attachComposerContext()` lets an authenticated View explicitly attach bounded, path-free structured selection to the matching workspace's main composer. The Host supplies extension/version/View/workspace provenance and consumes it once after successful turn creation.
- `@kun/extension-test` adds cache-target, scheduling/retry, OTIO, audio-analysis, visual-adapter, archive, cancellation, and restart fixtures covering the same public schemas and owner fences.

Changed:

- `ViewContribution.showInRightRail` is an optional boolean that defaults to `true`. A right-sidebar View may set it to `false` to remain available from Extension management or commands without staying in Code's right rail; existing Manifests need no migration.
- `MediaApi.readText()` raises public `MAX_MEDIA_TEXT_BYTES` from 512 KiB to 2 MiB while retaining strict UTF-8, a caller-tightenable `maxBytes`, opaque handles, and path-free results.
- SRT/VTT text output remains limited to 192 KiB per item; all text output combined is limited to 2 MiB. Text-only, media, and OTIO outputs continue to stage, validate, promote, or roll back together.
- FFmpeg jobs now queue through a global bounded priority/FIFO gate. Only an explicitly transient attempt that rolled back completely can retry with backoff; cancellation, ordinary failure, and unknown side effects do not retry automatically. Idempotency binds the complete canonical request rather than only a friendly key.
- The `MediaApi.getCapabilities()` allowlisted feature set expands to H.265, ProRes/FFV1, more audio codecs, color/effect filters, the silence primitive, and muxers; the result still contains no executable path.
- The public fail-closed View-safe method catalog adds the authenticated-View methods above. Registration, arbitrary workers, secret reveal, and credential mutation remain absent.

Fixed:

- Queued and retry-backoff work can be cancelled before process spawn. Running cancellation waits for process-tree exit, staging cleanup, and reservation release, and terminal fencing rejects late output.
- Non-terminal FFmpeg, audio-analysis, and archive attempts project explicitly as `interrupted` after Kun restart and roll back incomplete transactions; durably completed output retains its terminal outcome.

Security:

- External-site guests forcibly disable Node, Electron, the Kun bridge, nested Webviews, device permissions, and downloads. Initial navigation, redirects, and popups use the granted-host allowlist, and cookies stay in an extension-ID-isolated persistent partition. Existing ordinary Webviews continue to deny all external navigation.
- Audio and visual analysis accept only owner/workspace-bound opaque handles and bounded parameters. Fixed Host profiles decode real media locally and record algorithm/model identity; they accept no path, URL, filter, command, or implicit cloud fallback.
- The bundled visual package verifies its manifest, payload, signature, and install receipt. The current adapter exposes only interpretable color/brightness/edge features and returns `VISUAL_QUERY_UNSUPPORTED` when it cannot support arbitrary semantics; it does not fabricate an embedding.
- Archive entries reject absolute paths, backslashes, `.`/`..`, duplicates, symlink escape, and input/output aliasing. OTIO export rejects external `target_url` values. Output stays in private staging until atomic terminal commit.
- Composer context accepts only bounded JSON references without absolute paths. Main reauthorizes the current guest main frame, View contribution, exact extension version, workspace trust, and `ui.actions`. Extensions cannot supply provenance, and the payload enters only user-message content, never the stable system prefix.
- Provider-neutral generation adds no secret-bearing Media API or arbitrary Provider URL. The bundled example returns `unavailable` without an approved broker; provider permission, media-upload, and cost authority remain behind Host receipts and public Network/Account/Provider boundaries.

Migration:

- Existing Webviews need no migration. Only extensions that genuinely require complete remote sites add `webview.external` plus exact network hosts, which triggers renewed consent; ordinary brokered fetch continues to use the Network API.
- Existing v1.1 extensions need no source migration; the new fields and methods are additive. Before using them, update the SDK, declare exact media/jobs/workspace permissions, and negotiate capabilities.
- Extensions that use the new methods declare `apiVersion: 1.2.0` and ship with a compatible Kun Host. The Host still negotiates v1.1 and v1.0 manifests without a source migration.

### v1.1.0 — Brokered media, durable jobs, and generated artifacts

Added:

- `media.read`, `media.process`, `media.export`, and `jobs.manage` least-privilege permissions.
- `MediaApi` protected picker, opaque handle/stat, normalized probe, short-lived View resource lease, release, and brokered FFmpeg job contracts.
- `MediaApi.readText()` reads at most 512 KiB of Host-granted UTF-8 through an opaque handle; `MediaApi.getCapabilities()` returns a bounded FFmpeg, ffprobe, libx264, AAC, and optional caption-filter capability snapshot so extensions can offer actionable fallbacks before pickers or jobs.
- Optional bounded `textOutputs` on brokered FFmpeg jobs for Host-granted UTF-8, SRT, and WebVTT sidecars that commit or roll back atomically with media outputs. A text-only durable job may omit FFmpeg inputs, outputs, and arguments, so standalone subtitle export does not require FFmpeg. Existing callers need no migration.
- `JobsApi` owned job get/list/cursor subscription/cancel contracts, bounded progress/events/results, explicit interrupted state, and no generic `jobs.start` or extension worker registration.
- Top-level `generatedArtifacts` on tool and terminal job results, plus artifact/media-handle result-preview references without local paths.
- `media.performArtifactAction()` for user-initiated open/reveal of available generated artifacts from an authenticated interactive View; existing media callers need no migration.
- Deterministic fake media/jobs, configurable media capabilities, text-only jobs, permission failures, restart/cancellation controls, executable-unavailable behavior, and artifact fixtures in `@kun/extension-test`.
- A public fail-closed View-safe method catalog for Host boundary drift checks.
- Optional bounded Manifest `localizations` overlays and `resolveExtensionManifestLocale()` for Host-rendered extension metadata and declared display fields. Existing Manifests remain valid and their base strings are the fallback; overlays cannot change identity, permissions, activation, executable paths, schemas, or Agent instructions.

Changed:

- `@kun/extension-api`, `@kun/extension-react`, and `@kun/extension-test` move together to 1.1.0. Manifest v1 and API v1.0.0 remain accepted within major 1; no source migration is required for an existing v1.0 extension.
- `ToolResult.generatedArtifacts` and the new `ResultPreviewSource` artifact fields are optional, so v1.0 result envelopes and relative-path previews preserve their shape.

Security:

- Public media contracts carry opaque handles and leases, never absolute paths. Interactive picker/resource methods fail explicitly without a protected surface, and broker contracts do not claim that trusted Node extension code is an operating-system sandbox.
- Artifact open/reveal requests carry only an opaque artifact ID and action. Main derives owner, exact extension version, and workspace from the authenticated View Session and returns no local path.
- FFmpeg creation accepts argument arrays plus named input/output handles and hands execution to a core-owned durable job; the public API exposes no executable override, shell, process object, or arbitrary job worker.

Compatibility notes:

- `SUPPORTED_EXTENSION_API_VERSIONS` is `1.1.0`, then `1.0.0`; v1.0 manifests negotiate on the current major without receiving a breaking adapter.
- Media/job methods require new explicit permissions and Host v1.1 capability support. Existing v1.0 methods, manifests, and result sources remain valid.

### v1.0.0 — Initial stable API

Added:

- `.kunx`, Manifest v1, integrity, registry, local/dev/HTTPS Index v1, atomic install, manual rollback.
- Framework-neutral lifecycle, command, UI, storage, network, Agent, tool, Provider, and authentication contracts in `@kun/extension-api`.
- `@kun/extension-react` and `@kun/extension-test`.
- Stable workbench contribution IDs, sandboxed Webviews, and high-risk unsupported Direct DOM.
- Extension-owned Agent Runs/threads, replayable events, budgets, Profiles, and pinned tool catalog epochs.
- Namespaced tools executed through Kun ToolHost/ApprovalGate.
- Complete normalized streaming model Providers, multiple accounts, API key/OAuth PKCE/device flow, Credential Store, and no-fallback routing.
- Current + previous API-major policy, transactional state migration, and bilingual developer documentation.
- Standalone bilingual API Reference plus machine gates for headings, snippets, links/anchors, public exports, and `.d.ts` fingerprints.
- `kun extension create/validate/pack/install/list/enable/disable/uninstall/rollback/doctor/logs/reload`.
- Manifest allowlisting and repeatable safe relative-path `--include`/`--ignore` rules for `validate`/`pack`.
- Host-persisted declarative configuration with global/workspace isolation, optimistic revisions, change events, SDK/React access, Schema validation, quotas, and secret-like key rejection.
- Protected account rename/API-key replacement, explicit workspace trust, managed Provider/model/account selection with data disclosure, and separate cross-platform packaged Node runtime smoke plus real Chromium desktop Webview E2E.

Fixed:

- `ui.showNotification()` is now rendered by the trusted workbench and is not silently lost without a View Session. It waits for the user action/dismissal, returns the action `id`/`undefined` only to the originating call, and cleans up on cancellation, the 45-second timeout, workbench lease expiry, disablement, and shutdown.
- `FakeWebviewService` records notifications and exposes `respondToNextNotification()` for deterministic action or dismissal results in tests. This supports the existing v1 return contract and requires no migration.

Security:

- Sender/identity-bound brokers, protected consent windows/tokens, Node-off Webview sandbox/CSP, secret redaction, resource limits, and per-extension crash containment.
- Production Network/Account/Index fetch rejects special-use addresses across the complete DNS answer and pins approved addresses to one connection. OAuth device/token/refresh uses the same policy, while redirects remain manually revalidated hop by hop.
- Pack does not traverse the project root by default and rejects selected VCS/dependency, dotenv, credential/private-key, nested-package, link, and source-root escape paths.
- Node Host is explicitly trusted current-user code, not an OS sandbox.
- OAuth/device interaction material stays in Main-owned protected surfaces; Node/Webview session projections are redacted, and authenticated credentials are restricted by both network permission and Provider `credentialHosts` with manual redirect checks.
- Notification actions and dismissal require Chromium-trusted user activation. Synthetic Direct DOM clicks cannot forge another extension's user selection, and notifications are never a privileged approval surface.

Compatibility notes:

- v1 is the initial current major and supports API major 1 only.
- Raw host DOM/CSS/React selectors are outside v1 SemVer guarantees.
- Appearance packs, MCP, and Skills remain separate and are not migrated.
- v1 performs no automatic extension update check, prompt, download, or installation.

### Future entry template

```markdown
### vX.Y.Z — YYYY-MM-DD

Compatible Kun: <release/range>

Added:
- ...

Changed:
- ... (backwards compatible in a minor)

Deprecated:
- `<symbol>` -> use `<replacement>`; earliest removal: vN

Fixed:
- ...

Security:
- ...

Migration:
- Required developer/user action, or “None”.
```

A breaking type, method, event, permission meaning, or required behavior belongs only in a new major. Every Deprecated/Removed item updates type declarations, validator warnings, migration guides, compatibility fixtures, and both language pages.
