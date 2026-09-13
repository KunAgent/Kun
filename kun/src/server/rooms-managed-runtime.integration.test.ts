import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceManager, type ServiceManagerHandle } from '../manager/service-manager.js'
import { startKunServe, type KunServeHandle } from './runtime-factory.js'
import type { Room, RoomMessage } from '../contracts/rooms.js'
import type { RoomTask } from '../contracts/room-tasks.js'
import type { RoomPeerTopicSummary } from '../rooms/room-peer-types.js'
import type { RoomRunRecord } from '../contracts/room-runs.js'
import type { RoomRunDetail, RoomRunItemsPage } from '../contracts/room-run-query.js'
import { heartbeatRuntimeWithManager } from '../manager/manager-client.js'

const exec = promisify(execFile)
const PEER_REPLY = 'SCOPED_PEER_REPLY_EXACT_BODY: preserve the room message publication boundary.'
const PEER_END_PROSE = 'TERMINAL_PROSE_MUST_STAY_PRIVATE'
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

async function modelServer() {
  let executionCalls = 0
  let originalRuleId = ''
  let originalRuleRead = false
  let peerSubmissions = 0, triageCalls = 0, peerAccepted = false, peerToolAdvertised = false
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as {
        stream?: boolean
        messages: Array<{ role: string; content?: unknown }>
        tools?: Array<{ function?: { name?: string } }>
      }
      const prompt = JSON.stringify(body.messages)
      let content = 'Completed.'
      let toolCalls: unknown[] | undefined
      if (prompt.includes('Decide whether this member has a concrete new contribution')) {
        triageCalls++
        content = JSON.stringify({ action: 'skip', reason: 'No additional evidence to contribute.' })
      } else if (prompt.includes('Participate as this Kun room member.')) {
        peerToolAdvertised ||= Boolean(body.tools?.some((tool) => tool.function?.name === 'send_room_message'))
        let latestUser = 0
        for (let index = body.messages.length - 1; index >= 0; index -= 1) {
          if (body.messages[index].role === 'user') { latestUser = index; break }
        }
        const toolResult = body.messages.slice(latestUser).find((message) => message.role === 'tool')
        if (!toolResult) {
          peerSubmissions++
          content = ''
          toolCalls = [{ index: 0, id: `scoped-peer-message-${peerSubmissions}`, type: 'function', function: {
            name: 'send_room_message', arguments: JSON.stringify({ body: PEER_REPLY })
          } }]
        } else {
          const output = JSON.parse(String(toolResult.content))
          peerAccepted ||= output.accepted === true && output.staged === true && output.value?.body === PEER_REPLY
          content = PEER_END_PROSE
        }
      } else if (prompt.includes('READ_ORIGINAL_ROOM_RULE')) {
        const texts = body.messages.map((message) => typeof message.content === 'string' ? message.content : JSON.stringify(message.content))
        const toolResult = body.messages.find((message) => message.role === 'tool')
        if (!toolResult) {
          const bundleId = texts.join(' ').match(/rules-[a-f0-9]{64}/g)?.at(-1)
          content = ''
          toolCalls = [{ index: 0, id: 'original-room-rule', type: 'function', function: { name: 'read_room_rules',
            arguments: JSON.stringify({ bundleId, ruleId: originalRuleId, version: 1 }) } }]
        } else {
          const output = JSON.parse(String(toolResult.content))
          originalRuleRead = output.rule?.body === 'Keep original numeric limit 12.'
          content = originalRuleRead ? 'Original numeric limit is 12.' : 'Original rule tool failed.'
        }
      } else if (prompt.includes('You coordinate a personal Kun room')) {
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
        response.write('data: ' + JSON.stringify({ id: 'smoke-response', choices: [],
          usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }) + '\n\n')
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
  return { baseUrl: 'http://127.0.0.1:' + address.port, calls: () => executionCalls,
    setRule: (id: string) => { originalRuleId = id }, ruleRead: () => originalRuleRead,
    peer: () => ({ submissions: peerSubmissions, triageCalls, accepted: peerAccepted, advertised: peerToolAdvertised }) }
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
    let heartbeat: ReturnType<typeof setInterval> | undefined
    cleanup.push(async () => { if (heartbeat) clearInterval(heartbeat) })
    const start = async () => {
      if (heartbeat) clearInterval(heartbeat)
      const handle = await startKunServe({
      host: '127.0.0.1', port: 0, dataDir: join(root, 'data'),
      runtimeToken: 'isolated-room-runtime', apiKey: 'test-fixture',
      baseUrl: model.baseUrl, model: 'test-model', approvalPolicy: 'auto', sandboxMode: 'workspace-write',
      tokenEconomyMode: false, insecure: false, runtimeFlavor: 'development',
      discoveryDir: join(root, 'discovery'), serviceManager: { discovery: manager!.discovery }
    })
      heartbeat = setInterval(() => { void heartbeatRuntimeWithManager({ manager: { discovery: manager!.discovery },
        flavor: 'development', instanceId: handle.instanceId }).catch(() => undefined) }, 5000)
      heartbeat.unref()
      return handle
    }
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
    const { room } = await api<{ room: Room }>('/v1/rooms', { clientRequestId: 'room', name: 'Managed smoke', collaborationMode: 'autonomous',
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
    await runtime.runtime.rooms!.service.append(room.id, 'original-rule-note', 'Keep original numeric limit 12.')
    const pinned = await api<{ rule: { id: string } }>('/v1/rooms/' + room.id + '/rules', { clientRequestId: 'pin-original', messageId: 'original-rule-note' })
    model.setRule(pinned.rule.id)
    await api('/v1/rooms/' + room.id + '/messages', { clientRequestId: 'read-original', body: 'READ_ORIGINAL_ROOM_RULE', taskId: task.id,
      executionIntent: 'discussion', mentionMemberIds: ['developer'] })
    await vi.waitFor(() => expect(model.ruleRead()).toBe(true), { timeout: 10000, interval: 200 })
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

  it('publishes the accepted scoped peer tool result through the real fenced Manager composition', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-rooms-managed-peer-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const model = await modelServer()
    const manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'),
      settingsPath: join(root, 'settings.json'), managerToken: 'peer-manager-token', instanceId: 'peer-manager',
      startedAt: new Date().toISOString() })
    cleanup.push(() => manager.close())
    const runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir: join(root, 'data'),
      runtimeToken: 'peer-runtime-token', apiKey: 'test-fixture', baseUrl: model.baseUrl, model: 'test-model',
      roles: { smallModel: 'test-small' }, approvalPolicy: 'auto', sandboxMode: 'read-only', tokenEconomyMode: false,
      insecure: false, runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'),
      serviceManager: { discovery: manager.discovery } })
    cleanup.push(() => runtime.close())
    const heartbeat = setInterval(() => { void heartbeatRuntimeWithManager({ manager: { discovery: manager.discovery },
      flavor: 'development', instanceId: runtime.instanceId }).catch(() => undefined) }, 5000)
    heartbeat.unref()
    cleanup.push(async () => clearInterval(heartbeat))
    const api = async <T>(path: string, body?: unknown): Promise<T> => {
      const response = await fetch(`http://${runtime.host}:${runtime.port}${path}`, {
        method: body ? 'POST' : 'GET', headers: { authorization: 'Bearer peer-runtime-token', 'content-type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000) })
      const value = await response.json()
      expect(response.ok, JSON.stringify(value)).toBe(true)
      return value as T
    }
    const { room } = await api<{ room: Room }>('/v1/rooms', { clientRequestId: 'peer-room', name: 'Native peer boundary' })
    expect(room.collaborationMode).toBe('peer')
    const sent = await api<{ requestId: string }>(`/v1/rooms/${room.id}/messages`, {
      clientRequestId: 'peer-discussion', body: 'Discuss the publication boundary only.', executionIntent: 'discussion' })
    await vi.waitFor(async () => {
      const { topics } = await api<{ topics: RoomPeerTopicSummary[] }>(`/v1/rooms/${room.id}/topics`)
      expect(topics.find((topic) => topic.rootRequestId === sent.requestId)?.status).toBe('idle')
    }, { timeout: 40000, interval: 250 })
    const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${room.id}/messages`)
    const replies = messages.filter((message) => message.authorKind === 'member')
    expect(replies.map((message) => message.body)).toEqual([PEER_REPLY])
    expect(replies[0]).toMatchObject({ rootRequestId: sent.requestId, status: 'final', authorMemberId: room.defaultMemberId })
    expect(messages.some((message) => message.body.includes(PEER_END_PROSE))).toBe(false)
    expect(model.peer()).toMatchObject({ submissions: 1, accepted: true, advertised: true })
    expect(model.peer().triageCalls).toBeGreaterThanOrEqual(2)
    expect((await api<{ tasks: RoomTask[] }>(`/v1/rooms/${room.id}/tasks`)).tasks).toEqual([])
    expect(model.calls()).toBe(0)

    const runBase = `/v1/rooms/${room.id}/runs`
    const firstOrigin = replies[0].originRunId
    expect(firstOrigin).toBeTruthy()
    expect(await api(`/v1/rooms/${room.id}/messages/${replies[0].id}/run`)).toEqual({ runId: firstOrigin })
    const firstRun = await api<RoomRunDetail>(`${runBase}/${firstOrigin}`)
    expect(firstRun.run).toMatchObject({ phase: 'discussion', outcome: 'published',
      memberId: room.defaultMemberId, publishedMessageId: replies[0].id })
    expect(firstRun.availability.status).toBe('available')
    const firstItems = await api<RoomRunItemsPage>(`${runBase}/${firstOrigin}/items?limit=2`)
    expect(firstItems.items.length).toBeGreaterThan(0)
    expect(firstItems.items.every((item) => item.turnId === firstRun.run.turnId)).toBe(true)

    await api(`/v1/rooms/${room.id}/messages`, { clientRequestId: 'peer-follow-up',
      rootRequestId: sent.requestId, body: 'Continue this topic with one more concrete reply.',
      executionIntent: 'discussion', mentionMemberIds: [room.defaultMemberId] })
    let continuedReplies: RoomMessage[] = []
    await vi.waitFor(async () => {
      const history = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${room.id}/messages`)
      continuedReplies = history.messages.filter((message) => message.authorKind === 'member')
      expect(continuedReplies).toHaveLength(2)
      const { topics } = await api<{ topics: RoomPeerTopicSummary[] }>(`/v1/rooms/${room.id}/topics`)
      expect(topics.find((topic) => topic.rootRequestId === sent.requestId)?.status).toBe('idle')
    }, { timeout: 20000, interval: 250 })
    const followup = continuedReplies.find((message) => message.id !== replies[0].id)!
    expect(followup.originRunId).toBeTruthy()
    expect(followup.originRunId).not.toBe(firstOrigin)
    const secondRun = await api<RoomRunDetail>(`${runBase}/${followup.originRunId}`)
    // Explicit continuation starts a fresh generation/session for this member.
    expect(secondRun.run.threadId).toBeTruthy()
    expect(secondRun.run.turnId).not.toBe(firstRun.run.turnId)
    expect(secondRun.run.memberId).toBe(firstRun.run.memberId)
    const afterAdmissions = model.peer()
    const listing = await api<{ runs: RoomRunRecord[] }>(`${runBase}?root_request_id=${sent.requestId}&limit=50`)
    const skipped = listing.runs.filter((run) => run.phase === 'triage' && run.outcome === 'skipped')
    expect(skipped.length).toBeGreaterThan(0)
    expect(skipped.every((run) => run.status === 'completed' && !run.turnId)).toBe(true)
    const triageDetail = await api<RoomRunDetail>(`${runBase}/${skipped[0].id}`)
    expect(triageDetail.availability.status).toBe('no_session')
    expect((await api<RoomRunItemsPage>(`${runBase}/${skipped[0].id}/items`)).items).toEqual([])
    for (const run of [firstRun.run, secondRun.run]) {
      const page = await api<RoomRunItemsPage>(`${runBase}/${run.id}/items?limit=1`)
      expect(page.items).toHaveLength(1)
      expect(page.items[0].turnId).toBe(run.turnId)
      expect(page.items[0].threadId).toBe(run.threadId)
      const earlier = await api<RoomRunItemsPage>(`${runBase}/${run.id}/items?limit=2&cursor=${encodeURIComponent(page.nextCursor!)}`)
      expect(earlier.items.every((item) => item.turnId === run.turnId)).toBe(true)
    }
    expect(model.peer()).toEqual(afterAdmissions)
    expect((await api<{ runs: RoomRunRecord[] }>(`${runBase}?root_request_id=${sent.requestId}&limit=50`))
      .runs.map((run) => run.id)).toEqual(listing.runs.map((run) => run.id))
  }, 60000)
})
