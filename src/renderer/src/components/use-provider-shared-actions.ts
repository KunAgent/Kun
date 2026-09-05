import type {
  AppSettingsPatch,
  KunRuntimeSettingsPatchV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  useEffect,
  type Dispatch,
  type KeyboardEvent as ReactKeyboardEvent,
  type RefObject,
  type SetStateAction
} from 'react'
import {
  SUBSCRIPTION_REGION_TABS,
  kunProviderSelectionPatch, modelProvidersSettingsPatch,
  nonEmptyModelId,
  type ProviderCapability,
  type SubscriptionRegionFilter
} from './settings-section-providers-profile'
import {
  SharedModelConnectionConflictError,
  selectSharedModelConnection,
  type SharedModelConnection
} from './settings-section-providers-shared-api'
import {
  connectOrReplaceSharedModelConnectionCredential,
  commitSharedModelConnectionCatalog,
  fenceSharedModelConnectionCredential,
  rebasePendingSharedProviderCatalog,
  replaceSharedModelConnectionCredential,
  sharedModelProfiles
} from './settings-section-providers-shared-reconcile'
import {
  credentialRetryDelayMs,
  drainSharedProviderCatalogMutation,
  drainSharedProviderCredentialMutation,
  isCredentialRetryableError,
  sharedProviderMutationCoordinator,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'
import { commitSharedModelConnectionProfile } from './settings-section-providers-profile-reconcile'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderSharedActions(scope: Record<string, any>): Record<string, any> {
  const { kun, update, provider, setSharedConnections, setSharedConnectionsError, pendingSharedProviderDeletions, pendingSharedProviderNames, pendingSharedProviderCatalogs, pendingSharedProviderCredentials, catalogMutationTimers, credentialMutationTimers, mutationOwner, mounted, drainCatalogRef, drainCredentialRef, enqueueSharedMutation, sharedProjectionInput, setAddMenuOpen, setAddProviderQuery, setSubscriptionRegion, providerProxy } = scope
  const setCredentialDrafts = scope.setCredentialDrafts as Dispatch<SetStateAction<Record<string, string>>>
  const setCredentialSyncVersion = scope.setCredentialSyncVersion as Dispatch<SetStateAction<number>>
  const refreshCredentialSyncState = (): void => setCredentialSyncVersion((version) => version + 1)
  const setExpandedCapabilities = scope.setExpandedCapabilities as Dispatch<SetStateAction<Set<ProviderCapability>>>
  const addProviderButtonRef = scope.addProviderButtonRef as RefObject<HTMLButtonElement | null>
  const addProviderDialogRef = scope.addProviderDialogRef as RefObject<HTMLElement | null>
  const selectSharedModel = async (connection: SharedModelConnection, model: string): Promise<void> => {
    const selectedModel = nonEmptyModelId(model)
    if (!selectedModel) return
    try {
      await enqueueSharedMutation(async () => {
        const snapshot = await selectSharedModelConnection(
          connection.id,
          selectedModel,
          (providerId) => pendingSharedProviderDeletions.current.has(providerId)
        )
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
        update({ agents: { kun: kunProviderSelectionPatch({
          providerId: connection.id,
          model: selectedModel
        }) } })
      })
    } catch (error) {
      if (error instanceof SharedModelConnectionConflictError) {
        setSharedConnections(error.snapshot)
      }
      setSharedConnectionsError(error instanceof Error ? error.message : String(error))
    }
  }

  const updateProviderProxy = (patch: Partial<typeof providerProxy>): void => {
    update({
      provider: {
        proxy: {
          ...providerProxy,
          ...patch
        }
      }
    })
  }

  const setCapabilityExpanded = (capability: ProviderCapability, expanded: boolean): void => {
    setExpandedCapabilities((current) => {
      const next = new Set(current)
      if (expanded) next.add(capability)
      else next.delete(capability)
      return next
    })
  }

  const openAddProviderDialog = (): void => {
    setAddProviderQuery('')
    setSubscriptionRegion('all')
    setAddMenuOpen(true)
  }

  const closeAddProviderDialog = (): void => {
    setAddMenuOpen(false)
    window.setTimeout(() => addProviderButtonRef.current?.focus(), 0)
  }

  const handleAddProviderDialogKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'Tab' || !addProviderDialogRef.current) return
    const focusable = Array.from(addProviderDialogRef.current.querySelectorAll<HTMLElement>([
      'button:not([disabled])',
      'input:not([disabled])',
      'select:not([disabled])',
      'a[href]'
    ].join(','))).filter((element) => element.getClientRects().length > 0)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const handleSubscriptionRegionTabKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
    currentRegion: SubscriptionRegionFilter
  ): void => {
    const currentIndex = SUBSCRIPTION_REGION_TABS.findIndex((tab) => tab.id === currentRegion)
    let nextIndex = currentIndex
    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % SUBSCRIPTION_REGION_TABS.length
    else if (event.key === 'ArrowLeft') {
      nextIndex = (currentIndex - 1 + SUBSCRIPTION_REGION_TABS.length) % SUBSCRIPTION_REGION_TABS.length
    } else if (event.key === 'Home') nextIndex = 0
    else if (event.key === 'End') nextIndex = SUBSCRIPTION_REGION_TABS.length - 1
    else return

    event.preventDefault()
    setSubscriptionRegion(SUBSCRIPTION_REGION_TABS[nextIndex].id)
    const tabs = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>('[role="tab"]')
    tabs?.[nextIndex]?.focus()
  }

  const confirmAction = async (options: {
    message: string
    detail?: string
    confirmLabel?: string
    cancelLabel?: string
  }): Promise<boolean> => {
    if (typeof window.kunGui?.confirmDialog === 'function') {
      return window.kunGui.confirmDialog(options)
    }
    return true
  }

  const updateModelProviders = (
    providers: ModelProviderProfileV1[],
    kunPatch?: KunRuntimeSettingsPatchV1,
    additionalPatch?: Pick<AppSettingsPatch, 'write'>
  ): void => {
    const current = sharedProjectionInput.current
    current.update({
      ...modelProvidersSettingsPatch({
        provider: current.provider,
        providers,
        kun: kunPatch,
        currentKun: current.kun
      }),
      ...(additionalPatch ?? {})
    })
  }

  const drainSharedProviderProfile = async (providerId: string): Promise<void> => {
    const pending = pendingSharedProviderNames.current.get(providerId)
    if (!pending) return
    const provider = (sharedProjectionInput.current.provider.providers as ModelProviderProfileV1[])
      .find((item) => item.id === providerId)
    if (!provider) return
    const snapshot = await enqueueSharedMutation(() => commitSharedModelConnectionProfile(
      provider,
      pending,
      (id) => pendingSharedProviderDeletions.current.has(id)
    ))
    const current = pendingSharedProviderNames.current.get(providerId)
    if (current?.generation === pending.generation) {
      pendingSharedProviderNames.current.set(providerId, { ...current, committedRevision: snapshot.revision })
      setSharedConnections(snapshot)
    }
  }

  const drainSharedProviderCatalog = async (
    providerId: string,
    generation: number
  ): Promise<void> => {
    try {
      await drainSharedProviderCatalogMutation(providerId, generation, async () => {
      const pending = pendingSharedProviderCatalogs.current.get(providerId)
      if (!pending || pending.generation !== generation) return
      const latestProvider = (sharedProjectionInput.current.provider.providers as ModelProviderProfileV1[])
        .find((item) => item.id === providerId)
      const providerForGeneration = latestProvider
        ? {
            ...latestProvider,
            ...(pending.localProviderName !== undefined ? { name: pending.localProviderName } : {}),
            ...(pending.localProviderBaseUrl !== undefined ? { baseUrl: pending.localProviderBaseUrl } : {}),
            ...(pending.localProviderEndpointFormat !== undefined
              ? { endpointFormat: pending.localProviderEndpointFormat }
              : {}),
            ...(pending.localProviderKind !== undefined ? { kind: pending.localProviderKind } : {})
          }
        : undefined
      const pendingProfile = pendingSharedProviderNames.current.get(providerId)
      const pendingCredential = pendingSharedProviderCredentials.current.get(providerId)?.credential
      const snapshot = await commitSharedModelConnectionCatalog(
        providerId,
        pending,
        (id) => pendingSharedProviderDeletions.current.has(id),
        providerForGeneration
          ? {
              provider: providerForGeneration,
              credential: pendingCredential ?? providerForGeneration.apiKey
            }
          : undefined
      )
      const current = pendingSharedProviderCatalogs.current.get(providerId)
      const connection = snapshot.providers.find((item) => item.id === providerId)
      const currentProfile = pendingSharedProviderNames.current.get(providerId)
      if (
        pendingProfile &&
        currentProfile?.generation === pendingProfile.generation &&
        connection &&
        connection.name === pendingProfile.canonicalName &&
        (pendingProfile.localBaseUrl === undefined || connection.baseUrl === pendingProfile.localBaseUrl) &&
        (pendingProfile.localEndpointFormat === undefined ||
          connection.endpointFormat === pendingProfile.localEndpointFormat)
      ) {
        pendingSharedProviderNames.current.set(providerId, {
          ...currentProfile,
          committedRevision: snapshot.revision
        })
      }
      if (current?.generation === generation) {
        pendingSharedProviderCatalogs.current.set(providerId, {
          ...current,
          ...(connection ? {
            localModels: [...connection.models],
            localModelProfiles: sharedModelProfiles(connection, providerForGeneration)
          } : {}),
          committedRevision: snapshot.revision
        })
      } else if (current && connection) {
        // A newer local generation was staged while this request was in
        // flight. Its delta was based on the pre-request catalog, so rebase it
        // onto the revision we just committed before the shared queue starts
        // the newer generation (for example add -> immediate undo).
        pendingSharedProviderCatalogs.current.set(
          providerId,
          rebasePendingSharedProviderCatalog(pending, current, connection)
        )
      }
        if (mounted.current) {
          setSharedConnections(snapshot)
          setSharedConnectionsError('')
        }
      })
    } catch (error) {
      if (pendingSharedProviderCatalogs.current.has(providerId) && mounted.current) {
        if (error instanceof SharedModelConnectionConflictError) setSharedConnections(error.snapshot)
        setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      }
      throw error
    }
  }

  const flushSharedProviderCatalog = async (providerId: string): Promise<void> => {
    const pending = pendingSharedProviderCatalogs.current.get(providerId)
    if (!pending || pending.committedRevision !== null) return
    const timer = catalogMutationTimers.current.get(providerId)
    if (timer) {
      clearTimeout(timer.timer)
      catalogMutationTimers.current.delete(providerId)
    }
    await drainSharedProviderCatalog(providerId, pending.generation)
  }

  const stageSharedProviderCatalog = (
    before: ModelProviderProfileV1,
    after: ModelProviderProfileV1
  ): void => {
    if (
      before.name === after.name &&
      before.baseUrl === after.baseUrl &&
      before.endpointFormat === after.endpointFormat &&
      before.useProxy === after.useProxy &&
      before.kind === after.kind &&
      JSON.stringify(before.models) === JSON.stringify(after.models) &&
      JSON.stringify(before.modelProfiles) === JSON.stringify(after.modelProfiles)
    ) return
    const previous = pendingSharedProviderCatalogs.current.get(before.id)
    const generation = sharedProviderMutationCoordinator.catalogGeneration + 1
    sharedProviderMutationCoordinator.catalogGeneration = generation
    pendingSharedProviderCatalogs.current.set(before.id, {
      generation,
      localProviderName: after.name,
      localProviderBaseUrl: after.baseUrl,
      localProviderEndpointFormat: after.endpointFormat,
      localProviderKind: after.kind,
      baseModels: [...(
        previous?.committedRevision === null
          ? previous.baseModels
          : previous?.localModels ?? before.models
      )],
      baseModelProfiles: structuredClone(
        previous?.committedRevision === null
          ? previous.baseModelProfiles
          : previous?.localModelProfiles ?? before.modelProfiles
      ),
      localModels: [...after.models],
      localModelProfiles: structuredClone(after.modelProfiles),
      committedRevision: null
    })
    const existingTimer = catalogMutationTimers.current.get(before.id)
    if (existingTimer) clearTimeout(existingTimer.timer)
    const timer = setTimeout(() => {
      const record = catalogMutationTimers.current.get(before.id)
      if (record?.owner !== mutationOwner.current) return
      catalogMutationTimers.current.delete(before.id)
      void drainSharedProviderCatalog(before.id, generation).catch(() => undefined)
    }, 150)
    catalogMutationTimers.current.set(before.id, { owner: mutationOwner.current, timer })
  }

  const scheduleCredentialRetry = (providerId: string, generation: number, error: unknown): void => {
    const pending = pendingSharedProviderCredentials.current.get(providerId)
    if (!pending || pending.generation !== generation) return
    if (!isCredentialRetryableError(error)) {
      sharedProviderMutationCoordinator.credentialRetryStates.set(providerId, {
        attempts: 0,
        lastError: error instanceof Error ? error.message : String(error),
        nextRetryAt: 0
      })
      refreshCredentialSyncState()
      return
    }
    const previous = sharedProviderMutationCoordinator.credentialRetryStates.get(providerId)
    const attempts = (previous?.attempts ?? 0) + 1
    const delay = credentialRetryDelayMs(attempts)
    sharedProviderMutationCoordinator.credentialRetryStates.set(providerId, {
      attempts,
      lastError: error instanceof Error ? error.message : String(error),
      nextRetryAt: Date.now() + delay
    })
    const existing = credentialMutationTimers.current.get(providerId)
    if (existing) clearTimeout(existing.timer)
    const timer = setTimeout(() => {
      const record = credentialMutationTimers.current.get(providerId)
      if (record?.owner !== mutationOwner.current) return
      credentialMutationTimers.current.delete(providerId)
      void drainCredentialRef.current(providerId, generation).catch(() => undefined)
    }, delay)
    credentialMutationTimers.current.set(providerId, { owner: mutationOwner.current, timer })
    refreshCredentialSyncState()
  }

  const drainSharedProviderCredential = (
    providerId: string,
    generation: number
  ): Promise<void> => {
    return drainSharedProviderCredentialMutation(
      providerId,
      generation,
      (credential, operationToken, isCurrent, fenceInstalled) => {
        const latestProvider = (sharedProjectionInput.current.provider.providers as ModelProviderProfileV1[])
          .find((item) => item.id === providerId)
        if (!latestProvider) throw new Error(`Shared model connection ${providerId} is no longer available`)
        return credential.trim()
          ? connectOrReplaceSharedModelConnectionCredential(
              latestProvider,
              credential,
              (id) => pendingSharedProviderDeletions.current.has(id),
              { operationToken, isCurrent, fenceInstalled }
            )
          : replaceSharedModelConnectionCredential(
              providerId,
              credential,
              (id) => pendingSharedProviderDeletions.current.has(id),
              { operationToken, isCurrent }
            )
      }
    ).then((result) => {
      if (!result) {
        if (!pendingSharedProviderCredentials.current.has(providerId) && mounted.current) {
          setCredentialDrafts((previous) => {
            if (!Object.prototype.hasOwnProperty.call(previous, providerId)) return previous
            const next = { ...previous }
            delete next[providerId]
            return next
          })
        }
        return
      }
      const snapshot = result.value
      if (result.committed && mounted.current) {
        setCredentialDrafts((previous) => {
          if (!Object.prototype.hasOwnProperty.call(previous, providerId)) return previous
          const next = { ...previous }
          delete next[providerId]
          return next
        })
      }
      if (result.committed) refreshCredentialSyncState()
      if (mounted.current) {
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
      }
    }).then(() => undefined).catch((error) => {
      if (pendingSharedProviderCredentials.current.has(providerId) && mounted.current) {
        if (error instanceof SharedModelConnectionConflictError) setSharedConnections(error.snapshot)
        setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      }
      scheduleCredentialRetry(providerId, generation, error)
      throw error
    })
  }

  const flushSharedProviderCredential = async (providerId: string): Promise<void> => {
    const pending = pendingSharedProviderCredentials.current.get(providerId)
    if (!pending) return
    const timer = credentialMutationTimers.current.get(providerId)
    if (timer) {
      clearTimeout(timer.timer)
      credentialMutationTimers.current.delete(providerId)
    }
    await drainSharedProviderCredential(providerId, pending.generation)
  }

  const stageSharedProviderCredential = (providerId: string, credential: string): void => {
    const { generation } = stageSharedProviderCredentialMutation(
      providerId,
      credential,
      (operationToken) => fenceSharedModelConnectionCredential(providerId, operationToken)
    )
    setCredentialDrafts((previous) => ({ ...previous, [providerId]: credential }))
    refreshCredentialSyncState()
    const existingTimer = credentialMutationTimers.current.get(providerId)
    if (existingTimer) clearTimeout(existingTimer.timer)
    const timer = setTimeout(() => {
      const record = credentialMutationTimers.current.get(providerId)
      if (record?.owner !== mutationOwner.current) return
      credentialMutationTimers.current.delete(providerId)
      void drainSharedProviderCredential(providerId, generation).catch(() => undefined)
    }, 450)
    credentialMutationTimers.current.set(providerId, { owner: mutationOwner.current, timer })
  }

  drainCatalogRef.current = drainSharedProviderCatalog
  drainCredentialRef.current = drainSharedProviderCredential

  useEffect(() => {
    // Failed cleanup drains intentionally leave their generation pending. A
    // newly mounted settings page adopts that work and retries it through the
    // same module-owned queue instead of projecting an older Registry value.
    for (const [providerId, pending] of pendingSharedProviderCatalogs.current) {
      if (pending.committedRevision !== null || catalogMutationTimers.current.has(providerId)) continue
      const timer = setTimeout(() => {
        const record = catalogMutationTimers.current.get(providerId)
        if (record?.owner !== mutationOwner.current) return
        catalogMutationTimers.current.delete(providerId)
        void drainCatalogRef.current(providerId, pending.generation).catch(() => undefined)
      }, 0)
      catalogMutationTimers.current.set(providerId, { owner: mutationOwner.current, timer })
    }
    for (const [providerId, pending] of pendingSharedProviderCredentials.current) {
      if (credentialMutationTimers.current.has(providerId)) continue
      const timer = setTimeout(() => {
        const record = credentialMutationTimers.current.get(providerId)
        if (record?.owner !== mutationOwner.current) return
        credentialMutationTimers.current.delete(providerId)
        void drainCredentialRef.current(providerId, pending.generation).catch(() => undefined)
      }, 0)
      credentialMutationTimers.current.set(providerId, { owner: mutationOwner.current, timer })
    }
  }, [])

  useEffect(() => {
    const retryPendingCredentials = (): void => {
      for (const [providerId, pending] of pendingSharedProviderCredentials.current) {
        const timer = credentialMutationTimers.current.get(providerId)
        if (timer?.owner === mutationOwner.current) {
          clearTimeout(timer.timer)
          credentialMutationTimers.current.delete(providerId)
        }
        void drainCredentialRef.current(providerId, pending.generation).catch(() => undefined)
      }
    }
    window.addEventListener('online', retryPendingCredentials)
    return () => window.removeEventListener('online', retryPendingCredentials)
  }, [])

  useEffect(() => () => {
    for (const [providerId, record] of catalogMutationTimers.current) {
      if (record.owner !== mutationOwner.current) continue
      clearTimeout(record.timer)
      catalogMutationTimers.current.delete(providerId)
      const pending = pendingSharedProviderCatalogs.current.get(providerId)
      if (pending?.committedRevision === null) {
        void drainCatalogRef.current(providerId, pending.generation).catch(() => undefined)
      }
    }
    for (const [providerId, record] of credentialMutationTimers.current) {
      if (record.owner !== mutationOwner.current) continue
      clearTimeout(record.timer)
      credentialMutationTimers.current.delete(providerId)
      const pending = pendingSharedProviderCredentials.current.get(providerId)
      if (pending) void drainCredentialRef.current(providerId, pending.generation).catch(() => undefined)
    }
  }, [])
  return { selectSharedModel, updateProviderProxy, setCapabilityExpanded, openAddProviderDialog, closeAddProviderDialog, handleAddProviderDialogKeyDown, handleSubscriptionRegionTabKeyDown, confirmAction, updateModelProviders, stageSharedProviderCatalog, flushSharedProviderCatalog, stageSharedProviderCredential, flushSharedProviderCredential, drainSharedProviderProfile, drainSharedProviderCatalog, drainSharedProviderCredential }
}
