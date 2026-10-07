[Back to DESIGN.md](../../DESIGN.md)

## 6. Desktop shell (Electron)

### 6.1 Process roles

- **Main** (`src/main/`) — Node process. Owns the Kun
  child process, settings store, updater, Connect phone runtime,
  file/git/editor helpers, Work services (with internal `write` names), IPC handlers, logger,
  GUI updater, macOS/Windows code-signing glue.
- **Preload** (`src/preload/`) — `contextBridge` surface.
  Exposes a typed `window.kunGui` API to the renderer. No Node
  access leaks into the renderer.
- **Renderer** (`src/renderer/`) — Chromium process. React 19
  SPA. Runs Code (including Design tasks) / Work / Connect phone UIs.

### 6.2 Module layout

```text
src/
  main/
    index.ts                        # app entry, IPC wiring, lifecycle
    ipc/                            # app IPC handlers and Zod schemas
    runtime/                        # runtime adapter (process, host, port, token)
    services/                       # git, workspace, editor, write-* services
    settings-store.ts               # JSON-backed settings store
    claw-runtime.ts                 # Connect phone IM / webhook / scheduled-task engine (internal claw name)
    claw-schedule-mcp-*             # schedule MCP config + standalone server
    gui-updater.ts                  # electron-updater integration
    logger.ts                       # structured logger
    resolve-kun-binary.ts     # CLI / dev-script / packaged binary resolver
  preload/
    index.ts                        # contextBridge surface (window.kunGui)
    index.d.ts                      # API type definitions
  shared/                           # types + constants shared by main and renderer
  renderer/
    src/
      App.tsx                       # Suspense shell
      AppShell.tsx                  # routes Workbench / Settings / InitialSetup
      agent/                        # AgentProvider interface + Kun impl
      components/                   # Workbench, Settings, ChangeInspector, …
      design/                       # Design-mode canvas, artifacts, prompts, graph, persistence
      hooks/
      lib/                          # formatters, helpers, plan store, etc.
      locales/{zh,en}/              # i18n
      plan/                         # Plan-mode prompt, store, panel
      store/                        # Zustand chat store + actions
      write/                        # Work workspace, inline edit, RAG (internal path)
```

### 6.3 The kunGui API surface

`window.kunGui` is the only thing the renderer is allowed to call
on the system. It includes:

- `runtimeRequest(path, method, body)` — generic JSON request to
  Kun.
- `startSse(threadId, sinceSeq, streamId)` / `stopSse` /
  `onSseEvent` — SSE subscription for a thread.
- `getSettings` / `setSettings` — typed settings I/O.
- Workspace / file / git helpers (`pickWorkspaceDirectory`,
  `listWorkspaceDirectory`, `readWorkspaceFile`,
  `writeWorkspaceFile`, `watchWorkspaceFile`, `getGitBranches`,
  `switchGitBranch`, `createAndSwitchGitBranch`).
- Terminal (`createTerminalSession`, `writeTerminalSession`,
  `resizeTerminalSession`, `closeTerminalSession`,
  `onTerminalData`, `onTerminalExit`).
- Work services (`exportWriteDocument`,
  `requestWriteInlineCompletion`,
  `listWriteInlineCompletionDebugEntries`,
  `clearWriteInlineCompletionDebugEntries`).
- Connect phone / internal Claw (`getClawStatus`, `runClawTask`,
  `startClawImInstallQr`, `pollClawImInstall`,
  `createClawTaskFromText`, `mirrorClawChannelMessageToFeishu`,
  `onClawChannelActivity`).
- Shell / notifications / updater / logger (`openExternal`,
  `showTurnCompleteNotification`, `getGuiUpdateState`,
  `checkGuiUpdate`, `downloadGuiUpdate`, `installGuiUpdate`,
  `onGuiUpdateState`, `logError`, `getLogPath`, `openLogDir`).

Every method on this surface is typed in `src/shared/kun-gui-api.ts`
and validated at the IPC boundary by Zod schemas in
`src/main/ipc/app-ipc-schemas.ts`.

### 6.4 The runtime adapter

The main process owns the Kun child process through a
`LocalHttpRuntimeAdapter`:

- `kunRuntimeAdapter.resolveExecutable(settings)` —
  finds the right binary or falls back to the dev script.
- `kunRuntimeAdapter.ensureRunning(settings)` — starts
  the child if it isn't already.
- `kunRuntimeAdapter.stopAndWait()` — graceful shutdown
  for app exit.
- `kunRuntimeAdapter.getBaseUrl(settings)` — base URL
  for the current settings.
