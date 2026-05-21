import type { AgentProvider, AgentProviderId } from './types'
import { DeepseekRuntimeProvider } from './deepseek-runtime'

export function getProvider(_id: AgentProviderId): AgentProvider {
  return new DeepseekRuntimeProvider()
}
