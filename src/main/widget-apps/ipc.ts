import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import { z } from 'zod'
import { GenUiWidgetIdSchema, parseGenUiWidgetState, type GenUiWidgetState } from '../../../kun/src/contracts/gen-ui'
import { WidgetAppId, WidgetAppSource, widgetAppKey, type WidgetApp } from '../../../kun/src/contracts/widget-app'
import { FIRST_WIDGET_APP_VERSION, widgetAppId } from '../../../kun/src/gen-ui/widget-app-identity'
import { WIDGET_APP_CHANNELS as channels } from '../../shared/widget-apps'
import type { RegisterExtensionIpcHandlersOptions } from '../ipc/extension-ipc-handler-options'
import { appEnvironment } from '../main-app-context'
import { revealMainWindow } from '../main-tray'
import { assertTrustedWorkbenchSender } from '../ipc/app-ipc-handler-utils'
import { registerWidgetActivation, widgetAppForContents, widgetWindow } from './activation'
import { openWidgetWindow } from './window'
import { installWidgetLauncher, removeWidgetLauncher, type LauncherHost } from './launcher'
import { launcherIconBytes, widgetAppIcon } from './icon'

function launcherHost(): LauncherHost {
  const family = appEnvironment.flavor === 'development' ? 'Kun DV Apps' : 'Kun Apps'
  const homeDir = app.getPath('home')
  const directory = process.platform === 'darwin' ? join(homeDir, 'Applications', family)
    : process.platform === 'win32' ? join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs', family)
      : join(process.env.XDG_DATA_HOME || join(homeDir, '.local', 'share'), 'applications', family)
  return {
    platform: process.platform, directory, iconDirectory: join(app.getPath('userData'), 'widget-icons'),
    executable: process.platform === 'linux' && app.isPackaged && process.env.APPIMAGE ? process.env.APPIMAGE : process.execPath,
    appPath: app.isPackaged ? undefined : app.getAppPath(),
    developmentFlavor: !app.isPackaged && appEnvironment.flavor === 'development',
    userDataDir: process.argv.find(argument => argument.startsWith('--user-data-dir='))?.slice('--user-data-dir='.length),
    bundleId: appEnvironment.appId, icon: id => launcherIconBytes(widgetAppIcon(id).toPNG(), process.platform),
    writeShortcut: (path, details) => shell.writeShortcutLink(path, 'create', details),
    readShortcut: path => shell.readShortcutLink(path)
  }
}

