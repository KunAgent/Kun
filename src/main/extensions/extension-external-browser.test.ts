import { describe, expect, it, vi } from 'vitest'
import { ExtensionViewSessionRegistry } from './extension-view-sessions'
import {
  ExtensionExternalBrowserManager,
  externalBrowserPartition,
  externalBrowserUserAgent,
  initialExternalBrowserFitZoom,
  normalizeExternalBrowserBounds
} from './extension-external-browser'

vi.mock('electron', () => ({ WebContentsView: class {} }))

describe('ExtensionExternalBrowserManager', () => {
  it('mounts a Main-owned remote surface and rejects navigation outside reviewed hosts', () => {
    const sessions = new ExtensionViewSessionRegistry(() => 1_000)
    const record = sessions.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.social',
      extensionVersion: '1.0.0',
      contributionId: 'social',
      entryPath: 'dist/index.html',
      externalWebviewHosts: ['bilibili.com', '*.bilibili.com'],
      parentWebContentsId: 10
    })
    const listeners = new Map<string, (...args: unknown[]) => void>()
    const sessionListeners = new Map<string, (...args: unknown[]) => void>()
    const beforeRequest = vi.fn()
    let currentUrl = ''
    const guest = {
      id: 30,
      session: {
        setPermissionRequestHandler: vi.fn(),
        setPermissionCheckHandler: vi.fn(),
        setDevicePermissionHandler: vi.fn(),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          sessionListeners.set(event, listener)
        }),
        webRequest: { onBeforeRequest: beforeRequest }
      },
      navigationHistory: {
        canGoBack: () => false,
        canGoForward: () => false,
        goBack: vi.fn(),
        goForward: vi.fn()
      },
      setUserAgent: vi.fn(),
      enableDeviceEmulation: vi.fn(),
      setAudioMuted: vi.fn(),
      executeJavaScript: vi.fn(async () => undefined),
      getZoomFactor: () => 1,
      setZoomFactor: vi.fn(),
      setWindowOpenHandler: vi.fn(),
      on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
      }),
      once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
        listeners.set(event, listener)
      }),
      loadURL: vi.fn(async (url: string) => {
        currentUrl = url
      }),
      getURL: () => currentUrl,
      getTitle: () => 'Bilibili',
      reload: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    const view = {
      webContents: guest,
      setBorderRadius: vi.fn(),
      setBounds: vi.fn(),
      setVisible: vi.fn()
    }
    const workbenchContents = {
      id: 10,
      getZoomFactor: () => 1,
      send: vi.fn(),
      isDestroyed: () => false
    }
    const window = {
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      webContents: workbenchContents,
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      isDestroyed: () => false
    }
    const manager = new ExtensionExternalBrowserManager(sessions, () => view as never)

    const state = manager.mount(record, window as never, 'bilibili', 'https://www.bilibili.com/', {
      x: 700,
      y: 120,
      width: 500,
      height: 680,
      visible: true
    }, 'mobile')

    expect(window.contentView.addChildView).toHaveBeenCalledWith(view)
    expect(view.setBounds).toHaveBeenCalledWith({ x: 700, y: 120, width: 500, height: 680 })
    expect(view.setBorderRadius).toHaveBeenCalledWith(14)
    expect(view.setVisible).toHaveBeenCalledWith(true)
    expect(guest.setUserAgent).toHaveBeenCalledWith(expect.stringContaining('Mobile Safari/'))
    expect(guest.loadURL).toHaveBeenCalledWith('https://www.bilibili.com/')
    expect(state.sessionId).toBe(record.sessionId)
    expect(sessions.get(record.sessionId)?.state).toBe('active')
    expect(() => manager.navigate(record.sessionId, 'https://example.com/')).toThrow(/not granted/)

    sessions.dispose(record.sessionId)
    expect(window.contentView.removeChildView).toHaveBeenCalledWith(view)
    expect(guest.close).toHaveBeenCalledOnce()
    manager.destroy()
  })

  it('clamps renderer bounds to the window and builds an isolated stable partition', () => {
    expect(normalizeExternalBrowserBounds(
      { x: 900, y: 700, width: 500, height: 400, visible: true },
      { width: 1200, height: 800 }
    )).toEqual({
      bounds: { x: 900, y: 700, width: 300, height: 100 },
      visible: true
    })
    expect(externalBrowserPartition('acme.social')).toMatch(/^persist:kun-external-[a-f0-9]{32}$/)
    expect(externalBrowserPartition('acme.social')).not.toBe(externalBrowserPartition('other.social'))
    expect(externalBrowserPartition('acme.social', 'mobile')).toBe(
      externalBrowserPartition('acme.social', 'desktop')
    )
    expect(externalBrowserUserAgent()).toContain('Safari/537.36')
    expect(externalBrowserUserAgent()).not.toContain('Electron/')
    expect(externalBrowserUserAgent('mobile')).toContain('Android 15')
    expect(externalBrowserUserAgent('mobile')).toContain('Mobile Safari/')
    expect(initialExternalBrowserFitZoom(460, 1_100)).toBe(0.4)
    expect(initialExternalBrowserFitZoom(350, 1_100)).toBe(0.3)
    expect(initialExternalBrowserFitZoom(920, 980)).toBe(1)
    expect(initialExternalBrowserFitZoom(0, 1_100)).toBe(1)
  })

  it('retains one page per platform and pauses media while a page is hidden', () => {
    const sessions = new ExtensionViewSessionRegistry(() => 1_000)
    const record = sessions.create({
      sessionId: 'abcdef1234567890',
      extensionId: 'acme.social',
      extensionVersion: '1.0.0',
      contributionId: 'social',
      entryPath: 'dist/index.html',
      externalWebviewHosts: [
        'bilibili.com',
        '*.bilibili.com',
        'douyin.com',
        '*.douyin.com'
      ],
      parentWebContentsId: 10
    })
    const views = [mockBrowserView(31), mockBrowserView(32)]
    let viewIndex = 0
    const createView = vi.fn((_partition: string) => views[viewIndex++]!.view as never)
    const window = {
      contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
      webContents: {
        id: 10,
        getZoomFactor: () => 1,
        send: vi.fn(),
        isDestroyed: () => false
      },
      getContentBounds: () => ({ x: 0, y: 0, width: 1200, height: 800 }),
      isDestroyed: () => false
    }
    const manager = new ExtensionExternalBrowserManager(sessions, createView)
    const bounds = { x: 700, y: 120, width: 430, height: 680, visible: true }

    manager.mount(
      record,
      window as never,
      'bilibili',
      'https://www.bilibili.com/',
      bounds,
      'mobile'
    )
    manager.activate(record.sessionId, 'douyin', 'https://www.douyin.com/', 'mobile')
    manager.activate(record.sessionId, 'bilibili', 'https://www.bilibili.com/', 'mobile')

    expect(createView).toHaveBeenCalledTimes(2)
    expect(createView.mock.calls[0]?.[0]).toBe(createView.mock.calls[1]?.[0])
    expect(views[0]!.guest.loadURL).toHaveBeenCalledTimes(1)
    expect(views[0]!.guest.executeJavaScript).toHaveBeenCalledWith(
      expect.stringContaining("querySelectorAll('video, audio')")
    )
    expect(views[0]!.guest.setAudioMuted).toHaveBeenLastCalledWith(false)
    expect(views[0]!.view.setVisible).toHaveBeenLastCalledWith(true)

    manager.destroy()
  })

  it('refits fixed-width pages as sidebar bounds change without overriding manual zoom', async () => {
    vi.useFakeTimers()
    try {
      const sessions = new ExtensionViewSessionRegistry(() => 1_000)
      const record = sessions.create({
        sessionId: 'fedcba0987654321',
        extensionId: 'acme.social',
        extensionVersion: '1.0.0',
        contributionId: 'social',
        entryPath: 'dist/index.html',
        externalWebviewHosts: ['bilibili.com', '*.bilibili.com'],
        parentWebContentsId: 10
      })
      const listeners = new Map<string, (...args: unknown[]) => void>()
      let currentUrl = ''
      let currentZoom = 1
      let measuredViewportWidth = 400
      const setZoomFactor = vi.fn((value: number) => { currentZoom = value })
      const guest = {
        id: 33,
        session: {
          setPermissionRequestHandler: vi.fn(),
          setPermissionCheckHandler: vi.fn(),
          setDevicePermissionHandler: vi.fn(),
          on: vi.fn(),
          webRequest: { onBeforeRequest: vi.fn() }
        },
        navigationHistory: {
          canGoBack: () => false,
          canGoForward: () => false,
          goBack: vi.fn(),
          goForward: vi.fn()
        },
        setUserAgent: vi.fn(),
        setAudioMuted: vi.fn(),
        executeJavaScript: vi.fn(async () => ({
          viewportWidth: measuredViewportWidth,
          contentWidth: 1_000
        })),
        getZoomFactor: vi.fn(() => currentZoom),
        setZoomFactor,
        setWindowOpenHandler: vi.fn(),
        on: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener)
        }),
        once: vi.fn((event: string, listener: (...args: unknown[]) => void) => {
          listeners.set(event, listener)
        }),
        loadURL: vi.fn(async (url: string) => { currentUrl = url }),
        getURL: vi.fn(() => currentUrl),
        getTitle: vi.fn(() => 'Bilibili'),
        reload: vi.fn(),
        isDestroyed: vi.fn(() => false),
        close: vi.fn()
      }
      const view = {
        webContents: guest,
        setBorderRadius: vi.fn(),
        setBounds: vi.fn(),
        setVisible: vi.fn()
      }
      const window = {
        contentView: { addChildView: vi.fn(), removeChildView: vi.fn() },
        webContents: {
          id: 10,
          getZoomFactor: () => 1,
          send: vi.fn(),
          isDestroyed: () => false
        },
        getContentBounds: () => ({ x: 0, y: 0, width: 1_200, height: 800 }),
        isDestroyed: () => false
      }
      const manager = new ExtensionExternalBrowserManager(sessions, () => view as never)

      manager.mount(record, window as never, 'bilibili', 'https://www.bilibili.com/', {
        x: 800,
        y: 100,
        width: 400,
        height: 700,
        visible: true
      }, 'mobile')
      listeners.get('did-stop-loading')?.()
      await vi.runAllTimersAsync()
      expect(setZoomFactor).toHaveBeenLastCalledWith(0.4)

      manager.updateBounds(record.sessionId, {
        x: 600,
        y: 100,
        width: 600,
        height: 700,
        visible: true
      })
      expect(setZoomFactor).toHaveBeenLastCalledWith(0.6)

      manager.command(record.sessionId, 'zoomIn')
      expect(setZoomFactor).toHaveBeenLastCalledWith(0.7)
      manager.updateBounds(record.sessionId, {
        x: 900,
        y: 100,
        width: 300,
        height: 700,
        visible: true
      })
      expect(setZoomFactor).toHaveBeenLastCalledWith(0.7)

      measuredViewportWidth = 300
      listeners.get('did-start-navigation')?.({}, 'https://www.bilibili.com/video', false, true)
      expect(setZoomFactor).toHaveBeenLastCalledWith(1)
      listeners.get('did-stop-loading')?.()
      await vi.runAllTimersAsync()
      expect(setZoomFactor).toHaveBeenLastCalledWith(0.3)

      manager.destroy()
    } finally {
      vi.useRealTimers()
    }
  })
})

