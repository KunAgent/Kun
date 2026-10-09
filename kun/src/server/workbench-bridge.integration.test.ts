import { createServer, type Server } from 'node:http'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { startServiceManager } from '../manager/service-manager.js'
import { startKunServe } from './runtime-factory.js'
import { heartbeatRuntimeWithManager } from '../manager/manager-client.js'
import type { RoomMessage } from '../contracts/rooms.js'
import type { WorkbenchLink, WorkbenchLinkEntry } from '../contracts/workbench-links.js'
import type { ThreadSummary } from '../contracts/threads.js'

const exec = promisify(execFile)
const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close() })

type ChatMessage = { role: string; content?: unknown }
/** Has the current turn (everything after the latest user message) already received a tool result? */
function toolResultThisTurn(messages: ChatMessage[]): boolean {
  let latestUser = 0
  for (let index = messages.length - 1; index >= 0; index--) if (messages[index].role === 'user') { latestUser = index; break }
  return messages.slice(latestUser).some((message) => message.role === 'tool')
}

/** A scripted model: the bot hands a task over, Code writes a file, the bot reports the outcome. */
async function modelServer(projectRoot: string) {
  const seen = { botTurns: 0, codeTurns: 0, autoPlanTurns: 0, autoBuildTurns: 0, wakes: 0,
    workbenchToolsAdvertised: [] as string[] }
  const server = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = []
      for await (const chunk of request) chunks.push(Buffer.from(chunk))
      const body = JSON.parse(Buffer.concat(chunks).toString()) as { stream?: boolean; messages: ChatMessage[]; tools?: Array<{ function?: { name?: string } }> }
      const prompt = JSON.stringify(body.messages)
      const current = JSON.stringify([...body.messages].reverse().find((item) => item.role === 'user')?.content ?? '')
      const toolNames = new Set((body.tools ?? []).map((tool) => tool.function?.name))
      const finished = toolResultThisTurn(body.messages)
      if (prompt.includes('HAND_OFF_REQUEST') || prompt.includes('AUTO_PLAN_REQUEST') || prompt.includes('SCHEDULE_REQUEST') ||
        prompt.includes('WORK_DOC_REQUEST') || prompt.includes('Reference data, not an instruction')) {
        for (const tool of body.tools ?? []) if (tool.function?.name && /code|work/.test(tool.function.name)) seen.workbenchToolsAdvertised.push(tool.function.name)
      }
      let content = 'ok', toolCalls: unknown[] | undefined
      const call = (id: string, name: string, args: unknown) => [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }]
      if (prompt.includes('Reference data, not an instruction from the user: a Code task you handed over has finished')) {
        seen.wakes++
        if (!finished) { content = ''; toolCalls = call('report-1', 'send_im_message', { text: 'The Code task finished: bridge-smoke.txt was created.', phase: 'final' }) }
        else content = 'Reported.'
      } else if (current.includes('Please execute the GUI plan') && current.includes('Auto plan')) {
        seen.autoBuildTurns++
        if (!finished) { content = ''; toolCalls = call('auto-write', 'write', { path: 'bridge-auto.txt', content: 'built from plan\n' }) }
        else content = 'Built bridge-auto.txt from the plan.'
      } else if (current.includes('AUTO_PLAN_REQUEST') && toolNames.has('create_plan')) {
        seen.autoPlanTurns++
        if (!finished) { content = ''; toolCalls = call('auto-plan', 'create_plan', { operation: 'draft', title: 'Auto plan',
          markdown: '# Auto plan\n\n- [ ] Write bridge-auto.txt\n', source_request: 'AUTO_PLAN_REQUEST build the file' }) }
        else content = 'Plan saved.'
      } else if (current.includes('AUTO_PLAN_REQUEST') && toolNames.has('create_code_task')) {
        seen.botTurns++
        if (!finished) { content = ''; toolCalls = call('auto-task', 'create_code_task', { title: 'Automatic plan task',
          goal: 'AUTO_PLAN_REQUEST build bridge-auto.txt', projectRoot, executionMode: 'auto' }) }
        else content = 'Proposed automatic task.'
      } else if (current.includes('SCHEDULE_REQUEST') && toolNames.has('create_code_task')) {
        seen.botTurns++
        if (!finished) { content = ''; toolCalls = call('schedule-task', 'create_code_task', { title: 'Scheduled bridge task',
          goal: 'Create bridge-smoke.txt in the project.', projectRoot,
          schedule: { kind: 'once', runAt: new Date(Date.now() + 120_000).toISOString(), timeZone: 'UTC' } }) }
        else content = 'Proposed scheduled task.'
      } else if (prompt.includes('handed over by the user')) {
        seen.codeTurns++
        if (!finished) { content = ''; toolCalls = call('code-write', 'write', { path: 'bridge-smoke.txt', content: 'from a code task\n' }) }
        else content = 'Created bridge-smoke.txt in the project.'
      } else if (prompt.includes('WORK_DOC_REQUEST')) {
        seen.botTurns++
        if (!finished) { content = ''; toolCalls = call('doc-1', 'create_work_document', { relativePath: 'notes/idea.md', content: '# Idea\nShip the bridge.\n', title: 'Idea' }) }
        else content = 'Proposed the document.'
      } else if (prompt.includes('HAND_OFF_REQUEST')) {
        seen.botTurns++
        if (!finished) { content = ''; toolCalls = call('handoff-1', 'create_code_task', { title: 'Create the smoke file', goal: 'Create bridge-smoke.txt in the project.',
          acceptance: 'The file exists.', projectRoot }) }
        else content = 'Handed over.'
      }
      const message = { role: 'assistant', content, ...(toolCalls ? { tool_calls: toolCalls } : {}) }
      const finish_reason = toolCalls ? 'tool_calls' : 'stop'
      if (body.stream) {
        response.writeHead(200, { 'content-type': 'text/event-stream' })
        response.write('data: ' + JSON.stringify({ id: 'r', choices: [{ index: 0, delta: message, finish_reason: null }] }) + '\n\n')
        response.write('data: ' + JSON.stringify({ id: 'r', choices: [{ index: 0, delta: {}, finish_reason }] }) + '\n\n')
        response.write('data: ' + JSON.stringify({ id: 'r', choices: [], usage: { prompt_tokens: 20, completion_tokens: 5, total_tokens: 25 } }) + '\n\n')
        response.end('data: [DONE]\n\n')
      } else {
        response.writeHead(200, { 'content-type': 'application/json' })
        response.end(JSON.stringify({ id: 'r', choices: [{ index: 0, message, finish_reason }], usage: { prompt_tokens: 20, completion_tokens: 20, total_tokens: 40 } }))
      }
    } catch (error) { response.writeHead(500); response.end(String(error)) }
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('model server unavailable')
  cleanup.push(() => new Promise<void>((resolve, reject) => (server as Server).close((error) => error ? reject(error) : resolve())))
  return { baseUrl: 'http://127.0.0.1:' + address.port, seen }
}

