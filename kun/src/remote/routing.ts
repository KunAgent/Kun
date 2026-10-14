import { createHash } from 'node:crypto'
import { realpath, stat } from 'node:fs/promises'
import { basename } from 'node:path'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import type { Router } from '../server/router.js'
export type LocalCall = (
  path: string,
  method?: string,
  body?: unknown,
  headers?: Record<string, string>
) => Promise<any>
export function localCaller(router: Router, runtime: ServerRuntime): LocalCall {
  return async (path, method = 'GET', body, headers = {}) => {
    const request = new Request('http://runtime' + path, {
      method,
      headers: {
        Authorization: 'Bearer ' + runtime.runtimeToken,
        'Content-Type': 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    const route = router.match(method, new URL(request.url).pathname)
    if (!route) throw new Error('UNSUPPORTED_OPERATION')
    const reply = await route.handler(request, { params: route.params })
    const value =
      reply instanceof Response ? await reply.json() : JSON.parse(reply.body)
    if (reply.status >= 400)
      throw new Error(
        typeof value.code === 'string' ? value.code : 'RUNTIME_REJECTED'
      )
    return value
  }
}
export async function requireCode(runtime: ServerRuntime, id: string) {
  const thread = await runtime.threadService.get(id)
  if (!thread) throw new Error('NOT_FOUND')
  if (
    thread.roomContext ||
    thread.workspaceMode === 'ade' ||
    thread.parentThreadId ||
    (thread.agentSurface && thread.agentSurface !== 'code')
  )
    throw new Error('NOT_A_CODE_TASK')
  return thread
}
export async function projects(runtime: ServerRuntime) {
  const roots = new Set((await runtime.rooms?.workbench.directory.get())?.codeProjects ?? [])
  let cursor: string | undefined
  const seen = new Set<string>()
  do {
    const page = await runtime.threadService.listPage({ workbenchScope: 'code', limit: 200, cursor })
    for (const thread of page.threads) {
      if (thread.workspaceMode !== 'ade' && !thread.parentThreadId &&
        (!thread.agentSurface || thread.agentSurface === 'code')) roots.add(thread.workspace)
    }
    if (!page.hasMore) break
    if (!page.nextCursor || seen.has(page.nextCursor)) throw new Error('PROJECT_DIRECTORY_UNAVAILABLE')
    cursor = page.nextCursor
    seen.add(cursor)
  } while (cursor)
  const result = []
  const canonicalRoots = new Set<string>()
  for (const path of roots) {
    try {
      const canonical = await realpath(path)
      if (!canonicalRoots.has(canonical) && (await stat(canonical)).isDirectory()) {
        canonicalRoots.add(canonical)
        result.push({
          id: createHash('sha256').update(canonical).digest('hex'),
          name: basename(canonical),
          path: canonical
        })
      }
    } catch {}
  }
  return result
}
export async function allowedThread(runtime: ServerRuntime, id: string) {
  const thread = await runtime.threadService.get(id)
  if (!thread) throw new Error('NOT_FOUND')
  if (thread.roomContext) {
    const room = await runtime.rooms!.service.get(thread.roomContext.roomId)
    if (room.conversationKind !== 'user_agent') throw new Error('FORBIDDEN')
    return thread
  }
  return requireCode(runtime, id)
}
