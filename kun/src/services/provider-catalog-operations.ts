import { nativeModelCatalogIdentity } from './native-model-catalog-identity.js'
import { resolveModelsDevProvider } from './models-dev-catalog.js'
import { publicCatalogService, publicCatalogProfile, publicCatalogProviderId } from './provider-public-catalog.js'
import type { ModelDiscoveryResult } from './provider-model-descriptors.js'
import { resolvePresetDiscovery } from '@kun/provider-catalog'
import { ProviderDiscoveryResponseError, ProviderDiscoveryConfigurationError } from './provider-discovery-error.js'
import { ProviderSecretScopeError } from './provider-request-security.js'
import { emptyProviderEvidence } from '../contracts/provider-verification-evidence.js'
import { type ModelConnectionRegistry, emptyDocument, requireProfile } from './model-connection-registry-core.js'
import { materializeLegacyProviderCredential } from './legacy-provider-credential-migration.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { resolveRegistryProfileProxyUrl } from './model-connection-registry-proxy.js'
import { readProviderHeaders, readProviderGeneratedHeaders } from './provider-protected-headers.js'
import { probeModelDescriptors } from './model-connection-probe.js'
import { modelCatalogIdentity, readModelCatalog, writeModelCatalog, patchModelCatalog } from './model-catalog-store.js'

export async function catalogBinding(registry: ModelConnectionRegistry, providerId: string) {
  const document = await registry['readDocumentForCredentialConsumer'](providerId)
  if (document.credentialTransactions[providerId]) throw new Error('Provider credential replacement is pending')
  const raw = requireProfile(document, providerId)
  const effective = effectiveProviderConfiguration(raw, document.configuration)
  const profile = effective.profile
  const credential = profile.authType !== 'none' && profile.credentialRef
    ? await registry['options'].credentials.get(profile.credentialRef) : null
  const sourceId = profile.credentialRef ? `model-connection:${profile.id}` : profile.credentialSourceId
  const resolved = profile.authType === 'none' ? { apiKey: '', headers: {} }
    : sourceId && registry['options'].resolveCredentialSource
      ? await registry['options'].resolveCredentialSource(sourceId)
      : materializeLegacyProviderCredential(credential?.apiKey ?? '')
  if (profile.kind === 'http' && profile.authType !== 'none' && !resolved.apiKey.trim()) throw new Error('Provider credential is unavailable')
  const proxyUrl = effective.proxy?.mode === 'proxy' ? effective.proxy.url
    : resolveRegistryProfileProxyUrl(document, profile)
  const customHeaders = await readProviderHeaders(registry, profile)
  const headers = { ...await readProviderGeneratedHeaders(registry, profile), ...(resolved.headers ?? {}) }
  const identityHeaders = Object.fromEntries(Object.entries({ ...customHeaders, ...headers })
    .filter(([name]) => name.toLowerCase() !== 'session_id')
    .sort(([left], [right]) => left.toLowerCase().localeCompare(right.toLowerCase())))
  const nativeIdentity = effective.discovery.mode === 'manual' ? undefined : await nativeModelCatalogIdentity(profile.kind, resolved.apiKey)
  const identity = modelCatalogIdentity({ nativeIdentity, id: profile.id, accountId: profile.accountId,
    incarnationId: profile.incarnationId, credentialRef: profile.credentialRef, credential: resolved.apiKey,
    kind: profile.kind, authType: profile.authType, presetSource: profile.presetSource, presetMode: profile.presetMode, baseUrl: profile.baseUrl, endpointFormat: profile.endpointFormat,
    endpoints: profile.endpoints, headers: identityHeaders, proxyUrl, discovery: effective.discovery, authProfile: effective.authProfile, headerProfile: effective.headerProfile, adapterRevision: 4 })
  return { document, profile, effective, resolved, proxyUrl, headers, customHeaders, identity }
}

export type ConnectionProbeResult = ModelDiscoveryResult & { ok: true }
type Result = ConnectionProbeResult
type Pending = { promise: Promise<Result>; controller: AbortController; subscribers: number; done: boolean }
const pendingByRegistry = new WeakMap<ModelConnectionRegistry, Map<string, Pending>>()