function mockBrowserView(id: number): {
  guest: Record<string, ReturnType<typeof vi.fn>> & {
    id: number
    session: object
    navigationHistory: object
  }
  view: Record<string, unknown>
} {
  let currentUrl = ''
  const guest = {
    id,
    session: {
      setPermissionRequestHandler: vi.fn(),
      setPermissionCheckHandler: vi.fn(),
      setDevicePermissionHandler: vi.fn(),
      on: vi.fn(),
      webRequest: { onBeforeRequest: vi.fn() }
    },
    navigationHistory: {
      canGoBack: () => false,
      canGoForward: () => false,
      goBack: vi.fn(),
      goForward: vi.fn()
    },
    setUserAgent: vi.fn(),
    enableDeviceEmulation: vi.fn(),
    setAudioMuted: vi.fn(),
    executeJavaScript: vi.fn(async () => undefined),
    getZoomFactor: vi.fn(() => 1),
    setZoomFactor: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    on: vi.fn(),
    once: vi.fn(),
    loadURL: vi.fn(async (url: string) => { currentUrl = url }),
    getURL: vi.fn(() => currentUrl),
    getTitle: vi.fn(() => 'Social page'),
    reload: vi.fn(),
    isDestroyed: vi.fn(() => false),
    close: vi.fn()
  }
  return {
    guest: guest as never,
    view: {
      webContents: guest,
      setBorderRadius: vi.fn(),
      setBounds: vi.fn(),
      setVisible: vi.fn()
    }
  }
}
