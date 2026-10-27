import { expect, it, vi } from 'vitest'
import type { ThreadStore } from '../ports/thread-store.js'
import { bindPrivateTurnLifecycle, privateQueuedTurnAllowed } from './private-turn-lifecycle.js'

it('fails closed for a queued personal-assistant continuation before promotion', async () => {
 const threads={} as ThreadStore, thread={id:'thread',turns:[]} as never, turn={id:'turn',clientRequestId:'kun-assistant-handoff-abc'} as never
 expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(false)
 let allowed=true
 const unbind=bindPrivateTurnLifecycle(threads,{store:{} as never,exclusive:async run=>run(),assistantQueuedAllowed:async()=>allowed})
 expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(true)
 allowed=false;expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(false)
 unbind();expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(false)
})
it('rechecks consent even in legacy private rooms with no lifecycle record', async () => {
 const threads={} as ThreadStore
 const room={id:'room',value:{id:'room',members:[],defaultMemberId:'member'}}
 const run={value:{requestId:'request',threadId:'thread',turnId:'turn'}}
 const request={roomId:'room',value:{privateContinuation:{kind:'personal_assistant'},privateProtocol:'direct-v1'}}
 const store={get:vi.fn(async (kind:string)=>kind==='room'?room:kind==='room_run'?run:kind==='request'?request:null)}
 let allowed=true
 const unbind=bindPrivateTurnLifecycle(threads,{store:store as never,exclusive:async run=>run(),continuationAllowed:async()=>allowed})
 const thread={id:'thread',roomContext:{kind:'conversation',roomId:'room'}} as never,turn={id:'turn',clientRequestId:'private-assistant-continuation-test'} as never
 expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(true)
 allowed=false;expect(await privateQueuedTurnAllowed(threads,thread,turn)).toBe(false)
 unbind()
})
