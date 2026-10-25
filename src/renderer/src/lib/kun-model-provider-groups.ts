import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

/** The Agent that runs whole turns for an agent-only provider kind. */
export function agentHarnessIdForProviderKind(kind: ModelProviderModelGroup['kind']): string | undefined {
  return kind === 'agent-sdk' ? 'claude-code'
    : kind === 'cursor-sdk' ? 'cursor'
      : kind === 'antigravity-cli' ? 'antigravity' : undefined
}

/** These profiles are whole external agents, not ModelClients for Kun's loop. */
export function isKunModelProviderGroup(group: Pick<ModelProviderModelGroup, 'kind'>): boolean {
  return agentHarnessIdForProviderKind(group.kind) === undefined
}
