import { useMemo, useState } from 'react'
import type { ProviderConfigurationOperation, ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { exportProviderConfiguration } from '../lib/provider-configuration-client'
import { settingsButtonClass } from './settings-button'
import { providerSelectControlClass, textInputClass } from './settings-section-providers-controls'

type T = (key: string, options?: Record<string, unknown>) => string
export function providerAccountRows(snapshot: ProviderConfigurationSnapshot, search: string, groupId: string) {
  const query = search.trim().toLocaleLowerCase()
  return snapshot.connections.filter((connection) => {
    const group = snapshot.configuration.groups[snapshot.configuration.connections[connection.id]?.groupId ?? '']
    return (!groupId || groupId === (group?.id ?? 'ungrouped')) && (!query ||
      `${connection.id} ${connection.name} ${group?.name ?? ''} ${connection.presetSource ?? ''}`.toLocaleLowerCase().includes(query))
  })
}

export function ProviderAccountsWorkspace({ snapshot, selected, select, review, disabled, t }: {
  snapshot: ProviderConfigurationSnapshot; selected: string; select(id: string): void; disabled: boolean; t: T;
  review(operations: ProviderConfigurationOperation[]): void
}) {
  const [search, setSearch] = useState(''), [groupId, setGroupId] = useState(''), [page, setPage] = useState(0)
  const [error, setError] = useState(''), [copied, setCopied] = useState('')
  const rows = useMemo(() => providerAccountRows(snapshot, search, groupId), [snapshot, search, groupId])
  const pages = Math.max(1, Math.ceil(rows.length / 50)), current = Math.min(page, pages - 1)
  return <section className="space-y-2 rounded-lg border border-ds-border-muted p-3" aria-label={t('providerConfiguration.accountsWorkspace')}>
    <div className="grid gap-2 sm:grid-cols-2">
      <input aria-label={t('providerConfiguration.searchConnections')} placeholder={t('providerConfiguration.searchConnections')}
        className={textInputClass} value={search} onChange={(event) => { setSearch(event.target.value); setPage(0) }} />
      <select aria-label={t('providerConfiguration.groupFilter')} className={providerSelectControlClass} value={groupId}
        onChange={(event) => { setGroupId(event.target.value); setPage(0) }}>
        <option value="">{t('providerConfiguration.allGroups')}</option><option value="ungrouped">{t('providerConfiguration.noGroup')}</option>
        {Object.values(snapshot.configuration.groups).map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
      </select>
    </div>
    <div className="max-h-80 space-y-2 overflow-auto" data-provider-account-page>
      {rows.slice(current * 50, current * 50 + 50).map((connection) => {
        const config = snapshot.configuration.connections[connection.id]
        const group = snapshot.configuration.groups[config?.groupId ?? '']
        const enabled = config?.enabled !== false && group?.enabled !== false
        return <div key={connection.id} className="flex min-w-0 flex-wrap items-center gap-2 rounded-lg border border-ds-border-muted p-2">
          <button type="button" className="min-w-0 flex-1 text-left" aria-pressed={selected === connection.id} onClick={() => select(connection.id)}>
            <span className="block break-all font-medium">{connection.name}</span>
            <span className="block break-all text-[11px] text-ds-muted">{group?.name ?? t('providerConfiguration.noGroup')} · {connection.id} · {connection.credentialStatus}</span>
            <span className="block text-[11px] text-ds-muted">{config?.migrationOrigin
              ? t('providerConfiguration.migrationOrigin', { version: config.migrationOrigin.schemaVersion })
              : config?.template ? t('providerConfiguration.templateOrigin', { name: config.template.name, version: config.template.revision })
                : connection.presetSource ?? t('providerConfiguration.customOrigin')}</span>
          </button>
          <button type="button" className={settingsButtonClass()} disabled={disabled || group?.enabled === false}
            onClick={() => review([{ kind: 'configure-connection', connectionId: connection.id,
              configuration: { ...(config ?? { inherit: [], manualModels: [] }), enabled: !enabled } }])}>{t(enabled ? 'providerConfiguration.pauseAccount' : 'providerConfiguration.enableAccount')}</button>
          <button type="button" className={settingsButtonClass()} disabled={disabled} onClick={() => void (async () => {
            setError(''); setCopied('')
            try {
              const document = await exportProviderConfiguration({ connectionIds: [connection.id], routeIds: [] })
              await navigator.clipboard.writeText(JSON.stringify(document, null, 2))
              setCopied(connection.id)
            } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
          })()}>{t(copied === connection.id ? 'providerConfiguration.copiedConfig' : 'providerConfiguration.copyConfig')}</button>
        </div>
      })}
    </div>
    <nav className="flex items-center gap-2" aria-label={t('providerConfiguration.accountPages')}>
      <button type="button" className={settingsButtonClass()} disabled={current === 0} onClick={() => setPage(current - 1)} aria-label={t('providerConfiguration.previousPage')}>←</button>
      <span aria-live="polite">{current + 1} / {pages} · {rows.length}</span>
      <button type="button" className={settingsButtonClass()} disabled={current + 1 >= pages} onClick={() => setPage(current + 1)} aria-label={t('providerConfiguration.nextPage')}>→</button>
    </nav>
    {error ? <p role="alert" className="text-red-600 dark:text-red-400">{error}</p> : null}
  </section>
}
