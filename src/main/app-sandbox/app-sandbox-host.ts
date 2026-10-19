import { writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { app, clipboard, dialog, ipcMain, net, session, shell, webContents, type BrowserWindow } from 'electron'
import { z } from 'zod'
import {
  APP_SANDBOX_CHANNELS,
  APP_SANDBOX_MAX_MESSAGE_BYTES,
  isAppSandboxInstanceId,
  type AppSandboxClosedEvent,
  type AppSandboxTheme
} from '../../shared/app-sandbox'
import type { RuntimeRequestResult } from '../../shared/kun-gui-api-contracts'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { logWarn } from '../logger'
import { AppSandboxRegistry } from './app-sandbox-registry'
import { AppSandboxProtocols } from './app-sandbox-protocol'
import { AppSandboxService, isAppSandboxTheme } from './app-sandbox-service'

/** One registry per Main process; the webview guard and IPC share it. */
export const appSandboxRegistry = new AppSandboxRegistry()

const instanceIdSchema = z.string().refine(isAppSandboxInstanceId, 'invalid instance id')
const themeSchema = z.custom<AppSandboxTheme>(isAppSandboxTheme, 'invalid theme')
const createGenUiSchema = z.object({
  threadId: z.string().min(1).max(256),
  widgetId: z.string().min(1).max(128),
  theme: themeSchema
}).strict()
const createMcpAppSchema = z.object({
  threadId: z.string().min(1).max(256),
  serverId: z.string().min(1).max(128),
  resourceUri: z.string().min(1).max(2_048),
  theme: themeSchema
}).strict()
const postSchema = z.object({ instanceId: instanceIdSchema, message: z.unknown() }).strict()
const instanceSchema = z.object({ instanceId: instanceIdSchema }).strict()
const openExternalSchema = z.object({ instanceId: instanceIdSchema, url: z.string().min(1).max(4_096) }).strict()
const MAX_SAVE_FILE_BASE64 = Math.ceil((32 * 1024 * 1024) / 3) * 4
const saveFileSchema = z.object({
  instanceId: instanceIdSchema,
  file: z.object({
    name: z.string().min(1).max(255),
    mimeType: z.string().min(1).max(128),
    base64: z.string().max(MAX_SAVE_FILE_BASE64)
  }).strict()
}).strict()
const helloSchema = z.object({ instanceId: instanceIdSchema, nonce: z.string().regex(/^[a-f0-9]{48}$/) }).strict()

function messageWithinLimit(message: unknown): boolean {
  try {
    const serialized = JSON.stringify(message)
    return typeof serialized === 'string' && Buffer.byteLength(serialized, 'utf8') <= APP_SANDBOX_MAX_MESSAGE_BYTES
  } catch {
    return false
  }
}

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

function ownedRecord(senderId: number, instanceId: string) {
  const record = appSandboxRegistry.get(instanceId)
  return record && record.ownerWebContentsId === senderId ? record : undefined
}

/** Tell the owning renderer that a page went away (crash, revoked navigation). */
export function notifyAppSandboxClosed(instanceId: string, reason: AppSandboxClosedEvent['reason']): void {
  const record = appSandboxRegistry.dispose(instanceId)
  if (!record) return
  const owner = webContents.fromId(record.ownerWebContentsId)
  if (owner && !owner.isDestroyed()) {
    owner.send(APP_SANDBOX_CHANNELS.closed, { instanceId, reason } satisfies AppSandboxClosedEvent)
  }
}

export function registerAppSandboxIpcHandlers(options: {
  getMainWindow: () => BrowserWindow | null
  runtimeRequest: (path: string, method?: string, body?: string) => Promise<RuntimeRequestResult>
}): void {
  let service: AppSandboxService | null = null
  const protocols: AppSandboxProtocols = new AppSandboxProtocols({
    registry: appSandboxRegistry,
    vendor: {
      isPackaged: app.isPackaged,
      appPath: app.getAppPath(),
      resourcesPath: process.resourcesPath
    },
    readMcpAppAsset: async (record, relativePath) => service ? service.readMcpAppAsset(record, relativePath) : null,
    passthroughFetch: (request) => net.fetch(request, { bypassCustomProtocolHandlers: true }),
    onDenied: (detail) => logWarn('app-sandbox', 'Denied sandbox request.', detail)
  })
  const appService = new AppSandboxService({
    registry: appSandboxRegistry,
    protocols,
    runtimeRequest: (path, method, body) => options.runtimeRequest(path, method, body),
    sessionFromPartition: (partition) => session.fromPartition(partition)
  })
  service = appService
  const observedOwners = new Set<number>()
  const observeOwner = (owner: Electron.WebContents): void => {
    if (observedOwners.has(owner.id)) return
    observedOwners.add(owner.id)
    owner.once('destroyed', () => {
      observedOwners.delete(owner.id)
      appSandboxRegistry.disposeOwner(owner.id)
    })
  }

  ipcMain.handle(APP_SANDBOX_CHANNELS.createGenUi, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    observeOwner(event.sender)
    return appService.createGenUi(event.sender.id, createGenUiSchema.parse(payload))
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.createMcpApp, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    observeOwner(event.sender)
    return appService.createMcpApp(event.sender.id, createMcpAppSchema.parse(payload))
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.dispose, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId } = instanceSchema.parse(payload)
    if (ownedRecord(event.sender.id, instanceId)) appSandboxRegistry.dispose(instanceId)
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.post, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId, message } = postSchema.parse(payload)
    const record = ownedRecord(event.sender.id, instanceId)
    if (!record?.guestWebContentsId || !messageWithinLimit(message)) return false
    const guest = webContents.fromId(record.guestWebContentsId)
    if (!guest || guest.isDestroyed()) return false
    guest.send(APP_SANDBOX_CHANNELS.hostMessage, { instanceId, message })
    return true
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.consumeGesture, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId } = instanceSchema.parse(payload)
    return ownedRecord(event.sender.id, instanceId) ? appSandboxRegistry.consumeGesture(instanceId) : false
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.openExternal, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId, url } = openExternalSchema.parse(payload)
    if (!ownedRecord(event.sender.id, instanceId) || !isHttpUrl(url)) return false
    await shell.openExternal(url)
    return true
  })
  ipcMain.handle(APP_SANDBOX_CHANNELS.capture, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId } = instanceSchema.parse(payload)
    const record = ownedRecord(event.sender.id, instanceId)
    const guest = record?.guestWebContentsId ? webContents.fromId(record.guestWebContentsId) : undefined
    if (!guest || guest.isDestroyed()) return null
    const image = await guest.capturePage()
    if (image.isEmpty()) return null
    clipboard.writeImage(image)
    return 'clipboard'
  })

  ipcMain.handle(APP_SANDBOX_CHANNELS.saveFile, async (event, payload: unknown) => {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const { instanceId, file } = saveFileSchema.parse(payload)
    if (!ownedRecord(event.sender.id, instanceId)) return false
    const window = options.getMainWindow()
    // eslint-disable-next-line no-control-regex -- suggested file names replace ASCII controls
    const defaultName = basename(file.name).replace(/[\\/:*?"<>|\u0000-\u001f]+/g, '-') || 'download'
    const choice = window
      ? await dialog.showSaveDialog(window, { defaultPath: defaultName })
      : await dialog.showSaveDialog({ defaultPath: defaultName })
    if (choice.canceled || !choice.filePath) return false
    await writeFile(choice.filePath, Buffer.from(file.base64, 'base64'))
    return true
  })
}

/**
 * Relay for the Kun-owned shell page inside each sandbox webview. Registered
 * once at startup next to the webview guard. A shell binds to its record only
 * with the launch nonce; later messages are matched by its webContents id.
 */
export function registerAppSandboxShellRelay(): void {
  ipcMain.on(APP_SANDBOX_CHANNELS.guestHello, (event, payload: unknown) => {
    const parsed = helloSchema.safeParse(payload)
    if (!parsed.success) return
    const host = event.sender.hostWebContents
    const record = appSandboxRegistry.get(parsed.data.instanceId)
    if (!host || !record || record.ownerWebContentsId !== host.id) return
    appSandboxRegistry.bindGuest(parsed.data.instanceId, parsed.data.nonce, event.sender.id)
  })
  ipcMain.on(APP_SANDBOX_CHANNELS.guestMessage, (event, payload: unknown) => {
    const parsed = postSchema.safeParse(payload)
    if (!parsed.success) return
    const record = appSandboxRegistry.findByGuest(event.sender.id)
    if (!record || record.instanceId !== parsed.data.instanceId) return
    if (!messageWithinLimit(parsed.data.message)) return
    const owner = webContents.fromId(record.ownerWebContentsId)
    if (!owner || owner.isDestroyed()) return
    owner.send(APP_SANDBOX_CHANNELS.message, { instanceId: record.instanceId, message: parsed.data.message })
  })
}