- `kunRuntimeAdapter.reclaimPort(port)` — recover a
  stuck port.

`runtimeRequestViaHost` is the single chokepoint: it ensures the
runtime is running, then forwards the request with the bearer
token, default 15 s GET / 60 s POST timeout, and an `Accept:
application/json` header.

---

## 7. Renderer (React 19 + Zustand 5)

### 7.1 Top-level shape

```text
App
  └── AppShell  (Suspense)
        ├── Workbench          (routes: chat / design / write / claw / plugins / schedule; claw = Connect phone)
        │     ├── Sidebar      (left, drag-resizable, 268 px)
        │     ├── Topbar       (translucent glass strip)
        │     ├── Center column
        │     │     ├── MessageTimeline  (Code / Connect phone)
        │     │     ├── DesignWorkspaceView (Design)
        │     │     └── WriteWorkspaceView (Work; internal component name)
        │     ├── Right inspector  (optional, 360 px)
        │     │     ├── ChangeInspector
        │     │     ├── TodoPanel
        │     │     ├── DevBrowserPanel
        │     │     ├── PlanPanel
        │     │     ├── WorkspaceFilePreviewPanel
        │     │     ├── WriteAssistantPanel
        │     │     ├── DesignAssistantPanel
        │     │     ├── DesignImplementPanel
        │     │     └── SddAssistantPanel
        │     ├── PluginMarketplaceView  (route = 'plugins')
        │     └── ScheduleTasksView      (route = 'schedule')
        ├── SettingsView       (route = 'settings')
        └── InitialSetupDialog (first-run)
```

### 7.2 State

A single `useChatStore` (Zustand) holds all renderer state. The
store is split into modules under `src/renderer/src/store/`:

- `chat-store.ts` — main store, route, thread list, workbench
  panels, status flags.
- `chat-store-types.ts` — the store's TS surface.
- `chat-store-app-actions.ts`, `chat-store-claw-actions.ts`,
  `chat-store-side-actions.ts` — action creators grouped by
  domain (`claw` is the internal Connect phone domain).
- `chat-store-runtime-helpers.ts` — pure helpers around the
  runtime.
- `chat-store-schedulers.ts` — busy watchdog, completion poll,
  startup probe.

Persistence is layered:

- `localStorage` — UI-only state (panel sizes, collapsed flags,
  composer model, write thread registry, code workspace roots,
  fork registry).
- `electron-store` (main) — settings, Connect phone config (internal Claw key), write
  workspace config.
- `~/.kun/data` (Kun) — threads,
  events, sessions, usage.

### 7.3 The AgentProvider interface

The renderer talks to the runtime through one interface,
`AgentProvider` (`src/renderer/src/agent/types.ts`). Today the
only implementation is `KunRuntimeProvider`
(`src/renderer/src/agent/kun-runtime.ts`), which is a thin
HTTP/SSE client. Its DTOs live in
`src/renderer/src/agent/kun-contract.ts` and the
DTO-to-ChatBlock mapping lives in
`src/renderer/src/agent/kun-mapper.ts`.

`getProvider()` (in `registry.ts`) returns a single cached
instance. `resetProviderCacheForTests()` exists for unit tests
and must not be called outside of them.

### 7.4 Workbench internals

`Workbench.tsx` is the central layout component. It reads the
current route from the store, lays out the left sidebar, center
surface, and optional right inspector, and lazy-loads the heavy panels
(`ChangeInspector`, `TodoPanel`, `PlanPanel`, `WorkspaceFilePreviewPanel`,
`DevBrowserPanel`, `PluginMarketplaceView`, `ScheduleTasksView`)
via `React.lazy`. Panel sizes and the selected right-panel mode are persisted to `localStorage`
under `deepseekgui.layout.*` keys.

The chat timeline is a virtualized list of `ChatBlock`s. Each
block kind has its own renderer:

- `user` / `assistant` — markdown, with a streaming shimmer on
  the assistant block.
- `reasoning` — collapsible block with monospace text.
- `tool` — file_change, command_execution, tool_call, with
  inline detail and a "show in inspector" action.
- `compaction` — fold summary.
- `approval` — pending / allowed / denied / error states.
- `user_input` — structured question with option buttons.
- `system` — informational messages (e.g. runtime up, runtime
  down, model switched).

### 7.5 Workbench routes, one store

The store distinguishes the main workbench and entry routes through `route`
(`chat`, legacy `design`, `write`, `claw`, `plugins`, `schedule`, `workflow`) plus
thread metadata. The sidebar exposes Code / Work; Code and Design are immutable
task types selected in the shared composer, with Design rendered in Code's right
whiteboard. Connect phone uses the legacy `claw` route internally. Switching does
not change the runtime contract, only which renderer and local workflow state the store pulls in.

