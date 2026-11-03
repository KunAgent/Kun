import { useCallback, useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import { harnessProfileReady, readyHarnessProfiles } from '@shared/harness-enablement'
import { kunToolPermissionModeSettings } from '@shared/app-settings'
import { useChatStore } from '../../store/chat-store'
import {
  harnessModelFingerprint, harnessRowAvailable, harnessRowRunsTurns,
  loadHarnessModels, loadHarnessProviderGroups, loadHarnesses, useHarnessStore
} from '../../store/harness-store'
import type { SideComposerConfigPatch } from '../../store/chat-store-types'
import type { SideComposerConfig } from '../../store/side-composer-config'
import {
  adeHarnessModelGroups, aliasCredentialGroupKey, credentialGroupFromKey,
  credentialGroupKey, harnessSwitchNeedsConfirmation, type AdeCredentialGroupLabels
} from '../../lib/ade-composer-harness'
import { useHarnessDefaults } from '../../lib/harness-defaults'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { selectHarnessProvider } from '../../lib/harness-provider-selection'

/** Shared catalogs, branch-owned writes. No project defaults or global composer setters. */
export function useSideComposerControls(input: SideComposerConfig & {
  enabled: boolean
  threadId: string | null
  workspaceRoot: string
  hasUserMessages: boolean
  onApply: (patch: SideComposerConfigPatch) => void
}) {
  const { enabled, harnessId, credentialMode, gatewayBinding, model, providerId, hasUserMessages, onApply } = input
  const { t } = useTranslation('common')
  const groups = useChatStore((state) => state.composerModelGroups)
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading && state.rows.length === 0)
  const cache = useHarnessStore((state) => state.models[harnessId])
  const providers = useHarnessStore((state) => state.providerGroups[harnessId])
  const defaults = useHarnessDefaults(enabled)
  const row = rows.find((entry) => entry.definition.id === harnessId)
  const isExternalAgent = harnessId !== 'kun'
  const fingerprint = harnessModelFingerprint(row)
  const refreshRows = useCallback(() => {
    void loadHarnesses()
    if (harnessId !== 'kun') {
      void loadHarnessModels(harnessId, true)
      void loadHarnessProviderGroups(harnessId, true)
    }
  }, [harnessId])
  useEffect(() => { if (enabled) void loadHarnesses(false, { waitMs: 3_000 }) }, [enabled])
  useEffect(() => {
    if (!enabled || harnessId === 'kun') return
    void loadHarnessModels(harnessId)
    void loadHarnessProviderGroups(harnessId)
  }, [enabled, harnessId, fingerprint])
  const labels = useMemo<AdeCredentialGroupLabels>(() => ({
    nativeLogin: t('adeCredential.nativeLogin'), provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway'),
    agentAccount: (agent) => t('adeCredential.agentAccount', { agent }),
    providerName: (id) => {
      const group = groups.find((entry) => entry.providerId === id)
      return group ? { label: group.label, presetSource: group.presetSource } : undefined
    }
  }), [groups, t])
  const modelGroups = useMemo(() => isExternalAgent ? adeHarnessModelGroups({
    row, models: cache?.models ?? [], modelInfo: cache?.modelInfo,
    providerGroups: providers?.groups ?? [], aliasGroups: providers?.aliasGroups ?? [],
    labels, hasConfiguredProvider: groups.length > 0
  }) : groups.filter(isKunModelProviderGroup), [isExternalAgent, row, cache, providers, labels, groups])
  const modelGroupId = gatewayBinding ? aliasCredentialGroupKey(gatewayBinding)
    : isExternalAgent && credentialMode
      ? `${credentialGroupKey(credentialMode)}${providerId ? `:${providerId}` : ''}` : providerId
  const onModelChange = (nextModel: string, groupId?: string): void => {
    if (!enabled) return
    if (!isExternalAgent) {
      onApply({ model: nextModel, providerId: groupId ?? '', reasoningEffort: 'auto', fastMode: false })
      return
    }
    const picked = credentialGroupFromKey(groupId)
    if (!picked || !row || !harnessProfileReady(row, {
      harnessId, credentialMode: picked.mode, providerId: picked.providerId, gatewayBinding: picked.gatewayBinding
    })) return
    if (!modelGroups.some((group) => group.providerId === groupId && group.modelIds.includes(nextModel))) return
    onApply({ model: nextModel, providerId: picked.providerId ?? '', credentialMode: picked.mode,
      gatewayBinding: picked.gatewayBinding, reasoningEffort: 'auto', fastMode: false })
  }
  const selectHarness = (nextId: string): void => {
    if (!enabled || nextId === harnessId) return
    const nextRow = rows.find((entry) => entry.definition.id === nextId)
    if (nextId !== 'kun' && (!nextRow || !harnessRowRunsTurns(nextRow) || !harnessRowAvailable(nextRow))) return
    const preference = defaults[nextId]
    // Switching engines never elevates the branch policy through a saved global default.
    const policy = { ...kunToolPermissionModeSettings('ask-for-approval'),
      ...(input.approvalPolicy ? { approvalPolicy: input.approvalPolicy } : {}),
      ...(input.sandboxMode ? { sandboxMode: input.sandboxMode } : {}),
      ...(input.approvalReviewer ? { approvalReviewer: input.approvalReviewer } : {}) }
    if (nextId === 'kun') {
      const selection = selectHarnessProvider(groups.filter(isKunModelProviderGroup)
        .map((group) => ({ providerId: group.providerId, label: group.label, models: group.modelIds })), preference, {})
      onApply({ harnessId: nextId, credentialMode: undefined, gatewayBinding: undefined,
        ...selection, reasoningEffort: 'auto', fastMode: false, ...policy })
      return
    }
    const profiles = readyHarnessProfiles(nextRow!)
    const profile = profiles.find((item) => item.credentialMode === preference?.credentialMode &&
      (preference?.gatewayBinding ? JSON.stringify(item.gatewayBinding) === JSON.stringify(preference.gatewayBinding)
        : item.providerId === preference?.providerId)) ?? profiles[0]
    if (!profile) return
    const catalog = useHarnessStore.getState()
    const native = catalog.models[nextId]
    const providerCatalog = catalog.providerGroups[nextId]
    const models = profile.credentialMode === 'native-login' ? native?.models ?? nextRow!.definition.staticModels ?? []
      : providerCatalog?.groups.find((group) => group.providerId === profile.providerId)?.models ?? []
    const alias = profile.gatewayBinding && providerCatalog?.aliasGroups?.find((item) => item.routeId === profile.gatewayBinding!.main.routeId)
    const preferredModel = preference?.model && models.includes(preference.model) ? preference.model : undefined
    onApply({ harnessId: nextId, credentialMode: profile.credentialMode,
      gatewayBinding: profile.gatewayBinding, providerId: profile.gatewayBinding ? '' : profile.providerId ?? '',
      model: alias ? alias.modelId : preferredModel ?? models[0] ?? '',
      reasoningEffort: 'auto', fastMode: false, ...policy })
  }
  const selectedReady = !isExternalAgent || Boolean(row && credentialMode && harnessProfileReady(row, {
    harnessId, credentialMode, providerId: providerId || undefined, gatewayBinding
  }))
  const nativeDefault = isExternalAgent && credentialMode === 'native-login' && !model
  const modelReady = nativeDefault || modelGroups.some((group) => group.providerId === modelGroupId && group.modelIds.includes(model))
  return {
    rows: rows.filter(harnessRowRunsTurns), rowsLoading, harnessId,
    harnessLabel: row?.definition.displayName ?? harnessId, isExternalAgent,
    modelGroups, modelProviderId: modelGroupId, pickList: [...new Set(modelGroups.flatMap((group) => group.modelIds))],
    modelsLoading: cache?.loading === true,
    modelsError: cache?.error ? cache.errorCode ?? 'unavailable' : undefined,
    nativeProfileReady: selectedReady,
    selectionReady: selectedReady && (modelReady || (!isExternalAgent && groups.length === 0 && Boolean(model))),
    permissionModes: row?.definition.permissionModes, transport: row?.definition.transport,
    onModelChange, selectHarness, refreshRows,
    needsConfirm: (nextHarnessId: string) => harnessSwitchNeedsConfirmation({
      threadHasUserMessages: hasUserMessages, currentHarnessId: harnessId, nextHarnessId
    })
  }
}
