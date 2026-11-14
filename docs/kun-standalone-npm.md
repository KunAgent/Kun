# Standalone Kun npm candidates

The npm distribution packages the existing `kun/` Runtime, CLI and TUI. It does
not require the Kun desktop application or Electron. Candidate generation and
acceptance never publish packages or change npm tags.

## Requirements and scope

- Node `>=26.4.0 <27`; acceptance uses 26.4.0 and 26.12.0.
- Intended native targets: macOS arm64/x64, Windows x64, Linux glibc arm64/x64.
  A target is verified only when its real installation receipt passes; preparing
  a workflow is not evidence that the platform passed.
- The selected package names are `@kunagent/agent` and
  `@kunagent/agent-win32-x64` in `kun/npm/release.json`. Authenticated npm account
  `kunagent` owns this namespace. The `0.4.5-rc.1` pair has its own complete Gate A evidence. The earlier
  `@kun/agent@0.4.5` candidate retains its original identity.
- Core file/shell tools, model connections, HTTP/SSE, user Skills, MCP,
  attachments and subagents use the existing Runtime configuration and policies.
- Desktop canvas/Computer Use bridges, desktop bundled Skills/extensions and
  Office/PPT/media toolchains are not supplied by the npm profile. Missing
  optional integrations do not require installing the desktop app to use Kun.
- External Claude/Cursor SDK executors are not bundled; configure external harnesses separately.
- The published CLI contract does not introduce a public in-process SDK.

## Build a local candidate

From a development checkout with its normal build dependencies installed:

```sh
npm run pack:kun:npm
```

Run packaging under a supported Node version. Staging uses compiled Runtime
output and the complete materialized production dependency bundle, not
Electron-rebuilt native modules. Tarball integrity pins all downloaded inputs;
SQLite prebuilds for every supported target have pinned upstream digests. npm 12
ignores shrinkwrap, so the file is an inventory rather than the install mechanism. Candidate outputs are under `.cache/kun-npm/`; they are local artifacts,
not source files to commit. The pack result identifies the tarball and digest.
Use the exact reported tarball path in subsequent commands.

The main package installs only `kun`. It does not install `kun-dv`, run a service
during installation, modify PATH or force replacement of an existing desktop
command. Check `command -v kun` on POSIX or `where kun` on Windows if multiple
installations are present. A project's local npm bin avoids global ambiguity.

## Install and run a candidate

These examples use a candidate tarball path, not a published npm version:

```sh
npm install --global /absolute/path/to/candidate.tgz
kun --version
kun --help
```

Alternatively, install into a normal project and use `npx --no-install kun`.
Model access is configured through the existing config/environment/CLI options;
an explicit config does not require a desktop settings file. For example:

```sh
kun run --config /absolute/path/to/config.json --workspace /path/to/project "Explain this project"
kun chat --config /absolute/path/to/config.json --workspace /path/to/project
kun tui --config /absolute/path/to/config.json
kun serve --config /absolute/path/to/config.json
```

Keep credentials in environment variables or owner-readable config, not shell
arguments. `serve.baseUrl`, `serve.endpointFormat` and `serve.model` use the same
provider contract as the desktop Runtime. A full endpoint path remains an
explicit endpoint-format choice. See `kun/config.example.json` and the Runtime
README for supported settings. Help and version work without model credentials.

A minimal independent config can be written without the desktop settings UI:

```json
{
  "serve": {
    "dataDir": "/absolute/path/to/kun-data",
    "baseUrl": "https://api.deepseek.com",
    "endpointFormat": "chat_completions",
    "model": "replace-with-your-model-id",
    "approvalPolicy": "on-request",
    "sandboxMode": "workspace-write"
  }
}
```

Replace the model id and provider URL with your configuration. Set
`DEEPSEEK_API_KEY` in the launching environment for the default API-key provider,
and set `KUN_RUNTIME_TOKEN` when using the authenticated HTTP server. TUI/API
clients can answer approvals; a noninteractive `run` command exits with an
actionable error when a required interactive decision has no answering client.

