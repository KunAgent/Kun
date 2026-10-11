import { useTranslation } from 'react-i18next'
import type { ProviderConnectionConfiguration } from '@shared/provider-configuration'
import { textInputClass, providerSelectControlClass } from './settings-section-providers-controls'

export function ProviderRequestSecurityFields({ draft, edit, baseUrl, native = false }: {
  draft: ProviderConnectionConfiguration; edit(value: Partial<ProviderConnectionConfiguration>): void; baseUrl?: string; native?: boolean
}) {
  const { t } = useTranslation('settings')
  const hosts = (() => { try { return baseUrl ? [new URL(baseUrl).host] : [] } catch { return [] } })()
  const scope = () => ({ hosts, purposes: native ? ['quota' as const] : ['inference' as const, 'discovery' as const] })
  return <div className="space-y-2">
    {native ? <p className="text-[12px] text-ds-muted">{t('providerConfiguration.nativeScopeHint')}</p> : null}
    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(draft.authProfile)} onChange={(event) => edit({
      authProfile: event.target.checked ? { mode: 'adapter', prefix: 'Bearer ', scope: scope() } : undefined
    })} />{t('providerConfiguration.authProfile')}</label>
    {draft.authProfile ? <div className="grid gap-2 sm:grid-cols-2">
      <label>{t('providerConfiguration.authMode')}<select className={providerSelectControlClass} disabled={native} value={draft.authProfile.mode}
        onChange={(event) => edit({ authProfile: { ...draft.authProfile!, mode: event.target.value as 'adapter' | 'header',
          headerName: event.target.value === 'header' ? 'Authorization' : undefined } })}>
        <option value="adapter">{t('providerConfiguration.authAdapter')}</option><option value="header">{t('providerConfiguration.authCustom')}</option>
      </select></label>
      {draft.authProfile.mode === 'header' ? <>
        <label>{t('providerConfiguration.authHeader')}<input className={textInputClass} value={draft.authProfile.headerName ?? ''}
          onChange={(event) => edit({ authProfile: { ...draft.authProfile!, headerName: event.target.value } })} /></label>
        <label>{t('providerConfiguration.authPrefix')}<select className={providerSelectControlClass} value={draft.authProfile.prefix}
          onChange={(event) => edit({ authProfile: { ...draft.authProfile!, prefix: event.target.value as '' | 'Bearer ' | 'Basic ' } })}>
          <option value="Bearer ">Bearer</option><option value="Basic ">Basic</option><option value="">—</option>
        </select></label>
      </> : null}
      <label className="sm:col-span-2">{t('providerConfiguration.scopeHosts')}<input className={textInputClass}
        value={draft.authProfile.scope.hosts.join(', ')} onChange={(event) => edit({ authProfile: { ...draft.authProfile!, scope: {
          ...draft.authProfile!.scope, hosts: event.target.value.split(',').map((host) => host.trim()).filter(Boolean)
        } } })} /></label>
    </div> : null}
    <label className="flex items-center gap-2"><input type="checkbox" disabled={native} checked={Boolean(draft.headerProfile)} onChange={(event) => edit({
      headerProfile: event.target.checked ? { scope: scope() } : undefined
    })} />{t('providerConfiguration.headerProfile')}</label>
    {(['authProfile', 'headerProfile'] as const).map((key) => draft[key] ? <div key={key} className="flex flex-wrap gap-3">
      {(key === 'authProfile' ? native ? ['quota'] as const : ['inference', 'discovery', 'oauth', 'quota'] as const : ['inference', 'discovery'] as const).map((purpose) => <label key={purpose} className="flex items-center gap-2">
        <input type="checkbox" checked={draft[key]!.scope.purposes.includes(purpose)} onChange={(event) => edit({ [key]: {
          ...draft[key]!, scope: { ...draft[key]!.scope, purposes: event.target.checked ? [...draft[key]!.scope.purposes, purpose]
            : draft[key]!.scope.purposes.filter((value) => value !== purpose) }
        } })} />{t(`providerConfiguration.scope${purpose}`)}
      </label>)}
    </div> : null)}
    {draft.headerProfile ? <label className="block">{t('providerConfiguration.scopeHosts')}<input className={textInputClass}
      value={draft.headerProfile.scope.hosts.join(', ')} onChange={(event) => edit({ headerProfile: { scope: {
        ...draft.headerProfile!.scope, hosts: event.target.value.split(',').map((host) => host.trim()).filter(Boolean)
      } } })} /></label> : null}
  </div>
}