export function registerWidgetAppIpc(options: Pick<RegisterExtensionIpcHandlersOptions,
  'getMainWindow' | 'runtimeRequest' | 'protectedActions'>): NonNullable<RegisterExtensionIpcHandlersOptions['withWidgetAppUninstall']> {
  const root = '/v1/gen-ui/apps'
  let launcherMutation = Promise.resolve()
  const replies = new Map<string, (sent: boolean) => void>()
  function local(event: IpcMainInvokeEvent, id?: string): void {
    assertTrustedWorkbenchSender(event, options.getMainWindow)
    const matches = id ? widgetAppForContents(event.sender) === id : event.sender === options.getMainWindow()?.webContents
    if (!matches) throw new Error('Unexpected widget app host')
  }
  async function request<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const result = await options.runtimeRequest(path, method, body === undefined ? undefined : JSON.stringify(body))
    if (!result.ok) {
      let message: string | undefined
      try {
        const body = JSON.parse(result.body)
        message = body.error?.message ?? body.message
      } catch { /* plain-text transport failure */ }
      throw new Error(message || 'Kun Runtime unavailable (' + result.status + ')')
    }
    return JSON.parse(result.body) as T
  }
  const info = async (id: string): Promise<WidgetApp | null> => {
    const result = await options.runtimeRequest(root + '/' + WidgetAppId.parse(id) + '/info')
    if (result.status === 404) return null
    if (!result.ok) throw new Error('Kun Runtime unavailable (' + result.status + ')')
    return JSON.parse(result.body) as WidgetApp
  }
  function changeLaunchers<T>(callback: () => Promise<T>): Promise<T> {
    const next = launcherMutation.then(callback)
    launcherMutation = next.then(() => undefined, () => undefined)
    return next
  }
  ipcMain.handle(channels.list, async event => {
    local(event)
    return (await request<{ apps: WidgetApp[] }>(root)).apps
  })
  ipcMain.handle(channels.install, async (event, raw) => {
    local(event)
    const source = WidgetAppSource.parse(raw)
    return changeLaunchers(async () => {
      const id = widgetAppId(source)
      const current = await info(id)
      const result = current ? { app: current, created: false } : await options.protectedActions.authorizeAndPerform({
        extensionId: id, extensionVersion: FIRST_WIDGET_APP_VERSION, operationKind: 'widget.install',
        parameters: { ...source, appKey: widgetAppKey(source) }, senderId: event.sender.id
      }, {
        title: 'Install as app', message: source.title,
        detail: 'Kun will create a system launcher. The app can save data on this computer and ask to send a message to this conversation. Edits in the conversation update the installed app.'
      }, () => {
        local(event)
        return request<{ app: WidgetApp; created: boolean }>(root, 'POST', source)
      })
      if (!result) return null
      const { app: installed, created } = result
      if (!installed.enabled) throw new Error('Enable this app in Plugins & extensions.')
      try {
        await installWidgetLauncher(launcherHost(), installed)
      } catch (error) {
        if (created && (await info(installed.id))?.version === installed.version) await request(root + '/' + installed.id, 'DELETE')
        throw error
      }
      openWidgetWindow(installed.id, installed.title)
      return installed
    })
  })
  ipcMain.handle(channels.open, async (event, raw) => {
    local(event)
    await changeLaunchers(async () => {
      const installed = await info(raw)
      if (!installed?.enabled) throw new Error('Installed app unavailable')
      // Retry also repairs a launcher removed in Finder or during a partial installation.
      await installWidgetLauncher(launcherHost(), installed)
      openWidgetWindow(installed.id, installed.title)
    })
  })
  ipcMain.handle(channels.info, async (event, raw) => {
    const id = WidgetAppId.parse(raw)
    local(event, id)
    return info(id)
  })
  ipcMain.handle(channels.save, async (event, raw) => {
    const { id, widgetId, state } = z.object({ id: WidgetAppId, widgetId: GenUiWidgetIdSchema, state: z.unknown() }).parse(raw)
    local(event, id)
    await request(root + '/' + id + '/state', 'PUT', { widgetId, state: parseGenUiWidgetState(state) })
  })
  ipcMain.handle(channels.followUp, async (event, raw) => {
    const { id, prompt } = z.object({ id: WidgetAppId, prompt: z.string().trim().min(1).max(8000) }).parse(raw)
    local(event, id)
    const page = await request<{ app: WidgetApp; state: GenUiWidgetState | null }>(root + '/' + id + '/page')
    const owner = options.getMainWindow()
    if (!owner || owner.isDestroyed()) return false
    revealMainWindow()
    const requestId = randomUUID()
    return new Promise<boolean>(resolve => {
      const timeout = setTimeout(() => done(false), 30000)
      const done = (sent: boolean) => { clearTimeout(timeout); replies.delete(requestId); resolve(sent) }
      replies.set(requestId, done)
      owner.webContents.send(channels.compose, { requestId, threadId: page.app.threadId, title: page.app.title,
        prompt, modelContent: page.state?.modelContent })
    })
  })
  ipcMain.on(channels.composed, (event, raw) => {
    if (event.sender !== options.getMainWindow()?.webContents || event.senderFrame !== event.sender.mainFrame) return
    if (typeof raw?.requestId === 'string') replies.get(raw.requestId)?.(raw.sent === true)
  })
  registerWidgetActivation(id => {
    void info(id).then(installed => {
      if (installed?.enabled) openWidgetWindow(id, installed.title)
      else revealMainWindow()
    }).catch(error => { console.warn('[widget-app] Launcher unavailable', error); revealMainWindow() })
  })
  return (id, version, uninstall) => {
    if (!WidgetAppId.safeParse(id).success) return uninstall()
    return changeLaunchers(async () => {
      const installed = await info(id)
      if (!installed || (version && installed.version !== version)) return uninstall()
      const host = launcherHost()
      await removeWidgetLauncher(host, installed)
      try {
        // Full removal shares the Runtime's per-app queue with automatic revisions.
        const result = version ? await uninstall() : await options.runtimeRequest(root + '/' + id, 'DELETE')
        if (result.ok) widgetWindow(id)?.close()
        else await installWidgetLauncher(host, installed)
        return result
      } catch (error) {
        if (await info(id)) await installWidgetLauncher(host, installed)
        throw error
      }
    })
  }
}