TUI reuses the supported installation interpreter with its required FFI flag;
the npm entry does not download another Node runtime. The desktop installation
keeps its existing interpreter/handoff mechanism.

## Profiles and shutdown

The default persisted data location stays unchanged. A normal TUI or foreground
server owns the stack it starts and closes its Manager/Runtime/work descendants
on exit. Two normal clients cannot own the same canonical data profile. A
conflict does not authorize stopping the other application or selecting an empty
history directory.

For deliberately concurrent instances, explicitly isolate all three of dataDir,
`KUN_MANAGER_CONTROL_DIR` and `KUN_MANAGER_SETTINGS_PATH`; tests use fixture
directories only. Explicit TUI `--url` / `--no-start` connections remain
non-owning and cannot stop their host. User/workspace Skills and MCP are enabled
through existing config and trust rules.

## Test the actual artifact

```sh
npm run smoke:kun:npm -- --tarball /absolute/path/to/candidate.tgz --output /absolute/path/to/receipt.json
npm run smoke:kun:npm -- --tarball /absolute/path/to/candidate.tgz --output /absolute/path/to/integrations.json --integrations
npm run test:kun:npm
```

The rc build version is `0.4.5-rc.1`, recorded with channel `frontier` in
`kun/npm/release.json`. The npm build wrapper supplies this identity consistently
to both native-helper and Runtime builds. The private Runtime source and desktop
remain at `0.4.5`; npm records `runtimeSourceVersion` separately, and desktop
regression requires the identical emitted JavaScript buildId.

The smoke installs into new prefix/cache and project directories, then drives
the installed commands against local fixtures. It never imports the source
Runtime or uses a real model account. Receipts distinguish passed, failed and
not-run cases. Local host tests cannot prove an inaccessible source filesystem
or an OS/CPU that was not actually exercised.

The integration variant exercises user Skills, a self-contained stdio MCP server,
a packaged non-GUI extension, image attachments, goals/task/plan records, native
subagents, API approval choices and structured input. The core suite also checks
profile conflicts and independent instances, startup failure, owner loss and
uninstall preserving data. Noninteractive `kun run` returns nonzero when required
approval/input cannot be answered; the persisted engine status remains intact
and the client explains how to continue through TUI or API.

Every core run also verifies that installed `run --json` emits one parseable
document with completed status and persisted public items. JSONL, text, stdin,
an actual UTF-8 prompt file and terminal chat have separate checks. Config tests
use independent profiles for file-only, environment and CLI precedence, including
a conflicting GUI projection. They verify the actual request URL, model and a
digest of the fixture credential; receipts never include credential contents.
Absent GUI settings, missing credentials and malformed config are tested separately.

Add `--history` to exercise the pinned official 0.4.4 desktop release for the
current native target. This happens after the desktop-independent core tests:
the driver verifies the historical release's SHA-256, extracts it without
installing it, and runs its own bundled interpreter and dependencies. The actual
older binary creates history, which the npm candidate reopens in place and from
a replacement package path. The old reader must reject an unsupported registry
schema injected only into a copy; uninstall must preserve the historical data,
settings and configuration. This establishes per-OS upgrade compatibility,
not automatic path migration between operating systems.

The read-only `kun-npm-artifact` workflow builds Windows ownership components
first, then packs one canonical main tarball on Linux for all five targets and
both Node versions. The helper manifest records its version, source commit and
binary digests; staging rejects mismatched provenance. There is no publisher
job, npm credential or write permission.

Install jobs export a checksummed allowlist of independent test drivers, then
delete the entire checkout including its Git object database. The runner verifies
the actual CPU/OS and exact Node version before using the artifact. Runtime source,
workspace packages, repository dependencies and Git history are absent. The
consumer uses a fresh prefix/cache and ordinary project installation on the
runner's temporary disk; compiler command guards audit installation. This is
filesystem source isolation, not a claim of an OS security sandbox or an image
without preinstalled developer tools.

