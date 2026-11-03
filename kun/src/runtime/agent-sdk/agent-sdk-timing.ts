import type { RuntimeEventDraft } from '../../services/runtime-event-recorder.js'
import { harnessTurnTiming } from '../harness-turn-timing.js'

/**
 * Feed the drafts mapped from one SDK message to the turn's timing tracker as
 * the message arrives. `system/init` is the CLI saying it is ready to call the
 * model: the time it needed to boot before that is not request latency.
 */
export function observeSdkMessage<T extends readonly RuntimeEventDraft[]>(
  threadId: string,
  turnId: string,
  message: { type?: string; subtype?: string },
  drafts: T
): T {
  const timing = harnessTurnTiming(threadId, turnId)
  if (message.type === 'system' && message.subtype === 'init') timing.requestStarted()
  timing.observe(drafts)
  return drafts
}
