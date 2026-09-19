import { randomUUID } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { createExtensionContext, type HostTransport } from '@kun/extension-api'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import type { ExtensionPrincipal } from '../extensions/host-process.js'
import { startServiceManager } from '../manager/service-manager.js'
import { registerRuntimeWithManager } from '../manager/manager-client.js'
import { requiredExtensionBrokerPermission } from '../services/extension-host-broker.js'
import { createKunServeRuntime } from './runtime-factory.js'

const cleanup: Array<() => Promise<unknown>> = []
afterEach(async () => {
  for (const close of cleanup.splice(0).reverse()) await close()
})

describe('extension read surfaces through the managed Runtime broker', () => {
  it('connects the public SDK to canonical capacity and room data without exposing owned threads', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-extension-read-'))
    cleanup.push(() => rm(root, { recursive: true, force: true }))
    const manager = await startServiceManager({
      controlDir: join(root, 'control'), dataDir: join(root, 'data'),
      settingsPath: join(root, 'settings.json'), managerToken: 'extension-read-fixture',
      instanceId: 'extension-read-manager', startedAt: new Date().toISOString()
    })
    cleanup.push(() => manager.close())
    const runtime = await createKunServeRuntime({
      host: '127.0.0.1', port: 0, dataDir: join(root, 'data'),
      runtimeToken: 'extension-read-runtime', apiKey: 'fixture',
      baseUrl: 'http://127.0.0.1:1', model: 'fixture-model', approvalPolicy: 'auto',
      sandboxMode: 'workspace-write', tokenEconomyMode: false, insecure: false,
      runtimeFlavor: 'development', discoveryDir: join(root, 'discovery'),
      runtime: { turnLimits: { maxConcurrentTurns: 3 } },
      serviceManager: { discovery: manager.discovery }
    })
    cleanup.push(async () => { await runtime.shutdown?.() })
    // Room writes are fenced by the rooms-coordinator lease: the runtime must
    // register its development slot and acquire the lease before commits land.
    await registerRuntimeWithManager({
      manager: { discovery: manager.discovery },
      registration: {
        flavor: 'development', instanceId: 'embedded', pid: process.pid,
        startedAt: new Date().toISOString(), host: '127.0.0.1', port: 1,
        baseUrl: 'http://127.0.0.1:1', runtimeToken: 'extension-read-runtime'
      }
    })
    runtime.startBackgroundMaintenance?.()
    const broker = runtime.extensionPlatform!.broker
    const permissions = ['agent.capacity.read', 'rooms.read', 'agent.threads.readOwn', 'agent.run']
    const principal: ExtensionPrincipal = {
      extensionId: 'acme.read-surfaces', version: '1.0.0', apiVersion: '1.5.0',
      lifecycleNonce: randomUUID(), grantedPermissions: permissions,
      workspaceRoots: [], development: true
    }
    const invoke = (method: string, params: unknown = {}, grantedPermissions = permissions) =>
      broker.handle({
        principal: { ...principal, grantedPermissions }, method,
        params: JSON.parse(JSON.stringify(params)), signal: new AbortController().signal,
        requestId: randomUUID()
      })
    const transport: HostTransport = {
      request: (method, params) => invoke(method, params),
      notify() {}, dispose() {},
      onNotification: () => ({ dispose() {} }),
      registerHandler: () => ({ dispose() {} })
    }
    const context = createExtensionContext(transport, {
      extension: { id: principal.extensionId, publisher: 'acme', name: 'read-surfaces', version: '1.0.0' },
      apiVersion: '1.5.0', capabilities: ['agent.capacity', 'rooms.read'],
      permissions, activationEvent: 'onStartup'
    })
    cleanup.push(async () => { await context.subscriptions.dispose() })
    expect(await context.agent.capacity()).toEqual({
      activeTurns: 0, queuedTurns: 0, maxConcurrentTurns: 3, busy: false
    })

    const { room } = await runtime.rooms!.service.create({ name: 'Shared room', clientRequestId: randomUUID() })
    const { message } = await runtime.rooms!.service.send(room.id, {
      clientRequestId: randomUUID(), body: 'Public room message'
    })
    for (const [id, surface, status] of [
      ['gui-turn', 'gui', 'running'], ['room-turn', 'gui', 'queued'],
      ['extension-turn', 'extension', 'running']
    ] as const) {
      const thread = createThreadRecord({ id, title: 'private thread', workspace: root, model: 'fixture-model' })
      await runtime.threadStore!.upsert({
        ...thread,
        ...(id === 'room-turn' ? { relation: 'side' as const, roomContext: {
          roomId: room.id, memberId: 'developer', kind: 'execution' as const,
          blockedToolNames: [], blockedProviderIds: [], blockedSkillIds: []
        } } : {}),
        ...(surface === 'extension' ? { ownerExtensionId: 'acme.other', ownerExtensionVersion: '1.0.0' } : {}),
        turns: [createTurnRecord({ id: id + '-run', threadId: id, prompt: 'PRIVATE_PROMPT', clientSurface: surface, status })]
      })
    }
    expect(await context.agent.capacity()).toEqual({
      activeTurns: 2, queuedTurns: 1, maxConcurrentTurns: 3, busy: true
    })
    expect(await context.rooms.list()).toMatchObject({
      items: [{ id: room.id, name: 'Shared room', memberCount: 5 }], page: { hasMore: false }
    })
    const messages = await context.rooms.listMessages({ roomId: room.id })
    expect(messages).toMatchObject({ items: [{ id: message.id, body: 'Public room message' }] })
    expect(JSON.stringify(messages)).not.toContain('rootRequestId')
    expect(await context.rooms.listTasks({ roomId: room.id })).toEqual({ items: [], page: { hasMore: false } })
    const events = await context.rooms.listEvents({ roomId: room.id })
    expect(events.items.some((event) => event.type === 'room.created')).toBe(true)
    expect(events.cursor).toBeGreaterThan(0)
    expect(JSON.stringify({ events, messages })).not.toContain(root)
    await expect(invoke('threads.getOwn', { threadId: 'room-turn' })).rejects.toMatchObject({ code: 'not_found' })
    await expect(invoke('agent.getRun', { runId: 'extension-turn-run' })).rejects.toBeDefined()

    for (const method of ['agent.capacity', 'rooms.list', 'rooms.listMessages', 'rooms.listTasks', 'rooms.listEvents']) {
      const permission = method === 'agent.capacity' ? 'agent.capacity.read' : 'rooms.read'
      expect(requiredExtensionBrokerPermission(method, {})).toBe(permission)
      await expect(invoke(method, method === 'agent.capacity' || method === 'rooms.list' ? {} : { roomId: room.id }, []))
        .rejects.toMatchObject({ code: 'permission_denied' })
    }
    await expect(invoke('rooms.send', { roomId: room.id, body: 'Must not be written' }))
      .rejects.toThrow('unsupported Extension Host broker method')
    await expect(invoke('agent.capacity', { ownerExtensionId: 'acme.other' })).rejects.toBeDefined()
    await expect(invoke('rooms.listMessages', { roomId: room.id, includePrivate: true })).rejects.toBeDefined()
    expect(await context.rooms.listMessages({ roomId: room.id })).toEqual(messages)

    for (const id of ['gui-turn', 'room-turn', 'extension-turn']) await runtime.threadStore!.delete(id)
    expect((await context.agent.capacity()).busy).toBe(false)
  }, 60_000)
})
