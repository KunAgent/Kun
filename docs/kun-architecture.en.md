# Kun GUI single-runtime architecture

This document describes how the Kun desktop app should now be organized around one dedicated runtime,
`Kun`, that serves the GUI through a single HTTP/SSE boundary.
The conclusion is clear up front: the GUI keeps one agent with the only ID
`kun`; Code (including Design tasks), Work, and Connect phone all flow through the same `kun serve`
HTTP/SSE boundary.
Historical runtimes, legacy painting/design starter entry points, runtime diagnostics panel,
and agent switching are no longer shown as primary product surfaces.

Graph orchestration, self-evolving project agents, recovery, and governance
remain inside this same Kun boundary. See
[`docs/graph-mode.en.md`](./graph-mode.en.md) for the complete architecture and
operations guide.

## Target boundary

```text
Renderer (React + Zustand)
  Code (including Design tasks) / Work / Connect phone UI
        |
        | window.kunGui.runtimeRequest(path, method, body)
        | window.kunGui.startSse(threadId, sinceSeq)
        v
Preload IPC bridge
        |
        v
Main process
  RuntimeHost -> kunRuntimeAdapter
  process/config/port/token management only
        |
        v
kun serve (TypeScript package)
  /health
  /v1/threads
  /v1/threads/{id}/turns
  /v1/threads/{id}/events
  /v1/threads/{id}/fork
  /v1/sessions/{id}/resume-thread
  /v1/approvals/{id}
  /v1/user-inputs/{id}
  /v1/usage
  /v1/workspace/status
```

This boundary uses a local HTTP service architecture: GUI never embeds the agent loop,
does not juggle multiple state machines through stdio/RPC, and treats `kun serve`
as the stable API boundary.
Inside `kun`, the cache-first agent loop uses immutable prompt prefixes,
append-only logs, bounded LRU/TTL caches, inflight cleanup, steering queues,
context compaction, and usage/cache telemetry.

## Cache-hit optimization

Kun cache-hit metrics should be computed and optimized using provider-native usage fields first:

- Model client prefers native fields:
  `prompt_cache_hit_tokens` and `prompt_cache_miss_tokens`.
  Only when those are missing should it fall back to compatibility fields
  such as `prompt_tokens_details.cached_tokens` and `cache_read_input_tokens`.
- Use hit rate as `hit / (hit + miss)`, not `hit / prompt_tokens`.
  Provider-native misses are not always equal to `prompt_tokens - hit`.
- `kun/src/prompt/kun-system-prompt.ts` is the stable prefix.
  It may only contain long-lived Kun run contract content and must not include
  workspace names, timestamps, file snippets, selected text, user dynamic state,
or one-off tool outputs.
- `ImmutablePrefix` must run `verifyImmutablePrefix()` before each model step.
  If `setSystemPrompt` / `setTools` / `setFewShots` bypasses this contract,
developer/runtime checks should surface fingerprint drift immediately instead of
quietly reducing cache behavior.
- Few-shot fingerprint only includes payload actually sent to the model.
  It should not include dynamic GUI/storage fields like `item id`, `turn id`, `thread id`,
or timestamps.
- Tool schema is canonicalized before sending to the model.
  Stable ordering avoids prefix churn caused by schema reordering.
- Each turn persists a canonical tool-catalog fingerprint and count.
  If a scope detects tool-definition drift, `toolCatalogDrift` is recorded to aid cache debugging.
- Before sending historical messages to the upstream model, repair message history:
  no orphaned `tool_result`, no `tool_call` whose result is missing.
  Multiple tool calls in one response are reorganized into a single legal
  assistant `tool_calls` message to reduce 400/retry loops.
- Consecutive built-in read-only tools (`read` / `grep` / `find` / `ls`) in one model turn
  are executed in small concurrent batches, while `tool_result` entries are still written
  in tool-call order to avoid ordering noise in replay history.
- Serve runtime restores cumulative cache hit/miss counters from persisted usage events.
  After restart/resume, usage totals do not restart from zero.
