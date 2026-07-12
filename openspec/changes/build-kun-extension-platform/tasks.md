## 1. Public contracts and workspace setup

- [x] 1.1 Add npm workspace packages for the framework-neutral Extension API, React bindings, test harness, and scaffolder.
- [x] 1.2 Define canonical manifest, contribution, permission, lifecycle, compatibility, error, and registry schemas with public TypeScript exports.
- [x] 1.3 Define public Agent run, extension tool, model provider stream, account, authentication, storage, network, and UI message contracts.
- [x] 1.4 Generate and validate the manifest JSON Schema from the canonical contract source.
- [x] 1.5 Add current/previous API-major negotiation and conformance fixtures.

## 2. Package registry, installation, and indexes

- [x] 2.1 Implement extension paths, registry persistence, installed-version records, global/workspace enablement, and atomic registry writes.
- [x] 2.2 Implement defensive `.kunx` archive inspection/extraction with path, symlink, count, size, collision, entry, compatibility, and integrity checks.
- [x] 2.3 Implement staging installation, immutable version directories, active-version switching, explicit rollback, disable, and uninstall.
- [x] 2.4 Implement development-directory loading and explicit reload without copying package content.
- [x] 2.5 Implement HTTPS Index v1 loading and exact-version download/install with SHA-256 verification and no update polling.
- [x] 2.6 Add package, registry, archive-attack, rollback, development-mode, and index tests.

## 3. Headless Extension Host runtime

- [x] 3.1 Implement the extension host runner, activation/deactivation contract, bound identity, and Node IPC request/response/notification protocol.
- [x] 3.2 Implement per-extension process management, lazy activation events, minimal environment, workspace roots, lifecycle nonces, and graceful shutdown.
- [x] 3.3 Implement timeouts, cancellation, stream sequence/ack backpressure, message limits, memory limits, log rotation, restart backoff, and crash circuit breaking.
- [x] 3.4 Implement global/workspace state stores, transactional state migrations, backups, failed-migration rollback, and unavailable-version diagnostics.
- [x] 3.5 Compose ExtensionManager into `kun serve`, one-shot runtimes, runtime shutdown, info, and tool diagnostics.
- [x] 3.6 Add activation, identity spoofing, headless, cancellation, limits, crash isolation, restart, state migration, and shutdown tests.

## 4. Extension Agent runs and tools

- [x] 4.1 Extend thread contracts and persistence with extension owner, version, Agent profile, account binding, budgets, visibility, and tool-catalog epoch metadata.
- [x] 4.2 Implement extension-owned Agent create/get/list/subscribe/steer/cancel services with ownership and permission enforcement.
- [x] 4.3 Implement extension Agent profiles without allowing immutable system-prefix replacement or policy bypass.
- [x] 4.4 Implement namespaced extension tool registration and an ExtensionToolProvider integrated into CapabilityRegistry and LocalToolHost.
- [x] 4.5 Preserve ApprovalGate, user-input, sandbox, operation journal, output caps, progress, and cancellation semantics for extension tools.
- [x] 4.6 Implement stable per-thread tool catalog epochs and progressive extension-tool search/call facades.
- [x] 4.7 Add ownership, budgets, event ordering, steering, cancellation, approval, tool failure, catalog drift, cache stability, and headless tests.

## 5. Accounts, authentication, and custom model providers

- [x] 5.1 Implement provider-definition, account, credential-reference, status, and provider-binding stores with redacted serialization.
- [x] 5.2 Implement protected API-key, OAuth PKCE, device-code, refresh, account deletion, authenticated fetch, and explicit secret-reveal broker operations.
- [x] 5.3 Implement idempotent legacy provider-key migration, backup, compatibility reads, account-reference writes, and unavailable-provider preservation.
- [x] 5.4 Implement extension provider registration and the public probe/listModels/stream/cancel/countTokens adapter lifecycle.
- [x] 5.5 Implement RemoteModelClient request normalization, stream validation/backpressure, usage, tool-call events, attachment handling, cancellation, and explicit no-fallback errors.
- [x] 5.6 Integrate extension provider clients and account bindings into MultiProviderModelClient, runtime config application, internal roles, thread routing, and CLI.
- [x] 5.7 Add credential, OAuth/device flow, migration, redaction, provider streaming, malformed stream, cancellation, crash, usage, no-fallback, and headless tests.

## 6. Kun HTTP, events, and CLI

