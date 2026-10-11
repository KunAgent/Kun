import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { RotateCcw } from 'lucide-react'
import type { AgentIdentity } from '@shared/rooms-api'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { adeHarnessModelGroups } from '../../lib/ade-composer-harness'
import { harnessModelFingerprint, loadHarnesses, loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import { nativeReasoningChoices, type ComposerReasoningEffort } from '../chat/floating-composer-model-picker-logic'
import { directReasoningEffort } from './room-direct-model-groups'
import { workbenchDisplayModel, workbenchModelGroup } from './workbench-agent-selection'

function selectedEffort(value: string | undefined, group: ModelProviderModelGroup | undefined, model: string): ComposerReasoningEffort {
  if (!group?.nativeHarnessId) return directReasoningEffort(value ?? 'auto', group, model)
  const choices = nativeReasoningChoices(group.modelInfo?.[model])
  const effort = value ?? 'auto'
  return choices === undefined || choices.includes(effort as ComposerReasoningEffort) ? effort as ComposerReasoningEffort : 'auto'
}

/** Code's model catalog and controls, restricted to this identity's fixed engine and account. */
export function RoomCodingAgentModelPicker({ agent, model, disabled = false, reasoningEffort, onChange, onReasoningEffortChange }: {
  agent: AgentIdentity
  model?: string
  disabled?: boolean
  reasoningEffort?: string
  onChange: (model: string, effort?: ComposerReasoningEffort) => void
  onReasoningEffortChange?: (effort: ComposerReasoningEffort) => void
}) {
  const { t } = useTranslation('common')
  const executor = agent.executor!
  const id = executor.harnessId
  const native = executor.credentialMode === 'native-login'
  const row = useHarnessStore((state) => state.rows.find((entry) => entry.definition.id === id))
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const catalog = useHarnessStore((state) => state.models[id])
  const providers = useHarnessStore((state) => state.providerGroups[id])
  const fingerprint = harnessModelFingerprint(row)
  const labels = useMemo(() => ({ nativeLogin: t('adeCredential.nativeLogin'), provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway') }), [t])
  const groupId = workbenchModelGroup(executor)
  const groups = adeHarnessModelGroups({ row, models: native ? catalog?.models ?? [] : [],
    modelInfo: native ? catalog?.modelInfo : undefined, providerGroups: native ? [] : providers?.groups,
    labels, hasConfiguredProvider: !native }).filter((group) => group.providerId === groupId)
    .map((group) => native ? { ...group, nativeHarnessId: id } : group)
  const selectedModel = workbenchDisplayModel({ ...executor, model: model ?? executor.model })
  const effort = selectedEffort(reasoningEffort, groups[0], selectedModel)
  // Missing metadata must not make the shared picker's legacy normalization
  // persist an effort merely because the conversation was opened.
  const nativeEfforts = nativeReasoningChoices(groups[0]?.modelInfo?.[selectedModel])
  const reasoningAvailable = !native || Boolean(groups[0]?.modelIds.includes(selectedModel) && nativeEfforts?.length)
  const loading = rowsLoading || (native ? catalog?.loading : providers?.loading)
  const error = rowsError || (native ? catalog?.error : providers?.error)
  useEffect(() => { void loadHarnesses(false, { waitMs: 3_000 }) }, [])
  useEffect(() => {
    if (!row) return
    if (native) void loadHarnessModels(id)
    else void loadHarnessProviderGroups(id)
  }, [id, native, fingerprint, row])
  const refresh = () => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (native) void loadHarnessModels(id, true)
    else void loadHarnessProviderGroups(id, true)
  }
  const emptyModelState = groups.some((group) => group.modelIds.length) ? undefined
    : loading || !row && !error ? 'loading' as const
      : error ? 'agent-failed' as const : 'agent-not-ready' as const
  return <div className="direct-composer-model-picker" data-coding-agent-model-picker={id} aria-busy={Boolean(loading) || disabled}>
    <FloatingComposerModelPicker compact mode="select" agentHarnessId={native ? id : undefined}
      composerModel={selectedModel} composerProviderId={groupId} composerModelGroups={groups}
      composerPickList={groups.flatMap((group) => group.modelIds)} emptyModelState={emptyModelState}
      emptyModelReason={native ? catalog?.errorCode : undefined} canChangeModel={!disabled}
      composerReasoningEffort={effort}
      onComposerModelChange={(next, group) => {
        if (disabled || group !== groupId || !groups.some((entry) => entry.modelIds.includes(next)) || next === selectedModel) return
        onChange(next, selectedEffort(reasoningEffort, groups[0], next))
      }}
      onComposerReasoningEffortChange={onReasoningEffortChange && reasoningAvailable ? (next) => {
        if (!disabled && next !== effort) onReasoningEffortChange(next)
      } : undefined}
      renderFooter={() => <div className="direct-model-panel-footer"><button type="button" disabled={loading} onClick={refresh}>
        <RotateCcw size={13} aria-hidden="true" />{t('directCreationModelsRefresh')}
      </button></div>} />
    {error && !groups.some((group) => group.modelIds.length) ? <div className="direct-composer-model-error" role="alert">
      <span>{t('agentEnablement.modelsUnavailable')}</span>
      <button type="button" disabled={loading} onClick={refresh} aria-label={t('directCreationModelsRefresh')}>
        <RotateCcw size={12} aria-hidden="true" />
      </button>
    </div> : null}
  </div>
}
