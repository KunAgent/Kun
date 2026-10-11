import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { AppSessionOwnerSchema } from '../contracts/app-session-owner.js'
import { RuntimeBuildIdSchema } from '../contracts/runtime-info.js'
import { dispatchRequest } from '../server/http-server.js'
import { KUN_VERSION } from '../version.js'
import { ensureServiceManager, type EnsureServiceManagerInput } from './manager-client.js'
import { managerDiscoveryPath, publishManagerDiscovery } from './manager-discovery.js'
import { buildServiceManagerRouter } from './service-manager-router.js'
import { ServiceManagerState } from './service-manager-state.js'
import type { ManagerSharedDataStore } from './shared-data-store.js'

const roots: string[] = []
afterEach(async () => {
  vi.doUnmock('./manager-discovery.js')
  vi.resetModules()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

// Frozen discovery reader from develop 56d0907f. Keep protocol 5 literal: the
// reverse-direction test must not silently upgrade its old-client fixture.
const Protocol5Discovery = z.object({
  version: z.literal(1),
  protocolVersion: z.literal(5),
  instanceId: z.string().min(1).max(256),
  pid: z.number().int().positive(),
  startedAt: z.string().datetime(),
  host: z.string().min(1).max(512),
  port: z.number().int().min(1).max(65_535),
  baseUrl: z.string().url().max(2_048),
  managerToken: z.string().min(1).max(16_384),
  serviceVersion: z.string().min(1).max(128),
  buildId: RuntimeBuildIdSchema.optional(),
  appOwner: AppSessionOwnerSchema.optional(),
  dataDir: z.string().min(1).max(4_096),
  settingsPath: z.string().min(1).max(4_096),
  logPath: z.string().min(1).max(4_096).optional()
})

async function readProtocol5Discovery(controlDir: string) {
  const path = join(controlDir, 'manager.json')
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > 64 * 1024) return null
    const parsed = Protocol5Discovery.safeParse(JSON.parse(await readFile(path, 'utf8')))
    return parsed.success ? parsed.data : null
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || error instanceof SyntaxError) return null
    throw error
  }
}

async function fixture(options: { sharedData?: boolean; healthPatch?: Record<string, unknown> } = {}) {
  const root = await mkdtemp(join(tmpdir(), 'manager-memory-compatibility-'))
  roots.push(root)
  const discovery = await publishManagerDiscovery(root, {
    instanceId: 'memory-manager', pid: process.pid, startedAt: '2026-10-06T00:00:00.000Z',
    host: '127.0.0.1', port: 18973, baseUrl: 'http://127.0.0.1:18973',
    managerToken: 'compatibility-test-token', serviceVersion: KUN_VERSION,
    buildId: 'a'.repeat(64), dataDir: join(root, 'data'), settingsPath: join(root, 'settings.json')
  })
  const executeMemory = vi.fn()
  const router = buildServiceManagerRouter({
    managerToken: discovery.managerToken, instanceId: discovery.instanceId,
    startedAt: discovery.startedAt, buildId: discovery.buildId, state: new ServiceManagerState(),
    ...(options.sharedData === false ? {} : {
      sharedData: { executeMemory } as unknown as ManagerSharedDataStore
    })
  })
  const request = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const response = await dispatchRequest(router, new Request(url, init))
    if (options.healthPatch && String(url).endsWith('/health')) {
      return Response.json({ ...await response.json(), ...options.healthPatch })
    }
    return response
  })
  const input: EnsureServiceManagerInput = {
    flavor: 'development', controlDir: root, dataDir: discovery.dataDir,
    settingsPath: discovery.settingsPath, buildId: 'b'.repeat(64), fetch: request
  }
  return { root, discovery, input, request, executeMemory }
}

describe('memory lifecycle Manager compatibility fence', () => {
  it('rejects a protocol-5 Manager before a new Runtime can issue data requests', async () => {
    const test = await fixture()
    await writeFile(managerDiscoveryPath(test.root), JSON.stringify({ ...test.discovery, protocolVersion: 5 }))
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).not.toHaveBeenCalled()
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('rejects a new Manager through the real client with its frozen protocol-5 reader', async () => {
    const test = await fixture()
    expect(test.discovery.protocolVersion).toBe(6)
    expect(await readProtocol5Discovery(test.root)).toBeNull()
    vi.resetModules()
    vi.doMock('./manager-discovery.js', async (importOriginal) => ({
      ...await importOriginal<typeof import('./manager-discovery.js')>(),
      KUN_MANAGER_PROTOCOL_VERSION: 5,
      ManagerDiscoveryRecordSchema: Protocol5Discovery,
      readManagerDiscovery: readProtocol5Discovery
    }))
    const oldClient = await import('./manager-client.js')
    await expect(oldClient.ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).not.toHaveBeenCalled()
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('rejects inconsistent protocol-6 discovery and protocol-5 health', async () => {
    const test = await fixture({ healthPatch: { protocolVersion: 5 } })
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).toHaveBeenCalledTimes(1)
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('rejects a current-protocol Manager missing the lifecycle capability', async () => {
    const test = await fixture()
    const fetch = test.input.fetch!
    test.input.fetch = async (url, init) => {
      const response = await fetch(url, init)
      const health = await response.json() as { capabilities: string[] }
      return Response.json({ ...health, capabilities: health.capabilities.filter((value) => value !== 'memory-lifecycle-v1') })
    }
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'capability_incompatible' })
    expect(test.request).toHaveBeenCalledTimes(1)
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('accepts matching protocol and lifecycle support across compatible builds', async () => {
    const test = await fixture()
    await expect(ensureServiceManager(test.input)).resolves.toEqual({ discovery: test.discovery })
    expect(test.request).toHaveBeenCalledTimes(1)
    const health = await (await test.request(`${test.discovery.baseUrl}/health`)).json()
    expect(health).toMatchObject({ protocolVersion: 6, capabilities: expect.arrayContaining(['memory-lifecycle-v1']) })
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('omits lifecycle support from both health and status without shared data', async () => {
    const test = await fixture({ sharedData: false })
    for (const path of ['/health', '/v1/manager/status']) {
      const response = await test.request(`${test.discovery.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${test.discovery.managerToken}` }
      })
      expect(response.status).toBe(200)
      expect((await response.json()).capabilities).not.toContain('memory-lifecycle-v1')
    }
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'capability_incompatible' })
    expect(test.executeMemory).not.toHaveBeenCalled()
  })
})
