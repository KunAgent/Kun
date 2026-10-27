import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { expect, it } from 'vitest'
import type { PreparedMessage } from '@kun/assistant-agent'
import { assistantContinuationAuthority } from '../../../kun/src/rooms/assistant-continuation-authority'
import { AssistantContinuations } from './continuations'
import { AssistantTaskStore } from './task-store'
import { AssistantToolEndpoint, assistantToolEndpointPaths } from './tool-endpoint'

it.skipIf(process.platform === 'win32')('checks current consent and result identity over the real private local endpoint', async () => {
 const root=await mkdtemp(join(tmpdir(),'kun-continuation-bridge-')), paths=assistantToolEndpointPaths(root), owner=randomUUID(), taskId=randomUUID(), resultId=randomUUID()
 const source={threadId:'thread',turnId:'turn',callId:'call'}, goalCreatedAt=new Date().toISOString(), sourceFingerprint='a'.repeat(64)
 const tasks=new AssistantTaskStore(join(root,'tasks.json')), session={owner,tasks}
 const prepared={assistantId:randomUUID(),enrollmentId:randomUUID(),envelope:'sealed',message:{id:taskId,kind:'task',from:'kun',body:'work',createdAt:goalCreatedAt}} as PreparedMessage
 await tasks.queueTask(prepared,'Helper',undefined,source)
 await tasks.applyIncoming({id:prepared.assistantId,name:'Helper'},{id:resultId,kind:'reply',createdAt:goalCreatedAt,body:'actual result',inReplyTo:taskId,status:'done'})
 let active=true
 const bridge={verify:async()=>({goalCreatedAt,sourceFingerprint}),enqueue:async()=> 'queued' as const}
 const coordinator=new AssistantContinuations({current:async()=>active?session:null,enabled:()=>true,membership:async()=>{},bridge})
 const endpoint=new AssistantToolEndpoint(paths,new Set(['/tasks/continuation-authority']),async (_route,body)=>coordinator.authority(body as never))
 await endpoint.start()
 const options={capabilities:{mcp:{servers:{kun_assistants:{enabled:true,transport:'stdio',args:['--kun-assistant-mcp-server','--socket',paths.socketPath,'--secret-file',paths.secretPath]}}}}} as never
 const input={threadId:source.threadId,sourceTurnId:source.turnId,sourceCallId:source.callId,assistantTaskId:taskId,assistantOwnerId:owner,assistantResultId:resultId,goalCreatedAt,sourceFingerprint,kind:'personal_assistant' as const,key:'key',prompt:''}
 try {
  expect(await assistantContinuationAuthority(options,input)).toMatchObject({authorized:false})
  await coordinator.set(session,taskId,true)
  expect(await assistantContinuationAuthority(options,input)).toEqual({authorized:true,result:{id:resultId,body:'actual result'}})
  expect(await assistantContinuationAuthority(options,{...input,assistantResultId:randomUUID()})).toMatchObject({authorized:false})
  active=false;expect(await assistantContinuationAuthority(options,input)).toMatchObject({authorized:false})
 }finally{await endpoint.stop();await rm(root,{recursive:true,force:true})}
})
