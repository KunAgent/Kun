import { nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { ApprovalActionEnvelopeSchema } from '../../../kun/src/contracts/approvals'
import type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from '../../shared/kun-gui-api-protected-approval'
import { toolApprovalPresentation } from '../../shared/tool-approval-presentation'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent'
import { showProtectedRoomDialog } from '../protected-room-dialog'
import { isRemoteClientSender } from '../remote/remote-sender'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'
import type { ProtectedRuntimeRequestLease, RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { approvalLogReference, dialogParentIsAvailable, dialogParentState, revealDialogParent, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'

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

export function protectedApprovalControls(options: RegisterAppIpcHandlersOptions, dialogs: NativeDialogCoordinator) {
  return async (event: IpcMainInvokeEvent, request: KunProtectedApprovalRequest): Promise<KunProtectedApprovalResult> => {
    const approvalRef = approvalLogReference(request.approvalId)
    const logInfo = options.logInfo ?? (() => undefined)
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
    const parent = options.getMainWindow()
    const senderCurrent = () => Boolean(parent && options.getMainWindow() === parent &&
      event.sender.isDestroyed?.() !== true && dialogParentIsAvailable(parent) && trustedWorkbenchSenderIsCurrent(event, parent))
    if (!parent || !senderCurrent()) {
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
      const expected = JSON.stringify(before)
      const current = async () => {
        if (!senderCurrent()) return false
        try {
          const next = await lease.request(path, 'GET')
          return senderCurrent() && next.ok && JSON.stringify(snapshot(next.body, request.approvalId)) === expected
        } catch { return false }
      }
      const settings = await options.store.load()
      const zh = settings.locale.startsWith('zh')
      const content = { ...toolApprovalPresentation(before.approval, before.title, zh),
        confirmLabel: request.decision === 'allow' ? zh ? '允许一次' : 'Allow once' : zh ? '拒绝执行' : 'Deny action',
        dark: settings.theme === 'dark' || settings.theme === 'system' && nativeTheme.shouldUseDarkColors }
      const startedAt = Date.now()
      let allowed: boolean
      try {
        // Remote users already reviewed and confirmed their visible approval UI.
        allowed = isRemoteClientSender(event.sender) ? await current() : await dialogs.run(parent.webContents, async () => {
          if (!await current()) return false
          const windowBeforeReveal = dialogParentState(parent)
          revealDialogParent(parent)
          logInfo('approval', 'Opening protected approval dialog.', {
            approvalRef, decision: request.decision, windowBeforeReveal, windowAfterReveal: dialogParentState(parent)
          })
          return showProtectedRoomDialog(parent, content, current)
        })
      } catch (error) {
        options.logError('approval', 'Protected approval dialog failed.', {
          approvalRef, decision: request.decision, durationMs: Date.now() - startedAt,
          errorType: error instanceof Error ? error.name : typeof error
        })
        throw error
      }
      logInfo('approval', 'Protected approval dialog resolved.', {
        approvalRef, decision: request.decision, confirmed: allowed, durationMs: Date.now() - startedAt
      })
      if (!allowed) return { confirmed: false }
      if (!await current()) {
        logInfo('approval', 'Protected approval confirmation was not submitted.', {
          approvalRef, decision: request.decision, reason: 'approval_or_sender_changed_after_confirmation'
        })
        return { confirmed: false }
      }
    }
    // Keep this check after the final asynchronous snapshot read.
    if (!senderCurrent()) return { confirmed: false }
    const token = createApprovalConsentToken({ runtimeToken: lease.runtimeToken,
      approvalId: request.approvalId, decision: request.decision, expiresAt: Date.now() + 30_000 })
    return { confirmed: true, response: await lease.request(path, 'POST', JSON.stringify({ decision: request.decision }), {
      [KUN_APPROVAL_CONSENT_HEADER]: token
    }) }
  }
}
