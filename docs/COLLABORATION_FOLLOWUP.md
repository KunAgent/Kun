# Collaboration follow-up: guarantees and adapter contract

Status: implemented on `codex/commitment-followup-c5ed378a2877`, **disabled by default**.
Nothing in production startup supplies the Manager `manualFollowUpEnabled` callback or
the `RoomRuntime` feature flags, and no production code constructs a source fetcher or a
head observer. Everything below describes code that exists and is covered by tests; the
final section lists what is deliberately still missing.

## Authority model

Three separate facts are required before any external effect, and no single one of them
is sufficient:

1. **User action** — written only by the Manager while staging an explicit continuation
   (`manager/manual-followup-stage.ts`). Generic room writes cannot mint the
   `event.userAction` marker (`manager/followup-permit-writes.ts`).
2. **Manager claim and permit** — a 60s monotonic claim token that only replaces itself
   once expired, plus a permit issued only after the same staged effect is claimed with
   a current coordinator and arbitration fence (`manager/manual-followup-claim.ts`,
   `manager/native-followup-permit-issuer.ts`).
3. **Physical receiver proof** — the executing turn lease plus the durable session item,
   revalidated at enqueue and again at promotion
   (`manager/native-followup-manual-authority.ts`,
   `manager/manual-followup-evidence.ts`, `manager/native-followup-write-scope.ts`).

Model output, PR text and attention answers are **context**, never authority. Every
external-source event is written with `contextOnly: true`.

## Invariants and where they are enforced

| Invariant | Enforced in |
| --- | --- |
| Model prose cannot create or answer a protected gate | `contracts/collaboration-followup-api.ts`, `agents/followup/attention.ts` |
| One unsettled outcome per commitment | `manager/manual-followup-stage.ts` |
| Terminal receipts only from a real terminal transition | `manager/followup-thread-writes.ts` |
| `queued → completed` is impossible; `running → terminal` needs the executing turn fence | `manager/followup-thread-writes.ts` |
| Active native work cannot be removed or retargeted before settlement | `manager/followup-thread-writes.ts` |
| Thread deletion cannot bypass the guard | `manager/followup-thread-deletion.ts` |
| Unknown outcomes never auto-retry | `manager/manual-followup-reconcile.ts` |
| Stop is a monotonic revocation, proven by the host adapter | `agents/followup/stop.ts` + `deps.proveStopped` |
| Tracked completion needs a same-commit, versioned acceptance transition | `rooms/room-collaboration-legacy.ts` |
| Ownership of a continuation requires an idle target thread | `agents/followup/links.ts` |
| One live source consent per resource; 24h maximum | `agents/followup/sources.ts` |
| Reads are bounded and a first observation is never partial | `agents/followup/github-reader.ts` |

## Pause semantics (decided)

* **Pause before issuance** — a claim or permit request fails: `commitment_control.paused`
  is checked at claim time (`manager/manual-followup-claim.ts`), and the receiver refuses
  a permit that was never issued.
* **Permit already issued, then pause** — the dispatch is still allowed. The approval was
  granted while the user still wanted the move, and revoking it mid-flight would leave an
  effect that can never settle. What pause does block is *new* work: staging, claiming and
  issuance all re-read the control row.
* **Stop** — always blocks: stop bumps `generation` and `authorizationEpoch`, so an issued
  permit stops verifying (`manager/native-followup-manual-authority.ts`).

Both orderings are covered by `manager/manual-followup-stage.test.ts`
("does not claim paused work or retry an unknown outcome",
"preserves an issued permit on pause but blocks a stop before the send decision").

## Budgets

Enforced at claim/dispatch (`agents/followup/budget.ts`):

* `attemptsPerDay` within a rolling 24h window that resets `consumed` but never
  `totalConsumed`;
* `attemptsTotal` as a lifetime ceiling;
* `minimumIntervalMs` between attempts (`budget.lastAttemptAt`);
* one attempt is spent in the same commit that records a dispatch, so retrying the same
  attempt id cannot spend twice.

