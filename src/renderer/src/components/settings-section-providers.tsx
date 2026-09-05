import type {
  ModelProviderModelProfileV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID,
  defaultModelRequestRetrySettings
} from '@shared/app-settings'
import { defaultModelProviderSettings } from '@shared/app-settings-provider-core'
import type {
  ModelsDevCatalogResult
} from '@shared/kun-gui-api'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactElement
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  providerRetrySettings
} from './settings-section-providers-controls'
import {
  type ProbeState,
  type ProviderCapability, type ProviderTaskTab, type ProviderWorkspaceMode,
  type SubscriptionRegionFilter
} from './settings-section-providers-profile'
import {
  type SharedModelConnection, type SharedModelConnectionsSnapshot
} from './settings-section-providers-shared-api'
import { ProvidersSettingsView } from './settings-section-providers-view'
import { buildProvidersViewModel } from './settings-section-providers-view-model'
import {
  enqueueSharedModelMutation,
  sharedProviderMutationCoordinator
} from './shared-provider-mutation-coordinator'
import { useProviderLifecycleActions } from './use-provider-lifecycle-actions'
import { useProviderProbeOperations } from './use-provider-probe-operations'
import { useProviderProfileMutations } from './use-provider-profile-mutations'
import { useProviderSharedActions } from './use-provider-shared-actions'
import { useProviderSharedSynchronization } from './use-provider-shared-synchronization'
import { settingsSaveIssueMessage } from './settings-save-error'
import { registerProviderMutationFlushOperations } from './provider-mutation-flush'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
export {
  antigravityProviderCatalogPatch,
  geminiCliApiCatalogPatch,
  kunProviderSelectionPatch,
  modelProvidersSettingsPatch,
  nonEmptyModelId
} from './settings-section-providers-profile'
export {
  deleteSharedModelConnection,
  selectSharedModelConnection,
  sharedProviderSetupNeedsApiKey,
  shouldUseSharedModelConnectionProbe
} from './settings-section-providers-shared-api'
export {
  applyPendingSharedProviderCatalog,
  clearPendingSharedProviderDeletionForExplicitAdd,
  commitSharedModelConnectionCatalog,
  connectOrReplaceSharedModelConnectionCredential,
  createSharedModelMutationQueue,
  fenceSharedModelConnectionCredential,
  projectSharedModelConnections,
  rebasePendingSharedProviderCatalog,
  reconcilePendingSharedProviderCatalogs,
  reconcilePendingSharedProviderDeletions,
  reconcilePendingSharedProviderNames,
  replaceSharedModelConnectionCredential,
  sharedConnectionBaseUrlOptional,
  sharedProvidersEligibleForSync,
  type SharedModelConnectionCatalogConnectSource
} from './settings-section-providers-shared-reconcile'







export function mergeProviderDraftForDisplay(
  providers: readonly ModelProviderProfileV1[],
  draftProvider: ModelProviderProfileV1 | null
): ModelProviderProfileV1[] {
  if (!draftProvider) return [...providers]
  const existingIndex = providers.findIndex((provider) => provider.id === draftProvider.id)
  if (existingIndex < 0) return [...providers, draftProvider]
  return providers.map((provider, index) =>
    index === existingIndex ? draftProvider : provider
  )
}