`reuse_candidate_run_id` can select the original immutable candidate artifact
from an earlier run. The producer verifies all tarball digests before forwarding
them; consumers require that exact digest and candidate source commit. The
checksummed test-driver commit is recorded separately. Acceptance improvements
therefore do not require rebuilding an already verified Runtime candidate.

Windows uses the real `CreatePseudoConsole` API through Python's standard library.
The global `.cmd` shim, new terminal prompt, fixture response, advertised interrupt
key and `/quit` are exercised. Native tests load the installed addon, acquire a
Unicode-path lock, execute actual Job-owned children/grandchildren, verify owner
loss cleanup, and reject missing or corrupt helpers without starting a stack.
The same install also exercises live-work lifecycle checks before uninstall;
Windows uses actual PID/listener state at Manager close rather than POSIX signal
callbacks as its evidence.

`check-kun-npm-matrix.mjs` rejects missing targets, mixed tarball digests, missing
source-isolation evidence, absent lifecycle checks and simulated/forced ConPTY
results. `--smoke-only` requires all ten native combinations; it does not mark
the broader artifact gate complete. `--report-only` writes the remaining full
Gate A requirements to `artifact-readiness.json` without granting release authority.

Complete Gate A collection also requires the matching packaged-desktop receipt
and global validation. Run these from the development checkout, after collecting
all native receipts. Arguments below are artifact/evidence paths, not registry
versions:

```sh
npm run check:kun:npm-gate-a-global -- --candidate /candidate/directory --desktop-receipt /evidence/desktop.json --output /evidence/global.json
npm run check:kun:npm-gate-a -- --candidate /candidate/directory --receipts /evidence/native --global-evidence /evidence/global.json --desktop-receipt /evidence/desktop.json --output /evidence/readiness.json
```

The collector verifies candidate identity, command exit codes and log digests,
genuine historical producers, the matching desktop build and the complete
matrix. It writes `artifactReady: true` only when every Gate A criterion passes.
A missing, stale or failed input replaces any previous successful result with
an incomplete result. Registry readiness and publication remain false.

