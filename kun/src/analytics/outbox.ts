import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RoomStoreConflictError, type RoomStore } from '../rooms/room-store.js'
import { AnalyticsInput, ANALYTICS_LIMITS } from '../contracts/product-analytics.js'
const KIND = 'product_analytics' as const
const leases = new WeakMap<RoomStore, { epoch: string | null; until: number }>()
export const analyticsLeaseActive = (store: RoomStore) => (leases.get(store)?.until ?? 0) > Date.now()
const Pending = AnalyticsInput.extend({ eventId: z.string().uuid(), occurredAt: z.string().datetime() })
const State = z.object({ epoch: z.string().uuid().nullable(), leaseUntil: z.number(),
  after: z.string(), events: z.array(Pending).max(1000) })
export type PendingAnalytics = z.infer<typeof Pending>
export async function readAnalytics(store: RoomStore) {
  const row = await store.get(KIND, 'self')
  return { revision: row?.revision ?? null, value: row ? State.parse(row.value) :
    { epoch: null, leaseUntil: 0, after: new Date().toISOString(), events: [] } as z.infer<typeof State> }
}
export async function updateAnalytics(store: RoomStore, change: (state: z.infer<typeof State>) => z.infer<typeof State>) {
  for (let attempt = 0; ; attempt++) {
    const row = await readAnalytics(store), value = change(row.value)
    if (value === row.value) return
    try {
      await store.commit({ requestId: 'analytics-' + randomUUID(),
        checks: [{ kind: KIND, id: 'self', expectedRevision: row.revision }],
        puts: [{ kind: KIND, id: 'self', value }], events: [] })
      return
    } catch (error) { if (!(error instanceof RoomStoreConflictError) || attempt >= 3) throw error }
  }
}
export async function leaseAnalytics(store: RoomStore, epoch: string | null, expectedEpoch?: string) {
  if (expectedEpoch === undefined || leases.get(store)?.epoch === expectedEpoch)
    leases.set(store, { epoch, until: epoch ? Date.now() + 45_000 : 0 })
  await updateAnalytics(store, state => expectedEpoch !== undefined && state.epoch !== expectedEpoch ? state :
    ({ epoch, leaseUntil: epoch ? Date.now() + 45_000 : 0,
      after: state.epoch === epoch ? state.after : new Date().toISOString(),
      events: state.epoch === epoch && epoch ? state.events : [] }))
  const current = (await readAnalytics(store)).value
  leases.set(store, { epoch: current.epoch, until: current.leaseUntil })
}
export async function appendAnalytics(store: RoomStore, epoch: string, event: PendingAnalytics) {
  await updateAnalytics(store, state => {
    if (state.epoch !== epoch || state.leaseUntil < Date.now() || event.occurredAt < state.after) return state
    if (state.events.some(e => e.eventId === event.eventId)) return state
    const events = [...state.events.filter(e => Date.now() - Date.parse(e.occurredAt) < ANALYTICS_LIMITS.ageMs), event]
      .slice(-ANALYTICS_LIMITS.events)
    return { ...state, events }
  })
}
export async function acknowledgeAnalytics(store: RoomStore, epoch: string, ids: string[]) {
  await updateAnalytics(store, state => state.epoch !== epoch ? state :
    { ...state, events: state.events.filter(e => !ids.includes(e.eventId)) })
}
