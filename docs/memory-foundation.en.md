# Kun Memory Foundation

The canonical store is `{dataDir}/memory/*.json`; `{dataDir}/memory-index.sqlite3` is a disposable,
rebuildable FTS5 projection. Records are normalized to schema V2 on read without eagerly rewriting
legacy JSON. Every record has `authority: reference` (default) or `directive`. `reference` records —
including user, imported, tool, web, and inferred text — remain untrusted evidence rather than model
instructions. `directive` records are user-approved standing rules and can only be created through
explicit user approval (the settings page, or a `memory_create`/`memory_update` approval carrying
`authority: 'directive'`); imports and distillation always produce `reference`.

Retrieval filters scope and lifecycle before FTS ranking. It combines lexical relevance (0.55), scope
affinity (0.10), type affinity (0.10), freshness (0.10), importance (0.075), and confidence (0.075),
then applies live record and character budgets. Injected memory stays outside the immutable system
prefix and is wrapped as `MEMORY_REFERENCE_DATA` with `untrusted="true"`.

## User rules (directive)

`authority: 'directive'` records are standing user-approved rules. Unlike reference memories they are
not relevance-gated: every turn injects them as a user-authority `<kun_memory_directives>` block.
Rules are limited to `user`/`workspace` scope, 1,000 characters each, and per-turn budgets
(`capabilities.memory.directives.maxRecords`/`maxCharacters`, defaults 20/4,000). Creating or
promoting a rule always requires a human decision — even under full-access auto-allow — and editing a
rule requires `authority: 'directive'` on the update. Imports (kunpack, `kun-memory-v2` archives,
profile import) are downgraded to `reference` and reported; distillation never writes rules. Rules
guide behavior but cannot override Kun policy, sandboxing, tool permissions, approval requirements,
or the latest explicit user instruction. They complement `AGENTS.md`: rules are cross-workspace,
short, and manageable in Settings -> Memory; `AGENTS.md` suits project-level conventions.

## Read-only model tools

Besides the approval-gated `memory_create`/`memory_update`/`memory_delete`, the model can call the
read-only, approval-free `memory_search` (query + scope/authority/type filters) and `memory_list`
(paginated enumeration with `includeDisabled`). Neither exposes hidden agent-context memories nor
mutates retrieval diagnostics.

Canonical writes commit before index projection. Startup reconciliation repairs missing or stale index
rows by stable hash. Missing native SQLite/FTS5 support, corruption, migration/query/projection errors,
and backfill windows fall back to bounded filesystem/n-gram retrieval without deleting malformed
canonical files. Set `KUN_MEMORY_STORE_BACKEND=file` before startup for an explicit rollback.

Diagnostics expose canonical/index counts, malformed/stale counts, backfill/degraded state, sanitized
failure reasons, and a bounded content-free retrieval trace with independent ranking features.

## Feedback ledger and ranking evolution

Feedback is stored in a separate `memory-feedback/` root as an append-only, rebuildable audit
projection owned by Manager. It never replaces `memory/*.json` as the authority and never rewrites
`updatedAt`, `observedAt`, `confidence`, `importance`, or freshness. `retrieved` is recorded only
once the model request carrying the reference block is actually dispatched; `confirmed` requires an
explicit user action; `corrected`
creates a same-scope replacement linked with `supersedes` while retaining the old fact. Events omit
queries, bodies, model output, source excerpts, credentials, and local paths. Collection defaults to
`memory.feedback.enabled=false`, and ledger failure is isolated from retrieval and turn completion.

### Enabling feedback collection

Collection is opt-in. In `{dataDir}/config.json` — the data directory defaults to `~/.kun/data`
unless the Kun data directory setting changes it — set:

```json
{
  "capabilities": {
    "memory": {
      "enabled": true,
      "feedback": { "enabled": true }
    }
  }
}
```

Memory itself must already be enabled (Settings -> Memory, or `capabilities.memory.enabled`); the
GUI preserves the `feedback` subtree whenever it rewrites the managed config. The runtime picks the
flag up on the next hot config apply (for example when Kun settings are saved) or on restart.
Explicit correction stays available even while collection is disabled, because a correction is a
canonical memory mutation rather than feedback collection.

Retrieval frequency, confirmation, correction, freshness, importance, and confidence are currently
observed only by an offline evaluator over anonymous fixtures and are traced independently. The
pre-registered P3 v1 candidate passed development but had no holdout bootstrap gain, so the decision
is no-go: production remains on the lexical/FTS5 foundation with no hidden weight or dormant flag.
Any future production-ranking proposal must use a new version and pass relevance, uncertainty,
safety, privacy, determinism, and resource gates.

### Manual recovery for a malformed ledger tail

When diagnostics report `malformed final event`, feedback appends remain paused so
that unknown data is never followed by new audit events. To recover, stop Kun and
Manager, make a complete backup of `memory-feedback/`, then remove only the final
incomplete event line from the newest active `events-*.jsonl` segment and replace
that segment atomically. Never edit interior events, `checkpoint.json`, or
`aggregates.json`. Restart so `ready()` can rebuild the projection from the valid
prefix, and resume appends only after diagnostics report `ready`. If the corruption
is interior, affects the checkpoint, or its scope is uncertain, do not edit it
manually; keep the backup and leave feedback degraded for maintainer recovery.

### Correction receipt recovery

Each correction writes a resumable receipt under `{dataDir}/memory-feedback-corrections/`
before it mutates canonical memory, so an interrupted correction finishes on the next
startup. When the previous record can never be corrected again — it was purged, deleted,
superseded, or expired, the replacement id is already taken, or the store cannot recreate
the record — the receipt moves to the terminal `abandoned` state instead of retrying and
warning on every startup. Receipts for records that are only `disabled` or `not-yet-valid`
stay `prepared` and retry on the next launch.

An unreadable or hash-mismatched receipt is quarantined in place as `*.corrupt` so one bad
file never blocks reconciliation of the others; inspect it, then delete it manually.
Terminal receipts (`feedback-recorded` and `abandoned`) are pruned to the newest 64 entries
on every reconcile pass, and removing either state by hand is safe: only the operation-id
replay mapping is lost, while the audit events stay in `memory-feedback/`. Never remove
`prepared` or `canonical-applied` receipts — they still own an unfinished mutation.

### Recovering from a full feedback ledger

The ledger is bounded by `capabilities.memory.feedback.maxSegmentBytes` (default 4 MiB)
and `maxTotalBytes` (default 32 MiB) in `{dataDir}/config.json`. When the cap is reached
and compaction cannot reclaim enough space, appends pause and diagnostics report
`degraded`; retrieval and turns continue unchanged. To recover, stop Kun and Manager, make
a complete backup of `memory-feedback/`, then either raise the limits or remove the whole
directory to start an empty ledger. Removing the directory forfeits all feedback history —
retrieval counts plus the explicit confirmation/correction audit trail held by
`checkpoint.json` — but never touches canonical `memory/*.json` records. Do not delete
`checkpoint.json` alone while covered segments are already gone; the surviving
`events-*.jsonl` files no longer contain that history. Restart afterwards and confirm
diagnostics report `ready` before relying on feedback again.

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
