import { z } from 'zod'

export const NATIVE_AGENT_NETWORK_ENV = 'KUN_NATIVE_AGENT_NETWORK_SNAPSHOT'
export const NativeAgentNetworkPolicy = z.discriminatedUnion('source', [
  z.object({ source: z.literal('system'), proxyUrl: z.string().url().max(4096).refine((value) => {
    const url = new URL(value)
    return ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
      url.pathname === '/' && !url.search && !url.hash
  }) }).strict(),
  z.object({ source: z.literal('direct') }).strict(),
  z.object({ source: z.literal('explicit-required') }).strict()
])

/** Desktop-owned transient network policy; never part of persisted KunConfig. */
export const NativeAgentNetworkSnapshot = z.object({
  harnesses: z.record(z.string().regex(/^[a-z][a-z0-9-]{1,47}$/), NativeAgentNetworkPolicy).optional(),
  installer: NativeAgentNetworkPolicy.optional(),
  codex: NativeAgentNetworkPolicy.optional(),
  antigravity: NativeAgentNetworkPolicy.optional(),
  'claude-code': NativeAgentNetworkPolicy.optional()
}).strict()
export type NativeAgentNetworkSnapshot = z.infer<typeof NativeAgentNetworkSnapshot>
export type NativeAgentNetworkPolicy = z.infer<typeof NativeAgentNetworkPolicy>

export function consumeNativeAgentNetworkEnvironment(env: NodeJS.ProcessEnv): NativeAgentNetworkSnapshot | undefined {
  const raw = env[NATIVE_AGENT_NETWORK_ENV]
  delete env[NATIVE_AGENT_NETWORK_ENV]
  if (!raw) return undefined
  try { return NativeAgentNetworkSnapshot.parse(JSON.parse(raw)) } catch {
    throw new Error('Invalid native Agent network launch policy')
  }
}
