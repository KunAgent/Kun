import type { App, Session, WebContents, WebPreferences } from 'electron'
import { parseKunMediaUrl } from './extension-media-protocol'
import { parseKunExtensionUrl } from './extension-resource-protocol'
import {
  ExtensionViewSessionRegistry,
  isAllowedExternalWebviewUrl,
  type ExtensionExternalWebviewRecord,
  type ExtensionViewSessionRecord
} from './extension-view-sessions'

type WebviewSecurityOptions = {
  app: Pick<App, 'on'>
  sessions: ExtensionViewSessionRegistry
  extensionPreloadPath: string
  assertExtensionPartitionPrepared(record: ExtensionViewSessionRecord): void
  isPreparedExtensionNavigation(contents: WebContents, url: string): boolean
  isTrustedWorkbench(contents: WebContents): boolean
  isAllowedDevPreviewUrl(url: string): boolean
  isAuthorizedPrototypeFileUrl(url: string): boolean
  onDenied?: (detail: { code: string; url?: string }) => void
}

const hardenedExternalSessions = new WeakSet<Session>()

export function installWebviewSecurityGuards(options: WebviewSecurityOptions): void {
  options.app.on('web-contents-created', (_event, contents) => {
    contents.on('will-attach-webview', (event, webPreferences, params) => {
      const src = typeof params.src === 'string' ? params.src : ''
      if (src.startsWith('kun-extension:')) {
        if (!options.isTrustedWorkbench(contents)) {
          event.preventDefault()
          options.onDenied?.({ code: 'EXTENSION_WEBVIEW_PARENT_INVALID' })
          return
        }
        let record: ExtensionViewSessionRecord | undefined
        try {
          record = options.sessions.prepareAttach(contents.id, src)
          // The handler must already be installed before the renderer receives the
          // View Session. Attach is a second fail-closed check of that binding.
          options.assertExtensionPartitionPrepared(record)
          hardenExtensionWebPreferences(webPreferences, record, options.extensionPreloadPath)
          ;(params as Record<string, unknown>).partition = record.partition
        } catch (error) {
          if (record) options.sessions.dispose(record.sessionId)
          event.preventDefault()
          options.onDenied?.({
            code: error instanceof Error && 'code' in error
              ? String((error as { code: unknown }).code)
              : 'EXTENSION_WEBVIEW_ATTACH_DENIED'
          })
        }
        return
      }

      const parent = options.sessions.findByGuest(contents.id)
      if (parent?.externalWebviewHosts.length) {
        event.preventDefault()
        options.onDenied?.({ code: 'EXTENSION_NESTED_WEBVIEW_DENIED', url: src })
        return
      }

      if (!options.isAllowedDevPreviewUrl(src) && !options.isAuthorizedPrototypeFileUrl(src)) {
        event.preventDefault()
        return
      }
      delete webPreferences.preload
      delete (webPreferences as { preloadURL?: string }).preloadURL
      webPreferences.nodeIntegration = false
      webPreferences.contextIsolation = true
      webPreferences.sandbox = true
      webPreferences.webSecurity = true
      webPreferences.allowRunningInsecureContent = false
    })

    contents.on('did-attach-webview', (_event, guest) => {
      const record = options.sessions.bindNextGuest(contents.id, guest)
      if (record) {
        hardenAttachedExtensionGuest(guest, record, options)
        return
      }
      const external = options.sessions.bindNextExternalGuest(contents.id, guest)
      if (external) hardenAttachedExternalGuest(guest, external, options)
    })

    contents.on('will-navigate', (event, navigationUrl) => {
      if (contents.getType() !== 'webview') return
      const external = options.sessions.findExternalByGuest(contents.id)
      if (external) {
        if (!isAllowedExternalWebviewUrl(navigationUrl, external.allowedHosts)) {
          event.preventDefault()
        }
        return
      }
      const extension = options.sessions.findByGuest(contents.id)
      if (extension) {
        if (!isAllowedExtensionNavigation(navigationUrl, extension)) event.preventDefault()
        return
      }
      // Depending on Chromium event order, the initial navigation can be observed
      // before did-attach-webview binds the guest WebContents. Only the exact source
      // URL registered for this guest Session is allowed through that narrow gap.
      if (options.isPreparedExtensionNavigation(contents, navigationUrl)) return
      if (
        options.sessions.isPreparedExternalNavigation(
          contents.hostWebContents?.id ?? -1,
          navigationUrl
        )
      ) return
      if (!options.isAllowedDevPreviewUrl(navigationUrl)) event.preventDefault()
    })

    contents.setWindowOpenHandler(({ url }) => {
      if (contents.getType() !== 'webview') return { action: 'allow' }
      if (options.sessions.findByGuest(contents.id)) return { action: 'deny' }
      return options.isAllowedDevPreviewUrl(url) ? { action: 'allow' } : { action: 'deny' }
    })
  })
}

export function hardenExtensionWebPreferences(
  webPreferences: WebPreferences,
  record: ExtensionViewSessionRecord,
  preloadPath: string
): void {
  delete (webPreferences as { preloadURL?: string }).preloadURL
  delete (webPreferences as { enableRemoteModule?: boolean }).enableRemoteModule
  webPreferences.preload = preloadPath
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInWorker = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.webviewTag = false
  webPreferences.partition = record.partition
  webPreferences.additionalArguments = [
    `--kun-extension-view-session=${record.sessionId}`,
    `--kun-extension-view-nonce=${record.nonce}`
  ]
  webPreferences.navigateOnDragDrop = false
  webPreferences.safeDialogs = true
  webPreferences.disableDialogs = true
  webPreferences.autoplayPolicy = 'document-user-activation-required'
}

