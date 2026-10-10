/** Durable lifecycle outbox. All display context stays on this device. No network work here. */
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { RoomStoreConflictError, type RoomStore } from '../room-store.js'
export const KIND = 'room_engagement' as const
export const Actor = z.string().regex(/^[ug]:[a-f0-9-]{36}$/)
export const Status = z.enum(['completed', 'failed', 'cancelled'])
const Context = z.object({ runId: z.string().max(256), source: z.enum(['room', 'code']), roomId: z.string().optional(),
  threadId: z.string().optional(), messageId: z.string().optional(), sourceLabel: z.string().max(120).optional() }).strict()
export const Entry = Context.extend({ key: z.string(), actor: Actor, serverRunId: z.string(), startedAt: z.string(),
  status: Status.optional(), phase: z.enum(['pending','issuing','issued','done']), ticketId: z.string().uuid().optional(),
  expiresAt: z.string().optional(), receiptId: z.string().uuid().optional(), receiptReason:z.string().optional(), receiptResetAt:z.string().optional() }).strict()
export type EngagementEntry = z.infer<typeof Entry>
export type ActivityContext = z.infer<typeof Context>
export const Queue = z.object({ actor: Actor.nullable(), leaseUntil: z.number(), entries: z.array(Entry) }).strict()
export type EngagementQueue = z.infer<typeof Queue>
export const keyFor = (runId: string) => createHash('sha256').update(runId).digest('hex')
export async function readQueue(store: RoomStore) {
  const row = await store.get(KIND, 'self')
  return { revision: row?.revision ?? null, state: row ? Queue.parse(row.value) : { actor: null, leaseUntil: 0, entries: [] } as EngagementQueue }
}
export async function updateQueue<T>(store: RoomStore, change: (state: EngagementQueue) => { state: EngagementQueue; result: T; notify?: boolean }): Promise<T> {
  for (let attempt=0; ; attempt++) {
    const row = await readQueue(store), changed=change(row.state)
    if (changed.state===row.state && !changed.notify) return changed.result
    try {
      await store.commit({ requestId: 'engagement:'+randomUUID(), checks: [{kind:KIND,id:'self',expectedRevision:row.revision}],
        puts:[{kind:KIND,id:'self',value:changed.state}],
        events:changed.notify ? [{roomId:'agent-directory',kind:'wardrobe.activity',payload:{}}] : [] })
      return changed.result
    } catch (error) { if (!(error instanceof RoomStoreConflictError) || attempt>=4) throw error }
  }
}
export async function setActor(store: RoomStore, actor: string | null) {
  return updateQueue(store,state=>({state:{...state,actor,leaseUntil:Date.now()+30_000},result:null}))
}
export async function beginActivity(store: RoomStore, context: ActivityContext, startedAt: string) {
  // Event replay/recovery cannot retrospectively create a start ticket.
  const age=Date.now()-Date.parse(startedAt)
  if (!Number.isFinite(age) || age>30_000 || age < -30_000) return
  const clean=Context.parse({...context,sourceLabel:context.sourceLabel?.slice(0,120)})
  await updateQueue(store,state=> {
    if (!state.actor || state.leaseUntil<Date.now() || state.entries.some(e=>e.key===keyFor(context.runId))) return {state,result:null}
    const entries=state.entries.filter(e=>Date.now()-Date.parse(e.startedAt)<48*3600_000)
    if (entries.length>=256) return {state,result:null}
    entries.push({...clean,key:keyFor(context.runId),serverRunId:keyFor(context.runId),actor:state.actor,startedAt,phase:'pending'})
    return {state:{...state,entries},result:null,notify:true}
  })
}
export async function finishActivity(store: RoomStore, runId: string, status: z.infer<typeof Status>, messageId?: string) {
  await updateQueue(store,state=> {
    const entry=state.entries.find(e=>e.key===keyFor(runId))
    if(!entry || entry.status) return {state,result:null}
    return {state:{...state,entries:state.entries.map(e=>e.key===entry.key
      ? {...e,status,...(messageId?{messageId}: {})} : e)},result:null,notify:true}
  })
}
export async function claimIssue(store: RoomStore, actor: string, key: string) {
  return updateQueue(store,state=> {
    const e=state.entries.find(e=>e.key===key && e.actor===actor)
    if (state.actor!==actor || !e || e.status || e.phase==='done' || e.ticketId) return {state,result:null as EngagementEntry|null}
    const entry={...e,phase:'issuing' as const}
    return {state:{...state,entries:state.entries.map(e=>e.key===key?entry:e)},result:entry}
  })
}
export async function saveTicket(store: RoomStore, actor: string, key: string, ticket: {ticketId:string;expiresAt:string}|null) {
  return updateQueue(store,state=>({state:{...state,entries:state.entries.map(e=>e.key===key && e.actor===actor && e.phase!=='done'
    ? ticket ? {...e,...ticket,phase:'issued'} : {...e,phase:'done'} : e)},result:null}))
}
