import { gatewayPoolTargets } from '../../domain/model-gateway-export-policy.js'
import type { HarnessModelCatalogError } from '../../contracts/harness-models.js'
import { nativeAgentNetworkStatus } from '../../harness/native-agent-network.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import {
  HarnessDefinitionSchema,
  HarnessIdSchema,
  type HarnessStatus
} from '../../contracts/harness.js'
import {
  HarnessProbeDefinitionRequestSchema,
  HarnessSecretCreateRequestSchema,
  HarnessTestRequestSchema
} from '../../contracts/harness-test.js'
import { runHarnessTest } from '../../services/harness-test-service.js'
import { customToDefinition } from '../../harness/harness-catalog.js'
import { probeAcpHandshake } from '../../harness/acp-handshake-probe.js'
import { exposableProvider, providerModelIds } from './model-gateway-core.js'
import { legacyProviderKindFor } from '../../harness/harness-provider-kind.js'

/**
 * `GET /v1/harnesses` — definitions plus detection status. With `wait_ms`
 * the handler briefly waits for inflight detections before answering so a
 * first-load client can show real verdicts instead of `unknown` forever
 * (P4-02). Rows still mid-detect carry `status.detecting: true`.
 */
const HARNESS_LIST_MAX_WAIT_MS = 30_000

export async function listHarnesses(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return jsonResponse({ harnesses: [] })
  const url = new URL(request.url)
  const usage = url.searchParams.get('usage') ?? undefined
  const waitMs = clampWaitMs(url.searchParams.get('wait_ms'))
  const includeDisabled = url.searchParams.get('include_disabled') === 'true'
  const list = harnesses.catalog.list().filter((definition) => definition.availability !== 'retired' &&
    (includeDisabled || !harnesses.catalog.isDisabled(definition.id)))

  for (const definition of list) harnesses.readiness?.warmProfiles(definition.id)
  // Start every detection up front so the wait window covers all of them.
  const statuses = new Map(list.map((definition) => [
    definition.id,
    harnesses.detector.peek(definition.id)
  ]))
  if (waitMs > 0) {
    const pending = list
      .filter((definition) => {
        const status = statuses.get(definition.id)
        return status?.detecting === true || harnesses.detector.detecting(definition.id)
      })
      .map((definition) => harnesses.detector.status(definition.id).catch(() => undefined))
    if (pending.length > 0) {
      await Promise.race([
        Promise.allSettled(pending),
        new Promise((resolve) => setTimeout(resolve, waitMs))
      ])
      for (const definition of list) {
        // Only the finished detections can land — awaiting `status` again
        // here would defeat the wait cap.
        const settled = harnesses.detector.cachedStatus(definition.id)
        if (settled) statuses.set(definition.id, settled)
      }
    }
  }

  const rows = await Promise.all(
    list.map(async (definition) => {
      const status = markDetecting(
        // A fast-settling detection may already have replaced the
        // optimistic peek placeholder — prefer the fresh cache.
        harnesses.detector.cachedStatus(definition.id) ?? statuses.get(definition.id),
        harnesses.detector.detecting(definition.id) || harnesses.readiness?.checking(definition.id) === true
      ) ?? {
        harnessId: definition.id,
        installed: 'unknown' as const,
        login: 'unknown' as const,
        checkedAt: runtime.nowIso(),
        detecting: true
      }
      Object.assign(status, nativeAgentNetworkStatus(definition))
      const enabledProfiles = harnesses.catalog.enabledProfiles?.(definition.id) ?? []
      const readyProfiles = await harnesses.readiness?.readyProfiles(definition.id) ?? []
      // Warming already started for every row above; only report its state.
      if (harnesses.readiness?.checking(definition.id)) status.detecting = true
      const row: Record<string, unknown> = { definition, status, enabled: !harnesses.catalog.isDisabled(definition.id), enabledProfiles, readyProfiles }
      if (usage && runtime.harnessAdmission && status) {
        row.admission = await runtime
          .harnessAdmission({ definition, status, usage })
          .catch(() => undefined)
      }
      return row
    })
  )
  return jsonResponse({ harnesses: rows })
}

