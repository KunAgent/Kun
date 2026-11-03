import type { TFunction } from 'i18next'
import { KeyRound, ShieldAlert } from 'lucide-react'
import type { ReactElement, ReactNode } from 'react'
import type { ModelProviderSettingsV1 } from '@shared/app-settings'
import type { GatewayCredentialStatus } from '@shared/kun-gui-api'
import { settingsButtonClass } from './settings-button'
import { GatewayDiscoveryRow } from './gateway-discovery-row'
import { GatewayMiddlewarePanel } from './gateway-middleware-panel'
import { GatewayExtensionExportsPanel, GatewaySubscriptionExportPanel } from './gateway-extension-exports-panel'

type KeyAction = 'ensure' | 'copy' | 'rotate' | 'revoke'

function SettingRow({ title, description, children }: { title: string; description: string; children: ReactNode }): ReactElement {
  return <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3.5">
    <div className="min-w-[14rem] flex-1">
      <div className="text-[13px] font-medium text-ds-ink">{title}</div>
      <p className="mt-0.5 max-w-[40rem] text-[11.5px] leading-5 text-ds-muted">{description}</p>
    </div>
    <div className="flex min-w-0 flex-wrap items-center gap-1.5">{children}</div>
  </div>
}

/**
 * Settings most people never need: the gateway's display name, its shared
 * key, the discovery file, middleware, and what extensions may export.
 */
export function GatewayAdvancedPanel({ t, settings, onChange, active, credential, keyPending, onKeyAction }: {
  t: TFunction
  settings: ModelProviderSettingsV1
  onChange: (next: ModelProviderSettingsV1) => void
  active: boolean
  credential: GatewayCredentialStatus
  keyPending: boolean
  onKeyAction: (action: KeyAction) => void
}): ReactElement {
  const revoke = (): void => {
    if (typeof globalThis.confirm === 'function' && !globalThis.confirm(t('gatewaySetup.confirmRevokeKey'))) return
    onKeyAction('revoke')
  }
  return <div className="grid min-w-0 gap-4" data-gateway-advanced>
    <section className="grid min-w-0 divide-y divide-ds-border-muted rounded-2xl border border-ds-border bg-ds-card">
      <SettingRow title={t('modelRoutes.localRelayProvider')} description={t('gatewaySetup.identityDesc')}>
        <input value={settings.localGateway.name} maxLength={80} aria-label={t('modelRoutes.providerNameAria')}
          onChange={(event) => onChange({ ...settings, localGateway: { ...settings.localGateway, name: event.target.value } })}
          className="w-56 max-w-full rounded-lg border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12.5px] text-ds-ink outline-none focus:border-accent" />
      </SettingRow>
      <SettingRow title={t('gatewaySetup.masterKey')} description={t('gatewaySetup.masterKeyDesc')}>
        <span className={`mr-1 inline-flex items-center gap-1 text-[11.5px] font-medium ${credential.configured ? 'text-ds-status-success' : 'text-ds-status-warning'}`}>
          <KeyRound className="h-3.5 w-3.5" />{credential.configured ? t('gatewaySetup.keyConfigured') : t('gatewaySetup.keyNotConfigured')}
        </span>
        {credential.configured ? <>
          <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={keyPending} onClick={() => onKeyAction('copy')}>{t('gatewaySetup.copyKey')}</button>
          <button type="button" className={settingsButtonClass({ size: 'compact' })} disabled={keyPending} onClick={() => onKeyAction('rotate')}>{t('gatewaySetup.rotateKey')}</button>
          <button type="button" className={settingsButtonClass({ variant: 'danger-ghost', size: 'compact' })} disabled={keyPending} onClick={revoke}>{t('gatewaySetup.revokeKey')}</button>
        </> : <button type="button" className={settingsButtonClass({ variant: 'primary', size: 'compact' })} disabled={keyPending}
          onClick={() => onKeyAction('ensure')}>{t('gatewaySetup.createKey')}</button>}
      </SettingRow>
    </section>
    <GatewayDiscoveryRow settings={settings} onChange={onChange} active={active} t={t} />
    <GatewayMiddlewarePanel settings={settings} onChange={onChange} active={active} t={t} />
    <GatewayExtensionExportsPanel settings={settings} onChange={onChange} active={active} t={t} />
    <GatewaySubscriptionExportPanel settings={settings} onChange={onChange} t={t} />
    <p className="flex items-start gap-2 rounded-xl border border-ds-border-muted px-3 py-2.5 text-[11.5px] leading-5 text-ds-muted">
      <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-ds-status-warning" />{t('modelRoutes.apiSecurityWarning')}
    </p>
  </div>
}