- **Code** — default mode, full agent flow, workspace roots,
  todo panel, changes inspector, plan panel, file preview, and dev browser.
- **Design task** — listed with Code tasks and uses the same timeline, composer,
  model, permissions, and workspace controls. Artifacts persist under
  `.kun-design/`; the right whiteboard previews interactive HTML and AI-image outputs.
- **Work** — the internal write-thread registry isolates Work sessions
  from Code / Design / Connect phone sessions. Uses the same Kun but a
  separate `WRITE_ASSISTANT_THREAD_TITLE` namespace. Inline
  completion and selected-text agent go through dedicated
  main-process services.
- **Connect phone** — internal `claw` channel registry. Each IM channel has its
  own thread id, model, and workspace root. Runs through
  `ClawRuntime` (main process), which calls Kun over
  HTTP just like the renderer does.

### 7.6 Settings surface

Settings is one `SettingsView` with a searchable sidebar and lazily loaded pages.
Keep new pages inside this system instead of styling them from scratch:

- **Navigation model** — `settings-navigation.ts` owns categories, groups,
  platform/extension guards, the decorative `tone` of every icon tile, and the
  sidebar search matcher (short label, full label, group, and description).
- **Icon tiles** — `SettingsIconTile` draws a soft tinted tile in the sidebar
  (solid when selected) and a large tile in the page header. Tones resolve to
  theme tokens (`--ds-accent`, `--ds-success`, `--ds-warning`, `--ds-danger`,
  `--ds-skill`, and mixes of them), so plugin and dark themes stay coherent.
- **Shared controls** — `settings-controls.tsx` (cards, rows, segmented tabs with
  a sliding indicator, switches, notices, disclosures) and
  `settings-button.ts`. Pages with more than four primary tabs pass
  `contentSized` so labels wrap instead of truncating.
- **Styles** — `settings-layout.css` (geometry and responsive layout),
  `settings-chrome.css` (motion tokens, sidebar, header, status, toasts,
  skeleton), `settings-controls.css` (surfaces, states, fields),
  `settings-pages.css` (page-specific lists), and `settings-buttons.css`.
  Everything is scoped to `.ds-settings-surface` and uses theme tokens only.
- **Motion** — micro (140 ms), standard (220 ms), and slow (320 ms) durations
  with an ease-out curve; springs only for thumbs, chevrons, and pop-ins. Page,
  tab-panel, and disclosure entrances are opacity-only so controls never move
  under measurement, and every animation is disabled under reduced motion.
- **Loading** — `lazySection` preloads a page's chunk on sidebar hover, focus,
  or search match, so opening it does not flash the skeleton.

---

## 8. Data persistence (renderer + main)

| Data | Where | Format | Owner |
| --- | --- | --- | --- |
| Settings | OS app-data dir | JSON | `JsonSettingsStore` (main) |
| Session list / workbench layout | `localStorage` | JSON | Renderer |
| Design thread registry | `localStorage` | JSON | Renderer |
| Design artifacts | workspace `.kun-design/` | HTML / PNG / JSON / Markdown | Renderer + Kun |
| Work thread registry (internal `write` key) | `localStorage` | JSON | Renderer |
| Connect phone channels | OS app-data dir | JSON | `JsonSettingsStore` |
| Threads / turns / events | `~/.kun/data` | JSON + JSONL | Kun |
| Usage counters | Kun data dir | JSON | Kun |
| Skill / MCP files | Kun data dir + workspace | Markdown / JSON | Kun + renderer |
| GUI logs | OS app-data dir / `log/` | NDJSON | `logger.ts` |
| Inline completion debug | OS app-data dir | NDJSON | `write-inline-completion-service.ts` |

Default OS app-data paths (derived from the Electron `productName`,
which current builds ship as `Kun`):

- macOS: `~/Library/Application Support/Kun`
- Windows: `%APPDATA%\Kun`
- Linux: `~/.config/Kun`

Uninstalling the app does not remove app data. Documented in
the README and respected by the install script.

---

## 9. Key subsystems

### 9.1 Tool execution & approval

- `LocalToolHost` (`kun/src/adapters/tool/local-tool-host.ts`)
  holds the registered tools and their policies. Policies:
  `auto`, `on-request`, `suggest`, `never`, `untrusted`.
- A tool with `shouldAdvertise(ctx)` is gated at the listing
  layer too — this is how `create_plan` stays scoped to plan
  threads.
