import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { fakeMailbox } from '@kun/assistant-agent/testing'
import { main as agent } from '@kun/assistant-agent/cli'
import type { AssistantMailboxStatus } from '../../shared/assistant-mailbox'
import type { KunAccountState } from '../../shared/kun-account'
import { AssistantMailboxService } from './service'
import { assistantToolHandler } from './tool-routes'

const ORIGIN = 'https://kun.test'
const cleanup: string[] = []
afterEach(async () => {
  while (cleanup.length) await rm(cleanup.pop()!, { recursive: true, force: true })
})

async function setup(options: { enabled?: boolean; serverEnabled?: boolean; fetchIcon?: (website: string) => Promise<string | null> } = {}) {
  const server = fakeMailbox({ origin: ORIGIN })
  const host = await server.credentials()
  const dir = await mkdtemp(join(tmpdir(), 'kun-assistant-service-'))
  cleanup.push(dir)
  const registrations: unknown[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const url = new URL(String(input))
    if (options.serverEnabled === false && url.pathname.startsWith('/api/assistants/')) return Response.json({ error: 'not_found' }, { status: 404 })
    if (url.pathname === '/api/remote/v1/devices') {
      registrations.push({ device: new Headers(init?.headers).get('X-Kun-Device'), body: JSON.parse(String(init?.body)) })
      return Response.json({ deviceId: host.deviceId, enabled: false })
    }
    return server.fetch(input, init)
  }
  const state: KunAccountState = { status: 'authenticated', user: { id: 'user-1' } as KunAccountState['user'], error: null }
  const emitted: AssistantMailboxStatus[] = []
  const timers: Array<{ ms: number }> = []
  const service = new AssistantMailboxService({
    origin: ORIGIN,
    account: { getState: async () => state, accessToken: async () => host.accessToken, onState: () => () => {} },
    identity: async () => ({ id: host.deviceId, credential: host.deviceCredential }),
    storageDir: join(dir, 'desktop'),
    cipher: async () => ({ encrypt: async (text) => Buffer.from(text).reverse(), decrypt: async (data) => Buffer.from(data).reverse().toString() }),
    fetch,
    deviceName: 'Desk',
    platform: 'macos',
    enabled: () => options.enabled !== false,
    emit: (status) => emitted.push(status),
    log: () => {},
    timers: { set: (_callback, ms) => { timers.push({ ms }); return timers.length }, clear: () => {} },
    ...(options.fetchIcon ? { fetchIcon: options.fetchIcon } : {})
  })
  const run = async (args: string[]) => {
    let stdout = '', stderr = ''
    const code = await agent(args, {
      env: { KUN_HOME: join(dir, 'vm'), KUN_SERVER: ORIGIN }, fetch: server.fetch, sleep: async () => {},
      stdout: { write: (text: string) => { stdout += text } }, stderr: { write: (text: string) => { stderr += text } }
    })
    return { code, stdout, stderr }
  }
  /** The user's side of joining: the assistant asks, the desktop shows the same code, the user allows. */
  const connect = async (code: string) => {
    const asked = await run(['login', code, '--wait', '0'])
    expect(asked.code).toBe(5)
    const shown = /Verification code: (\S+)/.exec(asked.stdout)![1]
    const status = await service.refresh()
    const enrollment = status.enrollments.find((item) => code.includes(item.enrollmentId.replaceAll('-', '')))!
    expect(enrollment.requests.map((request) => request.verificationCode)).toEqual([shown])
    await service.approve(enrollment.enrollmentId, enrollment.requests[0].requestId)
    const done = await run(['login'])
    expect(done.code).toBe(0)
    return { shown, enrollmentId: enrollment.enrollmentId, requestId: enrollment.requests[0].requestId }
  }
  return { server, service, run, connect, emitted, timers, registrations }
}

