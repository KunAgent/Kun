import { ProviderDiscoveryResponseError, ProviderDiscoveryConfigurationError } from './provider-discovery-error.js'
import { ProviderSecretScopeError } from './provider-request-security.js'
import { emptyProviderEvidence } from '../contracts/provider-verification-evidence.js'
import { type ModelConnectionRegistry, emptyDocument, requireProfile } from './model-connection-registry-core.js'
import { materializeLegacyProviderCredential } from './legacy-provider-credential-migration.js'
import { effectiveProviderConfiguration } from './provider-effective-configuration.js'
import { resolveRegistryProfileProxyUrl } from './model-connection-registry-proxy.js'
import { readProviderHeaders, readProviderGeneratedHeaders } from './provider-protected-headers.js'
import { probeModels } from './model-connection-probe.js'
import { modelCatalogIdentity, readModelCatalog, writeModelCatalog } from './model-catalog-store.js'

async function binding(registry: ModelConnectionRegistry, providerId: string) {
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
  const identity = modelCatalogIdentity({ id: profile.id, accountId: profile.accountId,
    incarnationId: profile.incarnationId, credentialRef: profile.credentialRef, credential: resolved.apiKey,
    kind: profile.kind, authType: profile.authType, baseUrl: profile.baseUrl, endpointFormat: profile.endpointFormat,
    endpoints: profile.endpoints, headers: identityHeaders, proxyUrl, discovery: effective.discovery, authProfile: effective.authProfile, headerProfile: effective.headerProfile, adapterRevision: 3 })
  return { document, profile, effective, resolved, proxyUrl, headers, customHeaders, identity }
}

type Result = { ok: true; models: string[] }
type Pending = { promise: Promise<Result>; controller: AbortController; subscribers: number; done: boolean }
const pendingByRegistry = new WeakMap<ModelConnectionRegistry, Map<string, Pending>>()

export async function probeConnectionCatalog(registry: ModelConnectionRegistry, providerId: string, signal?: AbortSignal): Promise<Result> {
  signal?.throwIfAborted()
  const initial = await binding(registry, providerId)
  signal?.throwIfAborted()
  let pending = pendingByRegistry.get(registry)
  if (!pending) { pending = new Map(); pendingByRegistry.set(registry, pending) }
  const key = `${providerId}:${initial.identity}`
  let operation = pending.get(key)
  if (!operation) {
    const controller = new AbortController()
    const startedAt = new Date().toISOString()
    const entry: Pending = { controller, subscribers: 0, done: false, promise: Promise.resolve({ ok: true, models: [] }) }
    entry.promise = (async () => {
      const { profile } = initial
      const models = await probeModels({ kind: profile.kind, authType: profile.authType, baseUrl: profile.baseUrl,
        endpointFormat: profile.endpointFormat, endpoints: profile.endpoints,
        apiKey: initial.resolved.apiKey, headers: initial.headers, customHeaders: initial.customHeaders, fallbackModels: [...new Set([...profile.models, ...(initial.effective.configuration?.manualModels ?? [])])],
        authProfile: initial.effective.authProfile, headerProfile: initial.effective.headerProfile,
        proxyUrl: initial.proxyUrl, discovery: initial.effective.discovery, signal: controller.signal })
      controller.signal.throwIfAborted()
      const latest = await binding(registry, providerId)
      if (latest.identity !== initial.identity) throw new Error('Provider configuration changed during discovery; refresh the current connection')
      const isCodex = profile.baseUrl?.startsWith('https://chatgpt.com/backend-api/codex')
      const manual = profile.kind !== 'http' || initial.effective.discovery.mode === 'manual' ||
        (initial.effective.discovery.mode === 'auto' && profile.endpointFormat === 'custom_endpoint' && !isCodex)
      const previous = await readModelCatalog(registry['options'].dataDir, profile.id, initial.identity)
      const observedAt = new Date().toISOString()
      const evidence = { ...(previous?.identityChanged ? undefined : previous?.evidence) ?? emptyProviderEvidence(),
        credential: { status: profile.authType === 'none' ? 'not-required' as const : initial.resolved.apiKey.trim() ? 'success' as const : 'unknown' as const, observedAt },
        connectivity: { status: manual ? 'unknown' as const : 'success' as const, ...(manual ? {} : { observedAt }) },
        catalog: { status: manual ? 'unknown' as const : 'success' as const, ...(manual ? {} : { observedAt }) } }
      await writeModelCatalog(registry['options'].dataDir, profile.id, {
        fetchedAt: new Date().toISOString(), startedAt, configurationRevision: initial.document.revision,
        identity: initial.identity, evidence, source: manual ? 'manual' : 'provider', models,
        lastAttemptAt: new Date().toISOString(), lastAttemptStatus: 'success',
        baseUrl: profile.baseUrl, endpointFormat: profile.endpointFormat
      }).catch(() => undefined)
      return { ok: true as const, models }
    })().catch(async (error) => {
      if (!controller.signal.aborted) {
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
    const current = await binding(registry, providerId)
    const catalog = await readModelCatalog(registry['options'].dataDir, providerId, current.identity)
    return catalog ? { ...catalog, evidence: catalog.identityChanged ? emptyProviderEvidence() : catalog.evidence ?? emptyProviderEvidence(), selectedModels: current.profile.models,
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
export async function recordProviderInferenceEvidence(registry: ModelConnectionRegistry, providerId: string, model: string, expectedRevision?: number): Promise<void> {
  const current = await binding(registry, providerId)
  if (expectedRevision !== undefined && current.document.revision !== expectedRevision) return
  const previous = await readModelCatalog(registry['options'].dataDir, providerId, current.identity)
  const observedAt = new Date().toISOString()
  const evidence = previous && !previous.identityChanged ? previous.evidence ?? emptyProviderEvidence() : emptyProviderEvidence()
  await writeModelCatalog(registry['options'].dataDir, providerId, {
    ...(previous && !previous.identityChanged ? previous : { fetchedAt: observedAt, models: current.profile.models, source: 'manual' as const }),
    startedAt: observedAt, identity: current.identity, configurationRevision: current.document.revision,
    evidence: { ...evidence, credential: { status: current.profile.authType === 'none' ? 'not-required' : 'success', observedAt },
      connectivity: { status: 'success', observedAt }, protocol: { status: 'success', observedAt }, inference: { status: 'success', observedAt, model } }
  })
}
