# Standalone Kun npm candidates

The npm distribution packages the existing `kun/` Runtime, CLI and TUI. It does
not require the Kun desktop application or Electron. Candidate generation and
acceptance never publish packages or change npm tags.

## Requirements and scope

- Node `>=26.4.0 <27`; acceptance uses 26.4.0 and 26.12.0.
- Intended native targets: macOS arm64/x64, Windows x64, Linux glibc arm64/x64.
  A target is verified only when its real installation receipt passes; preparing
  a workflow is not evidence that the platform passed.
- The package name defaults to `@kun/agent` in `kun/npm/release.json`. This is a
  candidate identifier, not a claim of registry availability or namespace rights.
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

The local candidate has macOS arm64 receipts for both required Node versions,
including npm 11 and npm 12 consumers. Supplementary acceptance uses this entry:

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
native targets and source-inaccessible CI execution remain unverified locally;
namespace rights and registry installation await a separate publication task.

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