export function hardenExternalWebPreferences(
  webPreferences: WebPreferences,
  record: ExtensionExternalWebviewRecord
): void {
  delete webPreferences.preload
  delete (webPreferences as { preloadURL?: string }).preloadURL
  delete (webPreferences as { enableRemoteModule?: boolean }).enableRemoteModule
  webPreferences.nodeIntegration = false
  webPreferences.nodeIntegrationInWorker = false
  webPreferences.nodeIntegrationInSubFrames = false
  webPreferences.contextIsolation = true
  webPreferences.sandbox = true
  webPreferences.webSecurity = true
  webPreferences.allowRunningInsecureContent = false
  webPreferences.webviewTag = false
  webPreferences.partition = record.partition
  webPreferences.additionalArguments = []
  webPreferences.navigateOnDragDrop = false
  webPreferences.safeDialogs = true
  webPreferences.disableDialogs = true
  webPreferences.autoplayPolicy = 'document-user-activation-required'
}

export function isAllowedExternalWebviewSubresource(rawUrl: string): boolean {
  if (rawUrl.length === 0 || rawUrl.length > 32_768) return false
  try {
    return ['https:', 'wss:', 'data:', 'blob:'].includes(new URL(rawUrl).protocol)
  } catch {
    return false
  }
}

export function isAllowedExternalWebviewRequest(
  rawUrl: string,
  resourceType: string,
  record: Pick<ExtensionExternalWebviewRecord, 'allowedHosts'> | undefined,
  preparedInitialNavigation = false
): boolean {
  if (resourceType !== 'mainFrame') return isAllowedExternalWebviewSubresource(rawUrl)
  return preparedInitialNavigation || Boolean(
    record && isAllowedExternalWebviewUrl(rawUrl, record.allowedHosts)
  )
}

export function isAllowedExtensionNavigation(
  rawUrl: string,
  record: Pick<ExtensionViewSessionRecord, 'extensionId'>
): boolean {
  try {
    return parseKunExtensionUrl(rawUrl).extensionId === record.extensionId
  } catch {
    return false
  }
}

export function isAllowedExtensionSubresource(
  rawUrl: string,
  record: Pick<ExtensionViewSessionRecord, 'extensionId'>
): boolean {
  if (isAllowedExtensionNavigation(rawUrl, record)) return true
  try {
    // The isolated partition's kun-media handler remains the lease authority;
    // this outer Host filter only lets well-formed requests reach it.
    parseKunMediaUrl(rawUrl)
    return true
  } catch {
    return false
  }
}

function hardenAttachedExtensionGuest(
  guest: WebContents,
  record: ExtensionViewSessionRecord,
  options: WebviewSecurityOptions
): void {
  guest.setWindowOpenHandler(() => ({ action: 'deny' }))
  guest.on('will-navigate', (event, url) => {
    if (!isAllowedExtensionNavigation(url, record)) event.preventDefault()
  })
  guest.on('will-redirect', (event, url) => {
    if (!isAllowedExtensionNavigation(url, record)) event.preventDefault()
  })
  guest.on('render-process-gone', () => options.sessions.dispose(record.sessionId))

  const isolatedSession = guest.session
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setDevicePermissionHandler(() => false)
  isolatedSession.on('will-download', (event) => event.preventDefault())
  isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const allowed = isAllowedExtensionSubresource(details.url, record)
    callback({ cancel: !allowed })
  })
}

function hardenAttachedExternalGuest(
  guest: WebContents,
  record: ExtensionExternalWebviewRecord,
  options: WebviewSecurityOptions
): void {
  guest.setWindowOpenHandler(({ url }) => {
    if (isAllowedExternalWebviewUrl(url, record.allowedHosts) && !guest.isDestroyed()) {
      void guest.loadURL(url).catch(() => undefined)
    }
    return { action: 'deny' }
  })
  guest.on('will-navigate', (event, url) => {
    if (!isAllowedExternalWebviewUrl(url, record.allowedHosts)) event.preventDefault()
  })
  guest.on('will-redirect', (event, url) => {
    if (!isAllowedExternalWebviewUrl(url, record.allowedHosts)) event.preventDefault()
  })

  const isolatedSession = guest.session
  if (hardenedExternalSessions.has(isolatedSession)) return
  hardenedExternalSessions.add(isolatedSession)
  isolatedSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false))
  isolatedSession.setPermissionCheckHandler(() => false)
  isolatedSession.setDevicePermissionHandler(() => false)
  isolatedSession.on('will-download', (event) => event.preventDefault())
  isolatedSession.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const guestId = details.webContentsId ?? details.webContents?.id
    const active = guestId === undefined
      ? undefined
      : options.sessions.findExternalByGuest(guestId)
    const prepared = active === undefined && options.sessions.isPreparedExternalNavigation(
      details.webContents?.hostWebContents?.id ?? -1,
      details.url
    )
    callback({
      cancel: !isAllowedExternalWebviewRequest(
        details.url,
        details.resourceType,
        active,
        prepared
      )
    })
  })
}
