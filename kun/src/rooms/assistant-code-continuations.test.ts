import { expect, it, vi } from 'vitest'
import type { RoomRuntimeDeps } from './room-runtime-types.js'
import { assistantSourceEvidence } from './assistant-continuation-source.js'
import { AssistantCodeContinuations } from './assistant-code-continuations.js'

it('retains a busy Code result and admits it once with the source authority', async () => {
 const at='2026-10-27T00:00:00.000Z', taskId='12345678-1234-1234-1234-123456789012', resultId='12345678-1234-1234-1234-123456789013'
 const source={id:'turn-1',threadId:'thread-1',clientRequestId:'original',status:'running',approvalPolicy:'on-request',sandboxMode:'workspace-write',clientSurface:'gui'}
 const thread={id:'thread-1',status:'running',workspace:'/work',turns:[source],approvalPolicy:'on-request',sandboxMode:'workspace-write',goal:{status:'active',tokenBudget:10000,tokensUsed:10,createdAt:at,timeUsedSeconds:0}}
 const item={kind:'tool_result',callId:'call-1',isError:false,output:{serverId:'kun_assistants',toolName:'assign_assistant_task',result:{structuredContent:{task:{taskId}}}}}
 let row: any, seq=0, allowed=true
 const store={
  get:vi.fn(async (_kind:string,id:string)=>row?.id===id?row:null),
  list:vi.fn(async (_kind:string,opts:any)=>['pending','waiting'].includes(row?.value.status) && row.seq>opts.afterSeq?[row]:[]),
  commit:vi.fn(async (input:any)=>{const put=input.puts[0];row={id:put.id,seq:row?.seq??++seq,revision:(row?.revision??-1)+1,value:put.value};return {duplicate:false,result:null,events:[]}})
 }
 const enqueueTurn=vi.fn(async ({request}:any)=>{
  thread.turns.push({id:'continued',threadId:thread.id,clientRequestId:request.clientRequestId,status:'queued',approvalPolicy:request.approvalPolicy,sandboxMode:request.sandboxMode,clientSurface:request.clientSurface,messageSource:'background_subagent'} as any)
  return {turnId:'continued',status:'queued',request}
 })
 const cancelQueuedTurn=vi.fn(async()=>{})
 const deps={store,threads:{getMetadata:async()=>thread},sessions:{loadItemPage:async()=>({items:[item],hasMore:false,itemBytes:1})},
  turns:{enqueueTurn,cancelQueuedTurn},runTurn:async()=>{},assistantContinuationAuthority:async()=>({authorized:allowed,result:{id:resultId,body:'verified output'}})} as unknown as RoomRuntimeDeps
 const sourceInput={threadId:'thread-1',sourceTurnId:'turn-1',sourceCallId:'call-1',assistantTaskId:taskId,assistantOwnerId:'12345678-1234-1234-1234-123456789014',assistantResultId:resultId,
  goalCreatedAt:at,kind:'personal_assistant' as const,key:'key',prompt:'untrusted result'}
 const evidence=await assistantSourceEvidence(deps,sourceInput);expect(evidence).toBeTruthy()
 const input={...sourceInput,sourceFingerprint:evidence!.fingerprint}, coordinator=new AssistantCodeContinuations(deps)
 expect(await coordinator.enqueue(input,'verified output')).toBe('queued')
 expect(await coordinator.enqueue(input,'verified output')).toBe('queued')
 await coordinator.tick();expect(enqueueTurn).not.toHaveBeenCalled()
 source.status='completed';thread.status='idle';await coordinator.tick();await coordinator.tick()
 expect(enqueueTurn).toHaveBeenCalledOnce();expect(row.value.status).toBe('waiting')
 expect(await coordinator.queuedTurnAllowed(thread.id,row.id)).toBe(true)
 thread.approvalPolicy='never';expect(await coordinator.queuedTurnAllowed(thread.id,row.id)).toBe(false)
 thread.approvalPolicy='on-request';thread.goal.tokenBudget=20000
 expect(await coordinator.queuedTurnAllowed(thread.id,row.id)).toBe(false)
 thread.goal.tokenBudget=10000
 expect(enqueueTurn.mock.calls[0][0].request).toMatchObject({clientSurface:'gui',approvalPolicy:'on-request',sandboxMode:'workspace-write'})
 allowed=false;expect(await coordinator.queuedTurnAllowed(thread.id,row.id)).toBe(false)
 await coordinator.tick();await coordinator.tick();expect(cancelQueuedTurn).toHaveBeenCalledOnce();expect(row.value.status).toBe('revoked')
 expect(await coordinator.enqueue(input,'verified output')).toBe('ignored')
})
