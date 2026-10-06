import { useTranslation } from 'react-i18next'
import { useHarnessStore, loadHarnessModels } from '../../store/harness-store'
import { checkHarnessUpdate, hasHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { useChatStore } from '../../store/chat-store'

export function AgentModelCatalogFooter({ harnessId, selectedModel }: { harnessId: string; selectedModel?: string }) {
  const { t } = useTranslation('common')
  const models = useHarnessStore((state) => state.models[harnessId])
  const update = useHarnessUpdateStore((state) => state.entries[harnessId])
  const status = models?.catalogStatus
  const missingModel = selectedModel && selectedModel !== 'default' && models?.models?.length &&
    (status?.source === 'native' || status?.source === 'cache') && !models.models.includes(selectedModel)
  // A failed lookup with no list is not a "reference catalog"; a failed
  // refresh over a list already shown keeps that list and says it is stale.
  const failedCode = status?.error?.code ?? models?.errorCode
  // A failed per-model detail lookup is not a catalog failure.
  const failed = !models?.loading && (Boolean(status?.error) || (Boolean(models?.error) && !models?.models.length))
  const sourceLabel = !status ? undefined
    : failed && !models?.models.length ? t('agentUpdate.catalog.failed')
      : failed ? t('agentUpdate.catalog.stale')
        : t(`agentUpdate.catalog.${status.source}`)
  const manage = () => { useHarnessStore.setState({ settingsHarnessId: harnessId }); useChatStore.getState().openSettings('agentsHarnesses') }
  // Refresh keeps the current list visible while the runtime re-probes; the
  // runtime itself serves the last good catalog if the new lookup fails.
  // "Check" stays in the menu; the new-version link opens Settings.
  return <div className="mt-1 border-t border-ds-border-muted px-2.5 py-2 text-[11px] text-ds-muted" data-agent-model-catalog
    data-agent-model-catalog-state={models?.loading ? 'loading' : failed ? 'failed' : 'ready'}>
    {sourceLabel ? <p className="mb-1 leading-4">{sourceLabel}{status?.version ? ` · v${status.version}` : ''}
      {status?.fetchedAt && !failed ? ` · ${new Date(status.fetchedAt).toLocaleTimeString()}` : ''}</p> : null}
    {failed ? <p className="mb-1 leading-4 text-orange-600" data-agent-model-catalog-error={failedCode ?? 'unavailable'}>
      {t(`agentUpdate.catalogError.${failedCode ?? 'unavailable'}`, { defaultValue: t('agentUpdate.catalogError.unavailable') })}
      {status?.error?.message ? <span className="block break-words text-ds-faint">{status.error.message}</span> : null}
    </p> : null}
    {hasHarnessUpdate(harnessId) ? <button type="button" className="mb-2 block text-left text-accent" onClick={manage}>{t('agentUpdate.modelHint')}</button> : null}
    {missingModel ? <p className="mb-2 text-orange-600">{t('agentUpdate.modelMissing')}</p> : null}
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      <button type="button" disabled={models?.loading} className="hover:text-ds-ink disabled:opacity-50" onClick={() => { void loadHarnessModels(harnessId, true) }}>{t('agentUpdate.refreshModels')}</button>
      <button type="button" disabled={update?.loading} className="hover:text-ds-ink disabled:opacity-50" onClick={() => { void checkHarnessUpdate(harnessId, true) }}>
        {update?.loading ? t('agentUpdate.checking') : t('agentUpdate.check')}
      </button>
    </div>
  </div>
}
