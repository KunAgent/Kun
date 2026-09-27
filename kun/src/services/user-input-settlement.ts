import type { TurnItem } from '../contracts/items.js'
import type { SessionStore } from '../ports/session-store.js'
import type {
  UserInputQuestion,
  UserInputResolution
} from '../ports/user-input-gate.js'
import type { RuntimeEventRecorder } from './runtime-event-recorder.js'
import type { TurnService } from './turn-service.js'
import { sessionEventExists } from '../adapters/session-event-query.js'

/**
 * Bookkeeping slower than this is reported to kun logs. The HTTP route has
 * already delivered the resolution at this point; any additional latency is
 * pure settlement overhead and should stay in the low milliseconds.
 */
const SLOW_USER_INPUT_SETTLE_MS = 1_000

export type SettleUserInputResolutionInput = {
  turns: Pick<TurnService, 'updateItem'>
  events: Pick<RuntimeEventRecorder, 'record'>
  sessionStore: SessionStore
  threadId: string
  turnId: string
  itemId: string
  inputId: string
  prompt: string
  questions: UserInputQuestion[]
  resolution: UserInputResolution
  /**
   * Seq of the durable `user_input_requested` event. The resolution event is
   * always appended after it, so probing `seq > requestedSeq` is sufficient —
   * without the bound the probe replays the whole event log on every submit,
   * which on very large threads used to stall settlement until the abort
   * watchdog reported `tool_abort_outcome_unknown`.
   */
  requestedSeq?: number
  nowIso: () => string
  signal?: AbortSignal
  warn?: (message: string) => void
}

/**
 * Persist the terminal state of an interactive user_input request: the item
 * leaves `pending` and exactly one `user_input_resolved` event is appended
 * when no other writer (HTTP route, recovery) already recorded it.
 *
 * If the turn aborts while bookkeeping is in flight, the writes continue
 * detached so the terminal state still lands, and the caller returns
 * immediately — the tool call then unwinds through the normal interrupt path
 * instead of hanging past the abort watchdog grace.
 *
 * Errors in the awaited path propagate (a real persistence failure stays
 * visible); errors after detaching are logged because nobody is left to
 * receive them.
 */
export async function settleUserInputResolution(
  input: SettleUserInputResolutionInput
): Promise<void> {
  const warn = input.warn ?? ((message: string) => console.warn(message))
  const startedAt = Date.now()
  const bookkeeping = runUserInputSettlement(input, warn, startedAt)
  // Keep the rejection observed even when the abort race wins below.
  void bookkeeping.catch((error) => {
    warn(
      `[kun] user_input settlement failed for ${input.inputId} ` +
        `(thread=${input.threadId} turn=${input.turnId}): ${errorMessage(error)}`
    )
  })
  if (!input.signal) {
    await bookkeeping
    return
  }
  const detached = await Promise.race([
    bookkeeping.then(() => false),
    aborted(input.signal).then(() => true)
  ])
  if (detached) {
    warn(
      `[kun] user_input settlement detached on abort for ${input.inputId} ` +
        `(thread=${input.threadId} turn=${input.turnId}); terminal writes continue in background`
    )
    return
  }
  await bookkeeping
}

async function runUserInputSettlement(
  input: SettleUserInputResolutionInput,
  warn: (message: string) => void,
  startedAt: number
): Promise<void> {
  await input.turns.updateItem(input.threadId, input.itemId, {
    status: input.resolution.status,
    finishedAt: input.nowIso(),
    ...(input.resolution.status === 'submitted' ? { answers: input.resolution.answers } : {})
  } as Partial<TurnItem>)
  let alreadyRecorded = false
  try {
    alreadyRecorded = await sessionEventExists(
      input.sessionStore,
      input.threadId,
      (event) => event.kind === 'user_input_resolved' && event.inputId === input.inputId,
      input.requestedSeq ?? 0
    )
  } catch (error) {
    // A failed probe must not strand a delivered answer: recording again is
    // safe because `user_input_resolved` is idempotent for reducers.
    warn(
      `[kun] user_input resolved-event probe failed for ${input.inputId} ` +
        `(thread=${input.threadId}): ${errorMessage(error)}; recording unconditionally`
    )
  }
  if (!alreadyRecorded) {
    await input.events.record({
      kind: 'user_input_resolved',
      threadId: input.threadId,
      turnId: input.turnId,
      itemId: input.itemId,
      inputId: input.inputId,
      status: input.resolution.status,
      prompt: input.prompt,
      questions: input.questions,
      ...(input.resolution.status === 'submitted' ? { answers: input.resolution.answers } : {})
    })
  }
  const elapsedMs = Date.now() - startedAt
  if (elapsedMs >= SLOW_USER_INPUT_SETTLE_MS) {
    warn(
      `[kun] user_input settlement for ${input.inputId} took ${Math.round(elapsedMs)}ms ` +
        `(thread=${input.threadId} turn=${input.turnId} status=${input.resolution.status})`
    )
  }
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    signal.addEventListener('abort', () => resolve(), { once: true })
  })
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
