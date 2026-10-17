import { describe, expect, it } from 'vitest'
import type { ThreadRecord } from '../../contracts/threads.js'
import { remoteFixture } from '../testing/runtime.test-support.js'
import { continuationRoute, movedTurn } from './session-route.js'

const deepseek = { id: 'deepseek', name: 'DeepSeek', kind: 'http', configured: true, credentialStatus: 'ready', models: ['fake', 'other'] }
/** What the desktop composer sends when a task's next turn goes to another Agent. */
const desktopPick = { harnessId: 'claude-code', credentialMode: 'native-login', model: 'claude-sonnet-4-5', providerId: 'default',
  reasoningEffort: 'medium' } as const
const ago = (minutes: number) => new Date(Date.now() - minutes * 60_000).toISOString()

/** A desktop Code task whose stored route is Kun on `fake`. */
async function fixture() {
  const f = await remoteFixture()
  Object.assign(f.runtime, { modelConnections: { snapshot: async () => ({ providers: [deepseek], defaultProviderId: 'deepseek', defaultModel: 'fake' }) } })
  const task = await f.code()
  /** Finishes every turn, dated oldest first, and optionally dates when the stored route was chosen. */
  const settle = async (turnsAt: string[], routeAt?: string) => {
    const thread = (await f.h.threadStore.get(task.id))!
    await f.h.threadStore.upsert({ ...thread, status: 'idle',
      ...(routeAt ? { executionConfig: { ...thread.executionConfig!, resolvedAt: routeAt } } : {}),
      turns: thread.turns.map((turn, index) => ({ ...turn, status: 'completed', createdAt: turnsAt[index] ?? turn.createdAt,
        finishedAt: turnsAt[index] ?? turn.createdAt })) })
  }
  const desktopTurn = () => f.h.turns.startTurn({ threadId: task.id,
    request: { clientRequestId: 'gui_turn', prompt: 'package the app', clientSurface: 'gui', ...desktopPick } })
  const listed = async (filter: Record<string, unknown> = {}) =>
    (await f.call('code.search', filter)).threads.find((thread: { id: string }) => thread.id === task.id)
  const latest = async () => (await f.h.threads.get(task.id))!.turns.at(-1)
  return { ...f, task, settle, desktopTurn, listed, latest }
}

describe('Code task route after a desktop per-turn pick', () => {
  it('lists, filters and reports the Agent the desktop moved the task to, and keeps phone turns on it', async () => {
    const f = await fixture()
    try {
      await f.desktopTurn()
      await f.settle([ago(1)], ago(2))
      const stored = await f.h.threads.getMetadata(f.task.id)
      expect(stored).toMatchObject({ model: 'fake' })
      expect(stored?.harnessId).toBeUndefined()
      expect(await f.listed()).toMatchObject({ harnessId: 'claude-code', model: 'claude-sonnet-4-5' })
      expect(await f.listed({ harnessId: 'claude-code' })).toBeDefined()
      expect(await f.listed({ harnessId: 'kun' })).toBeUndefined()
      const settings = await f.call('code.settings.get', { threadId: f.task.id })
      expect(settings.effective).toEqual(desktopPick)
      expect(settings.next).toEqual(desktopPick)
      await f.call('code.turn.start', { threadId: f.task.id, text: 'also notarize it' })
      expect(await f.latest()).toMatchObject({ ...desktopPick, clientSurface: 'api', mode: 'agent' })
      // The stored route is unchanged: the phone followed the desktop, it did not pin the task.
      expect((await f.h.threads.getMetadata(f.task.id))?.model).toBe('fake')
    } finally { await f.close() }
  })

  it('lets a settings change made after the desktop turn win again', async () => {
    const f = await fixture()
    try {
      await f.desktopTurn()
      await f.settle([ago(1)], ago(2))
      const before = await f.call('code.settings.get', { threadId: f.task.id })
      const after = (await f.call('code.settings.update', { threadId: f.task.id, expectedRevision: before.revision,
        next: { harnessId: 'kun', model: 'other' } })).receipt.result
      expect(after.effective).toMatchObject({ harnessId: 'kun', model: 'other' })
      expect(await f.listed()).toMatchObject({ model: 'other' })
      await f.call('code.turn.start', { threadId: f.task.id, text: 'continue here' })
      expect(await f.latest()).toMatchObject({ harnessId: 'kun', model: 'other', clientSurface: 'api' })
    } finally { await f.close() }
  })

  it('keeps the stored route while the desktop stays on it', async () => {
    const f = await fixture()
    try {
      await f.h.turns.startTurn({ threadId: f.task.id, request: { clientRequestId: 'gui_same', prompt: 'go', clientSurface: 'gui' } })
      await f.settle([ago(1)], ago(2))
      expect(await f.listed()).toMatchObject({ model: 'fake' })
      expect((await f.call('code.settings.get', { threadId: f.task.id })).effective).toMatchObject({ harnessId: 'kun', model: 'fake' })
    } finally { await f.close() }
  })
})

describe('movedTurn', () => {
  const thread = (turns: Partial<ThreadRecord['turns'][number]>[]) => ({ model: 'fake', providerId: 'deepseek', turns,
    executionConfig: { resolvedAt: '2026-10-17T04:00:00.000Z' } }) as unknown as ThreadRecord
  const devin = { model: 'swe-2-high', harnessId: 'devin', providerId: 'default', credentialMode: 'native-login',
    status: 'completed', createdAt: '2026-10-17T04:43:52.260Z', admissionCompletedAt: '2026-10-17T04:43:52.303Z' } as const

  it('follows only a turn that ran on another route after the stored route was chosen', () => {
    expect(movedTurn(thread([devin]))).toMatchObject({ harnessId: 'devin', model: 'swe-2-high' })
    expect(movedTurn(thread([{ ...devin, createdAt: '2026-10-17T03:59:00.000Z' }]))).toBeUndefined()
    expect(movedTurn(thread([{ ...devin, model: 'fake', harnessId: 'kun', providerId: 'deepseek' }]))).toBeUndefined()
    expect(movedTurn(thread([devin, { ...devin, admissionPending: true, model: 'other' }]))).toMatchObject({ model: 'swe-2-high' })
    expect(movedTurn(thread([devin, { ...devin, status: 'failed', admissionCompletedAt: undefined, model: 'other' }])))
      .toMatchObject({ model: 'swe-2-high' })
  })

  it('continues a gateway alias by its binding, without a model or provider', () => {
    const gatewayBinding = { main: { routeId: 'fast', allowedConnectionIds: ['deepseek'] } }
    const route = continuationRoute({ ...devin, harnessId: 'claude-code', credentialMode: 'kun-gateway', gatewayBinding } as never)
    expect(route).toMatchObject({ harnessId: 'claude-code', credentialMode: 'kun-gateway', gatewayBinding })
    expect(route.model).toBeUndefined()
    expect(route.providerId).toBeUndefined()
  })
})
