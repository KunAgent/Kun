import type { ModelProviderModelGroup } from '@shared/kun-gui-api'

/** These profiles are whole external agents, not ModelClients for Kun's loop. */
export function isKunModelProviderGroup(group: Pick<ModelProviderModelGroup, 'kind'>): boolean {
  return group.kind !== 'agent-sdk' && group.kind !== 'cursor-sdk' && group.kind !== 'antigravity-cli'
}
