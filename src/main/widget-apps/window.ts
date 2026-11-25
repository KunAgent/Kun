import { app, BrowserWindow } from 'electron'
import { join } from 'node:path'
import { WidgetAppId } from '../../../kun/src/contracts/widget-app'
import { appEnvironment, developmentRendererUrl, mainState } from '../main-app-context'
import { resolveNamedPreloadPath } from '../main-paths'
import { hardenTrustedRendererWindow } from '../main-window'
import { registerAuxiliaryWorkbenchWindow } from '../renderer-trust-policy'
import { trackWidgetWindow, widgetAppStartup, widgetWindow } from './activation'
import { widgetAppIcon } from './icon'

export function openWidgetWindow(id: string, title = 'Kun'): void {
  WidgetAppId.parse(id)
  const existing = widgetWindow(id)
  if (existing && !existing.isDestroyed()) {
    if (existing.isMinimized()) existing.restore()
    existing.show()
    existing.focus()
    return
  }
  const owner = mainState.mainWindow
  const window = new BrowserWindow({
    title, icon: widgetAppIcon(id), width: 760, height: 600, minWidth: 260, minHeight: 180,
    show: false, autoHideMenuBar: true,
    webPreferences: {
      preload: resolveNamedPreloadPath(app.getAppPath(), 'index'),
      sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true,
      additionalArguments: ['--kun-app-environment=' + encodeURIComponent(JSON.stringify(appEnvironment))]
    }
  })
  if (process.platform === 'win32') window.setAppDetails({ appId: appEnvironment.appId + '.' + id })
  hardenTrustedRendererWindow(window, 'workbench')
  registerAuxiliaryWorkbenchWindow(window)
  const close = () => { if (!window.isDestroyed()) window.destroy() }
  owner?.once('closed', close)
  window.once('closed', () => owner?.removeListener('closed', close))
  trackWidgetWindow(id, window, () => {
    if (widgetAppStartup.launcherOnly && owner && !owner.isDestroyed() && !owner.isVisible()) app.quit()
  })
  const devUrl = developmentRendererUrl()
  const query = { widgetApp: id, lang: mainState.settledRuntimeSettings?.locale ?? app.getLocale().split('-')[0] ?? 'en' }
  let loading: Promise<void>
  if (devUrl) {
    const url = new URL(devUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    loading = window.loadURL(url.toString())
  } else {
    loading = window.loadFile(join(app.getAppPath(), 'out', 'renderer', 'index.html'), { query })
  }
  void loading.catch(error => { console.warn('[widget-app] Window load failed', error); close() })
  window.once('ready-to-show', () => { window.show(); window.focus() })
}
