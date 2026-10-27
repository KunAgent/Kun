import { afterEach, expect, it } from 'vitest'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { PreparedMessage } from '@kun/assistant-agent'
import { AssistantTaskStore } from './task-store'
import { validTaskQuery } from './task-query'
const dirs: string[] = []
afterEach(async () => { while (dirs.length) await rm(dirs.pop()!, { recursive: true, force: true }) })
async function location() { const dir = await mkdtemp(join(tmpdir(), 'kun-task-center-')); dirs.push(dir); return join(dir, 'tasks.json') }
function prepared(assistantId: string, body: string): PreparedMessage {
  const id = randomUUID(), at = new Date().toISOString()
  return { assistantId, enrollmentId: randomUUID(), envelope: `sealed-${id}`, message: { id, kind: 'task', from: 'kun', title: '', body, createdAt: at } } as PreparedMessage
}
it('migrates v1 on mutation, filters and pages all retained tasks without discarding records', async () => {
  const path=await location(), assistantId=randomUUID(), at=new Date().toISOString()
  const tasks=Array.from({length:65}, (_,i)=>({ id:randomUUID(), assistantId, assistantName:'A', title:`Task ${i}`, body:i%2?'searchable':'other', createdAt:at, updatedAt:at, status:'working', updates:[] }))
  await writeFile(path,JSON.stringify({version:1,tasks,notes:[],seen:[]}))
  const store=new AssistantTaskStore(path), first=await store.listTasks(validTaskQuery({assistantId,query:'searchable',limit:10}))
  expect(first.tasks).toHaveLength(10);expect(first.hasMore).toBe(true)
  const second=await store.listTasks(validTaskQuery({assistantId,query:'searchable',limit:10,cursor:first.nextCursor}))
  expect(second.tasks.some(task=>first.tasks.some(old=>old.id===task.id))).toBe(false)
  await store.archiveTask(first.tasks[0].id,true)
  expect((await store.listTasks(validTaskQuery({assistantId,archived:true}))).tasks.map(task=>task.id)).toContain(first.tasks[0].id)
  const migrated=JSON.parse(await readFile(path,'utf8'));expect(migrated.version).toBe(2);expect(migrated.tasks).toHaveLength(65)
  expect(()=>validTaskQuery({limit:500})).toThrow('INVALID_TASK_QUERY')
  expect(()=>validTaskQuery({userId:'other'})).toThrow('INVALID_TASK_QUERY')
})
it('retains rejected envelopes durably and explicit retry reuses the exact id and ciphertext', async () => {
  const path=await location(), assistantId=randomUUID(), message=prepared(assistantId,'Do work')
  const store=new AssistantTaskStore(path)
  await store.queueTask(message,'A');await store.finishDelivery(message.message.id,'conflict')
  expect((await store.task(message.message.id))?.status).toBe('failed')
  const restored=new AssistantTaskStore(path), details=await restored.taskDetails(message.message.id)
  expect(details?.retryable).toEqual([{messageId:message.message.id,kind:'task'}])
  await restored.retryDelivery(message.message.id)
  expect((await restored.pendingTasks())[0]).toEqual(message)
  expect((await restored.task(message.message.id))?.status).toBe('queued')
  await expect(restored.retryDelivery(message.message.id)).rejects.toThrow('RETRY_ENVELOPE_UNAVAILABLE')
})
