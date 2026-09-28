/**
 * Action guidance for a rejected model request.
 *
 * The `no_compactable_history` dead zone is the case where the fixed per-request
 * overhead (system prompt, tool schemas, context capsules) plus the current
 * message already fills the cap. Advising `/compact` there is useless: the same
 * compaction path has just run and could not fold anything, so the user only
 * wastes a turn. Name what can actually help instead.
 */
export type ContextCapExceededReason =
  | 'output_budget_exceeds_cap'
  | 'request_too_large'
  | 'still_exceeds_after_compaction'
  | 'no_compactable_history'

export function contextCapExceededAction(
  reason: ContextCapExceededReason
): string {
  if (reason === 'output_budget_exceeds_cap') {
    return "Reduce the model's max output tokens in provider settings, " +
      'or switch to a model with a larger context window.'
  }
  if (reason === 'no_compactable_history') {
    return 'The current message, its attachments, or the fixed per-request overhead ' +
      '(system prompt, tools, context) already fills the cap on its own, so history ' +
      'compaction cannot rescue this turn. Shorten the current message or attachments, ' +
      'drop unused tools or skills, start a new turn instead of extending this one, ' +
      'or switch to a model with a larger context window.'
  }
  if (reason === 'still_exceeds_after_compaction') {
    return 'Compaction ran and the request still does not fit. Shorten the current ' +
      'message or attachments, or start a new turn instead of extending this one.'
  }
  return 'Shorten the current message or attachments, or start a new turn instead of ' +
    'extending this one.'
}