export async function probeConnectionCatalog(registry: ModelConnectionRegistry, providerId: string, signal?: AbortSignal): Promise<Result> {
  signal?.throwIfAborted()
  const initial = await catalogBinding(registry, providerId)
  signal?.throwIfAborted()
  let pending = pendingByRegistry.get(registry)
  if (!pending) { pending = new Map(); pendingByRegistry.set(registry, pending) }
  const key = `${providerId}:${initial.identity}`
  let operation = pending.get(key)
  if (!operation) {
    const controller = new AbortController()
    const startedAt = new Date().toISOString()
    const entry: Pending = { controller, subscribers: 0, done: false, promise: Promise.resolve({ ok: true, models: [], modelProfiles: {}, source: 'manual', lastAttemptStatus: 'success' }) }
    entry.promise = (async () => {
      const { profile } = initial
      const preset = initial.effective.sources.discovery === 'connection' || initial.effective.sources.discovery === 'group' ? undefined : resolvePresetDiscovery(profile)
      const result = await probeModelDescriptors({ kind: profile.kind, authType: profile.authType, baseUrl: profile.baseUrl,
        endpointFormat: profile.endpointFormat, endpoints: profile.endpoints,
        apiKey: initial.resolved.apiKey, headers: initial.headers, customHeaders: initial.customHeaders, fallbackModels: [...new Set([...profile.models, ...(initial.effective.configuration?.manualModels ?? [])])],
        authProfile: initial.effective.authProfile, headerProfile: initial.effective.headerProfile,
        proxyUrl: initial.proxyUrl, discovery: initial.effective.discovery, presetDiscovery: preset ?? undefined, signal: controller.signal })
      controller.signal.throwIfAborted()
      const latest = await catalogBinding(registry, providerId)
      if (latest.identity !== initial.identity) throw new Error('Provider configuration changed during discovery; refresh the current connection')
      const previous = await readModelCatalog(registry['options'].dataDir, profile.id, initial.identity)
      const retained = result.lastAttemptStatus === 'fallback' && previous && !previous.identityChanged && previous.source === 'provider'
      const output: ModelDiscoveryResult = retained ? { ...result, models: previous.models,
        modelProfiles: previous.modelProfiles ?? {}, modelDetails: previous.modelDetails, source: 'provider', stale: true } : result
      const { models, modelProfiles } = output
      const manual = output.source !== 'provider'
      const observedAt = new Date().toISOString()
      const evidence = { ...(previous?.identityChanged ? undefined : previous?.evidence) ?? emptyProviderEvidence(),
        credential: { status: profile.authType === 'none' ? 'not-required' as const : initial.resolved.apiKey.trim() ? 'success' as const : 'unknown' as const, observedAt },
        connectivity: retained ? previous.evidence?.connectivity ?? { status: 'unknown' as const } : { status: manual ? 'unknown' as const : 'success' as const, ...(manual ? {} : { observedAt }) },
        catalog: retained ? previous.evidence?.catalog ?? { status: 'unknown' as const } : { status: manual ? 'unknown' as const : 'success' as const, ...(manual ? {} : { observedAt }) } }
      await writeModelCatalog(registry['options'].dataDir, profile.id, {
        fetchedAt: retained ? previous.fetchedAt : new Date().toISOString(), startedAt, configurationRevision: initial.document.revision,
        identity: initial.identity, evidence, source: output.source, models, modelProfiles, modelDetails: output.modelDetails,
        ...(previous && !previous.identityChanged ? { catalogProfiles: previous.catalogProfiles, suggestions: previous.suggestions, publicCatalogFetchedAt: previous.publicCatalogFetchedAt, publicCatalogStale: previous.publicCatalogStale } : {}),
        modelVerification: previous?.identityChanged ? undefined : previous?.modelVerification,
        lastAttemptAt: new Date().toISOString(), lastAttemptStatus: result.lastAttemptStatus,
        baseUrl: profile.baseUrl, endpointFormat: profile.endpointFormat
      }).catch(() => undefined)
      if (result.source !== 'manual' && models.length > 0 && (resolveModelsDevProvider({ providerId: publicCatalogProviderId(profile), baseUrl: profile.baseUrl ?? '' }) || models.some((model) => /(?:^|\/)(?:gpt-|claude-|gemini-|deepseek-|glm-|qwen|kimi-|mimo-|grok-)/iu.test(model)))) void enrichPublicCatalog(registry, providerId, initial.identity, initial.document.revision, publicCatalogProviderId(profile), profile.baseUrl ?? '', models, initial.proxyUrl)
      await registry.refreshMetadata()
      return { ok: true as const, ...output }
    })().catch(async (error) => {
      const latest = await catalogBinding(registry, providerId).catch(() => null)
      if (!controller.signal.aborted && latest?.identity === initial.identity) {
        const previous = await readModelCatalog(registry['options'].dataDir, providerId, initial.identity)
        const observedAt = new Date().toISOString()
        const evidence = previous && !previous.identityChanged ? previous.evidence ?? emptyProviderEvidence() : emptyProviderEvidence()
        const reached = error instanceof ProviderDiscoveryResponseError
        const denied = error instanceof ProviderSecretScopeError || error instanceof ProviderDiscoveryConfigurationError
        await writeModelCatalog(registry['options'].dataDir, providerId, {
          ...(previous && !previous.identityChanged ? previous : { fetchedAt: observedAt, startedAt, models: [], source: 'manual' as const }),
          identity: initial.identity, configurationRevision: initial.document.revision,
          evidence: { ...evidence,
            credential: { status: initial.profile.authType === 'none' ? 'not-required' : initial.resolved.apiKey.trim() ? 'success' : 'unknown', observedAt },
            connectivity: { status: reached ? 'success' : denied ? 'unknown' : 'failed', observedAt },
            catalog: { status: reached ? 'failed' : 'unknown', observedAt } },
          lastAttemptAt: observedAt, lastAttemptStatus: 'failed'
        }).catch(() => undefined)
        await registry.refreshMetadata().catch(() => undefined)

      }
      throw error
    }).finally(() => { entry.done = true; if (pending!.get(key) === entry) pending!.delete(key) })
    pending.set(key, entry); operation = entry
  }
  return subscribe(operation, signal)
}

