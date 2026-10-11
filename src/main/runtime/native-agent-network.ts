import {
  NATIVE_AGENT_NETWORK_ENV,
  NativeAgentNetworkSnapshot,
  type NativeAgentNetworkPolicy
} from '../../../kun/src/contracts/native-agent-network.js'
import { electronProxyRuleUrl, electronSystemProxyRules } from '../electron-system-proxy'
import { NATIVE_CLI_DESTINATIONS } from '../../../kun/src/contracts/native-agent-destinations.js'

const destinations = {
  installer: ['https://registry.npmjs.org/', 'https://github.com/', 'https://cli.devin.ai/install.sh',
    'https://static.devin.ai/', 'https://opencode.ai/install', 'https://claude.ai/install.sh',
    'https://formulae.brew.sh/', 'https://ghcr.io/', 'https://antigravity.google/cli/install.sh', 'https://storage.googleapis.com/'],
  codex: ['https://chatgpt.com/backend-api/codex/responses', 'https://api.openai.com/v1/responses'],
  antigravity: ['https://daily-cloudcode-pa.googleapis.com/', 'https://cloudcode-pa.googleapis.com/', 'https://oauth2.googleapis.com/'],
  'claude-code': ['https://api.anthropic.com/v1/messages']
} as const

/** URL-specific PAC decisions may only be collapsed when every known destination agrees. */
export async function resolveNativeAgentNetworkSnapshot(
  resolveRules: (url: string) => Promise<string> = electronSystemProxyRules
): Promise<NativeAgentNetworkSnapshot> {
  const result: NativeAgentNetworkSnapshot = {}
  const policies = await Promise.all(Object.entries({ ...destinations, ...NATIVE_CLI_DESTINATIONS }).map(async ([id, urls]) => {
    let policy: NativeAgentNetworkPolicy
    try {
      const choices = await Promise.all(urls.map(async (url) => {
        const first = (await resolveRules(url)).split(';')[0]?.trim() ?? ''
        if (first.toUpperCase() === 'DIRECT') return ''
        const [kind = '', target = ''] = first.split(/\s+/, 2)
        const proxyUrl = electronProxyRuleUrl(kind, target)
        const parsed = NativeAgentNetworkSnapshot.safeParse({ codex: { source: 'system', proxyUrl } })
        if (!parsed.success) throw new Error('Unsupported native Agent proxy policy')
        return proxyUrl
      }))
      policy = choices.some((choice) => choice !== choices[0])
        ? { source: 'explicit-required' }
        : choices[0] ? { source: 'system', proxyUrl: choices[0] } : { source: 'direct' }
    } catch {
      policy = { source: 'explicit-required' }
    }
    return { id, policy }
  }))
  result.harnesses = {}
  for (const { id, policy } of policies) {
    if (id in destinations) result[id as keyof typeof destinations] = policy
    else result.harnesses[id] = policy
  }
  return result
}

export async function nativeAgentNetworkLaunchEnvironment(): Promise<NodeJS.ProcessEnv> {
  return { [NATIVE_AGENT_NETWORK_ENV]: JSON.stringify(await resolveNativeAgentNetworkSnapshot()) }
}

/** Explicit refresh shares the owned runtime endpoint; no proxy values reach its caller. */
export async function refreshNativeAgentNetworkBeforeProbe(
  path: string,
  method: string,
  send: (body: string) => Promise<{ ok: boolean; status: number }>
): Promise<void> {
  if (method !== 'POST' || !/^\/v1\/harnesses\/[^/]+\/(?:probe|test|install|updates\/(?:check|start|activate|rollback))(?:\?|$)/u.test(path)) return
  // Test/old hosts without an Electron session have no desktop policy to refresh.
  const snapshot = await resolveNativeAgentNetworkSnapshot()
  const result = await send(JSON.stringify({ nativeAgentNetwork: snapshot }))
  if (result.status === 404 || result.status === 405) return
  if (!result.ok) throw new Error('Native Agent network policy could not be refreshed. Retry the connection check.')
}
