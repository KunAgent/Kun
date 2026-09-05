# Agent Runs and Tools

> Extension API: v1
> 中文：[Agent Runs 与工具](./agent-and-tools.md)
> Related: [Single-runtime architecture](./architecture.en.md) · [Permissions and quotas](./security-and-resources.en.md)

An extension can ask the Kun Agent to do work for its application and can register tools for Kun to call. Both directions use the single `kun serve` AgentLoop, ThreadStore, EventBus, ApprovalGate, and ToolHost. An extension receives no runtime token and cannot create a second Agent loop.

## Permissions

| Capability | Permission |
| --- | --- |
| Create, steer, and cancel owned Runs | `agent.run` |
| Query projections of owned threads/runs | `agent.threads.readOwn` |
| Register Manifest-declared tools | `tools.register` |
| Read/write workspace, network, or account during work | Corresponding `workspace.*`, `network:*`, and `accounts.use:*` |

Permissions authorize broker operations only. Every model/tool step rechecks grants, workspace trust, and policy at use time. A capability revoked after Run creation fails at the later step.

## Stable Agent API

v1 provides:

- `agent.getRunOptions`
- `agent.createRun`
- `agent.listRunEvents`
- `agent.subscribe`
- `agent.steer`
- `agent.cancel`
- `agent.getRun`
- `threads.listOwn`
- `threads.getOwn`

Caller identity comes from the Host session, never an `ownerExtensionId` in a request. Requests, results, events, and errors use negotiated-version Schemas.

`agent.getRunOptions()` returns configured models on Kun's active primary model connection that extension-owned Runs may use. Each entry contains only the safe `id`, `displayName`, `selected`, `reasoningEfforts`, and `defaultReasoningEffort` fields; Provider credentials, accounts, and other connections are not exposed. `reasoningEfforts` uses Kun's stable semantic values `auto | off | low | medium | high | max`. An adapter may translate a semantic value to its Provider wire value, for example Codex `max` to `xhigh`.

```ts
const options = await context.agent.getRunOptions()
const selected = options.models.find(model => model.selected)!

const { run } = await context.agent.createRun({
  input: 'Implement the task',
  model: selected.id,
  reasoningEffort: selected.defaultReasoningEffort
})
```

`model` and `reasoningEffort` apply only to a new Run/Turn; `steer` cannot change an active Run. The Host rejects unconfigured models, efforts unsupported by that model, and requests that combine a Host model choice with an extension-owned `providerBinding`. The Run projection's `model` and optional `reasoningEffort` are the values actually admitted.

## Create a Run

Conceptual example:

```ts
const { run, createdThread } = await context.agent.createRun({
  input: 'Summarize the open issues',
  workspace: context.workspaceContext?.root,
  profileId: 'issue-triage',
  providerBinding: {
    providerId: 'acme.models',
    accountId: selectedAccount.id,
    modelId: 'reasoning-small'
  },
  budget: {
    maxTokens: 20_000,
    maxElapsedMs: 120_000,
    maxModelRequests: 8,
    maxToolInvocations: 20,
    maxEvents: 2_000
  },
  allowedTools: ['create-issue', 'lookup-issue']
})
```

Use the same-version TypeScript type as the field-level source of truth. Kun combines requested values with host/user policy and clamps them. The result reports `run.extensionBudget`; `createdThread` says whether this call created a thread. It does not promise the requested maximum.

By default Kun creates a distinct extension-owned thread. Persisted metadata includes:

- `ownerExtensionId` and creating extension version;
- workspace scope;
- resolved Agent profile snapshot;
- Provider/model/account references;
- token/time/concurrency/model/tool/event budget;
- tool catalog epoch, fingerprint, and tool digests.

Ownership belongs to the stable extension ID, so a new version can query threads created by an older version. The original version remains as audit metadata.

## Resume an existing Thread

An explicitly supplied `threadId` is resumed only if:

- the thread is owned by the current extension ID;
- workspace scope is compatible;
- the thread is not deleted;
- no incompatible Run is active;
- current profile/Provider/account/tool policy permits the new Run.

An extension cannot adopt a main-workbench or foreign-extension thread. Rejection does not reveal foreign content. `threads.listOwn/getOwn` return bounded paginated projections; every thread with a run includes a safely projected `latestRun` (status, timestamps, profile, and usage), never raw store access or secrets.

## Run lifecycle and budgets

```text
queued -> running <-> waiting-approval -> completed
                   <-> waiting-user-input -> failed
                                         \-> cancelled
                                         \-> budget-exhausted
```

A Run has one terminal outcome. When completion, cancellation, tool failure, disablement, and thread deletion race, a Kun terminal fence selects one outcome and no later model/tool success is committed.

