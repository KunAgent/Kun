import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { authorize } from '../../server/routes/route-auth.js'
import { jsonResponse } from '../../server/response.js'
import { readJsonBody } from '../../server/read-json-body.js'
import { workboardSnapshot } from './snapshot.js'

const id = (value: unknown) => typeof value === 'string' && /^[A-Za-z0-9_-]{1,128}$/.test(value)

function completionAttention(value: unknown): Record<string, 'completed' | 'failed'> | undefined {
  if (value === undefined) return {}
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const entries = Object.entries(value)
  if (entries.length > 1000) return undefined
  for (const [threadId, outcome] of entries) {
    if (!id(threadId) || !['completed', 'failed'].includes(String(outcome))) return undefined
  }
  return Object.fromEntries(entries) as Record<string, 'completed' | 'failed'>
}

export function registerWorkboardRoutes(router: Router, runtime: ServerRuntime) {
  let flight: Promise<unknown> | undefined
  const read = async (request: Request, attention: Record<string, 'completed' | 'failed'>) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    try {
      flight ??= workboardSnapshot(runtime, Date.now(), attention).finally(() => { flight = undefined })
      return { ...jsonResponse(await flight), headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } }
    } catch { return jsonResponse({ code: 'WORKBOARD_UNAVAILABLE' }, 503) }
  }
  router.add('GET', '/v1/remote/workboard', request => read(request, {}))
  router.add('POST', '/v1/remote/workboard', async request => {
    const body = await readJsonBody(request, 256 * 1024)
    if (!body.ok) return body.response
    if (!body.value || typeof body.value !== 'object' || Array.isArray(body.value)) {
      return jsonResponse({ code: 'validation_error', message: 'invalid workboard attention body' }, 400)
    }
    const attention = completionAttention((body.value as Record<string, unknown>).attention)
    if (!attention) return jsonResponse({ code: 'validation_error', message: 'invalid workboard attention' }, 400)
    return read(request, attention)
  })
}
