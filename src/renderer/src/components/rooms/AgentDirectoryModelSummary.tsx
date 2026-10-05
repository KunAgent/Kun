import { useTranslation } from 'react-i18next'
import type { AgentModels } from './AgentModelSettings'
import { agentPath, modelBindingKey, useAgentResource } from './agent-client'

/** Deliberately unscoped: the manager displays role defaults, not conversation overrides. */
export function AgentDirectoryModelSummary({ agentId }: { agentId: string }) {
  const { t } = useTranslation('common')
  const state = useAgentResource<AgentModels>(agentPath(agentId) + '/models')
  const model = state.data?.main
  const provider = state.data?.options.find((item) => modelBindingKey(item) === modelBindingKey(model))
  if (state.error) return <div className="agent-directory-model-summary" role="alert"><small>{state.error}</small>
    <button type="button" onClick={state.refresh}>{t('directCreationModelsRefresh')}</button></div>
  return <div className="agent-directory-model-summary">
    <small>{t('directRoleDefaultModel')}</small>
    <span title={[provider?.providerLabel ?? model?.providerId, model?.accountId, model?.model].filter(Boolean).join(' / ')}>
      {state.data ? [provider?.providerLabel ?? model?.providerId, model?.accountId, model?.model].filter(Boolean).join(' / ') || t('directUnavailable') : t('roomsLoading')}
    </span>
    {state.data ? <small>{t(state.data.mainAvailable ? 'directConfigured' : 'directUnavailable')}</small> : null}
  </div>
}
