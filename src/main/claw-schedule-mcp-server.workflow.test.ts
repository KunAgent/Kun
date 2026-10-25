import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import { afterEach, describe, expect, it } from 'vitest'
import { createClawScheduleMcpServerFromArgv } from './claw-schedule-mcp-server'

type BridgeStub = { port: number; close: () => Promise<void> }

const cleanups: (() => Promise<void>)[] = []
afterEach(async () => {
  await Promise.all(cleanups.splice(0).map((cleanup) => cleanup()))
})

async function freePort(): Promise<number> {
  const server = createServer()
  server.listen(0, '127.0.0.1')
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  const port = (server.address() as AddressInfo).port
  await new Promise<void>((resolve) => server.close(() => resolve()))
  return port
}

function startBridge(
  handler: (request: IncomingMessage, response: ServerResponse, path: string) => void
): Promise<BridgeStub> {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      handler(request, response, new URL(request.url ?? '/', 'http://127.0.0.1').pathname)
    })
    server.listen(0, '127.0.0.1', () => {
      const port = (server.address() as AddressInfo).port
      cleanups.push(
        () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      )
      resolve({
        port,
        close: () =>
          new Promise<void>((done) => {
            server.closeAllConnections()
            server.close(() => done())
          })
      })
    })
  })
}

function respondJson(response: ServerResponse, body: unknown, status = 200): void {
  response.writeHead(status, { 'content-type': 'application/json' })
  response.end(JSON.stringify(body))
}

async function connectClient(
  argv: string[],
  budgets?: Parameters<typeof createClawScheduleMcpServerFromArgv>[1]
): Promise<{ client: Client; toolNames: string[] }> {
  const handle = createClawScheduleMcpServerFromArgv(argv, budgets)
  if (!handle) throw new Error('server handle not created')
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair()
  await handle.server.connect(serverTransport)
  const client = new Client({ name: 'gui-schedule-test', version: '1.0.0' })
  await client.connect(clientTransport)
  cleanups.push(async () => {
    handle.catalogRefresher?.stop()
    await client.close()
  })
  const listed = await client.listTools()
  return { client, toolNames: listed.tools.map((tool) => tool.name) }
}

function baseArgs(schedulePort: number, workflowPort?: number): string[] {
  const args = ['--gui-schedule-mcp-server', '--base-url', `http://127.0.0.1:${schedulePort}`]
  if (workflowPort !== undefined) {
    args.push('--workflow-base-url', `http://127.0.0.1:${workflowPort}`)
  }
  return args
}

describe('gui_schedule MCP server', () => {
  it('exposes only the schedule tools when Workflow is disabled', async () => {
    const schedulePort = await freePort()
    const { toolNames } = await connectClient(baseArgs(schedulePort))

    expect(toolNames).toContain('gui_schedule_list')
    expect(toolNames).not.toContain('list_workflows')
    expect(toolNames).not.toContain('run_workflow')
  })

  it('initializes and answers schedule tools while the workflow bridge hangs', async () => {
    const schedule = await startBridge((_request, response) =>
      respondJson(response, { ok: true, tasks: [{ id: 'task-1', title: 'daily' }] })
    )
    const hanging = await startBridge(() => {
      /* accept the request and never answer */
    })

    const { client } = await connectClient(baseArgs(schedule.port, hanging.port))
    const result = await client.callTool({ name: 'gui_schedule_list', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(JSON.stringify(result.content)).toContain('Found 1 scheduled task(s).')
  })

  it('lists an empty catalog successfully instead of failing the transport', async () => {
    const schedule = await startBridge((_request, response) => respondJson(response, { ok: true, tasks: [] }))
    const workflow = await startBridge((_request, response) => respondJson(response, { ok: true, workflows: [] }))

    const { client } = await connectClient(baseArgs(schedule.port, workflow.port))
    const result = await client.callTool({ name: 'list_workflows', arguments: {} })

    expect(result.isError).toBeFalsy()
    expect(JSON.stringify(result.content)).toContain('No workflows are marked callable by the agent.')
  })

  it('names the unreachable port when the workflow bridge is down', async () => {
    const schedule = await startBridge((_request, response) => respondJson(response, { ok: true, tasks: [] }))
    const workflowPort = await freePort()

    const { client } = await connectClient(baseArgs(schedule.port, workflowPort))
    const result = await client.callTool({ name: 'list_workflows', arguments: {} })

    expect(result.isError).toBe(true)
    const text = JSON.stringify(result.content)
    expect(text).toContain(`http://127.0.0.1:${workflowPort}/workflow/internal/list`)
    expect(text).toMatch(/ECONNREFUSED|ECONNRESET/)
  })

  it('reports an unknown outcome when a long run outlives the wait budget', async () => {
    const schedule = await startBridge((_request, response) => respondJson(response, { ok: true, tasks: [] }))
    const workflow = await startBridge((_request, response) => {
      // Never answer: the run is still going while the tool gives up waiting.
      void response
    })

    const { client } = await connectClient(baseArgs(schedule.port, workflow.port), { workflowWaitMs: 300 })
    const startedAt = Date.now()
    const result = await client.callTool(
      { name: 'run_workflow', arguments: { workflow: 'slow' } },
      undefined,
      { timeout: 10_000 }
    )

    expect(Date.now() - startedAt).toBeLessThan(5_000)
    expect(result.isError).toBe(true)
    expect(JSON.stringify(result.content)).toMatch(/did not report back within 0 seconds/)
    expect(JSON.stringify(result.content)).toMatch(/result is unknown, and it was not started again/)
  }, 20_000)
})
