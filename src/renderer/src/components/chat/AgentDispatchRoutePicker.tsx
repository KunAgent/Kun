import { useEffect, useMemo, useRef, useState } from 'react'
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
import { routeForRole, routeFromWorkbenchModel, withRouteRole, workbenchModelFromRoute } from './agent-dispatch-card-model'
import { rosterRolesFor } from '@shared/agent-roster'
import { useAgentRoster } from '../../store/agent-roster-store'

/** Read-only route: Agent icon, name and the model as the user knows it. */
export function AgentDispatchRouteLabel({ route, agentName }: { route: AgentDispatchAssignmentRoute; agentName?: string }) {
  const rowName = useHarnessStore((state) => state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const roster = useAgentRoster(undefined, Boolean(route.profileId))
  const name = agentName || rowName || (route.agentId === 'kun' ? 'Kun' : route.agentId)
  const model = workbenchDisplayModel(workbenchModelFromRoute(route))
  const role = route.profileId ? roster.entries.find((entry) => entry.id === route.profileId)?.name ?? route.profileId : undefined
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-ds-muted" data-dispatch-route={route.agentId}>
    <AgentIcon harnessId={route.agentId} size={14} />
    <span className="shrink-0 font-medium text-ds-ink">{name}</span>
    {model ? <span className="min-w-0 truncate" title={model}>· {model}</span> : null}
    {role ? <span className="shrink-0 rounded-md bg-ds-hover px-1.5 text-[11px] text-ds-ink" data-dispatch-route-role={route.profileId}>{role}</span> : null}
  </span>
}

/**
 * Agent + model chooser for one worker on a waiting dispatch card. Discovery
 * reuses the composer caches; the choice stays local to the card and reaches
 * Kun only through `onChange` (a dispatch `update`).
 */
export function AgentDispatchRoutePicker({ route, disabled, onChange, onInteract, onPendingChange, roleUse, workspace, preference = false }: {
  route: AgentDispatchAssignmentRoute
  disabled: boolean
  onChange: (route: AgentDispatchAssignmentRoute) => void
  /** Any pointer or key use of the pickers, menus included (React events cross the portals). */
  onInteract?: () => void
  /** An Agent pick is waiting for its model catalog; the card must not settle without it. */
  onPendingChange?: (pending: boolean) => void
  /** Offer agent roster roles: worker roles for dispatch cards, session roles for task cards. */
  roleUse?: 'worker' | 'session'
  workspace?: string
  /** Advisory choices can retain an Agent before its optional model catalog resolves. */
  preference?: boolean
}) {
  const { t } = useTranslation('common')
  const roster = useAgentRoster(workspace, Boolean(roleUse))
  const roles = roleUse ? rosterRolesFor(roster.entries, roleUse) : []
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
  // An Agent picked before its catalog loaded: shown at once, applied when a model is known.
  const [pendingAgent, setPendingAgent] = useState<string | null>(null)
  // A pick whose catalog settled without a usable model: say so instead of silently reverting.
  const [droppedAgent, setDroppedAgent] = useState<string | null>(null)
  const onPendingChangeRef = useRef(onPendingChange)
  onPendingChangeRef.current = onPendingChange
  useEffect(() => { onPendingChangeRef.current?.(Boolean(pendingAgent)) }, [pendingAgent])
  useEffect(() => () => { onPendingChangeRef.current?.(false) }, [])
  const pendingRow = pendingAgent ? rows.find((entry) => entry.definition.id === pendingAgent) : undefined
  const pendingNative = useHarnessStore((state) => (pendingAgent ? state.models[pendingAgent] : undefined))
  const pendingProviders = useHarnessStore((state) => (pendingAgent ? state.providerGroups[pendingAgent] : undefined))
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
    if (!pendingAgent || !pendingRow) return
    const next = selectWorkbenchAgent({ row: pendingRow, defaults: harnessDefaultsSnapshot()[pendingAgent],
      nativeModels: pendingNative?.models ?? pendingRow.definition.staticModels,
      nativeDefault: pendingNative?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: pendingProviders?.groups ?? [] })
    if (next.model) {
      setPendingAgent(null)
      onChangeRef.current(withRouteRole(routeFromWorkbenchModel(next), route))
      return
    }
    // Both lookups settled without a usable model: drop the pick instead of hanging on it.
    const nativeSettled = !pendingRow.definition.credentialModes.includes('native-login') || (pendingNative && !pendingNative.loading)
    const providersSettled = !pendingRow.definition.credentialModes.some((mode) => mode !== 'native-login') ||
      (pendingProviders && !pendingProviders.loading)
    if (nativeSettled && providersSettled) {
      setDroppedAgent(pendingRow.definition.displayName)
      setPendingAgent(null)
    }
  }, [pendingAgent, pendingRow, pendingNative, pendingProviders, route])

  const refresh = (): void => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (external && row?.definition.credentialModes.includes('native-login')) void loadHarnessModels(id, true)
    if (external && row?.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id, true)
  }
  const selectAgent = (nextId: string): void => {
    const next = rows.find((entry) => entry.definition.id === nextId)
    if (!next || nextId === id || !harnessRowRunsTurns(next) || harnessRowUnavailableCode(next)) return
    setDroppedAgent(null)
    if (preference) {
      setPendingAgent(null)
      onChange({ agentId: nextId })
      return
    }
    const state = useHarnessStore.getState()
    const model = selectWorkbenchAgent({ row: next, defaults: harnessDefaultsSnapshot()[nextId],
      nativeModels: state.models[nextId]?.models ?? next.definition.staticModels,
      nativeDefault: state.models[nextId]?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: nextId === 'kun' ? kunGroups.map((group) => ({ providerId: group.providerId, label: group.label,
        models: group.modelIds })) : state.providerGroups[nextId]?.groups ?? [] })
    if (model.model) { setPendingAgent(null); onChange(withRouteRole(routeFromWorkbenchModel(model), route)); return }
    // Wait for the catalog instead of sending a route Kun would reject for a missing model.
    setPendingAgent(nextId)
    if (next.definition.credentialModes.includes('native-login')) void loadHarnessModels(nextId)
    if (next.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(nextId)
  }
  const selectModel = (model: string, groupId?: string): void => {
    if (!groupId || !model) return
    const group = groups.find((entry) => entry.providerId === groupId)
    if (!group?.modelIds.includes(model)) return
    const { accountId: _account, ...next } = selectWorkbenchModel(current, model, groupId, group.accountId)
    onChange(withRouteRole(routeFromWorkbenchModel(next), route))
  }
  const selectRole = (profileId: string): void => {
    const next = routeForRole(route, roles.find((entry) => entry.id === profileId))
    if (next.agentId !== route.agentId) setPendingAgent(null)
    onChange(next)
  }
  const displayModel = workbenchDisplayModel(current)
  const shownId = pendingAgent ?? id
  const shownRow = pendingRow ?? row
  return <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1" data-dispatch-route-picker={id}
    data-dispatch-route-pending={pendingAgent ?? undefined}
    onPointerDownCapture={onInteract} onKeyDownCapture={onInteract}>
    <FloatingComposerHarnessPicker harnessId={shownId} harnessLabel={shownRow?.definition.displayName ?? (shownId === 'kun' ? 'Kun' : shownId)}
      rows={rows.filter(harnessRowRunsTurns)} loading={loading || Boolean(pendingAgent)} disabled={disabled} needsConfirm={() => false}
      hint={t(preference ? 'dispatchPreference.description' : 'dispatchIntent.agentMenuHint')} onOpen={refresh} onSelect={selectAgent} />
    <FloatingComposerModelPicker compact mode="select" agentHarnessId={external ? id : undefined}
      composerModel={displayModel} composerProviderId={workbenchModelGroup(current)}
      composerPickList={groups.flatMap((group) => group.modelIds)} composerModelGroups={groups}
      emptyModelState={external && (native?.loading || providers?.loading) ? 'loading' : preference && !groups.length ? 'agent-default' : undefined}
      canChangeModel={!disabled} onComposerModelChange={selectModel} />
    {droppedAgent ? <span role="alert" className="basis-full text-[11.5px] text-ds-status-warning" data-dispatch-route-dropped>
      {t('dispatchIntent.agentNoModel', { agent: droppedAgent })}</span> : null}
    {roleUse && (roles.length || route.profileId) ? <select value={route.profileId ?? ''} disabled={disabled}
      aria-label={t('dispatchIntent.roleLabel')} title={t('dispatchIntent.roleHint')} data-dispatch-role-picker={id}
      onChange={(event) => selectRole(event.target.value)}
      className="h-[26px] max-w-[11rem] truncate rounded-lg border border-ds-border bg-ds-card px-1.5 text-[12px] text-ds-ink disabled:opacity-50">
      <option value="">{t('dispatchIntent.roleNone')}</option>
      {route.profileId && !roles.some((entry) => entry.id === route.profileId)
        ? <option value={route.profileId}>{route.profileId}</option> : null}
      {roles.map((entry) => {
        const lane = entry.lanes.worker
        const blocked = roleUse === 'worker' && lane.state === 'blocked'
        return <option key={entry.id} value={entry.id} disabled={blocked}
          title={lane.state === 'blocked' ? lane.message : entry.description}>{entry.name}</option>
      })}
    </select> : null}
  </div>
}
