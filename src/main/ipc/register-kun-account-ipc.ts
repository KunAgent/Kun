import { app, ipcMain, net, safeStorage, shell, type BrowserWindow } from 'electron'
import { join } from 'node:path'
import { KUN_ACCOUNT_CHANNELS as channels } from '../../shared/kun-account'
import { assertTrustedWorkbenchSender, revealDialogParent, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'
import { KunAccountService } from '../kun-account/service'
import { createAccountStorage } from '../kun-account/storage'
import { createAccountTransport } from '../kun-account/transport'
import { listenForAccountCode } from '../kun-account/callback'
import { KUN_ACCOUNT_CLIENT_ID, KUN_ACCOUNT_ISSUER } from '../kun-account/config'

export function registerKunAccountIpc(getMainWindow: () => BrowserWindow | null): void {
  // Created lazily: startup never prompts for the OS credential store.
  let service: KunAccountService | undefined
  function account(): KunAccountService {
    if (service) return service
    service = new KunAccountService({
      clientId: KUN_ACCOUNT_CLIENT_ID,
      transport: createAccountTransport((url, options) => net.fetch(url instanceof URL ? url.href : url, options), KUN_ACCOUNT_CLIENT_ID),
      storage: createAccountStorage(join(app.getPath('userData'), 'kun-account', KUN_ACCOUNT_CLIENT_ID, 'session.v1.json'), safeStorage),
      listen: listenForAccountCode,
      openBrowser: (url) => shell.openExternal(url),
      changed: (state) => {
        const window = getMainWindow()
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed() &&
            trustedWorkbenchSenderIsCurrent({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, window)) window.webContents.send(channels.state, state)
      },
      focus: () => { const window = getMainWindow(); if (window && !window.isDestroyed()) revealDialogParent(window) }
    })
    app.once('before-quit', () => service?.dispose())
    return service
  }
  for (const [channel, action] of [
    [channels.get, 'getState'], [channels.login, 'login'], [channels.reopen, 'reopenLogin'], [channels.cancel, 'cancelLogin'],
    [channels.refresh, 'refresh'], [channels.logout, 'logout']
  ] as const) {
    ipcMain.handle(channel, (event) => { assertTrustedWorkbenchSender(event, getMainWindow); return account()[action]() })
  }
  ipcMain.handle(channels.manage, async (event) => {
    assertTrustedWorkbenchSender(event, getMainWindow)
    await shell.openExternal(`${KUN_ACCOUNT_ISSUER}/auth/account`)
  })
}
