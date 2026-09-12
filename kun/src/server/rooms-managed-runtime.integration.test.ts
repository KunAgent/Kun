import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceManager, type ServiceManagerHandle } from '../manager/service-manager.js'
import { startKunServe, type KunServeHandle } from './runtime-factory.js'
import type { Room } from '../contracts/rooms.js'
import type { RoomTask } from '../contracts/room-tasks.js'

const exec = promisify(execFile)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function modelServer() {
  let executionCalls = 0
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        stream?: boolean
        messages: Array<{ role: string; content?: unknown }>
      }
      const prompt = JSON.stringify(body.messages)
      let content = 'Completed.'
      let toolCalls: unknown[] | undefined
      if (prompt.includes('You coordinate a personal Kun room')) {
        content = JSON.stringify({ kind: 'execute', response: 'Development and review assigned.',
          participants: [], assignments: [{ key: 'smoke', memberId: 'developer', repositoryId: 'repo',
            title: 'Create smoke file', prompt: 'Create smoke.txt containing managed runtime.',
            dependsOn: [], reviewerMemberId: 'reviewer' }] })
      } else if (prompt.includes('Review this immutable delivered version')) {
        content = JSON.stringify({ verdict: 'passed', findings: [], limitations: ['No test command requested.'] })
      } else if (prompt.includes('Complete this authorized room task')) {
        executionCalls += 1
        if (!body.messages.some((message) => message.role === 'tool')) {
          content = ''
          toolCalls = [{ index: 0, id: 'smoke-write', type: 'function',
            function: { name: 'write', arguments: JSON.stringify({ path: 'smoke.txt', content: 'managed runtime\n' }) } }]
        } else content = 'Created smoke.txt; no test commands were run.'
      }
      const message = { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }
      const finish_reason = toolCalls ? 'tool_calls' : 'stop'
      if (body.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: ' + JSON.stringify({ id: 'smoke-response', choices: [{ index: 0, delta: message, finish_reason: null }] }) + '\n\n')
        response.write('data: ' + JSON.stringify({ id: 'smoke-response', choices: [{ index: 0, delta: {}, finish_reason }] }) + '\n\n')
        response.end('data: [DONE]\n\n')
      } else {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'smoke-response', choices: [{ index: 0, message, finish_reason }],
          usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }))
      }
    } catch (error) {
      response.writeHead(500)
      response.end(String(error))
    }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('model server unavailable')
  cleanup.push(() => closeServer(server))
  return { baseUrl: 'http://127.0.0.1:' + address.port, calls: () => executionCalls }
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
}

describe('Rooms full managed Runtime HTTP composition', () => {
  it('dispatches from durable Manager state and restores delivery after Runtime restart', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-rooms-managed-smoke-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const repo = join(root, 'repo with spaces')
    await exec('git', ['init', '-b', 'develop', repo])
    await exec('git', ['-C', repo, 'config', 'user.name', 'Room Test'])
    await exec('git', ['-C', repo, 'config', 'user.email', 'room@example.test'])
    await writeFile(join(repo, 'baseline.txt'), 'base\n')
    await exec('git', ['-C', repo, 'add', '.'])
    await exec('git', ['-C', repo, 'commit', '-m', 'baseline'])
    const model = await modelServer()
    let manager: ServiceManagerHandle | undefined = await startServiceManager({
      controlDir: join(root, 'control'), dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json'),
      managerToken: 'isolated-room-manager', instanceId: 'room-manager', startedAt: new Date().toISOString()
    })
    cleanup.push(async () => { await manager?.close(); manager = undefined })
    let runtime: KunServeHandle | undefined
    cleanup.push(async () => { await runtime?.close(); runtime = undefined })
    const start = async () => startKunServe({
      host: '127.0.0.1', port: 0, dataDir: join(root, 'data'),
      runtimeToken: 'isolated-room-runtime', apiKey: 'test-fixture',
      baseUrl: model.baseUrl, model: 'test-model', approvalPolicy: 'auto', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false, runtimeFlavor: 'development',
      discoveryDir: join(root, 'discovery'), serviceManager: { discovery: manager!.discovery }
    })
    runtime = await start()
    const api = async <T>(path: string, body?: unknown, method?: string): Promise<T> => {
      const response = await fetch('http://' + runtime!.host + ':' + runtime!.port + path, {
        method: method ?? (body === undefined ? 'GET' : 'POST'),
        headers: { authorization: 'Bearer isolated-room-runtime', 'content-type': 'application/json' },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        signal: AbortSignal.timeout(15000)
      })
      const payload = await response.json()
      expect(response.ok, JSON.stringify(payload)).toBe(true)
      return payload as T
    }
    const { room } = await api<{ room: Room }>('/v1/rooms', { clientRequestId: 'room', name: 'Managed smoke',
      repositories: [{ id: 'repo', displayPath: repo }] })
    const message = { clientRequestId: 'message', body: 'Create smoke.txt and have it reviewed.', executionIntent: 'execute' }
    const sent = await api('/v1/rooms/' + room.id + '/messages', message)
    expect(await api('/v1/rooms/' + room.id + '/messages', message)).toEqual(sent)
    let task!: RoomTask
    await vi.waitFor(async () => {
      const response = await api<{ tasks: RoomTask[] }>('/v1/rooms/' + room.id + '/tasks')
      expect(response.tasks).toHaveLength(1)
      task = response.tasks[0]
      expect(task.status, task.latestProgress).toBe('awaiting_acceptance')
    }, { timeout: 40000, interval: 300 })
    const calls = model.calls()
    expect(calls).toBeGreaterThanOrEqual(2)
    await expect(readFile(join(repo, 'smoke.txt'))).rejects.toThrow()
    await runtime.close()
    runtime = await start()
    const restored = await api<{ task: RoomTask }>('/v1/rooms/' + room.id + '/tasks/' + task.id)
    expect(restored.task.latestDeliveryId).toBe(task.latestDeliveryId)
    expect(restored.task.status).toBe('awaiting_acceptance')
    await vi.waitFor(async () => {
      // Apply crosses the fresh coordinator lease, so this also checks lease reacquisition.
      await api('/v1/rooms/' + room.id + '/tasks/' + task.id + '/apply',
        { clientRequestId: 'apply', expectedRevision: restored.task.revision })
    }, { timeout: 10000, interval: 200 })
    expect(await readFile(join(repo, 'smoke.txt'), 'utf8')).toBe('managed runtime\n')
    expect(model.calls()).toBe(calls)
  }, 60000)
})
