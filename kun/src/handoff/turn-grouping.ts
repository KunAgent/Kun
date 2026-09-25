import type { TurnItem } from '../contracts/items.js'

/** One conversation turn distilled for the handoff brief (docs/ade/08 §3.2). */
export type ConversationTurn = {
  turnId: string
  /**
   * 1-based global turn number inside the thread — the same numbering the
   * `read_thread_history` `turnRange` filter uses. Compaction slicing and
   * delta modes never renumber earlier turns.
   */
  turnNumber: number
  /** The last user_message of the turn (displayText preferred). */
  userText?: string
  /** The last assistant_text of the turn. */
  assistantText?: string
  /** tool_call/tool_result items, retained only for work-state extraction. */
  toolItems: TurnItem[]
}

/**
 * Group items into turns in first-appearance order. Reasoning, approvals and
 * internal context records (`runtime_context_source`, `model_context`,
 * `goal_context`) never contribute their text; the current turn is excluded
 * from the result but still consumes its global turn number.
 */
export function groupConversationTurns(
  items: readonly TurnItem[],
  currentTurnId: string
): ConversationTurn[] {
  const turnOrder: string[] = []
  const numberByTurn = new Map<string, number>()
  const grouped = new Map<string, ConversationTurn>()
  for (const item of items) {
    let number = numberByTurn.get(item.turnId)
    if (number === undefined) {
      number = turnOrder.length + 1
      turnOrder.push(item.turnId)
      numberByTurn.set(item.turnId, number)
    }
    if (item.turnId === currentTurnId) continue
    let turn = grouped.get(item.turnId)
    if (!turn) {
      turn = { turnId: item.turnId, turnNumber: number, toolItems: [] }
      grouped.set(item.turnId, turn)
    }
    switch (item.kind) {
      case 'user_message':
        turn.userText = (item.displayText ?? item.text).trim()
        break
      case 'assistant_text':
        turn.assistantText = item.text.trim()
        break
      case 'tool_call':
      case 'tool_result':
        turn.toolItems.push(item)
        break
      default:
        break
    }
  }
  return turnOrder
    .map((turnId) => grouped.get(turnId))
    .filter((turn): turn is ConversationTurn => turn !== undefined)
}
