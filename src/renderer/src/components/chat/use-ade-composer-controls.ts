import { checkHarnessUpdate, useHarnessUpdateStore } from '../../store/harness-update-store'
import { useEffect, useMemo, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import { harnessProfileReady, readyHarnessProfiles } from '@shared/harness-enablement'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { TaskWorkspacePrep } from '../../store/task-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  harnessRowRunsTurns,
  harnessRowAvailable,
  harnessRowUnavailableCode,
  harnessModelFingerprint,
  HARNESS_MODEL_RETRY_DELAYS_MS,
  loadHarnessModels,
  loadHarnessProviderGroups,
  loadHarnesses,
  useHarnessStore
} from '../../store/harness-store'
import { useTaskWorkspaceStore } from '../../store/task-workspace-store'
import { useCodexReferenceEnabled } from '../../history-reference/use-codex-reference-enabled'
import {
  credentialGroupFromKey,
  aliasCredentialGroupKey,
  defaultCredentialModeForRow,
  effectiveHarnessId,
  harnessSwitchNeedsConfirmation,
  adeHarnessModelGroups,
  type AdeCredentialGroupLabels
} from '../../lib/ade-composer-harness'
import { useHarnessDefaults, harnessPermissionDefault } from '../../lib/harness-defaults'
import { useAdeWorktreeGit } from './use-ade-worktree-git'
import { isKunModelProviderGroup } from '../../lib/kun-model-provider-groups'
import { selectHarnessProvider } from '../../lib/harness-provider-selection'
import { useCodeProjectDefaults } from './use-code-project-defaults'
import { readHarnessLastModel, rememberHarnessLastModel } from '../../lib/harness-last-model'

/**
 * ADE composer wiring (docs/ade/12 §7.2–7.4): harness catalog, per-harness
 * model groups keyed by credential mode, native slash commands, and the
 * new-session isolation picker state shared by the Code workbench.
 */
