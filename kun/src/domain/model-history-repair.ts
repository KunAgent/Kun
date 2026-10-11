import type { TurnItem } from '../contracts/items.js'

/**
 * Repairs persisted turn items into a model-sendable history shape.
 *
 * A provider sees all tool calls emitted by one assistant response as one
 * atomic assistant message. Keeping only the calls that happened to receive a
 * result produces a malformed replay (and, in particular, makes DeepSeek
 * reject the next request). The repair therefore only retains a complete,
 * terminal, one-to-one call/result group. Orphan calls and results are dropped
 * fail-closed.
 */
export function repairModelHistoryItems(items: TurnItem[]): TurnItem[] {
  const keptIndexes = new Set<number>()
  const droppedAssistantRoundIndexes = new Set<number>()

  let index = 0
  while (index < items.length) {
    const item = items[index]
    if (item?.kind !== 'tool_call') {
      index += 1
      continue
    }

    const group = inspectToolCallGroup(items, index)
    if (group.valid) {
      for (const callIndex of group.callIndexes) keptIndexes.add(callIndex)
      for (const resultIndex of group.resultIndexes) keptIndexes.add(resultIndex)
    } else {
      for (const assistantIndex of precedingAssistantRound(items, index, group.turnId)) {
        droppedAssistantRoundIndexes.add(assistantIndex)
      }
      for (const assistantIndex of group.assistantBridgeIndexes) {
        droppedAssistantRoundIndexes.add(assistantIndex)
      }
    }
    // A group consumes only its contiguous call block. Its result block remains
    // available to the normal forward scan, but cannot be retained unless this
    // group marked it complete.
    index = group.nextCallIndex
  }

  let changed = false
  const repaired = items.filter((item, itemIndex) => {
    if (item.kind === 'tool_call' || item.kind === 'tool_result') {
      const keep = keptIndexes.has(itemIndex)
      changed ||= !keep
      return keep
    }
    if (droppedAssistantRoundIndexes.has(itemIndex)) {
      changed = true
      return false
    }
    return true
  })
  return changed ? repaired : items
}

/**
 * Builds model-visible history while hiding the legacy Browser Use sentinel
 * pair. The durable/session repair above intentionally keeps that pair so UI
 * and audit readers can still see the original records; this projection is
 * the compatibility boundary for model requests only.
 */
export function repairModelHistoryItemsForModel(items: TurnItem[]): TurnItem[] {
  const repaired = repairModelHistoryItems(items)
  const legacyInvalidCallIds = new Set(
    repaired.flatMap((item) =>
      isLegacyInvalidBrowserUseCall(item) ? [item.callId] : [])
  )
  if (legacyInvalidCallIds.size === 0) return repaired

  const legacyInvalidPairs = new Set(
    repaired.flatMap((item) =>
      isLegacyInvalidBrowserUseFailure(item) && legacyInvalidCallIds.has(item.callId)
        ? [item.callId]
        : [])
  )
  if (legacyInvalidPairs.size === 0) return repaired

  return repaired.filter((item) =>
    (item.kind === 'tool_call' || item.kind === 'tool_result')
      ? !legacyInvalidPairs.has(item.callId)
      : true
  )
}

function isLegacyInvalidBrowserUseCall(
  item: TurnItem
): item is Extract<TurnItem, { kind: 'tool_call' }> {
  if (item.kind !== 'tool_call' || item.toolName !== 'browser_use') return false
  const keys = Object.keys(item.arguments)
  return keys.length === 1 && item.arguments.action === 'invalid'
}

function isLegacyInvalidBrowserUseFailure(
  item: TurnItem
): item is Extract<TurnItem, { kind: 'tool_result' }> {
  if (item.kind !== 'tool_result' || item.toolName !== 'browser_use') return false
  return item.isError === true
}

type ToolCallGroup = {
  valid: boolean
  turnId: string
  callIndexes: number[]
  resultIndexes: number[]
  assistantBridgeIndexes: number[]
  nextCallIndex: number
}

