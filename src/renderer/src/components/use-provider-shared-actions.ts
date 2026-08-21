import type {
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
  commitSharedModelConnectionCatalog,
  fenceSharedModelConnectionCredential,
  rebasePendingSharedProviderCatalog,
  replaceSharedModelConnectionCredential,
  sharedModelProfiles
} from './settings-section-providers-shared-reconcile'
import {
  drainSharedProviderCatalogMutation,
  drainSharedProviderCredentialMutation,
  sharedProviderMutationCoordinator,
  stageSharedProviderCredentialMutation
} from './shared-provider-mutation-coordinator'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderSharedActions(scope: Record<string, any>): Record<string, any> {
  const { kun, update, provider, setSharedConnections, setSharedConnectionsError, pendingSharedProviderDeletions, pendingSharedProviderCatalogs, pendingSharedProviderCredentials, catalogMutationTimers, credentialMutationTimers, mutationOwner, mounted, drainCatalogRef, drainCredentialRef, enqueueSharedMutation, sharedProjectionInput, setAddMenuOpen, setAddProviderQuery, setSubscriptionRegion, providerProxy } = scope
  const setCredentialDrafts = scope.setCredentialDrafts as Dispatch<SetStateAction<Record<string, string>>>
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
    kunPatch?: KunRuntimeSettingsPatchV1
  ): void => {
    update(modelProvidersSettingsPatch({
      provider,
      providers,
      kun: kunPatch,
      currentKun: kun
    }))
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
      const pendingCredential = pendingSharedProviderCredentials.current.get(providerId)?.credential
      const snapshot = await commitSharedModelConnectionCatalog(
        providerId,
        pending,
        (id) => pendingSharedProviderDeletions.current.has(id),
        latestProvider
          ? {
              provider: latestProvider,
              credential: pendingCredential ?? latestProvider.apiKey
            }
          : undefined
      )
      const current = pendingSharedProviderCatalogs.current.get(providerId)
      const connection = snapshot.providers.find((item) => item.id === providerId)
      if (current?.generation === generation) {
        pendingSharedProviderCatalogs.current.set(providerId, {
          ...current,
          ...(connection ? {
            localModels: [...connection.models],
            localModelProfiles: sharedModelProfiles(connection, latestProvider)
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
      JSON.stringify(before.models) === JSON.stringify(after.models) &&
      JSON.stringify(before.modelProfiles) === JSON.stringify(after.modelProfiles)
    ) return
    const previous = pendingSharedProviderCatalogs.current.get(before.id)
    const generation = sharedProviderMutationCoordinator.catalogGeneration + 1
    sharedProviderMutationCoordinator.catalogGeneration = generation
    pendingSharedProviderCatalogs.current.set(before.id, {
      generation,
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

  const drainSharedProviderCredential = (providerId: string, generation: number): void => {
    void drainSharedProviderCredentialMutation(
      providerId,
      generation,
      (credential, operationToken, isCurrent) => replaceSharedModelConnectionCredential(
        providerId,
        credential,
        (id) => pendingSharedProviderDeletions.current.has(id),
        { operationToken, isCurrent }
      )
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
      if (mounted.current) {
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
      }
    }).catch((error) => {
      if (!pendingSharedProviderCredentials.current.has(providerId)) return
      if (mounted.current) {
        if (error instanceof SharedModelConnectionConflictError) setSharedConnections(error.snapshot)
        setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      }
    })
  }

  const stageSharedProviderCredential = (providerId: string, credential: string): void => {
    const { generation } = stageSharedProviderCredentialMutation(
      providerId,
      credential,
      (operationToken) => fenceSharedModelConnectionCredential(providerId, operationToken)
    )
    setCredentialDrafts((previous) => ({ ...previous, [providerId]: credential }))
    const existingTimer = credentialMutationTimers.current.get(providerId)
    if (existingTimer) clearTimeout(existingTimer.timer)
    const timer = setTimeout(() => {
      const record = credentialMutationTimers.current.get(providerId)
      if (record?.owner !== mutationOwner.current) return
      credentialMutationTimers.current.delete(providerId)
      drainSharedProviderCredential(providerId, generation)
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
        drainCredentialRef.current(providerId, pending.generation)
      }, 0)
      credentialMutationTimers.current.set(providerId, { owner: mutationOwner.current, timer })
    }
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
      if (pending) drainCredentialRef.current(providerId, pending.generation)
    }
  }, [])
  return { selectSharedModel, updateProviderProxy, setCapabilityExpanded, openAddProviderDialog, closeAddProviderDialog, handleAddProviderDialogKeyDown, handleSubscriptionRegionTabKeyDown, confirmAction, updateModelProviders, stageSharedProviderCatalog, flushSharedProviderCatalog, stageSharedProviderCredential }
}
