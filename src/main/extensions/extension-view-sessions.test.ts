import { describe, expect, it, vi } from 'vitest'
import {
  hardenExternalWebPreferences,
  hardenExtensionWebPreferences,
  installWebviewSecurityGuards,
  isAllowedExternalWebviewRequest,
  isAllowedExternalWebviewSubresource,
  isAllowedExtensionNavigation,
  isAllowedExtensionSubresource
} from './extension-webview-security'
import {
  ExtensionViewSessionRegistry,
  isAllowedExternalWebviewUrl
} from './extension-view-sessions'

describe('ExtensionViewSessionRegistry', () => {
  it('binds a guest once to the exact parent, extension and entry', () => {
    const registry = new ExtensionViewSessionRegistry(() => 1_000)
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const prepared = registry.prepareAttach(10, created.sourceUrl)
    const destroyedListeners: Array<() => void> = []
    const guest = {
      id: 20,
      once: (_event: string, listener: () => void) => destroyedListeners.push(listener)
    }
    registry.bindNextGuest(10, guest as never)

    expect(registry.requireGuest(20, created.sessionId, prepared.nonce)).toMatchObject({
      extensionId: 'acme.example',
      contributionId: 'issues',
      state: 'active'
    })
    expect(() => registry.requireGuest(20, created.sessionId, 'wrong-nonce')).toThrow(
      /not authorized/
    )
    expect(() => registry.prepareAttach(10, created.sourceUrl)).toThrow(/unavailable/)
  })

  it('refreshes the protected main-frame identity after the guest document commits', () => {
    const registry = new ExtensionViewSessionRegistry(() => 1_000)
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    registry.prepareAttach(10, created.sourceUrl)
    const guestListeners = new Map<string, (...args: unknown[]) => void>()
    const guest = {
      id: 20,
      mainFrame: { processId: 100, routingId: 200 },
      once: vi.fn(),
      on(event: string, listener: (...args: unknown[]) => void) {
        guestListeners.set(event, listener)
        return this
      }
    }
    const changed = vi.fn()
    registry.onDidChangeMainFrame(changed)
    registry.bindNextGuest(10, guest as never)
    const attachFrame = guest.mainFrame
    guest.mainFrame = { processId: 101, routingId: 201 }

    expect(() => registry.requireCurrentGuestMainFrame(
      20,
      created.sessionId,
      created.nonce,
      attachFrame as never
    )).toThrow(/current guest main frame/)
    expect(() => registry.requireCurrentGuestMainFrame(
      20,
      created.sessionId,
      created.nonce,
      { processId: 101, routingId: 999 } as never
    )).toThrow(/current guest main frame/)
    expect(() => registry.requireCurrentGuestMainFrame(
      21,
      created.sessionId,
      created.nonce,
      guest.mainFrame as never
    )).toThrow(/not authorized/)

    expect(registry.requireCurrentGuestMainFrame(
      20,
      created.sessionId,
      created.nonce,
      guest.mainFrame as never
    )).toMatchObject({
      guestMainFrameProcessId: 101,
      guestMainFrameRoutingId: 201
    })
    expect(registry.get(created.sessionId)).toMatchObject({
      guestMainFrameProcessId: 101,
      guestMainFrameRoutingId: 201
    })
    expect(changed).toHaveBeenCalledTimes(1)

    guestListeners.get('did-start-navigation')?.({
      isMainFrame: true,
      isSameDocument: false
    })
    expect(() => registry.requireCurrentGuestMainFrame(
      20,
      created.sessionId,
      created.nonce,
      guest.mainFrame as never
    )).toThrow(/current guest main frame/)
    expect(registry.get(created.sessionId)).toMatchObject({
      guestMainFrameProcessId: undefined,
      guestMainFrameRoutingId: undefined
    })

    guestListeners.get('did-stop-loading')?.()
    expect(registry.requireCurrentGuestMainFrame(
      20,
      created.sessionId,
      created.nonce,
      guest.mainFrame as never
    )).toMatchObject({
      guestMainFrameProcessId: 101,
      guestMainFrameRoutingId: 201
    })
  })

  it('forces the Kun preload, non-persistent partition and sandbox baseline', () => {
    const record = new ExtensionViewSessionRegistry().create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const preferences = {
      preload: '/attacker/preload.js',
      nodeIntegration: true,
      contextIsolation: false,
      sandbox: false,
      partition: 'persist:shared'
    }
    hardenExtensionWebPreferences(preferences as never, record, '/kun/extension-view.cjs')
    expect(preferences).toMatchObject({
      preload: '/kun/extension-view.cjs',
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      partition: expect.stringMatching(/^temp:kun-extension-/)
    })
    expect((preferences as unknown as { additionalArguments: string[] }).additionalArguments).toEqual([
      '--kun-extension-view-session=1234567890abcdef',
      expect.stringMatching(/^--kun-extension-view-nonce=.{32,}$/)
    ])
    expect((preferences as unknown as { webviewTag: boolean }).webviewTag).toBe(false)
  })

  it('keeps reviewed external Views unable to create nested Webviews', () => {
    const registry = new ExtensionViewSessionRegistry(() => 1_000)
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.social',
      extensionVersion: '1.0.0',
      contributionId: 'social',
      entryPath: 'dist/index.html',
      externalWebviewHosts: ['bilibili.com', '*.bilibili.com'],
      parentWebContentsId: 10
    })
    registry.prepareAttach(10, created.sourceUrl)
    const parent = {
      id: 20,
      once: vi.fn(),
      on: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    registry.bindNextGuest(10, parent as never)

    const parentPreferences = {}
    hardenExtensionWebPreferences(
      parentPreferences as never,
      created,
      '/kun/extension-view.cjs'
    )
    expect(parentPreferences).toMatchObject({ webviewTag: false })

    const external = registry.prepareExternalAttach(20, 'https://www.bilibili.com/video/BV1')
    const preferences = {
      preload: '/attacker/preload.js',
      nodeIntegration: true,
      webviewTag: true,
      partition: 'persist:shared'
    }
    hardenExternalWebPreferences(preferences as never, external)
    expect(preferences).toMatchObject({
      nodeIntegration: false,
      webviewTag: false,
      partition: expect.stringMatching(/^persist:kun-external-/)
    })
    expect('preload' in preferences).toBe(false)

    const child = {
      id: 30,
      once: vi.fn(),
      isDestroyed: () => false,
      close: vi.fn()
    }
    registry.bindNextExternalGuest(20, child as never)
    expect(registry.findExternalByGuest(30)).toMatchObject({
      parentSessionId: created.sessionId,
      extensionId: 'acme.social',
      state: 'active'
    })
    expect(() => registry.prepareExternalAttach(20, 'https://example.com/')).toThrow(
      /not granted/
    )
    expect(registry.dispose(created.sessionId)).toBe(true)
    expect(child.close).toHaveBeenCalledOnce()
  })

  it('matches only HTTPS external navigation grants and safe subresource schemes', () => {
    const hosts = ['bilibili.com', '*.bilibili.com']
    expect(isAllowedExternalWebviewUrl('https://bilibili.com/', hosts)).toBe(true)
    expect(isAllowedExternalWebviewUrl('https://space.bilibili.com/123', hosts)).toBe(true)
    expect(isAllowedExternalWebviewUrl('https://notbilibili.com/', hosts)).toBe(false)
    expect(isAllowedExternalWebviewUrl('http://www.bilibili.com/', hosts)).toBe(false)
    expect(isAllowedExternalWebviewUrl('file:///tmp/secret', hosts)).toBe(false)
    expect(isAllowedExternalWebviewSubresource('https://i0.hdslb.com/image.jpg')).toBe(true)
    expect(isAllowedExternalWebviewSubresource('wss://broadcast.example/socket')).toBe(true)
    expect(isAllowedExternalWebviewSubresource('file:///tmp/secret')).toBe(false)
    expect(isAllowedExternalWebviewSubresource('http://example.com/tracker')).toBe(false)
    expect(isAllowedExternalWebviewRequest(
      'https://www.bilibili.com/video/BV1',
      'mainFrame',
      { allowedHosts: hosts }
    )).toBe(true)
    expect(isAllowedExternalWebviewRequest(
      'https://example.com/phishing',
      'mainFrame',
      { allowedHosts: hosts }
    )).toBe(false)
    expect(isAllowedExternalWebviewRequest(
      'https://example.com/script.js',
      'script',
      { allowedHosts: hosts }
    )).toBe(true)
    expect(isAllowedExternalWebviewRequest(
      'https://www.bilibili.com/',
      'mainFrame',
      undefined,
      true
    )).toBe(true)
  })

  it('allows only navigation within the bound extension origin', () => {
    const record = { extensionId: 'acme.example' }
    expect(isAllowedExtensionNavigation('kun-extension://acme.example/dist/app.js', record)).toBe(true)
    expect(isAllowedExtensionNavigation('kun-extension://other.example/dist/app.js', record)).toBe(false)
    expect(isAllowedExtensionNavigation('https://example.com', record)).toBe(false)
    expect(isAllowedExtensionNavigation('file:///tmp/secret', record)).toBe(false)
  })

  it('allows protected media through the Host filter without opening other network access', () => {
    const record = { extensionId: 'acme.example' }
    expect(isAllowedExtensionSubresource(
      'kun-extension://acme.example/dist/app.js',
      record
    )).toBe(true)
    expect(isAllowedExtensionSubresource(
      'kun-media://lease/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      record
    )).toBe(true)
    expect(isAllowedExtensionSubresource(
      'kun-media://other/abcdefghijklmnopqrstuvwxyzABCDEFGH123456789',
      record
    )).toBe(false)
    expect(isAllowedExtensionSubresource(
      'kun-extension://other.example/dist/app.js',
      record
    )).toBe(false)
    expect(isAllowedExtensionSubresource('https://example.com/media.mp4', record)).toBe(false)
    expect(isAllowedExtensionSubresource('file:///tmp/secret.mp4', record)).toBe(false)
  })

  it('prepares the isolated protocol partition before allowing the first Webview navigation', () => {
    const registry = new ExtensionViewSessionRegistry()
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const appListeners = new Map<string, (...args: never[]) => void>()
    const contentsListeners = new Map<string, (...args: never[]) => void>()
    const assertExtensionPartitionPrepared = vi.fn()
    installWebviewSecurityGuards({
      app: {
        on: vi.fn((event: string, listener: (...args: never[]) => void) => {
          appListeners.set(event, listener)
        })
      } as never,
      sessions: registry,
      extensionPreloadPath: '/kun/extension-view.cjs',
      assertExtensionPartitionPrepared,
      isPreparedExtensionNavigation: () => false,
      isTrustedWorkbench: () => true,
      isAllowedDevPreviewUrl: () => false,
      isAuthorizedPrototypeFileUrl: () => false
    })
    const contents = {
      id: 10,
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        contentsListeners.set(event, listener)
      }),
      setWindowOpenHandler: vi.fn(),
      getType: () => 'window'
    }
    appListeners.get('web-contents-created')?.({} as never, contents as never)
    const event = { preventDefault: vi.fn() }
    const preferences: Record<string, unknown> = {}
    const params: Record<string, unknown> = { src: created.sourceUrl }

    contentsListeners.get('will-attach-webview')?.(
      event as never,
      preferences as never,
      params as never
    )

    expect(assertExtensionPartitionPrepared).toHaveBeenCalledOnce()
    expect(assertExtensionPartitionPrepared).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: created.sessionId,
      partition: created.partition
    }))
    expect(params.partition).toBe(created.partition)
    expect(preferences).toMatchObject({
      preload: '/kun/extension-view.cjs',
      partition: created.partition,
      sandbox: true
    })
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('denies and disposes the View Session when isolated protocol setup fails', () => {
    const registry = new ExtensionViewSessionRegistry()
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    let webContentsCreated: ((...args: never[]) => void) | undefined
    let willAttach: ((...args: never[]) => void) | undefined
    installWebviewSecurityGuards({
      app: {
        on: vi.fn((_event: string, listener: (...args: never[]) => void) => {
          webContentsCreated = listener
        })
      } as never,
      sessions: registry,
      extensionPreloadPath: '/kun/extension-view.cjs',
      assertExtensionPartitionPrepared: () => {
        throw new Error('protocol unavailable')
      },
      isPreparedExtensionNavigation: () => false,
      isTrustedWorkbench: () => true,
      isAllowedDevPreviewUrl: () => false,
      isAuthorizedPrototypeFileUrl: () => false
    })
    webContentsCreated?.({} as never, {
      id: 10,
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        if (event === 'will-attach-webview') willAttach = listener
      }),
      setWindowOpenHandler: vi.fn(),
      getType: () => 'window'
    } as never)
    const event = { preventDefault: vi.fn() }

    willAttach?.(event as never, {} as never, { src: created.sourceUrl } as never)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(registry.get(created.sessionId)).toBeUndefined()
  })

  it('allows only the prepared initial navigation before did-attach binds the guest', () => {
    let webContentsCreated: ((...args: never[]) => void) | undefined
    const guestListeners = new Map<string, (...args: never[]) => void>()
    const sourceUrl =
      'kun-extension://acme.example/dist/index.html?kunViewSession=1234567890abcdef'
    const isPreparedExtensionNavigation = vi.fn((_contents: unknown, url: string) =>
      url === sourceUrl
    )
    installWebviewSecurityGuards({
      app: {
        on: vi.fn((_event: string, listener: (...args: never[]) => void) => {
          webContentsCreated = listener
        })
      } as never,
      sessions: new ExtensionViewSessionRegistry(),
      extensionPreloadPath: '/kun/extension-view.cjs',
      assertExtensionPartitionPrepared: vi.fn(),
      isPreparedExtensionNavigation,
      isTrustedWorkbench: () => true,
      isAllowedDevPreviewUrl: () => false,
      isAuthorizedPrototypeFileUrl: () => false
    })
    const guest = {
      id: 20,
      session: { getPartition: () => 'temp:unbound-webview' },
      on: vi.fn((event: string, listener: (...args: never[]) => void) => {
        guestListeners.set(event, listener)
      }),
      setWindowOpenHandler: vi.fn(),
      getType: () => 'webview'
    }
    webContentsCreated?.({} as never, guest as never)
    const initialEvent = { preventDefault: vi.fn() }
    const foreignEvent = { preventDefault: vi.fn() }

    guestListeners.get('will-navigate')?.(initialEvent as never, sourceUrl as never)
    guestListeners.get('will-navigate')?.(
      foreignEvent as never,
      'kun-extension://other.example/dist/index.html?kunViewSession=1234567890abcdef' as never
    )

    expect(initialEvent.preventDefault).not.toHaveBeenCalled()
    expect(foreignEvent.preventDefault).toHaveBeenCalledOnce()
    expect(isPreparedExtensionNavigation).toHaveBeenCalledTimes(2)
  })

  it('delivers notifications only to active bound guests and reports teardown once', () => {
    const registry = new ExtensionViewSessionRegistry()
    const created = registry.create({
      sessionId: '1234567890abcdef',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    registry.prepareAttach(10, created.sourceUrl)
    const send = vi.fn()
    const guest = {
      id: 20,
      once: vi.fn(),
      send,
      isDestroyed: () => false,
      close: vi.fn()
    }
    registry.bindNextGuest(10, guest as never)
    const disposed = vi.fn()
    registry.onDidDispose(disposed)

    expect(registry.sendToGuest(created.sessionId, 'agent.event', { sequence: 2 })).toBe(true)
    expect(registry.broadcastToGuests('ui.themeChanged', { kind: 'dark' })).toBe(1)
    expect(send).toHaveBeenNthCalledWith(1, 'extension:view:notification', {
      sessionId: created.sessionId,
      method: 'agent.event',
      params: { sequence: 2 }
    })

    expect(registry.disposeForParent(10)).toBe(1)
    expect(disposed).toHaveBeenCalledTimes(1)
    expect(disposed).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: created.sessionId,
      state: 'disposed'
    }))
    expect(registry.sendToGuest(created.sessionId, 'agent.event', null)).toBe(false)
  })

  it('disposes only sessions in the selected extension workspace', () => {
    const registry = new ExtensionViewSessionRegistry()
    const workspaceA = registry.create({
      sessionId: 'workspace-a-session',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/a',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })
    const workspaceB = registry.create({
      sessionId: 'workspace-b-session',
      extensionId: 'acme.example',
      extensionVersion: '1.0.0',
      contributionId: 'issues',
      workspaceRoot: '/workspace/b',
      entryPath: 'dist/index.html',
      parentWebContentsId: 10
    })

    expect(registry.disposeForExtensionWorkspace('acme.example', '/workspace/a')).toBe(1)
    expect(registry.get(workspaceA.sessionId)).toBeUndefined()
    expect(registry.get(workspaceB.sessionId)).toMatchObject({ workspaceRoot: '/workspace/b' })
  })
})
