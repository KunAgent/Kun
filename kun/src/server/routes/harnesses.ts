import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'
import type { ServerRuntime } from './server-runtime.js'
import { HarnessIdSchema } from '../../contracts/harness.js'

/**
 * `GET /v1/harnesses` — definitions plus cached detection status. Never blocks
 * on a probe: uncached harnesses report `installed: 'unknown'` and a detection
 * is kicked off in the background.
 */
export async function listHarnesses(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse> {
  const harnesses = runtime.harnesses
  if (!harnesses) return jsonResponse({ harnesses: [] })
  const url = new URL(request.url)
  const usage = url.searchParams.get('usage') ?? undefined
  const list = harnesses.catalog.list()
  const rows = await Promise.all(
    list.map(async (definition) => {
      const status = harnesses.detector.peek(definition.id)
      const row: Record<string, unknown> = {
        definition,
        status: status ?? {
          harnessId: definition.id,
          installed: 'unknown',
          login: 'unknown',
          checkedAt: runtime.nowIso()
        }
      }
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
    case 'probe':
      if (definition.transport === 'acp' && harnesses.acpModels) {
        const probed = await harnesses.acpModels.probe(definition)
        if (probed.length > 0) {
          return jsonResponse({ harnessId: definition.id, models: probed })
        }
      }
      // A probe that fails (missing binary, auth gate, timeout) falls back to
      // the harness's static list rather than failing the models request.
      return jsonResponse({ harnessId: definition.id, models: definition.staticModels })
  }
}

export function legacyProviderKindFor(harnessId: string): string | undefined {
  switch (harnessId) {
    case 'claude-code':
      return 'agent-sdk'
    case 'cursor':
      return 'cursor-sdk'
    case 'antigravity':
      return 'antigravity-cli'
    default:
      return undefined
  }
}
