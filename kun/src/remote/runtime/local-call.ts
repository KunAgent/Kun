import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Router } from '../../server/router.js'
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
