import type { RuntimeEventDraft } from '../services/runtime-event-recorder.js'
import type { UsageService } from '../services/usage-service.js'
import type { UsageSnapshot } from '../contracts/usage.js'
import type { HarnessTransport } from '../contracts/harness.js'
import { diffUsage, hasUsage } from '../domain/usage.js'

/**
 * How a transport reports usage on its `usage` drafts.
 * - `increment`: each draft is new consumption (one model call, one SDK
 *   query, one ACP prompt result). Drafts are summed.
 * - `turn-snapshot`: each draft is the running total of the current turn;
 *   only the growth since the previous draft of the same turn is counted.
 */
export type HarnessUsageMode = 'increment' | 'turn-snapshot'

export const HARNESS_USAGE_MODES: Readonly<Record<HarnessTransport, HarnessUsageMode>> = {
  'native-loop': 'increment',
  // Result `usage` covers one query's main loop; cost is converted to an
  // increment in sdk-session-cost.ts because `total_cost_usd` is cumulative.
  'agent-sdk': 'increment',
  'antigravity-cli': 'increment',
  // @cursor/sdk: "Per-turn token usage, emitted once at turn end".
  'cursor-sdk': 'turn-snapshot',
  acp: 'increment',
  'codex-app-server': 'increment',
  'pi-rpc': 'increment',
  terminal: 'increment',
  application: 'increment'
}

type Recorder = { record(draft: RuntimeEventDraft): Promise<unknown> | unknown }
type UsageDraft = Extract<RuntimeEventDraft, { kind: 'usage' }>

const TURN_SNAPSHOT_LIMIT = 256

/**
 * Kun's usage ledger stores every `usage` event as the thread-cumulative
 * snapshot (the native loop routes each response through
 * `UsageService.record`, and the usage index diffs consecutive rows of a
 * thread). External agents report per-call or per-turn numbers, so recording
 * them raw made later turns look like shrinking totals: they were clamped to
 * ~0 tokens, cache exceeded input (100% hit), and `turns` stayed 0.
 *
 * This wraps the recorder handed to a delegated runtime: each usage draft is
 * converted to its increment, folded into the shared ledger, and recorded as
 * the cumulative snapshot tagged `source: 'harness-reported'` + `harnessId`.
 * Every other draft passes through untouched.
 */
export function withHarnessUsageLedger<R extends Recorder>(
  events: R,
  deps: { usage: UsageService; mode: HarnessUsageMode; harnessId?: string }
): R {
  const turnSnapshots = new Map<string, UsageSnapshot>()
  const increment = (draft: UsageDraft): UsageSnapshot | undefined => {
    if (deps.mode === 'increment') return draft.usage
    const key = `${draft.threadId}\u0000${draft.turnId ?? ''}`
    const previous = turnSnapshots.get(key)
    turnSnapshots.delete(key)
    if (turnSnapshots.size >= TURN_SNAPSHOT_LIMIT) turnSnapshots.delete(turnSnapshots.keys().next().value!)
    turnSnapshots.set(key, draft.usage)
    if (!previous) return draft.usage
    const delta = diffUsage(draft.usage, previous)
    return hasUsage(delta) ? { ...delta, turns: 0 } : undefined
  }
  const record = (draft: RuntimeEventDraft): Promise<unknown> | unknown => {
    if (draft.kind !== 'usage' || draft.source === 'harness-gateway') return events.record(draft)
    const delta = increment(draft)
    if (!delta || !hasUsage(delta)) return undefined
    const cumulative = deps.usage.record(draft.threadId, delta, undefined, draft.turnId)
    const harnessId = draft.harnessId ?? deps.harnessId
    return events.record({
      ...draft,
      source: draft.source ?? 'harness-reported',
      ...(harnessId ? { harnessId } : {}),
      usage: cumulative
    } as RuntimeEventDraft)
  }
  return new Proxy(events, {
    get(target, property, receiver) {
      if (property === 'record') return record
      const value = Reflect.get(target, property, receiver) as unknown
      return typeof value === 'function' ? (value as (...args: unknown[]) => unknown).bind(target) : value
    }
  })
}
