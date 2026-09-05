import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  app: { quit: vi.fn() },
  dialog: {},
  screen: {
    getDisplayMatching: vi.fn(() => ({
      workArea: { x: 0, y: 0, width: 1920, height: 1040 }
    }))
  }
}))

vi.mock('../dev-renderer-cache', () => ({ reloadRenderer: vi.fn() }))
vi.mock('../services/workspace-service', () => ({
  expandHomePath: (value: string) => value,
  resolveOpenTargetPath: (value: string) => value
}))
vi.mock('../renderer-trust-policy', () => ({ trustedRendererSenderIsCurrent: () => true }))
vi.mock('../main-window', () => ({ trustedWorkbenchRendererUrl: () => 'http://localhost' }))

type FakeWindow = {
  id: number
  destroyed: boolean
  maximized: boolean
  bounds: { x: number; y: number; width: number; height: number }
  isDestroyed: () => boolean
  isMaximized: () => boolean
  getMinimumSize: () => number[]
  isAlwaysOnTop: () => boolean
  unmaximize: () => void
  maximize: () => void
  getNormalBounds: () => FakeWindow['bounds']
  getBounds: () => FakeWindow['bounds']
  setBounds: (bounds: FakeWindow['bounds']) => void
  setMinimumSize: (width: number, height: number) => void
  setAlwaysOnTop: (flag: boolean) => void
  minSize: { width: number; height: number }
  alwaysOnTop: boolean
}

function fakeWindow(): FakeWindow {
  const win: FakeWindow = {
    id: 1,
    destroyed: false,
    maximized: false,
    bounds: { x: 200, y: 100, width: 1280, height: 840 },
    minSize: { width: 960, height: 640 },
    alwaysOnTop: false,
    isDestroyed: () => win.destroyed,
    isMaximized: () => win.maximized,
    getMinimumSize: () => [win.minSize.width, win.minSize.height],
    isAlwaysOnTop: () => win.alwaysOnTop,
    unmaximize: () => { win.maximized = false },
    maximize: () => { win.maximized = true },
    getNormalBounds: () => ({ ...win.bounds }),
    getBounds: () => ({ ...win.bounds }),
    setBounds: (bounds) => { win.bounds = { ...bounds } },
    setMinimumSize: (width, height) => { win.minSize = { width, height } },
    setAlwaysOnTop: (flag) => { win.alwaysOnTop = flag }
  }
  return win
}

describe('toggleMiniWindowMode', () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('shrinks the window to the bottom-right corner and keeps it on top', async () => {
    const { toggleMiniWindowMode } = await import('./app-ipc-handler-utils')
    const win = fakeWindow()
    const mini = toggleMiniWindowMode(win as never)
    expect(mini).toBe(true)
    expect(win.bounds).toEqual({ x: 1920 - 380 - 24, y: 1040 - 480 - 24, width: 380, height: 480 })
    expect(win.minSize).toEqual({ width: 320, height: 240 })
    expect(win.alwaysOnTop).toBe(true)
  })

  it('restores the saved bounds and maximized state on the second toggle', async () => {
    const { toggleMiniWindowMode } = await import('./app-ipc-handler-utils')
    const win = fakeWindow()
    win.maximized = true
    toggleMiniWindowMode(win as never)
    expect(win.maximized).toBe(false)
    const mini = toggleMiniWindowMode(win as never)
    expect(mini).toBe(false)
    expect(win.bounds).toEqual({ x: 200, y: 100, width: 1280, height: 840 })
    expect(win.maximized).toBe(true)
    expect(win.alwaysOnTop).toBe(false)
    expect(win.minSize).toEqual({ width: 960, height: 640 })
  })

  it('restores the saved bounds when the window was maximized while in mini mode', async () => {
    const { toggleMiniWindowMode } = await import('./app-ipc-handler-utils')
    const win = fakeWindow()
    toggleMiniWindowMode(win as never)
    // Simulate the user maximizing the window while in mini mode.
    win.maximized = true
    const mini = toggleMiniWindowMode(win as never)
    expect(mini).toBe(false)
    expect(win.bounds).toEqual({ x: 200, y: 100, width: 1280, height: 840 })
    expect(win.maximized).toBe(false)
    expect(win.alwaysOnTop).toBe(false)
    expect(win.minSize).toEqual({ width: 960, height: 640 })
  })

  it('preserves the original minimum size and always-on-top setting', async () => {
    const { toggleMiniWindowMode, isMiniWindowMode } = await import('./app-ipc-handler-utils')
    const win = fakeWindow()
    win.minSize = { width: 1000, height: 700 }
    win.alwaysOnTop = true
    expect(isMiniWindowMode(win as never)).toBe(false)
    toggleMiniWindowMode(win as never)
    expect(isMiniWindowMode(win as never)).toBe(true)
    toggleMiniWindowMode(win as never)
    expect(isMiniWindowMode(win as never)).toBe(false)
    expect(win.minSize).toEqual({ width: 1000, height: 700 })
    expect(win.alwaysOnTop).toBe(true)
  })

  it('returns false for a missing or destroyed window', async () => {
    const { toggleMiniWindowMode } = await import('./app-ipc-handler-utils')
    expect(toggleMiniWindowMode(null)).toBe(false)
    const win = fakeWindow()
    win.destroyed = true
    expect(toggleMiniWindowMode(win as never)).toBe(false)
  })
})

describe("runDesktopCommand('toggleMini')", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  it('notifies the renderer about the mini-mode state', async () => {
    const { runDesktopCommand } = await import('./app-ipc-handler-utils')
    const win = fakeWindow()
    const send = vi.fn()
    ;(win as unknown as { webContents: unknown }).webContents = { isDestroyed: () => false, send }
    const sender = { isDestroyed: () => false, send: vi.fn() }
    runDesktopCommand('toggleMini', sender as never, () => win as never)
    expect(send).toHaveBeenCalledWith('window:mini-mode', true)
    runDesktopCommand('toggleMini', sender as never, () => win as never)
    expect(send).toHaveBeenLastCalledWith('window:mini-mode', false)
  })
})