function clampWaitMs(raw: string | null): number {
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10)
  if (!Number.isFinite(parsed) || parsed <= 0) return 0
  return Math.min(parsed, HARNESS_LIST_MAX_WAIT_MS)
}

function markDetecting(
  status: HarnessStatus | undefined,
  inflight: boolean
): HarnessStatus | undefined {
  if (!status) return status
  if (!inflight && status.detecting !== true) return status
  return { ...status, detecting: inflight }
}

export async function probeHarness(
  runtime: ServerRuntime,
  request: Request,
  params: Record<string, string>
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return ERRORS.notFound('harness catalog is unavailable')
  const parsedId = HarnessIdSchema.safeParse(params.id)
  if (!parsedId.success) return ERRORS.validation('invalid harness id')
  const definition = harnesses.catalog.get(parsedId.data)
  if (!definition || definition.availability === 'retired') return ERRORS.notFound(`unavailable harness: ${parsedId.data}`)
  const status = await harnesses.detector.status(definition.id, { force: true })
  return jsonResponse({ definition, status: { ...status, ...nativeAgentNetworkStatus(definition) } })
}

/**
 * `POST /v1/harnesses/:id/test` (docs/ade/impl/p4 §3.5, P4-10): progressive
 * detect → handshake → trial checks; the trial runs on a side thread that
 * never appears in conversation lists and is deleted afterwards.
 */
export async function testHarness(
  runtime: ServerRuntime,
  request: Request,
  params: Record<string, string>
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return ERRORS.notFound('harness catalog is unavailable')
  const parsedId = HarnessIdSchema.safeParse(params.id)
  if (!parsedId.success) return ERRORS.validation('invalid harness id')
  const definition = harnesses.catalog.get(parsedId.data)
  if (!definition || definition.availability === 'retired') return ERRORS.notFound(`unavailable harness: ${parsedId.data}`)
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = HarnessTestRequestSchema.safeParse(body.value)
  if (!parsed.success) return ERRORS.validation('invalid harness test body', parsed.error.issues)
  if (
    parsed.data.credentialMode &&
    !definition.credentialModes.includes(parsed.data.credentialMode)
  ) {
    return ERRORS.validation(
      `credentialMode ${parsed.data.credentialMode} is not supported by ${definition.id}`
    )
  }
  // An explicitly requested live trial stays separate from Check & enable.
  // It can run only after this exact profile was enabled and checked locally.
  if (parsed.data.level === 'trial' && harnesses.readiness) {
    try { await harnesses.readiness.assertReady(harnesses.readiness.route(definition, parsed.data), request.signal) }
    catch { return jsonResponse({ code: 'harness_not_ready', message: 'Test and enable this exact profile before running a live trial' }, 409) }
  }
  const result = harnesses.readiness && parsed.data.level !== 'trial'
    ? await harnesses.readiness.test(definition, parsed.data, request.signal)
    : await runHarnessTest(runtime, definition, parsed.data, request.signal)
  return jsonResponse(result)
}

