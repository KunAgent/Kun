import type {
  AppSettingsPatch,
  KunRuntimeSettingsPatchV1,
  KunRuntimeSettingsV1,
  ModelProviderProfileV1
} from '@shared/app-settings'
import {
  DEFAULT_MODEL_PROVIDER_ID
} from '@shared/app-settings'
import { modelProviderRequiresApiKey } from '@shared/app-settings-provider-core'
import {
  useEffect
} from 'react'
import { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'
import {
  isSubscriptionProvider,
  modelProviderDeletionKunPatch,
  modelProviderDeletionWritePatch
} from './settings-section-providers-profile'
import {
  SharedModelConnectionConflictError,
  parseSharedModelConnectionEvent,
  requestSharedModelConnections
} from './settings-section-providers-shared-api'
import {
  projectSharedModelConnections,
  reconcilePendingSharedProviderCatalogs,
  reconcilePendingSharedProviderDeletions, reconcilePendingSharedProviderNames,
  sharedCapabilitiesFromProvider,
  sharedConnectionBaseUrlOptional,
  sharedProvidersEligibleForSync, sharedSettingsFingerprint
} from './settings-section-providers-shared-reconcile'
import {
  hasInFlightSharedProviderCatalogMutation,
  replaceMapContents
} from './shared-provider-mutation-coordinator'

export { sharedModelConnectionHasUsableCredential } from '../lib/provider-credential-readiness'







export function useProviderSharedSynchronization(scope: Record<string, any>): void {
  const { form, kun, update, saveStatus, provider, modelProviders, sharedConnections, setSharedConnections, setSharedConnectionsError, sharedSyncFingerprint, sharedProjectionPending, pendingSharedProviderDeletions, pendingSharedProviderNames, pendingSharedProviderCatalogs, pendingSharedProviderCredentials, enqueueSharedMutation, sharedProjectionInput, onSharedSyncRecovered } = scope
  useEffect(() => {
    let disposed = false
    let hadRefreshError = false
    let timer: ReturnType<typeof setTimeout> | undefined
    let revision = 0
    const refresh = async (): Promise<void> => {
      try {
        const snapshot = revision === 0
          ? await requestSharedModelConnections('/v1/model-connections')
          : await window.kunGui.runtimeRequest(
              `/v1/model-connections/events?since_revision=${revision}&wait_ms=25000`,
              'GET'
            ).then((result) => {
              if (!result.ok) throw new Error(`Shared model connection event failed (HTTP ${result.status})`)
              return parseSharedModelConnectionEvent(result.body)
            })
        if (!disposed) {
          revision = snapshot.revision
          setSharedConnections(snapshot)
          setSharedConnectionsError('')
          if (hadRefreshError) onSharedSyncRecovered?.()
          hadRefreshError = false
          const current = sharedProjectionInput.current
          replaceMapContents(pendingSharedProviderDeletions.current, reconcilePendingSharedProviderDeletions(
            snapshot,
            pendingSharedProviderDeletions.current,
            new Set((current.provider.providers as ModelProviderProfileV1[]).map((item) => item.id))
          ))
          replaceMapContents(pendingSharedProviderNames.current, reconcilePendingSharedProviderNames(
            snapshot,
            pendingSharedProviderNames.current
          ))
          replaceMapContents(pendingSharedProviderCatalogs.current, reconcilePendingSharedProviderCatalogs(
            snapshot,
            pendingSharedProviderCatalogs.current
          ))
          // Skip AppSettings writes while a catalog commit owns the queue so a
          // stale registry snapshot cannot revert an in-flight Token Plan fetch
          // (#1117). SharedConnections UI state above still refreshes.
          if (hasInFlightSharedProviderCatalogMutation()) {
            return
          }
          const projected = projectSharedModelConnections(
            current.provider,
            snapshot,
            pendingSharedProviderDeletions.current,
            pendingSharedProviderNames.current,
            pendingSharedProviderCatalogs.current
          )
          const effectiveProjectedModel = projected.kun.model ?? current.kun.model
          const fingerprint = sharedSettingsFingerprint({
            providers: projected.provider.providers,
            providerId: projected.kun.providerId,
            model: effectiveProjectedModel,
            proxy: projected.provider.proxy,
            routePools: projected.provider.routePools,
            localGateway: projected.provider.localGateway
          })
          sharedSyncFingerprint.current = fingerprint
          const currentFingerprint = sharedSettingsFingerprint({
            providers: current.provider.providers,
            providerId: current.kun.providerId,
            model: current.kun.model,
            proxy: current.provider.proxy,
            routePools: current.provider.routePools,
            localGateway: current.provider.localGateway
          })
          if (fingerprint !== currentFingerprint) {
            sharedProjectionPending.current = true
            const committedDeletedProviderIds = new Set(
              [...pendingSharedProviderDeletions.current]
                .filter(([, deletion]) => deletion.committedRevision !== null)
                .map(([providerId]) => providerId)
            )
            const kunPatch: KunRuntimeSettingsPatchV1 = { ...projected.kun }
            const fallbackProvider = projected.provider.providers.find(
              (item) => item.id === DEFAULT_MODEL_PROVIDER_ID
            ) ?? projected.provider.providers[0]
            Object.assign(kunPatch, modelProviderDeletionKunPatch({
              currentKun: current.kun,
              deletedProviderIds: committedDeletedProviderIds,
              fallbackProvider
            }))
            const writePatch = modelProviderDeletionWritePatch(
              current.form?.write?.inlineCompletion,
              committedDeletedProviderIds
            )
            const settingsPatch: AppSettingsPatch = {
              provider: projected.provider,
              agents: { kun: kunPatch }
            }
            if (writePatch?.write) settingsPatch.write = writePatch.write
            current.update(settingsPatch)
          }
        }
      } catch (error) {
        hadRefreshError = true
        if (!disposed) setSharedConnectionsError(error instanceof Error ? error.message : String(error))
      } finally {
        if (!disposed) timer = setTimeout(refresh, revision === 0 ? 2_000 : 0)
      }
    }
    void refresh()
    return () => {
      disposed = true
      if (timer !== undefined) clearTimeout(timer)
    }
  }, [])

  useEffect(() => {
    if (saveStatus !== 'saved' || !sharedConnections) return
    const fingerprint = sharedSettingsFingerprint({
      providers: modelProviders,
      providerId: kun.providerId,
      model: kun.model,
      proxy: provider.proxy,
      routePools: provider.routePools,
      localGateway: provider.localGateway
    })
    if (sharedProjectionPending.current) {
      if (fingerprint === sharedSyncFingerprint.current) {
        sharedProjectionPending.current = false
      }
      return
    }
    if (fingerprint === sharedSyncFingerprint.current) return
    let disposed = false
    const syncOnce = async (): Promise<void> => {
      if (disposed) return
      let snapshot = await requestSharedModelConnections('/v1/model-connections')
      if (disposed) return
      const latest = sharedProjectionInput.current
      const latestProviders = latest.provider.providers as ModelProviderProfileV1[]
      const latestKun = latest.kun as KunRuntimeSettingsV1
      const desiredProviders = sharedProvidersEligibleForSync(
        latestProviders,
        pendingSharedProviderDeletions.current
      ).filter((item) =>
        (
          item.id !== DEFAULT_MODEL_PROVIDER_ID ||
          snapshot.providers.some((entry) => entry.id === item.id) ||
          pendingSharedProviderCredentials.current.has(item.id) ||
          latestKun.providerId === item.id
        )
      )
      for (const item of desiredProviders) {
        if (disposed || pendingSharedProviderDeletions.current.has(item.id)) continue
        const baseUrlOptional = sharedConnectionBaseUrlOptional(item.kind)
        if (!baseUrlOptional && !item.baseUrl.trim()) continue
        const existing = snapshot.providers.find((entry) => entry.id === item.id)
        const selectedModel = item.models.includes(latestKun.model) ? latestKun.model : item.models[0]
        if (!existing) {
          if (pendingSharedProviderDeletions.current.has(item.id)) continue
          // Renderer projections redact apiKey to ''. Connecting without a
          // credential creates an authoritative empty Registry shell that
          // shadows legacy bindings and leaves the supplier stuck on
          // "needs configuration". Keyless kinds (CLI/SDK) may still connect.
          // Credential-bearing connects happen via the staged credential drain.
          if (modelProviderRequiresApiKey(item) && !item.apiKey.trim()) continue
          snapshot = await requestSharedModelConnections('/v1/model-connections/connect', 'POST', {
            expectedRevision: snapshot.revision,
            id: item.id,
            name: item.name.trim() || item.id,
            kind: item.kind ?? 'http',
            authType: isSubscriptionProvider(item) ? 'subscription' : 'api-key',
            ...(baseUrlOptional ? {} : { baseUrl: item.baseUrl }),
            endpointFormat: item.endpointFormat,
            ...(item.apiKey.trim() ? { credential: item.apiKey } : {}),
            models: item.models,
            modelCapabilities: sharedCapabilitiesFromProvider(item),
            ...(selectedModel ? { selectedModel } : {}),
            probe: false,
            select: false
          })
        } else {
          const modelCapabilities = sharedCapabilitiesFromProvider(item)
          const hasPendingCatalog = pendingSharedProviderCatalogs.current.has(item.id)
          const needsPatch =
            existing.name !== (item.name.trim() || item.id) ||
            (existing.baseUrl ?? '') !== item.baseUrl ||
            existing.endpointFormat !== item.endpointFormat ||
            existing.kind !== (item.kind ?? 'http') ||
            (!hasPendingCatalog && (
              JSON.stringify(existing.models) !== JSON.stringify(item.models) ||
              JSON.stringify(existing.modelCapabilities ?? {}) !== JSON.stringify(modelCapabilities ?? {}) ||
              existing.selectedModel !== selectedModel
            ))
          if (needsPatch) {
            if (pendingSharedProviderDeletions.current.has(item.id)) continue
            const canonicalName = item.name.trim() || item.id
            const pendingProfile = pendingSharedProviderNames.current.get(item.id)
            snapshot = await requestSharedModelConnections(
              `/v1/model-connections/${encodeURIComponent(item.id)}`,
              'PATCH',
              {
                expectedRevision: snapshot.revision,
                name: canonicalName,
                kind: item.kind ?? 'http',
                authType: isSubscriptionProvider(item) ? 'subscription' : 'api-key',
                ...(baseUrlOptional ? {} : { baseUrl: item.baseUrl }),
                endpointFormat: item.endpointFormat,
                ...(!hasPendingCatalog ? {
                  models: item.models,
                  modelCapabilities,
                  ...(selectedModel ? { selectedModel } : {})
                } : {})
              }
            )
            const currentProfile = pendingSharedProviderNames.current.get(item.id)
            if (
              pendingProfile &&
              currentProfile?.generation === pendingProfile.generation &&
              pendingProfile.canonicalName === canonicalName &&
              pendingProfile.localBaseUrl === item.baseUrl &&
              pendingProfile.localEndpointFormat === item.endpointFormat
            ) {
              pendingSharedProviderNames.current.set(item.id, {
                ...currentProfile,
                committedRevision: snapshot.revision
              })
            }
          }
        }
      }
      for (const existing of [...snapshot.providers]) {
        if (!pendingSharedProviderDeletions.current.has(existing.id)) continue
        snapshot = await requestSharedModelConnections(
          `/v1/model-connections/${encodeURIComponent(existing.id)}?expected_revision=${snapshot.revision}`,
          'DELETE'
        )
        const deletion = pendingSharedProviderDeletions.current.get(existing.id)
        if (deletion) {
          pendingSharedProviderDeletions.current.set(existing.id, {
            ...deletion,
            committedRevision: snapshot.revision
          })
        }
        pendingSharedProviderCatalogs.current.delete(existing.id)
        pendingSharedProviderCredentials.current.delete(existing.id)
      }
      const globalsChanged =
        JSON.stringify(snapshot.proxy) !== JSON.stringify(latest.provider.proxy ?? { enabled: false, url: '' }) ||
        JSON.stringify(snapshot.routePools) !== JSON.stringify(latest.provider.routePools ?? []) ||
        snapshot.localModelGateway?.enabled !== (latest.provider.localGateway?.enabled === true)
      if (globalsChanged) {
        snapshot = await requestSharedModelConnections('/v1/model-connections', 'PATCH', {
          expectedRevision: snapshot.revision,
          proxy: latest.provider.proxy ?? { enabled: false, url: '' },
          routePools: latest.provider.routePools ?? [],
          localModelGateway: { enabled: latest.provider.localGateway?.enabled === true }
        })
      }
      const active = snapshot.providers.find((entry) => entry.id === latestKun.providerId)
      const model = active && (active.models.includes(latestKun.model) ? latestKun.model : active.models[0])
      if (sharedModelConnectionHasUsableCredential(active) && model &&
        !pendingSharedProviderDeletions.current.has(active.id) && (
        snapshot.defaultProviderId !== active.id || snapshot.defaultModel !== model
      )) {
        snapshot = await requestSharedModelConnections('/v1/model-connections/select', 'POST', {
          expectedRevision: snapshot.revision,
          providerId: active.id,
          accountId: active.accountId,
          model
        })
      }
      if (!disposed) {
        sharedSyncFingerprint.current = sharedSettingsFingerprint({
          providers: latestProviders,
          providerId: latestKun.providerId,
          model: latestKun.model,
          proxy: latest.provider.proxy,
          routePools: latest.provider.routePools,
          localGateway: latest.provider.localGateway
        })
        setSharedConnections(snapshot)
        setSharedConnectionsError('')
      }
    }
    const sync = async (): Promise<void> => {
      try {
        await enqueueSharedMutation(syncOnce)
      } catch (error) {
        if (error instanceof SharedModelConnectionConflictError && !disposed) {
          setSharedConnections(error.snapshot)
          throw new Error('Model settings changed in another client. The latest revision was loaded; review and save again.')
        }
        throw error
      }
    }
    void sync().catch((error) => {
      if (!disposed) setSharedConnectionsError(error instanceof Error ? error.message : String(error))
    })
    return () => { disposed = true }
  }, [
    kun.model,
    kun.providerId,
    modelProviders,
    provider.localGateway,
    provider.proxy,
    provider.routePools,
    saveStatus,
    sharedConnections,
    enqueueSharedMutation
  ])
}
