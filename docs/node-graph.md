# Kun Node Graph

Node Graph is an Obsidian-style force-directed map of everything a Kun
workspace knows: conversations, the subagents they use, mounted knowledge bases
and the `[[wikilinks]]` between their documents, durable memories and their
tags, and the workspace files a run changed. It is a **read-only projection**
drawn on a canvas — it schedules nothing and mutates nothing.

## 1. Not Graph Mode

Kun already has a feature called Graph: **Graph Mode** (`kun/src/graph/`,
`docs/graph-mode.md`), the multi-agent orchestration strategy that compiles a
task intent into a validated task graph and schedules constrained subagents.
The two share nothing but the English word "graph". Keep them apart:

| | Graph Mode | Node Graph |
| --- | --- | --- |
| Purpose | Orchestrate subagents for one turn | Navigate what the workspace knows |
| Vocabulary | `GraphRun`, `GraphPlan`, node, attempt, edge | `NodeGraphProjection`, node kind, edge kind |
| Runtime code | `kun/src/graph/` | `kun/src/node-graph/` |
| Contract | `kun/src/contracts/graph-core.ts` | `kun/src/contracts/node-graph.ts` |
| HTTP | `/v1/graphs/*` | `GET /v1/node-graph` |
| Renderer | `components/graph/`, right panel | `components/node-graph/`, `nodeGraph` route |
| Writes | Yes — schedules and persists runs | Never |

Node Graph *reads* Graph Mode run summaries for its changed-file layer. That is
the only coupling, and it is one-directional.

## 2. Data model

### Node kinds

| Kind | Source | Notes |
| --- | --- | --- |
| `workspace` | distinct thread workspace roots | closest analogue to an Obsidian vault |
| `thread` | `ThreadSummary` | label is the thread title |
| `agent` | `thread.agentId` | labeled by id; no profile lookup |
| `knowledgeBase` | `thread.knowledgeBases[]` | one node per mount id, shared across threads |
| `document` | `StoredKnowledgeIndex.nodes` kind `document` | one per indexed file |
| `section` | index kinds `section`/`range`/`page`/`slide`/`worksheet`/`cell-range` | hidden by default in the UI |
| `memory` | `MemoryStore.list()` | tombstoned records are skipped |
| `tag` | `memory.tags[]` | ids are case-folded, so `Naming` and `naming` are one node |
| `file` | Graph Mode `GraphRun.summary.changedFiles` | see §4 |

### Edge kinds

`contains` (base → document → section) · `link` (a `[[wikilink]]` or
`[markdown](link)` between documents) · `mount` (thread → knowledge base) ·
`parent` (thread → `parentThreadId`) · `fork` (thread → `forkedFromThreadId`) ·
`workspace` (thread/memory → workspace) · `agent` (thread → agent) ·
`memoryOf` (memory → source thread) · `tagged` (memory → tag) ·
`touches` (thread → changed file).

A relation whose other endpoint is outside the projection is dropped rather
than rendered as an unlabeled ghost node.

## 2b. Two projections

Node Graph serves two surfaces from one canvas.

| | Code route (`nodeGraph`) | Work tab (Write) |
| --- | --- | --- |
| Question | "what have I worked on, and what does it know" | "how is this vault organised and linked" |
| Endpoint | `GET /v1/node-graph` | `GET /v1/node-graph/folder?root=…` |
| Nodes | workspaces, threads, agents, bases, documents, sections, memories, tags, files | folders, documents, sections |
| Edges | all ten kinds | `contains`, `link` |
| Builder | `node-graph-builder.ts` | `node-graph-folder.ts` |

The **folder projection** keeps `folder` nodes and nests containment straight
from the index's own `parentId` pointers, so the graph mirrors the directory
tree: root → folder → subfolder → document → heading. The workspace projection
deliberately flattens directories away, because there "which folder is this in"
is noise next to the thread and memory layers; in a Write vault it is the point.

**It spans as many roots as it is given.** `root` is a repeatable query param,
and the Work header toggles between the open workspace and every Work workspace.
That is not only a scope convenience — it is what makes a link into a sibling
workspace draw an edge at all, because a target can only be matched against the
roots present in the same projection.

