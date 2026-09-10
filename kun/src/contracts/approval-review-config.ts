import { z } from 'zod'

/**
 * Authority selection for automatic tool approval review. `inherit` preserves
 * the acting turn's exact model route; `fixed` is an explicit atomic provider
 * route and must never silently fall back to another credential boundary.
 */
export const ApprovalReviewModelSelectionSchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('inherit') }).strict(),
  z.object({
    mode: z.literal('fixed'),
    providerId: z.string().min(1).max(128),
    accountId: z.string().min(1).max(128).optional(),
    model: z.string().min(1).max(512)
  }).strict()
])
export type ApprovalReviewModelSelection = z.infer<typeof ApprovalReviewModelSelectionSchema>

export const DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION: ApprovalReviewModelSelection = {
  mode: 'inherit'
}

export function approvalReviewSelectionEquals(
  left: ApprovalReviewModelSelection | undefined,
  right: ApprovalReviewModelSelection | undefined
): boolean {
  const effectiveLeft = left ?? DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION
  const effectiveRight = right ?? DEFAULT_APPROVAL_REVIEW_MODEL_SELECTION
  if (effectiveLeft.mode !== effectiveRight.mode) return false
  if (effectiveLeft.mode === 'inherit') return true
  const fixedRight = effectiveRight as Extract<ApprovalReviewModelSelection, { mode: 'fixed' }>
  return effectiveLeft.providerId === fixedRight.providerId &&
    effectiveLeft.model === fixedRight.model &&
    (effectiveLeft.accountId ?? undefined) === (fixedRight.accountId ?? undefined)
}
