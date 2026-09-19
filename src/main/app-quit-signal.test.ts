import { readFileSync } from 'node:fs'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  isAppQuitInProgress: vi.fn(() => false),
  requestQuit: vi.fn(),
  mainWindow: null as {
    isDestroyed: () => boolean
    hide: () => void
    webContents: { isDestroyed: () => boolean; send: (channel: string) => void }
  } | null
}))

vi.mock('./main-lifecycle', () => ({
  isAppQuitInProgress: mocks.isAppQuitInProgress,
  runtimeShutdown: { requestQuit: mocks.requestQuit }
}))
vi.mock('./main-app-context', () => ({
  mainState: { get mainWindow() { return mocks.mainWindow } },
  runtimeJsonError: (code: string, message: string) => Object.assign(new Error(message), { code })
}))

import { notifyApplicationQuitting, throwIfApplicationQuitting } from './app-quit-signal'

describe('application quit signal', () => {
  beforeEach(() => {
    mocks.isAppQuitInProgress.mockReturnValue(false)
    mocks.requestQuit.mockClear()
    mocks.mainWindow = null
  })

  it('requests quit, notifies the renderer, and hides the surviving window', () => {
    const send = vi.fn()
    const hide = vi.fn()
    const window = {
      isDestroyed: () => false,
      hide,
      webContents: { isDestroyed: () => false, send }
    }

    notifyApplicationQuitting(window as never)

    expect(mocks.requestQuit).toHaveBeenCalledOnce()
    expect(send).toHaveBeenCalledWith('app:quitting')
    expect(hide).toHaveBeenCalledOnce()
  })

  it('falls back to the tracked main window when no target is passed', () => {
    const send = vi.fn()
    const hide = vi.fn()
    mocks.mainWindow = {
      isDestroyed: () => false,
      hide,
      webContents: { isDestroyed: () => false, send }
    }

    notifyApplicationQuitting()

    expect(send).toHaveBeenCalledWith('app:quitting')
    expect(hide).toHaveBeenCalledOnce()
  })

  it('fails closed before a managed runtime can start during quit', () => {
    mocks.isAppQuitInProgress.mockReturnValue(true)
    expect(() => throwIfApplicationQuitting()).toThrow(/shutting down/)
    mocks.isAppQuitInProgress.mockReturnValue(false)
    expect(() => throwIfApplicationQuitting()).not.toThrow()
  })

  it('fences ensureRuntime before it can start a child', () => {
    const source = readFileSync(new URL('./main-runtime-startup.ts', import.meta.url), 'utf8')
    const ensure = source.slice(source.indexOf('export async function ensureRuntime'))
    expect(ensure.indexOf('throwIfApplicationQuitting()')).toBeGreaterThan(-1)
    expect(ensure.indexOf('throwIfApplicationQuitting()'))
      .toBeLessThan(ensure.indexOf('desktopProcessStack.assertCanStart()'))
  })

  it('fails closed on hosted Runtime HTTP after quit has started', () => {
    const source = readFileSync(new URL('./main-runtime-settings.ts', import.meta.url), 'utf8')
    expect(source).toContain("if (isAppQuitInProgress())")
    expect(source).toContain("runtimeFailure('runtime_shutting_down'")
  })

  it('always finishes the desktop quit barrier', () => {
    const source = readFileSync(new URL('./main-desktop-entry.ts', import.meta.url), 'utf8')
    expect(source).toContain('notifyApplicationQuitting()')
    expect(source).toContain('} finally {')
    expect(source).toContain('quitBarrierCompleted = true')
  })
})