function subscribe(operation: Pending, signal?: AbortSignal): Promise<Result> {
  operation.subscribers++
  return new Promise((resolve, reject) => {
    let settled = false
    const release = () => {
      if (settled) return false
      settled = true; signal?.removeEventListener('abort', abort)
      operation.subscribers--
      if (!operation.done && operation.subscribers === 0) operation.controller.abort(new Error('Model discovery cancelled'))
      return true
    }
    const abort = () => { if (release()) reject(signal?.reason ?? new Error('Model discovery cancelled')) }
    signal?.addEventListener('abort', abort, { once: true })
    operation.promise.then((value) => { if (release()) resolve(value) }, (error) => { if (release()) reject(error) })
    if (signal?.aborted) abort()
  })
}

export async function connectionCatalog(registry: ModelConnectionRegistry, providerId: string) {
  try {
    const current = await catalogBinding(registry, providerId)
    const catalog = await readModelCatalog(registry['options'].dataDir, providerId, current.identity)
    const snapshot = catalog ? await registry.snapshot() : undefined
    const effectiveProfiles = snapshot?.providers.find((profile) => profile.id === providerId)?.modelCapabilities
    return catalog ? { ...catalog, effectiveProfiles, evidence: catalog.identityChanged ? emptyProviderEvidence() : catalog.evidence ?? emptyProviderEvidence(), selectedModels: current.profile.models,
      manualModels: current.effective.configuration?.manualModels ?? [],
      unavailableModels: catalog.identityChanged || catalog.source !== 'provider' ? []
        : current.profile.models.filter((model) => !catalog.models.includes(model)) } : null
  } catch {
    const document = await registry['file'].read(emptyDocument)
    requireProfile(document, providerId)
    const old = await readModelCatalog(registry['options'].dataDir, providerId, 'unavailable-credential')
    return old ? { ...old, evidence: { ...emptyProviderEvidence(), credential: { status: 'failed' as const, observedAt: new Date().toISOString() } } } : null
  }
}

/** Only completed real requests establish protocol/inference evidence. Discovery cannot do this. */
export async function recordProviderInferenceEvidence(registry: ModelConnectionRegistry, providerId: string, model: string, expectedRevision?: number, outcome: { success: boolean; reason?: string; expectedIdentity?: string; protocol?: string } = { success: true }): Promise<void> {
  const current = await catalogBinding(registry, providerId)
  if (expectedRevision !== undefined && current.document.revision !== expectedRevision) return
  if (outcome.expectedIdentity && current.identity !== outcome.expectedIdentity) return
  const previous = await readModelCatalog(registry['options'].dataDir, providerId, current.identity)
  const observedAt = new Date().toISOString()
  const evidence = previous && !previous.identityChanged ? previous.evidence ?? emptyProviderEvidence() : emptyProviderEvidence()
  const protocol = outcome.protocol ?? current.profile.modelCapabilities?.[model]?.endpointFormat ?? current.effective.fullEndpointProtocol ?? current.profile.endpointFormat ?? 'unknown'
  const key = `${model}:${protocol}`
  const fallback = previous && !previous.identityChanged ? previous : { fetchedAt: observedAt, models: current.profile.models,
    source: 'manual' as const, identity: current.identity, configurationRevision: current.document.revision }
  await patchModelCatalog(registry['options'].dataDir, providerId, fallback, (latest) => {
    const previousModels = latest.modelVerification ?? {}
    const validation = { ...previousModels[key], model, protocol,
      ...(outcome.success ? { lastSuccessAt: observedAt } : { lastFailureAt: observedAt, ...(outcome.reason ? { reason: outcome.reason.slice(0, 128) } : {}) }) }
    const modelVerification = { ...previousModels, [key]: validation }
    if (Object.keys(modelVerification).length > 6000) {
      const oldest = Object.entries(modelVerification).sort((a, b) =>
        (a[1].lastFailureAt ?? a[1].lastSuccessAt ?? '').localeCompare(b[1].lastFailureAt ?? b[1].lastSuccessAt ?? ''))
      for (const [id] of oldest.slice(0, oldest.length - 6000)) delete modelVerification[id]
    }
    return { ...latest, modelVerification,
      evidence: outcome.success ? { ...latest.evidence ?? evidence, credential: { status: current.profile.authType === 'none' ? 'not-required' : 'success', observedAt },
        connectivity: { status: 'success', observedAt }, protocol: { status: 'success', observedAt }, inference: { status: 'success', observedAt, model } }
        : { ...latest.evidence ?? evidence, inference: { status: 'failed', observedAt, model } } }
  })
}

