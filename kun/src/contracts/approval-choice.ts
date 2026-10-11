import { z } from 'zod'

export const ApprovalPermissionOptionSchema = z.object({
  optionId: z.string().min(1).max(1024),
  name: z.string().max(1024),
  kind: z.enum(['allow_once', 'allow_always', 'reject_once', 'reject_always'])
}).strict()
export type ApprovalPermissionOption = z.infer<typeof ApprovalPermissionOptionSchema>

export const ApprovalChoiceSchema = z.union([
  z.object({ optionId: z.string().min(1).max(1024) }).strict(),
  z.object({ cancelled: z.literal(true) }).strict()
])
export type ApprovalChoice = z.infer<typeof ApprovalChoiceSchema>

/** The exact scope the human chose is part of protected approval consent. */
export function approvalChoiceKey(choice?: ApprovalChoice): string {
  return !choice ? '' : 'optionId' in choice ? JSON.stringify(['option', choice.optionId]) : '["cancelled"]'
}

export function approvalChoiceIsValid(
  options: readonly ApprovalPermissionOption[] | undefined,
  decision: 'allow' | 'deny',
  choice?: ApprovalChoice
): boolean {
  if (!choice) return true
  if (!options?.length) return false
  if ('cancelled' in choice) return decision === 'deny'
  const matching = options.filter((candidate) => candidate.optionId === choice.optionId)
  const option = matching.length === 1 ? matching[0] : undefined
  return Boolean(option && (option.kind.startsWith('allow') ? decision === 'allow' : decision === 'deny'))
}
