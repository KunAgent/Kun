import { app, BrowserWindow, ipcMain, nativeTheme, screen, type IpcMainEvent, type IpcMainInvokeEvent } from 'electron'
import { randomUUID } from 'node:crypto'
import { watch, type FSWatcher } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import {
  appendDailyNoteTaskChange, applyDailyNoteChange, findMatchingDailyNoteTask,
  formatKunDispatchUrl, parseDailyNoteTasks, setDailyNoteTaskLinkChange, toggleDailyNoteTaskChange,
  type DailyNoteQuadrant
} from '../../../kun/src/contracts/daily-notes-markdown'
import {
  DAILY_NOTES_CHANNELS as channels, isNoteDay, localNoteDay,
  type DailyNoteChangedEvent, type DailyNoteDockPayload, type DailyNoteLinkSummary, type DailyNoteSendRequest,
  type DailyNoteSendResult, type DailyNoteStartThreadRequest, type DailyNoteStartThreadResult,
  type DailyNoteTargetsSnapshot, type DailyNotesAppearance, type DailyNotesContext,
  type DailyNotesWorkbenchCommand
} from '../../shared/daily-notes'
import { resolveNamedPreloadPath } from '../main-paths'
import { isNativeWaylandSession } from '../pets/pet-platform'
import { isTrustedRendererUrl, isTrustedRendererSurfaceUrl } from '../renderer-trust-policy'
import { fitWindowToWorkArea } from '../window-mini-mode'
import { setDailyNotesToggleHandler, syncDailyNotesGlobalShortcut } from './shortcut'
import { DailyNotesStore } from './store'

type Options = {
  getMainWindow: () => BrowserWindow | null
  getAppearance: () => DailyNotesAppearance
  developmentUrl?: string
}

type PendingCommand = {
  resolve: (value: unknown) => void
  timer: ReturnType<typeof setTimeout>
}

