# Agent Runtime Notes

Kun has one agent implementation: the bundled **Kun** runtime. Runtime process
lifecycle is client-owned. For one `(canonical data directory, runtime flavor)`
slot, a normal GUI or TUI session owns at most one live `kun serve` process;
another normal client must report an ownership conflict instead of attaching,
replacing, or stopping it.

The GUI starts a supervised child when automatic startup is enabled and stops
that exact child on real application quit. Hiding the window, closing to the
tray, or leaving macOS resident without a window is not a quit. A default TUI
starts its own Runtime and stops that exact instance when the command exits.
`--url` and `--no-start` are explicit non-owning TUI modes and never stop the
target Runtime. Service Manager remains the independent election and canonical
data-plane authority across ordinary GUI/TUI exits and Runtime restarts.

Do not add a second live provider, provider switcher, runtime diagnostics panel,
or legacy CodeWhale/Reasonix process path. Code (including Design tasks), Work,
and Connect phone all enter the same Kun HTTP/SSE boundary. Connect phone still
uses the internal `claw` name, and Work retains the internal `write` name, for compatibility.

## Client Surface Boundary

- Every turn records its initiating surface (`gui`, `tui`, `cli`, `api`, `im`,
  or `extension`). Continuations and delegated child turns inherit it.
- Provider kind `gui` is reserved for capabilities that require the desktop
  workbench, such as Design canvas mutation or Computer Use. Those providers
  must not be advertised or executable on TUI/CLI/API/IM turns.
- Runtime-backed goals, todos, plans, Skills, MCP, attachments, approvals,
  structured input, and subagents are shared Kun capabilities, not GUI tools.
- Keep the immutable Kun system prompt client-neutral. Put interface-specific
  guidance in the dynamic per-turn context after the stable prefix.
- Never switch a process-global tool registry or prompt based on whichever
  client connected most recently. Explicit non-owning clients may coexist with
  an owner, and every accepted turn must retain its own surface.

## Client-Owned Runtime Lifecycle

- Normal GUI/TUI startup is mutually exclusive within the same Service Manager
  profile and runtime flavor. The default Manager profile binds one canonical
  data directory; production and development flavor slots remain independent.
  Additional concurrently owned profiles require an explicitly isolated
  Manager control directory, not merely a different `dataDir` argument.
- A live or starting foreign owner fails closed with actionable guidance. Do
  not reuse it merely because its build matches, and do not replace it merely
  because its build differs.
- Normal GUI quit and every default TUI exit path must request graceful shutdown
  of the exact owned instance, wait for process exit, and conditionally clear
  only matching discovery/Manager registration state. An ownership IPC channel
  is the abnormal-parent-exit fallback.
- Close-to-tray, window hide, and normal macOS no-window residency keep the GUI
  Runtime alive. A saved `closeAction: quit`, platform Quit command, updater
  quit, or real application exit must enter the quit barrier.
- The GUI restart button restarts only the current Electron process's Runtime.
  It must not scan for all user processes, stop a TUI owner, touch another data
  directory/flavor, or restart Service Manager.
- An exact authenticated legacy `launchMode: shared` daemon with no client-owner
  metadata may be retired once before the first client-owned launch. Ambiguous
  legacy identity fails closed and never authorizes a broad process scan.
- Service Manager may have zero live Runtime slots. It remains the sole physical
  owner of canonical business data and does not execute agent turns itself.

## Allowed Extension Path

1. Add protocol fields in `kun/src/contracts/`.
2. Add agent behavior in `kun/src/loop/`, `kun/src/services/`, or a
   new port/adapter under `kun/src/ports/` and `kun/src/adapters/`.
3. Add HTTP endpoints under `kun/src/server/routes/`.
4. Map the endpoint/event in `src/renderer/src/agent/kun-runtime.ts` and
   `src/renderer/src/agent/kun-mapper.ts`.
5. Add settings only under `agents.kun`.

## Agent-Managed Plan Worktrees

- `agents.kun.planExecution.useWorktreeByDefault` defaults to true for Direct
  plan builds. Settings -> Worktrees can change this default, and an individual
  plan may temporarily build in the current workspace. Graph keeps its normal
  current-workspace flow and its own node isolation.
- On execution, Renderer first saves the plan, then reads the exact local
  repository root, checked-out branch, and dirty-file count through the generic
  Git branch API. A non-Git workspace, unavailable Git, or detached HEAD blocks
  the send with a concrete error.
- Renderer injects a fixed Git lifecycle protocol and the authoritative plan
  snapshot into the next user input on the current task. It does not fork or
  select another task, change the task workspace, close the plan panel, create
  a host run record, or monitor integration.
- The Agent creates a uniquely named temporary branch/worktree, performs all
  implementation and validation there, rebases when the target moved, uses
  `merge --ff-only`, and cleans up only after ancestry or unchanged-work proof.
