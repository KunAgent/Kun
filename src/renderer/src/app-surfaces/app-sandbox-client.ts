import type {
  AppSandboxClosedEvent,
  AppSandboxTheme,
  KunGuiAppSandboxApi
} from '@shared/app-sandbox'

type SandboxApi = KunGuiAppSandboxApi['appSandbox']
type MessageListener = (message: unknown) => void
type ClosedListener = (event: AppSandboxClosedEvent) => void

const messageListeners = new Map<string, Set<MessageListener>>()
const closedListeners = new Map<string, Set<ClosedListener>>()
let subscribed = false

export function appSandboxApi(): SandboxApi | null {
  if (typeof window === 'undefined') return null
  return (window.kunGui as Partial<KunGuiAppSandboxApi> | undefined)?.appSandbox ?? null
}

function ensureSubscribed(api: SandboxApi): void {
  if (subscribed) return
  subscribed = true
  api.onMessage((event) => {
    for (const listener of [...(messageListeners.get(event.instanceId) ?? [])]) listener(event.message)
  })
  api.onClosed((event) => {
    for (const listener of [...(closedListeners.get(event.instanceId) ?? [])]) listener(event)
  })
}

/** Route page messages for one instance; returns an unsubscribe function. */
export function subscribeAppSandbox(
  instanceId: string,
  onMessage: MessageListener,
  onClosed?: ClosedListener
): () => void {
  const api = appSandboxApi()
  if (!api) return () => undefined
  ensureSubscribed(api)
  const messages = messageListeners.get(instanceId) ?? new Set()
  messages.add(onMessage)
  messageListeners.set(instanceId, messages)
  if (onClosed) {
    const closed = closedListeners.get(instanceId) ?? new Set()
    closed.add(onClosed)
    closedListeners.set(instanceId, closed)
  }
  return () => {
    messages.delete(onMessage)
    if (messages.size === 0) messageListeners.delete(instanceId)
    if (onClosed) {
      const closed = closedListeners.get(instanceId)
      closed?.delete(onClosed)
      if (closed?.size === 0) closedListeners.delete(instanceId)
    }
  }
}

const THEME_TOKENS: Record<string, string> = {
  foreground: '--ds-text',
  card: '--ds-surface-card',
  muted: '--ds-surface-subtle',
  mutedForeground: '--ds-text-muted',
  accent: '--ds-accent',
  accentSoft: '--ds-accent-soft',
  border: '--ds-border',
  ring: '--ds-focus-ring',
  danger: '--ds-danger',
  success: '--ds-success',
  warning: '--ds-warning',
  surface: '--ds-bg-main'
}

/**
 * Resolve the effective Kun palette at an element (dark mode re-declares
 * tokens on the workbench shell, so the element's own computed style is the
 * only reliable source) into plain color values for the sandbox page.
 */
export function resolveAppSandboxTheme(element: Element | null, locale: string): AppSandboxTheme {
  const root = typeof document !== 'undefined' ? document.documentElement : null
  const dark = root?.dataset.theme === 'dark' || root?.classList.contains('dark') === true
  const colors: Record<string, string> = {}
  const style = element && typeof window !== 'undefined' ? window.getComputedStyle(element) : null
  for (const [key, token] of Object.entries(THEME_TOKENS)) {
    const value = style?.getPropertyValue(token).trim()
    if (value) colors[key] = value
  }
  return { mode: dark ? 'dark' : 'light', locale: locale.slice(0, 16) || 'en', colors }
}
