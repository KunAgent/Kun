import { z } from 'zod'
import type { RoomRuntime } from '../../rooms/room-runtime.js'
import { Actor, readQueue, setActor, claimIssue, saveTicket } from '../../rooms/engagement/queue.js'
import { ApplyReceipt, applyReceipt } from '../../rooms/engagement/receipt.js'
import { readJsonBody } from '../read-json-body.js'
type Add=(method:string,path:string,handler:(rooms:RoomRuntime,request:Request)=>Promise<unknown>)=>void
/** Private main-process endpoints; deliberately absent from the renderer HTTP allowlist. */
export function registerEngagementRoutes(add:Add) {
  add('GET','/v1/rooms/engagement',async rooms=>(await readQueue(rooms.service.store)).state)
  const identity={actor:Actor,key:z.string().regex(/^[a-f0-9]{64}$/)}
  for(const [path,schema,run] of [
    ['actor',z.object({actor:Actor.nullable()}).strict(),(s:RoomRuntime,v:{actor:string|null})=>setActor(s.service.store,v.actor)],
    ['claim',z.object(identity).strict(),(s:RoomRuntime,v:{actor:string;key:string})=>claimIssue(s.service.store,v.actor,v.key)],
    ['ticket',z.object({...identity,ticket:z.object({ticketId:z.string().uuid(),expiresAt:z.string()}).strict().nullable()}).strict(),
      (s:RoomRuntime,v:{actor:string;key:string;ticket:{ticketId:string;expiresAt:string}|null})=>saveTicket(s.service.store,v.actor,v.key,v.ticket)],
    ['receipt',ApplyReceipt,(s:RoomRuntime,v:z.infer<typeof ApplyReceipt>)=>applyReceipt(s.service.store,v)]
  ] as const) add('POST','/v1/rooms/engagement/'+path,async(rooms,request)=>{
    const raw=await readJsonBody(request);if(!raw.ok)return raw.response
    const input=schema.parse(raw.value)
    return rooms.exclusive<unknown>(()=>run(rooms,input as never))
  })
}
