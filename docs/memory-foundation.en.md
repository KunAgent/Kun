# Kun Memory Foundation

The canonical store is `{dataDir}/memory/*.json`; `{dataDir}/memory-index.sqlite3` is a disposable,
rebuildable FTS5 projection. Records are normalized to schema V2 on read without eagerly rewriting
legacy JSON. Every record has `authority: reference`, so user, imported, tool, web, and inferred text
remains untrusted evidence rather than model instructions.

Retrieval filters scope and lifecycle before FTS ranking. It combines lexical relevance (0.55), scope
affinity (0.10), type affinity (0.10), freshness (0.10), importance (0.075), and confidence (0.075),
then applies live record and character budgets. Injected memory stays outside the immutable system
prefix and is wrapped as `MEMORY_REFERENCE_DATA` with `untrusted="true"`.

Canonical writes commit before index projection. Startup reconciliation repairs missing or stale index
rows by stable hash. Missing native SQLite/FTS5 support, corruption, migration/query/projection errors,
and backfill windows fall back to bounded filesystem/n-gram retrieval without deleting malformed
canonical files. Set `KUN_MEMORY_STORE_BACKEND=file` before startup for an explicit rollback.

Diagnostics expose canonical/index counts, malformed/stale counts, backfill/degraded state, sanitized
failure reasons, and a bounded content-free retrieval trace with independent ranking features.

## Source setup and validation

Install Git, Node.js 22.19+ (Node 22 LTS is recommended), npm, and configure at least one model
connection. Then run:

```powershell
npm ci
npm run dev
```

Prebuilt native packages normally avoid a compiler. If `better-sqlite3` must compile locally on Windows,
install Python 3 and Visual Studio 2022 Build Tools with Desktop development with C++. Standard
`npm run dist:win` packaging also needs the latest `MSVC v143 - VS 2022 C++ x64/x86
Spectre-mitigated libs` component matching the installed v143 toolset, such as v14.44-17.14. Verify
Node FTS5 with the command below. ASAR packaging from a non-administrator terminal also requires
Windows Developer Mode so electron-builder can create unpacked-asset symlinks; an elevated PowerShell
is the alternative.

```powershell
node -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(v)');console.log(d.prepare('select sqlite_version() v').get());d.close()"
```

On Windows, verify the Electron ABI separately:

```powershell
$env:ELECTRON_RUN_AS_NODE = '1'
& .\node_modules\electron\dist\electron.exe -e "const D=require('better-sqlite3');const d=new D(':memory:');d.exec('CREATE VIRTUAL TABLE t USING fts5(v)');console.log('electron fts5 ok');d.close()"
Remove-Item Env:ELECTRON_RUN_AS_NODE
```

If postinstall reports that no Electron prebuild exists, the app still runs through filesystem fallback.
After installing the native toolchain, build the Electron ABI module with:

```powershell
$env:npm_config_runtime = 'electron'
$env:npm_config_target = node -p "require('electron/package.json').version"
$env:npm_config_disturl = 'https://electronjs.org/headers'
$env:npm_config_build_from_source = 'true'
$env:GYP_MSVS_VERSION = '2022'
npm rebuild better-sqlite3
Remove-Item Env:npm_config_runtime, Env:npm_config_target, Env:npm_config_disturl, Env:npm_config_build_from_source, Env:GYP_MSVS_VERSION
```

When more than one Visual Studio Build Tools version is installed, set
`$env:GYP_MSVS_VERSION = '2022'` before `npm run dist:win`, then remove the variable afterward.

The root `better_sqlite3.node` can match only one ABI at a time. The Electron 43 source app needs ABI
148, while the current Node 24/Vitest process needs ABI 137. Before Node/Vitest tests, run
`npm rebuild better-sqlite3` to restore the Node binding. Repeat the Electron rebuild above before
starting the app again. TypeScript-only builds are unaffected by this switch.

Run focused and repository checks:

```powershell
npm --prefix kun run test -- src/memory/memory-contracts.test.ts src/adapters/hybrid/hybrid-memory-store.test.ts src/memory/memory-store-contract.test.ts src/loop/memory-instructions.test.ts
npm --prefix kun run eval:memory-retrieval
npm run build:kun
npm run check:file-lines
npm run lint
npm run typecheck
npm run test
npm run build
git diff --check
```

The checked-in anonymous evaluation currently changes Recall@K from 0.500 to 0.833, Precision@K from
0.139 to 0.333, MRR from 0.389 to 0.833, scope leaks from 1 to 0, and selected context from 655 to 478
characters. This is a deterministic lexical regression suite, not a production-quality claim; semantic
or vector retrieval remains a separate follow-up requiring privacy, scale, and performance evidence.

For manual verification, create a unique workspace memory in Settings -> Memory, retrieve it from a new
turn, inspect index coverage and the last-retrieval explanation, restart and retry, then verify
edit/disable/restore/delete/import/export and cross-workspace isolation. Imported records should show
`imported/imported` evidence. Repeat with `KUN_MEMORY_STORE_BACKEND=file` to validate fallback behavior.

See the [Chinese guide](./memory-foundation.md) for the complete data layout, migration behavior, and
step-by-step checks.
