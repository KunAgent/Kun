import type { ApprovalChoice } from '@shared/approval-choice'
import { runtimeErrorToError } from '@shared/runtime-error'
import { readRuntimeError } from './kun-runtime-services'

export async function submitKunApprovalDecision(
  approvalId: string,
  decision: 'allow' | 'deny',
  userInitiated = false,
  choice?: ApprovalChoice
): Promise<'submitted' | 'cancelled'> {
  const result = await window.kunGui.resolveKunApproval({
    approvalId, decision, source: userInitiated ? 'user' : 'policy', ...(choice ? { choice } : {})
  })
  if (!result.confirmed) return 'cancelled'
  if (!result.response.ok) throw runtimeErrorToError(readRuntimeError(result.response.body, 'approval decision failed'))
  return 'submitted'
}