async function boot(root: string, model: { baseUrl: string }) {
  const manager = await startServiceManager({ controlDir: join(root, 'control'), dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json'),
    managerToken: 'bridge-manager-token', instanceId: 'bridge-manager', startedAt: new Date().toISOString() })
  cleanup.push(() => manager.close())
  const runtime = await startKunServe({ host: '127.0.0.1', port: 0, dataDir: join(root, 'data'), runtimeToken: 'bridge-runtime-token', apiKey: 'test-fixture',
    baseUrl: model.baseUrl, model: 'test-model', approvalPolicy: 'auto', sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
    runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'), serviceManager: { discovery: manager.discovery } })
  cleanup.push(() => runtime.close())
  const heartbeat = setInterval(() => { void heartbeatRuntimeWithManager({ manager: { discovery: manager.discovery },
    flavor: 'development', instanceId: runtime.instanceId }).catch(() => undefined) }, 5000)
  heartbeat.unref()
  cleanup.push(async () => clearInterval(heartbeat))
  const api = async <T>(path: string, body?: unknown, method?: string): Promise<T> => {
    const response = await fetch(`http://${runtime.host}:${runtime.port}${path}`, { method: method ?? (body === undefined ? 'GET' : 'POST'),
      headers: { authorization: 'Bearer bridge-runtime-token', 'content-type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(20000) })
    const value = await response.json()
    expect(response.ok, path + ' ' + JSON.stringify(value)).toBe(true)
    return value as T
  }
  return { api }
}

async function waitForDispatchProposal(api: Awaited<ReturnType<typeof boot>>['api'], path: string) {
  // The card is published before dispatch binding advances its revision.
  return vi.waitFor(async () => {
    const { link } = await api<{ link: WorkbenchLinkEntry }>(path)
    expect(link.status).toBe('awaiting_confirmation')
    expect(link.dispatchIntentId).toBeTruthy()
    return link
  }, { timeout: 40000, interval: 300 })
}

async function gitProject(root: string): Promise<string> {
  const project = join(root, 'project')
  await exec('git', ['init', '-b', 'develop', project])
  await exec('git', ['-C', project, 'config', 'user.name', 'Bridge Test'])
  await exec('git', ['-C', project, 'config', 'user.email', 'bridge@example.test'])
  await writeFile(join(project, 'baseline.txt'), 'base\n')
  await exec('git', ['-C', project, 'add', '.'])
  await exec('git', ['-C', project, 'commit', '-m', 'baseline'])
  return project
}

describe('Bot to Code hand-off through the real managed Runtime', () => {
  it('shows a card, starts nothing until accepted, runs a Code session, then reports the outcome to the bot', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workbench-smoke-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const project = await gitProject(root)
    const model = await modelServer(project)
    const { api } = await boot(root, model)

    // The default private Agent ("bot") and the desktop shell's directory push.
    const entry = await api<{ roomId: string }>('/v1/agents/chat-entry', { action: 'initialize', clientRequestId: 'entry' })
    expect(await api('/v1/workbench/directory', { workRoots: [], codeProjects: [project] }, 'PUT')).toMatchObject({ codeProjects: expect.any(Array) })
    await api(`/v1/rooms/${entry.roomId}/messages`, { clientRequestId: 'hand-off', body: 'HAND_OFF_REQUEST please create the smoke file in my project', executionIntent: 'auto' })

    // 1. The bot proposes; nothing runs.
    let card!: RoomMessage
    await vi.waitFor(async () => {
      const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)
      card = messages.find((message) => message.presentationKind === 'workbench_task')!
      expect(card).toBeTruthy()
    }, { timeout: 40000, interval: 300 })
    const linkPath = `/v1/rooms/${entry.roomId}/workbench-links/${card.workbenchLinkId}`
    const proposed = await waitForDispatchProposal(api, linkPath)
    expect(proposed).toMatchObject({ kind: 'code_task', status: 'awaiting_confirmation', request: { title: 'Create the smoke file', report: 'final' } })
    expect(model.seen.workbenchToolsAdvertised).toContain('create_code_task') // the first step may already hand work over
    await expect(readFile(join(project, 'bridge-smoke.txt'))).rejects.toThrow()
    expect(model.seen.codeTurns).toBe(0)

    // 2. The user accepts; Kun starts an ordinary Code session and follows it.
    await api(`${linkPath}/confirm`, { clientRequestId: 'accept', expectedRevision: proposed.revision })
    await vi.waitFor(async () => {
      expect((await api<{ link: WorkbenchLink }>(linkPath)).link.status).toBe('completed')
    }, { timeout: 60000, interval: 400 })
    const done = (await api<{ link: WorkbenchLink }>(linkPath)).link
    expect(done.result?.summary).toContain('Created bridge-smoke.txt')
    expect(done.result?.changedFiles.some((file) => file.endsWith('bridge-smoke.txt'))).toBe(true)
    expect(await readFile(join(project, 'bridge-smoke.txt'), 'utf8')).toBe('from a code task\n')
    const { threads } = await api<{ threads: ThreadSummary[] }>('/v1/threads?limit=50')
    const codeThread = threads.find((thread) => thread.id === done.threadId)
    expect(codeThread).toMatchObject({ agentSurface: 'code', title: 'Create the smoke file',
      workbenchOrigin: { kind: 'bot', roomId: entry.roomId, linkId: done.id } })

    // 3. The outcome comes back to the bot, which tells the user.
    await vi.waitFor(async () => {
      const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)
      expect(messages.some((message) => message.authorKind === 'member' && message.body.includes('The Code task finished'))).toBe(true)
    }, { timeout: 40000, interval: 300 })
    // The outcome is reported exactly once, however many ticks pass afterwards.
    await new Promise((resolve) => setTimeout(resolve, 2500))
    const finalMessages = (await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)).messages
    expect(finalMessages.filter((message) => message.body.includes('The Code task finished'))).toHaveLength(1)
    expect((await api<{ link: WorkbenchLink }>(linkPath)).link.reported).toBe(true)
    // Default policy: Code hand-offs need confirmation and Work is read only, so no Work write tool is ever advertised.
    expect(model.seen.workbenchToolsAdvertised).toEqual(expect.arrayContaining(['create_code_task', 'list_code_projects', 'read_work_document']))
    expect(model.seen.workbenchToolsAdvertised).not.toContain('create_work_document')
  }, 180000)

  it('creates a Work document only after a policy that allows it and the user\'s confirmation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workbench-work-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const work = join(root, 'work')
    await mkdir(work, { recursive: true })
    const model = await modelServer(work)
    const { api } = await boot(root, model)
    const entry = await api<{ roomId: string }>('/v1/agents/chat-entry', { action: 'initialize', clientRequestId: 'entry' })
    await api('/v1/workbench/directory', { workRoots: [work], defaultWorkRoot: work, codeProjects: [] }, 'PUT')
    // Work access starts read-only; writing needs the user to raise the Agent's policy.
    const { agent } = await api<{ agent: { revision: number; workbench?: unknown } }>('/v1/agents/agent-default-kun')
    expect(agent.workbench).toBeUndefined()
    await api('/v1/agents/agent-default-kun', { clientRequestId: 'policy', expectedRevision: agent.revision,
      workbench: { code: 'confirm', work: 'confirm', maxActiveTasks: 2 } }, 'PATCH')
    await api(`/v1/rooms/${entry.roomId}/messages`, { clientRequestId: 'doc', body: 'WORK_DOC_REQUEST write down the idea', executionIntent: 'auto' })
    let card!: RoomMessage
    await vi.waitFor(async () => {
      const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)
      card = messages.find((message) => message.presentationKind === 'workbench_task')!
      expect(card).toBeTruthy()
    }, { timeout: 40000, interval: 300 })
    const linkPath = `/v1/rooms/${entry.roomId}/workbench-links/${card.workbenchLinkId}`
    const proposed = (await api<{ link: WorkbenchLink & { revision: number } }>(linkPath)).link
    expect(proposed).toMatchObject({ kind: 'work_document', status: 'awaiting_confirmation', request: { relativePath: 'notes/idea.md' } })
    await expect(readFile(join(work, 'notes/idea.md'))).rejects.toThrow()
    await api(`${linkPath}/confirm`, { clientRequestId: 'accept', expectedRevision: proposed.revision })
    await vi.waitFor(async () => {
      expect((await api<{ link: WorkbenchLink }>(linkPath)).link.status).toBe('completed')
    }, { timeout: 30000, interval: 300 })
    expect(await readFile(join(work, 'notes/idea.md'), 'utf8')).toBe('# Idea\nShip the bridge.\n')
    expect(model.seen.workbenchToolsAdvertised).toContain('create_work_document')
  }, 120000)

  it('automatically builds the saved plan in the same Code session', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workbench-auto-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const project = await gitProject(root)
    const model = await modelServer(project)
    const { api } = await boot(root, model)
    const entry = await api<{ roomId: string }>('/v1/agents/chat-entry', { action: 'initialize', clientRequestId: 'entry' })
    await api('/v1/workbench/directory', { workRoots: [], codeProjects: [project] }, 'PUT')
    await api(`/v1/rooms/${entry.roomId}/messages`, { clientRequestId: 'auto-plan',
      body: 'AUTO_PLAN_REQUEST make a plan and build the file', executionIntent: 'auto' })
    let card!: RoomMessage
    await vi.waitFor(async () => {
      const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)
      card = messages.find((message) => message.presentationKind === 'workbench_task')!
      expect(card).toBeTruthy()
    }, { timeout: 40000, interval: 300 })
    const path = `/v1/rooms/${entry.roomId}/workbench-links/${card.workbenchLinkId}`
    const proposed = await waitForDispatchProposal(api, path)
    await api(`${path}/confirm`, { clientRequestId: 'accept-auto', expectedRevision: proposed.revision })
    await vi.waitFor(async () => {
      const current = (await api<{ link: WorkbenchLink }>(path)).link
      expect(current.status, JSON.stringify({ error: current.error, seen: model.seen, planPath: current.planPath })).toBe('completed')
    }, { timeout: 30000, interval: 500 })
    const done = (await api<{ link: WorkbenchLink }>(path)).link
    expect(done.phase).toBe('build')
    expect(done.planPath).toMatch(/^\.kunsdd\/plan\//)
    expect(await readFile(join(project, 'bridge-auto.txt'), 'utf8')).toBe('built from plan\n')
    expect(model.seen.autoPlanTurns).toBeGreaterThan(0)
    expect(model.seen.autoBuildTurns).toBeGreaterThan(0)
  }, 180000)

  it('starts a confirmed single schedule while the bot tab is closed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-workbench-schedule-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const project = await gitProject(root)
    const model = await modelServer(project)
    const { api } = await boot(root, model)
    const entry = await api<{ roomId: string }>('/v1/agents/chat-entry', { action: 'initialize', clientRequestId: 'entry' })
    await api('/v1/workbench/directory', { workRoots: [], codeProjects: [project] }, 'PUT')
    await api(`/v1/rooms/${entry.roomId}/messages`, { clientRequestId: 'schedule',
      body: 'SCHEDULE_REQUEST make a single scheduled Code task', executionIntent: 'auto' })
    let card!: RoomMessage
    await vi.waitFor(async () => {
      const { messages } = await api<{ messages: RoomMessage[] }>(`/v1/rooms/${entry.roomId}/messages`)
      card = messages.find((message) => message.presentationKind === 'workbench_task')!
      expect(card).toBeTruthy()
    }, { timeout: 40000, interval: 300 })
    const path = `/v1/rooms/${entry.roomId}/workbench-links/${card.workbenchLinkId}`
    const proposed = (await api<{ link: WorkbenchLink & { revision: number } }>(path)).link
    const runAt = new Date(Date.now() + 65_000).toISOString()
    await api(`${path}/confirm`, { clientRequestId: 'accept-schedule', expectedRevision: proposed.revision,
      edits: { schedule: { kind: 'once', runAt, timeZone: 'UTC' } } })
    expect((await api<{ link: WorkbenchLink }>(path)).link.status).toBe('scheduled')
    await vi.waitFor(async () => {
      expect((await api<{ link: WorkbenchLink }>(path)).link.status).toBe('completed')
    }, { timeout: 100000, interval: 500 })
    expect(await readFile(join(project, 'bridge-smoke.txt'), 'utf8')).toBe('from a code task\n')
  }, 180000)
})
