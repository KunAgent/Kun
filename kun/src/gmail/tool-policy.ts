export const KUN_GMAIL_LOCAL_PROVIDER_ID = 'kun-gmail-local'
const NATIVE_GMAIL_TOOLS = new Set(['gmail_connect', 'gmail_search', 'gmail_read', 'gmail_send'])

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