Run request budgets cover tokens, elapsed time, model requests, tool invocations, and retained events; Host/user policy separately bounds concurrent Runs. At a hard limit Kun stops new work and emits one `budget-exhausted` outcome. Usage, cache telemetry, and calls are attributed to extension/version/run/thread/profile/Provider/model/account/catalog epoch. When a Run reuses an existing thread, its projection reports the delta from the preceding cumulative snapshot instead of charging prior Runs again.

## Subscribe and replay

`agent.listRunEvents` reads a bounded chronological page from durable history, with a default of 100 and a maximum of 200 events:

```ts
const page = await context.agent.listRunEvents({
  runId: run.id,
  afterSequence: lastSeenSequence,
  limit: 100
})
lastSeenSequence = page.cursor
```

The response contains `items`, a numeric `cursor`, `hasMore`, and `historyIncomplete`. The same cursor can continue the next page or seed `agent.subscribe.afterSequence`. `historyIncomplete` means Kun's retention policy removed older underlying events; clients must show the gap and must not infer missing content. Only Runs owned by the calling extension are readable, with both the `agent.run` and `agent.threads.readOwn` boundaries enforced.

Public message events carry a stable `messageId` and `phase: 'delta' | 'replace' | 'complete'`. Append deltas and replace snapshots by `messageId` so hydration and live streaming do not create duplicate bubbles. User and assistant content is a string. Tool content is a Host-generated tool name, state, and generic summary without raw arguments, results, or paths. Internal model context, reasoning, attachment paths, and approval/input credentials are never projected.

`agent.subscribe` uses a dedicated authenticated event boundary, not a runtime bearer token. Events contain owner scope, run ID, thread ID, type, and monotonically increasing sequence.

```ts
const subscription = await context.agent.subscribe({
  runId: run.id,
  afterSequence: lastSeenSequence
})
context.subscriptions.add(subscription)
context.subscriptions.add(
  subscription.onEvent(event => {
    lastSeenSequence = event.sequence
    render(event)
  })
)
```

On reconnect, Kun first replays from the persisted event source in sequence order, then switches to live delivery. Relative to a cursor, the terminal event is delivered at most once. Do not copy an entire stream into an unbounded array. Each subscriber has queue, message-size, and delivery-rate limits; a lagging subscriber receives a resumable overflow/disconnect cursor and reconnects to durable history.

In a Webview, live `agent.event` notifications are delivered only through the current sender-bound View Session event pump; they are not forwarded to another View or to the extension's Node Host. Closing, crashing, reloading, or changing the workspace cancels that Session's subscriptions. The official React hook de-duplicates by sequence and retains a bounded event window.

Events exclude runtime tokens, consent tokens, account secrets, foreign threads, and unauthorized capability data.

## Steering and cancellation

`agent.steer` accepts only an active Run owned by the caller, writes through the Kun `SteeringQueue` in acceptance order, and applies at supported AgentLoop boundaries. It cannot:

- approve a tool call;
- answer/cancel `request_user_input`;
- submit an account secret or consent;
- bypass workspace/tool/Provider policy.

Text that says “I approve” does not settle the ApprovalGate.

`agent.cancel` is owner-checked and idempotent. It cancels model and ToolHost work, drops unapplied steering, and persists one cancelled terminal event. Repeated cancellation returns a consistent result and does not create another terminal event.

## Agent Profiles

A Profile is declared in `contributes.agentProfiles` and registered in the extension namespace. It can include:

- local ID and display metadata;
- bounded instruction overlay;
- default Provider/model/account binding;
- allowed tool scope;
- budget defaults;
- visibility.

A Profile cannot replace, reorder, or modify Kun's stable system/few-shot prefix, ApprovalGate, tool-history repair, sandbox, or hidden runtime instructions. Profile text is a lower-priority attributed overlay.

At Run creation, Kun persists a resolved snapshot: profile ID, extension version, instruction digest, binding, budget, tool scope, and epoch. A Profile update affects later resolution only and never rewrites prior history.

## Declare and register a tool

Manifest:

```json
{
  "activationEvents": ["onTool:create-issue"],
  "contributes": {
    "tools": [
      {
        "id": "create-issue",
        "description": "Create an issue in the configured project",
        "inputSchema": {
          "type": "object",
          "properties": {
            "title": { "type": "string", "minLength": 1 }
          },
          "required": ["title"],
          "additionalProperties": false
        },
        "outputSchema": {
          "type": "array",
          "items": {
            "type": "object",
            "properties": {
              "type": { "const": "text" },
              "text": { "type": "string" }
            },
            "required": ["type", "text"],
            "additionalProperties": false
          }
        },
        "sideEffects": "external",
        "idempotent": false,
        "maxOutputBytes": 32768
      }
    ]
  },
  "permissions": ["tools.register"]
}
```

