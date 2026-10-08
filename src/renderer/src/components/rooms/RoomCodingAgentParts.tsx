import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { AgentIcon } from '../agent-icon'

type Executor = NonNullable<AgentIdentity['executor']>

function credentialKey(executor: Executor): string {
  return executor.credentialMode === 'kun-gateway' ? 'directCodingAgentViaGateway'
    : executor.credentialMode === 'provider' ? 'directCodingAgentViaProvider' : 'directCodingAgentOwnSignIn'
}

/** Info-board card replacing the Kun main/fast model pair. */
export function CodingAgentEngineCard({ agent, model }: { agent: AgentIdentity; model?: string }): ReactElement {
  const { t } = useTranslation('common')
  const executor = agent.executor!
  return <div className="conversation-info-engine" data-engine={executor.harnessId}>
    <AgentIcon harnessId={executor.harnessId} size={20} />
    <span><strong>{model ?? executor.model}</strong>
      <small>{t(credentialKey(executor))} · {t('directCodingAgentBilledByEngine')}</small></span>
    <p>{t('directCodingAgentChipHelp')}</p>
  </div>
}
