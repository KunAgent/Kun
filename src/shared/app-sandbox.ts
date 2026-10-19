/**
 * App sandbox: the isolated webview host shared by Gen UI widgets and MCP App
 * pages. A webview loads a Kun-owned shell document; the shell embeds the
 * untrusted page in an iframe of a different origin and the shell preload
 * relays raw JSON-RPC between that iframe and the workbench renderer through
 * Electron Main. Pages never receive the workbench bridge or runtime tokens.
 */

export const APP_SANDBOX_SCHEME = 'kun-app'
export const APP_SANDBOX_GEN_UI_PARTITION = 'kun-app-genui'
export const APP_SANDBOX_MAX_INSTANCES = 48
/** Upper bound for one relayed JSON-RPC message (UTF-8 bytes of its JSON form). */
export const APP_SANDBOX_MAX_MESSAGE_BYTES = 8 * 1024 * 1024
/** A native user gesture inside the page authorizes one sensitive action for this long. */
export const APP_SANDBOX_GESTURE_WINDOW_MS = 5_000

export const APP_SANDBOX_CHANNELS = {
  createGenUi: 'app-sandbox:create-gen-ui',
  createMcpApp: 'app-sandbox:create-mcp-app',
  dispose: 'app-sandbox:dispose',
  post: 'app-sandbox:post',
  consumeGesture: 'app-sandbox:consume-gesture',
  openExternal: 'app-sandbox:open-external',
  capture: 'app-sandbox:capture',
  saveFile: 'app-sandbox:save-file',
  /** Main -> workbench renderer: a message from a page. */
  message: 'app-sandbox:message',
  /** Main -> workbench renderer: the page process ended or was revoked. */
  closed: 'app-sandbox:closed',
  /** Shell preload -> Main: bind this guest to its instance. */
  guestHello: 'app-sandbox:guest-hello',
  /** Shell preload -> Main: a message posted by the page. */
  guestMessage: 'app-sandbox:guest-message',
  /** Main -> shell preload: a message for the page. */
  hostMessage: 'app-sandbox:host-message'
} as const

export const APP_SANDBOX_INSTANCE_ARGUMENT = '--kun-app-sandbox-instance='
export const APP_SANDBOX_NONCE_ARGUMENT = '--kun-app-sandbox-nonce='

export type AppSandboxKind = 'gen-ui' | 'mcp-app'

/** Resolved theme colors handed to pages; values are plain CSS color strings. */
export type AppSandboxTheme = {
  mode: 'light' | 'dark'
  locale: string
  colors: Record<string, string>
}

export type AppSandboxCreateGenUiRequest = {
  threadId: string
  widgetId: string
  theme: AppSandboxTheme
}

export type AppSandboxCreateMcpAppRequest = {
  threadId: string
  serverId: string
  resourceUri: string
  theme: AppSandboxTheme
}

export type AppSandboxInstanceInfo = {
  instanceId: string
  kind: AppSandboxKind
  src: string
  partition: string
  prefersBorder?: boolean
}

export type AppSandboxCreateResult =
  | { ok: true; instance: AppSandboxInstanceInfo }
  | { ok: false; code: string; message: string }

export type AppSandboxFile = {
  name: string
  mimeType: string
  base64: string
}

export type AppSandboxMessageEvent = {
  instanceId: string
  message: unknown
}

export type AppSandboxClosedEvent = {
  instanceId: string
  reason: 'crashed' | 'disposed' | 'navigation'
}

export type KunGuiAppSandboxApi = {
  appSandbox: {
    createGenUi: (request: AppSandboxCreateGenUiRequest) => Promise<AppSandboxCreateResult>
    createMcpApp: (request: AppSandboxCreateMcpAppRequest) => Promise<AppSandboxCreateResult>
    dispose: (instanceId: string) => Promise<void>
    post: (instanceId: string, message: unknown) => Promise<boolean>
    consumeGesture: (instanceId: string) => Promise<boolean>
    openExternal: (instanceId: string, url: string) => Promise<boolean>
    capture: (instanceId: string) => Promise<string | null>
    /** Save page-provided bytes through the native save dialog. */
    saveFile: (instanceId: string, file: AppSandboxFile) => Promise<boolean>
    onMessage: (handler: (event: AppSandboxMessageEvent) => void) => () => void
    onClosed: (handler: (event: AppSandboxClosedEvent) => void) => () => void
  }
}

const INSTANCE_ID_PATTERN = /^[a-f0-9]{32}$/
const SERVER_HOST_PATTERN = /^[a-f0-9]{16}$/

export function isAppSandboxInstanceId(value: unknown): value is string {
  return typeof value === 'string' && INSTANCE_ID_PATTERN.test(value)
}

export function appSandboxShellUrl(instanceId: string): string {
  return `${APP_SANDBOX_SCHEME}://shell-${instanceId}/`
}

export function appSandboxGenUiGuestUrl(instanceId: string): string {
  return `${APP_SANDBOX_SCHEME}://genui-${instanceId}/index.html`
}

/** MCP App pages of one server share an origin so their browser storage persists. */
export function appSandboxMcpGuestUrl(serverHost: string, instanceId: string): string {
  return `${APP_SANDBOX_SCHEME}://app-${serverHost}/i/${instanceId}/index.html`
}

export function appSandboxMcpPartition(serverHost: string): string {
  return `persist:kun-app-${serverHost}`
}

export type ParsedAppSandboxUrl =
  | { kind: 'shell'; instanceId: string; path: string }
  | { kind: 'gen-ui'; instanceId: string; path: string }
  | { kind: 'mcp-app'; serverHost: string; instanceId: string; path: string }

/** Parse a `kun-app://` URL; the path is decoded and never contains `..`. */
export function parseAppSandboxUrl(rawUrl: string): ParsedAppSandboxUrl | null {
  let url: URL
  try {
    url = new URL(rawUrl)
  } catch {
    return null
  }
  if (url.protocol !== `${APP_SANDBOX_SCHEME}:`) return null
  const host = url.hostname.toLowerCase()
  let path: string
  try {
    path = decodeURIComponent(url.pathname)
  } catch {
    return null
  }
  if (path.split('/').some((segment) => segment === '..') || /[\\\0]/.test(path)) return null
  if (host.startsWith('shell-')) {
    const instanceId = host.slice('shell-'.length)
    return INSTANCE_ID_PATTERN.test(instanceId) ? { kind: 'shell', instanceId, path } : null
  }
  if (host.startsWith('genui-')) {
    const instanceId = host.slice('genui-'.length)
    return INSTANCE_ID_PATTERN.test(instanceId) ? { kind: 'gen-ui', instanceId, path } : null
  }
  if (host.startsWith('app-')) {
    const serverHost = host.slice('app-'.length)
    const match = /^\/i\/([a-f0-9]{32})(\/.*)$/.exec(path)
    if (!SERVER_HOST_PATTERN.test(serverHost) || !match) return null
    return { kind: 'mcp-app', serverHost, instanceId: match[1]!, path: match[2]! }
  }
  return null
}

export function appSandboxOrigin(rawUrl: string): string | null {
  try {
    const url = new URL(rawUrl)
    return `${url.protocol}//${url.host}`
  } catch {
    return null
  }
}