The [complete artifact matrix](https://github.com/KunAgent/Kun/actions/runs/43575785241)
passed all ten combinations against candidate source commit
`d0dd66e1252db133cccb74ef02419f0ccad31298`. All jobs consumed the same main
tarball, SHA-256
`f1bf1db01806c90d454a6f5b033fcfc9c11f97b6c02b22761a847e757a646b5a`.
The receipts contain 536 passing operation checks. The checksummed test-driver
commit is `fa6a5969f3cf899cdc3893aaad9549859ab6bdfb`. These are the environments
actually tested, not certified minimum OS or glibc versions:

| Native target | Runner environment | Node 26.4.0 | Node 26.12.0 |
| --- | --- | --- | --- |
| darwin-arm64 | macOS 15, Darwin 24.6.0 | pass | pass |
| darwin-x64 | macOS 15 Intel, Darwin 24.6.0 | pass | pass |
| win32-x64 | Windows Server 2025, build 26100 | pass | pass |
| linux-arm64 | Ubuntu 24.04, glibc 2.39 | pass | pass |
| linux-x64 | Ubuntu 24.04, glibc 2.39 | pass | pass |

Node 26.4.0 used npm 11.17.0; Node 26.12.0 used npm 11.20.0. Every target
also used its own pinned official 0.4.4 desktop release to create and reopen real
historical state. Earlier native/local npm 11/12 receipts retain their original
run and candidate identities; they are not relabeled as this complete run.
Supplementary acceptance uses this entry:

```sh
npm run smoke:kun:npm-compatibility -- --tarball /absolute/path/to/candidate.tgz --output /absolute/path/to/compatibility.json --node /absolute/path/to/node-26 --historical-resources /path/to/historical/Kun.app/Contents/Resources --desktop-resources /path/to/current/Kun.app/Contents/Resources
```

Use `--only lifecycle`, `--only history`, or `--only desktop` for a focused run.
The driver installs the exact tarball in a fresh prefix. Lifecycle fixtures keep
real shell/MCP children and grandchildren active, record PID/birth identities and
listeners, and verify normal shutdown while Manager remains reachable. A killed
owner uses the existing independent guard budget; its receipt separately records
Runtime exit before Manager and eventual work-process reclamation. Manager
readiness failure is injected into the actual child interpreter before startup.

History is generated by a real signed historical desktop binary (app 0.4.4,
bundled Runtime 0.4.5-control.2), then read and extended through npm, a replacement
package path and the matching signed 0.4.5 desktop. Receipts record the app, CLI
and Runtime versions separately rather than inferring one from another.
Thread/config/settings/memory/usage/goal/task/attachment state is checked in place;
uninstall must preserve its bytes. The old-reader rejection case deliberately
injects an unsupported storage schema into a COPY. That fault case is separate
from the authentic cross-version corpus and is not a claimed product schema.

Desktop acceptance verifies Developer ID signing and an identical Runtime buildId,
then runs the existing packaged CLI smoke and a real turn/tool/shutdown check.
The synthetic capture/permission smokes remain separate repository requirements.
TUI cancellation and actual SQLite indexing also have local receipts. Other
native targets and source-inaccessible execution are covered by the CI matrix
above. All 23 Gate A criteria passed for the earlier `@kun/agent@0.4.5`
candidate after strict collection of the ten native receipts, global
typecheck/build/related tests and the matching signed desktop receipt. The
selected `@kunagent` prerelease requires its own complete Gate A candidate.
The earlier candidate remains artifact-ready and unpublished;
registry readiness is false. Earlier OS/glibc releases remain outside verified
support. Namespace/publisher checks and registry acceptance belong to Gate B.

## Update and uninstall

For an npm installation, `kun update` explains the npm update path. It does not
run the historical archive updater or replace a desktop application. Stop the
owned stack before replacing the package. Once a version is actually available
in the selected registry, use an explicit npm install of that version to update.
Do not assume the candidate name/version is already published.

Uninstalling the npm package removes the npm-managed files/command, not the
user's profile. Existing compatible history can be reopened after a package
replacement. Package rollback does not roll back or delete business data;
incompatible older versions must reject the store according to existing rules.

Desktop releases remain independently packaged and signed, using their bundled
fixed Runtime. This npm channel does not restore the old standalone TUI archive
feed, publish a Node archive, or migrate the desktop app to a global npm package.

Namespace registration, the disabled publisher workflow and the separate
prerelease/bootstrap steps are described in [npm publication](./kun-npm-publication.md).

Complete validation can run source typechecks/build/tests on an isolated CI
worker with `global_checks_only`, binding its receipt and hashed logs to the
same candidate digest/buildId. A separate `desktop_data_only` Mac CI job checks
old producer -> actual npm installation -> desktop -> npm uninstall in one
profile. Its disposable ad-hoc desktop is a data fixture only. Developer ID
signing and packaged CLI/turn/tool/shutdown evidence come from the separate
production-signed desktop receipt; both are required by the complete collector.

For an additional local desktop regression, `--materialize-archive` requires
`--native-receipts` containing the already-passing actual npm matrix. It verifies
and extracts the original tarball, and records that method explicitly. Removal
of that materialized directory is not labeled npm uninstall; actual npm install
and historical-data-preserving uninstall remain mandatory in the native matrix
and the dedicated desktop data job. Use `--desktop-data-receipt` when collecting
separate sequential data and production signing evidence.

The selected `@kunagent` 0.4.5-rc.1 set is now artifact-ready and unpublished.
The [native matrix](https://github.com/KunAgent/Kun/actions/runs/43586928198)
passed ten combinations and 536 operation checks; the
[build validation](https://github.com/KunAgent/Kun/actions/runs/43589957579) and
[sequential desktop data validation](https://github.com/KunAgent/Kun/actions/runs/43593189350)
also passed. Production signing/CLI regression and synthetic capture/permission
checks passed locally against the same JS buildId. Registry readiness remains
false and the publication policy remains disabled.