export function registerDailyNotesIpc({ getMainWindow, getAppearance, developmentUrl }: Options): () => Promise<void> {
  const appPath = app.getAppPath()
  const rendererPath = join(appPath, 'out', 'renderer')
  const workbenchUrl = developmentUrl ?? pathToFileURL(join(rendererPath, 'index.html')).href
  const noteUrl = new URL('daily-notes.html', workbenchUrl).href
  const store = new DailyNotesStore(join(app.getPath('userData'), 'daily-notes'))
  const canPin = !isNativeWaylandSession(process.platform, app.commandLine.getSwitchValue('ozone-platform'), process.env)
  const watchTimers = new Map<string, ReturnType<typeof setTimeout>>()
  const pendingCommands = new Map<string, PendingCommand>()
  let dirWatcher: FSWatcher | null = null
  let startingWatcher: Promise<void> | null = null
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

  function requireWorkbench(event: IpcMainInvokeEvent | IpcMainEvent): BrowserWindow {
    const owner = getMainWindow()
    if (!owner || owner.isDestroyed() || event.sender !== owner.webContents ||
        !event.senderFrame || event.senderFrame !== owner.webContents.mainFrame ||
        !isTrustedRendererSurfaceUrl(event.senderFrame.url, workbenchUrl, 'workbench')) {
      throw new Error('Untrusted workbench')
    }
    return owner
  }

  async function pushExternalChange(day: string): Promise<void> {
    const owner = getMainWindow()
    const hasNote = Boolean(note && !note.isDestroyed() && !note.webContents.isDestroyed())
    const hasOwner = Boolean(owner && !owner.isDestroyed() && !owner.webContents.isDestroyed())
    if (!hasNote && !hasOwner) return
    const payload: DailyNoteChangedEvent = { day, days: await store.listDays() }
    if (note && !note.isDestroyed() && !note.webContents.isDestroyed()) {
      note.webContents.send(channels.externalChange, payload)
    }
    const latestOwner = getMainWindow()
    if (latestOwner && !latestOwner.isDestroyed() && !latestOwner.webContents.isDestroyed()) {
      latestOwner.webContents.send(channels.workbenchExternalChange, payload)
    }
  }

  function scheduleExternalChange(day: string): void {
    clearTimeout(watchTimers.get(day))
    watchTimers.set(day, setTimeout(() => {
      watchTimers.delete(day)
      void pushExternalChange(day).catch(() => undefined)
    }, 80))
  }

  async function ensureDirWatcher(): Promise<void> {
    if (dirWatcher) return
    startingWatcher ??= (async () => {
      // Watch an empty notes directory too, so the first remote write is visible.
      await mkdir(store.getDirectory(), { recursive: true, mode: 0o700 })
      const owner = getMainWindow()
      if ((!note || note.isDestroyed()) && (!owner || owner.isDestroyed())) return
      dirWatcher = watch(store.getDirectory(), (_eventType, filename) => {
        if (typeof filename !== 'string' || !filename.endsWith('.md')) return
        const day = filename.slice(0, -3)
        if (isNoteDay(day)) scheduleExternalChange(day)
      })
      dirWatcher.on('error', () => { stopDirWatcher() })
    })().catch(() => undefined).finally(() => { startingWatcher = null })
    await startingWatcher
  }

  function stopDirWatcher(): void {
    for (const timer of watchTimers.values()) clearTimeout(timer)
    watchTimers.clear()
    if (dirWatcher) {
      try { dirWatcher.close() } catch { /* ignore */ }
      dirWatcher = null
    }
  }

  function invokeWorkbench<T>(
    command: DailyNotesWorkbenchCommand extends infer C ? C extends DailyNotesWorkbenchCommand ? Omit<C, 'requestId'> : never : never,
    options: { focusWindow?: boolean; fallback: T }
  ): Promise<T> {
    const owner = getMainWindow()
    if (!owner || owner.isDestroyed() || owner.webContents.isDestroyed()) return Promise.resolve(options.fallback)
    if (options.focusWindow) {
      if (owner.isMinimized()) owner.restore()
      owner.show()
      owner.focus()
    }
    return new Promise<T>(resolve => {
      const requestId = randomUUID()
      const timer = setTimeout(() => {
        pendingCommands.delete(requestId)
        resolve(options.fallback)
      }, 15_000)
      pendingCommands.set(requestId, { resolve: value => resolve(value as T), timer })
      owner.webContents.send(channels.workbenchCommand, { ...command, requestId })
    })
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
      ...(process.platform === 'darwin' ? { titleBarStyle: 'hidden' as const, trafficLightPosition: { x: 16, y: 15 } } : {}),
      backgroundColor: nativeTheme.shouldUseDarkColors ? '#191919' : '#ffffff',
      webPreferences: {
        preload: resolveNamedPreloadPath(appPath, 'daily-notes'),
        contextIsolation: true, sandbox: true, nodeIntegration: false
      }
    })
    note = window
    editorReady = false
    void ensureDirWatcher()
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
      const owner = getMainWindow()
      if (!owner || owner.isDestroyed()) stopDirWatcher()
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

  async function closeOpenWindow(): Promise<void> {
    if (closing) {
      await closing
      return
    }
    const target = note
    if (!target || target.isDestroyed()) return
    closing = close(target).catch(error => console.error('[daily-notes] Could not flush notes', error))
      .finally(() => { closing = null; finishEditing = null })
    await closing
  }

  async function toggle(): Promise<{ open: boolean }> {
    if (note && !note.isDestroyed() && note.isVisible() && note.isFocused()) {
      await closeOpenWindow()
    } else {
      await open()
    }
    return { open: Boolean(note && !note.isDestroyed()) }
  }

  async function readDay(day: string) {
    await ensureDirWatcher()
    return store.read(day)
  }

  async function saveDay(day: string, text: string, expectedRevision: string) {
    const result = await store.save(day, text, expectedRevision)
    if (result.status === 'saved') {
      void ensureDirWatcher()
      scheduleExternalChange(day)
    }
    return result
  }

  async function rollover(fromDay: string, toDay: string) {
    const result = await store.rollover(fromDay, toDay)
    if (result.movedCount > 0) {
      void ensureDirWatcher()
      scheduleExternalChange(fromDay)
      scheduleExternalChange(toDay)
    }
    return result
  }

  setDailyNotesToggleHandler(toggle)
  syncDailyNotesGlobalShortcut()

  ipcMain.handle(channels.open, event => { requireWorkbench(event); return open() })
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
  ipcMain.handle(channels.read, (event, day: string) => {
    requireNote(event)
    return readDay(day)
  })
  ipcMain.handle(channels.save, (event, day: string, text: string, expectedRevision: string) => {
    requireNote(event)
    return saveDay(day, text, expectedRevision)
  })
  ipcMain.handle(channels.rollover, (event, fromDay: string, toDay: string) => {
    requireNote(event)
    return rollover(fromDay, toDay)
  })
  ipcMain.handle(channels.sendToKun, (event, request: DailyNoteSendRequest) => {
    requireNote(event)
    if (!request || !Array.isArray(request.items) || request.items.length === 0) {
      return { ok: false, error: 'Empty task selection' } satisfies DailyNoteSendResult
    }
    return invokeWorkbench<DailyNoteSendResult>(
      { kind: 'send-to-kun', request },
      { focusWindow: true, fallback: { ok: false, error: 'Workbench unavailable' } }
    )
  })
  ipcMain.handle(channels.startThread, (event, request: DailyNoteStartThreadRequest) => {
    requireNote(event)
    if (!request || typeof request.prompt !== 'string' || !request.prompt.trim()) {
      return { ok: false, error: 'Empty prompt' } satisfies DailyNoteStartThreadResult
    }
    return invokeWorkbench<DailyNoteStartThreadResult>(
      { kind: 'start-thread', request },
      { focusWindow: true, fallback: { ok: false, error: 'Workbench unavailable' } }
    )
  })
  ipcMain.handle(channels.listTargets, event => {
    requireNote(event)
    return invokeWorkbench<DailyNoteTargetsSnapshot>(
      { kind: 'list-targets' },
      { focusWindow: false, fallback: { activeWorkspaceRoot: '', projects: [], threads: [] } }
    )
  })
  ipcMain.handle(channels.dockToWorkbench, async (event, payload?: DailyNoteDockPayload) => {
    const window = requireNote(event)
    await closeOpenWindow()
    if (!window.isDestroyed()) return false
    return invokeWorkbench<boolean>(
      { kind: 'dock-in-workbench', payload },
      { focusWindow: true, fallback: false }
    )
  })
  ipcMain.handle(channels.openLink, (event, url: string) => {
    requireNote(event)
    if (typeof url !== 'string' || !url.startsWith('kun://')) return false
    return invokeWorkbench<boolean>(
      { kind: 'open-link', url },
      { focusWindow: true, fallback: false }
    )
  })
  ipcMain.handle(channels.watchLinks, (event, urls: string[]) => {
    requireNote(event)
    const safeUrls = Array.isArray(urls) ? urls.filter(u => typeof u === 'string' && u.startsWith('kun://')).slice(0, 60) : []
    return invokeWorkbench<Record<string, DailyNoteLinkSummary>>(
      { kind: 'watch-links', urls: safeUrls },
      { focusWindow: false, fallback: {} }
    )
  })
  ipcMain.handle(channels.finishClose, (event, saved: boolean) => {
    requireNote(event)
    finishEditing?.(saved === true)
  })

  // Workbench-side handlers for bidirectional task <-> conversation coordination.
  ipcMain.handle(channels.workbenchDirectory, event => {
    requireWorkbench(event)
    return store.getDirectory()
  })
  ipcMain.handle(channels.workbenchToggleWindow, event => {
    requireWorkbench(event)
    return toggle()
  })
  ipcMain.handle(channels.workbenchCloseWindow, event => {
    requireWorkbench(event)
    return closeOpenWindow()
  })
  ipcMain.handle(channels.workbenchListDays, event => {
    requireWorkbench(event)
    return store.listDays()
  })
  ipcMain.handle(channels.workbenchRead, (event, day: string) => {
    requireWorkbench(event)
    return readDay(day)
  })
  ipcMain.handle(channels.workbenchSave, (event, day: string, text: string, expectedRevision: string) => {
    requireWorkbench(event)
    return saveDay(day, text, expectedRevision)
  })
  ipcMain.handle(channels.workbenchRollover, (event, fromDay: string, toDay: string) => {
    requireWorkbench(event)
    return rollover(fromDay, toDay)
  })
  ipcMain.handle(channels.workbenchAppendTask, async (event, input: {
    day?: string; text: string; quadrant?: DailyNoteQuadrant | null; linkLabel?: string; linkUrl?: string
  }) => {
    requireWorkbench(event)
    const day = input?.day ?? localNoteDay()
    const body = typeof input?.text === 'string' ? input.text.trim() : ''
    if (!body) throw new Error('Task text required')
    const link = input.linkUrl ? { label: input.linkLabel || 'Kun', url: input.linkUrl } : null
    const quadrant = input.quadrant && [1, 2, 3, 4].includes(input.quadrant) ? input.quadrant : null
    const changed = await store.mutateDay(day, current =>
      applyDailyNoteChange(current, appendDailyNoteTaskChange(current, body, quadrant, link)))
    if (changed) {
      void ensureDirWatcher()
      scheduleExternalChange(day)
    }
    return { day }
  })
  ipcMain.handle(channels.workbenchSetDone, async (event, input: {
    day: string; taskText?: string; linkId?: string; done: boolean
  }) => {
    requireWorkbench(event)
    if (!isNoteDay(input?.day)) return false
    const changed = await store.mutateDay(input.day, current => {
      const target = findMatchingDailyNoteTask(parseDailyNoteTasks(current), {
        linkId: input.linkId,
        taskText: input.taskText
      })
      if (!target || target.done === Boolean(input.done)) return null
      return applyDailyNoteChange(current, toggleDailyNoteTaskChange(target, Boolean(input.done)))
    })
    if (changed) scheduleExternalChange(input.day)
    return changed
  })
  ipcMain.handle(channels.workbenchGetTaskStatus, async (event, input: {
    day: string; taskText?: string; linkId?: string
  }) => {
    requireWorkbench(event)
    if (!isNoteDay(input?.day)) return { found: false, done: false }
    const { markdown } = await store.read(input.day)
    const target = findMatchingDailyNoteTask(parseDailyNoteTasks(markdown), {
      linkId: input.linkId,
      taskText: input.taskText
    })
    return target ? { found: true, done: target.done } : { found: false, done: false }
  })
  ipcMain.handle(channels.workbenchBindDispatch, async (event, input: {
    day: string; taskText?: string; previousUrl?: string; roomId: string; linkId: string; label?: string
  }) => {
    requireWorkbench(event)
    if (!isNoteDay(input?.day) || !input.roomId || !input.linkId) return false
    const url = formatKunDispatchUrl(input.roomId, input.linkId)
    const changed = await store.mutateDay(input.day, current => {
      const target = findMatchingDailyNoteTask(parseDailyNoteTasks(current), {
        linkUrl: input.previousUrl,
        linkId: input.linkId,
        taskText: input.taskText
      })
      if (!target || target.link?.url === url) return null
      return applyDailyNoteChange(current, setDailyNoteTaskLinkChange(target, {
        label: input.label || target.link?.label || '小Kun',
        url
      }))
    })
    if (changed) scheduleExternalChange(input.day)
    return changed
  })
  ipcMain.on(channels.workbenchPublishSummaries, (event, summaries: Record<string, DailyNoteLinkSummary>) => {
    try { requireWorkbench(event) } catch { return }
    if (!note || note.isDestroyed() || note.webContents.isDestroyed()) return
    note.webContents.send(channels.linkSummaries, summaries)
  })
  ipcMain.on(channels.workbenchReply, (event, payload: { requestId?: string; response?: unknown }) => {
    try { requireWorkbench(event) } catch { return }
    const entry = payload?.requestId ? pendingCommands.get(payload.requestId) : undefined
    if (!entry) return
    clearTimeout(entry.timer)
    pendingCommands.delete(payload.requestId!)
    entry.resolve(payload.response)
  })

  return open
}