**Links that escape a base are no longer discarded.** `resolveKnowledgeLink`
rejects a target that leaves its own root, so `[[../other-workspace/note]]` used
to vanish. The indexer now keeps those as `externalReferences` (raw target plus
source path, schema **v3**), and the folder projection resolves them against the
absolute filesystem and matches them to a document in *any* projected root,
trying `.md` / `.markdown` / `.mdx` for an extensionless target. Same-root links
still resolve through the index as before.

Bumping the index schema to v3 invalidates persisted indexes, so the first load
after upgrading reports "no ready index yet" and fills in on the next refresh —
the same path a never-indexed base takes.

**Folder projections follow the filesystem on their own.** Two things made a
manual refresh necessary, and both are fixed:

1. `readyIndex` returned whatever was persisted and merely *scheduled* a rebuild,
   so a just-saved edit needed a second request to appear. Folder projections now
   pass `verifyFreshness`, which awaits `ensureIndex` — and that still only
   rebuilds when the scan fingerprint moved, so an unchanged tree costs one stat
   pass. The freshness check runs **before** the 5s index-cache short-circuit;
   checking it after meant a file added within 5s was still missed.
2. Nothing told the renderer a file had changed. `useNodeGraphAutoRefresh` polls
   while a folder graph is on screen (4s), suspends entirely while the document
   is hidden, and catches up immediately on return. There is no push channel for
   arbitrary directory trees, so polling is the honest mechanism; the runtime
   side is cheap enough for it.

Background polls are deliberately invisible: they do not set `status: 'loading'`
(the refresh button would spin forever), a failed poll keeps the graph on screen
instead of replacing it with an error, and an unchanged projection keeps its
existing object identity — compared whole minus `builtAt`, which moves on every
build; labels, paths, timestamps and sizes are all part of the comparison, so a
rename with identical topology still refreshes the inspector — and nothing
downstream recomputes or twitches on a poll that found no edits. Polls also
**coalesce**: only one folder scan is in flight at a time, a tick that lands
mid-scan is dropped rather than queued, and a poll adopts the current load token
instead of bumping it — so a scan slower than the 4s interval still applies its
result, and a background poll can never discard a foreground load. Workspace
projections stay manual; they change through runtime activity, not the
filesystem.

It reuses the same markdown scan rather than duplicating it:
`KnowledgeBaseService.readyFolderIndex(root, mountId)` synthesizes a
`write-workspace` mount for a bare directory and defers to `readyIndex`, so
folder graphs inherit index caching, background rebuilds, and persistence.
`folderMountId(root)` is a stable hash of the path — node ids embed it, so it
must not drift between loads or every node would look new to the layout.

The store carries a `source` discriminator (`{kind:'workspace'}` /
`{kind:'folder'}`), and `reload()` refetches whichever one is on screen. The
Work surface mounts `NodeGraphView` with `source={{kind:'folder'}}` and
`onClose`, which hides the all-workspaces scope toggle (meaningless for one
directory) and swaps in folder-specific empty-state copy. `WriteSidebar` toggles
`workGraphOpen`; `WriteWorkspaceView` renders `WriteNodeGraphSurface` in place of
the editor groups when it is set. That surface lazy-imports the canvas so the
simulation and analysis code never load for users who do not open the graph.

## 2c. Writing links: the `[[` menu

`src/renderer/src/write/wikilink/` adds a reference menu to the markdown editor,
so links can be written by picking a file instead of typing a path.

