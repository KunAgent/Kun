import { writeFile } from 'node:fs/promises'
import { validateSharePosterSave } from '../kun-account/share-poster-save'
import { app, dialog, ipcMain, net, safeStorage, shell, type BrowserWindow, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { KUN_ACCOUNT_CHANNELS as channels } from '../../shared/kun-account'
import { KUN_ACCOUNT_WARDROBE_CHANNELS as wardrobeChannels, type KunInviteSummary } from '../../shared/kun-account-economy'
import type { KunAvatarParts, KunWardrobeItemKey, KunWardrobeSettings } from '../../shared/rooms-api'
import { assertTrustedWorkbenchSender, revealDialogParent, trustedWorkbenchSenderIsCurrent } from './app-ipc-handler-utils'
import { KunAccountService } from '../kun-account/service'
import { createAccountStorage } from '../kun-account/storage'
import { createAccountTransport } from '../kun-account/transport'
import { listenForAccountCode } from '../kun-account/callback'
import { KUN_ACCOUNT_CLIENT_ID, KUN_ACCOUNT_ISSUER } from '../kun-account/config'
import { createEconomyClient } from '../kun-account/economy-client'
import { AccountWardrobeSync, type RuntimeCall } from '../kun-account/wardrobe-sync'

const ids = (value: unknown, max: number): string[] => {
  if (!Array.isArray(value) || !value.length || value.length > max || value.some((id) => typeof id !== 'string' || !id || id.length > 128)) {
    throw new Error('invalid wardrobe ids')
  }
  return value as string[]
}
const text = (value: unknown, max: number): string => {
  if (typeof value !== 'string' || !value.trim() || value.length > max) throw new Error('invalid wardrobe text')
  return value
}
const object = <T>(value: unknown): T => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('invalid wardrobe input')
  return value as T
}

export function registerKunAccountIpc(getMainWindow: () => BrowserWindow | null, runtimeRequest: RuntimeCall): void {
  // Created lazily: startup never prompts for the OS credential store.
  let service: KunAccountService | undefined
  let wardrobe: AccountWardrobeSync | undefined
  function account(): KunAccountService {
    if (service) return service
    wardrobe = new AccountWardrobeSync({
      economy: createEconomyClient({
        fetch: (url, options) => net.fetch(url instanceof URL ? url.href : String(url), options),
        token: (force) => account().accessToken(force),
        expire: () => account().expire()
      }),
      runtime: runtimeRequest,
      log: (message) => console.warn(`[kun-account] wardrobe ${message}`)
    })
    service = new KunAccountService({
      clientId: KUN_ACCOUNT_CLIENT_ID,
      transport: createAccountTransport((url, options) => net.fetch(url instanceof URL ? url.href : url, options), KUN_ACCOUNT_CLIENT_ID),
      storage: createAccountStorage(join(app.getPath('userData'), 'kun-account', KUN_ACCOUNT_CLIENT_ID, 'session.v1.json'), safeStorage),
      listen: listenForAccountCode,
      openBrowser: (url) => shell.openExternal(url),
      changed: (state) => {
        wardrobe?.accountChanged(state)
        const window = getMainWindow()
        if (window && !window.isDestroyed() && !window.webContents.isDestroyed() &&
            trustedWorkbenchSenderIsCurrent({ sender: window.webContents, senderFrame: window.webContents.mainFrame }, window)) window.webContents.send(channels.state, state)
      },
      focus: () => { const window = getMainWindow(); if (window && !window.isDestroyed()) revealDialogParent(window) }
    })
    app.once('before-quit', () => { service?.dispose(); wardrobe?.dispose() })
    return service
  }
  const sync = (): AccountWardrobeSync => { account(); return wardrobe! }
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

  const handle = (channel: string, run: (input: unknown) => Promise<unknown>) =>
    ipcMain.handle(channel, (event: IpcMainInvokeEvent, input: unknown) => { assertTrustedWorkbenchSender(event, getMainWindow); return run(input) })
  let savedPosterPath: string | undefined
  handle(wardrobeChannels.revealSharePoster, async () => {
    if (savedPosterPath) shell.showItemInFolder(savedPosterPath)
  })
  handle(wardrobeChannels.saveSharePoster, async (input) => {
    const { bytes, fileName } = validateSharePosterSave(input)
    const parent = getMainWindow()
    const options = { defaultPath: join(app.getPath('downloads'), fileName), filters: [{ name: 'PNG', extensions: ['png'] }] }
    if (parent) revealDialogParent(parent)
    const result = parent ? await dialog.showSaveDialog(parent, options) : await dialog.showSaveDialog(options)
    if (result.canceled || !result.filePath) return { status: 'cancelled' }
    await writeFile(result.filePath, bytes)
    savedPosterPath = result.filePath
    return { status: 'saved', path: result.filePath }
  })
  handle(wardrobeChannels.sync, () => sync().sync())
  handle(wardrobeChannels.open, (input) => { const list = ids(input, 10); return sync().change((economy) => economy.open(list)) })
  handle(wardrobeChannels.stash, (input) => { const list = ids(input, 200); return sync().change((economy) => economy.stash(list)) })
  handle(wardrobeChannels.seen, (input) => { const list = ids(input, 300); return sync().change((economy) => economy.seen(list)) })
  handle(wardrobeChannels.settings, (input) => {
    const settings = object<Partial<KunWardrobeSettings>>(input)
    return sync().change((economy) => economy.settings(settings))
  })
  handle(wardrobeChannels.exchange, (input) => {
    const key = text(input, 80) as KunWardrobeItemKey
    return sync().change((economy) => economy.exchange(key))
  })
  handle(wardrobeChannels.setLook, (input) => {
    const look = object<KunAvatarParts>(input)
    return sync().change((economy) => economy.setLook(look), { look: true })
  })
  handle(wardrobeChannels.shop, () => sync().read((economy) => economy.shop()))
  handle(wardrobeChannels.purchase, (input) => {
    const offer = text(input, 64)
    return sync().change((economy) => economy.purchase(offer))
  })
  handle(wardrobeChannels.invites, () => sync().read((economy) => economy.invites()))
  handle(wardrobeChannels.claimInvite, async (input) => {
    const code = text(input, 32)
    const result = await sync().read<KunInviteSummary>((economy) => economy.claimInvite(code))
    // An already active account is paid at once; show the new bottles.
    if (result.ok && result.value.invitedBy?.status === 'rewarded') await sync().refresh()
    return result
  })
}
