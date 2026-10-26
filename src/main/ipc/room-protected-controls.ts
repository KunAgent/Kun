import { ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { protectedApprovalControls } from './protected-approval-controls'
import { RoomPermissionRequestSchema, roomPermissionConsentSubject } from '../../../kun/src/contracts/room-permissions'
import type { RoomPermissionState } from '../../shared/rooms-api'
import type { KunProtectedApprovalRequest, KunProtectedApprovalResult } from '../../shared/kun-gui-api-protected-approval'
import { roomApprovalCopy } from '../../shared/room-approval-presentation'
import { createApprovalConsentToken, KUN_APPROVAL_CONSENT_HEADER } from '../approval-consent'
import { showProtectedRoomDialog } from '../protected-room-dialog'
import { isRemoteClientSender } from '../remote/remote-sender'
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
    // Remote clients confirm inside the browser UI; the host-side protected
    // dialog would be invisible to them, so their explicit invoke is the consent.
    const allowed = isRemoteClientSender(event.sender)
      ? true
      : await dialogs.run(parent.webContents, async () => {
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
  const decideApproval = protectedApprovalControls(options)
  return async (event: IpcMainInvokeEvent, request: KunProtectedApprovalRequest): Promise<KunProtectedApprovalResult> => {
    if (request.source !== 'user') throw new Error('Room approval requires a user decision')
    trusted(event)
    return decideApproval(event, request)
  }
}