async function enrichPublicCatalog(registry: ModelConnectionRegistry, providerId: string, identity: string,
  revision: number, catalogId: string, baseUrl: string, models: string[], proxyUrl: string, notify = true): Promise<boolean> {
  try {
    const result = await publicCatalogService(registry).fetch({ providerId: catalogId, baseUrl,
      modelHints: models.map((id) => ({ id })) }, { proxyUrl })
    if (result.status !== 'ok') return false
    const current = await catalogBinding(registry, providerId)
    if (current.identity !== identity) return false
    const previous = await readModelCatalog(registry['options'].dataDir, providerId, identity)
    if (!previous || previous.identityChanged || previous.configurationRevision !== revision) return false
    const allowed = new Set(models)
    const exact = result.models.filter((model) => allowed.has(model.id) && model.matchSpecificity === 'exact')
    const nextPublic = {
      catalogProfiles: Object.fromEntries(exact.map((model) => [model.id, publicCatalogProfile(model, result.source)])),
      suggestions: result.models.filter((model) => allowed.has(model.id) && model.matchSpecificity !== 'exact'),
      publicCatalogFetchedAt: result.models[0]?.observedAt, publicCatalogStale: result.stale
    }
    const oldPublic = { catalogProfiles: previous.catalogProfiles, suggestions: previous.suggestions,
      publicCatalogFetchedAt: previous.publicCatalogFetchedAt, publicCatalogStale: previous.publicCatalogStale }
    if (JSON.stringify(nextPublic) === JSON.stringify(oldPublic)) return false
    await patchModelCatalog(registry['options'].dataDir, providerId, previous, (latest) => ({ ...latest, ...nextPublic }))
    if (notify) await registry.refreshMetadata()
    return true
  } catch { return false /* Public metadata must never turn account discovery into failure. */ }
}

/** Warm public metadata for standalone Runtime clients without making inference calls. */
const publicRefreshes = new WeakMap<ModelConnectionRegistry, Promise<void>>()
export function refreshPublicCatalogs(registry: ModelConnectionRegistry): Promise<void> {
  const pending = publicRefreshes.get(registry)
  if (pending) return pending
  const operation = refreshPublicCatalogsInner(registry).finally(() => publicRefreshes.delete(registry))
  publicRefreshes.set(registry, operation)
  return operation
}

async function refreshPublicCatalogsInner(registry: ModelConnectionRegistry): Promise<void> {
  const document = await registry['file'].read(emptyDocument)
  const profiles = Object.values(document.profiles)
  let cursor = 0, changed = false
  await Promise.allSettled(Array.from({ length: Math.min(8, profiles.length) }, async () => {
    while (cursor < profiles.length) {
      const profile = profiles[cursor++]!
      try {
        const catalogId = publicCatalogProviderId(profile)
        if (!profile.models.length || !resolveModelsDevProvider({ providerId: catalogId, baseUrl: profile.baseUrl ?? '' })) continue
        const current = await catalogBinding(registry, profile.id)
        const previous = await readModelCatalog(registry['options'].dataDir, profile.id, current.identity)
        if (!previous || previous.identityChanged) await writeModelCatalog(registry['options'].dataDir, profile.id, {
          fetchedAt: new Date().toISOString(), models: [...profile.models], source: 'manual', identity: current.identity,
          configurationRevision: document.revision, evidence: emptyProviderEvidence() })
        const updated = await enrichPublicCatalog(registry, profile.id, current.identity, document.revision, catalogId,
          profile.baseUrl ?? '', previous && !previous.identityChanged ? previous.models : profile.models, current.proxyUrl, false)
        changed ||= updated
      } catch { /* One unavailable credential must not prevent the other accounts warming. */ }
    }
  }))
  // Rebuild the routed clients and publish one metadata generation per batch.
  if (changed) await registry.refreshMetadata()
}
