import { ExtensionContributionsSchema } from '@kun/extension-api'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create as createRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import i18n from '../i18n'
import {
  ContributionRegistry,
  ExtensionWorkbenchSnapshotSchema
} from './contribution-registry'
import {
  DeclarativeActionBar,
  DeclarativeContextMenu,
  DeclarativeNotifications,
  DeclarativeViewContainers,
  DynamicExtensionNotifications,
  ExtensionViewOutlet,
  isTrustedNotificationActivation,
  isSecretLikeSettingKey,
  matchingResultPreviewContributions
} from './ControlledContributionSurfaces'
import {
  extensionViewSessionContractKey,
  validateExtensionViewSession
} from './ExtensionWebview'
import {
  requiresWideAuthenticationViewport,
  siteForUrl
} from './ExtensionExternalBrowser'
import { extensionWorkbenchClient } from './extension-workbench-client'

function registryWithContributions(): ContributionRegistry {
  const registry = new ContributionRegistry()
  registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    extensions: [{
      id: 'acme.ui',
      version: '1.0.0',
      workspaceTrusted: true,
      grantedPermissions: ['commands.register', 'ui.actions', 'ui.notifications', 'ui.views', 'webview'],
      contributes: ExtensionContributionsSchema.parse({
        commands: [{ id: 'inspect-result', title: 'Inspect result' }],
        'actions.topBar': [{
          id: 'refresh',
          command: 'refresh',
          title: '<img src=x onerror=alert(1)> Refresh'
        }],
        notifications: [{
          id: 'notice',
          title: '<script>bad()</script>',
          message: 'Safe text',
          actions: [{ id: 'inspect', title: 'Inspect', command: 'inspect-result' }]
        }],
        'views.rightSidebar': [{
          id: 'dashboard',
          title: 'Dashboard',
          entry: 'dist/index.html'
        }],
        'views.containers': [{
          id: 'tools',
          title: 'Tools',
          location: 'activity'
        }],
        'message.resultPreviews': [{
          id: 'json-preview',
          title: 'JSON preview',
          entry: 'dist/preview.html',
          mimeTypes: ['application/json']
        }],
        contextMenus: [{
          id: 'inspect-menu',
          location: 'message',
          command: 'inspect-result'
        }]
      })
    }]
  }))
  return registry
}

