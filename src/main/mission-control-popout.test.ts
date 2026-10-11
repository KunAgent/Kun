import { beforeEach, describe, expect, it, vi } from 'vitest'

const electronState = vi.hoisted(() => ({
  handlers: new Map<string, (event: unknown, payload: unknown) => unknown>(),
  windows: [] as Array<Record<string, unknown>>
}))

vi.mock('electron', () => ({
  app: {
    getAppPath: () => '/app'
  },
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, payload: unknown) => unknown) => {
      electronState.handlers.set(channel, handler)
    }
  },
  BrowserWindow: class {
    webContents = { id: 9, mainFrame: { processId: 1, routingId: 2 } }
    destroyed = false
    options: Record<string, unknown>
    loaded: unknown
    shown = false
    focused = false
    closedHandlers: Array<() => void> = []
    constructor(options: Record<string, unknown>) {
      this.options = options
      electronState.windows.push(this as never)
    }
    isDestroyed(): boolean {
      return this.destroyed
    }
    show(): void {
      this.shown = true
    }
    focus(): void {
      this.focused = true
    }
    close(): void {
      this.destroyed = true
      for (const handler of this.closedHandlers) handler()
    }
    once(event: string, handler: () => void): void {
      if (event === 'closed') this.closedHandlers.push(handler)
      if (event === 'ready-to-show') this.show()
    }
    on(event: string, handler: () => void): void {
      if (event === 'closed') this.closedHandlers.push(handler)
    }
    loadFile(path: string, options: unknown): Promise<void> {
      this.loaded = { path, options }
      return Promise.resolve()
    }
    loadURL(url: string): Promise<void> {
      this.loaded = url
      return Promise.resolve()
    }
  }
}))

const senderCheck = vi.hoisted(() => ({
  trusted: true,
  thrown: null as Error | null
}))

vi.mock('./ipc/app-ipc-handler-utils', async (importOriginal) => {
  const original = await importOriginal<typeof import('./ipc/app-ipc-handler-utils')>()
  return {
    ...original,
    assertTrustedWorkbenchSender: () => {
      if (senderCheck.thrown) throw senderCheck.thrown
    },
    trustedWorkbenchSenderIsCurrent: () => senderCheck.trusted
  }
})

const tray = vi.hoisted(() => ({ dispatched: [] as Array<{ type: string; threadId?: string }> }))
vi.mock('./main-tray', () => ({
  dispatchTrayAction: (action: { type: string; threadId?: string }) => {
    tray.dispatched.push(action)
  }
}))

vi.mock('./main-app-context', () => ({
  __dirname: '/app/out/main',
  appEnvironment: { flavor: 'production', appName: 'Kun' },
  appIcon: { isEmpty: () => true },
  developmentRendererUrl: () => undefined,
  mainState: { mainWindow: null }
}))
vi.mock('./main-paths', () => ({ resolveNamedPreloadPath: () => '/app/out/preload/index.js' }))
vi.mock('./main-window', () => ({ hardenTrustedRendererWindow: vi.fn() }))
vi.mock('./renderer-trust-policy', () => ({
  registerAuxiliaryWorkbenchWindow: vi.fn()
}))
vi.mock('../shared/app-environment', () => ({
  appWindowTitleForFlavor: () => 'Kun'
}))

import {
  missionControlPopoutIsOpen,
  registerMissionControlPopoutIpc
} from './mission-control-popout'

const getMainWindow = () => null

beforeEach(() => {
  electronState.handlers.clear()
  for (const window of electronState.windows) {
    (window as { close?: () => void }).close?.()
  }
  electronState.windows.length = 0
  tray.dispatched.length = 0
  senderCheck.trusted = true
  senderCheck.thrown = null
})

describe('mission control popout ipc', () => {
  it('opens a singleton window loading the popout surface', () => {
    registerMissionControlPopoutIpc(getMainWindow)
    const toggle = electronState.handlers.get('mission-control:popout:toggle')!
    expect(toggle({}, undefined)).toEqual({ open: true })
    expect(missionControlPopoutIsOpen()).toBe(true)
    const window = electronState.windows[0]!
    expect(window.loaded).toEqual({
      path: expect.stringContaining('index.html'),
      options: { query: { popout: '1' } }
    })
    // A second toggle focuses the same window instead of creating another.
    toggle({}, undefined)
    expect(electronState.windows).toHaveLength(1)
    expect(window.focused).toBe(true)
  })

  it('rejects the toggle from untrusted senders', () => {
    registerMissionControlPopoutIpc(getMainWindow)
    senderCheck.thrown = new Error('IPC sender is not the trusted workbench frame.')
    expect(() =>
      electronState.handlers.get('mission-control:popout:toggle')!({}, undefined)
    ).toThrow('trusted workbench frame')
    expect(electronState.windows).toHaveLength(0)
  })

  it('forwards open-thread to the main window only from the popout frame', () => {
    registerMissionControlPopoutIpc(getMainWindow)
    const openThread = electronState.handlers.get('mission-control:open-thread')!
    senderCheck.trusted = false
    expect(() => openThread({}, { threadId: 'thr_1' })).toThrow('popout frame')
    senderCheck.trusted = true
    openThread({}, { threadId: 'thr_1' })
    expect(tray.dispatched).toEqual([{ type: 'open-thread', threadId: 'thr_1' }])
    expect(() => openThread({}, {})).toThrow()
  })
})
