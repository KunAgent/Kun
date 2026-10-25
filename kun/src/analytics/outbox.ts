import { randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RoomStoreConflictError, type RoomStore } from '../rooms/room-store.js'
import { AnalyticsInput, ANALYTICS_LIMITS } from '../contracts/product-analytics.js'
const KIND = 'product_analytics' as const
const leases = new WeakMap<RoomStore, { epoch: string | null; until: number }>()
export const analyticsLeaseActive = (store: RoomStore) => (leases.get(store)?.until ?? 0) > Date.now()
const Pending = AnalyticsInput.extend({ eventId: z.string().uuid(), occurredAt: z.string().datetime() })
const State = z.object({ epoch: z.string().uuid().nullable(), leaseUntil: z.number(),
  after: z.string(), workAnalyticsVersion: z.union([z.literal(0), z.literal(1)]).default(0), events: z.array(Pending).max(1000) })
// Older Runtime versions parse only events with the Code/Room enum and strip
// unknown state fields. Keep Work outside that array so an app rollback can
// still renew/revoke its lease and collect the original events.
const StoredState = State.extend({
  workEvents: z.array(z.object({ position: z.number().int().min(0).max(999), event: Pending }).strict()).max(1000).default([])
}).superRefine((state, context) => {
  const total = state.events.length + state.workEvents.length
  const positions = new Set<number>()
  if (total > ANALYTICS_LIMITS.events) context.addIssue({ code: 'custom', message: 'analytics queue limit' })
  for (const entry of state.workEvents) {
    if (entry.position >= total || positions.has(entry.position) || entry.event.properties.mode !== 'work')
      context.addIssue({ code: 'custom', message: 'invalid Work analytics position' })
    positions.add(entry.position)
  }
})
export type PendingAnalytics = z.infer<typeof Pending>
function readStoredState(raw: unknown): z.infer<typeof State> {
  const { workEvents, ...state } = StoredState.parse(raw)
  const events = [...state.events]
  for (const entry of [...workEvents].sort((a, b) => a.position - b.position)) events.splice(entry.position, 0, entry.event)
  return { ...state, events }
}
function storedState(input: z.infer<typeof State>): z.infer<typeof StoredState> {
  const { events: combined, ...state } = State.parse(input)
  const events: PendingAnalytics[] = [], workEvents: z.infer<typeof StoredState>['workEvents'] = []
  combined.forEach((event, position) => {
    if (event.properties.mode === 'work') workEvents.push({ position, event })
    else events.push(event)
  })
  return { ...state, events, workEvents }
}
export async function readAnalytics(store: RoomStore) {
  const row = await store.get(KIND, 'self')
  return { revision: row?.revision ?? null, value: row ? readStoredState(row.value) :
    { epoch: null, leaseUntil: 0, after: new Date().toISOString(), workAnalyticsVersion: 0, events: [] } as z.infer<typeof State> }
}
export async function updateAnalytics(store: RoomStore, change: (state: z.infer<typeof State>) => z.infer<typeof State>) {
  for (let attempt = 0; ; attempt++) {
    const row = await readAnalytics(store), value = change(row.value)
    if (value === row.value) return
    try {
      await store.commit({ requestId: 'analytics-' + randomUUID(),
        checks: [{ kind: KIND, id: 'self', expectedRevision: row.revision }],
        puts: [{ kind: KIND, id: 'self', value: storedState(value) }], events: [] })
      return
    } catch (error) { if (!(error instanceof RoomStoreConflictError) || attempt >= 3) throw error }
  }
}
export async function leaseAnalytics(store: RoomStore, epoch: string | null, expectedEpoch?: string, workAnalyticsVersion: 0 | 1 = 0) {
  if (expectedEpoch === undefined || leases.get(store)?.epoch === expectedEpoch)
    leases.set(store, { epoch, until: epoch ? Date.now() + 45_000 : 0 })
  await updateAnalytics(store, state => expectedEpoch !== undefined && state.epoch !== expectedEpoch ? state :
    ({ epoch, leaseUntil: epoch ? Date.now() + 45_000 : 0, workAnalyticsVersion: epoch ? workAnalyticsVersion : 0,
      after: state.epoch === epoch ? state.after : new Date().toISOString(),
      events: state.epoch === epoch && epoch ? state.events.filter(e => workAnalyticsVersion === 1 || e.properties.mode !== 'work') : [] }))
  const current = (await readAnalytics(store)).value
  leases.set(store, { epoch: current.epoch, until: current.leaseUntil })
}
export async function appendAnalytics(store: RoomStore, epoch: string, event: PendingAnalytics) {
  await updateAnalytics(store, state => {
    if (state.epoch !== epoch || state.leaseUntil < Date.now() || event.occurredAt < state.after) return state
    if (event.properties.mode === 'work' && state.workAnalyticsVersion !== 1) return state
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
