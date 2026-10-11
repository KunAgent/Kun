import { expect, it } from 'vitest'
import { runtimeRequestPayloadSchema } from './app-ipc-schemas'
import { REMOTE_ALLOWED_INVOKE_CHANNELS } from '../remote/remote-allowlist'
it('keeps pairing and authenticated IM ingress outside the generic renderer runtime proxy', () => {
  for (const [path, method] of [
    ['/v1/rooms/room/im-cards/card', 'GET'],
    ['/v1/rooms/room/im-cards/card/complete', 'POST'],
    ['/v1/rooms/room/im-connections/connection/messages', 'POST'],
    ['/v1/rooms/room/im-connections/connection/delivery?cursor=0', 'GET'],
    ['/v1/rooms/room/im-connections/connection/disconnect', 'POST']
  ]) expect(() => runtimeRequestPayloadSchema.parse({ path, method })).toThrow('runtime request path is not allowed')
  expect(REMOTE_ALLOWED_INVOKE_CHANNELS.has('personal-agent:im')).toBe(false)
})
