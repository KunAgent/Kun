import { AgentAliasSettings } from './AgentAliasSettings'
import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Network, UserRound } from 'lucide-react'
import type { AdeHarnessCredentialMode, AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessSettingsV1 } from '@shared/app-settings'
import { harnessProfileReady, terminalHarnessProfileReady } from '@shared/harness-enablement'
import { loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingRow } from '../settings-controls'
import { useAgentEnablement } from './use-agent-enablement'
import { AgentSettingsSelect } from './AgentSettingsSelect'
import { AgentSettingsModelPicker } from './AgentSettingsModelPicker'

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
  const terminal = row.definition.transport === 'terminal'
  const ready = gate.enabled && !gate.error && !gate.checking && (terminal
    ? terminalHarnessProfileReady(row, gate.profile) : harnessProfileReady(row, gate.profile))
  useEffect(() => {
    if (!native) void loadHarnessProviderGroups(id)
    // Opening the model picker is the explicit native catalog lookup.
  }, [id, native])
  const change = (value: Partial<KunHarnessDefaultsEntryV1>): void => {
    gate.cancel()
    patch({ defaults: { ...settings.defaults, [id]: { ...defaults, ...value } } })
  }
  const selectedGroup = groups?.groups.find((entry) => entry.providerId === gate.profile.providerId)
  const selectedAlias = groups?.aliasGroups?.find((entry) => entry.routeId === gate.profile.gatewayBinding?.main.routeId)
  const modelOptions = native ? models?.models ?? row.definition.staticModels : selectedAlias ? [selectedAlias.modelId] : selectedGroup?.models ?? []
  return <section className="mt-3 space-y-3 rounded-xl border border-ds-border-muted p-3"
    data-agent-enablement={id} data-agent-enablement-state={gate.checking ? 'checking' : gate.error ? 'failed' : ready ? 'ready' : gate.enabled ? 'needs-check' : 'disabled'}>
    <p className="text-[12px] text-ds-muted">{t(terminal ? 'agentIntegrations.terminalExplanation' : 'agentEnablement.explanation')}</p>
    <SettingRow title={t('agentEnablement.profile')} control={<AgentSettingsSelect
      marker="data-agent-profile-mode" label={t('agentEnablement.profile')} value={gate.profile.credentialMode}
      onChange={(value) => change({ credentialMode: value as AdeHarnessCredentialMode, providerId: undefined, gatewayBinding: undefined, model: undefined })}
      options={row.definition.credentialModes.map((mode) => ({ value: mode,
        label: t(`adeCredential.${mode === 'native-login' ? 'nativeLogin' : mode === 'kun-gateway' ? 'kunGateway' : 'provider'}`),
        icon: mode === 'native-login' ? <UserRound size={15} /> : mode === 'kun-gateway' ? <Network size={15} /> : <KeyRound size={15} /> }))} />} />
    {native && nativeAccounts.length > 0 ? <SettingRow title={t('agentEnablement.nativeAccount')} control={<AgentSettingsSelect
      marker="data-agent-profile-provider" label={t('agentEnablement.nativeAccount')} value={gate.profile.providerId ?? ''}
      onChange={(value) => change({ providerId: value || undefined, model: undefined })}
      options={[{ value: '', label: t('agentEnablement.systemAccount'), icon: <UserRound size={15} /> },
        ...nativeAccounts.map((account) => ({ value: account.providerId, label: account.label, icon: <UserRound size={15} /> }))]} />} /> : null}
    {!native ? <SettingRow title={t('agentEnablement.provider')} control={<AgentSettingsSelect
      marker="data-agent-profile-provider" label={t('agentEnablement.provider')} value={gate.profile.gatewayBinding ? `@alias:${gate.profile.gatewayBinding.main.routeId}` : gate.profile.providerId ?? ''}
      onChange={(value) => {
        const alias = groups?.aliasGroups?.find((entry) => value === `@alias:${entry.routeId}`)
        change(alias ? { providerId: undefined, model: alias.modelId, gatewayBinding: { main: { routeId: alias.routeId, allowedConnectionIds: alias.connectionIds } } }
          : { providerId: value || undefined, gatewayBinding: undefined, model: undefined })
      }}
      options={[{ value: '', label: t('agentEnablement.chooseProvider') },
        ...(gate.profile.credentialMode === 'kun-gateway' ? groups?.aliasGroups ?? [] : []).map((alias) => ({ value: `@alias:${alias.routeId}`, label: `${t('agentEnablement.alias')} · ${alias.label}`, icon: <Network size={15} /> })),
        ...(groups?.groups ?? []).map((group) => ({ value: group.providerId, label: group.label, icon: <KeyRound size={15} /> }))]} />} /> : null}
    {gate.profile.gatewayBinding ? <AgentAliasSettings binding={gate.profile.gatewayBinding} aliases={groups?.aliasGroups ?? []}
      supportsSmall={Boolean(row.definition.gateway?.env.smallModel)} change={(gatewayBinding) => change({ gatewayBinding })} /> : null}
    {terminal && native ? <p className="text-[12px] text-ds-muted" data-agent-terminal-model-hint>{t('agentIntegrations.terminalModelManaged')}</p>
      : <SettingRow title={t('agentEnablement.model')} description={t('agentEnablement.modelHint')}
      control={<AgentSettingsModelPicker key={`${id}:${gate.profile.credentialMode}:${gate.profile.providerId ?? ''}`}
        harnessId={id} native={native} value={defaults.model ?? ''} modelIds={modelOptions}
        modelInfo={native ? models?.modelInfo : selectedGroup?.modelInfo}
        loading={native ? models?.loading : groups?.loading} error={native ? models?.error : groups?.error}
        onChange={(value) => change({ model: value || undefined })}
        onLoad={native ? gate.enabled ? (force) => { void loadHarnessModels(id, force) } : undefined
          : (force) => { void loadHarnessProviderGroups(id, force) }} />} />}
    <div className="flex flex-wrap items-center gap-2">
      {gate.checking ? <button type="button" onClick={gate.cancel} data-agent-enable-cancel
        data-settings-action="secondary" data-settings-size="default" className="rounded-lg border border-ds-border px-3 py-1.5 text-[12px] text-ds-ink">{t('agentEnablement.cancel')}</button>
        : <button type="button" data-agent-enable onClick={() => gate.enabled ? gate.disable() : void gate.enable()}
          data-settings-action={gate.enabled ? 'secondary' : 'primary'} data-settings-size="default"
          className="rounded-lg bg-accent px-3 py-1.5 text-[12px] font-medium text-white">{t(gate.enabled ? 'agentEnablement.disable' : 'agentEnablement.enable')}</button>}
      <span role="status" aria-live="polite" className="text-[12px] text-ds-muted">{t(gate.checking ? `agentEnablement.phases.${gate.phase}` : ready ? terminal ? 'agentIntegrations.terminalReady' : 'agentEnablement.ready' : gate.enabled ? 'agentEnablement.needsCheck' : 'agentEnablement.disabled')}</span>
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
