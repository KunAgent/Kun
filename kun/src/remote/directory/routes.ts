import { REMOTE_SCOPES } from '@kun/remote-protocol'
import type { Router } from '../../server/router.js'
import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import { authorize } from '../../server/routes/route-auth.js'
import { jsonResponse } from '../../server/response.js'
import { RemoteId } from '../contracts.js'
import { RemoteDirectoryFeed } from './feed.js'

export function registerRemoteDirectoryRoutes(router: Router, runtime: ServerRuntime) {
  const feed = new RemoteDirectoryFeed(runtime)
  router.add('GET', '/v1/remote/directory-events', (request) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    try {
      for (const name of ['Account', 'Device', 'Authorization']) RemoteId.parse(request.headers.get('X-Kun-Remote-' + name))
      const scopes = (request.headers.get('X-Kun-Remote-Scopes') ?? '').split(',')
      if (!scopes.includes('personal') || scopes.some((scope) => !(REMOTE_SCOPES as readonly string[]).includes(scope)))
        throw new Error('REMOTE_SCOPE_REQUIRED')
      return feed.stream(request, scopes)
    } catch { return jsonResponse({ code: 'FORBIDDEN' }, 403) }
  })
}
