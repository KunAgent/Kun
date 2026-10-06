import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ProviderConfigurationOperation, ProviderConfigurationSnapshot } from '@shared/provider-configuration'
import { settingsButtonClass } from './settings-button'
import { providerSelectControlClass } from './settings-section-providers-controls'

export function ProviderTemplateActions({ snapshot, connectionId, review, disabled }: {
  snapshot: ProviderConfigurationSnapshot; connectionId: string; disabled: boolean;
  review(operations: ProviderConfigurationOperation[]): void
}) {
  const { t } = useTranslation('settings')
  const [templateId, setTemplateId] = useState(''), [resetEndpoint, setResetEndpoint] = useState(false)
  const templates = Object.values(snapshot.configuration.templates)
  const template = snapshot.configuration.templates[templateId]
  const connection = snapshot.connections.find((item) => item.id === connectionId)
  return <fieldset disabled={disabled} className="space-y-2 rounded-lg border border-ds-border-muted p-3 sm:col-span-2">
    <legend>{t('providerConfiguration.templateActions')}</legend>
    <p className="text-ds-muted">{t('providerConfiguration.templateHint')}</p>
    <select className={providerSelectControlClass} aria-label={t('providerConfiguration.templateActions')} value={templateId}
      onChange={(event) => setTemplateId(event.target.value)}>
      <option value="">{t('providerConfiguration.chooseTemplate')}</option>
      {templates.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · v{entry.revision}</option>)}
    </select>
    <label className="flex items-center gap-2"><input type="checkbox" checked={resetEndpoint}
      onChange={(event) => setResetEndpoint(event.target.checked)} />{t('providerConfiguration.resetTemplateEndpoint')}</label>
    <div className="flex flex-wrap gap-2">
      <button className={settingsButtonClass()} disabled={!template || !connection} onClick={() => {
        if (template) review([{ kind: 'apply-template', templateId: template.id, revision: template.revision,
          connectionIds: [connectionId], resetFields: resetEndpoint ? ['baseUrl', 'endpointFormat', 'endpoints'] : [] }])
      }}>{t('providerConfiguration.applyTemplate')}</button>
      <button className={settingsButtonClass()} disabled={!connection} onClick={() => {
        if (!connection) return
        const { name, presetSource, presetMode, kind, authType, baseUrl, endpointFormat, endpoints, useProxy,
          models, modelCapabilities, selectedModel } = connection
        const id = `account-${crypto.randomUUID()}`
        review([{ kind: 'add-connection', connection: { id, name: t('providerConfiguration.copyName', { name }), presetSource, presetMode, kind, authType,
          baseUrl, endpointFormat, endpoints, useProxy, models, modelCapabilities, selectedModel,
          ...(snapshot.connectionOverrides?.[connectionId] ?? {}) } },
        { kind: 'configure-connection', connectionId: id, configuration: {
          ...(snapshot.configuration.connections[connectionId] ?? { enabled: true, inherit: [], manualModels: [] }), enabled: false
        } }])
      }}>{t('providerConfiguration.copyAccount')}</button>
    </div>
  </fieldset>
}