- Dynamic context must be appended **after** stable prefix.
  `compaction`, `resume`, `fork`, and plan context must not rewrite the stable prefix.

Cold-start hit rate can be low (or zero) on the first round because the service has no prior
matching prefix yet. Once warmed up, hit rate should stably exceed 90%.
Observed temporary-thread verification on `2026-06-02`:

- 12 short-message turns: hot hit `94.7%` after excluding first-start warm-up rounds,
  latest round `93.6%`.
- 24 short-message turns after warming with the same stable prefix:
  overall (including warm-up) `95.2%`, latest round `98.1%`.

Pre-existing usage events persisted before optimization cannot be rewritten because
provider-native cache fields were not recorded then; they only reflect old behavior and
should not be treated as evidence that current hit rates are lower.

Cache capabilities still worth pursuing next:

- Tool-collection mutation policy: adding tools should be append-only; edit/reorder/remove
  requires either restart or a new session boundary to avoid sudden cache misses.
  Current Kun canonicalizes schema, but this mutation policy still needs explicit product-level
  enforcement.
- LLM fold summarizer: `ContextCompactor` is currently local summary logic with no extra
  model call. If model-based summarization is introduced later, it should reuse
  main-agent `system`/`tools`/`few-shot` prefix so summary calls can share cache.
- Large tool-result bounds and long-argument markerization: current outputs are smaller;
  if shell/file-fulltext/web-scraping tools are added, tool results should be token
  bounded or tokenized before entering history to avoid log bloat.
- Volatile scratch boundary: assistant reasoning is not sent back to the model by default
  but can still appear in GUI history. For future internal plans, temporary scratchpads,
or sub-agent scratch, keep “displayable” and “replayable to model” separated.

## Renderer-side removal items

Renderer should only expose Kun. The UI sections listed below should be removed or
kept removed:

- Agent switcher: no runtime-switching `AgentSwitcher` returns; the harness picker
  chooses the per-turn engine (see `docs/ade/01-harness-routing.md`).
- Top connection status + runtime diagnostics entry: runtime detection is no longer the
  user entrypoint.
- Runtime insights / right panel: retain only `Changes`, `Preview`, `Plan`, and GUI workspace
  views (`File`, etc.); remove runtime/usage control surfaces.
- Slash menu commands `/usage`, `/runtime`: these imply switchable runtimes and should be removed.
- Settings provider selector: `Settings -> Agents` directly edits Kun config including:
  `binaryPath`, `port`, `autoStart`, `apiKey`, `baseUrl`, `runtimeToken`, `dataDir`,
  `model`, `approvalPolicy`, `sandboxMode`, `insecure`. The Agents group may list
  harnesses (detection, login, default permission mode); all of them execute inside
  the Kun runtime.
- Legacy painting/design starter cards stay removed. The first-class workspace
  entry points are Code and Work; Design is a task type in the Code workbench
  and uses its right whiteboard. Connect phone and automation keep their own routes.

## Main / preload responsibilities to remove

Main process and preload no longer expose old provider IPC:

- Remove historical runtime spawn/update/diagnostics IPC.
- Remove historical RPC event bridges.
- Remove historical adapters, HTTP bridges, updaters, binary resolvers, and process managers.
- Remove diagnostic/importer modules unrelated to Kun.

Main process now only needs:

- `kunRuntimeAdapter`: start/stop `kun serve`, sync config, calculate base URL,
and append auth headers.
- `runtimeRequestViaHost`: forward `/v1/*` after ensuring Kun is running.
- `startSse` / `stopSse`: forward Kun SSE streams keyed by `threadId + sinceSeq`.

## Settings / migration

Saved settings should now be just:

```json
{
  "agentProvider": "kun",
  "agents": {
    "kun": {
      "binaryPath": "",
      "port": 18899,
      "autoStart": true,
      "apiKey": "",
      "baseUrl": "https://api.deepseek.com/beta",
      "runtimeToken": "<generated-local-token>",
      "dataDir": "~/.kun/data",
      "model": "deepseek-v4-pro",
      "approvalPolicy": "auto",
      "sandboxMode": "workspace-write",
      "insecure": false
    }
  }
}
```

