import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { reasoningLabelKey, resolveComposerReasoningSelection, type ComposerReasoningEffort } from './floating-composer-model-picker-logic'
import { selectWorkbenchAgent, selectWorkbenchModel, workbenchDisplayModel, workbenchModelGroup } from '../rooms/workbench-agent-selection'
import { routeForRole, routeFromWorkbenchModel, withRouteRole, workbenchModelFromRoute } from './agent-dispatch-card-model'
import { rosterRolesFor } from '@shared/agent-roster'
import { useAgentRoster } from '../../store/agent-roster-store'

/** Read-only route: Agent icon, name and the model as the user knows it. */
export function AgentDispatchRouteLabel({ route, agentName }: { route: AgentDispatchAssignmentRoute; agentName?: string }) {
  const { t } = useTranslation('common')
  const rowName = useHarnessStore((state) => state.rows.find((row) => row.definition.id === route.agentId)?.definition.displayName)
  const roster = useAgentRoster(undefined, Boolean(route.profileId))
  const name = agentName || rowName || (route.agentId === 'kun' ? 'Kun' : route.agentId)
  const model = workbenchDisplayModel(workbenchModelFromRoute(route))
  const role = route.profileId ? roster.entries.find((entry) => entry.id === route.profileId)?.name ?? route.profileId : undefined
  return <span className="inline-flex min-w-0 max-w-full items-center gap-1.5 text-[12px] text-ds-muted" data-dispatch-route={route.agentId}>
    <AgentIcon harnessId={route.agentId} size={14} />
    <span className="shrink-0 font-medium text-ds-ink">{name}</span>
    {model ? <span className="min-w-0 truncate" title={model}>· {model}</span> : null}
    {route.reasoningEffort ? <span className="shrink-0" data-dispatch-reasoning={route.reasoningEffort}>
      · {t('composerReasoning')} {t(reasoningLabelKey(route.reasoningEffort))}
    </span> : null}
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
  // An Agent picked before its catalog loaded: shown at once, applied when a model is known.
  const [pendingAgent, setPendingAgent] = useState<string | null>(null)
  const shownId = pendingAgent ?? id
  const external = shownId !== 'kun'
  const row = rows.find((entry) => entry.definition.id === shownId)
  const native = useHarnessStore((state) => state.models[shownId])
  const providers = useHarnessStore((state) => state.providerGroups[shownId])
  const fingerprint = harnessModelFingerprint(row)
  const current = workbenchModelFromRoute(pendingAgent ? { agentId: pendingAgent } : route)
  const savedRoutes = useRef(new Map<string, AgentDispatchAssignmentRoute>())
  useEffect(() => { savedRoutes.current.set(id, route) }, [id, route])
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  // Advisory preferences and session suggestions have separate execution contracts.
  const canChooseReasoning = !preference && roleUse !== 'session'
  // A pick whose catalog settled without a usable model: say so instead of silently reverting.
  const [droppedAgent, setDroppedAgent] = useState<string | null>(null)
  const onPendingChangeRef = useRef(onPendingChange)
  onPendingChangeRef.current = onPendingChange
  useEffect(() => { onPendingChangeRef.current?.(Boolean(pendingAgent) || modelMenuOpen) }, [pendingAgent, modelMenuOpen])
  useEffect(() => () => { onPendingChangeRef.current?.(false) }, [])
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const labels = useMemo(() => ({ nativeLogin: t('adeCredential.nativeLogin'), provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway') }), [t])
  const kunGroups = useMemo(() => baseGroups.filter(isKunModelProviderGroup), [baseGroups])
  const groups = useMemo(() => external ? adeHarnessModelGroups({ row,
    models: native?.models ?? row?.definition.staticModels ?? [], modelInfo: native?.modelInfo,
    providerGroups: providers?.groups ?? [], labels, hasConfiguredProvider: true }) : kunGroups,
  [external, row, native, providers, labels, kunGroups])
  const resolveAgent = useCallback(() => {
    if (!row) return undefined
    const saved = savedRoutes.current.get(shownId)
    if (saved?.model) {
      const model = workbenchModelFromRoute(saved)
      if (groups.some((group) => group.providerId === workbenchModelGroup(model) &&
        group.modelIds.includes(workbenchDisplayModel(model)))) return model
    }
    const candidate = selectWorkbenchAgent({ row, defaults: harnessDefaultsSnapshot()[shownId],
      nativeModels: native?.models ?? row.definition.staticModels,
      nativeDefault: native?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: external ? providers?.groups ?? [] : kunGroups.map((group) => ({
        providerId: group.providerId, label: group.label, models: group.modelIds })) })
    const group = groups.find((entry) => entry.providerId === workbenchModelGroup(candidate))
    if (!group?.modelIds.length) return undefined
    if (group.modelIds.includes(workbenchDisplayModel(candidate))) return candidate
    // Saved defaults may reference a removed model, or predate the live lookup.
    // Submit only models from a currently ready credential group.
    const reportedDefault = native?.modelInfo?.find((entry) => entry.isDefault)?.id
    const model = reportedDefault && group.modelIds.includes(reportedDefault) ? reportedDefault : group.modelIds[0]
    return selectWorkbenchModel(candidate, model, group.providerId, group.accountId)
  }, [row, shownId, groups, native, external, providers, kunGroups])

  useEffect(() => { void loadHarnesses(false, { waitMs: 3_000 }) }, [])
  useEffect(() => {
    if (!external || !row || disabled) return
    if (row.definition.credentialModes.includes('native-login')) void loadHarnessModels(shownId)
    if (row.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(shownId)
  }, [external, shownId, fingerprint, row, disabled])
  // A newly chosen Agent may not have its catalog yet; pick its default model once it lands.
  useEffect(() => {
    if (!pendingAgent || !row || disabled) return
    const next = resolveAgent()
    if (next?.model) {
      setPendingAgent(null)
      onChangeRef.current(withRouteRole(routeFromWorkbenchModel(next), route))
      return
    }
    // Discovery may have started a retry during this commit; do not drop the
    // pick based on the pre-effect error/empty snapshot.
    const latest = useHarnessStore.getState()
    const nativeSettled = !external || !row.definition.credentialModes.includes('native-login') ||
      (latest.models[shownId] && !latest.models[shownId].loading)
    const providersSettled = !external || !row.definition.credentialModes.some((mode) => mode !== 'native-login') ||
      (latest.providerGroups[shownId] && !latest.providerGroups[shownId].loading)
    // Multiple providers can require an explicit model choice; that is not an empty catalog.
    if (nativeSettled && providersSettled && !groups.some((group) => group.modelIds.length)) {
      setDroppedAgent(row.definition.displayName)
      setPendingAgent(null)
    }
  }, [pendingAgent, shownId, row, native, providers, external, groups, resolveAgent, route, disabled])

  const refresh = (): void => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (external && row?.definition.credentialModes.includes('native-login')) void loadHarnessModels(shownId, true)
    if (external && row?.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(shownId, true)
  }
  const selectAgent = (nextId: string): void => {
    if (disabled) return
    setDroppedAgent(null)
    // Selecting the committed Agent cancels a pending switch, even before its lookup settles.
    if (nextId === id) { setPendingAgent(null); return }
    const next = rows.find((entry) => entry.definition.id === nextId)
    if (!next || !harnessRowRunsTurns(next) || harnessRowUnavailableCode(next)) return
    if (preference) {
      setPendingAgent(null)
      onChange({ agentId: nextId })
      return
    }
    // Resolve from the same catalog the model picker displays; never submit an incomplete route.
    setPendingAgent(nextId)
  }
  const selectModel = (model: string, groupId?: string): void => {
    if (disabled || !groupId || !model) return
    const group = groups.find((entry) => entry.providerId === groupId)
    if (!group?.modelIds.includes(model)) return
    const { accountId: _account, ...next } = selectWorkbenchModel(current, model, groupId, group.accountId)
    const reasoning = resolveComposerReasoningSelection({ groups, model, providerId: groupId,
      effort: route.reasoningEffort, requireReportedLevels: true })
    setPendingAgent(null)
    setDroppedAgent(null)
    onChange(withRouteRole({ ...routeFromWorkbenchModel(next),
      ...(canChooseReasoning && reasoning.availability === 'supported' ? { reasoningEffort: reasoning.current } : {}) }, route))
  }
  const selectReasoning = (reasoningEffort: ComposerReasoningEffort): void => {
    if (disabled || pendingAgent || !canChooseReasoning) return
    const reasoning = resolveComposerReasoningSelection({ groups, model: workbenchDisplayModel(current),
      providerId: workbenchModelGroup(current), effort: reasoningEffort, requireReportedLevels: true })
    if (reasoning.options.some((option) => option.id === reasoningEffort)) onChange({ ...route, reasoningEffort })
  }
  const selectRole = (profileId: string): void => {
    const next = routeForRole(route, roles.find((entry) => entry.id === profileId))
    if (next.agentId !== route.agentId) setPendingAgent(null)
    onChange(next)
  }
  const displayModel = workbenchDisplayModel(current)
  return <div className="flex min-w-0 shrink-0 flex-wrap items-center gap-1" data-dispatch-route-picker={id}
    data-dispatch-route-pending={pendingAgent ?? undefined}
    onPointerDownCapture={onInteract} onKeyDownCapture={onInteract}>
    <FloatingComposerHarnessPicker harnessId={shownId} harnessLabel={row?.definition.displayName ?? (shownId === 'kun' ? 'Kun' : shownId)}
      rows={rows.filter(harnessRowRunsTurns)} loading={loading || Boolean(pendingAgent)} disabled={disabled} needsConfirm={() => false}
      hint={t(preference ? 'dispatchPreference.description' : 'dispatchIntent.agentMenuHint')} onOpen={refresh} onSelect={selectAgent} />
    <FloatingComposerModelPicker compact mode="select" agentHarnessId={external ? shownId : undefined}
      composerModel={displayModel} composerProviderId={workbenchModelGroup(current)}
      composerPickList={groups.flatMap((group) => group.modelIds)} composerModelGroups={groups}
      emptyModelState={external && (native?.loading || providers?.loading) ? 'loading' : preference && !groups.length ? 'agent-default' : undefined}
      canChangeModel={!disabled} onComposerModelChange={selectModel}
      reasoningScope={canChooseReasoning && !pendingAgent ? 'task' : undefined} composerReasoningEffort={pendingAgent ? undefined : route.reasoningEffort}
      onComposerReasoningEffortChange={canChooseReasoning && !pendingAgent ? selectReasoning : undefined} onOpenChange={setModelMenuOpen} />
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
