import type { ReactElement } from 'react'
import { KeyRound } from 'lucide-react'
import { credentialGroupFromKey } from '../../lib/ade-composer-harness'
import { ProviderIcon, type ProviderIconIdentity } from '../provider-icon'

/** Credential groups describe model access, independently of the selected Agent. */
export function ComposerModelSourceIcon({
  providerId, presetId, className
}: ProviderIconIdentity & { className?: string }): ReactElement {
  const credential = credentialGroupFromKey(providerId ?? undefined)
  if (credential?.mode === 'native-login') {
    return <KeyRound className={className} strokeWidth={1.8} aria-hidden data-model-source-icon="native-login" />
  }
  return <ProviderIcon providerId={credential?.providerId ?? providerId} presetId={presetId} className={className} />
}