```
wikilink-query.ts        detect the open `[[` at the caret
wikilink-targets.ts      ranking + the link text a chosen target produces
wikilink-scan.ts         bounded markdown walk of every Work workspace
wikilink-target-service.ts
                         workspace-level cache shared by every editor
use-wikilink-targets.ts  thin hook over the service
wikilink-menu-view.ts    the menu DOM and placement maths, shared
wikilink-codemirror.ts   CodeMirror plugin  (Live + Source modes)
../tiptap/extensions/wikilink-menu.ts
                         ProseMirror plugin (Rich text mode)
../tiptap/extensions/wikilink-mark.ts
                         schema mark: bare [[...]] serializes verbatim,
                         deliberately escaped brackets stay escaped
```

**Both editors, one implementation.** Write has two editors — CodeMirror for
Live and Source, TipTap for Rich text — so the menu ships as two thin plugins
over shared parts. Query detection, ranking, insertion text, and the entire menu
DOM are common; only position mapping differs, because ProseMirror addresses the
document by node positions rather than string offsets
(`findRichWikilinkQuery` maps a block's `textBetween` offsets back to document
positions, using a single-character placeholder for inline leaf nodes so the
mapping stays one-to-one). Preview mode has no editor and therefore no menu.

Two placement details are load-bearing rather than cosmetic. The ProseMirror
layout read is wrapped in `try`/`catch` because it runs inside a plugin view
update, where a throw would take the transaction — and typing — down with it.
And `placementFor` folds in the container's scroll offset, because
`.write-rich-host` scrolls: the caret rectangle is viewport-relative while
`left`/`top` resolve against the padding box, so without it the menu drifts by
exactly how far the document is scrolled.

**Every workspace, not just the open one.** `scanAllWorkspaceMarkdown` walks all
Work workspace roots, and rows for another root are labelled with the workspace
name and an arrow badge. Same-workspace matches outrank equally-good external
ones. The file being edited is never offered.

The scan costs one `listWorkspaceDirectory` IPC call per folder, so it is
deferred until the menu first opens — mounting an editor requests nothing — and
its cache lives in a module-level service (`wikilink-target-service.ts`) shared
by every mounted editor, so any number of editor groups pay for one walk. The
cache is invalidated by workspace-list changes, by file create/rename/delete
actions, and by a 60s TTL that catches edits made outside the app. The walk is
bounded per root (depth 6, 200 directories, 800 files) **and globally per scan**
(800 directories, 3,200 files across all roots), with `node_modules`, `.git`,
`dist`, `build`, `out`, `target`, `vendor` and dotfolders skipped. It is
breadth-first, so a cap trims deep files rather than the shallow ones most
likely to be wanted.

Targets on a different volume (another Windows drive letter, a different UNC
share) are withheld from the menu: no `..` walk can reach them, so the inserted
link could never resolve. `buildWikilinkInsertion` guards the same case for any
other caller by emitting the absolute path rather than an invalid
`../../D:/...` walk.

**Interaction.** Arrow keys move, **Enter, Tab, or Space** accepts, Escape
closes, clicking a row inserts it, hovering moves the selection. Binding Space
is a deliberate trade-off: a space can no longer be typed inside an open `[[`
query. All of it is asserted by dispatching real `keydown` and `click` events
through both editors rather than by calling the commands directly.

**Paths normalize through `workspaceRelativePath` first.** The Write store
carries **absolute** paths (`WorkspaceEntry.path` is `join(root, name)`) while
scanned targets are workspace-relative. Comparing the two directly offered the
file being edited as a link to itself, and diffing them produced insertions that
climbed out of every absolute segment (`../../../../welcome`). A prefix match
alone is not enough either — `/vault-two` must not read as living inside
`/vault` — so the check requires a separator boundary.

**Link text.** Inside one workspace the insertion is a path relative to the
editing file — exactly what the graph's resolver understands. A trailing `.md` is
dropped Obsidian-style, but *only* when the remaining stem has no dot left:
`notes/a.b.md` shortened to `notes/a.b` would look extensioned to
`resolveKnowledgeLink` and stop resolving. Across workspaces the insertion is a
path relative between the two absolute roots.

**No new dependency.** `@codemirror/autocomplete` is not already installed and
the packaged-size gate makes adding one a real cost, so the menu is written
against `@codemirror/view` directly. Config lives in a `Facet` so the view plugin
is module-scoped, which is what lets `acceptWikilinkMenu`, `closeWikilinkMenu`
and `moveWikilinkSelection` be plain exported commands the keymap and the tests
both drive.

**Painting is split across an update and a measure pass.** `coordsAtPos` reads
layout, and CodeMirror forbids that during an update — calling it from
`update()` throws and CodeMirror silently disables the plugin. So rows are built
*and positioned* synchronously from the last known placement, and the measure
pass only refines the position against the caret.

That synchronous placement is load-bearing, not a nicety: an absolutely
positioned box with `auto` offsets falls back to its static position — the last
child of `.cm-editor`, after the scroller, where the editor clips it — so a menu
positioned only in the measure pass is invisible on its first open. Both the CSS
and the plugin set an explicit `left`/`top`, and a test asserts they are non-empty
as soon as the menu opens.

**Opening is not gated on `view.hasFocus`.** An editor receiving typed text is
focused by definition, and reading focus in `refresh()` gave the menu a silent
failure mode where it simply never appeared. Focus loss closes it explicitly via
the `focusChanged` update instead.

**An empty result is always explained, never silent.** With no match the menu
stays open showing "scanning", "no match", or the scan error, so a broken scan
cannot look identical to an empty vault — and `Enter` / `ArrowDown` deliberately
fall through in that state so the editor still gets its newline. Scan failures
are surfaced through the hook rather than swallowed, and the scan also runs on
editor mount so the list is usually ready before the first `[[`.

**Cross-workspace caveat.** Such a link points at a real file on disk, but the
folder projection is rooted at one workspace and `resolveKnowledgeLink` rejects
targets that escape the root, so a cross-workspace reference will **not** draw an
edge in the Work graph. Only same-workspace links do.

## 3. Where the links come from

Nothing new parses markdown. `kun/src/knowledge/knowledge-indexer.ts` has
always collected both `[markdown](links)` and `[[wikilinks]]`
(`collectMarkdownReferences`), resolved them against the mount
(`resolveKnowledgeLink`, which appends `.md` to extensionless targets), and
persisted them as `StoredKnowledgeIndex.references`. Node Graph is the first
surface to *show* that data.

`KnowledgeBaseService.readyIndex(mount)` is the non-blocking read added for this
view: it returns the persisted index only when it is already usable, and
schedules a background rebuild when the index is missing or stale. Opening the
view therefore never pays for a full re-index inline — the first open of a
never-indexed base reports `knowledge base "<name>" has no ready index yet` in
`diagnostics` and fills in on the next refresh.

## 4. Cost boundaries

The projection is assembled by `NodeGraphService` (`kun/src/node-graph/`), which
is the only layer that performs I/O:

- **Threads and memories** are cheap list reads.
- **Knowledge indexes** are read from disk only when ready (above).
- **Changed files** require reading whole Graph Mode run snapshots, because the
  run index does not carry `changedFiles`. The projection's thread scope and its
  run cap (40 most recently updated) are **pushed into the store query** —
  `GraphRunListFilter.threadIds` and `.limit` filter the index entries before
  any snapshot is loaded — so unrelated runs are never read, and a burst of
  runs in another workspace cannot crowd this workspace's runs out of the cap.
  The scan is also **time-boxed** (2.5s, then a diagnostic), and concurrent
  projections of the same scope **share one in-flight scan**. Callers can skip
  it entirely with `changed_files=false`, which the Filters panel exposes as a
  toggle.
- The finished projection is **cached for 10s** per `(workspace, changed-files)`
  pair. `refresh=true` bypasses it.
- Node caps are applied by **priority tier** (`NODE_GRAPH_KIND_PRIORITY`), so a
  vault large enough to hit the 4,000-node cap still renders a navigable
  skeleton of workspaces, threads, bases, and documents instead of an arbitrary
  slice of headings. Truncation always sets `truncated` and adds a diagnostic.

Every failure degrades: a thread-list error, a broken mount, a corrupt run
journal, or a timeout each become a `diagnostics` string and the rest of the
graph still renders.

## 5. HTTP surface

```
GET /v1/node-graph
  ?workspace=<root>        restrict to one workspace root (omit for all)
  &changed_files=false     skip the Graph Mode run scan
  &refresh=true            bypass the 10s projection cache

GET /v1/node-graph/folder
  ?root=<absolute path>    required, repeatable (65+ roots is a 400); the
                           directories to project
  &refresh=true            bypass the 10s projection cache
```

Both are `GET`-only in the main-process allowlist.

A folder request's indexing work is bounded end to end. The route rejects more
than 64 `root` parameters outright; the service then projects at most 12 roots
(the rest are dropped with a diagnostic and `truncated: true`), indexes at most
2 roots concurrently, and hands every root **one shared scan budget** (1,600
files / 96MB per request) on top of the indexer's per-root caps. The budget is
charged only when a root actually rebuilds — a fingerprint match reuses the
stored index for free — and a root refused by the budget serves its last built
index (state `stale`) with a `scan budget reached` diagnostic, instead of
scheduling the same work in the background.

Returns `NodeGraphProjection`: `nodes`, `edges`, per-kind `counts` (taken
*before* truncation), `truncated`, `diagnostics`, `builtAt`.

No new IPC channel was needed, but `runtime:request` is **not** a generic
passthrough: `src/main/ipc/app-ipc-schemas/runtime.ts` validates every path
against an anchored allowlist, so `/v1/node-graph` had to be registered there as
`GET`-only. A renderer-side fetch alone fails with `runtime request path is not
allowed`. The data path stays `Renderer -> preload -> main -> Kun HTTP` via
`rendererRuntimeClient.runtimeRequest`.

## 6. Renderer

The renderer is documented separately, in
[`node-graph-renderer.md`](./node-graph-renderer.md): module map, layout, kind
encoding, Kun style, motion, the overview map, Obsidian parity, analysis,
navigation and export, the query language, and the choice of canvas over SVG.

## 7. Navigation

`nodeGraph` is a full-screen center route, registered the same way as
`schedule` and `workflow`:

- `AppRoute` in `store/chat-store-types.ts`
- `openNodeGraph()` in `store/chat-store-app-actions.ts`
- `openNodeGraphView` + `sidebarView` in `useWorkbenchNavigationController.ts`
- lazy stage in `WorkbenchStageRouter.tsx`
- sidebar row in `components/chat/Sidebar.tsx`
- command palette label and icon in `palette/palette-sources.ts`

The route spans **every workspace by default**, because the cross-project links
(a shared knowledge base, a fork that changed workspace) are the reason to look
at the map; the header toggles down to the active workspace.

## 8. Copy

English and Chinese are fully authored in
`locales/{en,zh}/common/node-graph.json`. The other active locales inherit
English through `withGraphCommonFallback`, which is what keeps
`locale-resources.test.ts` green without machine-translated copy.

## 9. Validation

```
npx tsc --noEmit -p tsconfig.web.json
npx tsc --noEmit -p kun/tsconfig.json
npm run check:file-lines
npm run lint
npx vitest run src/renderer/src/node-graph src/renderer/src/components/node-graph
cd kun && npx vitest run src/node-graph src/server/routes/node-graph.test.ts
```

End-to-end (an isolated runtime, so it cannot collide with a running Kun — see
`AGENTS.md` on the Service Manager owning a canonical data path):

```
KUN_MANAGER_CONTROL_DIR=<scratch>/control \
KUN_MANAGER_SETTINGS_PATH=<scratch>/settings.json \
node ./kun/dist/cli/serve-entry.js serve --port 18977 --data-dir <scratch>/data --insecure
curl -s 'http://127.0.0.1:18977/v1/node-graph?refresh=true'
```

## 10. Known limits

- `agent` nodes are labeled by id; there is no subagent-profile name lookup.
- `file` nodes and `touches` edges exist only for threads that ran Graph Mode,
  because that is the only place Kun durably records which files a run changed.
  Ordinary turns are not scanned — doing so would mean reading every thread's
  full tool-call history on every view open.
- `section` nodes are capped at 60 per document and hidden by default.
- The projection is a snapshot; it does not stream. Refresh is manual.