export async function listHarnessModels(
  runtime: ServerRuntime,
  request: Request,
  params: Record<string, string>
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return ERRORS.notFound('harness catalog is unavailable')
  const parsedId = HarnessIdSchema.safeParse(params.id)
  if (!parsedId.success) return ERRORS.validation('invalid harness id')
  const definition = harnesses.catalog.get(parsedId.data)
  if (!definition || definition.availability === 'retired') return ERRORS.notFound(`unavailable harness: ${parsedId.data}`)

  const url = new URL(request.url)
  if (url.searchParams.get('refresh') === '1') harnesses.invalidateModels?.(definition.id)
  const cachedModels = harnesses.probedModels?.(definition)
  const selectedModelParam = url.searchParams.get('selected_model')?.trim() || undefined
  const reply = (body: Record<string, unknown>, source: 'native' | 'cache' | 'fallback' | 'provider' | 'static') => {
    const detected = harnesses.detector?.cachedStatus?.(definition.id)
    const { error, ...rest } = body as Record<string, unknown> & { error?: HarnessModelCatalogError }
    // fetchedAt is the probe's own timestamp; a response time would claim a
    // fresh lookup that never happened.
    const fetchedAt = definition.transport === 'acp'
      ? harnesses.acpModels?.fetchedAt?.(definition, selectedModelParam)
      : definition.transport === 'agent-sdk' ? harnesses.agentSdkModels?.fetchedAt?.(definition)
        : definition.transport === 'codex-app-server' ? harnesses.codexModels?.fetchedAt?.(definition) : undefined
    return jsonResponse({ ...rest, catalogStatus: { source,
      fetchedAt: fetchedAt ?? new Date().toISOString(),
      ...(detected?.version ? { version: detected.version } : {}),
      ...(detected?.resolvedCommand ? { command: detected.resolvedCommand } : {}),
      ...(source === 'fallback' ? { message: 'model_catalog_unavailable' } : {}),
      ...(error ? { error } : {}) } })
  }
  // A live failure that still carries the last good catalog is served as cache.
  const catalogSource = (catalog: { models: string[]; error?: unknown }): 'native' | 'cache' | 'fallback' =>
    catalog.models.length === 0 ? 'fallback' : catalog.error || cachedModels ? 'cache' : 'native'
  const credentialMode = url.searchParams.get('credential_mode') ?? undefined
  if (credentialMode && !definition.credentialModes.some((mode) => mode === credentialMode)) {
    return ERRORS.validation(`credentialMode ${credentialMode} is not supported by ${definition.id}`)
  }

  // Cursor provider mode consumes its SDK account; gateway modes consume
  // exposable HTTP profiles. Keep the displayed route identical to admission.
  if (credentialMode === 'provider' || credentialMode === 'kun-gateway') {
    const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
    const groups = (snapshot?.providers ?? [])
      .filter((provider) => {
        if (credentialMode === 'provider' && definition.transport === 'cursor-sdk') {
          return provider.kind === 'cursor-sdk' && provider.configured &&
            (!provider.credentialStatus || provider.credentialStatus === 'ready')
        }
        return exposableProvider(provider)
      })
      .map((provider) => ({
        providerId: provider.id,
        label: provider.name,
        models: providerModelIds(provider),
        ...(Object.keys(provider.modelCapabilities ?? {}).length ? { modelInfo: providerModelIds(provider).map((id) => ({ id,
          ...(provider.modelCapabilities?.[id]?.inputModalities
            ? { inputModalities: provider.modelCapabilities[id].inputModalities } : {})
        })) } : {})
      }))
      .filter((group) => group.models.length > 0)
    const aliasGroups = credentialMode === 'kun-gateway' ? (snapshot?.routePools ?? []).filter((pool) => pool.enabled).flatMap((pool) => {
      const targets = gatewayPoolTargets(snapshot?.providers ?? [], pool)
      return targets.length ? [{ routeId: pool.id, label: pool.name, modelId: pool.modelId, connectionIds: [...new Set(targets.map((target) => target.providerId))] }] : []
    }) : []
    return reply({ harnessId: definition.id, credentialMode, models: [], groups, aliasGroups }, 'provider')
  }

  if (definition.modelSource === 'probe' && harnesses.catalog.isDisabled(definition.id)) {
    return reply({ harnessId: definition.id, models: harnesses.probedModels?.(definition) ?? definition.staticModels,
      reason: 'check_required', message: 'Run Check & enable before loading native models',
      error: { code: 'unavailable', message: 'Run Check & enable before loading native models' } }, 'fallback')
  }

  const providerModels = (kind: string | undefined): string[] => {
    const providers = runtime.providerConfigs?.() ?? {}
    const models = new Set<string>()
    for (const provider of Object.values(providers)) {
      if (kind && provider.kind !== kind) continue
      for (const model of provider.models ?? []) models.add(model)
      if (provider.selectedModel) models.add(provider.selectedModel)
    }
    return [...models].sort()
  }

  switch (definition.modelSource) {
    case 'static':
      return reply({ harnessId: definition.id, models: definition.staticModels }, 'static')
    case 'provider':
      return reply({
        harnessId: definition.id,
        models: providerModels(legacyProviderKindFor(definition.id))
      }, 'provider')
    case 'probe': {
      if (definition.transport === 'pi-rpc' && harnesses.piModels) {
        const models = await harnesses.piModels.probe(definition, request.signal)
        return reply({ harnessId: definition.id, models }, models.length ? cachedModels ? 'cache' : 'native' : 'fallback')
      }
      if (definition.transport === 'acp' && harnesses.acpModels?.probeCatalog) {
        if (selectedModelParam && selectedModelParam.length > 1024) return ERRORS.validation('invalid model id')
        const catalog = await harnesses.acpModels.probeCatalog(definition, selectedModelParam)
        return reply({ harnessId: definition.id, ...catalog }, catalogSource(catalog))
      }
      if (definition.transport === 'codex-app-server' && harnesses.codexModels?.probeCatalog) {
        const catalog = await harnesses.codexModels.probeCatalog(definition)
        return reply({ harnessId: definition.id, ...catalog }, catalogSource(catalog))
      }
      const probed =
        definition.transport === 'acp'
          ? await harnesses.acpModels?.probe(definition)
          : definition.transport === 'agent-sdk'
            ? await harnesses.agentSdkModels?.probe(definition)
            : definition.transport === 'codex-app-server'
              ? await harnesses.codexModels?.probe(definition)
              : undefined
      if (probed && probed.length > 0) {
        return reply({ harnessId: definition.id, models: probed }, cachedModels ? 'cache' : 'native')
      }
      // A probe that fails (missing binary, auth gate, timeout) falls back to
      // the harness's static list rather than failing the models request.
      return reply({ harnessId: definition.id, models: definition.staticModels,
        error: { code: 'unavailable' } }, 'fallback')
    }
  }
}

