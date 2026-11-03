import { afterEach, expect, it, vi } from 'vitest'
import type { AgentDispatchIntent, AgentDispatchIntentFile } from '../contracts/agent-dispatch-intents.js'
import { kunToolPermissionModeSettings } from '../contracts/policy.js'
import type { AgentDispatchIntentStore } from './agent-dispatch-intent-store.js'
import {
  AGENT_DISPATCH_IDLE_SCAN_MS, AGENT_DISPATCH_SCAN_MS, AgentDispatchService
} from './agent-dispatch-service.js'

class MemoryIntentStore implements AgentDispatchIntentStore {
  file: AgentDispatchIntentFile = { version: 1, intents: [] }
  readonly list = vi.fn(async (threadId?: string): Promise<AgentDispatchIntent[]> =>
    structuredClone(this.file.intents.filter((intent) => !threadId || intent.source.threadId === threadId)))
  async get(intentId: string): Promise<AgentDispatchIntent | null> {
    return structuredClone(this.file.intents.find((intent) => intent.intentId === intentId) ?? null)
  }
  async transaction<T>(mutate: (file: AgentDispatchIntentFile) => T | Promise<T>): Promise<T> {
    const file = structuredClone(this.file)
    const result = await mutate(file)
    this.file = file
    return structuredClone(result)
  }
}

const services: AgentDispatchService[] = []
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop()
  vi.useRealTimers()
})

it('polls a settled intent file at the idle cadence and speeds up for a local proposal', async () => {
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] })
  const store = new MemoryIntentStore()
  const service = new AgentDispatchService({ store, applicationSessionId: 'app-1' })
  const handler = { validate: vi.fn(async () => undefined), start: vi.fn(async () => ({ threadId: 'child-1' })), cancel: vi.fn(async () => undefined) }
  service.registerHandler('worker', handler)
  services.push(service)
  await service.start()
  await vi.advanceTimersByTimeAsync(AGENT_DISPATCH_SCAN_MS)
  store.list.mockClear()

  await vi.advanceTimersByTimeAsync(AGENT_DISPATCH_IDLE_SCAN_MS * 3)
  expect(store.list).toHaveBeenCalledTimes(3)

  await service.propose({
    kind: 'worker', source: { threadId: 'parent', turnId: 'turn-1', toolCallId: 'call-1',
      userIntent: 'Please implement the task', actingModelRoute: { model: 'review-model', providerId: 'test' } },
    policySnapshot: kunToolPermissionModeSettings('ask-for-approval'),
    recommendation: { title: 'Implement task', task: 'Write the file', agentId: 'external-test',
      permissionMode: 'ask-for-approval', agentSelection: 'auto', workspace: '/workspace', acceptanceCriteria: ['Done'] },
    payload: {}
  })
  // A card waiting for the user's confirmation is settled work: the scan idles again.
  store.list.mockClear()
  await vi.advanceTimersByTimeAsync(AGENT_DISPATCH_SCAN_MS * 2)
  expect(store.list.mock.calls.length).toBeGreaterThanOrEqual(1)
  store.list.mockClear()
  await vi.advanceTimersByTimeAsync(AGENT_DISPATCH_IDLE_SCAN_MS * 2)
  expect(store.list.mock.calls.length).toBeLessThanOrEqual(2)
})
