import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { AdeHarnessCredentialMode, AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileReady } from '@shared/harness-enablement'
import { loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingRow } from '../settings-controls'
import { useAgentEnablement } from './use-agent-enablement'

const fieldClass = 'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink focus:border-accent/40 focus:outline-none'

/** Profile selection and enablement are intentionally one reviewable, cancellable operation. */
export function AgentEnablementPanel({ row, settings, patch, beforeCheck }: {
  row: AdeHarnessRow
  settings: KunHarnessSettingsV1
  beforeCheck?: () => Promise<boolean>
  patch: (patch: Partial<KunHarnessSettingsV1>) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const gate = useAgentEnablement({ row, settings, patch, beforeCheck })
  const id = row.definition.id
  const defaults = settings.defaults[id] ?? {}
  const groups = useHarnessStore((state) => state.providerGroups[id])
  const models = useHarnessStore((state) => state.models[id])
  const providerAccounts = useChatStore((state) => state.composerModelGroups)
  const nativeAccounts = providerAccounts.filter((group) => row.definition.transport === 'agent-sdk' && group.kind === 'agent-sdk')
  const native = gate.profile.credentialMode === 'native-login'
  const ready = gate.enabled && !gate.error && !gate.checking && harnessProfileReady(row, gate.profile)
  useEffect(() => {
    if (!native) void loadHarnessProviderGroups(id)
    // A model list is not an account probe. Native lookup stays an explicit action.
  }, [id, native])
  const change = (value: Partial<KunHarnessDefaultsEntryV1>): void => {
    gate.cancel()
    patch({ defaults: { ...settings.defaults, [id]: { ...defaults, ...value } } })
  }
  const modelOptions = native ? models?.models ?? row.definition.staticModels
    : groups?.groups.find((entry) => entry.providerId === gate.profile.providerId)?.models ?? []
  return <section className="mt-3 space-y-3 rounded-xl border border-ds-border-muted p-3"
    data-agent-enablement={id} data-agent-enablement-state={gate.checking ? 'checking' : gate.error ? 'failed' : ready ? 'ready' : gate.enabled ? 'needs-check' : 'disabled'}>
    <p className="text-[12px] text-ds-muted">{t('agentEnablement.explanation')}</p>
    <SettingRow title={t('agentEnablement.profile')} control={<select className={fieldClass}
      data-agent-profile-mode aria-label={t('agentEnablement.profile')} value={gate.profile.credentialMode}
      onChange={(event) => change({ credentialMode: event.target.value as AdeHarnessCredentialMode, providerId: undefined, model: undefined })}>
      {row.definition.credentialModes.map((mode) => <option key={mode} value={mode}>{t(`adeCredential.${mode === 'native-login' ? 'nativeLogin' : mode === 'kun-gateway' ? 'kunGateway' : 'provider'}`)}</option>)}
    </select>} />
    {native && nativeAccounts.length > 0 ? <SettingRow title={t('agentEnablement.nativeAccount')} control={<select className={fieldClass}
      data-agent-profile-provider aria-label={t('agentEnablement.nativeAccount')} value={gate.profile.providerId ?? ''}
      onChange={(event) => change({ providerId: event.target.value || undefined, model: undefined })}>
      <option value="">{t('agentEnablement.systemAccount')}</option>
      {nativeAccounts.map((account) => <option key={account.providerId} value={account.providerId}>{account.label}</option>)}
    </select>} /> : null}
    {!native ? <SettingRow title={t('agentEnablement.provider')} control={<select className={fieldClass}
      data-agent-profile-provider aria-label={t('agentEnablement.provider')} value={gate.profile.providerId ?? ''}
      onChange={(event) => change({ providerId: event.target.value || undefined, model: undefined })}>
      <option value="">{t('agentEnablement.chooseProvider')}</option>
      {(groups?.groups ?? []).map((group) => <option key={group.providerId} value={group.providerId}>{group.label}</option>)}
    </select>} /> : null}
    <SettingRow title={t('agentEnablement.model')} description={t('agentEnablement.modelHint')}
      control={<input className={fieldClass} data-agent-profile-model aria-label={t('agentEnablement.model')} list={`agent-models-${id}`} value={defaults.model ?? ''}
        placeholder={t('agentEnablement.nativeDefault')} onChange={(event) => change({ model: event.target.value || undefined })} />} />
    <datalist id={`agent-models-${id}`}>{modelOptions.map((model) => <option key={model} value={model} />)}</datalist>
    {native && gate.enabled ? <button type="button" className="min-h-6 text-[12px] text-ds-muted underline" onClick={() => void loadHarnessModels(id, true)}>{t('agentEnablement.loadModels')}</button> : null}
    <div className="flex flex-wrap items-center gap-2">
      {gate.checking ? <button type="button" onClick={gate.cancel} data-agent-enable-cancel
        data-settings-action="secondary" data-settings-size="default" className="rounded-lg border border-ds-border px-3 py-1.5 text-[12px] text-ds-ink">{t('agentEnablement.cancel')}</button>
        : <button type="button" data-agent-enable onClick={() => gate.enabled ? gate.disable() : void gate.enable()}
          data-settings-action={gate.enabled ? 'secondary' : 'primary'} data-settings-size="default"
          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white">{t(gate.enabled ? 'agentEnablement.disable' : 'agentEnablement.enable')}</button>}
      <span role="status" aria-live="polite" className="text-[12px] text-ds-muted">{t(gate.checking ? `agentEnablement.phases.${gate.phase}` : ready ? 'agentEnablement.ready' : gate.enabled ? 'agentEnablement.needsCheck' : 'agentEnablement.disabled')}</span>
    </div>
    {gate.enabled && !gate.checking ? <button type="button" data-agent-recheck onClick={() => { gate.disable(); void gate.enable() }}
      className="min-h-6 text-[12px] text-ds-muted underline">{t('agentEnablement.recheck')}</button> : null}
    {gate.error ? <p role="alert" className="break-words text-[12px] text-ds-status-danger">{gate.error.startsWith('agentEnablement.') ? t(gate.error) : gate.error}</p> : null}
    {gate.errorDetail ? <details className="break-words text-[11px] text-ds-muted">
      <summary className="cursor-pointer">{t('agentEnablement.errorDetails')}</summary>
      <p className="mt-1 whitespace-pre-wrap">{gate.errorDetail}</p>
    </details> : null}
    {gate.result?.readiness ? <div className="space-y-1 text-[11px] text-ds-muted" data-agent-readiness-result>
      {gate.result.readiness.checks.map((check) => <div key={check.id} data-agent-readiness-check={check.id} data-ok={check.ok}>
        {check.ok ? '✓ ' : '✗ '}{t(`agentEnablement.checks.${check.id}`)}{check.detail ? `: ${check.detail}` : ''}
      </div>)}
      <p>{t(gate.result.readiness.authentication === 'verified' ? 'agentEnablement.authVerified' : 'agentEnablement.authUnverified')}</p>
    </div> : null}
    <p className="text-[11px] text-ds-faint">{t('agentEnablement.quotaUnverified')}</p>
  </section>
}
