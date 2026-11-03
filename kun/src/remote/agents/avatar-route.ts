import type { ServerRuntime } from '../../server/routes/server-runtime.js'
import type { Router } from '../../server/router.js'
import { authorize } from '../../server/routes/route-auth.js'
import { jsonResponse } from '../../server/response.js'
import { RemoteAgentAvatar } from './avatar.js'
import { AvatarExportParams } from './appearance-contracts.js'
export function registerRemoteAvatarRoute(router: Router, runtime: ServerRuntime) {
  const avatar = new RemoteAgentAvatar(runtime)
  router.add('GET', '/v1/remote/agents/:agentId/avatar', async (request, { params }) => {
    if (!authorize(request, runtime)) return jsonResponse({ code: 'unauthorized' }, 401)
    try {
      const query = new URL(request.url).searchParams, raw = query.get('revision')
      if (!raw || !/^(0|[1-9][0-9]{0,15})$/.test(raw) || [...query.keys()].some((key) => key !== 'revision')) throw new Error('AVATAR_NOT_ALLOWED')
      const p = AvatarExportParams.parse({ agentId: params.agentId, avatarRevision: Number(raw) })
      const result = await avatar.read(p.agentId, p.avatarRevision)
      return new Response(new Uint8Array(result.data), { headers: { 'Content-Type': 'image/jpeg',
        'X-Kun-File-Name': 'avatar.jpg', 'X-Kun-Avatar-Revision': String(p.avatarRevision),
        'X-Kun-Content-SHA256': result.sha256, 'Cache-Control': 'no-store' } })
    } catch { return jsonResponse({ code: 'AVATAR_NOT_ALLOWED' }, 403) }
  })
}
