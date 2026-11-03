import type { ReactElement } from 'react'
import { UserRound } from 'lucide-react'
import { credentialGroupFromKey } from '../../lib/ade-composer-harness'
import { AgentIcon } from '../agent-icon'
import { ProviderIcon, type ProviderIconIdentity } from '../provider-icon'

/**
 * Where a group's models come from: the Agent's own sign-in shows that
 * Agent's mark, a native login supplied by a Kun provider shows the
 * provider, every other credential path shows its provider.
 */
export function ComposerModelSourceIcon({
  providerId, presetId, agentId, size = 14, className
}: ProviderIconIdentity & { agentId?: string; size?: number; className?: string }): ReactElement {
  const credential = credentialGroupFromKey(providerId ?? undefined)
  if (credential?.mode === 'native-login' && !credential.providerId) {
    return agentId
      ? <span className={`inline-flex items-center justify-center ${className ?? ''}`} data-model-source-icon="agent-account"><AgentIcon harnessId={agentId} size={size} /></span>
      : <UserRound className={className} strokeWidth={1.8} aria-hidden data-model-source-icon="native-login" />
  }
  return <ProviderIcon providerId={credential?.providerId ?? providerId} presetId={presetId} className={className} />
}