describe('assistant mailbox service', () => {
  it('stays idle while the Lab switch is off or the server has not opened the mailbox', async () => {
    const off = await setup({ enabled: false })
    expect((await off.service.refresh()).availability).toBe('disabled')
    expect(off.server.state.requests).toEqual([])
    await expect(off.service.createEnrollment({ name: 'Cue', kind: 'cue', locale: 'zh' })).rejects.toThrow('DISABLED')

    const closed = await setup({ serverEnabled: false })
    expect((await closed.service.refresh()).availability).toBe('unavailable')
    expect(closed.timers).toEqual([])
  })

  it('enrolls an assistant, assigns a task and collects its result', async () => {
    const t = await setup()
    const enrollment = await t.service.createEnrollment({ name: 'My Cue', kind: 'cue', locale: 'en' })
    expect(enrollment.prompt).toContain(`login ${enrollment.code}`)
    expect(t.registrations).toEqual([{ device: expect.any(String), body: { name: 'Desk', platform: 'macos', role: 'host' } }])
    expect(enrollment.code).toMatch(/^KUN2-[0-9a-f]{32}-[A-Za-z0-9_-]{43}$/)
    expect(t.emitted.at(-1)?.enrollments.map((item) => [item.name, item.requests])).toEqual([['My Cue', []]])
    expect(t.timers.at(-1)?.ms).toBe(20_000)

    const joined = await t.connect(enrollment.code)
    expect(joined.requestId).toMatch(/^[0-9a-f-]{36}$/)
    let status = await t.service.refresh()
    expect(status.assistants).toMatchObject([{ name: 'My Cue', kind: 'cue', keyAvailable: true }])
    expect(status.enrollments).toEqual([])
    expect(t.timers.at(-1)?.ms).toBe(60_000)

    const task = await t.service.assign({ assistantId: status.assistants[0].id, title: 'Find a dentist', body: 'Open on Saturday' })
    expect(task.status).toBe('sent')
    const inbox = await t.run(['inbox'])
    expect(inbox.stdout).toContain('Open on Saturday')
    expect((await t.run(['reply', task.id.slice(0, 8), '--status', 'done', 'Booked Dr. Sato'])).code).toBe(0)
    expect((await t.run(['send', 'Anything else today?'])).code).toBe(0)

    status = await t.service.refresh()
    expect(status.tasks[0]).toMatchObject({ id: task.id, status: 'done', assistantName: 'My Cue' })
    expect(status.tasks[0].updates.map((update) => [update.status, update.body])).toEqual([['received', ''], ['done', 'Booked Dr. Sato']])
    expect(status.notes.map((note) => note.body)).toEqual(['Anything else today?'])

    const second = await t.service.assign({ assistantId: status.assistants[0].id, body: 'Draft a reply' })
    expect((await t.service.cancel(second.id)).status).toBe('cancelled')
    expect((await t.run(['inbox'])).stdout).toContain('Kun cancelled the task above')

    status = await t.service.revoke(status.assistants[0].id)
    expect(status.assistants).toEqual([])
    expect((await t.run(['inbox'])).code).toBe(3)
  })

  it('answers Kun tools by assistant name and reports what came back', async () => {
    const t = await setup()
    const tools = assistantToolHandler(t.service)
    const { code } = await t.service.createEnrollment({ name: 'Grok', kind: 'grok_bot', locale: 'zh' })
    await t.connect(code)
    const listed = await tools('/assistants', {}) as { assistants: Array<{ name: string; canReceiveTasks: boolean }> }
    expect(listed.assistants).toMatchObject([{ name: 'Grok', canReceiveTasks: true }])
    await expect(tools('/tasks/assign', { assistant: 'nobody', instructions: 'x' })).rejects.toThrow('No connected assistant')
    const assigned = await tools('/tasks/assign', { assistant: 'grok', title: 'Plan\nweekend', instructions: 'Plan my weekend' }) as {
      task: { taskId: string; title: string }; wakeMessage: string
    }
    expect(assigned.task.title).toBe('Plan weekend')
    expect(assigned.wakeMessage).toContain('/workspace/.kun/bin/kun-agent inbox')
    await t.run(['inbox'])
    await t.run(['reply', assigned.task.taskId.slice(0, 8), '--status', 'blocked', 'Which city?'])
    const results = await tools('/tasks/results', { taskId: assigned.task.taskId.slice(0, 8) }) as {
      tasks: Array<{ status: string; updates: Array<{ body: string }> }>
    }
    expect(results.tasks[0].status).toBe('blocked')
    expect(results.tasks[0].updates.at(-1)?.body).toBe('Which city?')
    await expect(tools('/tasks/results', { taskId: 'ffffffff' })).rejects.toThrow('No task')
  })
})

