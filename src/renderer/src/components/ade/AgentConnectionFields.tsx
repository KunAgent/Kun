import { useEffect, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { KeyRound, Network, UserRound } from 'lucide-react'
import type { AdeHarnessCredentialMode, AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessDefaultsEntryV1, KunHarnessEnabledProfileV1 } from '@shared/app-settings'
import { loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { useChatStore } from '../../store/chat-store'
import { SettingRow } from '../settings-controls'
import { AgentAliasSettings } from './AgentAliasSettings'
import { AgentSettingsModelPicker } from './AgentSettingsModelPicker'
import { AgentSettingsSelect } from './AgentSettingsSelect'

const MODE_ICON: Record<AdeHarnessCredentialMode, ReactElement> = {
  'native-login': <UserRound size={15} aria-hidden="true" />,
  'kun-gateway': <Network size={15} aria-hidden="true" />,
  provider: <KeyRound size={15} aria-hidden="true" />
}
const MODE_KEY: Record<AdeHarnessCredentialMode, string> = {
  'native-login': 'nativeLogin', 'kun-gateway': 'kunGateway', provider: 'provider'
}

/**
 * How an Agent reaches its models: connection mode cards, then the account,
 * provider or gateway route that mode needs, and the default model. The same
 * fields serve the first-time setup step and the Connection tab; the caller
 * decides whether an edit is saved at once or kept as a draft.
 */
export function AgentConnectionFields({ row, value, profile, modelsEnabled, onChange }: {
  row: AdeHarnessRow
  /** The effective defaults entry, including any unsaved edit. */
  value: KunHarnessDefaultsEntryV1
  profile: KunHarnessEnabledProfileV1
  /** Native model lists load only for an Agent that is turned on. */
  modelsEnabled: boolean
  onChange: (patch: Partial<KunHarnessDefaultsEntryV1>) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const id = row.definition.id
  const groups = useHarnessStore((state) => state.providerGroups[id])
  const models = useHarnessStore((state) => state.models[id])
  const providerAccounts = useChatStore((state) => state.composerModelGroups)
  const nativeAccounts = providerAccounts.filter((group) => row.definition.transport === 'agent-sdk' && group.kind === 'agent-sdk')
  const native = profile.credentialMode === 'native-login'
  const terminal = row.definition.transport === 'terminal'
  useEffect(() => {
    if (!native) void loadHarnessProviderGroups(id)
    // Opening the model picker is the explicit native catalog lookup.
  }, [id, native])
  const selectedGroup = groups?.groups.find((entry) => entry.providerId === profile.providerId)
  const selectedAlias = groups?.aliasGroups?.find((entry) => entry.routeId === profile.gatewayBinding?.main.routeId)
  const modelOptions = native ? models?.models ?? row.definition.staticModels : selectedAlias ? [selectedAlias.modelId] : selectedGroup?.models ?? []
  const selectMode = (mode: AdeHarnessCredentialMode): void => {
    if (mode !== profile.credentialMode) onChange({ credentialMode: mode, providerId: undefined, gatewayBinding: undefined, model: undefined })
  }

  return <>
    <div className="px-3 pb-1 pt-3.5">
      <div id={`agent-mode-${id}`} className="mb-2 text-[13px] font-medium text-ds-ink">{t('agentEnablement.profile')}</div>
      <div role="radiogroup" aria-labelledby={`agent-mode-${id}`} data-agent-profile-mode
        className="grid gap-2 sm:grid-cols-[repeat(auto-fit,minmax(11rem,1fr))]">
        {row.definition.credentialModes.map((mode) => {
          const selected = mode === profile.credentialMode
          return <button key={mode} type="button" role="radio" aria-checked={selected} data-agent-profile-mode-option={mode}
            onClick={() => selectMode(mode)}
            className={`flex min-h-11 flex-col items-start gap-1 rounded-xl border px-3 py-2.5 text-left transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-tint/40 ${selected ? 'border-[var(--ds-control)] bg-ds-card shadow-[0_0_0_1px_var(--ds-control)]' : 'border-ds-border bg-ds-subtle hover:border-[var(--ds-border-strong)] hover:bg-ds-hover'}`}>
            <span className="flex items-center gap-1.5 text-[13px] font-semibold text-ds-ink">
              {MODE_ICON[mode]}{t(`adeCredential.${MODE_KEY[mode]}`)}
            </span>
            <span className="text-[11.5px] leading-[1.45] text-ds-muted">{t(`agentCenter.modeDesc.${MODE_KEY[mode]}`)}</span>
          </button>
        })}
      </div>
    </div>
    {native && nativeAccounts.length > 0 ? <SettingRow title={t('agentEnablement.nativeAccount')} control={<AgentSettingsSelect
      marker="data-agent-profile-provider" label={t('agentEnablement.nativeAccount')} value={profile.providerId ?? ''}
      onChange={(next) => onChange({ providerId: next || undefined, model: undefined })}
      options={[{ value: '', label: t('agentEnablement.systemAccount'), icon: <UserRound size={15} /> },
        ...nativeAccounts.map((account) => ({ value: account.providerId, label: account.label, icon: <UserRound size={15} /> }))]} />} /> : null}
    {!native ? <SettingRow title={t('agentEnablement.provider')} control={<AgentSettingsSelect
      marker="data-agent-profile-provider" label={t('agentEnablement.provider')}
      value={profile.gatewayBinding ? `@alias:${profile.gatewayBinding.main.routeId}` : profile.providerId ?? ''}
      onChange={(next) => {
        const alias = groups?.aliasGroups?.find((entry) => next === `@alias:${entry.routeId}`)
        onChange(alias ? { providerId: undefined, model: alias.modelId, gatewayBinding: { main: { routeId: alias.routeId, allowedConnectionIds: alias.connectionIds } } }
          : { providerId: next || undefined, gatewayBinding: undefined, model: undefined })
      }}
      options={[{ value: '', label: t('agentEnablement.chooseProvider') },
        ...(profile.credentialMode === 'kun-gateway' ? groups?.aliasGroups ?? [] : []).map((alias) => ({ value: `@alias:${alias.routeId}`, label: `${t('agentEnablement.alias')} · ${alias.label}`, icon: <Network size={15} /> })),
        ...(groups?.groups ?? []).map((group) => ({ value: group.providerId, label: group.label, icon: <KeyRound size={15} /> }))]} />} /> : null}
    {!native ? <div className="px-3 pb-2"><button type="button" data-agent-manage-providers
      onClick={() => useChatStore.getState().openSettings('providers')}
      className="text-[12px] font-medium text-accent hover:underline">{t('agentCenter.connection.manageProviders')}</button></div> : null}
    {profile.gatewayBinding ? <div className="px-3 pb-3"><AgentAliasSettings binding={profile.gatewayBinding} aliases={groups?.aliasGroups ?? []}
      supportsSmall={Boolean(row.definition.gateway?.env.smallModel)} change={(gatewayBinding) => onChange({ gatewayBinding })} /></div> : null}
    {terminal && native ? <p className="px-3 py-3.5 text-[12px] text-ds-muted" data-agent-terminal-model-hint>{t('agentIntegrations.terminalModelManaged')}</p>
      : <SettingRow title={t('agentEnablement.model')} description={t('agentEnablement.modelHint')}
        control={<AgentSettingsModelPicker key={`${id}:${profile.credentialMode}:${profile.providerId ?? ''}`}
          harnessId={id} native={native} value={value.model ?? ''} modelIds={modelOptions}
          modelInfo={native ? models?.modelInfo : selectedGroup?.modelInfo}
          loading={native ? models?.loading : groups?.loading} error={native ? models?.error : groups?.error}
          onChange={(model) => onChange({ model: model || undefined })}
          onLoad={native ? modelsEnabled ? (force) => { void loadHarnessModels(id, force) } : undefined
            : (force) => { void loadHarnessProviderGroups(id, force) }} />} />}
  </>
}
