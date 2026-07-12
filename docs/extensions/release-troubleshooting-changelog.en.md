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
<!-- sdk-surface-snapshot @kun/extension-api@1.0.0 sha256:f0d5ab4b66bce2be3c094f18bdb342ef66d097b057f954ef35a9dbb840567006 -->
<!-- sdk-surface-snapshot @kun/extension-react@1.0.0 sha256:e2099a64dc22c05056dca0c599bafdfb22702b6d57e9b60edd2154b165323322 -->
<!-- sdk-surface-snapshot @kun/extension-test@1.0.0 sha256:6a8a22ddd71ea7b7d88401f6fae3530775e59fdca52c9dc6052b4593950588be -->
<!-- END GENERATED SDK PUBLIC SURFACE SNAPSHOTS -->

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
