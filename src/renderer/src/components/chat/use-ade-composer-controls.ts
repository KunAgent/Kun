import { useEffect, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { TaskWorkspacePrep } from '../../store/task-workspace-store'
import { useChatStore } from '../../store/chat-store'
import {
  harnessRowAvailable,
  loadHarnessModels,
  loadHarnesses,
  useHarnessStore
} from '../../store/harness-store'
import { useTaskWorkspaceStore } from '../../store/task-workspace-store'
import {
  credentialModeFromGroupKey,
  defaultCredentialModeForRow,
  effectiveHarnessId,
  harnessSwitchNeedsConfirmation,
  adeHarnessModelGroups,
  type AdeCredentialGroupLabels
} from '../../lib/ade-composer-harness'

/**
 * ADE composer wiring (docs/ade/12 §7.2–7.4): harness catalog, per-harness
 * model groups keyed by credential mode, native slash commands, and the
 * new-session isolation picker state. Everything here is inert in Code mode.
 */
export function useAdeComposerControls(input: {
  enabled: boolean
  activeThreadId: string | null
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
  const rows = useHarnessStore((state) => state.rows)
  const rowsLoading = useHarnessStore((state) => state.rowsLoading)
  const composerHarnessId = useChatStore((state) => state.composerHarnessId)
  const composerCredentialMode = useChatStore((state) => state.composerCredentialMode)
  const composerProviderId = useChatStore((state) => state.composerProviderId)
  const setComposerHarness = useChatStore((state) => state.setComposerHarness)
  const setComposerModel = useChatStore((state) => state.setComposerModel)
  const isolation = useChatStore((state) => state.composerIsolation)
  const setComposerIsolation = useChatStore((state) => state.setComposerIsolation)
  const requestAdeThreadWorkspace = useChatStore((state) => state.requestAdeThreadWorkspace)
  const harnessId = effectiveHarnessId(composerHarnessId, threadHarnessId)
  const row = rows.find((entry) => entry.definition.id === harnessId)
  const modelCache = useHarnessStore((state) => state.models[harnessId])
  const session = useHarnessStore((state) =>
    activeThreadId ? state.sessions[activeThreadId] : undefined
  )
  const prep = useTaskWorkspaceStore((state) =>
    activeThreadId ? state.prepByThread[activeThreadId] : undefined
  )

  useEffect(() => {
    if (enabled) void loadHarnesses()
  }, [enabled])
  useEffect(() => {
    if (enabled && harnessId !== 'kun') void loadHarnessModels(harnessId)
  }, [enabled, harnessId])

  const credentialMode = composerCredentialMode.trim() || defaultCredentialModeForRow(row)
  const harnessLabel = row?.definition.displayName ?? harnessId
  const isNativeHarness = harnessId !== 'kun'

  const harnessCommands = useMemo(() => {
    if (!enabled || !isNativeHarness || !session?.commands?.length) return null
    return { harnessLabel: session.harnessId === harnessId ? harnessLabel : session.harnessId, commands: session.commands }
  }, [enabled, harnessId, harnessLabel, isNativeHarness, session?.commands, session?.harnessId])

  /** Model picker replacement lists; `null` keeps the provider-registry path. */
  const modelGroups = useMemo<ModelProviderModelGroup[] | null>(() => {
    if (!enabled || !isNativeHarness || !row) return null
    return adeHarnessModelGroups({
      row,
      models: modelCache?.models ?? [],
      labels,
      hasConfiguredProvider
    })
  }, [enabled, hasConfiguredProvider, isNativeHarness, labels, modelCache?.models, row])
  const pickList = modelGroups != null ? [...(modelCache?.models ?? [])] : null

  /** Sentinel group keys (`ade-cred:*`) route the pick through credentialMode. */
  const onModelChange = useMemo(() => {
    if (!enabled || !isNativeHarness) return null
    return (modelId: string, providerId?: string): void => {
      const picked = credentialModeFromGroupKey(providerId)
      if (picked) {
        setComposerHarness(harnessId, picked)
        setComposerModel(modelId, picked === 'provider' ? composerProviderId : '')
        return
      }
      onComposerModelChange?.(modelId, providerId)
    }
  }, [composerProviderId, enabled, harnessId, isNativeHarness, onComposerModelChange, setComposerHarness, setComposerModel])

  const needsSwitchConfirm = (nextHarnessId: string): boolean =>
    harnessSwitchNeedsConfirmation({
      threadHasUserMessages,
      currentHarnessId: harnessId,
      nextHarnessId
    })

  const selectHarness = (nextId: string, nextCredentialMode?: string): void => {
    const nextRow = rows.find((entry) => entry.definition.id === nextId)
    const cred = nextCredentialMode?.trim() || defaultCredentialModeForRow(nextRow)
    setComposerHarness(nextId === 'kun' ? '' : nextId, nextId === 'kun' ? '' : cred)
    // A stale provider-catalog model id must not leak into the new harness —
    // prefer its first advertised model, else clear so kun applies defaults.
    const models = nextId === 'kun'
      ? []
      : (useHarnessStore.getState().models[nextId]?.models ?? nextRow?.definition.staticModels ?? [])
    setComposerModel(models[0] ?? '', '')
  }

  return {
    enabled,
    rows,
    rowsLoading,
    harnessId,
    credentialMode,
    harnessLabel,
    isNativeHarness,
    rowUnavailableReason: (candidate: AdeHarnessRow): string | null =>
      harnessRowAvailable(candidate) ? null : candidate.status.message ?? 'unavailable',
    refreshRows: () => void loadHarnesses(true),
    pickList,
    modelGroups,
    modelsLoading: modelCache?.loading === true,
    onModelChange,
    harnessCommands,
    needsSwitchConfirm,
    selectHarness,
    isolation,
    selectIsolation: (next: 'local' | 'worktree'): void => {
      setComposerIsolation(next, next === 'worktree' ? { kind: 'default-branch' } : undefined)
    },
    prep: prep as TaskWorkspacePrep | undefined,
    boundWorkspaceId: threadTaskWorkspaceId?.trim() || prep?.workspaceId || undefined,
    retryWorkspacePrep: (): void => {
      if (activeThreadId) void requestAdeThreadWorkspace(activeThreadId, { kind: 'default-branch' })
    }
  }
}
