import { createHmac, randomBytes } from 'node:crypto'
import type { HarnessDefinition } from '../contracts/harness.js'
import type { NativeAgentNetworkPolicy, NativeAgentNetworkSnapshot } from '../contracts/native-agent-network.js'
import { withLoopbackProxyBypass } from '../runtime/agent-sdk/sdk-process-environment.js'

// Public catalog definitions never serialize proxy addresses or credentials.
const contextKey = Symbol('native-agent-network-context')
const policies = new WeakMap<object, { id: string; transport: string; policy: NativeAgentNetworkPolicy }>()
const fingerprintSalt = randomBytes(32)
const proxyKeys = new Set(['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY'])

function networkPolicy(definition: HarnessDefinition): NativeAgentNetworkPolicy | undefined {
  const context = (definition as HarnessDefinition & { [contextKey]?: object })[contextKey]
  const bound = context ? policies.get(context) : undefined
  return bound?.id === definition.id && bound.transport === definition.transport ? bound.policy : undefined
}

export function bindNativeAgentNetwork(
  definition: HarnessDefinition,
  snapshot: NativeAgentNetworkSnapshot | undefined
): HarnessDefinition {
  const policy = definition.id === 'codex' && definition.transport === 'codex-app-server'
    ? snapshot?.codex
    : definition.id === 'claude-code' && definition.transport === 'agent-sdk'
      ? snapshot?.['claude-code'] : undefined
  if (!policy) return definition
  // An opaque symbol survives internal object spreads; JSON and public schemas omit it.
  const context = {}
  const bound = { ...definition, [contextKey]: context }
  policies.set(context, { id: definition.id, transport: definition.transport, policy })
  return bound
}

export function hasNativeProxyEnvironment(env: Record<string, string | undefined>): boolean {
  return Object.keys(env).some((key) => proxyKeys.has(key.toUpperCase()) && env[key] !== undefined)
}

export function nativeAgentNetworkStatus(definition: HarnessDefinition, base: NodeJS.ProcessEnv = process.env) {
  const explicit = hasNativeProxyEnvironment({ ...base, ...definition.launch?.env }) ||
    definition.launch?.secretEnv?.some((entry) => proxyKeys.has(entry.name.toUpperCase()))
  const policy = networkPolicy(definition)
  const networkSource = explicit ? 'environment' as const : policy?.source ?? 'direct' as const
  const fingerprint = JSON.stringify({ launch: definition.launch, policy: explicit ? undefined : policy ?? { source: 'direct' },
    environment: Object.entries({ ...base, ...definition.launch?.env }).filter(([key]) =>
      proxyKeys.has(key.toUpperCase()) || key.toUpperCase() === 'NO_PROXY').sort(([a], [b]) => a.localeCompare(b)) })
  return { networkSource, networkFingerprint: createHmac('sha256', fingerprintSalt).update(fingerprint).digest('hex') }
}

/** Only fill absent native networking; deliberate process/launch env always wins. */
export function nativeAgentNetworkEnv(
  definition: HarnessDefinition | undefined,
  base: Record<string, string | undefined> = process.env,
  explicit: Record<string, string | undefined> = {}
): Record<string, string> {
  if (!definition || hasNativeProxyEnvironment({ ...base, ...definition.launch?.env, ...explicit })) return {}
  const policy = networkPolicy(definition)
  if (policy?.source === 'explicit-required') {
    throw new Error('Native Agent system proxy rules differ by destination or are unsupported. Configure explicit proxy environment variables and retry.')
  }
  if (policy?.source !== 'system') return {}
  const bypass = withLoopbackProxyBypass({ ...base, ...definition.launch?.env, ...explicit })
  return { HTTP_PROXY: policy.proxyUrl, HTTPS_PROXY: policy.proxyUrl,
    http_proxy: policy.proxyUrl, https_proxy: policy.proxyUrl,
    NO_PROXY: bypass.NO_PROXY!, no_proxy: bypass.no_proxy! }
}
