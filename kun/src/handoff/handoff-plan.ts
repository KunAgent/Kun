import type { TurnItem } from '../contracts/items.js'
import type { DelegatedSessionPreparation } from '../runtime/delegated-session-binding.js'
import type { HandoffReason } from './handoff-types.js'

/** What the delegated runtime should prepend to this turn (docs/ade/08 §4). */
export type HandoffPlan =
  | { mode: 'full'; reason: HandoffReason }
  | { mode: 'delta'; sinceTurnId: string }

function isConversational(item: TurnItem): boolean {
  return item.kind === 'user_message' || item.kind === 'assistant_text'
}

/**
 * Decide whether the upcoming delegated turn needs a handoff brief. Injection
 * timing matches today's transcript rules — only the payload changes.
 */
export function needsHandoff(
  preparation: DelegatedSessionPreparation,
  priorItems: readonly TurnItem[]
): HandoffPlan | null {
  if (!priorItems.some(isConversational)) return null
  if (preparation.resumed) {
    return preparation.parkedDelta
      ? { mode: 'delta', sinceTurnId: preparation.parkedDelta.lastCommittedTurnId }
      : null
  }
  return {
    mode: 'full',
    reason:
      preparation.rebaseReason === 'route_changed' ? 'harness-switch' : 'rebase'
  }
}
