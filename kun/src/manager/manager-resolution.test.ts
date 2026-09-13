import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  publishManagerDiscovery,
  type ManagerDiscoveryRecord
} from './manager-discovery.js'
import {
  resolveServiceManager,
  resolveServiceManagerForHandoff,
  resolveServiceManagerForMigration
} from './manager-resolution.js'
import { KUN_MANAGER_CAPABILITIES } from './service-manager.js'

describe('Service Manager resolution', () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
  })

  it('keeps normal resolution strict about the current capability set', async () => {
    const fixture = await managerFixture([...KUN_MANAGER_CAPABILITIES])
    const fetchImpl = managerFetch(fixture)

    await expect(resolveServiceManager(fixture.controlDir, fetchImpl)).resolves.toEqual({
      discovery: fixture.discovery
    })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  it('authenticates an older same-protocol manager only for migration handoff', async () => {
    const capabilities = KUN_MANAGER_CAPABILITIES.filter((value) => value !== 'item-page-v1')
    const fixture = await managerFixture(capabilities)
    const fetchImpl = managerFetch(fixture)

    await expect(resolveServiceManager(fixture.controlDir, fetchImpl)).resolves.toBeNull()
    await expect(resolveServiceManagerForMigration(fixture.controlDir, fetchImpl)).resolves.toEqual({
      discovery: fixture.discovery
    })

    const statusCall = vi.mocked(fetchImpl).mock.calls.find(([input]) =>
      String(input).endsWith('/v1/manager/status')
    )
    expect(new Headers(statusCall?.[1]?.headers).get('authorization')).toBe('Bearer manager-token')
  })

  it.each(['item-turn-page-v1', 'room-store-v4', 'history-reference-recovery-v1', 'history-reference-sources-v1'])('requires %s before accepting manager features', async (missing) => {
    const fixture = await managerFixture(KUN_MANAGER_CAPABILITIES.filter((value) => value !== missing))
    const fetchImpl = managerFetch(fixture)
    await expect(resolveServiceManager(fixture.controlDir, fetchImpl)).resolves.toBeNull()
    await expect(resolveServiceManagerForMigration(fixture.controlDir, fetchImpl)).resolves.toEqual({ discovery: fixture.discovery })
  })

  it('rejects a capability-incompatible manager when status authentication fails', async () => {
    const capabilities = KUN_MANAGER_CAPABILITIES.filter((value) => value !== 'item-page-v1')
    const fixture = await managerFixture(capabilities)
    const fetchImpl = managerFetch(fixture, { statusCode: 401 })

    await expect(resolveServiceManagerForHandoff(fixture.controlDir, fetchImpl)).resolves.toBeNull()
  })

  it('rejects a handoff when authenticated status identifies a different manager', async () => {
    const capabilities = KUN_MANAGER_CAPABILITIES.filter((value) => value !== 'item-page-v1')
    const fixture = await managerFixture(capabilities)
    const fetchImpl = managerFetch(fixture, { statusInstanceId: 'replacement-manager' })

    await expect(resolveServiceManagerForHandoff(fixture.controlDir, fetchImpl)).resolves.toBeNull()
  })

  async function managerFixture(capabilities: string[]): Promise<{
    controlDir: string
    discovery: ManagerDiscoveryRecord
    capabilities: string[]
  }> {
    const root = await mkdtemp(join(tmpdir(), 'kun-manager-resolution-'))
    roots.push(root)
    const controlDir = join(root, 'control')
    const discovery = await publishManagerDiscovery(controlDir, {
      instanceId: 'manager-instance',
      pid: process.pid,
      startedAt: '2026-08-15T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18973,
      baseUrl: 'http://127.0.0.1:18973',
      managerToken: 'manager-token',
      serviceVersion: '0.2.37',
      dataDir: join(root, 'data'),
      settingsPath: join(root, 'kun-settings.json')
    })
    return { controlDir, discovery, capabilities }
  }
})

function managerFetch(
  fixture: { discovery: ManagerDiscoveryRecord; capabilities: string[] },
  options: { statusCode?: number; statusInstanceId?: string } = {}
): typeof fetch {
  return vi.fn(async (input: string | URL | Request) => {
    const url = String(input)
    const identity = {
      protocolVersion: fixture.discovery.protocolVersion,
      instanceId: fixture.discovery.instanceId,
      pid: fixture.discovery.pid,
      startedAt: fixture.discovery.startedAt,
      serviceVersion: fixture.discovery.serviceVersion,
      capabilities: fixture.capabilities
    }
    if (url.endsWith('/health')) {
      return Response.json({
        status: 'ok',
        service: 'kun-service-manager',
        ...identity
      })
    }
    if (url.endsWith('/v1/manager/status')) {
      if (options.statusCode && options.statusCode !== 200) {
        return new Response('', { status: options.statusCode })
      }
      return Response.json({
        ...identity,
        instanceId: options.statusInstanceId ?? identity.instanceId,
        slots: []
      })
    }
    return new Response('', { status: 404 })
  }) as unknown as typeof fetch
}
