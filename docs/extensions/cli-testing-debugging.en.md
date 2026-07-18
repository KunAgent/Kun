# CLI, Testing, and Debugging

> Extension API: v1
> 中文：[CLI、测试与调试](./cli-testing-debugging.md)
> Related: [Quick start](./quick-start.en.md) · [Packaging](./packaging-and-index.en.md) · [Troubleshooting](./release-troubleshooting-changelog.en.md#troubleshooting)

The Kun CLI covers an external developer's complete flow from scaffolding and validation through development loading, packaging, installation, diagnostics, and cleanup. Except for steps requiring real protected consent, it does not depend on the desktop GUI.

## Command overview

```text
kun extension create
kun extension validate
kun extension pack
kun extension install
kun extension list
kun extension enable
kun extension disable
kun extension uninstall
kun extension rollback
kun extension doctor
kun extension logs
kun extension reload
```

Always confirm arguments with the installed version:

```bash
kun extension --help
kun extension <command> --help
```

Public command names, stable structured output, and diagnostic codes follow Extension API/CLI compatibility policy. Human-readable formatting is not an automation interface.

## Create

The npm scaffolder is recommended for a standalone project, but first verify
that the configured registry actually contains it:

```bash
npm view create-kun-extension version
```

Run the command below only when the preflight returns a version. On `E404`, use
the repository extension examples; do not substitute repository `file:` aliases
for a public installation, and do not install the unrelated unscoped npm
package named `kun` in place of the CLI shipped with Kun.

```bash
npx create-kun-extension my-extension \
  --template node \
  --publisher acme \
  --name my-extension
```

Templates:

- `node`: Node/TypeScript background extension;
- `webview`: framework-neutral Webview;
- `react`: React Webview with official hooks.

`kun extension create` offers an equivalent interactive path. Before writing files, scaffolding validates publisher/name/reserved IDs. It creates a least-privilege Manifest, build/test/validate/pack scripts, and version-matched documentation links. Invalid identity leaves no partial project.

## Validate

```bash
kun extension validate .
kun extension validate ./dist/acme.my-extension-1.0.0.kunx
kun extension validate . --json
kun extension validate . --include dist/chunks --ignore dist/chunks/debug.map
```

Editor, CLI, pack, installer, and Host use the same canonical Schema. Validate checks:

- Manifest and contribution wire Schemas;
- IDs, SemVer, entries, resources, and integrity;
- permission/contribution/activation references;
- `engines.kun`, Manifest/API/current capabilities;
- required `main` for a headless contribution;
- package attack/size/path policy;
- deprecation and Direct DOM risk warnings.

Failure exits nonzero. Each machine diagnostic has stable code, severity, JSON path/operation, extension identity, explanation, remediation, and documentation link and is redacted by default.

## Pack

```bash
kun extension pack . --include dist/chunks --ignore dist/chunks/debug.map --output ./dist
```

Pack validates first, then deterministically collects the Manifest allowlist, resource roots, and explicit includes before generating `kun-extension.integrity.json` and `.kunx`. Repeatable `--include`/`--ignore` accept package-relative regular file/directory paths only; directories are recursive and ignore wins after selection. Do not use globs, absolute paths, `..`, or links. Output includes ID, version, path, SHA-256, compatibility, and permissions.

Pack does not traverse the whole project root, so `node_modules`, `.git`, source/test/cache, and other undeclared files are absent by default. The safety policy rejects sensitive `.env`, credential/secret configuration, private keys, nested `.kunx`, and symbolic links under selected trees. Filename filtering is not a substitute for auditing secrets and source maps before release. See [Packaging](./packaging-and-index.en.md#deterministic-packaging) for the full rules and examples.

## Install and development load

Release package:

```bash
kun extension install ./dist/acme.my-extension-1.0.0.kunx
```

Development directory:

```bash
kun extension install --development /absolute/path/to/my-extension
kun extension reload acme.my-extension
```

Release installation requires protected source/permission review. A pure headless/non-interactive call encountering new consent never pretends approval; it returns interaction-required plus continuation guidance. Development directories are neither copied nor automatically watched/reloaded.

For exact-version custom Index syntax, use `kun extension install --help`. Regardless of entry path, it follows the same HTTPS + Index SHA-256 + package integrity + protected consent flow.

## List and enablement

```bash
kun extension list
kun extension list --json
kun extension enable acme.my-extension
kun extension enable acme.my-extension --workspace /work/project
kun extension disable acme.my-extension --workspace /work/project
```

Structured List projections include installed/selected version, source, signature, compatibility, global/workspace enablement, and health, but no secret. Workspace enablement neither copies the package nor affects other workspaces.

## Rollback and uninstall

```bash
kun extension rollback acme.my-extension --version 0.9.0
kun extension uninstall acme.my-extension
```

Rollback requires a retained compatible package and state snapshot; failure keeps current version/state. Uninstall deactivates and removes code/registry but preserves state/log/account references by default. Permanent data deletion requires separate explicit confirmation and is not hidden in an ordinary uninstall flag.

## Doctor

```bash
kun extension doctor acme.my-extension
kun extension doctor acme.my-extension --json
```

Doctor validates/reports:

- package integrity, source, version selection;
- Manifest/API/Kun engine/RPC negotiation;
- state schema/migration/rollback snapshot;
- permissions, workspace enablement/trust;
- entries, contributions, Host activation;
- PID, restart, circuit, limits, last error;
- Provider/account Bindings using references/status only;
- log location.

It emits no secret, authorization, runtime token, or complete prompt. Automation uses stable codes/JSON fields and never parses human text.

## Logs

```bash
kun extension logs acme.my-extension
kun extension logs acme.my-extension --json
```

Logs combine extension-scoped stdout/stderr/Host lifecycle diagnostics with rotation. Default redaction does not permit extensions to print secrets first; authors must remove credentials/prompt bodies before logging.

## Structured output convention

For commands supporting `--json`:

- stdout contains only a versioned JSON result;
- human diagnostics use the documented diagnostic channel, normally stderr;
- success exits `0`, validation/operation failure exits nonzero;
- errors have stable code, bounded details, and remediation;
- interaction-required is structured and never hangs CI.

A machine consumer must tolerate optional fields added in a minor release of the same API major.

## Stable Extension API Error Codes

Public `ExtensionApiError` contains `code`, `message`, optional `operation`/`extensionId`/`details`/`documentation`, and `retryable`. v1 codes are:

| Category | Codes |
| --- | --- |
| Argument/validation | `INVALID_ARGUMENT`, `VALIDATION_FAILED` |
| Authorization/lookup/conflict | `PERMISSION_DENIED`, `NOT_FOUND`, `CONFLICT` |
| Capability/compatibility | `UNSUPPORTED_CAPABILITY`, `INCOMPATIBLE_API`, `INCOMPATIBLE_MANIFEST`, `INCOMPATIBLE_ENGINE`, `INCOMPATIBLE_RPC` |
| Activation/Host | `ACTIVATION_FAILED`, `ACTIVATION_TIMEOUT`, `HOST_UNAVAILABLE` |
| Cancellation/budget/resource | `CANCELLED`, `BUDGET_EXHAUSTED`, `RESOURCE_LIMIT` |
| Interaction/Provider/account | `INTERACTION_REQUIRED`, `PROVIDER_UNAVAILABLE`, `ACCOUNT_REQUIRED` |
| Protocol/unknown core failure | `PROTOCOL_ERROR`, `INTERNAL_ERROR` |

Do not branch on message text. Use `code`, `retryable`, and operation-specific details. Retry on `retryable` only when the operation is explicitly idempotent and policy permits it.

## Unit tests with `@kun/extension-test`

The test package defaults to no real credentials, models, or Electron and provides deterministic fakes/harnesses for:

- activation/deactivation/time/cancellation;
- permissions/workspace policy;
- commands/storage/network;
- Webview messages/state/theme;
- Agent events/replay/budgets;
- tool invocation/approval/errors;
- Provider normalized requests/streams/backpressure;
- account metadata/status;
- Host crash/timeout/limits.

Illustration:

```ts
import { createExtensionTestHarness } from '@kun/extension-test'
import { activate } from '../src/extension'

test('denies a network call outside the grant', async () => {
  const harness = createExtensionTestHarness({
    permissions: ['network:api.example.com']
  })

  await harness.activate(activate)
  await expect(
    harness.context.network.fetch({
      url: 'https://other.example.com/data',
      method: 'GET'
    })
  ).rejects.toMatchObject({ code: 'PERMISSION_DENIED' })
  await harness.dispose()
})
```

The example uses the public v1 harness and error code. Use same-version types/fixtures for exact fields of other fake services.

## Minimum tests

### Every extension

- fast activation and disposal of every resource;
- required/denied/revoked permission;
- invalid input/output Schema;
- cancellation, timeout, late result;
- state quota and migration;
- errors/log redaction;
- current + previous API major fixture when supported by the publisher.

### Webview

- host message ordering/disposal;
- View state restore and cross-extension/workspace isolation;
- theme/locale/accessibility updates;
- oversized/malformed message rejection;
- direct browser network/navigation/popup denial;
- guest crash and stale session.

### Agent/tool

- owned/foreign thread, sequence replay, budget, steer/cancel race;
- argument/result limits, approval/user-input gate, unknown outcome;
- tool catalog canonicalization/drift and headless path.

### Provider/account

- probe/listModels, every stream event, usage/tool fragments/terminal;
- malformed/duplicate terminal, backpressure, cancellation, Host crash;
- no fallback, multiple/missing/expired accounts;
- fake OAuth/device/refresh, secret redaction, headless interaction-required.

### Direct DOM

- isolated world has no `window.kunGui`, Node, or Electron;
- injection only on declared surface/resources;
- exclusion from protected surfaces;
- disable/revoke cleanup or safe reload;
- missing selector does not affect Kun.

Direct DOM/Electron security baseline requires packaged desktop E2E, not jsdom unit tests alone.

## Development debug loop

```bash
npm run build
npm test
npm run validate
kun extension reload acme.my-extension
kun extension doctor acme.my-extension
kun extension logs acme.my-extension
```

Recommendations:

- log a non-secret correlation ID for each command/tool/Provider call;
- use fake time/streams, not flaky real network;
- inspect admission/permission/circuit in doctor before business logs;
- for a blank Webview, debug CSP/resource/session, never enable Node or disable sandbox;
- repair a selected Provider Binding instead of implementing fallback;
- resolve catalog drift with a new thread/explicit epoch, never hot-edit a pinned Schema.

## Integration and release CI

CI runs at least:

```bash
npm ci
npm run typecheck
npm test
npm run build
npm run validate
npm run pack
```

Then use an isolated Kun profile for install → activation smoke → disable → rollback where applicable → uninstall. Validate representative `.kunx` archives on macOS, Windows, and Linux for path casing, ZIP behavior, permissions, and packaged resources. Provider/tool headless smoke runs without Electron.

Packaged Kun releases have two smoke layers that cannot substitute for each other:

```bash
npm run smoke:packaged-extensions -- --resources /path/to/app/resources
npm run smoke:packaged-extension-desktop
```

The Linux release runner must also execute the final AppImage directly:

```bash
npm run smoke:packaged-extension-appimage
```

- `smoke:packaged-extensions` is the packaged Node runtime smoke. It uses packaged Electron in `ELECTRON_RUN_AS_NODE` mode for `.kunx` install, the Kun Webview Session API, headless tool, Agent/tool, custom Provider/account, doctor, and uninstall, but it does not start desktop Chromium.
- `smoke:packaged-extension-desktop` launches the host-native packaged Electron normally with isolated HOME/userData, removes inherited development-renderer and Kun/model runtime overrides, and accepts only the packaged `file:.../app.asar/out/renderer/index.html` target. After a real CDP contribution click, it checks the exact `kun-extension://` Webview target/body, `Reflect.ownKeys` of the narrow bridge, a complete Theme response, a runtime-backed View-state set/get round-trip, and Node/Electron/`kunGui` isolation. The fixture CSP names only its dynamic loopback canary; CDP bypasses the independent protocol-response CSP for this isolated guest so zero canary requests prove the Host `webRequest` filter blocked egress. `window.open` runs with a user gesture and must both return denied and create no CDP target. Synchronous CLI children and process-tree cleanup are bounded, and runtime/CDP ports must close. With no Linux display, the script launches through `xvfb-run`.
- `smoke:packaged-extension-appimage` runs only on a native Linux x64 runner. It requires exactly one canonically named x86_64 AppImage in `dist`, rejects directories, symlinks, wrong architecture, and stale duplicate artifacts, and invokes that AppImage's own `--appimage-extract` mode into a fresh empty directory. It rejects escaping or symlinked `AppRun`, `resources`, `app.asar`, same-name product launcher, renamed ELF payload, and root desktop-entry paths, and requires the exact launcher line `Exec=AppRun --disable-setuid-sandbox --no-first-run %U`. Independently of artifact contents, Linux workflows enable available user-namespace kernel toggles only on their ephemeral runner and require `unshare --user --map-root-user /bin/true` before either desktop smoke. `afterPack` renames the real Electron binary to `<executable>.electron-bin` and writes a fixed launcher at the original name: normal GUI launches unconditionally prepend `--disable-setuid-sandbox`, while Kun CLI calls with `ELECTRON_RUN_AS_NODE=1` bypass it unchanged. It never uses `--no-sandbox`, so modern user-namespace and seccomp sandboxing remains active. `appImage.executableArgs` protects only the `.desktop` line and does not replace this direct-AppImage entrypoint. Validated resources come only from the final artifact and no external `app.asar` is appended; the desktop test injects no sandbox flag, scrubs inherited `APPDIR`/`APPIMAGE`, sets `APPIMAGE_EXTRACT_AND_RUN=1`, and directly launches the AppImage itself. Node orchestration uses `shell: false`; the artifact launcher itself is a fixed `/bin/sh` script whose content is checked exactly. Extraction, synchronous CLI, CDP, and cleanup stages have their own timeouts, while the CI AppImage step has a separate 10-minute disaster bound. The local command does not claim one strict end-to-end deadline. Any future deb/rpm target or `app.relaunch()` path must re-enter the launcher or explicitly preserve the flag instead of assuming `process.execPath`, which points at `.electron-bin`. Self-extraction avoids a FUSE dependency in CI but does not prove FUSE-mounted execution or distribution-installer behavior.

Both layers must pass on the corresponding operating-system runner before recording packaged Extension smoke evidence for that platform; Linux must additionally pass the final AppImage smoke. Static script tests, the Node runtime smoke, or the `linux-unpacked` desktop cannot substitute for Chromium E2E of the final artifact.

Extension-platform PRs build the final packages and run these smokes separately on `macos-latest`, `windows-latest`, and `ubuntu-latest`; they do not publish a Release. Only after every smoke passes does `npm run evidence:extension-native` create `extension-native-evidence-darwin.json`, `extension-native-evidence-win32.json`, or `extension-native-evidence-linux.json`. The evidence binds the full commit SHA, GitHub run/attempt, canonical artifact name, byte size, and SHA-256, and fails closed for missing or multiple artifacts, the wrong architecture, a directory, or a symlink. The PR macOS package is an ad-hoc artifact for native behavior validation; Developer ID, notarization, and the stapled ticket remain checks of the protected stable-release workflow.

Documentation/example CI also verifies that JSON snippets parse and TypeScript snippets compile, links/anchors resolve, Chinese-English headings and code-block structures align, and public SDK exports/`.d.ts` fingerprints match the Changelog. `npm run check:extension-release-gate` copies the acceptance fixture into a system temporary directory outside the Kun repository and installs freshly generated SDK, React bindings, test harness, and CLI `.tgz` files only; its lockfile may not reference the source tree or a workspace alias. It then typechecks and executes an Agent command, tool, streaming Provider, and CLI validate → pack → install → list → doctor → uninstall. This clean-project gate proves developer artifacts are self-contained, but it does not replace native three-platform packaged-Electron smoke evidence.