describe('assistant join requests', () => {
  it('lets the user reject a request or cancel the enrollment, and keeps the pairing key while it waits', async () => {
    const t = await setup()
    const { code, enrollmentId } = await t.service.createEnrollment({ name: 'Muse', kind: 'muse', locale: 'zh' })
    expect((await t.run(['login', code, '--wait', '0'])).code).toBe(5)
    let status = await t.service.refresh()
    const [request] = status.enrollments[0].requests
    expect(request.verificationCode).toMatch(/^[0-9A-Z]{5}-[0-9A-Z]{5}$/)
    status = await t.service.reject(enrollmentId, request.requestId)
    expect(status.enrollments[0].requests).toEqual([])
    expect((await t.run(['login'])).code).toBe(3)

    // A fresh request from the same code can still be approved: the pairing key was kept.
    expect((await t.run(['login', code, '--wait', '0'])).code).toBe(5)
    status = await t.service.refresh()
    await t.service.approve(enrollmentId, status.enrollments[0].requests[0].requestId)
    expect((await t.run(['login'])).code).toBe(0)

    const other = await t.service.createEnrollment({ name: 'Dots', kind: 'dots', locale: 'en' })
    status = await t.service.cancelEnrollment(other.enrollmentId)
    expect(status.enrollments).toEqual([])
    expect((await t.run(['forget', '--yes'])).code).toBe(0)
    const late = await t.run(['login', other.code])
    expect(late.code).toBe(1)
    expect(late.stderr).toContain('no longer valid')
  })
})

describe('custom assistants and replies', () => {
  it('connects any product under its own name and icon, and re-shows the prompt from the kept key', async () => {
    const icons: string[] = []
    const t = await setup({ fetchIcon: async (website) => { icons.push(website); return 'data:image/png;base64,AAAA' } })
    await expect(t.service.createEnrollment({ name: 'Zo', kind: 'other', product: 'Zo', website: 'http://zo.computer', locale: 'en' }))
      .rejects.toThrow('INVALID_WEBSITE')
    const created = await t.service.createEnrollment({ name: 'My Zo', kind: 'other', product: 'Zo Computer', website: 'zo.computer', locale: 'en' })
    expect(icons).toEqual(['https://zo.computer'])
    // The icon arrives in the background, followed by a fresh status.
    for (let tries = 0; tries < 100 && !t.emitted.at(-1)?.enrollments[0]?.icon; tries++) await new Promise((resolve) => setTimeout(resolve, 10))
    expect(t.emitted.at(-1)?.enrollments).toMatchObject([{ name: 'My Zo', kind: 'zo_computer', product: 'Zo Computer', icon: 'data:image/png;base64,AAAA' }])

    expect(await t.service.promptFor(created.enrollmentId, 'en')).toEqual({ code: created.code, prompt: created.prompt })
    expect((await t.service.promptFor(created.enrollmentId, 'zh'))?.prompt).toContain(`login ${created.code}`)
    expect(await t.service.promptFor('00000000-0000-4000-8000-000000000000', 'en')).toBeNull()

    await t.connect(created.code)
    const status = await t.service.refresh()
    expect(status.assistants).toMatchObject([{ name: 'My Zo', kind: 'zo_computer', product: 'Zo Computer', icon: 'data:image/png;base64,AAAA' }])
    expect(status.assistants[0].enrollmentId).toBe(created.enrollmentId)
  })

  it('answers a blocked task as a note about that task and shows it as the user\'s message', async () => {
    const t = await setup()
    const { code } = await t.service.createEnrollment({ name: 'Today', kind: 'today', locale: 'en' })
    await t.connect(code)
    const [assistant] = (await t.service.refresh()).assistants
    const task = await t.service.assign({ assistantId: assistant.id, body: 'Book a train to Kyoto' })
    await t.run(['inbox'])
    await t.run(['reply', task.id.slice(0, 8), '--status', 'blocked', 'Which day?'])
    await t.service.refresh()
    await expect(t.service.reply(task.id, '  ')).rejects.toThrow('INVALID_BODY')
    await expect(t.service.reply('missing', 'Saturday')).rejects.toThrow('TASK_NOT_FOUND')
    const status = await t.service.reply(task.id, 'Saturday morning')
    expect(status.notes).toMatchObject([{ from: 'you', body: 'Saturday morning', inReplyTo: task.id, assistantName: 'Today' }])
    expect((await t.run(['inbox'])).stdout).toContain('Saturday morning')
  })
})
