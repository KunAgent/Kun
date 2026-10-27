import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it } from 'vitest'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { createAssistantMcpServer } from './mcp-server'
import { AssistantToolEndpoint, assistantToolEndpointPaths } from './tool-endpoint'

it.skipIf(process.platform === 'win32')('passes runtime provenance outside model arguments to the desktop endpoint', async () => {
 const root=await mkdtemp(join(tmpdir(),'kun-mcp-source-')), paths=assistantToolEndpointPaths(root), calls: Record<string, unknown>[]=[]
 const endpoint=new AssistantToolEndpoint(paths,new Set(['/tasks/assign']),async (_route,body)=>{calls.push(body);return {task:{taskId:'test'}}})
 await endpoint.start()
 const server=createAssistantMcpServer(paths), client=new Client({name:'test',version:'1'})
 const [clientTransport,serverTransport]=InMemoryTransport.createLinkedPair()
 try {
  await Promise.all([server.connect(serverTransport),client.connect(clientTransport)])
  await client.callTool({name:'assign_assistant_task',arguments:{assistant:'helper',instructions:'do work'},
    _meta:{kunSource:{threadId:'thread',turnId:'turn',callId:'call'}}})
  expect(calls).toHaveLength(1)
  expect(calls[0]).toMatchObject({__kunSource:{threadId:'thread',turnId:'turn',callId:'call'}})
  expect(calls[0]).not.toHaveProperty('autoContinue')
 }finally{await client.close();await server.close();await endpoint.stop();await rm(root,{recursive:true,force:true})}
})