- [x] 6.1 Add authenticated extension registry/install/enable/disable/rollback/uninstall/diagnostics routes with bounded request schemas.
- [x] 6.2 Add authenticated extension view-session/message/event, Agent run, tool, provider, and account routes without exposing the runtime bearer token to guests.
- [x] 6.3 Implement reconnectable extension SSE with cursors, bounded replay, session ownership, backpressure, and cleanup.
- [x] 6.4 Add `kun extension create/validate/pack/install/list/enable/disable/uninstall/rollback/doctor/logs/reload` CLI commands and help.
- [x] 6.5 Add route authorization/schema/error/replay tests and CLI command tests, including GUI-free provider/tool use.

## 7. Electron security bridge and workbench contributions

- [x] 7.1 Register the confined `kun-extension://` protocol and packaged extension Webview preload with strict resource-root, CSP, navigation, popup, partition, permission, and sender controls.
- [x] 7.2 Add protected Main-owned consent/credential surfaces and short-lived action-bound consent tokens for privileged extension operations.
- [x] 7.3 Add extension IPC schemas and preload methods for file selection, registry operations, view sessions/messages/events, accounts, and protected consent.
- [x] 7.4 Implement the renderer ContributionRegistry and replace hard-coded panel modes with built-in/extension contribution IDs while preserving stored layout compatibility.
- [x] 7.5 Render controlled activity/sidebar/editor/topbar/composer/message/settings/menu/notification contributions and sandboxed extension Webviews.
- [x] 7.6 Implement isolated-world host content scripts with route matching, extension-scoped API, protected-surface exclusion, diagnostics, and unsupported-contract warnings.
- [x] 7.7 Build the extension management center for local package/development/index install, enablement, permissions, diagnostics, logs, rollback, and uninstall while leaving UI Plugin/MCP/Skill management separate.
- [x] 7.8 Add Electron guard, sender, consent, protocol confinement, Webview, content-script isolation, contribution, layout, and management-view tests.

## 8. Public SDKs, scaffolding, and examples

- [x] 8.1 Implement the framework-neutral host client, Disposable lifecycle, activation context, command, storage, network, UI, Agent, tool, provider, and authentication APIs.
- [x] 8.2 Implement optional React hooks/components for theme, locale, persisted view state, host messaging, Agent streams, accounts, and provider status.
- [x] 8.3 Implement the extension test harness with fake Host, permissions, workspace, Agent, tool, provider, account, and Webview services.
- [x] 8.4 Implement `create-kun-extension` templates and build/pack scripts for TypeScript, framework-neutral Webview, and React Webview projects.
- [x] 8.5 Add runnable Hello Sidebar, Workspace Dashboard, Agent Assistant, Tool Provider, Streaming Model Provider/Auth, and Direct DOM examples.
- [x] 8.6 Add SDK typecheck, package-export, scaffolder snapshot, example pack/validate, and smoke tests.

## 9. Bilingual developer documentation

- [x] 9.1 Write Chinese and English overview, architecture, quick start, lifecycle, and Manifest reference documentation.
- [x] 9.2 Write Chinese and English workbench contributions, Webview, direct-DOM risk, command, settings, and UX documentation.
- [x] 9.3 Write Chinese and English Agent, tool, provider, accounts/authentication, storage, network, permissions, trust, logs, and quotas documentation.
- [x] 9.4 Write Chinese and English packaging, side-loading, custom Index, CLI, testing, debugging, compatibility, versioning, state migration, release checklist, troubleshooting, and API changelog documentation.
- [x] 9.5 Add README navigation, UI Plugin/MCP/Skill distinction notes, generated API reference links, and documentation/schema/example CI checks.

## 10. Release validation and handoff

