import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanupAppIpcHandlerTestState, getAppIpcElectronMock, handlers, registerOptions,
  resetAppIpcHandlerTestState, settings } from './register-app-ipc-handlers.test-support'
import { NativeDialogCoordinator } from '../native-dialog-coordinator'
import { registerAppConfirmationIpcHandlers } from './register-app-confirmation-ipc'

vi.mock('../main-window', () => ({ trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html' }))
const electron = getAppIpcElectronMock()
beforeEach(resetAppIpcHandlerTestState)
afterEach(cleanupAppIpcHandlerTestState)

function setup(chinese = true) {
  const mainFrame = { processId: 10, routingId: 20, detached: false, url: 'http://127.0.0.1:5173/index.html' }
  const contents = { id: 7, mainFrame, isDestroyed: () => false }
  const parent = { webContents: contents, isDestroyed: () => false, focus: vi.fn() }
  const store = { load: vi.fn(async () => ({ ...settings(), locale: chinese ? 'zh' : 'en', theme: 'dark' })) }
  registerAppConfirmationIpcHandlers(registerOptions({ getMainWindow: () => parent as never,
    store: store as never }), new NativeDialogCoordinator())
  return { parent, contents, event: { sender: contents, senderFrame: mainFrame } }
}

describe('application confirmation IPC', () => {
  it('uses the app theme and explicit action label without a system dialog', async () => {
    const { event, parent } = setup()
    electron.showProtectedDialog.mockResolvedValue(true)
    await expect(handlers.get('dialog:confirm')!(event, {
      message: '删除此会话？', detail: '归档记录仍然保留。', confirmLabel: '删除'
    })).resolves.toBe(true)
    expect(electron.showProtectedDialog).toHaveBeenCalledWith(parent, expect.objectContaining({
      title: '删除此会话？', body: '归档记录仍然保留。', confirmLabel: '删除', cancelLabel: '取消',
      language: 'zh', dark: true, variant: 'confirmation'
    }), expect.any(Function))
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('uses a single-action notice for alerts and does not create authorization', async () => {
    const { event } = setup(false)
    electron.showProtectedDialog.mockResolvedValue(false)
    await expect(handlers.get('dialog:alert')!(event, { message: 'Export finished', buttonLabel: 'Done' }))
      .resolves.toBeUndefined()
    expect(electron.showProtectedDialog.mock.calls[0][1]).toMatchObject({ variant: 'notice',
      confirmLabel: 'Done', body: '', language: 'en' })
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })

  it('rejects untrusted frames before showing host-branded content', async () => {
    const { event } = setup()
    await expect(handlers.get('dialog:confirm')!({ ...event,
      senderFrame: { ...event.senderFrame, routingId: 21 } }, { message: 'Untrusted action' }))
      .rejects.toThrow('trusted workbench frame')
    expect(electron.showProtectedDialog).not.toHaveBeenCalled()
  })

  it('does not return an accepted confirmation to a replacement document', async () => {
    const { event, contents } = setup()
    electron.showProtectedDialog.mockImplementationOnce(async () => {
      contents.mainFrame = { ...contents.mainFrame, routingId: 21 }
      return true
    })
    await expect(handlers.get('dialog:confirm')!(event, { message: 'Delete this item?' })).resolves.toBe(false)
  })

  it('does not fall back to a system dialog when the app surface fails', async () => {
    const { event } = setup()
    electron.showProtectedDialog.mockRejectedValueOnce(new Error('Window failed'))
    await expect(handlers.get('dialog:confirm')!(event, { message: 'Delete this item?' })).rejects.toThrow('Window failed')
    expect(electron.showMessageBox).not.toHaveBeenCalled()
  })
})
