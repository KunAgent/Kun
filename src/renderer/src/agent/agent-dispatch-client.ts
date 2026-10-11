import {
  AgentDispatchIntentPublicSchema,
  agentDispatchPath,
  type AgentDispatchAction,
  type AgentDispatchIntentView
} from '@shared/agent-dispatch'
import { rendererRuntimeClient } from './runtime-client'
import { readRuntimeError, readRuntimeJson } from './kun-runtime-services'
import { runtimeErrorToError } from '@shared/runtime-error'

export const agentDispatchClient = {
  async get(intentId: string): Promise<AgentDispatchIntentView> {
    const response = await rendererRuntimeClient.runtimeRequest(agentDispatchPath(intentId), 'GET')
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to load Agent task'))
    return AgentDispatchIntentPublicSchema.parse(readRuntimeJson<{ intent: unknown }>(response.body, 'Invalid Agent task').intent)
  },
  async act(intent: Pick<AgentDispatchIntentView, 'intentId' | 'revision'>, action: AgentDispatchAction,
    changes?: { recommendation?: Partial<AgentDispatchIntentView['recommendation']> },
    requestId = crypto.randomUUID()): Promise<AgentDispatchIntentView> {
    const response = await rendererRuntimeClient.runtimeRequest(`${agentDispatchPath(intent.intentId)}/actions`, 'POST',
      JSON.stringify({ action, expectedRevision: intent.revision, requestId, ...changes }))
    if (!response.ok) throw runtimeErrorToError(readRuntimeError(response.body, 'Failed to update Agent task'))
    return AgentDispatchIntentPublicSchema.parse(readRuntimeJson<{ intent: unknown }>(response.body, 'Invalid Agent task').intent)
  }
}

const MAX_CACHED_INTENTS = 200
const cache = new Map<string, AgentDispatchIntentView>()
const listeners = new Set<() => void>()

export function publishAgentDispatchIntent(value: unknown): AgentDispatchIntentView | undefined {
  const result = AgentDispatchIntentPublicSchema.safeParse(value)
  if (!result.success) return undefined
  const intent = result.data
  const existing = cache.get(intent.intentId)
  if (existing && existing.revision >= intent.revision) return existing
  cache.delete(intent.intentId)
  cache.set(intent.intentId, intent)
  if (cache.size > MAX_CACHED_INTENTS) cache.delete(cache.keys().next().value!)
  for (const listener of listeners) listener()
  return intent
}

export const agentDispatchCache = {
  get: (id: string): AgentDispatchIntentView | undefined => cache.get(id),
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
  }
}
