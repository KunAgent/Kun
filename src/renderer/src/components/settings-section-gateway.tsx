import type { ReactElement } from 'react'
import { defaultModelProviderSettings } from '@shared/app-settings-provider-core'
import { ModelRoutesSettings } from './settings-section-model-routes'

/** Local gateway: its own page, so the provider list and the gateway never compete for one header. */
export function GatewaySettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const { t, provider: providerFromContext, kun, update, saveStatus, saveError, retrySave } = ctx
  const provider = providerFromContext ?? defaultModelProviderSettings()
  return (
    <div className="min-w-0">
      <ModelRoutesSettings
        settings={provider}
        onChange={(next) => update({ provider: { routePools: next.routePools, localGateway: next.localGateway } })}
        translation={t}
        saveStatus={saveStatus}
        saveError={saveError}
        onRetrySave={retrySave}
        publicBaseUrl={`http://127.0.0.1:${kun.port}`}
      />
    </div>
  )
}
