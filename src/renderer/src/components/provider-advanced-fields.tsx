import { ProviderRequestSecurityFields } from './provider-request-security-fields'
import { useTranslation } from 'react-i18next'
import type { ProviderConnectionConfiguration } from '@shared/provider-configuration'
import { textInputClass, providerSelectControlClass } from './settings-section-providers-controls'

export function ProviderAdvancedFields({ draft, edit, baseUrl, sources, disabled, kind }: {
  draft: ProviderConnectionConfiguration; edit(value: Partial<ProviderConnectionConfiguration>): void;
  baseUrl?: string; kind?: string; sources?: Record<string, string>; disabled: boolean
}) {
  const { t } = useTranslation('settings')
  const binding = draft.endpointBinding, discovery = draft.discovery
  return <fieldset disabled={disabled} className="space-y-3 rounded-lg border border-ds-border-muted p-3 sm:col-span-2">
    <legend>{t('providerConfiguration.advanced')}</legend>
    <p className="break-all text-ds-muted">{t('providerConfiguration.effectiveEndpoint', { url: baseUrl ?? '—',
      source: t(`providerConfiguration.source${sources?.baseUrl ?? 'connection'}`) })}</p>
    <label className="flex items-center gap-2"><input type="checkbox" checked={Boolean(binding)} onChange={(event) => edit({
      endpointBinding: event.target.checked ? { urlMode: 'base', protocol: 'chat_completions', baseUrl: baseUrl ?? '' } : undefined
    })} />{t('providerConfiguration.explicitEndpoint')}</label>
    {binding ? <div className="grid gap-2 sm:grid-cols-2">
      <label>{t('providerConfiguration.urlMode')}<select className={providerSelectControlClass} value={binding.urlMode}
        onChange={(event) => { const url = binding.urlMode === 'base' ? binding.baseUrl : binding.requestUrl
          edit({ endpointBinding: event.target.value === 'full' ? { urlMode: 'full', protocol: binding.protocol, requestUrl: url }
            : { urlMode: 'base', protocol: binding.protocol, baseUrl: url } }) }}>
        <option value="base">Base URL</option><option value="full">{t('providerConfiguration.fullEndpoint')}</option>
      </select></label>
      <label>{t('providerConfiguration.protocol')}<select className={providerSelectControlClass} value={binding.protocol}
        onChange={(event) => edit({ endpointBinding: { ...binding, protocol: event.target.value as typeof binding.protocol } })}>
        {['chat_completions', 'responses', 'messages'].map((format) => <option key={format} value={format}>{format}</option>)}
      </select></label>
      <label className="sm:col-span-2">URL<input className={textInputClass} value={binding.urlMode === 'base' ? binding.baseUrl : binding.requestUrl}
        onChange={(event) => edit({ endpointBinding: binding.urlMode === 'base' ? { ...binding, baseUrl: event.target.value }
          : { ...binding, requestUrl: event.target.value } })} /></label>
    </div> : null}
    <label className="block">{t('providerConfiguration.proxy')}<select className={providerSelectControlClass} value={draft.proxy?.mode ?? ''}
      onChange={(event) => edit({ proxy: event.target.value === 'proxy' ? { mode: 'proxy', url: '' }
        : event.target.value === 'direct' ? { mode: 'direct' } : event.target.value === 'inherit' ? { mode: 'inherit' } : undefined })}>
      <option value="">{t('providerConfiguration.proxyDefault')}</option><option value="inherit">{t('providerConfiguration.proxyinherit')}</option>
      <option value="direct">{t('providerConfiguration.proxydirect')}</option><option value="proxy">{t('providerConfiguration.proxycustom')}</option>
    </select></label>
    {draft.proxy?.mode === 'proxy' ? <input aria-label={t('providerConfiguration.proxy')} className={textInputClass} value={draft.proxy.url}
      onChange={(event) => edit({ proxy: { mode: 'proxy', url: event.target.value } })} /> : null}
    {discovery?.mode === 'custom' ? <div className="grid gap-2 sm:grid-cols-2">
      {(['itemsPointer', 'idPointer', 'nextCursorPointer', 'cursorParameter'] as const).map((key) => <label key={key}>
        {t(`providerConfiguration.${key}`)}<input className={textInputClass} value={discovery[key] ?? ''}
          onChange={(event) => edit({ discovery: { ...discovery, [key]: event.target.value || undefined } })} />
      </label>)}
      <label className="sm:col-span-2">{t('providerConfiguration.credentialHosts')}<input className={textInputClass}
        value={discovery.credentialHosts.join(', ')} onChange={(event) => edit({ discovery: { ...discovery,
          credentialHosts: event.target.value.split(',').map((host) => host.trim()) } })}
          onBlur={() => edit({ discovery: { ...discovery, credentialHosts: discovery.credentialHosts.filter(Boolean) } })} /></label>
    </div> : null}
    <ProviderRequestSecurityFields draft={draft} edit={edit} baseUrl={baseUrl} native={kind !== undefined && kind !== 'http'} />
    <label className="block">{t('providerConfiguration.manualModels')}<textarea className={`${textInputClass} min-h-20 font-mono`}
      value={draft.manualModels.join('\n')} onChange={(event) => edit({ manualModels: event.target.value.split('\n') })}
      onBlur={() => edit({ manualModels: draft.manualModels.map((id) => id.trim()).filter(Boolean) })} /></label>
  </fieldset>
}