describe('controlled workbench contribution rendering', () => {
  it('widens mobile authentication routes without treating ordinary content as login UI', () => {
    expect(requiresWideAuthenticationViewport(
      'douyin',
      'https://www.douyin.com/user/self'
    )).toBe(true)
    expect(requiresWideAuthenticationViewport(
      'bilibili',
      'https://passport.bilibili.com/login'
    )).toBe(true)
    expect(requiresWideAuthenticationViewport(
      'xiaohongshu',
      'https://www.xiaohongshu.com/explore'
    )).toBe(false)
  })

  it('rejects synthetic Direct DOM notification activation', () => {
    const onRespond = vi.fn()
    let renderer!: ReturnType<typeof createRenderer>
    act(() => {
      renderer = createRenderer(createElement(DynamicExtensionNotifications, {
        notifications: [{
          notificationId: 'notification_12345678-1234-1234-1234-123456789abc',
          extensionId: 'acme.ui',
          extensionVersion: '1.0.0',
          sourceId: 'runtime-notice',
          title: 'Runtime notice',
          message: 'Safe message',
          severity: 'info',
          actions: [{ id: 'retry', title: 'Retry' }],
          createdAt: '2026-07-11T00:00:00.000Z',
          expiresAt: '2026-07-11T00:01:00.000Z'
        }],
        onRespond
      }))
    })
    const [action] = renderer.root.findAllByType('button')

    act(() => action!.props.onClick({ nativeEvent: { isTrusted: false } }))
    expect(onRespond).not.toHaveBeenCalled()
    act(() => action!.props.onClick({ nativeEvent: { isTrusted: true } }))
    expect(onRespond).toHaveBeenCalledWith(
      'notification_12345678-1234-1234-1234-123456789abc',
      'retry'
    )
    act(() => renderer.unmount())
  })

  it('rejects synthetic declarative notification actions and dismissal', () => {
    const onCommand = vi.fn()
    let renderer!: ReturnType<typeof createRenderer>
    act(() => {
      renderer = createRenderer(createElement(DeclarativeNotifications, {
        contributions: registryWithContributions().list('notifications'),
        onCommand
      }))
    })
    const [action, dismiss] = renderer.root.findAllByType('button')

    act(() => action!.props.onClick({ nativeEvent: { isTrusted: false } }))
    act(() => dismiss!.props.onClick({ nativeEvent: { isTrusted: false } }))
    expect(onCommand).not.toHaveBeenCalled()
    expect(renderer.root.findAllByProps({
      'data-contribution-id': 'extension:acme.ui/notice'
    })).toHaveLength(1)

    act(() => action!.props.onClick({ nativeEvent: { isTrusted: true } }))
    expect(onCommand).toHaveBeenCalledWith(
      'extension:acme.ui/inspect-result',
      { notificationId: 'extension:acme.ui/notice' }
    )
    act(() => dismiss!.props.onClick({ nativeEvent: { isTrusted: true } }))
    expect(renderer.root.findAllByProps({
      'data-contribution-id': 'extension:acme.ui/notice'
    })).toHaveLength(0)
    act(() => renderer.unmount())
  })

  it('keeps runtime notification responses bound to the clicked extension', () => {
    const onRespond = vi.fn()
    const notification = (
      notificationId: string,
      extensionId: string,
      actionId: string
    ) => ({
      notificationId,
      extensionId,
      extensionVersion: '1.0.0',
      sourceId: `${extensionId}-notice`,
      title: `${extensionId} notice`,
      message: 'Safe message',
      severity: 'info' as const,
      actions: [{ id: actionId, title: actionId }],
      createdAt: '2026-07-11T00:00:00.000Z',
      expiresAt: '2026-07-11T00:01:00.000Z'
    })
    const acmeId = 'notification_12345678-1234-1234-1234-123456789abc'
    const otherId = 'notification_22345678-1234-1234-1234-123456789abc'
    let renderer!: ReturnType<typeof createRenderer>
    act(() => {
      renderer = createRenderer(createElement(DynamicExtensionNotifications, {
        notifications: [
          notification(acmeId, 'acme.ui', 'retry-acme'),
          notification(otherId, 'other.ui', 'retry-other')
        ],
        onRespond
      }))
    })
    const cards = renderer.root.findAll((node) =>
      typeof node.props['data-extension-notification-id'] === 'string')
    const acmeButtons = cards.find((card) =>
      card.props['data-extension-notification-id'] === acmeId)!.findAllByType('button')
    const otherButtons = cards.find((card) =>
      card.props['data-extension-notification-id'] === otherId)!.findAllByType('button')

    act(() => otherButtons[0]!.props.onClick({ nativeEvent: { isTrusted: false } }))
    act(() => acmeButtons[1]!.props.onClick({ nativeEvent: { isTrusted: false } }))
    expect(onRespond).not.toHaveBeenCalled()

    act(() => otherButtons[0]!.props.onClick({ nativeEvent: { isTrusted: true } }))
    act(() => acmeButtons[1]!.props.onClick({ nativeEvent: { isTrusted: true } }))
    expect(onRespond.mock.calls).toEqual([
      [otherId, 'retry-other'],
      [acmeId]
    ])
    act(() => renderer.unmount())
  })

  it('renders action and notification metadata as escaped host-owned controls', () => {
    const registry = registryWithContributions()
    const actions = registry.list('actions.topBar')
    const notifications = registry.list('notifications')
    const actionHtml = renderToStaticMarkup(createElement(DeclarativeActionBar, {
      contributions: actions,
      context: { surface: 'topBar' },
      onCommand: vi.fn()
    }))
    const notificationHtml = renderToStaticMarkup(createElement(DeclarativeNotifications, {
      contributions: notifications,
      onCommand: vi.fn()
    }))

    expect(actionHtml).toContain('data-contribution-id="extension:acme.ui/refresh"')
    expect(actionHtml).toContain('&lt;img src=x onerror=alert(1)&gt;')
    expect(actionHtml).not.toContain('<img src="x"')
    expect(notificationHtml).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(notificationHtml).not.toContain('<script>')
    const dynamicHtml = renderToStaticMarkup(createElement(DynamicExtensionNotifications, {
      notifications: [{
        notificationId: 'notification_12345678-1234-1234-1234-123456789abc',
        extensionId: 'acme.ui',
        extensionVersion: '1.0.0',
        sourceId: 'runtime-notice',
        title: '<img src=x onerror=alert(1)> Runtime notice',
        message: '<script>bad()</script>',
        severity: 'warning',
        actions: [{ id: 'retry', title: 'Retry safely' }],
        createdAt: '2026-07-11T00:00:00.000Z',
        expiresAt: '2026-07-11T00:01:00.000Z'
      }],
      onRespond: vi.fn()
    }))
    expect(dynamicHtml).toContain('data-extension-notification-id=')
    expect(dynamicHtml).toContain('&lt;script&gt;bad()&lt;/script&gt;')
    expect(dynamicHtml).not.toContain('<script>')
    expect(isTrustedNotificationActivation({ nativeEvent: { isTrusted: false } })).toBe(false)
    expect(isTrustedNotificationActivation({ nativeEvent: { isTrusted: true } })).toBe(true)
    const queuedHtml = renderToStaticMarkup(createElement(DynamicExtensionNotifications, {
      notifications: Array.from({ length: 6 }, (_, index) => ({
        notificationId: `notification_${index + 1}2345678-1234-1234-1234-123456789abc`,
        extensionId: 'acme.ui',
        extensionVersion: '1.0.0',
        sourceId: `runtime-notice-${index}`,
        title: `Notice ${index}`,
        message: 'Bounded',
        severity: 'info' as const,
        actions: [],
        createdAt: '2026-07-11T00:00:00.000Z',
        expiresAt: '2026-07-11T00:01:00.000Z'
      })),
      onRespond: vi.fn()
    }))
    expect(queuedHtml.match(/data-extension-notification-id=/g)).toHaveLength(5)
    expect(queuedHtml).toContain('data-extension-notifications-queued="1"')
    expect(isSecretLikeSettingKey('apiKey')).toBe(true)
    expect(isSecretLikeSettingKey('displayDensity')).toBe(false)
    const containersHtml = renderToStaticMarkup(createElement(DeclarativeViewContainers, {
      contributions: registry.list('views.containers'),
      activeId: 'extension:acme.ui/tools',
      onSelect: vi.fn()
    }))
    expect(containersHtml).toContain('aria-label="Extension Views"')
    expect(containersHtml).toContain('data-contribution-id="extension:acme.ui/tools"')
    const menuHtml = renderToStaticMarkup(createElement(DeclarativeContextMenu, {
      contributions: registry.list('contextMenus'),
      commands: registry.list('commands'),
      context: { surface: 'message' },
      onCommand: vi.fn()
    }))
    expect(menuHtml).toContain('Inspect result')
    expect(menuHtml).toContain('data-contribution-id="extension:acme.ui/inspect-menu"')
  })

  it('routes complex extension UI only through the isolated Webview host', () => {
    const contribution = registryWithContributions().list('views.rightSidebar')
      .find((item) => item.id === 'extension:acme.ui/dashboard')!
    const html = renderToStaticMarkup(createElement(ExtensionViewOutlet, { contribution }))
    expect(html).toContain('data-contribution-id="extension:acme.ui/dashboard"')
    expect(html).toContain('Opening isolated extension View')
    expect(html).not.toContain('dangerouslySetInnerHTML')
    expect(matchingResultPreviewContributions(
      registryWithContributions().list('message.resultPreviews'),
      'application/json'
    ).map((item) => item.id)).toEqual(['extension:acme.ui/json-preview'])

    const validSession = {
      sessionId: 'session-0123456789',
      nonce: 'nonce-0123456789',
      contributionId: contribution.id,
      extensionId: 'acme.ui',
      extensionVersion: '1.0.0',
      src: 'kun-extension://acme.ui/dist/index.html',
      partition: 'kun-extension-acme-ui-session'
    }
    expect(validateExtensionViewSession(validSession, contribution)).toBeNull()
    expect(validateExtensionViewSession({ ...validSession, partition: 'persist:shared' }, contribution)).toContain('non-persistent')
    expect(validateExtensionViewSession({ ...validSession, src: 'https://evil.example/' }, contribution)).toContain('origin mismatch')
  })

  it('routes declared external browser Views through Host chrome without nesting a Webview', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      extensions: [{
        id: 'acme.social',
        version: '1.0.0',
        workspaceTrusted: true,
        grantedPermissions: [
          'ui.views',
          'webview',
          'webview.external',
          'network:bilibili.com',
          'network:*.bilibili.com'
        ],
        contributes: ExtensionContributionsSchema.parse({
          'views.rightSidebar': [{
            id: 'social',
            title: 'Social',
            entry: 'dist/index.html',
            externalBrowser: {
              presentation: 'mobile',
              sites: [{
                id: 'bilibili',
                title: '哔哩哔哩',
                badge: 'B',
                accent: '#00aeec',
                url: 'https://www.bilibili.com/'
              }]
            }
          }]
        })
      }]
    }))
    const contribution = registry.list('views.rightSidebar')
      .find((item) => item.id === 'extension:acme.social/social')!
    const html = renderToStaticMarkup(createElement(ExtensionViewOutlet, { contribution }))

    expect(html).toContain('data-external-browser-view="true"')
    expect(html).toContain('data-browser-presentation="mobile"')
    expect(html).toContain('data-mobile-browser-frame="true"')
    expect(html).toContain('网页版')
    expect(html).toContain('手机版')
    expect(html).toContain('全屏浏览')
    expect(html).toContain('100%')
    expect(html).toContain('哔哩哔哩')
    expect(html).not.toContain('<webview')
    expect(siteForUrl(
      contribution.payload.externalBrowser!.sites,
      'https://space.bilibili.com/123'
    )?.id).toBe('bilibili')
  })

  it('keeps an opening View session across equivalent contribution snapshot replacements', async () => {
    const contribution = registryWithContributions().list('views.rightSidebar')
      .find((item) => item.id === 'extension:acme.ui/dashboard')!
    const equivalent = {
      ...contribution,
      payload: { ...contribution.payload },
      owner: contribution.owner.kind === 'extension'
        ? {
            ...contribution.owner,
            grantedPermissions: [...contribution.owner.grantedPermissions]
          }
        : contribution.owner
    }
    expect(equivalent).not.toBe(contribution)
    expect(extensionViewSessionContractKey(equivalent)).toBe(
      extensionViewSessionContractKey(contribution)
    )
    expect(extensionViewSessionContractKey({
      ...equivalent,
      payload: { ...equivalent.payload, entry: 'dist/next.html' }
    })).not.toBe(extensionViewSessionContractKey(contribution))
    expect(extensionViewSessionContractKey({
      ...equivalent,
      payload: { ...equivalent.payload, localResourceRoots: ['dist', 'assets'] }
    })).not.toBe(extensionViewSessionContractKey(contribution))
    expect(extensionViewSessionContractKey({
      ...equivalent,
      owner: equivalent.owner.kind === 'extension'
        ? { ...equivalent.owner, extensionVersion: '2.0.0' }
        : equivalent.owner
    })).not.toBe(extensionViewSessionContractKey(contribution))

    let resolveSession!: (session: Awaited<ReturnType<
      typeof extensionWorkbenchClient.createViewSession
    >>) => void
    const opening = new Promise<Awaited<ReturnType<
      typeof extensionWorkbenchClient.createViewSession
    >>>((resolve) => {
      resolveSession = resolve
    })
    const createSession = vi.spyOn(extensionWorkbenchClient, 'createViewSession')
      .mockReturnValue(opening)
    const disposeSession = vi.spyOn(extensionWorkbenchClient, 'disposeViewSession')
      .mockResolvedValue(undefined)
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('window', { requestAnimationFrame: vi.fn() })
    let renderer!: ReturnType<typeof createRenderer>
    try {
      await act(async () => {
        renderer = createRenderer(createElement(ExtensionViewOutlet, {
          contribution,
          workspaceRoot: ' /workspace '
        }))
      })
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(createSession).toHaveBeenCalledWith(contribution.id, '/workspace')

      await act(async () => {
        renderer.update(createElement(ExtensionViewOutlet, {
          contribution: equivalent,
          workspaceRoot: '/workspace'
        }))
      })
      expect(createSession).toHaveBeenCalledTimes(1)
      expect(disposeSession).not.toHaveBeenCalled()

      await act(async () => {
        resolveSession({
          sessionId: 'session-0123456789',
          nonce: 'nonce-0123456789',
          contributionId: contribution.id,
          extensionId: 'acme.ui',
          extensionVersion: '1.0.0',
          src: 'kun-extension://acme.ui/dist/index.html',
          partition: 'kun-extension-acme-ui-session'
        })
        await opening
      })
      const [webview] = renderer.root.findAllByType('webview')
      expect(webview).toBeDefined()
      const webviewClasses = String(webview!.props.className).split(/\s+/)
      expect(webviewClasses).toContain('ds-no-drag')
      expect(webviewClasses).toContain('flex')
      expect(webviewClasses).toContain('w-full')
      expect(webviewClasses).not.toContain('block')
      const [host] = renderer.root.findAllByProps({
        'data-contribution-id': contribution.id
      })
      expect(String(host!.props.className).split(/\s+/)).toContain('ds-no-drag')
      expect(disposeSession).not.toHaveBeenCalled()

      const changedEntry = {
        ...equivalent,
        payload: { ...equivalent.payload, entry: 'dist/next.html' }
      }
      createSession.mockResolvedValueOnce({
        sessionId: 'session-9876543210',
        nonce: 'nonce-9876543210',
        contributionId: contribution.id,
        extensionId: 'acme.ui',
        extensionVersion: '1.0.0',
        src: 'kun-extension://acme.ui/dist/next.html',
        partition: 'kun-extension-acme-ui-session-next'
      })
      await act(async () => {
        renderer.update(createElement(ExtensionViewOutlet, {
          contribution: changedEntry,
          workspaceRoot: '/workspace'
        }))
      })
      expect(createSession).toHaveBeenCalledTimes(2)
      expect(disposeSession).toHaveBeenCalledTimes(1)
      expect(disposeSession).toHaveBeenCalledWith('session-0123456789')
      expect(renderer.root.findAllByProps({
        'data-extension-view-session': 'session-9876543210'
      })).toHaveLength(1)

      await act(async () => renderer.unmount())
      expect(disposeSession).toHaveBeenCalledTimes(2)
      expect(disposeSession).toHaveBeenLastCalledWith('session-9876543210')
    } finally {
      if (renderer) act(() => renderer.unmount())
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('requests an explicit Host recovery when the user retries an unavailable View', async () => {
    const contribution = registryWithContributions().list('views.rightSidebar')
      .find((item) => item.id === 'extension:acme.ui/dashboard')!
    const createSession = vi.spyOn(extensionWorkbenchClient, 'createViewSession')
      .mockRejectedValueOnce(new Error('Extension host circuit is open'))
      .mockResolvedValueOnce({
        sessionId: 'session-9876543210',
        nonce: 'nonce-9876543210',
        contributionId: contribution.id,
        extensionId: 'acme.ui',
        extensionVersion: '1.0.0',
        src: 'kun-extension://acme.ui/dist/index.html',
        partition: 'kun-extension-acme-ui-session-next'
      })
    vi.spyOn(extensionWorkbenchClient, 'disposeViewSession').mockResolvedValue(undefined)
    vi.stubGlobal('HTMLElement', class {})
    vi.stubGlobal('document', { activeElement: null })
    vi.stubGlobal('window', { requestAnimationFrame: vi.fn() })
    let renderer!: ReturnType<typeof createRenderer>
    try {
      await act(async () => {
        renderer = createRenderer(createElement(ExtensionViewOutlet, {
          contribution,
          workspaceRoot: '/workspace'
        }))
      })
      expect(createSession).toHaveBeenNthCalledWith(1, contribution.id, '/workspace')
      expect(renderer.root.findByProps({ role: 'alert' })).toBeDefined()

      await act(async () => {
        renderer.root.findByType('button').props.onClick()
      })

      expect(createSession).toHaveBeenNthCalledWith(
        2,
        contribution.id,
        '/workspace',
        { retryHost: true }
      )
      expect(renderer.root.findAllByProps({
        'data-extension-view-session': 'session-9876543210'
      })).toHaveLength(1)
    } finally {
      if (renderer) act(() => renderer.unmount())
      vi.restoreAllMocks()
      vi.unstubAllGlobals()
    }
  })

  it('renders Host-owned extension View status in the active Kun language', async () => {
    const contribution = registryWithContributions().list('views.rightSidebar')
      .find((item) => item.id === 'extension:acme.ui/dashboard')!
    await i18n.changeLanguage('zh')
    try {
      const html = renderToStaticMarkup(createElement(ExtensionViewOutlet, { contribution }))
      expect(html).toContain('正在打开隔离的扩展视图')
      expect(html).toContain('Dashboard 扩展视图')
    } finally {
      await i18n.changeLanguage('en')
    }
  })
})
