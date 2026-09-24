import type { ModelRequestRetryEvent, ModelRouteSwitchEvent } from '../contracts/events.js'
import type { ModelStreamIntent } from './model-stream-collector.js'

/**
 * Maps a `retrying` stream intent to the persisted `model_request_retry`
 * runtime event.
 */
export function buildModelRetryEvent(
  input: { threadId: string; turnId: string },
  intent: Extract<ModelStreamIntent, { kind: 'retrying' }>
): Omit<ModelRequestRetryEvent, 'seq' | 'timestamp'> {
  return {
    kind: 'model_request_retry',
    threadId: input.threadId,
    turnId: input.turnId,
    ...(intent.status !== undefined ? { status: intent.status } : {}),
    attempt: intent.attempt,
    maxAttempts: intent.maxAttempts,
    delayMs: intent.delayMs,
    ...(intent.reason ? { reason: intent.reason } : {}),
    ...(intent.failureSummary ? { failureSummary: intent.failureSummary } : {})
  }
}

/**
 * Maps a `route_switching` stream intent to the persisted
 * `model_route_switch` runtime event (kept in a sibling module so the round
 * engine stays under the file-size gate).
 */
export function buildRouteSwitchEvent(
  input: { threadId: string; turnId: string },
  intent: Extract<ModelStreamIntent, { kind: 'route_switching' }>
): Omit<ModelRouteSwitchEvent, 'seq' | 'timestamp'> {
  return {
    kind: 'model_route_switch',
    threadId: input.threadId,
    turnId: input.turnId,
    fromProviderId: intent.from.providerId,
    fromModelId: intent.from.modelId,
    toProviderId: intent.to.providerId,
    toModelId: intent.to.modelId,
    ...(intent.reason ? { reason: intent.reason } : {}),
    ...(intent.message ? { failureSummary: intent.message.slice(0, 500) } : {})
  }
}
