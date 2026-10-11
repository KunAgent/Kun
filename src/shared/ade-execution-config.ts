import type { HarnessGatewayBinding } from '../../kun/src/contracts/harness-gateway-binding.js'
export type AdeExecutionConfigOrigin = 'global' | 'project' | 'task'

export type AdeExecutionConfigSnapshot = {
  version: 1
  revision: string
  projectKey?: string
  route: {
    gatewayBinding?: HarnessGatewayBinding
    model: string
    providerId?: string
    harnessId?: string
    credentialMode?: 'native-login' | 'provider' | 'kun-gateway'
  }
  collaborationEnabled: boolean
  managerModel?: { providerId: string; model: string }
  limits: { softWorkers: number; hardWorkers: number }
  budget?: { softTokens?: number; hardTokens?: number }
  isolation: 'worktree' | 'local' | 'directory'
  origins: Record<'route' | 'collaborationEnabled' | 'managerModel' | 'limits' | 'budget' | 'isolation', AdeExecutionConfigOrigin>
  resolvedAt: string
}
