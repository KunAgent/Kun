import { ipcMain, nativeTheme, type IpcMainInvokeEvent } from 'electron'
import type { RegisterAppIpcHandlersOptions } from './app-ipc-handler-options'
import type { NativeDialogCoordinator } from '../native-dialog-coordinator'
import { showProtectedRoomDialog } from '../protected-room-dialog'
import { alertDialogPayloadSchema, confirmDialogPayloadSchema } from './app-ipc-schemas'
import { assertTrustedWorkbenchSender, parseIpcPayload, revealDialogParent, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'

/** General business prompts share Kun's visual surface, without granting tool consent. */
export function registerAppConfirmationIpcHandlers(
  options: RegisterAppIpcHandlersOptions,
  coordinator: NativeDialogCoordinator
): void {
  const show = async (
    event: IpcMainInvokeEvent,
    request: { message: string; detail?: string; confirmLabel?: string; cancelLabel?: string },
    notice: boolean
  ): Promise<boolean> => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const parent = options.getMainWindow()
    if (!parent || parent.isDestroyed()) return false
    const settings = await options.store.load()
    const chinese = settings.locale.startsWith('zh')
    const current = async () => options.getMainWindow() === parent && !parent.isDestroyed() &&
      trustedWorkbenchSenderIsCurrent(event, parent)
    return coordinator.run(parent.webContents, async () => {
      if (!await current()) return false
      revealDialogParent(parent)
      const confirmed = await showProtectedRoomDialog(parent, {
        variant: notice ? 'notice' : 'confirmation',
        title: request.message,
        subtitle: '',
        body: request.detail ?? '',
        bodyLabel: chinese ? '详细说明' : 'Details',
        workspaceLabel: chinese ? '作用目录' : 'Working directory',
        footnote: '',
        cancelLabel: request.cancelLabel ?? (chinese ? '取消' : 'Cancel'),
        confirmLabel: request.confirmLabel ?? (chinese ? notice ? '知道了' : '确认' : 'OK'),
        language: chinese ? 'zh' : 'en',
        dark: settings.theme === 'dark' || settings.theme === 'system' && nativeTheme.shouldUseDarkColors
      }, current)
      return confirmed && await current()
    })
  }
  ipcMain.handle('dialog:confirm', (event, raw: unknown) =>
    show(event, parseIpcPayload('dialog:confirm', confirmDialogPayloadSchema, raw), false))
  ipcMain.handle('dialog:alert', async (event, raw: unknown): Promise<void> => {
    const request = parseIpcPayload('dialog:alert', alertDialogPayloadSchema, raw)
    await show(event, { ...request, confirmLabel: request.buttonLabel }, true)
  })
}
