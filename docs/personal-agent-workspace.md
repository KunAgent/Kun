# Personal Agent execution workspace

## Implementation plan

This increment takes interaction ideas from [OpenDots](https://github.com/CopilotKit/OpenDots),
without copying its code or replacing Kun's runtime, browser, artifact store or approval model.

1. Join the current private request, Room run, runtime thread and turn on the server.
   Only a live, current, GUI-owned execution may supervise a browser.
2. Connect that identity to the existing Agent browser panel. Expose a small status
   entry in private chat, while retaining the existing native origin/action consent,
   takeover and Stop controls. Keep developer preview in group Rooms unchanged.
3. Connect immutable artifact versions back to their validated source conversation
   and run. Keep existing file resolution, snapshots, versions, export and previews.
4. Fence stale responses, task changes and unmount cleanup. Exercise the actual
   Electron UI with isolated offline model/browser fixtures and capture evidence.

## Scope and ownership

The browser panel is a view of an existing execution. Opening it never admits a turn,
resumes history, opens a website, approves an action, or changes the active Code task.
The inline status observer is read-only and does not mount a browser or grant supervision.
Browser controls are bound to both thread and expected turn. A delayed control or mount
request for an earlier turn fails closed instead of operating a newer task in the same thread.

The private activity endpoint reconstructs this binding from persisted records.
Authority refresh follows Room events and the existing 1.5-second fallback poll;
this is not a new per-action policy engine or a claim of instantaneous revocation.
Main-process controls independently reject an unexpected browser turn. A message,
artifact or task card cannot nominate an arbitrary browser thread. Pending admission,
stopping, recovery-required, terminal and IM-origin executions do not gain a live browser
binding. IM's existing native approval/input cards remain unchanged. A selected historical
run is read-only; switching back to the current browser is an explicit presentation action.

Switching Agent, project, private context or task immediately drops prior scoped UI data.
Old asynchronous reads, actions and native view cleanup cannot restore another task's
browser state. Hiding the browser releases its supervision through the existing manager. The
initial empty host participates in the existing supervision handshake before
the first tab exists; consent overlays hide native page content while keeping
the visible approval surface supervised.
The renderer does not create an independent task or browser state machine.

## Delivered files

The private Files rail opens Saved files, with a Workspace tab for the existing
file tree. The searchable saved-file list remains backed by AgentArtifactLibrary. A preview uses the
selected immutable version and its recorded provenance; its source navigation is returned
only after validating the private Room, Agent and source run/message. Missing, deleted,
foreign or inconsistent sources have no active navigation control. Source links do not
change permissions or infer ownership from titles, paths or model text.

Open-file actions still go through the existing content resolver and workspace-file
resolver. Versions remain snapshots: opening a previous version is not permission to
rewrite it or silently replace the current Work document's conversation. Existing Write
thread mappings and compare-and-swap save semantics are preserved.

## Lifecycle and limits

Loading, runtime errors with Retry, stopping and recovery states are distinct from a live
browser. An unavailable authority read removes live controls until refreshed. Restart
rebuilds execution identity from durable runtime records and browser state from the
existing browser manager; it never replays a browser action just because the UI reopened.

This PR does not add realtime voice, a scheduler, a new artifact database, a second agent
runtime, or a new permission policy. A commitment's `nextCheckAt` still does not schedule
execution. No live IM authorization, account login, purchase or credential operation is
part of the offline verification.

## Verification

Focused unit coverage checks exact request/run/thread/turn ownership, scope changes,
permission/epoch invalidation, IM exclusion from browser supervision, selected history,
late reads/events/actions/mounts, the first-tab Main/renderer supervision handshake,
turn-scoped main-process controls, artifact provenance
and search/list loading/error behavior. Unit fixtures explicitly separate runtime ownership
from UI state presentation.

The native smoke command is:

```bash
npm ci
npm run build
npm run ensure:electron
node scripts/smoke-development-direct-chat.cjs --personal-workspace-only --evidence dist/personal-agent-workspace
```

The PR workflow runs the real Electron renderer/preload/main/runtime with a temporary
profile, deterministic loopback model and scoped local-development browser page. Its
report records actual assertions and screenshot paths. These fixtures are not evidence
of real external providers, user credentials or arbitrary websites working. A native
sandbox or OS block is a failed/unrun verification, never a reason to disable protection.

Review the workflow report and tested commit alongside screenshots. Focused tests are not
a substitute for the repository-wide lint, typecheck, test and build gates.