function inspectToolCallGroup(items: TurnItem[], startIndex: number): ToolCallGroup {
  const first = items[startIndex]
  if (!first || first.kind !== 'tool_call') {
    return {
      valid: false,
      turnId: '',
      callIndexes: [],
      resultIndexes: [],
      assistantBridgeIndexes: [],
      nextCallIndex: startIndex + 1
    }
  }

  const turnId = first.turnId
  const callIds = new Set<string>()
  const callIndexes: number[] = []
  let callsAreValid = true
  let cursor = startIndex
  while (cursor < items.length && items[cursor]?.kind === 'tool_call') {
    const call = items[cursor] as Extract<TurnItem, { kind: 'tool_call' }>
    callIndexes.push(cursor)
    if (
      call.turnId !== turnId ||
      !isTerminalToolStatus(call.status) ||
      callIds.has(call.callId)
    ) {
      callsAreValid = false
    }
    callIds.add(call.callId)
    cursor += 1
  }

  const resultIds = new Set<string>()
  const resultIndexes: number[] = []
  const assistantBridgeIndexes: number[] = []
  let resultsAreValid = true
  let sawResult = false
  let resultCursor = cursor
  while (resultCursor < items.length) {
    const candidate = items[resultCursor]
    if (!candidate) break
    if (candidate.kind === 'tool_result') {
      sawResult = true
      resultIndexes.push(resultCursor)
      if (
        candidate.turnId !== turnId ||
        !isTerminalToolStatus(candidate.status) ||
        (candidate.status === 'failed' && candidate.isError !== true) ||
        !callIds.has(candidate.callId) ||
        resultIds.has(candidate.callId)
      ) {
        resultsAreValid = false
      }
      resultIds.add(candidate.callId)
      resultCursor += 1
      continue
    }
    if (isToolResultBridgeItem(candidate, { turnId, sawResult })) {
      if (candidate.kind === 'assistant_text' || candidate.kind === 'assistant_reasoning') {
        assistantBridgeIndexes.push(resultCursor)
      }
      resultCursor += 1
      continue
    }
    break
  }

  const completePairing = callIds.size > 0 && callIds.size === resultIds.size &&
    [...callIds].every((callId) => resultIds.has(callId))
  return {
    valid: callsAreValid && resultsAreValid && completePairing,
    turnId,
    callIndexes,
    resultIndexes,
    assistantBridgeIndexes,
    nextCallIndex: cursor
  }
}

function precedingAssistantRound(items: TurnItem[], startIndex: number, turnId: string): number[] {
  const indexes: number[] = []
  for (let index = startIndex - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (
      !item ||
      item.turnId !== turnId ||
      (item.kind !== 'assistant_text' && item.kind !== 'assistant_reasoning')
    ) {
      break
    }
    indexes.push(index)
  }
  return indexes
}

function isTerminalToolStatus(status: TurnItem['status']): boolean {
  return status === 'completed' || status === 'failed'
}

export function isToolResultBridgeItem(
  item: TurnItem,
  options: { turnId: string; sawResult: boolean }
): boolean {
  // A provider permits ignored runtime records between an assistant tool-call
  // message and its first tool result. Once results start, they must remain a
  // contiguous one-to-one sequence; otherwise an unrelated record can mask a
  // malformed result block. Interactive gate records are the exception: when
  // one parallel call finishes before another opens an approval or user_input
  // gate, that record lands between results. It is never model-visible, so it
  // must not invalidate (and silently drop) the whole round.
  if (options.sawResult) {
    return (item.kind === 'approval' || item.kind === 'user_input') && item.turnId === options.turnId
  }
  switch (item.kind) {
    case 'assistant_reasoning':
    case 'approval':
    case 'user_input':
    case 'error':
      return item.turnId === options.turnId
    case 'assistant_text':
      return item.turnId === options.turnId
    default:
      return false
  }
}