export function useAdeComposerControls(input: {
  enabled: boolean
  activeThreadId: string | null
  workspaceRoot: string
  threadHarnessId: string | undefined
  threadTaskWorkspaceId: string | undefined
  threadHasUserMessages: boolean
  /** Provider-registry groups exist only when a provider is configured. */
  hasConfiguredProvider: boolean
  onComposerModelChange?: (modelId: string, providerId?: string) => void
}) {
  const {
    enabled,
    activeThreadId,
    workspaceRoot,
    threadHarnessId,
    threadTaskWorkspaceId,
    threadHasUserMessages,
    hasConfiguredProvider,
    onComposerModelChange
  } = input
  const { t } = useTranslation('common')
  const labels = useMemo<AdeCredentialGroupLabels>(() => ({
    nativeLogin: t('adeCredential.nativeLogin'),
    provider: t('adeCredential.provider'),
    kunGateway: t('adeCredential.kunGateway')
  }), [t])
  const pendingProvider = useRef<{
    harnessId: string; credentialMode: string; threadId: string | null; workspace: string; draft: number
    previous: { providerId: string; model: string }; defaults: { providerId?: string; model?: string } | undefined
  } | null>(null)
  const previousKunSelection = useRef<{ providerId: string; model: string } | null>(null)
  useEffect(() => { previousKunSelection.current = null }, [activeThreadId, workspaceRoot])
  const harnessDefaults = useHarnessDefaults(enabled)
  const rows = useHarnessStore((state) => state.rows)
  // A background refresh should not make a populated menu look like a cold start.
  const rowsLoading = useHarnessStore((state) => state.rowsLoading && state.rows.length === 0)
  const composerHarnessId = useChatStore((state) => state.composerHarnessId)
  const composerGatewayBinding = useChatStore((state) => state.composerGatewayBinding)
  const setComposerGatewayBinding = useChatStore((state) => state.setComposerGatewayBinding)
  const composerCredentialMode = useChatStore((state) => state.composerCredentialMode)
  const composerProviderId = useChatStore((state) => state.composerProviderId)
  const composerModel = useChatStore((state) => state.composerModel)
  const setComposerHarness = useChatStore((state) => state.setComposerHarness)
  const setComposerModel = useChatStore((state) => state.setComposerModel)
  const isolation = useChatStore((state) => state.composerIsolation)
  const managedDraft = useChatStore((state) => state.adeDraftOpen && !state.activeThreadId)
  const setComposerIsolation = useChatStore((state) => state.setComposerIsolation)
  const setComposerExecutionSettings = useChatStore((state) => state.setComposerExecutionSettings)
  const requestAdeThreadWorkspace = useChatStore((state) => state.requestAdeThreadWorkspace)
  const worktreeGit = useAdeWorktreeGit({ enabled, activeThreadId, workspaceRoot })
  useCodeProjectDefaults({ enabled, activeThreadId, workspaceRoot })
  const providerKind = useChatStore((state) => state.composerModelGroups
    .find((group) => group.providerId === state.composerProviderId)?.kind)
  const harnessId = effectiveHarnessId(composerHarnessId, threadHarnessId, providerKind)
  const row = rows.find((entry) => entry.definition.id === harnessId)
  const rowFingerprint = harnessModelFingerprint(row)
  useEffect(() => {
    if (!enabled) return
    for (const item of rows) {
      if (!item.definition.builtin || item.definition.id === 'kun' || item.enabled !== true || item.status.installed !== 'yes') continue
      const previous = useHarnessUpdateStore.getState().entries[item.definition.id]?.info
      const changed = Boolean(previous && (previous.current.path !== item.status.resolvedCommand || previous.current.version !== item.status.version))
      void checkHarnessUpdate(item.definition.id, changed)
    }
  }, [enabled, rows])
  const modelCache = useHarnessStore((state) => state.models[harnessId])
  const providerGroupCache = useHarnessStore((state) => state.providerGroups[harnessId])
  const session = useHarnessStore((state) =>
    activeThreadId ? state.sessions[activeThreadId] : undefined
  )
  const prep = useTaskWorkspaceStore((state) =>
    activeThreadId ? state.prepByThread[activeThreadId] : undefined
  )

  useEffect(() => {
    // Preload once when Kun is ready; remounts reuse the shared catalog cache.
    if (enabled) void loadHarnesses(false, { waitMs: 3_000 })
  }, [enabled])
  useEffect(() => {
    if (enabled && harnessId !== 'kun') void loadHarnessModels(harnessId)
  }, [enabled, harnessId, rowFingerprint])
  // A failed native catalog lookup (for example a transient backend timeout
  // inside the Agent) retries on its own with backoff instead of waiting for
  // the user to find the refresh button.
  const modelFailures = modelCache?.models.length ? 0 : modelCache?.failures ?? 0
  const modelCatalogFailed = Boolean(modelCache?.error) && !modelCache?.loading && !modelCache?.models.length
  useEffect(() => {
    if (!enabled || harnessId === 'kun' || !modelCatalogFailed || modelCache?.errorCode === 'auth_required') return
    const delay = HARNESS_MODEL_RETRY_DELAYS_MS[modelFailures - 1]
    if (delay === undefined) return
    const timer = setTimeout(() => { void loadHarnessModels(harnessId, true) }, delay)
    return () => clearTimeout(timer)
  }, [enabled, harnessId, modelCatalogFailed, modelFailures, modelCache?.errorCode])
  useEffect(() => {
    if (!composerGatewayBinding || composerModel || composerCredentialMode !== 'kun-gateway') return
    const alias = providerGroupCache?.aliasGroups?.find((entry) => entry.routeId === composerGatewayBinding.main.routeId)
    if (alias) { setComposerModel(alias.modelId, ''); setComposerGatewayBinding(composerGatewayBinding) }
  }, [composerGatewayBinding, composerModel, composerCredentialMode, providerGroupCache?.aliasGroups, setComposerModel, setComposerGatewayBinding])
  const credentialMode = composerCredentialMode.trim() || defaultCredentialModeForRow(row)
  const harnessLabel = row?.definition.displayName ?? harnessId
  const isNativeHarness = harnessId !== 'kun' &&
    Boolean(composerHarnessId.trim() || threadHarnessId?.trim())

  useEffect(() => {
    if (!enabled || harnessId !== 'devin' || credentialMode !== 'native-login' || modelCache?.loading ||
      !composerModel || !modelCache?.models.includes(composerModel) || modelCache.detailsModel === composerModel ||
      modelCache.modelInfo?.find((entry) => entry.id === composerModel)?.reasoningEfforts !== undefined) return
    void loadHarnessModels(harnessId, false, composerModel)
  }, [enabled, harnessId, credentialMode, composerModel, modelCache])

  useEffect(() => {
    if (!enabled || !isNativeHarness || credentialMode !== 'native-login' || modelCache?.loading) return
    const state = useChatStore.getState()
    if (state.activeThreadId !== activeThreadId || state.workspaceRoot !== workspaceRoot ||
      state.composerHarnessId !== harnessId || state.composerModel) return
    const remembered = readHarnessLastModel(harnessId, credentialMode)
    const model = (remembered && remembered.providerId === state.composerProviderId.trim() &&
      modelCache?.models.includes(remembered.model) ? remembered.model : undefined) ??
      modelCache?.modelInfo?.find((entry) => entry.isDefault)?.id ?? modelCache?.models[0]
    if (model) setComposerModel(model, state.composerProviderId, 'settings')
  }, [enabled, isNativeHarness, credentialMode, modelCache, activeThreadId, workspaceRoot, harnessId, setComposerModel])

  // Provider/gateway credential modes need the exposable-provider groups.
  useEffect(() => {
    if (
      enabled && isNativeHarness &&
      row?.definition.credentialModes.some((mode) => mode !== 'native-login')
    ) {
      void loadHarnessProviderGroups(harnessId, true)
    }
  }, [enabled, harnessId, isNativeHarness, rowFingerprint, row?.definition.credentialModes])

  useEffect(() => {
    const pending = pendingProvider.current
    if (!pending || providerGroupCache?.loading || !providerGroupCache) return
    const state = useChatStore.getState()
    if (state.activeThreadId !== pending.threadId || state.workspaceRoot !== pending.workspace ||
      state.adeDraftRevision !== pending.draft || state.composerHarnessId !== pending.harnessId ||
      state.composerCredentialMode !== pending.credentialMode || state.composerModel || state.composerProviderId) {
      pendingProvider.current = null
      return
    }
    pendingProvider.current = null
    const readyRow = rows.find((entry) => entry.definition.id === pending.harnessId)
    const selection = selectHarnessProvider(providerGroupCache.groups.filter((group) => readyRow &&
      harnessProfileReady(readyRow, { harnessId: pending.harnessId, credentialMode: pending.credentialMode as 'provider' | 'kun-gateway', providerId: group.providerId })), pending.defaults, pending.previous)
    if (selection.providerId) setComposerModel(selection.model, selection.providerId)
  }, [providerGroupCache, setComposerModel, rows])

  const harnessCommands = useMemo(() => {
    if (!enabled || !isNativeHarness || !session?.commands?.length) return null
    return { harnessLabel: session.harnessId === harnessId ? harnessLabel : session.harnessId, commands: session.commands }
  }, [enabled, harnessId, harnessLabel, isNativeHarness, session?.commands, session?.harnessId])

  /** Model picker replacement lists; `null` keeps the provider-registry path. */
  const modelGroups = useMemo<ModelProviderModelGroup[] | null>(() => {
    if (!enabled || !isNativeHarness) return null
    // A selected external Agent may outlive a loading or removed catalog row.
    // Keep its model list empty until discovery recovers instead of exposing
    // the Kun provider catalog as if those models belonged to this Agent.
    if (!row) return []
    return adeHarnessModelGroups({
      row,
      models: modelCache?.models ?? [],
      modelInfo: modelCache?.modelInfo,
      providerGroups: providerGroupCache?.groups ?? [],
      aliasGroups: providerGroupCache?.aliasGroups ?? [],
      labels,
      hasConfiguredProvider
    })
  }, [enabled, hasConfiguredProvider, isNativeHarness, labels, modelCache?.models, modelCache?.modelInfo, providerGroupCache?.groups, providerGroupCache?.aliasGroups, row])
  const pickList = modelGroups != null ? [...(modelCache?.models ?? [])] : null

  /** Sentinel group keys (`ade-cred:*`) route the pick through credentialMode. */
  const onModelChange = useMemo(() => {
    if (!enabled || !isNativeHarness) return null
    return (modelId: string, providerId?: string): void => {
      const picked = credentialGroupFromKey(providerId)
      if (picked) {
        if (!row || !harnessProfileReady(row, { harnessId, credentialMode: picked.mode, providerId: picked.providerId, gatewayBinding: picked.gatewayBinding })) return
        setComposerHarness(harnessId, picked.mode)
        // Provider-routed modes carry the picked provider id so the turn
        // resolves `providerId + model` into the grant route; native sign-in
        // pins no provider.
        const pickedProviderId = picked.gatewayBinding ? '' : picked.providerId ?? (picked.mode === 'native-login' ? '' : composerProviderId)
        setComposerModel(modelId, pickedProviderId)
        if (picked.gatewayBinding) setComposerGatewayBinding(picked.gatewayBinding)
        else rememberHarnessLastModel(harnessId, picked.mode, modelId, pickedProviderId)
        return
      }
      onComposerModelChange?.(modelId, providerId)
      const state = useChatStore.getState()
      if (!state.composerGatewayBinding) {
        rememberHarnessLastModel(harnessId, state.composerCredentialMode || credentialMode, state.composerModel, state.composerProviderId)
      }
    }
  }, [composerProviderId, credentialMode, enabled, harnessId, isNativeHarness, row, onComposerModelChange, setComposerHarness, setComposerModel, setComposerGatewayBinding])

  /**
   * External-session continuation (01 §8): a fresh one-to-one thread whose
   * selected harness exposes a `historySource` can import a local session
   * of that source, then the new thread is rebound to the same harness.
   * Hidden while a thread is open or the matching lab flag is off.
   */
  const continuationSource = enabled && !activeThreadId ? row?.definition.historySource : undefined
  const continuationEnabled = useCodexReferenceEnabled(continuationSource)
  const continuation = enabled && continuationSource && continuationEnabled
    ? { source: continuationSource, harnessId }
    : null

  const needsSwitchConfirm = (nextHarnessId: string): boolean =>
    harnessSwitchNeedsConfirmation({
      threadHasUserMessages,
      currentHarnessId: harnessId,
      nextHarnessId
    })

  const selectHarness = (nextId: string, nextCredentialMode?: string): void => {
    const nextRow = rows.find((entry) => entry.definition.id === nextId)
    // P4-13: picker rows are filtered, but a stale persisted pick can still
    // call in with a terminal-only id — it cannot host turns.
    if (nextId !== 'kun' && (!nextRow || !harnessRowRunsTurns(nextRow) || !harnessRowAvailable(nextRow))) return
    // P4-11: the configured per-harness defaults supply whatever the user
    // did not pick explicitly on this switch.
    const defaults = harnessDefaults[nextId]
    const defaultCred = defaults?.credentialMode &&
      nextRow?.definition.credentialModes.includes(defaults.credentialMode)
      ? defaults.credentialMode
      : undefined
    const readyProfiles = nextRow ? readyHarnessProfiles(nextRow) : []
    if (nextId !== 'kun' && nextCredentialMode && !readyProfiles.some((profile) => profile.credentialMode === nextCredentialMode)) return
    const preferredProfiles = readyProfiles.filter((profile) => profile.credentialMode === (nextCredentialMode || defaultCred))
    const selectedProfile = preferredProfiles.find((profile) => profile.credentialMode === (nextCredentialMode || defaultCred) &&
      (defaults?.gatewayBinding ? JSON.stringify(profile.gatewayBinding) === JSON.stringify(defaults.gatewayBinding)
        : profile.providerId === defaults?.providerId && !profile.gatewayBinding)) ?? preferredProfiles[0] ?? readyProfiles[0]
    const cred = selectedProfile?.credentialMode || nextCredentialMode?.trim() || defaultCred || defaultCredentialModeForRow(nextRow)
    const previousState = useChatStore.getState()
    const previous = { providerId: previousState.composerProviderId, model: previousState.composerModel }
    if (harnessId === 'kun' && nextId !== 'kun') previousKunSelection.current = previous
    pendingProvider.current = null
    setComposerHarness(nextId, nextId === 'kun' ? '' : cred)
    // A stale provider-catalog model id must not leak into the new harness —
    // prefer the saved default, then its first advertised model, else clear
    // so kun applies defaults.
    const models = nextId === 'kun'
      ? []
      : (useHarnessStore.getState().models[nextId]?.models ?? nextRow?.definition.staticModels ?? [])
    if (nextId === 'kun') {
      const groups = previousState.composerModelGroups.filter(isKunModelProviderGroup)
        .map((group) => ({ providerId: group.providerId, label: group.label, models: group.modelIds }))
      const remembered = previousKunSelection.current
      const restore = remembered && groups.some((group) =>
        group.providerId === remembered.providerId && group.models.includes(remembered.model)
      ) ? remembered : null
      const selection = selectHarnessProvider(groups, restore ? undefined : defaults, restore ?? previous)
      setComposerModel(selection.model, selection.providerId)
    } else if (selectedProfile?.gatewayBinding) {
      const binding = selectedProfile.gatewayBinding
      const alias = useHarnessStore.getState().providerGroups[nextId]?.aliasGroups?.find((entry) => entry.routeId === binding.main.routeId)
      setComposerModel(alias?.modelId ?? '', '')
      setComposerGatewayBinding(binding)
      if (!alias) void loadHarnessProviderGroups(nextId)
    } else if (cred !== 'native-login') {
      const lastPicked = readHarnessLastModel(nextId, cred) ?? previous
      const cache = useHarnessStore.getState().providerGroups[nextId]
      const selection = selectHarnessProvider((cache?.groups ?? []).filter((group) => !nextRow || harnessProfileReady(nextRow, { harnessId: nextId, credentialMode: cred as 'provider' | 'kun-gateway', providerId: group.providerId })),
        selectedProfile?.providerId ? { ...defaults, providerId: selectedProfile.providerId } : defaults, lastPicked)
      setComposerModel(selection.model, selection.providerId)
      if (!cache || cache.loading || cache.error) {
        const state = useChatStore.getState()
        pendingProvider.current = { harnessId: nextId, credentialMode: cred,
          threadId: state.activeThreadId, workspace: state.workspaceRoot, draft: state.adeDraftRevision,
          previous: lastPicked, defaults: selectedProfile?.providerId ? { ...defaults, providerId: selectedProfile.providerId } : defaults }
        void loadHarnessProviderGroups(nextId)
      }
    } else {
      const nativeDefault = useHarnessStore.getState().models[nextId]?.modelInfo?.find((entry) => entry.isDefault)?.id
      const remembered = readHarnessLastModel(nextId, cred)
      const lastPicked = remembered && remembered.providerId === (selectedProfile?.providerId ?? '') &&
        (!models.length || models.includes(remembered.model)) ? remembered.model : undefined
      // An unnamed ready profile is the system account, not a missing default.
      setComposerModel(defaults?.model ?? lastPicked ?? nativeDefault ?? models[0] ?? '', selectedProfile?.providerId ?? '')
    }
    if (managedDraft && defaults?.isolation) {
      setComposerIsolation(
        defaults.isolation,
        defaults.isolation === 'worktree' ? { kind: 'default-branch' } : undefined
      )
    }
    const permissionDefault = harnessPermissionDefault(nextRow?.definition, defaults)
    if (permissionDefault) setComposerExecutionSettings(permissionDefault)
    if (pendingProvider.current) pendingProvider.current.draft = useChatStore.getState().adeDraftRevision
  }

  return {
    enabled,
    // P4-13: terminal-only agents live in the catalog for the terminal menu
    // and `harness_list`, but they cannot host turns — keep them out.
    rows: rows.filter((entry) => harnessRowRunsTurns(entry) && harnessRowAvailable(entry)),
    rowsLoading,
    harnessId,
    credentialMode,
    gatewayBinding: composerGatewayBinding,
    aliasGroupKey: composerGatewayBinding ? aliasCredentialGroupKey(composerGatewayBinding) : undefined,
    harnessLabel,
    isNativeHarness,
    /** Native permission ladder of the selected Agent plus its saved preference. */
    permissionModes: row?.definition.permissionModes,
    requestedPermissionMode: harnessDefaults[harnessId]?.permissionMode,
    transport: row?.definition.transport,
    rowUnavailableCode: harnessRowUnavailableCode,
    refreshRows: () => {
      void loadHarnesses()
      if (harnessId !== 'kun') void loadHarnessModels(harnessId)
    },
    pickList,
    modelGroups,
    modelsLoading: modelCache?.loading === true,
    /** Native catalog failure reason (code or message) when no models are known. */
    modelsError: modelCatalogFailed ? modelCache?.errorCode ?? 'unavailable' : undefined,
    modelsRetrying: modelCatalogFailed && modelCache?.errorCode !== 'auth_required' &&
      HARNESS_MODEL_RETRY_DELAYS_MS[modelFailures - 1] !== undefined,
    /** The selected native-login profile has no current readiness proof. */
    nativeProfileReady: row ? readyHarnessProfiles(row).some((profile) => profile.credentialMode === 'native-login') : false,
    onModelChange,
    harnessCommands,
    needsSwitchConfirm,
    selectHarness,
    continuation,
    isolation,
    managedDraft,
    worktreeGit,
    selectIsolation: (next: 'local' | 'worktree'): void => {
      if (next === 'worktree' && worktreeGit.status === 'not-git') return
      setComposerIsolation(next, next === 'worktree' ? { kind: 'default-branch' } : undefined)
    },
    prep: prep as TaskWorkspacePrep | undefined,
    boundWorkspaceId: threadTaskWorkspaceId?.trim() || prep?.workspaceId || undefined,
    retryWorkspacePrep: (): void => {
      if (activeThreadId) void requestAdeThreadWorkspace(activeThreadId, worktreeGit.startFrom)
    }
  }
}
