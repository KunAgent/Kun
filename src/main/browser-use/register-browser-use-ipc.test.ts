import { describe, expect, it, vi } from 'vitest'

vi.mock('../main-window', () => ({
  trustedWorkbenchRendererUrl: () => 'http://127.0.0.1:5173/index.html'
}))

import { registerBrowserUseIpc } from './register-browser-use-ipc'

vi.mock('electron', () => ({
  BrowserWindow: class {}
}))

function harness() {
  const handlers = new Map<string, (...args: unknown[]) => unknown>()
  const ipcMain = {
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => {
      handlers.set(channel, handler)
    }),
    removeHandler: vi.fn((channel: string) => handlers.delete(channel))
  }
  const mainFrame = {
    processId: 7,
    routingId: 9,
    url: 'http://127.0.0.1:5173/index.html'
  }
  const window = {
    isDestroyed: () => false,
    webContents: {
      id: 42,
      mainFrame
    }
  }
  let bound = false
  const manager = {
    stateForThread: vi.fn(() => ({ lifecycle: 'closed' })),
    mount: vi.fn(() => {
      bound = true
      return { lifecycle: 'ready' }
    }),
    isBoundToWindow: vi.fn((_threadId: string, candidate: unknown) =>
      bound && candidate === window
    ),
    decideOrigin: vi.fn(() => ({ lifecycle: 'ready' })),
    decideAction: vi.fn(() => ({ lifecycle: 'ready' })),
    setControlOwner: vi.fn(() => ({ lifecycle: 'manual-control' })),
    navigate: vi.fn(() => ({ lifecycle: 'ready' })),
    stop: vi.fn(() => ({ lifecycle: 'stopped' })),
    clear: vi.fn(async () => true)
  }
  const dispose = registerBrowserUseIpc({
    ipcMain: ipcMain as never,
    manager: manager as never,
    getMainWindow: () => window as never
  })
  const event = {
    sender: { id: 42 },
    senderFrame: mainFrame
  }
  return { handlers, ipcMain, manager, window, event, dispose }
}

describe('registerBrowserUseIpc', () => {
  it('rejects forged renderer frames before reading Browser Use state', () => {
    const h = harness()
    const handler = h.handlers.get('browser-use:state:get')!
    expect(() => handler({
      sender: { id: 999 },
      senderFrame: {
        processId: 7,
        routingId: 9,
        url: 'http://127.0.0.1:5173/index.html'
      }
    }, { threadId: 'thread-1' })).toThrow('trusted workbench')
    expect(() => handler({
      sender: { id: 42 },
      senderFrame: {
        processId: 7,
        routingId: 9,
        url: 'https://example.com'
      }
    }, { threadId: 'thread-1' })).toThrow('trusted workbench')
    expect(h.manager.stateForThread).not.toHaveBeenCalled()
  })

  it('strictly validates mount payload and binds the session to the trusted window', () => {
    const h = harness()
    const mount = h.handlers.get('browser-use:mount')!
    expect(() => mount(h.event, {
      threadId: 'thread-1',
      visible: true,
      supervisionActive: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 },
      genericWebContentsId: 123
    })).toThrow()
    expect(mount(h.event, {
      threadId: 'thread-1',
      visible: true,
      supervisionActive: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 }
    })).toEqual({ lifecycle: 'ready' })
    expect(h.manager.mount).toHaveBeenCalledWith(
      'thread-1',
      h.window,
      { x: 0, y: 0, width: 800, height: 600 },
      true,
      true
    )
  })

  it('does not accept a consent decision before the exact session/window binding exists', () => {
    const h = harness()
    const decide = h.handlers.get('browser-use:action:decide')!
    expect(() => decide(h.event, {
      threadId: 'thread-1',
      requestId: 'request-identifier-1234',
      decision: 'allow-once'
    })).toThrow('not bound')
    expect(h.manager.decideAction).not.toHaveBeenCalled()
  })

  it('offers only allow-once/deny and removes every handler on dispose', () => {
    const h = harness()
    h.handlers.get('browser-use:mount')!(h.event, {
      threadId: 'thread-1',
      visible: true,
      supervisionActive: true,
      bounds: { x: 0, y: 0, width: 800, height: 600 }
    })
    const decide = h.handlers.get('browser-use:action:decide')!
    expect(() => decide(h.event, {
      threadId: 'thread-1',
      requestId: 'request-identifier-1234',
      decision: 'always'
    })).toThrow()
    expect(decide(h.event, {
      threadId: 'thread-1',
      requestId: 'request-identifier-1234',
      decision: 'deny'
    })).toEqual({ lifecycle: 'ready' })

    h.dispose()
    expect(h.handlers.size).toBe(0)
  })
})
