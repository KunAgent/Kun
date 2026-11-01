import { afterEach, expect, it, vi } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { randomUUID } from 'node:crypto'
import type { PreparedMessage } from '@kun/assistant-agent'
import { AssistantTaskStore } from './task-store'
import { AssistantContinuations } from './continuations'
const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })
async function fixture() {
  const dir=await mkdtemp(join(tmpdir(),'kun-continuations-'));dirs.push(dir)
  const owner=randomUUID(), assistantId=randomUUID(), taskId=randomUUID(), resultId=randomUUID(), goalCreatedAt=new Date().toISOString()
  const sourceFingerprint='a'.repeat(64), source={threadId:'thread-1',turnId:'turn-1',callId:'call-1'}, store=new AssistantTaskStore(join(dir,'tasks.json'))
  const message={assistantId,enrollmentId:randomUUID(),envelope:'sealed',message:{id:taskId,kind:'task',from:'kun',body:'Task',createdAt:goalCreatedAt}} as PreparedMessage
  await store.queueTask(message,'Helper',undefined,source)
  const session={owner,tasks:store};let active: typeof session | null=session, feature=true, membership=true
  const bridge={verify:vi.fn(async()=>({goalCreatedAt,sourceFingerprint})),enqueue:vi.fn(async()=> 'queued' as const)}
  const coordinator=new AssistantContinuations({current:async()=>active,enabled:()=>feature,membership:async()=>{if(!membership)throw Object.assign(Error('vip'),{code:'vip_personal_assistant_required'})},bridge})
  const done=()=>store.applyIncoming({id:assistantId,name:'Helper'},{id:resultId,kind:'reply',createdAt:goalCreatedAt,body:'result',inReplyTo:taskId,status:'done'})
  return {owner,taskId,resultId,goalCreatedAt,sourceFingerprint,source,store,session,bridge,coordinator,done,
    setActive:(value:typeof session | null)=>{active=value},setFeature:(value:boolean)=>{feature=value},setMembership:(value:boolean)=>{membership=value}}
}
it('only an explicit, verified enable schedules a completed result once',async()=>{
 const f=await fixture();await f.done();await f.coordinator.flush(f.session);expect(f.bridge.enqueue).not.toHaveBeenCalled()
 await f.coordinator.set(f.session,f.taskId,true);expect(f.bridge.verify).toHaveBeenCalledOnce()
 await f.coordinator.flush(f.session);await f.coordinator.flush(f.session);expect(f.bridge.enqueue).toHaveBeenCalledOnce()
 const input={taskId:f.taskId,owner:f.owner,source:f.source,resultId:f.resultId,goalCreatedAt:f.goalCreatedAt,sourceFingerprint:f.sourceFingerprint}
 expect(await f.coordinator.authority(input)).toEqual({authorized:true,result:{id:f.resultId,body:'result'}})
 await f.coordinator.set(f.session,f.taskId,false);expect(await f.coordinator.authority(input)).toEqual({authorized:false})
})
it('account, membership, feature and original source fences fail closed',async()=>{
 const f=await fixture();await f.done();await f.coordinator.set(f.session,f.taskId,true)
 const input={taskId:f.taskId,owner:f.owner,source:f.source,resultId:f.resultId,goalCreatedAt:f.goalCreatedAt,sourceFingerprint:f.sourceFingerprint}
 expect(await f.coordinator.authority({...input,source:{...input.source,threadId:'other'}})).toEqual({authorized:false})
 f.setMembership(false);expect(await f.coordinator.authority(input)).toEqual({authorized:false});f.setMembership(true)
 f.setFeature(false);expect(await f.coordinator.authority(input)).toEqual({authorized:false});f.setFeature(true)
 f.setActive(null);expect(await f.coordinator.authority(input)).toEqual({authorized:false})
})
