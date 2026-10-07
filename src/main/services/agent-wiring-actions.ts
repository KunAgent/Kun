import type { AgentWiringAction } from '../../shared/agent-wiring'

const AGENT_ID = /^[a-z0-9][a-z0-9-]{0,63}$/
const MODEL_ID = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0 && value.length <= 512 &&
  ![...value].some((char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)

export function parseAgentWiringAction(input: unknown): AgentWiringAction {
  if (!input || typeof input !== 'object') throw new Error('Invalid agent action')
  const request = input as Record<string, unknown>
  switch (request.action) {
    case 'list':
    case 'sync':
      return { action: request.action }
    case 'disconnect':
    case 'copy-key':
      if (typeof request.agentId !== 'string' || !AGENT_ID.test(request.agentId)) throw new Error('Invalid agent')
      return { action: request.action, agentId: request.agentId }
    case 'connect':
    case 'preview': {
      if (typeof request.agentId !== 'string' || !AGENT_ID.test(request.agentId) || !MODEL_ID(request.model)) throw new Error('Invalid agent connection')
      if (request.smallModel !== undefined && !MODEL_ID(request.smallModel)) throw new Error('Invalid small model')
      if (request.effort !== undefined && (typeof request.effort !== 'string' || !/^[a-z]{1,16}$/.test(request.effort))) throw new Error('Invalid effort')
      return { action: request.action, agentId: request.agentId, model: request.model,
        ...(request.smallModel ? { smallModel: request.smallModel as string } : {}), ...(request.effort ? { effort: request.effort as string } : {}) }
    }
    case 'save-profile':
    case 'apply-profile':
    case 'delete-profile':
      if (typeof request.name !== 'string' || !request.name.trim() || request.name.length > 48) throw new Error('Invalid profile name')
      return { action: request.action, name: request.name.trim() }
    default:
      throw new Error('Invalid agent action')
  }
}