Host registration:

```ts
context.subscriptions.add(
  await context.tools.registerTool(definition, async (input, toolContext) => {
    if (toolContext.cancellation.isCancellationRequested) {
      throw new Error('Tool invocation was cancelled')
    }
    await toolContext.reportProgress({ message: 'Creating issue' })
    return {
      content: [{ type: 'text', text: `Issue created: ${String(input.title)}` }]
    }
  })
)
```

Use `@kun/extension-api` for the exact handler/return types. Declaration and registration must match field-for-field. `inputSchema` validates arguments and optional `outputSchema` validates `ToolResult.content`. The public `maxOutputBytes` range is 1 KiB–1 MiB. Schemas are capped at 128 KiB, support only local `#`/`#/...` references, and reject unsafe or oversized regular expressions and overly deep/large structures; do not depend on remote `$ref` documents. Invalid schemas, duplicate/reserved IDs, undeclared tools, and policy-forbidden definitions are rejected before entering the model catalog. Kun-reserved identities such as `request_user_input` and approval tools cannot be registered.

## Tool identity and invocation path

Kun derives a canonical identity and model-safe alias from authenticated extension ID + local tool ID. Two extensions can both declare `create-issue` without collision.

```text
model tool call
  -> pinned catalog lookup
  -> ToolHost argument/policy validation
  -> ApprovalGate when required
  -> ExtensionToolProvider
  -> owning Node Host handler
  -> bounded normalized result
  -> model history in original call order
```

Invocation includes a stable ID, deadline, cancellation, workspace/account/network scope, and operation attribution. Progress and results are bounded. Oversized output is truncated, externalized, or rejected under the public contract without corrupting tool-call/tool-result history.

## Approval, interactive gates, and side effects

`sideEffects` is policy input, not self-authorization. Kun can upgrade a declared read-only operation to require approval. An extension cannot weaken user, sandbox, workspace, or ApprovalGate policy.

- External effects require a real decision in a Host-owned protected surface.
- Extension messages, Agent steering, Webview clicks, and content scripts cannot fabricate approval.
- Direct DOM is revoked while approval is pending; synthetic clicks are rejected, and a real click still requires Main's native confirmation plus a short-lived, one-shot, action-bound consent verified by the Kun backend.
- Any actual execution-policy or sandbox change likewise requires Main's native confirmation and a one-shot consent bound to old values, new values, and the sending frame; ordinary Settings/Composer DOM cannot authorize it.
- `request_user_input` can be answered only through Kun's authenticated user boundary.
- Without a trusted interactive surface, headless execution remains gated or follows explicit policy; it never synthesizes an answer.

If a Host crashes after receiving a possibly side-effecting call and completion is unknown, Kun returns unknown-outcome and does not call again automatically. Safe retry requires `idempotent: true`, a policy-accepted stable invocation key, and retry authorization.

## Reauthorize at invocation time

Catalog membership does not mean permanent executability. Every invocation checks:

- extension/workspace enablement and trust;
- tool, workspace, network, account, Provider, and secret grants;
- current Approval/Sandbox/user policy;
- budget and deadline;
- Host health and registration lifecycle.

Disable or disposal immediately stops new dispatch and attempts to cancel in-flight calls. Historical records and completed-turn catalog fingerprints remain.

## Tool catalog and cache stability

Every thread or explicit new epoch pins a permission-eligible tool snapshot with:

- canonical sort;
- epoch ID and fingerprint;
- tool count and canonical identities;
- per-tool Schema digest.

Install, enable/disable, removal, or Schema changes affect only a new thread or an explicitly created epoch at an idle boundary, never an active model round. If the live registry differs from a pinned digest, Kun reports catalog drift and fences before the upstream request rather than treating a changed Schema as the same stable prefix.

For a large tool set, the model sees only stable core-owned search/call gateways. Discovery searches the pinned authorized epoch, and gateway calls still pass ToolHost, approval, budgets, and cancellation. An extension cannot guess-invoke a disabled or foreign tool.

## Headless operation

Node Agent APIs, Profiles, and tools have the same semantics under `kun serve` and supported CLI paths. A non-interactive tool works without a GUI. Approval or user-input requirements never auto-pass. A browser-only extension cannot provide a headless tool.

## Test checklist

- owned/foreign thread, workspace scope, permission revocation;
- budget clamp/exhaustion and single-terminal races;
- sequence replay, disconnect, overflow cursor;
- ordered steering and idempotent cancellation;
- profile snapshot and immutable prefix;
- argument errors, progress/result limits, Host crash/circuit;
- approval, user input, and unknown outcome;
- tool disposal/disable during invocation;
- catalog canonicalization, drift, progressive discovery;
- headless tool/Provider/account path with GUI closed.
