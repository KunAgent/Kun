import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { AlertCircle, RefreshCw } from 'lucide-react'
import type { WorkbenchExecution } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { harnessModelFingerprint, harnessRowRunsTurns, harnessRowUnavailableCode, harnessUnavailableLabelKey,
  loadHarnesses, loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { adeHarnessModelGroups } from '../../lib/ade-composer-harness'
import { harnessDefaultsSnapshot } from '../../lib/harness-defaults'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { AgentIcon } from '../agent-icon'
import { FloatingComposerHarnessPicker } from '../chat/FloatingComposerHarnessPicker'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'
import { selectWorkbenchAgent, selectWorkbenchModel, workbenchExternalAgent, workbenchHarnessId,
  workbenchModelGroup, type WorkbenchModel } from './workbench-agent-selection'

/** Read the persisted route even after completion; current composer state is irrelevant. */
export function WorkbenchTaskAgentIdentity({ model }: { model?: WorkbenchModel }) {
  const { t } = useTranslation('common')
  const id = workbenchHarnessId(model)
  const label = useHarnessStore((state) => state.rows.find((row) => row.definition.id === id)?.definition.displayName)
  return <div className="rooms-workbench-agent-identity" data-workbench-agent={id}>
    <span className="rooms-workbench-agent-icon"><AgentIcon harnessId={id} size={20} /></span>
    <span className="rooms-workbench-agent-copy"><strong>{label ?? (id === 'kun' ? 'Kun' : id)}</strong>
      <span title={model?.model}>{model?.model || t('roomsWorkbenchRuntimeModel')}</span></span>
    {model?.credentialMode ? <span className="rooms-workbench-agent-source">{t(model.credentialMode === 'native-login'
      ? 'adeCredential.nativeLogin' : model.credentialMode === 'kun-gateway' ? 'adeCredential.kunGateway' : 'adeCredential.provider')}</span> : null}
  </div>
}

/** Code's discovery caches and picker, with a card-local route instead of global composer mutations. */
export function WorkbenchTaskAgentPicker({ execution, onChange, code }: {
  execution: WorkbenchExecution
  onChange: (execution: WorkbenchExecution) => void
  code: boolean
}) {
  const { t } = useTranslation('common')
  const baseGroups = useChatStore((state) => state.composerModelGroups)
  const rows = useHarnessStore((state) => state.rows)
  const loading = useHarnessStore((state) => state.rowsLoading)
  const rowsError = useHarnessStore((state) => state.rowsError)
  const id = workbenchHarnessId(execution.model)
  const external = code && workbenchExternalAgent(execution.model)
  const row = rows.find((entry) => entry.definition.id === id)
  const native = useHarnessStore((state) => state.models[id])
  const providers = useHarnessStore((state) => state.providerGroups[id])
  const fingerprint = harnessModelFingerprint(row)
  const pendingSelection = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const executionRef = useRef(execution)
  executionRef.current = execution
  const labels = useMemo(() => ({ nativeLogin: t('adeCredential.nativeLogin'), provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway') }), [t])
  const groups = external ? adeHarnessModelGroups({ row, models: native?.models ?? [], modelInfo: native?.modelInfo,
    providerGroups: providers?.groups ?? [], labels, hasConfiguredProvider: true }) : baseGroups.filter(isKunModelProviderGroup)
  const unavailable = row ? harnessRowUnavailableCode(row) : external && !loading ? 'unavailable' : null
  const error = rowsError || (external ? native?.error || providers?.error : undefined)

  useEffect(() => { if (code) void loadHarnesses(false, { waitMs: 3_000 }) }, [code])
  useEffect(() => {
    if (!external || !row) return
    if (row.definition.credentialModes.includes('native-login')) void loadHarnessModels(id)
    if (row.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id)
  }, [external, id, fingerprint, row])
  useEffect(() => {
    if (pendingSelection.current !== id || !row) return
    const current = executionRef.current
    if (current.model?.model) { pendingSelection.current = null; return }
    const candidate = selectWorkbenchAgent({ row, defaults: harnessDefaultsSnapshot()[id],
      nativeModels: native?.models ?? row.definition.staticModels,
      nativeDefault: native?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: providers?.groups ?? [], previous: current.model })
    if (!candidate.model) return
    pendingSelection.current = null
    onChangeRef.current({ ...current, model: candidate })
  }, [id, row, native, providers])

  const refresh = () => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (external) { void loadHarnessModels(id, true); void loadHarnessProviderGroups(id, true) }
  }
  const selectAgent = (nextId: string) => {
    const next = rows.find((entry) => entry.definition.id === nextId)
    if (!next || !harnessRowRunsTurns(next) || harnessRowUnavailableCode(next)) return
    const state = useHarnessStore.getState()
    const model = selectWorkbenchAgent({ row: next, defaults: harnessDefaultsSnapshot()[nextId],
      nativeModels: state.models[nextId]?.models ?? next.definition.staticModels,
      nativeDefault: state.models[nextId]?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: nextId === 'kun' ? baseGroups.filter(isKunModelProviderGroup).map((group) => ({
        providerId: group.providerId, label: group.label, models: group.modelIds })) : state.providerGroups[nextId]?.groups ?? [],
      previous: execution.model })
    pendingSelection.current = model.model ? null : nextId
    // External engines own their loop. Kun-only plan/Graph modes cannot leak across the switch.
    onChange({ ...execution, model, ...(nextId !== 'kun' ? { mode: 'direct', orchestration: 'direct', goalTokenBudget: undefined } : {}) })
  }
  const selectModel = (model: string, groupId?: string) => {
    if (!groupId || !model) return
    pendingSelection.current = null
    const group = groups.find((entry) => entry.providerId === groupId)
    onChange({ ...execution, model: selectWorkbenchModel(execution.model, model, groupId, group?.accountId) })
  }
  return <div className="rooms-workbench-agent-picker rooms-workbench-field-span">
    {code ? <div className="rooms-workbench-agent-heading"><span>{t('roomsWorkbenchAgent')}</span>
      <FloatingComposerHarnessPicker harnessId={id} harnessLabel={row?.definition.displayName ?? (id === 'kun' ? 'Kun' : id)}
        rows={rows.filter(harnessRowRunsTurns)} loading={loading} needsConfirm={() => false}
        onOpen={refresh} onSelect={selectAgent} /></div> : null}
    <div className="rooms-workbench-field"><span>{t('roomsWorkbenchModel')}</span>
      <div className="rooms-workbench-desktop-model"><FloatingComposerModelPicker compact mode="select"
        composerModel={execution.model?.model ?? ''} composerProviderId={workbenchModelGroup(execution.model)}
        composerPickList={groups.flatMap((group) => group.modelIds)} composerModelGroups={groups}
        canChangeModel onComposerModelChange={selectModel} composerReasoningEffort={execution.model?.reasoningEffort}
        onComposerReasoningEffortChange={(reasoningEffort) => execution.model && onChange({ ...execution, model: { ...execution.model, reasoningEffort } })}
        composerFastMode={execution.model?.serviceTier === 'priority'} onComposerFastModeChange={(enabled) => execution.model &&
          onChange({ ...execution, model: { ...execution.model, serviceTier: enabled ? 'priority' : undefined } })} /></div>
      <select className="rooms-workbench-mobile-model" aria-label={t('roomsWorkbenchModel')}
        value={JSON.stringify([workbenchModelGroup(execution.model), execution.model?.model ?? ''])}
        onChange={(event) => { const [group, model] = JSON.parse(event.target.value) as [string, string]; selectModel(model, group) }}>
        <option value={JSON.stringify(['', ''])} disabled>{t('roomsWorkbenchChooseModel')}</option>
        {groups.map((group) => <optgroup key={group.providerId} label={group.label}>{group.modelIds.map((model) =>
          <option key={model} value={JSON.stringify([group.providerId, model])}>{model}</option>)}</optgroup>)}
      </select>
    </div>
    {external && (native?.loading || providers?.loading) ? <p className="rooms-workbench-agent-hint" role="status">{t('roomsWorkbenchAgentLoading')}</p> : null}
    {external ? <p className="rooms-workbench-agent-hint">{t('roomsWorkbenchAgentDirectHint')}</p> : null}
    {error || unavailable ? <div className="rooms-workbench-agent-warning" role="alert"><AlertCircle size={14} />
      <span>{unavailable ? t(harnessUnavailableLabelKey(unavailable)) : t('roomsWorkbenchAgentLoadFailed')}</span>
      <button type="button" onClick={refresh} disabled={loading}><RefreshCw size={13} />{t('roomsWorkbenchAgentRetry')}</button>
    </div> : null}
  </div>
}
