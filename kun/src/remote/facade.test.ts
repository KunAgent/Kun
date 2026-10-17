import { it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { makeHarness, makeFakeModel } from '../../tests/loop-test-harness.js'
import { RoomRuntime } from '../rooms/room-runtime.js'
import { SqliteRoomStore } from '../rooms/room-store-sqlite.js'
import { Router } from '../server/router.js'
import { registerRoomRoutes } from '../server/routes/register-room-routes.js'
import { registerThreadRoutes } from '../server/routes/register-thread-routes.js'
import { ApprovalConsentVerifier } from '../server/approval-consent.js'
import type { ServerRuntime } from '../server/routes/server-runtime.js'
import { RemoteFacade } from './facade.js'
const agents = [
  {
    id: 'kun',
    displayName: 'Kun',
    transport: 'native-loop',
    modelSource: 'provider',
    staticModels: [],
    credentialModes: ['provider']
  },
  {
    id: 'claude-code',
    displayName: 'Claude Code',
    transport: 'agent-sdk',
    modelSource: 'probe',
    staticModels: [],
    credentialModes: ['native-login']
  }
]
it('real Agent and Code admission keeps API surface and replays durable receipts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-mobile-facade-')),
    store = new SqliteRoomStore({ path: join(root, 'rooms.sqlite') }),
    h = makeHarness(makeFakeModel([]))
  const rooms = new RoomRuntime({
    store,
    threads: h.threads,
    threadStore: h.threadStore,
    turns: h.turns,
    sessions: h.sessionStore,
    approvals: h.approvalGate,
    inputs: h.userInputGate,
    dataDir: root,
    model: () => ({ model: 'fake' }),
    profiles: () => ({}),
    assertOwnership: () => store.assertOwnership(),
    runTurn: (id, turnId) => h.loop.runTurn(id, turnId)
  })
  const runtime = {
    rooms,
    runtimeToken: 'token',
    insecure: false,
    threadService: h.threads,
    turnService: h.turns,
    events: h.events,
    eventBus: h.bus,
    sessionStore: h.sessionStore,
    approvalGate: h.approvalGate,
    userInputGate: h.userInputGate,
    defaultModel: 'fake',
    runTurn: () => {},
    harnesses: {
      catalog: {
        list: () => agents,
        get: (id: string) => agents.find((agent) => agent.id === id),
        isDisabled: () => false
      },
      readiness: {
        readyProfiles: async (id: string) =>
          id === 'claude-code'
            ? [
                {
                  harnessId: id,
                  credentialMode: 'native-login',
                  expiresAt: new Date(Date.now() + 60000).toISOString()
                }
              ]
            : [],
        warmProfiles: () => {},
        checking: () => false
      },
      probedModels: () => ['claude-sonnet-4-5'],
      detector: {}
    }
  } as unknown as ServerRuntime
  const router = new Router()
  registerRoomRoutes(router, runtime)
  registerThreadRoutes(router, runtime, new ApprovalConsentVerifier('token'))
  const facade = new RemoteFacade(runtime, router),
    call = (method: string, requestId: string, params: unknown) => ({
      accountId: 'user',
      deviceId: 'phone',
      authorizationId: 'connection',
      call: { method, requestId, expiresAt: Date.now() + 60000, params }
    })
  try {
    await h.threads.create({
      workspace: root,
      model: 'fake',
      agentSurface: 'code',
      mode: 'agent'
    })
    const catalog = (await facade.execute(
      call('catalog.get', 'catalog', {})
    )) as any
    expect(catalog.projects).toHaveLength(1)
    const create = call('code.create', 'create', {
      projectId: catalog.projects[0].id,
      title: 'Phone code',
      model: 'fake'
    })
    const created = (await facade.execute(create)) as any
    expect(created.receipt.status).toBe('applied')
    const id = created.receipt.result.thread.id
    expect(
      ((await facade.execute(create)) as any).receipt.result.thread.id
    ).toBe(id)
    expect(catalog.capabilities).toContain('code.agents')
    expect(catalog.agents.map((agent: any) => agent.id)).toEqual([
      'kun',
      'claude-code'
    ])
    const picked = (await facade.execute(
      call('code.create', 'create-agent', {
        projectId: catalog.projects[0].id,
        title: 'Claude task',
        harnessId: 'claude-code',
        credentialMode: 'native-login',
        model: 'claude-sonnet-4-5'
      })
    )) as any
    expect(picked.receipt.status).toBe('applied')
    const pickedThread = await h.threads.get(picked.receipt.result.thread.id)
    expect(pickedThread?.harnessId).toBe('claude-code')
    expect(pickedThread?.model).toBe('claude-sonnet-4-5')
    await expect(
      facade.execute(
        call('code.create', 'create-bad', {
          projectId: catalog.projects[0].id,
          harnessId: 'claude-code',
          credentialMode: 'native-login',
          model: 'not-offered'
        })
      )
    ).rejects.toThrow('MODEL_NOT_AVAILABLE')
    expect(
      ((await facade.execute(
        call('request.get', 'lookup', { requestId: 'create-bad' })
      )) as any).receipt
    ).toBeNull()
    const start = call('code.turn.start', 'start', {
      threadId: id,
      text: 'one task'
    })
    expect(((await facade.execute(start)) as any).receipt.status).toBe(
      'applied'
    )
    expect((await h.threads.get(id))!.turns[0].clientSurface).toBe('api')
    await facade.execute(start)
    expect((await h.threads.get(id))!.turns).toHaveLength(1)
    const agent = (
      await rooms.agents.create({
        clientRequestId: 'agent',
        name: 'Phone agent'
      })
    ).agent
    const send = call('agent.message.send', 'send', {
      agentId: agent.id,
      text: 'hello from phone'
    })
    const sent = (await facade.execute(send)) as any
    expect(sent.receipt.status).toBe('applied')
    const request = await store.get<any>(
      'request',
      sent.receipt.result.requestId
    )
    expect(request?.value.clientSurface).toBe('api')
    expect(request?.value.remoteDeviceId).toBe('phone')
    await facade.execute(send)
    const history = (await facade.execute(
      call('agent.history', 'history', { agentId: agent.id })
    )) as any
    expect(
      history.messages.filter((m: any) => m.authorKind === 'user')
    ).toHaveLength(1)
  } finally {
    await rooms.close()
    await store.close()
    await rm(root, { recursive: true, force: true })
  }
})
