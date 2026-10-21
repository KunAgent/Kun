import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { AgentDispatchAssignmentRoute } from '@shared/agent-dispatch'
import { useChatStore } from '../../store/chat-store'
import { harnessModelFingerprint, harnessRowRunsTurns, harnessRowUnavailableCode, loadHarnesses,
  loadHarnessModels, loadHarnessProviderGroups, useHarnessStore } from '../../store/harness-store'
import { adeHarnessModelGroups } from '../../lib/ade-composer-harness'
import { harnessDefaultsSnapshot } from '../../lib/harness-defaults'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { AgentIcon } from '../agent-icon'
import { FloatingComposerHarnessPicker } from './FloatingComposerHarnessPicker'
import { FloatingComposerModelPicker } from './FloatingComposerModelPicker'
import { selectWorkbenchAgent, selectWorkbenchModel, workbenchDisplayModel, workbenchModelGroup } from '../rooms/workbench-agent-selection'
import { routeFromWorkbenchModel, workbenchModelFromRoute } from './agent-dispatch-card-model'

/** Read-only route: Agent icon, name and the model as the user knows it. */
export function AgentDispatchRouteLabel({ route, agentName }: { route: AgentDispatchAssignmentRoute; agentName?: string }) {
  const rowName = useHarnessStore((state) => state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const name = agentName || rowName || (route.agentId === 'kun' ? 'Kun' : route.agentId)
  const model = workbenchDisplayModel(workbenchModelFromRoute(route))
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-ds-muted" data-dispatch-route={route.agentId}>
    <AgentIcon harnessId={route.agentId} size={14} />
    <span className="shrink-0 font-medium text-ds-ink">{name}</span>
    {model ? <span className="min-w-0 truncate" title={model}>· {model}</span> : null}
  </span>
}

/**
 * Agent + model chooser for one worker on a waiting dispatch card. Discovery
 * reuses the composer caches; the choice stays local to the card and reaches
 * Kun only through `onChange` (a dispatch `update`).
 */
export function AgentDispatchRoutePicker({ route, disabled, onChange }: {
  route: AgentDispatchAssignmentRoute
  disabled: boolean
  onChange: (route: AgentDispatchAssignmentRoute) => void
}) {
  const { t } = useTranslation('common')
  const baseGroups = useChatStore((state) => state.composerModelGroups)
  const rows = useHarnessStore((state) => state.rows)
  const loading = useHarnessStore((state) => state.rowsLoading)
  const id = route.agentId
  const external = id !== 'kun'
  const row = rows.find((entry) => entry.definition.id === id)
  const native = useHarnessStore((state) => state.models[id])
  const providers = useHarnessStore((state) => state.providerGroups[id])
  const fingerprint = harnessModelFingerprint(row)
  const current = workbenchModelFromRoute(route)
  const pendingAgent = useRef<string | null>(null)
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const labels = useMemo(() => ({ nativeLogin: t('adeCredential.nativeLogin'), provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway') }), [t])
  const kunGroups = useMemo(() => baseGroups.filter(isKunModelProviderGroup), [baseGroups])
  const groups = external ? adeHarnessModelGroups({ row, models: native?.models ?? [], modelInfo: native?.modelInfo,
    providerGroups: providers?.groups ?? [], labels, hasConfiguredProvider: true }) : kunGroups

  useEffect(() => { void loadHarnesses(false, { waitMs: 3_000 }) }, [])
  useEffect(() => {
    if (!external || !row || disabled) return
    if (row.definition.credentialModes.includes('native-login')) void loadHarnessModels(id)
    if (row.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id)
  }, [external, id, fingerprint, row, disabled])
  // A newly chosen Agent may not have its catalog yet; pick its default model once it lands.
  useEffect(() => {
    if (pendingAgent.current !== id || !row) return
    const next = selectWorkbenchAgent({ row, defaults: harnessDefaultsSnapshot()[id],
      nativeModels: native?.models ?? row.definition.staticModels,
      nativeDefault: native?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: providers?.groups ?? [] })
    if (!next.model) return
    pendingAgent.current = null
    onChangeRef.current(routeFromWorkbenchModel(next))
  }, [id, row, native, providers])

  const refresh = (): void => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (external && row?.definition.credentialModes.includes('native-login')) void loadHarnessModels(id, true)
    if (external && row?.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id, true)
  }
  const selectAgent = (nextId: string): void => {
    const next = rows.find((entry) => entry.definition.id === nextId)
    if (!next || nextId === id || !harnessRowRunsTurns(next) || harnessRowUnavailableCode(next)) return
    const state = useHarnessStore.getState()
    const model = selectWorkbenchAgent({ row: next, defaults: harnessDefaultsSnapshot()[nextId],
      nativeModels: state.models[nextId]?.models ?? next.definition.staticModels,
      nativeDefault: state.models[nextId]?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: nextId === 'kun' ? kunGroups.map((group) => ({ providerId: group.providerId, label: group.label,
        models: group.modelIds })) : state.providerGroups[nextId]?.groups ?? [] })
    if (model.model) { pendingAgent.current = null; onChange(routeFromWorkbenchModel(model)); return }
    // Wait for the catalog instead of sending a route Kun would reject for a missing model.
    pendingAgent.current = nextId
    if (next.definition.credentialModes.includes('native-login')) void loadHarnessModels(nextId)
    if (next.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(nextId)
  }
  const selectModel = (model: string, groupId?: string): void => {
    if (!groupId || !model) return
    const group = groups.find((entry) => entry.providerId === groupId)
    if (!group?.modelIds.includes(model)) return
    const { accountId: _account, ...next } = selectWorkbenchModel(current, model, groupId, group.accountId)
    onChange(routeFromWorkbenchModel(next))
  }
  const displayModel = workbenchDisplayModel(current)
  return <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1" data-dispatch-route-picker={id}>
    <FloatingComposerHarnessPicker harnessId={id} harnessLabel={row?.definition.displayName ?? (id === 'kun' ? 'Kun' : id)}
      rows={rows.filter(harnessRowRunsTurns)} loading={loading} disabled={disabled} needsConfirm={() => false}
      hint={t('dispatchIntent.agentMenuHint')} onOpen={refresh} onSelect={selectAgent} />
    <FloatingComposerModelPicker compact mode="select" agentHarnessId={external ? id : undefined}
      composerModel={displayModel} composerProviderId={workbenchModelGroup(current)}
      composerPickList={groups.flatMap((group) => group.modelIds)} composerModelGroups={groups}
      emptyModelState={external && (native?.loading || providers?.loading) ? 'loading' : undefined}
      canChangeModel={!disabled} onComposerModelChange={selectModel} />
  </div>
}
