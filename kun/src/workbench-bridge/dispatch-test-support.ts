import { afterEach, expect, vi } from 'vitest'
import type { AgentDispatchIntent, AgentDispatchIntentFile } from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeSettings, type KunToolPermissionMode } from '../contracts/policy.js'
import type { WorkbenchLink } from '../contracts/workbench-links.js'
import { AgentDispatchService } from '../delegation/agent-dispatch-service.js'
import type { AgentDispatchIntentStore } from '../delegation/agent-dispatch-intent-store.js'
import { reconcileWorkbench } from './reconcile.js'
import { workbenchFixture } from './workbench-test-support.js'

export class MemoryDispatchStore implements AgentDispatchIntentStore {
  private file: AgentDispatchIntentFile = { version: 1, intents: [] }
  private lane: Promise<unknown> = Promise.resolve()
  async list(threadId?: string) { return structuredClone(this.file.intents.filter((intent) => !threadId || intent.source.threadId === threadId)) }
  async get(id: string) { return structuredClone(this.file.intents.find((intent) => intent.intentId === id) ?? null) }
  async transaction<T>(mutate: (file: AgentDispatchIntentFile) => T | Promise<T>): Promise<T> {
    const result = this.lane.then(async () => {
      const file = structuredClone(this.file)
      const result = await mutate(file)
      this.file = file
      return structuredClone(result)
    })
    this.lane = result.catch(() => undefined)
    return result
  }
}

const fixtures: Array<() => Promise<void>> = []
afterEach(async () => { for (const cleanup of fixtures.splice(0)) await cleanup() })
export async function dispatchFixture(mode: KunToolPermissionMode = 'full-access', options: { review?: 'allow' | 'deny'; policy?: 'confirm' | 'auto' } = {}) {
  const f = await workbenchFixture({ policy: { code: options.policy ?? 'confirm' } })
  const policy = kunToolPermissionModeSettings(mode)
  Object.assign(f.thread, policy)
  Object.assign(f.thread.turns[0], policy, { model: 'source-model', providerId: 'source-provider', harnessId: 'codex',
    actingModelRoute: { model: 'source-model', providerId: 'source-provider', accountId: 'source-account' } })
  await f.deps.threadStore.upsert(f.thread)
  const room = (await f.store.get('room', f.room.id))!
  await f.store.commit({ requestId: 'dispatch-policy', checks: [{ kind: 'room', id: f.room.id, expectedRevision: room.revision }],
    puts: [{ kind: 'room', id: f.room.id, value: { ...room.value as object, privateExecutionPolicy: policy } }] })
  const clock = { now: Date.now() }
  const review = vi.fn(async (intent: AgentDispatchIntent) => ({ decision: options.review ?? 'allow', reason: 'Reviewed source intent ' + intent.source.userIntent }))
  const intentStore = new MemoryDispatchStore()
  const service = new AgentDispatchService({ store: intentStore, applicationSessionId: 'app-session', now: () => clock.now, review })
  f.bridge.attach({ agentDispatch: service })
  await service.start()
  fixtures.push(async () => { await service.stop(); await f.cleanup() })
  const project = await f.makeDirectory('project')
  const create = async (extra: Record<string, unknown> = {}) => {
    const result = await f.run('create_code_task', { title: 'Task', goal: 'Fix the issue', projectRoot: project, ...extra })
    expect(result.isError, JSON.stringify(result.output)).not.toBe(true)
    return result.output as { linkId: string; dispatchIntentId: string; status: string }
  }
  const intent = async (id: string) => (await service.get(id))!
  const link = async (id: string) => (await f.store.get<WorkbenchLink>('workbench_link', id))!
  const start = async () => { await service.reconcile(); await reconcileWorkbench(f.bridge); await reconcileWorkbench(f.bridge) }
  return { ...f, clock, service, intentStore, review, project, create, intent, link, start }
}