- Approval requests emit a `RuntimeEvent` of kind
  `approval_requested`; the GUI shows the approval block and
  POSTs the decision to `/v1/approvals/{id}`. The agent loop
  resumes on `allow`, errors out on `deny`.

### 9.2 Plan mode

Plan threads expose a `create_plan` tool. The renderer advertises
a `GuiPlanContext` on the active turn, the loop gates the tool,
the model writes a Markdown plan, and the renderer stores it as a
`GuiPlanArtifact`. The `Build` button promotes a plan artifact
into a new `agent`-mode thread, preserving the plan as the
opening turn.

Plan-mode prompt injection sits *after* the immutable prefix as
a second system message, so the cached prefix is untouched.

### 9.3 Context compaction

`ContextCompactor` estimates token count, folds long histories
into a single `compaction` item, and always preserves the
immutable prefix's pinned constraints. Soft threshold 16k
tokens, hard threshold 24k tokens. The GUI renders the
compaction block inline with a "show replaced" detail.

### 9.4 Work completion & RAG

- **FIM short completion** — debounced 650 ms, max 96 tokens,
  min accept score 0.52. Used while typing.
- **Inspirational long completion** — debounced 2.8 s, max
  256 tokens, min accept score 0.36. Used at sentence/paragraph
  boundaries.
- **RAG** — Work workspace Markdown files are indexed
  on-demand with BM25 + keyword match; relevant snippets are
  injected as hidden Markdown comments.
- **Selected-text inline agent** — selected text is captured
  with file path and line range, then submitted as a
  structured prompt. The agent returns Markdown edits the
  user can apply or ignore.
- **Export** — `write-export-service.ts` converts the current
  Markdown document to HTML / PDF / DOC / DOCX, preserving
  headings, lists, code blocks, tables, and local images.

### 9.5 Connect phone automation

- `ClawRuntime` (main process) creates and reuses Kun
  threads for each IM channel and each scheduled task.
- Feishu / Lark integration uses `@larksuiteoapi/node-sdk`.
  Install is device-flow QR code; the renderer polls
  `claw:im-install:poll` until authorized.
- Webhook / relay is a small HTTP server in `ClawRuntime` that
  POSTs inbound webhooks into a Kun thread.
- Scheduled tasks are detected from natural-language Connect phone
  prompts (`claw-scheduled-task-detector.ts`) and stored under
  `claw.scheduledTasks` in settings.
- A standalone `claw-schedule-mcp-server` process can be
  launched separately (`--claw-schedule-mcp-server`) to host
  the schedule tools over MCP, hiding the macOS dock icon when
  running headless.

### 9.6 Updater

`electron-updater` driven by `gui-updater.ts`. Channels:
`stable`, `beta`, `nightly`. The Settings page surfaces state
and check / download / install actions. macOS / Windows only;
Linux users build from source.

### 9.7 Logging

`logger.ts` writes structured NDJSON to the OS app-data log
directory. The renderer can open the log dir, and `log:error`
lets any UI surface report a category / message / detail
tuple. A startup trace is enabled by
`DEEPSEEK_GUI_STARTUP_TRACE=1` and prints to stdout for
postmortem timing.

---

## 10. Security model

- **Auth** — every `/v1/*` request carries
  `Authorization: Bearer <runtime-token>` unless the runtime
  was started with `--insecure` (local dev only). The token is
  generated and stored in settings.
- **Approval policy** — `auto` (default), `on-request`,
  `untrusted`, `never`, `suggest`. Per-tool policies can override.
- **Sandbox mode** — `read-only` / `workspace-write` (default) /
  `danger-full-access` / `external-sandbox`. Enforced by the
  workspace inspector and the file/tool adapters.
- **Renderer isolation** — `contextIsolation: true`, no
  `nodeIntegration`, no `webviewTag` exposure. The renderer
  only sees the `window.kunGui` API surface.
- **External links** — `openExternal` is the only way to leave
  the app; URLs are validated against an allow-list.
- **Markdown rendering** — `rehype-harden` strips unsafe
  nodes. Code blocks go through `shiki` with a fixed theme.
- **Settings file** — written atomically, debounced, never
  read on the renderer side. Legacy `codewhale` / `reasonix`
  keys are migrated to `kun` once and discarded.

---

## 11. Constraints (do not violate)

These are enforced by `docs/AGENTS.md` and reflect real product
decisions. New work must respect them.

- **One live agent runtime: Kun.** No second live
  provider, no provider switcher, no runtime diagnostics
  panel, no legacy CodeWhale / Reasonix process path.
- **No UI surface for runtime internals.** No AgentSwitcher,
  no ConnectionStatusBar, no RuntimeDiagnosticsDialog, no
  RuntimeInsightsPanel, no `/usage` or `/runtime` slash
  command.