- [x] 10.1 Upgrade and pin Electron to a supported stable release and re-run the extension Webview/security baseline.
- [x] 10.2 Run focused Extension API, Kun runtime, Electron bridge, renderer, migration, and example tests and fix introduced failures.
- [x] 10.3 Run `npm run typecheck`, `npm run test`, `npm run build:kun`, `npm run build`, and documentation/package validation with baseline failures separated.
- [ ] 10.4 Validate packaged macOS, Windows, and Linux resources and smoke local package install, Webview, Agent tool, headless tool, and custom provider flows.
  - 2026-07-12 native macOS arm64 evidence: the final `Kun-0.1.0-mac-arm64.dmg` (SHA-256 `23e0f106ae68923b8a53af44fbd8026fb75551174c6d7a541261900688785a2e`) was mounted read-only and its contained `Kun.app` passed `codesign --verify --deep --strict`. The packaged runtime completed `.kunx` install, View Session, headless tool, Agent-to-extension-tool round trip, custom Provider/account streaming, diagnostics, and uninstall directly from the mounted artifact.
  - The mounted DMG's self-contained `Kun.app/Contents/MacOS/Kun` also passed the native Chromium desktop smoke: contribution discovery/click, isolated `kun-extension://` guest loading, body marker and narrow preload bridge, Theme/View-state round trips, host-global isolation, blocked network egress, and popup denial. The smoke used an isolated HOME/userData and left no managed runtime/CDP listener behind.
  - This local artifact is ad-hoc signed (`TeamIdentifier` absent), not Developer ID signed or notarized. Its successful native execution closes the local package/runtime behavior check but does not substitute for the release workflow's signed/notarized, commit-bound macOS artifact and verification record.
  - A translated Linux x64 diagnostic run (Ubuntu 22 amd64 under Docker Desktop/Rosetta, Node 22/npm 10) built the AppImage after exposing and fixing clean-bootstrap, lockfile, and Electron 43/GCC native-rebuild blockers. The final `linux-unpacked` package passed the full packaged backend and Xvfb Chromium desktop smokes; the AppImage SHA-256 was `6dee60947358b65776771e1373874aff58b701ed124b27fe1d164f6e8225b4d9`. This is emulated evidence only, and the static x64 AppImage runtime could not execute on the arm64 translation host.
  - Native Linux PR, stable-release, and daily-prerelease jobs fail closed without disabling Chromium's modern sandbox. Before either desktop smoke, an artifact-independent block enables only available user-namespace kernel toggles on the ephemeral runner and requires `unshare --user --map-root-user /bin/true`. Linux `afterPack` renames the real ELF payload to `<executable>.electron-bin` and installs a fixed same-name launcher: GUI calls unconditionally prepend `--disable-setuid-sandbox`, while `ELECTRON_RUN_AS_NODE=1` CLI calls pass through unchanged; `--no-sandbox` is forbidden, retaining user-namespace and seccomp sandboxing. `appImage.executableArgs` covers only `.desktop`, not direct AppImage execution. The unique final x86_64 AppImage extracts itself into a fresh empty directory; validation rejects symlink or containment escapes for `AppRun`, resources, embedded `app.asar`, launcher, ELF payload, and the single root desktop entry, and requires `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`. Validated resources come only from that artifact and no external `app.asar` is appended; the GUI smoke itself injects no sandbox flag, scrubs inherited `APPDIR`/`APPIMAGE`, sets `APPIMAGE_EXTRACT_AND_RUN=1`, and directly launches the final AppImage. Node orchestration uses `shell: false`; the artifact launcher itself is a fixed `/bin/sh` script whose content is checked exactly. Extraction, synchronous CLI, CDP, and cleanup stages are individually bounded, while the CI AppImage step has a separate 10-minute disaster bound rather than claiming one strict local end-to-end deadline. Future deb/rpm or `app.relaunch()` paths must re-enter the launcher or preserve the flag because `process.execPath` points at the renamed payload. Evidence generation/upload remain ordered after the Xvfb smoke. Self-extraction avoids a FUSE dependency but does not prove FUSE-mounted or installer behavior. This is executable CI coverage, not local native evidence until a commit-bound Linux x64 runner result and artifact are recorded.
  - Non-publishing PR validation now has native macOS, Windows, and Linux package jobs behind the test gate. Each platform builds its final artifact, completes the packaged backend and host-native Chromium smoke (plus final AppImage launch on Linux), then generates a strict `extension-native-evidence-<platform>.json` bound to the full commit, GitHub run/attempt, canonical artifact bytes, and SHA-256 before upload. Stable and daily workflows produce and require the same evidence files. This is executable coverage only until a PR commit runs on those native runners.
  - Remaining release evidence: run the non-publishing validation for a safely isolated commit, run the signed/notarized macOS stable path, record native Windows and direct final-AppImage Linux results, and attach the run URLs, evidence JSON/artifacts, and reviewer sign-off. Workflow ordering and failure propagation are already enforced by the release gate.
- [ ] 10.5 Remove the internal platform gate, verify current-plus-previous API compatibility and legacy-system non-regression, and complete the public release checklist.
  - The internal gate is removed, current-plus-previous API fixtures and legacy regression suites pass, and the automated public release gate passes. Daily prereleases and local release helpers now fail closed before upload/promotion, and a generated-artifact-free Node 22/npm 10 checkout completes `npm ci`. Final checklist sign-off remains pending the signed macOS and native Windows/Linux packaged evidence above.
