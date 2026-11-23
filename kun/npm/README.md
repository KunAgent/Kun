# Kun standalone agent

This npm distribution runs the same Kun agent as the desktop application. It
requires Node.js >=26.4.0 <27. Supported targets are macOS arm64/x64, Windows
x64, and Linux glibc arm64/x64. TUI uses the installation's Node interpreter
with experimental FFI enabled; it does not download another Node runtime.
The payloads actually included in a local candidate are listed in
`package.json` under `kunNpm.targets`. Preparing without the Windows ownership
payload excludes Windows from that candidate; full release acceptance requires
real receipts for every intended target.

The package name is recorded in `package.json`. Local candidate archives can
be installed without publishing:

```sh
npm install -g /absolute/path/to/candidate.tgz
kun --version
kun --help
```

Provide a model configuration through `--config`, `KUN_CONFIG`, or the existing
Kun config file. Credentials can be supplied through the provider's environment
variable (for the default provider, `DEEPSEEK_API_KEY`). Never put credentials in
shared command examples or logs.

```sh
kun run --config /absolute/path/to/config.json --workspace . "Summarize this project"
kun chat --config /absolute/path/to/config.json --workspace .
kun tui --config /absolute/path/to/config.json
kun serve --config /absolute/path/to/config.json
kun exec --config /absolute/path/to/config.json --workspace . --list-tools
```

Bare `kun` opens the terminal UI. The HTTP/SSE server retains its existing
authentication, threads, approvals, attachments and event replay contract.
User/workspace Skills and MCP servers use their existing configuration and
trust rules. Desktop bundled Skills, extensions, canvas, Computer Use, media
services, and Office/PPT toolchains are not included. Missing optional tools
do not prevent the native agent from starting.

The default data profile is shared with existing Kun installations. Close its
current owner before starting another normal client. Explicit `--url` and
`--no-start` TUI connections do not own the remote stack. To run independent
profiles concurrently, isolate the data directory, manager control directory
and settings path. Exiting an owner stops its Manager, Runtime and managed
work processes. Installation and uninstallation do not remove saved data.

Use npm to update this distribution. `kun update` never installs a desktop or
historical standalone archive for an npm installation. Check `command -v kun`
(POSIX) or `where kun` (Windows) when multiple command installations exist.
No command in this package forcefully replaces a desktop installation or PATH.

Production dependencies are bundled at their verified build-lock versions.
SQLite prebuilds and TUI native libraries are included, so installation does
not compile code or run dependency build scripts. The shrinkwrap file records
the inventory; installation does not rely on npm honoring shrinkwrap. External
Claude/Cursor SDK executors are not included in this native-agent profile.

This package provides a CLI and the existing HTTP/SSE API, not a stable
JavaScript embedding SDK. See LICENSE and THIRD-PARTY-NOTICES.txt.
