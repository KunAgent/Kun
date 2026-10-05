import { useTranslation } from 'react-i18next'
import { useHarnessStore, invalidateHarnessModels, loadHarnessModels } from '../../store/harness-store'
import { checkHarnessUpdate, hasHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { useChatStore } from '../../store/chat-store'

export function AgentModelCatalogFooter({ harnessId, selectedModel }: { harnessId: string; selectedModel?: string }) {
  const { t } = useTranslation('common')
  const models = useHarnessStore((state) => state.models[harnessId])
  const update = useHarnessUpdateStore((state) => state.entries[harnessId])
  const status = models?.catalogStatus
  const missingModel = selectedModel && selectedModel !== 'default' && models?.models?.length &&
    (status?.source === 'native' || status?.source === 'cache') && !models.models.includes(selectedModel)
  const manage = () => { useHarnessStore.setState({ settingsHarnessId: harnessId }); useChatStore.getState().openSettings('agentsHarnesses') }
  return <div className="mt-1 border-t border-ds-border-muted px-2.5 py-2 text-[11px] text-ds-muted" data-agent-model-catalog>
    {status ? <p className="mb-1 leading-4">{t(`agentUpdate.catalog.${status.source}`)}{status.version ? ` · v${status.version}` : ''}
      {status.fetchedAt ? ` · ${new Date(status.fetchedAt).toLocaleTimeString()}` : ''}</p> : null}
    {hasHarnessUpdate(harnessId) ? <button type="button" className="mb-2 block text-left text-accent" onClick={manage}>{t('agentUpdate.modelHint')}</button> : null}
    {missingModel ? <p className="mb-2 text-orange-600">{t('agentUpdate.modelMissing')}</p> : null}
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <button type="button" disabled={models?.loading} className="hover:text-ds-ink disabled:opacity-50" onClick={() => { invalidateHarnessModels(harnessId); void loadHarnessModels(harnessId, true) }}>{t('agentUpdate.refreshModels')}</button>
      <button type="button" disabled={update?.loading} className="hover:text-ds-ink disabled:opacity-50" onClick={() => { void checkHarnessUpdate(harnessId, true); manage() }}>{t('agentUpdate.check')}</button>
    </div>
  </div>
}
