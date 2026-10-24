import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { acknowledgeAnalytics, leaseAnalytics, readAnalytics } from '../../analytics/outbox.js'
import { readJsonBody } from '../read-json-body.js'
type Add = (method: string, path: string, handler: (rooms: RoomRuntime, request: Request) => Promise<unknown>) => void
/** Main-only local API. Do not add to renderer or Remote request allowlists. */
export function registerProductAnalyticsRoutes(add: Add) {
  add('GET', '/v1/product-analytics', async rooms => (await readAnalytics(rooms.service.store)).value)
  add('POST', '/v1/product-analytics/lease', async (rooms, request) => {
    const raw = await readJsonBody(request); if (!raw.ok) return raw.response
    const input = z.object({ epoch: z.string().uuid().nullable(), expectedEpoch: z.string().uuid().optional() }).strict().parse(raw.value)
    await leaseAnalytics(rooms.service.store, input.epoch, input.expectedEpoch); return { ok: true }
  })
  add('POST', '/v1/product-analytics/ack', async (rooms, request) => {
    const raw = await readJsonBody(request); if (!raw.ok) return raw.response
    const input = z.object({ epoch: z.string().uuid(), ids: z.array(z.string().uuid()).max(50) }).strict().parse(raw.value)
    await acknowledgeAnalytics(rooms.service.store, input.epoch, input.ids); return { ok: true }
  })
}