- **Saved settings only contain `agents.kun`.** Old keys
  may only appear in migration.
- **Renderer does not implement agent logic.** Approvals,
  steering, compaction, fork, resume, usage — all come from
  Kun endpoints, never re-implemented in React.
- **No new drawing / design starter card** in the core
  workbench.
- **No emoji in production copy or as functional UI
  affordance.**

If a feature request appears to require violating a constraint,
escalate before coding.

---

## 12. Extension guide

When you need to add a new capability, follow this path. It's
intentionally boring.

1. **Add the protocol field.** New Zod schema in
   `kun/src/contracts/`. Run `npm --prefix kun run
   build`.
2. **Add the agent behavior.** In `kun/src/loop/`,
   `kun/src/services/`, or a new port + adapter pair
   under `kun/src/ports/` and `kun/src/adapters/`.
3. **Add the HTTP route.** New file under
   `kun/src/server/routes/`, registered in
   `routes/index.ts`.
4. **Map the endpoint / event in the GUI.** Add to
   `src/renderer/src/agent/kun-contract.ts` and the
   mapper `kun-mapper.ts`; expose the call in
   `kun-runtime.ts`.
5. **Add settings only under `agents.kun`.** Anything
   else gets migrated to it.
6. **Add i18n strings to both `zh` and `en` locale files.**
7. **If the surface needs a new visual element, add it to
   this file's YAML frontmatter first.** Don't invent tokens
   in the JSX.
8. **Verify** with `npm run typecheck && npm test && npm run
   build`.

---

## 13. Verification

Minimum checks for any change to the design, runtime, or
build:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke (full list in `docs/AGENTS.md`):

- Code: create thread, stream reply, approve / deny, interrupt.
- Work: open workspace, request inline completion, run
  selected-text agent.
- Connect phone: save settings, run a manual task through a Kun
  thread.
- Settings → Agents: shows only Kun.
- Cache telemetry on a hot thread should stay ≥ 90% hit.

If any check fails, the change is not ready.

---

## 14. Key files index

| Concern | File |
| --- | --- |
| App lifecycle | `src/main/index.ts` |
| Runtime adapter | `src/main/runtime/kun-adapter.ts` |
| HTTP forwarding | `src/main/runtime/runtime-host.ts` |
| Child process | `src/main/kun-process.ts` |
| Settings | `src/main/settings-store.ts`, `src/shared/app-settings.ts` |
| IPC | `src/main/ipc/register-app-ipc-handlers.ts`, `src/main/ipc/app-ipc-schemas.ts` |
| kunGui API | `src/preload/index.ts`, `src/shared/kun-gui-api.ts` |
| Agent provider | `src/renderer/src/agent/kun-runtime.ts` |
| DTO mapping | `src/renderer/src/agent/kun-mapper.ts` |
| App shell | `src/renderer/src/AppShell.tsx` |
| Workbench | `src/renderer/src/components/Workbench.tsx` |
| Chat store | `src/renderer/src/store/chat-store.ts` |
| Connect phone runtime | `src/main/claw-runtime.ts` |
| Work services | `src/main/services/write-*-service.ts` |
| Workspace/editor services | `src/main/services/workspace-*.ts`, `src/main/services/workspace-editors.ts` |
| Tokens / styles | `src/renderer/src/styles/*.css`, `src/renderer/src/index.css` |
| Agent loop | `kun/src/loop/agent-loop.ts` |
| Immutable prefix | `kun/src/cache/immutable-prefix.ts` |
| HTTP routes | `kun/src/server/routes/` |
| Tool host | `kun/src/adapters/tool/local-tool-host.ts` |
| Model client | `kun/src/adapters/model/compat-model-client.ts` |
| Cache doc | `docs/kun-cache-optimization.md` |
| Architecture doc | `docs/kun-architecture.md` |
| Contribution doc | `docs/kun-contributing.md` |

---

## 15. References

- `docs/kun-architecture.md` — single-runtime plan and
  GUI拆改范围.
- `docs/kun-cache-optimization.md` — cache hit rate
  measurement, stable prefix rules, tool pair healing.
- `docs/kun-contributing.md` — port & adapter / FCIS
  patterns, four PR archetypes.
- `kun/README.md` — CLI flags, env vars, data dir layout,
  HTTP API.
- `docs/AGENTS.md` — agent runtime notes (constraints enforced
  on contributors).
- `README.md` / `README.en.md` — product-level overview.

This file is the design source of truth. When the code and this
file disagree, **this file is wrong** until you change both.
