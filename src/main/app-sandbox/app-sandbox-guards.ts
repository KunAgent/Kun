import type { WebContents, WebPreferences } from 'electron'
import {
  APP_SANDBOX_INSTANCE_ARGUMENT,
  APP_SANDBOX_NONCE_ARGUMENT,
  APP_SANDBOX_SCHEME,
  parseAppSandboxUrl
} from '../../shared/app-sandbox'
import type { AppSandboxRecord, AppSandboxRegistry } from './app-sandbox-registry'

export type AppSandboxWebviewGuard = {
  /** Handle `will-attach-webview` for a `kun-app:` source; returns false to deny. */
  prepareAttach(host: WebContents, src: string, webPreferences: WebPreferences, params: Record<string, unknown>): boolean
  /** Bind hardening to a freshly attached guest when it belongs to a sandbox. */
  didAttach(host: WebContents, guest: WebContents): boolean
  /** Undefined when the navigation is not a sandbox navigation. */
  isAllowedNavigation(contents: WebContents, url: string): boolean | undefined
}

export const APP_SANDBOX_INPUT_TYPES = new Set([
  'mouseDown', 'mouseUp', 'keyDown', 'rawKeyDown', 'char', 'touchStart', 'gestureTap', 'pointerDown'
])

export function isAppSandboxSource(src: string): boolean {
  return src.startsWith(`${APP_SANDBOX_SCHEME}:`)
}

function recordForShell(registry: AppSandboxRegistry, src: string): AppSandboxRecord | undefined {
  const parsed = parseAppSandboxUrl(src)
  if (!parsed || parsed.kind !== 'shell') return undefined
  const record = registry.get(parsed.instanceId)
  return record && record.shellUrl === src ? record : undefined
}

export function hardenAppSandboxWebPreferences(
  webPreferences: WebPreferences,
  record: AppSandboxRecord,
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
  webPreferences.plugins = false
  webPreferences.partition = record.partition
  webPreferences.additionalArguments = [
    `${APP_SANDBOX_INSTANCE_ARGUMENT}${record.instanceId}`,
    `${APP_SANDBOX_NONCE_ARGUMENT}${record.nonce}`
  ]
  webPreferences.navigateOnDragDrop = false
  webPreferences.safeDialogs = true
  webPreferences.disableDialogs = true
  webPreferences.autoplayPolicy = 'document-user-activation-required'
}

export function createAppSandboxWebviewGuard(options: {
  registry: AppSandboxRegistry
  preloadPath: string
  isTrustedWorkbench(contents: WebContents): boolean
  onGuestGone(instanceId: string, reason: 'crashed' | 'navigation'): void
  onDenied?(detail: { code: string }): void
}): AppSandboxWebviewGuard {
  const pendingByHost = new Map<number, string[]>()
  const guestInstances = new Map<number, string>()

  return {
    prepareAttach(host, src, webPreferences, params) {
      const record = options.isTrustedWorkbench(host) ? recordForShell(options.registry, src) : undefined
      if (!record || record.ownerWebContentsId !== host.id || record.guestWebContentsId !== undefined) {
        options.onDenied?.({ code: 'APP_SANDBOX_ATTACH_DENIED' })
        return false
      }
      hardenAppSandboxWebPreferences(webPreferences, record, options.preloadPath)
      params.partition = record.partition
      delete params.allowpopups
      delete params.preload
      delete params.nodeintegration
      delete params.nodeintegrationinsubframes
      delete params.disablewebsecurity
      delete params.webpreferences
      const queue = pendingByHost.get(host.id) ?? []
      queue.push(record.instanceId)
      pendingByHost.set(host.id, queue)
      return true
    },

    didAttach(host, guest) {
      const queue = pendingByHost.get(host.id)
      const instanceId = queue?.shift()
      if (queue && queue.length === 0) pendingByHost.delete(host.id)
      if (!instanceId) return false
      const record = options.registry.get(instanceId)
      if (!record) return false
      guestInstances.set(guest.id, instanceId)
      guest.setWindowOpenHandler(() => ({ action: 'deny' }))
      guest.on('will-redirect', (event, url) => {
        if (url !== record.shellUrl) event.preventDefault()
      })
      guest.on('will-frame-navigate', (event) => {
        const frame = event.frame
        if (!frame || frame.parent !== guest.mainFrame) return
        if (event.url !== record.guestUrl) event.preventDefault()
      })
      guest.on('input-event', (_event, input) => {
        if (APP_SANDBOX_INPUT_TYPES.has(input.type)) options.registry.recordGesture(guest.id)
      })
      guest.on('render-process-gone', () => options.onGuestGone(instanceId, 'crashed'))
      guest.once('destroyed', () => guestInstances.delete(guest.id))
      return true
    },

    isAllowedNavigation(contents, url) {
      const instanceId = guestInstances.get(contents.id)
      if (instanceId) {
        const record = options.registry.get(instanceId)
        const allowed = Boolean(record && url === record.shellUrl)
        if (!allowed) options.onGuestGone(instanceId, 'navigation')
        return allowed
      }
      if (!isAppSandboxSource(url)) return undefined
      const record = recordForShell(options.registry, url)
      const host = contents.hostWebContents
      return Boolean(record && host && record.ownerWebContentsId === host.id)
    }
  }
}
