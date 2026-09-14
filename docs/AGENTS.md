# Agent Runtime Notes

Kun has one agent implementation: the bundled **Kun** runtime. A normal GUI or
TUI owns its application session: Service Manager, its `kun serve` process, and
the work processes started through its managed launchers. One canonical data
directory has one application owner across production and development flavors.
Another normal client reports an ownership conflict; it cannot attach to,
replace, or stop that owner's stack.

Closing the GUI main window quits the application on every platform. The quit
barrier closes admission and recovery first, drains Runtime and desktop work,
and stops the owned Service Manager last. Ordinary minimization and auxiliary
window closes do not quit. Old `ask`, `tray`, and `closeToTray` preferences
normalize to `closeAction: quit` and no longer enable background residency.
`--url` and `--no-start` are explicit non-owning TUI modes; they disconnect on
exit and never stop the external stack. Persisted conversations, settings,
memory, usage, and task definitions remain in their original data directory.

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

## Application-Owned Process Lifecycle

- `DesktopProcessStack` owns GUI Manager startup, session fencing, recovery, and
  shutdown. Runtime `autoStart: false` does not make Manager independent: the
  GUI still owns the Manager needed for its data services.
- A canonical data directory and settings path belong to one application
  session across all runtime flavors. Concurrent independent profiles must
  explicitly isolate dataDir, controlDir, and settingsPath. Preserve the
  default data location and existing history; never silently select another.
- A live or starting foreign owner fails closed with actionable guidance. Do
  not reuse it because its build matches, or replace it because builds differ.
- Main-window close, platform Quit, updater exit, and storage relocation use
  the same shutdown barrier. Close admission and restart/recovery timers before
  awaiting cleanup; collect each failure without skipping remaining resources.
- Flush GUI mutations and drain Main/Runtime consumers before closing Manager.
  Verify actual process exit before clearing matching registrations or writer
  ownership. A shutdown acknowledgment, sent signal, or stopped flag is not
  proof of exit. Shared shutdown deadlines must leave time for escalation.
- The GUI restart button replaces only its current Runtime. Service Manager
  stays in the same application session. Manager failure recovery belongs to
  the application owner and must stop old consumers before rebinding a new
  Manager generation; app-owned Runtime must never independently elect one.
- Owned launchers register processes before user commands can run. POSIX uses
  a dedicated process group and owner-loss guard; Windows uses a native Job
  launcher that assigns suspended children before resuming them. PTY, daemon,
  LSP, MCP, and other managed helpers must await their entire tree on shutdown.
- Process groups and descendant polling are not an OS sandbox for arbitrary
  rapid `setsid` or double-fork escapes. Test the supported adapters with real
  processes; record any platform or packaging gaps instead of claiming full
  containment based on a mocked signal or a single-platform run.
- Default TUI/foreground serve bootstrap their own full stack and stop it on
  normal exit, signals, or startup failure. External `--url` / `--no-start`
  clients neither acquire shutdown authority nor extend an owner's lifetime.
- Legacy retirement requires authenticated identity, matching canonical paths,
  and an atomic idle/admission check. Ambiguous identity or live external work
  blocks migration; it never authorizes a broad user-process or port scan. An
  explicitly requested `kun manager retire --data-dir <directory>` can retire
  a verified idle legacy Manager under the matching control/settings profile;
  it rejects application-owned Managers and live Runtime slots.
- Service Manager remains the sole physical writer of canonical business data
  and does not execute agent turns. It may have zero Runtime slots while its
  owner is open; it exits after consumers when that owner closes. Phone
  connectivity and scheduled execution stop with the application. Reopening
  reads existing history; it does not delete or recreate business data.

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
  importer. (This bans the legacy external-tool/diagnostics importer; it does
  not cover the `/import` command that brings other coding agents' instruction
  files into Kun's own `AGENTS.md`.)
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
- Main-window close and platform Quit remove the exact owned Runtime, Manager,
  guard, and managed descendants. Ordinary minimize keeps the session alive.
- A default TUI exits with no owned Runtime or Manager left behind, while
  `--url` and `--no-start` leave the external stack untouched.
- A second normal GUI/TUI for the same canonical data directory receives an
  ownership conflict; after the first owner exits, the next owner reads the
  same persisted threads and settings.
- GUI restart changes only the GUI Runtime PID/instance and leaves Service
  Manager and unrelated Runtime processes unchanged.

The full plan is in
[`docs/kun-architecture.md`](./kun-architecture.md).
