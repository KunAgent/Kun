import { access, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentDispatchIntentSchema } from '../contracts/agent-dispatch-intents.js'
import { configureManagerAtomicJsonClient } from '../extensions/atomic-json.js'
import { requiresAtomicReplace } from '../manager/shared-data-store-core.js'
import { FileAgentDispatchIntentStore } from './agent-dispatch-intent-store.js'

const roots: string[] = []
afterEach(async () => {
  configureManagerAtomicJsonClient(null); vi.unstubAllEnvs(); vi.unstubAllGlobals()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})

describe('dispatch canonical persistence', () => {
  it('routes every canonical read/write through Manager without a second physical writer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-dispatch-manager-')); roots.push(root)
    vi.stubEnv('KUN_MANAGER_BASE_URL', ''); vi.stubEnv('KUN_MANAGER_TOKEN', '')
    configureManagerAtomicJsonClient({ dataDir: root, baseUrl: 'http://manager.test', token: 'host-only-token' })
    let snapshot: { revision: number, value: unknown | null } = { revision: 0, value: null }
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      expect(String(url)).toMatch(/^http:\/\/manager\.test\/v1\/data\/atomic-json\/(read|write)$/)
      expect(init?.headers).toMatchObject({ authorization: 'Bearer host-only-token' })
      const body = JSON.parse(String(init?.body))
      expect(body.path).toBe(join(root, 'agent-dispatch', 'intents.json'))
      if (String(url).endsWith('/write')) {
        expect(body.expectedRevision).toBe(snapshot.revision)
        snapshot = { revision: snapshot.revision + 1, value: body.value }
      }
      return Response.json({ snapshot })
    })
    vi.stubGlobal('fetch', fetchMock)
    const store = new FileAgentDispatchIntentStore(root)
    const now = new Date().toISOString()
    const intent = AgentDispatchIntentSchema.parse({ intentId: 'intent-1', kind: 'worker', state: 'countdown', revision: 1,
      source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
      policySnapshot: { approvalPolicy: 'auto', sandboxMode: 'danger-full-access', approvalReviewer: 'user' },
      recommendation: { title: 'Task', task: 'Do the task', agentId: 'kun', permissionMode: 'full-access', agentSelection: 'auto' },
      payload: {}, startRequestId: 'start-1', createdAt: now, updatedAt: now })
    await store.transaction((file) => { file.intents.push(intent) })
    expect(await store.get('intent-1')).toEqual(intent)
    await expect(access(store.path)).rejects.toMatchObject({ code: 'ENOENT' })
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith('/write'))).toBe(true)
    expect(requiresAtomicReplace(root, store.path)).toBe(true)
    expect(() => new FileAgentDispatchIntentStore(join(root, '..', 'outside-profile'))).toThrow('outside')
  })

  it('serializes separate store instances so a revision has one winner', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-dispatch-serial-')); roots.push(root)
    const left = new FileAgentDispatchIntentStore(root), right = new FileAgentDispatchIntentStore(root)
    const now = new Date().toISOString()
    const intent = AgentDispatchIntentSchema.parse({ intentId: 'intent-1', kind: 'worker', state: 'queued', revision: 1,
      source: { threadId: 'parent', turnId: 'turn', toolCallId: 'call', applicationSessionId: 'app' },
      policySnapshot: { approvalPolicy: 'on-request', sandboxMode: 'workspace-write', approvalReviewer: 'user' },
      recommendation: { title: 'Task', task: 'Do the task', agentId: 'kun', permissionMode: 'ask-for-approval', agentSelection: 'auto' },
      payload: {}, startRequestId: 'start-1', createdAt: now, updatedAt: now })
    await left.transaction((file) => { file.intents.push(intent) })
    let winners = 0
    await Promise.all([left, right].map((store) => store.transaction((file) => {
      const current = file.intents[0]
      if (current.state !== 'queued') return
      current.state = 'starting'; current.revision += 1; winners += 1
    })))
    expect(winners).toBe(1)
    expect(await right.get('intent-1')).toMatchObject({ state: 'starting', revision: 2 })
  })
})