**Not enforced:** `softTokenBudget`. There is no token-usage source bound to an attempt
in this codebase yet, so enforcing it would mean inventing a number. It is reported here
as an open item rather than silently ignored.

## Source grants and the reader adapter

A grant (`agents/followup/sources.ts`) is **account-level**: `accountRef` and
`authorizationEpoch` are copied from the `collaboration_source` row, never from a
repository credential. It must name its allowed reads, may allow model sharing only
inside a real thread of the commitment with explicit provider/model pairs, and expires
within 24h. Issuing a new grant for the same resource revokes the previous one in the
same transaction.

The reader (`agents/followup/github-reader.ts`) is a pure function over an injected
fetcher, so the host owns transport and credentials:

```ts
type FollowUpHttpRequest = { url: string; headers: Record<string, string>; credentialRef: string }
type FollowUpHttpResponse = { status: number; headers: Record<string, string>; body: unknown }
type FollowUpHttpFetcher = (request: FollowUpHttpRequest) => Promise<FollowUpHttpResponse>
```

Host obligations:

* resolve `credentialRef` out of band; the reader never sees token material;
* return `{ status, headers, body }` verbatim — including `etag` and `link`;
* surface 401/403 as 401/403 (never as an empty 200), so consent failures stay typed.

Reader guarantees:

* only the reads named by a **live** grant are attempted;
* hard bounds: 3 pages per endpoint, 100 items per page, 6 endpoints — exceeding any of
  them marks that endpoint incomplete instead of truncating;
* per-endpoint `If-None-Match`; a 304 produces no events;
* an endpoint whose pages do not all arrive contributes **nothing**;
* a first observation is `baselineComplete` only when every granted endpoint finished —
  otherwise the poll emits no events at all (no partial-green baseline);
* emitted events carry `sourceGeneration`, `credentialEpoch`, `authorizationEpoch`,
  `resource` and `endpoint` in `provenance`.

## Acceptance and version binding

Acceptance attention (`agents/followup/attention.ts`) judges one exact artifact version.
Resolving it requires the observed version to equal the stored one **and** the host to
re-read the current head through `deps.observedHead`. If no reader is configured the
resolution fails closed with `CAPABILITY_UNAVAILABLE`; if the head moved, the attention
row is superseded with `STALE_ATTENTION` instead of being accepted. `observationRevision`
is compared as well as the SHA, so an `A → B → A` flip is still caught.

## Other host adapter obligations

* `deps.proveStopped(threadId)` — must independently prove that no writer remains; a
  stopped flag alone never proves an external process exited.
* `deps.observedHead(resourceKey)` — must return the authoritative current head, or
  `null` when it cannot; `null` must not be treated as "unchanged".
* `deps.waitForOwnership` / `deps.assertOwnership` — ownership fencing for every
  follow-up mutation.
* `RoomRuntimeDeps.followUpFeatures()` — must default to all-off.

## Deliberately not done

* No production enablement: Manager callback and `RoomRuntime` flags stay off, and no
  startup path supplies them.
* No scheduler loop beyond the existing `RoomRuntime` tick
  (`agents/followup/dispatcher.ts`); no new timer, database or daemon was introduced.
* `softTokenBudget` is unimplemented (no token source).
* No remote (root ↔ kun) protocol release: the read surface is same-process HTTP only.
* No live GitHub or model pilot was run — no token was authorized, and no result in this
  branch claims otherwise.

## Verification

```
cd kun && node node_modules/vitest/vitest.mjs run src/agents/followup \
  src/manager/manual-followup-stage.test.ts src/manager/followup-thread-writes.test.ts \
  src/manager/followup-thread-native-service.test.ts src/manager/followup-thread-deletion.test.ts \
  src/manager/native-followup-permit-issuer.test.ts src/manager/followup-thread-arbitration.test.ts \
  src/server/routes/register-agent-work-routes.test.ts
```

Known environment limits when this was written: root `node_modules` was absent, so the
SQLite-backed store silently fell back to JSONL and ESLint could not run. TypeScript was
checked against a saved baseline (113 pre-existing, unrelated diagnostics).