The only reason historical provider strings remain in code is one-time migration
from old settings:

- Historical `agentProvider` values normalize to `kun`.
- Historical provider values for `port`, `autoStart`, `apiKey`, `baseUrl`,
  `runtimeToken`, `approvalPolicy`, `sandboxMode`, and `model` are migrated into
  `agents.kun`.
- Persisted files after migration no longer retain historical provider blocks.
- Legacy Connect phone fields (internally still named Claw) `agentThreadIds` are collapsed
  to `agentThreadIds.kun`; per-provider maps are not retained.

## Code / Design task / Work / Connect phone flows under Kun

- Code: `KunRuntimeProvider` handles list/create thread, send turn,
  steer, interrupt, compact, approval, and SSE mapping.
  Chat UI does not directly know about old providers.
- Design task: shares the Code workbench task list, timeline, composer, model,
  permissions, and workspace controls. Drafts and artifacts persist under
  `.kun-design/` and render in the right whiteboard.
- Work: the office assistant and inline completion share the same Kun API key/base URL.
  The internal Write thread registry identifies Work threads as Kun threads only, with no legacy-runtime distinction.
- Connect phone: scheduled tasks, Feishu/Lark/WeChat, and IM webhooks create or reuse Kun threads.
  The codebase still uses the internal `claw` route, settings key, and runtime file names for legacy-name compatibility.
  `threadId` / `localThreadId` remain only for legacy settings compatibility;
  canonical mapping is written to `agentThreadIds.kun`.

## Plan-build worktree coordinator boundary

Plan execution still uses the single Kun runtime, while a dedicated Electron
main coordinator owns its Git lifecycle:

- Renderer chooses Direct or Graph and the per-build isolation option in the
  Plan surfaces. It projects preflight and durable run state but never receives
  authority to merge or delete an arbitrary path.
- Main atomically persists each run, captures the exact launching checkout,
  checked-out target branch, and HEAD, then creates the execution branch and
  worktree under `~/.kun/worktrees/<runId>/...`. A linked source worktree remains
  the exact checkout updated later; the primary worktree is not substituted.
- Kun executes a `side` fork carrying `planBuildRunId` and the worktree workspace.
  Its goal is created before the first implementation turn is admitted. Graph
  worker isolation remains subordinate to this outer execution branch.
- Renderer requests finalization only after structured successful turn, complete
  goal, no later running turn, no approval or user-input gate, and successful
  Graph root integration. Assistant prose is never a completion signal.
- Main commits and rebases inside the isolated worktree, then runs
  `merge --ff-only` only in the captured source checkout. Target movement,
  branch switches, dirtiness, and conflicts become recoverable states; the
  coordinator never switches, stashes, resets, cleans, or force-updates source.
- Cleanup first proves the execution head reachable from the target, or proves
  the run unchanged. It rebinds the execution thread workspace to source before
  non-force worktree removal, safe branch deletion, and pruning. Partial failure
  persists as `cleanup_pending`; explicit discard still creates a recovery patch
  or checkpoint first.

This coordinator is distinct from the reusable scheduled-task worktree pool and
does not replace Graph worker worktrees. Their destructive cleanup semantics
must not be shared.

## Functional parity in GUI HTTP path

Runtime unification is not only preserving chat.
Kun GUI HTTP must expose the capabilities already consumed by the store/UI:

- `GET /v1/threads` supports `limit`, `search`, `include_archived`, `archived_only`.
  Archived/deleted threads are hidden by default; session search and archive views
  should not depend on GUI-level guessing.
- `POST /v1/threads/{id}/fork` duplicates thread history, records fork lineage,
  and writes historical items back into the new thread's session store.
  During copy, pending `approval` / `user-input` states are rewritten to history-only
  states to prevent hanging gates in new sessions.
- `POST /v1/sessions/{id}/resume-thread` follows the historical resume path.
  Kun should first attempt same-name thread restore, then session snapshot/JSONL reconstruction,
