import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentIdentity } from '@shared/rooms-api'
import { AgentIcon } from '../agent-icon'

type Executor = NonNullable<AgentIdentity['executor']>

function credentialKey(executor: Executor): string {
  return executor.credentialMode === 'kun-gateway' ? 'directCodingAgentViaGateway'
    : executor.credentialMode === 'provider' ? 'directCodingAgentViaProvider' : 'directCodingAgentOwnSignIn'
}

/** Composer slot for a coding Agent chat: its engine route is fixed, so this is a label, not a picker. */
export function RoomCodingAgentChip({ agent }: { agent: AgentIdentity }): ReactElement {
  const { t } = useTranslation('common')
  const executor = agent.executor!
  return <div className="direct-composer-model-picker direct-coding-agent-chip" data-engine={executor.harnessId}
    title={t('directCodingAgentChipHelp')}>
    <span><AgentIcon harnessId={executor.harnessId} size={14} /><strong>{executor.model}</strong>
      <small>{t(credentialKey(executor))}</small></span>
    <small>{t('directCodingAgentChipHelp')}</small>
  </div>
}

/** Info-board card replacing the Kun main/fast model pair. */
export function CodingAgentEngineCard({ agent }: { agent: AgentIdentity }): ReactElement {
  const { t } = useTranslation('common')
  const executor = agent.executor!
  return <div className="conversation-info-engine" data-engine={executor.harnessId}>
    <AgentIcon harnessId={executor.harnessId} size={20} />
    <span><strong>{executor.model}</strong>
      <small>{t(credentialKey(executor))} · {t('directCodingAgentBilledByEngine')}</small></span>
    <p>{t('directCodingAgentChipHelp')}</p>
  </div>
}