/**
 * `POST /v1/harnesses/probe-definition` (docs/ade/impl/p4 §3.7, P4-12):
 * handshake an unsaved custom ACP definition so the Agent Center can gate
 * "save" on a real initialize result. `secretEnv` refs resolve against the
 * credential store; their values never appear in the response or logs.
 */
export async function probeHarnessDefinition(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return ERRORS.unavailable('harness catalog is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = HarnessProbeDefinitionRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid harness definition', parsed.error.issues)
  }
  const built = HarnessDefinitionSchema.safeParse(
    customToDefinition({
      id: parsed.data.id ?? 'custom-probe',
      displayName: parsed.data.displayName,
      command: parsed.data.command,
      args: parsed.data.args,
      env: parsed.data.env,
      secretEnv: parsed.data.secretEnv
    })
  )
  if (!built.success) {
    return ERRORS.validation('invalid harness definition', built.error.issues)
  }
  const definition = built.data
  const started = Date.now()
  const handshake = await probeAcpHandshake(
    definition,
    definition.launch?.command ?? '',
    { resolveSecretEnv: harnesses.resolveSecretEnv, signal: request.signal }
  )
  return jsonResponse({ ...handshake, durationMs: Date.now() - started })
}

/**
 * `POST /v1/harness-secrets` — store one secret value in the credential
 * store and return its opaque `secretRef`. The value is never echoed back,
 * logged, or persisted into settings; entries only ever carry the ref.
 */
export async function createHarnessSecret(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse> {
  const credentials = runtime.extensionPlatform?.credentials
  if (!credentials) return ERRORS.unavailable('credential store is unavailable')
  const body = await readJsonBody(request)
  if (!body.ok) return body.response
  const parsed = HarnessSecretCreateRequestSchema.safeParse(body.value)
  if (!parsed.success) {
    return ERRORS.validation('invalid secret body', parsed.error.issues)
  }
  const secretRef = await credentials.create({ apiKey: parsed.data.value })
  return jsonResponse({ secretRef })
}

/**
 * `DELETE /v1/harness-secrets/:ref` — drop a stored secret so removing a
 * secretEnv row can also release the underlying credential.
 */
export async function deleteHarnessSecret(
  runtime: ServerRuntime,
  _request: Request,
  params: Record<string, string>
): Promise<JsonResponse> {
  const credentials = runtime.extensionPlatform?.credentials
  if (!credentials) return ERRORS.unavailable('credential store is unavailable')
  const ref = params.ref?.trim()
  if (!ref || ref.length > 256) return ERRORS.validation('invalid secret ref')
  await credentials.delete(ref)
  return jsonResponse({ ok: true })
}
