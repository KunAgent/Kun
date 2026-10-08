import { homedir } from 'node:os'
import { join } from 'node:path'
import { modelCatalogIdentity } from './model-catalog-store.js'
import { ProviderDiscoveryConfigurationError } from './provider-discovery-error.js'

/** Hash the CLI-owned account credential in memory; never persist the material itself. */
export async function nativeModelCatalogIdentity(kind: string, apiKey: string): Promise<string | undefined> {
  if (apiKey.trim()) return undefined // The protected Registry credential is already part of binding identity.
  if (kind === 'gemini-cli-api') {
    const { loadOfficialGeminiCliCredential } = await import('../adapters/model/gemini-cli-oauth.js')
    const credential = await loadOfficialGeminiCliCredential(process.env.KUN_GEMINI_CLI_OAUTH_PATH?.trim() || join(homedir(), '.gemini', 'oauth_creds.json'))
    const identity = credential?.refreshToken?.trim() || credential?.accessToken?.trim()
    if (!identity) throw new ProviderDiscoveryConfigurationError('Gemini CLI account is unavailable; sign in with the official CLI and refresh models.')
    return modelCatalogIdentity({ kind, identity })
  }
  if (kind === 'agent-sdk') {
    const { resolveClaudeToken } = await import('./provider-subscription-quota-credentials.js')
    const configDir = process.env.CLAUDE_CONFIG_DIR?.trim()
    const custom = configDir ? await import('node:fs/promises').then(({ readFile }) => readFile(join(configDir, '.credentials.json'), 'utf8')).then((text) => JSON.parse(text)).catch(() => null) : null
    const customToken = custom?.claudeAiOauth?.accessToken
    const identity = configDir ? typeof customToken === 'string' && /^sk-ant-oat[\w-]+$/u.test(customToken) ? customToken : undefined : await resolveClaudeToken({ id: 'native-claude-catalog', name: 'Claude', kind: 'agent-sdk', apiKey: '' })
    if (!identity) throw new ProviderDiscoveryConfigurationError('Claude account identity is unavailable; sign in or reconnect the subscription before refreshing models.')
    return modelCatalogIdentity({ kind, identity })
  }
  return undefined
}
