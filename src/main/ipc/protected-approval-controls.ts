import type { IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ApprovalActionEnvelopeSchema } from '../../../kun/src/contracts/approvals'
import { approvalChoiceIsValid } from '../../../kun/src/contracts/approval-choice'
import type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from '../../shared/kun-gui-api-protected-approval'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent'
import type { ProtectedRuntimeRequestLease, RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { approvalLogReference, dialogParentIsAvailable, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'

const SnapshotSchema = z.object({
  title: z.string(),
  approval: z.object({
    id: z.string(), threadId: z.string(), turnId: z.string(), toolName: z.string(),
    summary: z.string(), createdAt: z.string(), status: z.literal('pending'),
    action: ApprovalActionEnvelopeSchema.optional()
  }).passthrough()
}).passthrough()

function snapshot(body: string, approvalId: string) {
  try {
    const parsed = SnapshotSchema.safeParse(JSON.parse(body))
    return parsed.success && parsed.data.approval.id === approvalId ? parsed.data : undefined
  } catch { return undefined }
}

export function protectedApprovalControls(options: RegisterAppIpcHandlersOptions) {
  return async (event: IpcMainInvokeEvent, request: KunProtectedApprovalRequest): Promise<KunProtectedApprovalResult> => {
    const approvalRef = approvalLogReference(request.approvalId)
    if (request.choice && request.source !== 'user') throw new Error('Explicit approval choices require user confirmation.')
    const logInfo = options.logInfo ?? (() => undefined)
    // Capture the window before awaiting Runtime startup; a replacement is not the requesting window.
    const parent = options.getMainWindow()
    const senderCurrent = () => Boolean(parent && options.getMainWindow() === parent &&
      event.sender.isDestroyed?.() !== true && dialogParentIsAvailable(parent) && trustedWorkbenchSenderIsCurrent(event, parent))
    let lease: ProtectedRuntimeRequestLease
    try { lease = await options.acquireRuntimeRequestLease() }
    catch (error) {
      options.logError('approval', 'Protected approval Runtime lease acquisition failed.', {
        approvalRef, decision: request.decision, errorType: error instanceof Error ? error.name : typeof error
      })
      return { confirmed: true, response: { ok: false, status: 0, body: JSON.stringify({
        code: 'runtime_unhealthy', message: 'Kun Runtime is unavailable. Retry after it finishes starting.'
      }) } }
    }
    if (!senderCurrent()) {
      logInfo('approval', 'Protected approval confirmation was not submitted.', {
        approvalRef, decision: request.decision, reason: 'parent_or_sender_unavailable_after_runtime_ensure'
      })
      return { confirmed: false }
    }
    const path = `/v1/approvals/${encodeURIComponent(request.approvalId)}`
    if (request.source === 'user') {
      const response = await lease.request(path, 'GET')
      if (!response.ok) return { confirmed: true, response }
      const before = snapshot(response.body, request.approvalId)
      if (!before || !senderCurrent()) return { confirmed: false }
      if (!approvalChoiceIsValid(before.approval.action?.permissionOptions, request.decision, request.choice)) {
        throw new Error('The selected approval option is no longer available.')
      }
      const expected = JSON.stringify(before)
      const current = async () => {
        if (!senderCurrent()) return false
        try {
          const next = await lease.request(path, 'GET')
          return senderCurrent() && next.ok && JSON.stringify(snapshot(next.body, request.approvalId)) === expected
        } catch { return false }
      }
      // The visible card is the confirmation for local and remote users alike.
      // This deliberately does not isolate consent from a compromised workbench DOM.
      if (!await current()) {
        logInfo('approval', 'Protected approval confirmation was not submitted.', {
          approvalRef, decision: request.decision, reason: 'approval_or_sender_changed_before_submission'
        })
        return { confirmed: false }
      }
    }
    // Keep this check after the final asynchronous snapshot read.
    if (!senderCurrent()) return { confirmed: false }
    const token = createApprovalConsentToken({ runtimeToken: lease.runtimeToken,
      approvalId: request.approvalId, decision: request.decision, choice: request.choice, expiresAt: Date.now() + 30_000 })
    return { confirmed: true, response: await lease.request(path, 'POST', JSON.stringify({ decision: request.decision, ...(request.choice ? { choice: request.choice } : {}) }), {
      [KUN_APPROVAL_CONSENT_HEADER]: token
    }) }
  }
}
