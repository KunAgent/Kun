import { app, BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { DAILY_NOTES_CHANNELS as channels, type DailyNotesAppearance, type DailyNotesContext } from '../../shared/daily-notes'
import { resolveNamedPreloadPath } from '../main-paths'
import { isNativeWaylandSession } from '../pets/pet-platform'
import { isTrustedRendererUrl, isTrustedRendererSurfaceUrl } from '../renderer-trust-policy'
import { fitWindowToWorkArea } from '../window-mini-mode'
import { DailyNotesStore } from './store'

type Options = {
  getMainWindow: () => BrowserWindow | null
  getAppearance: () => DailyNotesAppearance
  developmentUrl?: string
}

export function registerDailyNotesIpc({ getMainWindow, getAppearance, developmentUrl }: Options): () => Promise<void> {
  const appPath = app.getAppPath()
  const rendererPath = join(appPath, 'out', 'renderer')
  const workbenchUrl = developmentUrl ?? pathToFileURL(join(rendererPath, 'index.html')).href
  const noteUrl = new URL('daily-notes.html', workbenchUrl).href
  const store = new DailyNotesStore(join(app.getPath('userData'), 'daily-notes'))
  const canPin = !isNativeWaylandSession(process.platform, app.commandLine.getSwitchValue('ozone-platform'), process.env)
  let note: BrowserWindow | null = null
  let opening: Promise<void> | null = null
  let closing: Promise<void> | null = null
  let finishEditing: ((saved: boolean) => void) | null = null
  let editorReady = false
  let quitting = false

  app.on('before-quit', () => { quitting = true })

  function requireNote(event: IpcMainInvokeEvent): BrowserWindow {
    if (!note || note.isDestroyed() || event.sender !== note.webContents ||
        !event.senderFrame || event.senderFrame !== note.webContents.mainFrame ||
        !isTrustedRendererUrl(event.senderFrame.url, noteUrl)) throw new Error('Untrusted daily notes window')
    return note
  }

  async function close(window: BrowserWindow): Promise<void> {
    if (editorReady && !window.webContents.isCrashed()) {
      const saved = await new Promise<boolean>(resolve => {
        finishEditing = resolve
        window.webContents.send(channels.requestClose)
      })
      if (!saved) return
    }
    await store.flush()
    if (window.isDestroyed()) return
    await store.saveWindowState({ bounds: window.getNormalBounds(), pinned: canPin && window.isAlwaysOnTop() })
      .catch(error => console.warn('[daily-notes] Could not save window position', error))
    if (!window.isDestroyed()) window.destroy()
    // Vetoing the first native close cancels Electron's quit. Resume it once
    // the renderer has committed the active input and the write is durable.
    if (quitting) app.quit()
  }

  async function create(): Promise<void> {
    const saved = await store.readWindowState()
    const owner = getMainWindow()
    const display = saved ? screen.getDisplayMatching(saved.bounds) :
      owner && !owner.isDestroyed() ? screen.getDisplayMatching(owner.getBounds()) : screen.getPrimaryDisplay()
    const area = display.workArea
    const bounds = fitWindowToWorkArea(saved?.bounds ?? {
      width: 416, height: 600, x: area.x + area.width - 440, y: area.y + 32
    }, area)
    const window = new BrowserWindow({
      ...bounds,
      minWidth: Math.min(300, area.width), minHeight: Math.min(280, area.height),
      title: 'Kun', show: false, autoHideMenuBar: true, fullscreenable: false,
      alwaysOnTop: canPin && (saved?.pinned ?? true),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#202221' : '#fbfaf7',
      webPreferences: {
        preload: resolveNamedPreloadPath(appPath, 'daily-notes'),
        contextIsolation: true, sandbox: true, nodeIntegration: false
      }
    })
    note = window
    editorReady = false
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
    window.webContents.on('will-navigate', (event, url) => {
      if (!isTrustedRendererUrl(url, noteUrl)) event.preventDefault()
    })
    window.webContents.on('will-redirect', event => event.preventDefault())
    window.webContents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) {
        editorReady = false
        finishEditing?.(true)
      }
    })
    window.webContents.on('render-process-gone', () => {
      editorReady = false
      finishEditing?.(true)
    })
    const refit = (): void => {
      if (!canPin || window.isDestroyed() || window.isMinimized()) return
      const current = window.getBounds()
      window.setBounds(fitWindowToWorkArea(current, screen.getDisplayMatching(current).workArea))
    }
    screen.on('display-removed', refit)
    window.on('close', event => {
      event.preventDefault()
      if (closing) return
      closing = close(window).catch(error => console.error('[daily-notes] Could not flush notes', error))
        .finally(() => { closing = null; finishEditing = null })
    })
    window.once('closed', () => {
      screen.removeListener('display-removed', refit)
      finishEditing?.(true)
      note = null
    })
    try {
      await window.loadURL(noteUrl)
    } catch (error) {
      if (!window.isDestroyed()) window.destroy()
      throw error
    }
  }

  async function open(): Promise<void> {
    if (closing) await closing
    if (quitting) return
    if (!note && !opening) opening = create().finally(() => { opening = null })
    await opening
    if (note && !note.isDestroyed()) {
      if (note.isMinimized()) note.restore()
      note.show()
      note.focus()
    }
  }
  ipcMain.handle(channels.open, event => {
    const owner = getMainWindow()
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents ||
        !event.senderFrame || event.senderFrame !== owner.webContents.mainFrame ||
        !isTrustedRendererSurfaceUrl(event.senderFrame.url, workbenchUrl, 'workbench')) throw new Error('Untrusted workbench')
    return open()
  })
  ipcMain.handle(channels.context, event => {
    const window = requireNote(event)
    editorReady = true
    return { ...getAppearance(), pinned: canPin && window.isAlwaysOnTop(), canPin } satisfies DailyNotesContext
  })
  ipcMain.handle(channels.pin, (event, enabled: boolean) => {
    const window = requireNote(event)
    if (typeof enabled !== 'boolean') throw new Error('Invalid pin state')
    if (canPin) window.setAlwaysOnTop(enabled, 'floating')
    return canPin && window.isAlwaysOnTop()
  })
  ipcMain.handle(channels.listDays, event => { requireNote(event); return store.listDays() })
  ipcMain.handle(channels.read, (event, day: string) => { requireNote(event); return store.read(day) })
  ipcMain.handle(channels.save, (event, day: string, text: string) => { requireNote(event); return store.save(day, text) })
  ipcMain.handle(channels.finishClose, (event, saved: boolean) => {
    requireNote(event)
    finishEditing?.(saved === true)
  })
  return open
}
