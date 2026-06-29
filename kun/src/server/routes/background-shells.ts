import type { BackgroundShellRuntime } from '../../services/background-shell-runtime.js'
import { jsonResponse, type JsonResponse } from '../response.js'
import { ERRORS } from './runtime-error.js'

export async function backgroundShellList(
  runtime: BackgroundShellRuntime | undefined,
  request: Request
): Promise<JsonResponse> {
  if (!runtime) {
    return jsonResponse({ sessions: [], running: 0 })
  }
  const url = new URL(request.url)
  const threadId = url.searchParams.get('thread_id') ?? undefined
  const sessions = runtime.listSessions(threadId)
  return jsonResponse({
    sessions,
    running: sessions.filter((session) => session.status === 'running').length
  })
}

export async function backgroundShellGet(
  runtime: BackgroundShellRuntime | undefined,
  sessionId: string
): Promise<JsonResponse> {
  if (!runtime) return ERRORS.unavailable('background shell runtime is unavailable')
  if (!sessionId.trim()) return ERRORS.validation('sessionId is required', [])
  const session = runtime.getSession(sessionId)
  if (!session) return ERRORS.notFound(`background shell not found: ${sessionId}`)
  return jsonResponse(session)
}

export async function backgroundShellStop(
  runtime: BackgroundShellRuntime | undefined,
  sessionId: string
): Promise<JsonResponse> {
  if (!runtime) return ERRORS.unavailable('background shell runtime is unavailable')
  if (!sessionId.trim()) return ERRORS.validation('sessionId is required', [])
  const stopped = await runtime.stopSession(sessionId)
  return jsonResponse({ sessionId, stopped })
}

export { ERRORS as BackgroundShellErrors }
