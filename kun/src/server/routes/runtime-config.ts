import { RuntimeConfigApplyRequest, type RuntimeConfigApplyResponse } from '../../contracts/runtime-config.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { readJsonBody } from '../read-json-body.js'
import type { ServerRuntime } from './server-runtime.js'

/**
 * Hot config apply carries the whole provider catalog (per-model capabilities,
 * pricing, evidence) plus every model profile. A real profile with 11 providers
 * and 229 profiles already sends ~1.15 MB, past the 1 MiB control-plane default,
 * so this one authenticated loopback route gets a larger, still bounded budget.
 */
export const RUNTIME_CONFIG_APPLY_MAX_BODY_BYTES = 8 * 1024 * 1024

export async function applyRuntimeConfig(
  runtime: ServerRuntime,
  request: Request
): Promise<JsonResponse | Response> {
  const body = await readJsonBody(request, RUNTIME_CONFIG_APPLY_MAX_BODY_BYTES)
  if (!body.ok) return body.response
  const parsed = RuntimeConfigApplyRequest.safeParse(body.value)
  if (!parsed.success) {
    return jsonResponse(
      {
        ok: false,
        code: 'invalid_config',
        message: `invalid runtime config apply body: ${parsed.error.issues.map((issue) => issue.message).join('; ')}`
      } satisfies RuntimeConfigApplyResponse,
      400
    )
  }

  const result = await runtime.applyConfig(parsed.data)
  return jsonResponse(result, result.ok ? 200 : result.code === 'restart_required' ? 409 : 400)
}
