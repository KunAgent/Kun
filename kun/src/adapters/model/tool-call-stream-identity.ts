import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'

const SYNTHETIC_CALL_ID_PREFIX = '__kun_stream_tool_call_'

export class ModelStreamProtocolError extends Error {
  readonly code = 'stream_tool_call_protocol'

  constructor(detail: string, pendingCount: number) {
    super(`model stream tool-call protocol error: ${detail} (pendingToolCalls=${pendingCount})`)
    this.name = 'ModelStreamProtocolError'
  }
}

/** Resolve provider fragments without using untrusted ids as object keys or diagnostics. */
export function resolvePendingToolCall(input: {
  explicitId?: unknown
  index?: number
  pending: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  budget: ModelStreamResourceBudget
}): { callId: string; pending: PendingToolCall } {
  const explicitId = safeExplicitId(input.explicitId, input.pending.size)
  const indexedId = input.index === undefined ? undefined : input.pendingByIndex.get(input.index)

  let callId = explicitId ?? indexedId
  if (!callId && input.index === undefined) {
    if (input.pending.size === 1) callId = input.pending.keys().next().value as string
    else if (input.pending.size > 1) {
      throw new ModelStreamProtocolError('fragment omitted both id and index with multiple candidates', input.pending.size)
    }
  }
  callId ??= syntheticCallId(input.index, input.pending)

  if (explicitId && indexedId && explicitId !== indexedId) {
    migratePendingCallId(input.pending, input.pendingByIndex, indexedId, explicitId)
    callId = explicitId
  } else if (explicitId && !indexedId && !input.pending.has(explicitId) && input.index === undefined && input.pending.size === 1) {
    const previousId = input.pending.keys().next().value as string
    migratePendingCallId(input.pending, input.pendingByIndex, previousId, explicitId)
    callId = explicitId
  }

  const pending = input.budget.pendingCall(input.pending, callId, input.index)
  if (input.index !== undefined) input.budget.bindPendingIndex(input.pendingByIndex, input.index, callId)
  return { callId, pending }
}

export function assertPendingToolCallsComplete(pending: ReadonlyMap<string, PendingToolCall>): void {
  for (const value of pending.values()) {
    if (!value.name) {
      throw new ModelStreamProtocolError('pending call is missing a tool name', pending.size)
    }
  }
}

function migratePendingCallId(
  pending: Map<string, PendingToolCall>,
  pendingByIndex: Map<number, string>,
  previousId: string,
  explicitId: string
): void {
  const previous = pending.get(previousId)
  if (!previous) return
  const collision = pending.get(explicitId)
  if (collision && collision !== previous) {
    throw new ModelStreamProtocolError('late id conflicts with another pending call', pending.size)
  }
  pending.delete(previousId)
  pending.set(explicitId, previous)
  for (const [index, callId] of pendingByIndex) {
    if (callId === previousId) pendingByIndex.set(index, explicitId)
  }
}

function safeExplicitId(value: unknown, pendingCount: number): string | undefined {
  // OpenAI-compatible gateways occasionally serialize an omitted delta id as
  // null or an empty string. Treat only those forms as absent so the stable
  // index (or sole pending call) can retain the established identity.
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value !== 'string' || value.length > 512 || [...value].some((character) => {
    const code = character.charCodeAt(0)
    return code <= 0x1f || code === 0x7f
  })) {
    throw new ModelStreamProtocolError('provider call id is invalid', pendingCount)
  }
  return value
}

function syntheticCallId(index: number | undefined, pending: ReadonlyMap<string, PendingToolCall>): string {
  const base = index === undefined ? `${SYNTHETIC_CALL_ID_PREFIX}anonymous` : `${SYNTHETIC_CALL_ID_PREFIX}index_${index}`
  if (!pending.has(base)) return base
  let suffix = 2
  while (pending.has(`${base}_${suffix}`)) suffix += 1
  return `${base}_${suffix}`
}
