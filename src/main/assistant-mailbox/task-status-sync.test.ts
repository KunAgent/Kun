import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PreparedMessage } from '@kun/assistant-agent'
import { AssistantTaskStore } from './task-store'
import { syncTaskStatus } from './task-status-sync'
const dirs:string[]=[]
afterEach(async()=>{await Promise.all(dirs.splice(0).map(path=>rm(path,{recursive:true,force:true})))})
it('retains failed status updates and never publishes titles, bodies, or source context',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'task-status-'));dirs.push(dir)
 const path=join(dir,'tasks.json'),tasks=new AssistantTaskStore(path),assistantId=randomUUID(),taskId=randomUUID(),at=new Date().toISOString()
 const prepared={assistantId,enrollmentId:randomUUID(),envelope:'sealed',message:{id:taskId,kind:'task',from:'kun',title:'private title',body:'private body',createdAt:at}} as PreparedMessage
 await tasks.queueTask(prepared,'Helper')
 let offline=true,body='',owner=true
 const fetcher=(async(_url,init)=>{body=String(init?.body);if(offline)return new Response('',{status:503});const rows=JSON.parse(body).tasks;return Response.json({ok:true,count:rows.length,revisions:rows.map((r:{taskId:string;revision:number})=>({taskId:r.taskId,revision:r.revision,matches:true}))})}) as typeof fetch
 const deps={origin:'https://example.test',fetch:fetcher,identity:{id:randomUUID(),credential:'a'.repeat(64)},accessToken:async()=> 'token',stillCurrent:async()=>owner,tasks}
 await expect(syncTaskStatus(deps,[assistantId])).rejects.toThrow('TASK_STATUS_HTTP_503')
 expect(await tasks.statusChanges(assistantId)).toHaveLength(1)
 offline=false;await syncTaskStatus(deps,[assistantId]);expect(body).not.toContain('private')
 expect(await tasks.statusChanges(assistantId)).toHaveLength(0)
 expect(await readFile(path,'utf8')).toContain('private body')
 await tasks.archiveTask(taskId,true);owner=false
 await expect(syncTaskStatus(deps,[assistantId])).rejects.toThrow('ACCOUNT_CHANGED')
 expect(await tasks.statusChanges(assistantId)).toHaveLength(1)
})

it('rebases a restored local projection without accepting an older server state',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'task-status-rebase-'));dirs.push(dir)
 const tasks=new AssistantTaskStore(join(dir,'tasks.json')),assistantId=randomUUID(),taskId=randomUUID(),at=new Date().toISOString()
 await tasks.queueTask({assistantId,enrollmentId:randomUUID(),envelope:'sealed',message:{id:taskId,kind:'task',from:'kun',body:'task',createdAt:at}} as PreparedMessage,'Helper')
 let conflict=true, floor=0
 const fetcher=(async(_url,init)=>{const rows=JSON.parse(String(init?.body)).tasks; const row=rows[0]; if(conflict){floor=row.revision+1000;return Response.json({ok:true,count:1,revisions:[{taskId,revision:floor,matches:false}]})}return Response.json({ok:true,count:1,revisions:[{taskId,revision:row.revision,matches:true}]})}) as typeof fetch
 const deps={origin:'https://example.test',fetch:fetcher,identity:{id:randomUUID(),credential:'a'.repeat(64)},accessToken:async()=> 'token',stillCurrent:async()=>true,tasks}
 await syncTaskStatus(deps,[assistantId]);expect((await tasks.statusChanges(assistantId))[0].revision).toBeGreaterThan(floor)
 conflict=false;await syncTaskStatus(deps,[assistantId]);expect(await tasks.statusChanges(assistantId)).toHaveLength(0)
})
