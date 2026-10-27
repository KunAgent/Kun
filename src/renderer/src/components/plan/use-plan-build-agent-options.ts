import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { PlanBuildRoute } from '../../plan/plan-build-agent-store'
import { planBuildEffortChoices } from '../../plan/plan-build-effort'
import { useChatStore } from '../../store/chat-store'
import {
  harnessModelFingerprint,
  harnessRowRunsTurns,
  harnessRowUnavailableCode,
  loadHarnessModels,
  loadHarnessProviderGroups,
  loadHarnesses,
  useHarnessStore
} from '../../store/harness-store'
import { adeHarnessModelGroups } from '../../lib/ade-composer-harness'
import { harnessDefaultsSnapshot } from '../../lib/harness-defaults'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import {
  selectWorkbenchAgent,
  selectWorkbenchModel,
  workbenchDisplayModel,
  workbenchModelGroup
} from '../rooms/workbench-agent-selection'
import {
  routeFromWorkbenchModel,
  workbenchModelFromRoute
} from '../chat/agent-dispatch-card-model'

/**
 * Agent rows + model catalog for the plan build picker. Discovery reuses the
 * composer caches (same loaders as the dispatch card); the pick reaches the
 * plan only through `onChange`.
 */
export function usePlanBuildAgentOptions(
  route: PlanBuildRoute,
  disabled: boolean,
  onChange: (route: PlanBuildRoute) => void
) {
  const { t } = useTranslation('common')
  const baseGroups = useChatStore((state) => state.composerModelGroups)
  const allRows = useHarnessStore((state) => state.rows)
  const loading = useHarnessStore((state) => state.rowsLoading)
  const id = route.agentId
  const external = id !== 'kun'
  const rows = useMemo(() => allRows.filter(harnessRowRunsTurns), [allRows])
  const row = allRows.find((entry) => entry.definition.id === id)
  const native = useHarnessStore((state) => state.models[id])
  const providers = useHarnessStore((state) => state.providerGroups[id])
  const fingerprint = harnessModelFingerprint(row)
  const current = workbenchModelFromRoute(route)
  // An Agent picked before its catalog loaded: shown at once, applied when a model is known.
  const [pendingAgent, setPendingAgent] = useState<string | null>(null)
  const pendingRow = pendingAgent ? allRows.find((entry) => entry.definition.id === pendingAgent) : undefined
  const pendingNative = useHarnessStore((state) => (pendingAgent ? state.models[pendingAgent] : undefined))
  const pendingProviders = useHarnessStore((state) => (pendingAgent ? state.providerGroups[pendingAgent] : undefined))
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const labels = useMemo(() => ({
    nativeLogin: t('adeCredential.nativeLogin'),
    provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway')
  }), [t])
  const kunGroups = useMemo(() => baseGroups.filter(isKunModelProviderGroup), [baseGroups])
  const groups: ModelProviderModelGroup[] = external
    ? adeHarnessModelGroups({
        row,
        models: native?.models ?? [],
        modelInfo: native?.modelInfo,
        providerGroups: providers?.groups ?? [],
        labels,
        hasConfiguredProvider: true
      })
    : kunGroups

  useEffect(() => { void loadHarnesses(false, { waitMs: 3_000 }) }, [])
  useEffect(() => {
    if (!external || !row || disabled) return
    if (row.definition.credentialModes.includes('native-login')) void loadHarnessModels(id)
    if (row.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id)
  }, [external, id, fingerprint, row, disabled])
  // A newly chosen Agent may not have its catalog yet; pick its default model once it lands.
  useEffect(() => {
    if (!pendingAgent || !pendingRow) return
    const next = selectWorkbenchAgent({
      row: pendingRow,
      defaults: harnessDefaultsSnapshot()[pendingAgent],
      nativeModels: pendingNative?.models ?? pendingRow.definition.staticModels,
      nativeDefault: pendingNative?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: pendingProviders?.groups ?? []
    })
    if (next.model) {
      setPendingAgent(null)
      onChangeRef.current(routeFromWorkbenchModel(next))
      return
    }
    // Both lookups settled without a usable model: drop the pick instead of hanging on it.
    const modes = pendingRow.definition.credentialModes
    const nativeSettled = !modes.includes('native-login') || (pendingNative && !pendingNative.loading)
    const providersSettled = !modes.some((mode) => mode !== 'native-login') || (pendingProviders && !pendingProviders.loading)
    if (nativeSettled && providersSettled) setPendingAgent(null)
  }, [pendingAgent, pendingRow, pendingNative, pendingProviders])

  const refresh = (): void => {
    void loadHarnesses(true, { waitMs: 3_000 })
    if (external && row?.definition.credentialModes.includes('native-login')) void loadHarnessModels(id, true)
    if (external && row?.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(id, true)
  }

  const selectAgent = (nextId: string): void => {
    const next = allRows.find((entry) => entry.definition.id === nextId)
    if (!next || nextId === id || !harnessRowRunsTurns(next) || harnessRowUnavailableCode(next)) return
    const state = useHarnessStore.getState()
    const model = selectWorkbenchAgent({
      row: next,
      defaults: harnessDefaultsSnapshot()[nextId],
      nativeModels: state.models[nextId]?.models ?? next.definition.staticModels,
      nativeDefault: state.models[nextId]?.modelInfo?.find((entry) => entry.isDefault)?.id,
      providerGroups: nextId === 'kun'
        ? kunGroups.map((group) => ({ providerId: group.providerId, label: group.label, models: group.modelIds }))
        : state.providerGroups[nextId]?.groups ?? []
    })
    if (model.model) {
      setPendingAgent(null)
      onChange(routeFromWorkbenchModel(model))
      return
    }
    // Wait for the catalog instead of sending a route Kun would reject for a missing model.
    setPendingAgent(nextId)
    if (next.definition.credentialModes.includes('native-login')) void loadHarnessModels(nextId)
    if (next.definition.credentialModes.some((mode) => mode !== 'native-login')) void loadHarnessProviderGroups(nextId)
  }

  const selectModel = (model: string, groupId: string): void => {
    const group = groups.find((entry) => entry.providerId === groupId)
    if (!group?.modelIds.includes(model)) return
    const { accountId: _account, ...next } = selectWorkbenchModel(current, model, groupId, group.accountId)
    // The level carries over; the menu falls back to auto where the new model lacks it.
    onChange({ ...routeFromWorkbenchModel(next), ...(route.reasoningEffort ? { reasoningEffort: route.reasoningEffort } : {}) })
  }

  const selectedGroupId = workbenchModelGroup(current)
  const displayModel = workbenchDisplayModel(current)
  const selectedGroup = groups.find((group) => group.providerId === selectedGroupId) ??
    groups.find((group) => group.modelIds.includes(displayModel))
  const effortChoices = planBuildEffortChoices(selectedGroup, displayModel, external,
    external ? native?.modelInfo?.find((entry) => entry.id === displayModel) : undefined)
  const effort = route.reasoningEffort && effortChoices.includes(route.reasoningEffort) ? route.reasoningEffort : 'auto'
  const selectEffort = (next: string): void => {
    if (!effortChoices.includes(next)) return
    onChange({ ...route, reasoningEffort: next })
  }

  return {
    rows,
    row,
    loading,
    groups,
    external,
    displayModel,
    selectedGroupId,
    effortChoices,
    effort,
    selectEffort,
    modelsLoading: external && Boolean(native?.loading || providers?.loading),
    pendingAgent,
    refresh,
    selectAgent,
    selectModel
  }
}
