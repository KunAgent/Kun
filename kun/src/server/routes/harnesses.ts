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
  const list = harnesses.catalog.list()

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
        harnesses.detector.detecting(definition.id)
      ) ?? {
        harnessId: definition.id,
        installed: 'unknown' as const,
        login: 'unknown' as const,
        checkedAt: runtime.nowIso(),
        detecting: true
      }
      const row: Record<string, unknown> = { definition, status }
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
  if (!definition) return ERRORS.notFound(`unknown harness: ${parsedId.data}`)
  const status = await harnesses.detector.status(definition.id, { force: true })
  return jsonResponse({ definition, status })
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
  if (!definition) return ERRORS.notFound(`unknown harness: ${parsedId.data}`)
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
  const result = await runHarnessTest(runtime, definition, parsed.data)
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
  if (!definition) return ERRORS.notFound(`unknown harness: ${parsedId.data}`)

  const url = new URL(request.url)
  const credentialMode = url.searchParams.get('credential_mode') ?? undefined

  // `provider`/`kun-gateway` modes route through configured providers, so the
  // picker needs them grouped — and filtered to the exposable set the grant
  // could actually address (04 §5.5). Native modes keep the flat list below.
  if (credentialMode === 'provider' || credentialMode === 'kun-gateway') {
    const snapshot = await runtime.modelConnections?.snapshot().catch(() => undefined)
    const groups = (snapshot?.providers ?? [])
      .filter(exposableProvider)
      .map((provider) => ({
        providerId: provider.id,
        label: provider.name,
        models: providerModelIds(provider)
      }))
      .filter((group) => group.models.length > 0)
    return jsonResponse({ harnessId: definition.id, credentialMode, models: [], groups })
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
      return jsonResponse({ harnessId: definition.id, models: definition.staticModels })
    case 'provider':
      return jsonResponse({
        harnessId: definition.id,
        models: providerModels(legacyProviderKindFor(definition.id))
      })
    case 'probe': {
      const probed =
        definition.transport === 'acp'
          ? await harnesses.acpModels?.probe(definition)
          : definition.transport === 'agent-sdk'
            ? await harnesses.agentSdkModels?.probe(definition)
            : definition.transport === 'codex-app-server'
              ? await harnesses.codexModels?.probe(definition)
              : undefined
      if (probed && probed.length > 0) {
        return jsonResponse({ harnessId: definition.id, models: probed })
      }
      // A probe that fails (missing binary, auth gate, timeout) falls back to
      // the harness's static list rather than failing the models request.
      return jsonResponse({ harnessId: definition.id, models: definition.staticModels })
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
    { resolveSecretEnv: harnesses.resolveSecretEnv }
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

