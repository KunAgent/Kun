import type { TurnItem } from '../contracts/items.js'
import type { DelegatedSessionPreparation } from '../runtime/delegated-session-binding.js'
import type { HandoffReason } from './handoff-types.js'

/** What the delegated runtime should prepend to this turn. */
export type HandoffPlan =
  | { mode: 'full'; reason: HandoffReason }
  | { mode: 'delta'; sinceTurnId: string }

function isConversational(item: TurnItem): boolean {
  return item.kind === 'user_message' || item.kind === 'assistant_text'
}

/** True when a rebase keeps the exact same Agent (providerKind + providerId). */
export function isSameAgentRebase(preparation: DelegatedSessionPreparation): boolean {
  const from = preparation.rebasedFrom
  return Boolean(
    from &&
    from.providerKind === preparation.route.providerKind &&
    from.providerId === preparation.route.providerId
  )
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
      preparation.rebaseReason === 'route_changed' && !isSameAgentRebase(preparation)
        ? 'harness-switch'
        : 'rebase'
  }
}
