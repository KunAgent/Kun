export const KUN_GMAIL_LOCAL_PROVIDER_ID = 'kun-gmail-local'
const NATIVE_GMAIL_TOOLS = new Set(['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send'])
const restrictedContexts = new WeakSet<object>()

/** Exact native tools; an MCP provider using a similar name is not eligible. */
export function isNativeGmailTool(tool: { name: string; providerId?: string; providerKind?: string }): boolean {
  return tool.providerId === 'gmail' && tool.providerKind === 'built-in' && NATIVE_GMAIL_TOOLS.has(tool.name)
}

export function isLocalGmailActingProvider(context?: {
  actingModelRoute?: { providerId?: string }; modelProviderId?: string
}): boolean {
  return (context?.actingModelRoute?.providerId ?? context?.modelProviderId) === KUN_GMAIL_LOCAL_PROVIDER_ID
}

export function isNativeGmailToolName(name: string): boolean { return NATIVE_GMAIL_TOOLS.has(name) }

/** Only canonical host policy may classify a context; no serializable flag grants this authority. */
export function restrictGmailToolContext<T extends object>(context: T): T {
  const restricted = Object.freeze({ ...context }) as T
  restrictedContexts.add(restricted)
  return restricted
}

export function isGmailRestrictedToolContext(context?: {
  actingModelRoute?: { providerId?: string }; modelProviderId?: string
}): boolean {
  return Boolean(context && restrictedContexts.has(context)) || isLocalGmailActingProvider(context)
}