export function ProvidersSettingsSection({ ctx }: { ctx: Record<string, any> }): ReactElement {
  const {
    t,
    form,
    provider: providerFromContext,
    kun,
    update,
    showApiKey,
    setShowApiKey,
    selectControlClass,
    saveStatus,
    saveError,
    saveIssue,
    retrySave
  } = ctx
  const zh = form.locale === 'zh'
  const providerSaveError = saveIssue?.kind === 'provider-model-limit'
    ? settingsSaveIssueMessage(saveIssue, t)
    : saveError
  const provider = providerFromContext ?? defaultModelProviderSettings()
  const modelProviders = provider.providers as ModelProviderProfileV1[]
  const [sharedConnections, setSharedConnections] = useState<SharedModelConnectionsSnapshot | null>(null)
  const [sharedConnectionsError, setSharedConnectionsError] = useState('')
  const [settingsConfigOpenError, setSettingsConfigOpenError] = useState('')
  const sharedSyncFingerprint = useRef('')
  const sharedProjectionPending = useRef(false)
  const pendingSharedProviderDeletions = useRef(sharedProviderMutationCoordinator.pendingDeletions)
  const pendingSharedProviderNames = useRef(sharedProviderMutationCoordinator.pendingNames)
  const pendingSharedProviderCatalogs = useRef(sharedProviderMutationCoordinator.pendingCatalogs)
  const pendingSharedProviderCredentials = useRef(sharedProviderMutationCoordinator.pendingCredentials)
  const catalogMutationTimers = useRef(sharedProviderMutationCoordinator.catalogTimers)
  const credentialMutationTimers = useRef(sharedProviderMutationCoordinator.credentialTimers)
  const mutationOwner = useRef(Symbol('provider-settings-mutation-owner'))
  const mounted = useRef(false)
  const drainCatalogRef = useRef<(providerId: string, generation: number) => void>(() => undefined)
  const drainCredentialRef = useRef<(providerId: string, generation: number) => Promise<void>>(async () => undefined)
  const [credentialDrafts, setCredentialDrafts] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      [...sharedProviderMutationCoordinator.pendingCredentials]
        .map(([providerId, pending]) => [providerId, pending.credential])
    )
  )
  const [, setCredentialSyncVersion] = useState(0)
  const [revealedCredential, setRevealedCredential] = useState<{
    providerId: string
    credential: string
  } | null>(null)
  const [credentialRevealPendingProviderId, setCredentialRevealPendingProviderId] = useState('')
  const [credentialRevealError, setCredentialRevealError] = useState('')
  const credentialRevealGeneration = useRef(0)
  const enqueueSharedMutation = enqueueSharedModelMutation
  const sharedProjectionInput = useRef({ provider, kun, update, form })
  sharedProjectionInput.current = { provider, kun, update, form }
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false }
  }, [])
  const [selectedProviderId, setSelectedProviderId] = useState<string>(
    kun.providerId?.trim() || modelProviders[0]?.id || DEFAULT_MODEL_PROVIDER_ID
  )
  const [addMenuOpen, setAddMenuOpen] = useState(false)
  const [addProviderQuery, setAddProviderQuery] = useState('')
  const [subscriptionRegion, setSubscriptionRegion] = useState<SubscriptionRegionFilter>('all')
  const [providerListQuery, setProviderListQuery] = useState('')
  const [activeTab, setActiveTab] = useState<ProviderTaskTab>('connection')
  const [workspaceMode, setWorkspaceMode] = useState<ProviderWorkspaceMode>('providers')
  const [globalNetworkOpen, setGlobalNetworkOpen] = useState(false)
  const [expandedCapabilities, setExpandedCapabilities] = useState<Set<ProviderCapability>>(new Set())
  useEffect(() => {
    if (saveIssue?.kind !== 'provider-model-limit') return
    setSelectedProviderId(saveIssue.providerId)
    setProviderListQuery('')
    setActiveTab('models')
  }, [saveIssue])
  const addProviderButtonRef = useRef<HTMLButtonElement>(null)
  const addProviderDialogRef = useRef<HTMLElement>(null)
  const previousProviderSelectionRef = useRef<string | null>(null)
  useEffect(() => {
    if (!addMenuOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        setAddMenuOpen(false)
        addProviderButtonRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [addMenuOpen])
  const [probeStates, setProbeStates] = useState<Record<string, ProbeState>>({})
  const [cursorAccounts, setCursorAccounts] = useState<Record<string, {
    fingerprint: string
    label: string
    apiKeyName: string
  }>>({})
  // Pending import dialog: when /v1/models returns hundreds of entries we want
  // the user to choose which ones to keep instead of dropping the whole list
  // into settings and forcing them to delete unwanted models one-by-one (#397).
  const [pendingImport, setPendingImport] = useState<
    | {
        providerId: string
        providerModelIds: string[]
        modelAliases?: Record<string, string[]>
        discoveredModelProfiles?: Record<string, ModelProviderModelProfileV1>
        catalogResult: ModelsDevCatalogResult
        providerError?: string
        authoritative?: boolean
      }
    | null
  >(null)
  const cursorMetadataRepairAttempts = useRef(new Set<string>())
  // 新增供应商先停留在本地草稿,点「添加」才写入设置,避免半配置状态被持久化。
  const [draftProvider, setDraftProvider] = useState<ModelProviderProfileV1 | null>(null)
  useEffect(() => {
    if (!draftProvider || !modelProviders.some((item) => item.id === draftProvider.id)) return
    previousProviderSelectionRef.current = null
    setDraftProvider(null)
    setSelectedProviderId(draftProvider.id)
  }, [draftProvider, modelProviders])
  const displayProviders = useMemo(() => {
    const providersWithCredentialDrafts = modelProviders
      .filter((item) => pendingSharedProviderDeletions.current.get(item.id)?.committedRevision === null ||
        pendingSharedProviderDeletions.current.get(item.id) === undefined)
      .map((item) => {
        const pendingCatalog = pendingSharedProviderCatalogs.current.get(item.id)
        const pendingName = pendingSharedProviderNames.current.get(item.id)
        return {
          ...item,
          ...(pendingName ? { name: pendingName.localName } : {}),
          ...(pendingCatalog
            ? {
                models: [...pendingCatalog.localModels],
                modelProfiles: structuredClone(pendingCatalog.localModelProfiles)
              }
            : {}),
          ...(Object.prototype.hasOwnProperty.call(credentialDrafts, item.id)
            ? { apiKey: credentialDrafts[item.id] ?? '' }
            : {})
        }
      })
    return mergeProviderDraftForDisplay(providersWithCredentialDrafts, draftProvider)
  }, [credentialDrafts, draftProvider, modelProviders])
  const activeProvider =
    displayProviders.find((item) => item.id === selectedProviderId) ??
    modelProviders[0]
  const activeProviderIdRef = useRef(activeProvider?.id ?? '')
  activeProviderIdRef.current = activeProvider?.id ?? ''
  useEffect(() => {
    credentialRevealGeneration.current += 1
    setShowApiKey(false)
    setRevealedCredential(null)
    setCredentialRevealPendingProviderId('')
    setCredentialRevealError('')
  }, [activeProvider?.id, setShowApiKey])
  const sharedConnectionFor = (providerId: string): SharedModelConnection | undefined =>
    sharedConnections?.providers.find((connection) => connection.id === providerId)
  const hasConfiguredCredential = (provider: ModelProviderProfileV1): boolean =>
    Boolean(
      provider.apiKey.trim() ||
      sharedModelConnectionHasUsableCredential(sharedConnectionFor(provider.id))
    )
  useEffect(() => {
    if (displayProviders.some((item) => item.id === selectedProviderId)) return
    setSelectedProviderId(
      sharedConnections?.defaultProviderId &&
      displayProviders.some((item) => item.id === sharedConnections.defaultProviderId)
        ? sharedConnections.defaultProviderId
        : displayProviders[0]?.id ?? DEFAULT_MODEL_PROVIDER_ID
    )
  }, [displayProviders, selectedProviderId, sharedConnections?.defaultProviderId])
  const activeRetry = activeProvider ? providerRetrySettings(activeProvider) : defaultModelRequestRetrySettings()
  const isDraftActive = Boolean(draftProvider && activeProvider?.id === draftProvider.id)
  const canEditActiveProviderId = isDraftActive
  const activeKunProviderId: string = kun.providerId?.trim() || DEFAULT_MODEL_PROVIDER_ID
  const providerProxy = provider.proxy ?? { enabled: false, url: '' }

  useProviderSharedSynchronization({ form, kun, update, saveStatus, provider, modelProviders,
    sharedConnections, setSharedConnections, setSharedConnectionsError, sharedSyncFingerprint,
    sharedProjectionPending, pendingSharedProviderDeletions, pendingSharedProviderNames,
    pendingSharedProviderCatalogs, pendingSharedProviderCredentials, enqueueSharedMutation,
    sharedProjectionInput, onSharedSyncRecovered: () => {
      for (const [providerId, pending] of pendingSharedProviderCredentials.current) {
        void drainCredentialRef.current(providerId, pending.generation).catch(() => undefined)
      }
    } })

  const { selectSharedModel, updateProviderProxy, setCapabilityExpanded, openAddProviderDialog,
    closeAddProviderDialog, handleAddProviderDialogKeyDown, handleSubscriptionRegionTabKeyDown,
    confirmAction, updateModelProviders, stageSharedProviderCatalog, flushSharedProviderCatalog,
    stageSharedProviderCredential, flushSharedProviderCredential, drainSharedProviderProfile,
    drainSharedProviderCatalog, drainSharedProviderCredential
  } = useProviderSharedActions({ kun, update, provider, setSharedConnections,
    setSharedConnectionsError, pendingSharedProviderDeletions, pendingSharedProviderNames,
    pendingSharedProviderCatalogs,
    pendingSharedProviderCredentials, catalogMutationTimers, credentialMutationTimers,
    mutationOwner, mounted, drainCatalogRef, drainCredentialRef, setCredentialDrafts,
    setCredentialSyncVersion,
    enqueueSharedMutation, sharedProjectionInput, setAddMenuOpen, setAddProviderQuery,
    setSubscriptionRegion, setExpandedCapabilities, addProviderButtonRef, addProviderDialogRef,
    providerProxy })

  useEffect(() => registerProviderMutationFlushOperations({
    drainProfile: drainSharedProviderProfile,
    drainCatalog: drainSharedProviderCatalog,
    drainCredential: drainSharedProviderCredential,
    drainDeletion: async () => undefined
  }), [drainSharedProviderProfile, drainSharedProviderCatalog, drainSharedProviderCredential])

  const { patchProviderProfile, updateModelProvider, updateActiveProviderCredential,
    toggleActiveProviderCredentialVisibility, updateModelProviderImage, removeModelProviderImage,
    updateModelProviderSpeech, removeModelProviderSpeech, updateModelProviderTextToSpeech,
    removeModelProviderTextToSpeech, updateModelProviderMusic, removeModelProviderMusic,
    updateModelProviderVideo, removeModelProviderVideo } = useProviderProfileMutations({
    showApiKey, setShowApiKey, zh, modelProviders, pendingSharedProviderNames, mounted,
    setRevealedCredential, setCredentialRevealPendingProviderId, setCredentialRevealError,
    credentialRevealGeneration, draftProvider, setDraftProvider, displayProviders, activeProvider,
    activeProviderIdRef, sharedConnectionFor, updateModelProviders, stageSharedProviderCatalog,
    stageSharedProviderCredential })

  const { updateModelProviderId, commitProviderDraft, cancelProviderDraft, addModelProvider,
    addPresetModelProvider, removeModelProvider, fetchModelsDevCatalogFor, openModelImport
  } = useProviderLifecycleActions({ t, form, kun, provider, modelProviders, setSharedConnections,
    setSharedConnectionsError, pendingSharedProviderDeletions, pendingSharedProviderNames,
    pendingSharedProviderCatalogs, pendingSharedProviderCredentials, catalogMutationTimers,
    credentialMutationTimers, mounted, setCredentialDrafts, enqueueSharedMutation,
    sharedProjectionInput,
    selectedProviderId, setSelectedProviderId, activeTab, setActiveTab,
    previousProviderSelectionRef, setProbeStates, setPendingImport, cursorMetadataRepairAttempts,
    draftProvider, setDraftProvider, displayProviders, activeProvider, activeKunProviderId,
    confirmAction, updateModelProviders, patchProviderProfile })

  const { runProbe, importPickedModels } = useProviderProbeOperations({ t, setProbeStates,
    setCursorAccounts, sharedConnectionFor, patchProviderProfile, fetchModelsDevCatalogFor,
    openModelImport, flushSharedProviderCatalog, providerProxy })

  const { activeProbe, probeBusy, probeNotice, activeBaseUrlInvalid, activeImageBaseUrlInvalid, activeSpeechBaseUrlInvalid, activeSpeechToggleDisabled, activeTextToSpeechBaseUrlInvalid, activeMusicBaseUrlInvalid, activeVideoBaseUrlInvalid, activeMissingCredential, providerSetupNeedsApiKey, activeProbeBlocked, activeCursorAccount, activeCursorAccountFresh, activeCursorApiKeyUrl, activeSharedConnection, activeCredentialNeedsReplacement, activeApiKeyPlaceholder, activeApiKeyValue, activeCredentialRevealBusy, activeTokenPlanRegions, filteredProviders, freeProviders, planProviders, apiProviders, grouped, renderProviderButton, freeAddEntries, planAddEntries, apiAddEntries, showPlanAddGroup, renderAddEntry, pendingImportProvider } = buildProvidersViewModel({ t, showApiKey, modelProviders,
    sharedConnections, revealedCredential, credentialRevealPendingProviderId, setSelectedProviderId,
    addProviderQuery, subscriptionRegion, providerListQuery, probeStates, cursorAccounts,
    pendingImport, draftProvider, displayProviders, activeProvider, sharedConnectionFor,
    hasConfiguredCredential, activeKunProviderId, closeAddProviderDialog, addPresetModelProvider,
    updateProviderProxy, updateModelProvider, setGlobalNetworkOpen, providerProxy, runProbe })

  const openSettingsConfigFile = async (): Promise<void> => {
    setSettingsConfigOpenError('')
    const result = await window.kunGui.openSettingsConfigFile()
    if (!result.ok) setSettingsConfigOpenError(result.message ?? t('modelProviderConfigOpenFailed'))
  }

  const view = { t, kun, update, showApiKey, selectControlClass, saveStatus, saveError: providerSaveError, saveIssue, retrySave, zh, provider, sharedConnections, sharedConnectionsError, settingsConfigOpenError, openSettingsConfigFile, credentialRevealError, setSelectedProviderId, addMenuOpen, addProviderQuery, setAddProviderQuery, subscriptionRegion, setSubscriptionRegion, providerListQuery, setProviderListQuery, activeTab, setActiveTab, workspaceMode, setWorkspaceMode, globalNetworkOpen, setGlobalNetworkOpen, expandedCapabilities, addProviderButtonRef, addProviderDialogRef, pendingImport, setPendingImport, displayProviders, activeProvider, activeRetry, isDraftActive, canEditActiveProviderId, activeKunProviderId, providerProxy, selectSharedModel, updateProviderProxy, setCapabilityExpanded, openAddProviderDialog, closeAddProviderDialog, handleAddProviderDialogKeyDown, handleSubscriptionRegionTabKeyDown, patchProviderProfile, updateModelProvider, updateActiveProviderCredential, toggleActiveProviderCredentialVisibility, flushSharedProviderCredential, updateModelProviderImage, removeModelProviderImage, updateModelProviderSpeech, removeModelProviderSpeech, updateModelProviderTextToSpeech, removeModelProviderTextToSpeech, updateModelProviderMusic, removeModelProviderMusic, updateModelProviderVideo, removeModelProviderVideo, updateModelProviderId, commitProviderDraft, cancelProviderDraft, addModelProvider, removeModelProvider, runProbe, importPickedModels, activeProbe, probeBusy, probeNotice, activeBaseUrlInvalid, activeImageBaseUrlInvalid, activeSpeechBaseUrlInvalid, activeSpeechToggleDisabled, activeTextToSpeechBaseUrlInvalid, activeMusicBaseUrlInvalid, activeVideoBaseUrlInvalid, activeMissingCredential, providerSetupNeedsApiKey, activeProbeBlocked, activeCursorAccount, activeCursorAccountFresh, activeCursorApiKeyUrl, activeSharedConnection, activeCredentialNeedsReplacement, activeApiKeyPlaceholder, activeApiKeyValue, activeCredentialRevealBusy, activeTokenPlanRegions, filteredProviders, freeProviders, planProviders, apiProviders, grouped, renderProviderButton, freeAddEntries, planAddEntries, apiAddEntries, showPlanAddGroup, renderAddEntry, pendingImportProvider }
  return <ProvidersSettingsView view={view} />
}