and return `404` when not found.
- Both `POST /v1/user-inputs/{id}` and legacy `POST /v1/user-input/{id}` are accepted,
  with `{ answers }` or `{ cancelled: true }`.
  `request_user_input` / `user_input` tool pauses a turn and resumes after GUI answer.
- `POST /v1/approvals/{id}` continues tool approval. Both approval and user-input flows
  use gate/route/service layering; no agent logic is implemented in renderer.
- `GET /v1/usage?group_by=thread|day` returns accumulated token/turn/cache-hit counters.
  Workbench home and composer footer consume Kun usage only and do not open runtime
  insight panels.

## Paths that must remain removed

Legacy runtime paths should not reappear:

- Historical runtime adapters / bridges
- Historical runtime process managers / binary resolvers
- Historical runtime update modules
- Diagnostics/importers outside Kun

Legacy UI entrypoints should not reappear:

- `AgentSwitcher`
- `ConnectionStatusBar`
- `RuntimeDiagnosticsDialog`
- `RuntimeInsightsPanel`
- Legacy Design/Painting starter card outside Design mode

## Design constraints

Kun packages are organized by ports & adapters:

- `contracts/`: HTTP/SSE DTOs and zod schemas.
- `ports/`: ModelClient, ToolHost, ThreadStore, SessionStore,
  ApprovalGate, EventBus, WorkspaceInspector, Clock.
- `adapters/`: DeepSeek-compatible model client, local tool host,
  file/in-memory stores, workspace inspector.
- `loop/`: AgentLoop, InflightTracker, SteeringQueue, ContextCompactor.
- `cache/`: ImmutablePrefix, LRU, TTL-LRU.
- `server/`: Router, auth, SSE, routes.

Renderer should never implement agent business logic; it only maps HTTP client/SSE state
and forwards results. When adding capability, add Kun tool or HTTP endpoint first,
and only then add renderer wiring if needed (not both).

## ADE: manager and workers

Kun's Code mode can run as an ADE (Agentic Development Environment): one-to-one
sessions may run on the Kun native loop or an external harness; a manager (the Kun
native loop) can split tasks, dispatch workers, track progress, accept results, and
report. The full design and implementation breakdown lives in
[`docs/ade/README.md`](./ade/README.md). Invariants:

- External agents enter only as a `DelegatedTurnRuntime` inside `kun serve`; the
  GUI always talks to `kun serve`. The only exception is the terminal agent: its
  PTY is held by the main process, but its state is reported through Kun's
  ActivityStore.
- A thread/turn's harness is frozen at admission; historical threads without a
  `harnessId` infer it from provider kind and behave exactly as before.
- A worker's effective permission is the intersection of the manager snapshot and
  the requested harness level — never widened. Unattended paths never escalate.
- Task workspaces (worktrees) are created, captured, and integrated by the host;
  integration never touches uncommitted changes in the user's source checkout.
- Handoff context is generated deterministically by code (`kun_handoff` brief),
  not by model summarization; the immutable prefix in `docs/AGENTS.md` does not
  change for ADE.
- `agents.kun.ade.*` is the only settings surface; with `enabled` off no ADE UI
  appears, and with `harnessRouter` off routing falls back to legacy provider
  inference.

## Verification list

Any change touching the architecture should run:

```bash
npm run typecheck
npm test
npm run build
```

Manual smoke checks:

1. Open the Kun desktop app.
2. Code can create a new session, send messages, stream output, and use approval/interruption.
3. Design opens the canvas, can create or iterate a design artifact, preview/export
   the prototype, and hand the approved design to a fresh Code thread.
4. Work opens its workspace; inline completion and inline selected-text assistant share the API key.
5. Connect phone can save settings, run manual tasks, and write thread IDs back to Kun mapping.
6. `Settings -> Agents` shows only Kun, with no provider switch, runtime diagnostics,
   or historical provider blocks.
7. If `GET /v1/usage?group_by=thread` returns history, home and footer no longer show
   blank “No usage yet”, but show token, turn, cache-hit indicators.
8. Thread search, archive, fork/resume, and request_user_input answer/cancel flows all operate
   through Kun HTTP paths.
