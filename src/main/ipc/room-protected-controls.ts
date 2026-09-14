import { ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import type { ApprovalRequest } from '../../../kun/src/domain/approval'
import { RoomPermissionRequestSchema, roomPermissionConsentSubject } from '../../../kun/src/contracts/room-permissions'
import type { RoomPermissionState } from '../../shared/rooms-api'
import type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from '../../shared/kun-gui-api-protected-approval'
import { roomApprovalCopy, roomApprovalPresentation } from '../../shared/room-approval-presentation'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent'
import { showProtectedRoomDialog } from '../protected-room-dialog'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import { assertTrustedWorkbenchSender, trustedWorkbenchSenderIsCurrent, revealDialogParent } from './app-ipc-handler-utils'

export function roomProtectedControls(options: RegisterAppIpcHandlersOptions, dialogs: NativeDialogCoordinator) {
  const settings = async () => {
    const value = await options.store.load()
    return { copy: roomApprovalCopy(value.locale.startsWith('zh')), dark: value.theme === 'dark' || value.theme === 'system' && nativeTheme.shouldUseDarkColors }
  }
  const trusted = (event: IpcMainInvokeEvent) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    options.assertRendererRuntimeReady()
    const parent = options.getMainWindow()
    if (!parent || parent.isDestroyed()) throw new Error('Approval window is unavailable')
    return parent
  }
  ipcMain.handle('room:permissions:set', async (event, raw: unknown) => {
    const parent = trusted(event)
    const { roomId, ...input } = RoomPermissionRequestSchema.extend({ roomId: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/) }).parse(raw)
    const lease = await options.acquireRuntimeRequestLease()
    const path = '/v1/rooms/' + encodeURIComponent(roomId) + '/direct/permissions'
    const response = await lease.request(path)
    if (!response.ok) throw new Error(response.body)
    const before = JSON.parse(response.body) as RoomPermissionState
    if (before.revision !== input.expectedRevision) throw new Error('Conversation changed; reopen permission settings')
    if (input.mode === 'full-access' && before.fullAccessUnavailable) throw new Error(before.fullAccessUnavailable)
    if (input.mode === before.mode) return { confirmed: true, state: before }
    const { copy, dark } = await settings()
    const allowed = await dialogs.run(parent.webContents, async () => {
      if (!trustedWorkbenchSenderIsCurrent(event, parent)) return false
      revealDialogParent(parent)
      return showProtectedRoomDialog(parent, { title: copy.changeTitle, subtitle: copy.modes[input.mode],
        body: input.mode === 'full-access' ? copy.full : input.mode === 'approve-for-me' ? copy.auto : copy.ask,
        workspaceLabel: copy.workspace, footnote: copy.next, cancelLabel: copy.cancel, confirmLabel: copy.apply, dark, accent: input.mode === 'full-access' })
    })
    if (!allowed || !trustedWorkbenchSenderIsCurrent(event, parent)) return { confirmed: false }
    const token = createApprovalConsentToken({ runtimeToken: lease.runtimeToken, approvalId: roomPermissionConsentSubject(roomId, input), decision: 'allow', expiresAt: Date.now() + 30000 })
    const saved = await lease.request(path, 'PUT', JSON.stringify(input), { [KUN_APPROVAL_CONSENT_HEADER]: token })
    if (!saved.ok) throw new Error(saved.body)
    return { confirmed: true, state: JSON.parse(saved.body) }
  })
  return async (event: IpcMainInvokeEvent, request: KunProtectedApprovalRequest): Promise<KunProtectedApprovalResult> => {
    if (request.source !== 'user') throw new Error('Room approval requires a user decision')
    const parent = trusted(event), lease = await options.acquireRuntimeRequestLease()
    const path = '/v1/approvals/' + encodeURIComponent(request.approvalId)
    const response = await lease.request(path)
    if (!response.ok) return { confirmed: true, response }
    const { approval, title } = JSON.parse(response.body) as { approval: ApprovalRequest; title: string }
    if (approval.id !== request.approvalId || approval.status !== 'pending') return { confirmed: false }
    const presentation = roomApprovalPresentation(approval), { copy, dark } = await settings()
    const current = async () => {
      const next = await lease.request(path)
      return next.ok && JSON.parse(next.body).approval?.status === 'pending'
    }
    const allowed = await dialogs.run(parent.webContents, async () => {
      if (!trustedWorkbenchSenderIsCurrent(event, parent) || !await current()) return false
      revealDialogParent(parent)
      return showProtectedRoomDialog(parent, { title: copy[presentation.kind], subtitle: title + ' · ' + presentation.tool,
        body: presentation.content, workspace: presentation.workspace, workspaceLabel: copy.workspace,
        footnote: copy.once, cancelLabel: copy.cancel, confirmLabel: request.decision === 'allow' ? copy.allow : copy.deny, dark }, current)
    })
    if (!allowed || !trustedWorkbenchSenderIsCurrent(event, parent)) return { confirmed: false }
    const token = createApprovalConsentToken({ runtimeToken: lease.runtimeToken, approvalId: request.approvalId, decision: request.decision, expiresAt: Date.now() + 30000 })
    return { confirmed: true, response: await lease.request(path, 'POST', JSON.stringify({ decision: request.decision }), { [KUN_APPROVAL_CONSENT_HEADER]: token }) }
  }
}
