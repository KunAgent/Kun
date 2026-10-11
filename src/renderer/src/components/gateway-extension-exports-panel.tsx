import type { TFunction } from 'i18next'
import { Puzzle } from 'lucide-react'
import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { ModelProviderSettingsV1 } from '@shared/app-settings'

type ExportableProvider = {
  providerId: string
  extensionId: string
  displayName: string
  models: { id: string; displayName?: string }[]
  accounts: { id: string; label: string; status: string }[]
  selectedAccountId?: string
}

/**
 * Extension providers that declared gateway export. Nothing is exported
 * until the user picks the account its requests use; clearing the choice
 * withdraws it.
 */
export function GatewayExtensionExportsPanel({ settings, onChange, active, t }: {
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  active: boolean
  t: TFunction
}): ReactElement | null {
  const [providers, setProviders] = useState<ExportableProvider[]>([])
  const load = useCallback(async () => {
    try {
      const result = await window.kunGui.runtimeRequest('/v1/model-gateway/extension-exports', 'GET')
      if (result.ok) setProviders((JSON.parse(result.body) as { providers?: ExportableProvider[] }).providers ?? [])
    } catch { setProviders([]) }
  }, [])
  useEffect(() => { if (active) void load() }, [active, load])
  if (!providers.length) return null
  const exports = settings.localGateway.extensionExports ?? []
  const choose = (providerId: string, accountId: string): void => {
    const next = exports.filter((entry) => entry.providerId !== providerId)
    if (accountId) next.push({ providerId, accountId })
    onChange({ ...settings, localGateway: { ...settings.localGateway, extensionExports: next } })
  }
  return <section className="grid min-w-0 gap-3 rounded-2xl border border-ds-border bg-ds-card p-4" data-gateway-extension-exports>
    <div>
      <h3 className="flex items-center gap-1.5 text-[14px] font-semibold text-ds-ink"><Puzzle className="h-4 w-4 text-accent" />{t('gatewayExtensions.title')}</h3>
      <p className="mt-1 max-w-[46rem] text-[12px] leading-5 text-ds-muted">{t('gatewayExtensions.description')}</p>
    </div>
    {!settings.localGateway.exposeProviderModels ? <p className="rounded-lg bg-amber-50 px-3 py-2 text-[11.5px] text-amber-800 dark:bg-amber-500/10 dark:text-amber-200">{t('gatewayExtensions.needsExposure')}</p> : null}
    <ul className="grid gap-2">
      {providers.map((provider) => {
        const selected = exports.find((entry) => entry.providerId === provider.providerId)?.accountId ?? ''
        return <li key={provider.providerId} className="grid gap-2 rounded-xl border border-ds-border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,16rem)] sm:items-center">
          <div className="min-w-0">
            <div className="text-[12.5px] font-medium text-ds-ink">{provider.displayName}</div>
            <div className="truncate font-mono text-[11px] text-ds-faint" title={provider.models.map((model) => model.id).join(', ')}>
              {provider.providerId} · {t('gatewayExtensions.models', { count: provider.models.length })}
            </div>
          </div>
          <select aria-label={t('gatewayExtensions.accountFor', { provider: provider.displayName })} value={selected}
            onChange={(event) => choose(provider.providerId, event.target.value)}
            className="w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink">
            <option value="">{t('gatewayExtensions.notExported')}</option>
            {provider.accounts.map((account) => <option key={account.id} value={account.id}>{account.label}{account.status !== 'connected' ? ` (${account.status})` : ''}</option>)}
          </select>
          {!provider.accounts.length ? <p className="text-[11px] text-ds-muted sm:col-span-2">{t('gatewayExtensions.noAccounts')}</p> : null}
        </li>
      })}
    </ul>
    <p className="text-[11px] leading-5 text-ds-faint">{t('gatewayExtensions.boundaries')}</p>
  </section>
}

/**
 * Experimental sharing of a ChatGPT subscription through the gateway. Off by
 * default and per connection, with the risk stated next to the switch.
 */
export function GatewaySubscriptionExportPanel({ settings, onChange, t }: {
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  t: TFunction
}): ReactElement | null {
  const candidates = settings.providers.filter((provider) => (provider.presetSource?.presetId ?? provider.id) === 'codex')
  if (!candidates.length) return null
  const enabled = new Set(settings.localGateway.experimentalSubscriptionExports ?? [])
  const toggle = (providerId: string, on: boolean): void => {
    const next = new Set(enabled)
    if (on) next.add(providerId)
    else next.delete(providerId)
    onChange({ ...settings, localGateway: { ...settings.localGateway, experimentalSubscriptionExports: [...next] } })
  }
  return <section className="grid min-w-0 gap-2 rounded-2xl border border-amber-300/70 bg-amber-50/40 p-4 dark:border-amber-500/30 dark:bg-amber-500/5" data-gateway-subscription-export>
    <h3 className="text-[13px] font-semibold text-ds-ink">{t('gatewayExtensions.subscriptionTitle')}</h3>
    <p className="text-[11.5px] leading-5 text-amber-800 dark:text-amber-200">{t('gatewayExtensions.subscriptionRisk')}</p>
    {candidates.map((provider) => <label key={provider.id} className="flex items-center justify-between gap-3 text-[12px] text-ds-ink">
      <span>{provider.name}</span>
      <input type="checkbox" checked={enabled.has(provider.id)} onChange={(event) => toggle(provider.id, event.target.checked)}
        aria-label={t('gatewayExtensions.subscriptionToggle', { provider: provider.name })} />
    </label>)}
  </section>
}