- Uncommitted source-checkout changes remain exactly as-is and are excluded
  from the worktree baseline. The Agent must never stash, reset, clean, switch,
  commit, or otherwise manipulate them. If they block integration, preserve the
  temporary worktree/branch and report the recovery details.
- Repository paths, branch names, prefixes, titles, and plan Markdown are
  structurally encoded inside the user input. None of this dynamic context may
  enter the immutable system prefix, including when switching Code and Design.
- Legacy `planBuildRunId` and admission fields may still be parsed from stored
  history, but they are inert: they do not freeze input, recover a run, rebind a
  workspace, or receive special task presentation.

## Automatic Plan And Build

- `agents.kun.lab.autoPlanBuild.enabled` gates the GUI-only Code composer mode.
  It defaults off and never becomes a Kun thread/turn mode: the first turn is
  `plan`, and a matching continuation is an ordinary Direct `agent` turn or an
  existing one-shot scheduled task.
- Renderer intent records bind the exact workspace, thread, reserved plan path,
  admitted plan turn, and stable request ids. Recovery must match the successful
  `create_plan` result by canonical workspace/reserved path before dispatching;
  terminal status from any other turn is stale and cannot fail the intent.
- The legacy recovery-mismatch attention state is retryable when its reserved
  plan appears later. Active tasks continue through the normal ChatStore send
  path so the build turn streams in the current UI; background tasks use the
  target-thread API with the same idempotency key.
- Automatic worktree defaults are independent from manual plan execution. Both
  immediate and scheduled builds reuse `preparePlanBuild` and the prompt-managed
  worktree protocol; the scheduler must not create a second nested worktree.
- Scheduled Automatic requests always choose a fresh exact wall-clock time.
  Expired time, invalid model selection, missing plan content, detached HEAD, or
  failed worktree preparation requires attention and must never fall back to an
  immediate/current-workspace build.
- Graph is not an Automatic build target. All Automatic settings and dynamic
  intent facts remain renderer/app settings state and must not enter Kun config
  or the immutable system prefix.
- Thread-activity event long polls must receive a Main-process timeout greater
  than their server `wait_ms`; generic GET timeouts make background completion
  state stale and can strand Automatic intents.

## Forbidden Paths

- No `AgentSwitcher`.
- No `ConnectionStatusBar`.
- No `RuntimeDiagnosticsDialog` or runtime self-check UI.
- No CodeWhale/Reasonix adapter, process manager, RPC bridge, updater, or
  importer.
- No legacy drawing/painting starter card outside the current Design mode.
- No `/usage` or `/runtime` slash command that opens a runtime control panel.
  The standalone TUI may expose `/usage` as a read-only report backed by
  `GET /v1/usage`; it must not add runtime diagnostics or control actions.

## Legacy Data Rule

Old persisted keys may be read only inside settings migration:

- `agentProvider: codewhale | reasonix | deepseek-runtime` maps to `kun`.
- `agents.codewhale`, `agents.reasonix`, and legacy `deepseek` values seed
  `agents.kun` once.
- Saved settings must contain only `agents.kun`.
- Old Connect phone (internal Claw) `agentThreadIds.codewhale/reasonix` fold into
  `agentThreadIds.kun`.

## Verification

Run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke:

- Code can create a Kun thread, stream a reply, approve/deny tools, and
  interrupt a turn.
- CodeWhale parity endpoints still work through Kun: thread search/archive
  filters, fork, session resume, request_user_input submit/cancel, and usage.
- Cache telemetry uses DeepSeek native `prompt_cache_hit_tokens` /
  `prompt_cache_miss_tokens`; hot Kun turns should stay above 90% cache
  hit after the stable prefix is warm.
- Immutable prefix drift and malformed tool-call/tool-result history must be
  caught before a request reaches DeepSeek.
- A Code-workbench conversation can choose Code or Design for every next turn;
  accepted turns freeze their own surface while the Code-owned thread and
  timeline remain stable. The first accepted Design turn locks only its
  document/output/style profile, and later Code turns remain valid.
- Direct plans use the Agent-managed worktree protocol by default, leave dirty
  source files untouched, and preserve unresolved worktree/branch state for
  manual recovery. Graph does not receive that protocol.
- Work can open the workspace, request inline completion, and use selected-text
  assistant actions.
- Connect phone can save settings and run a manual task through a Kun thread.
- Settings -> Agents shows only Kun.
- Real GUI quit removes its exact Runtime process; close-to-tray keeps it alive.
- A default TUI exits with no owned Runtime left behind, while `--url` and
  `--no-start` leave the external Runtime untouched.
- A second normal GUI/TUI for the same data-directory/flavor slot receives an
  ownership conflict; after the first owner exits, the next owner reads the
  same persisted threads and settings.
- GUI restart changes only the GUI Runtime PID/instance and leaves Service
  Manager and unrelated Runtime processes unchanged.

The full plan is in
[`docs/kun-architecture.md`](./kun-architecture.md).
