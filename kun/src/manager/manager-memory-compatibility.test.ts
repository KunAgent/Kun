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
import { KUN_MANAGER_CAPABILITIES, ServiceManagerState } from './service-manager-state.js'
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

// Frozen protocol-6 shape, immediately before the follow-up store fence.
const Protocol6Discovery = Protocol5Discovery.extend({ protocolVersion: z.literal(6) })

async function readProtocolDiscovery(controlDir: string, version: 5 | 6) {
  const path = join(controlDir, 'manager.json')
  try {
    const details = await stat(path)
    if (!details.isFile() || details.size > 64 * 1024) return null
    const parsed = (version === 5 ? Protocol5Discovery : Protocol6Discovery).safeParse(JSON.parse(await readFile(path, 'utf8')))
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

describe('Manager data capability compatibility fence', () => {
  it.each([5, 6] as const)('rejects a protocol-%s Manager before a new Runtime can issue data requests', async (version) => {
    const test = await fixture()
    await writeFile(managerDiscoveryPath(test.root), JSON.stringify({ ...test.discovery, protocolVersion: version }))
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).not.toHaveBeenCalled()
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it.each([5, 6] as const)('rejects a new Manager through the real client with its frozen protocol-%s reader', async (version) => {
    const test = await fixture()
    expect(test.discovery.protocolVersion).toBe(7)
    expect(await readProtocolDiscovery(test.root, version)).toBeNull()
    vi.resetModules()
    vi.doMock('./manager-discovery.js', async (importOriginal) => ({
      ...await importOriginal<typeof import('./manager-discovery.js')>(),
      KUN_MANAGER_PROTOCOL_VERSION: version,
      ManagerDiscoveryRecordSchema: version === 5 ? Protocol5Discovery : Protocol6Discovery,
      readManagerDiscovery: (directory: string) => readProtocolDiscovery(directory, version)
    }))
    const oldClient = await import('./manager-client.js')
    await expect(oldClient.ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).not.toHaveBeenCalled()
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it.each([5, 6] as const)('rejects inconsistent protocol-7 discovery and protocol-%s health', async (version) => {
    const test = await fixture({ healthPatch: { protocolVersion: version } })
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'protocol_incompatible' })
    expect(test.request).toHaveBeenCalledTimes(1)
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it.each(['memory-lifecycle-v1', 'collaboration-followup-store-v1'])('rejects a current-protocol Manager missing %s', async (capability) => {
    const test = await fixture()
    const fetch = test.input.fetch!
    test.input.fetch = async (url, init) => {
      const response = await fetch(url, init)
      const health = await response.json() as { capabilities: string[] }
      return Response.json({ ...health, capabilities: health.capabilities.filter((value) => value !== capability) })
    }
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'capability_incompatible' })
    expect(test.request).toHaveBeenCalledTimes(1)
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('accepts matching protocol and lifecycle support across compatible builds', async () => {
    const test = await fixture()
    await expect(ensureServiceManager(test.input)).resolves.toEqual({
      discovery: { ...test.discovery, capabilities: [...KUN_MANAGER_CAPABILITIES] }
    })
    expect(test.request).toHaveBeenCalledTimes(1)
    const health = await (await test.request(`${test.discovery.baseUrl}/health`)).json()
    expect(health).toMatchObject({ protocolVersion: 7, capabilities: expect.arrayContaining(['memory-lifecycle-v1', 'collaboration-followup-store-v1']) })
    expect(test.executeMemory).not.toHaveBeenCalled()
  })

  it('omits lifecycle support from both health and status without shared data', async () => {
    const test = await fixture({ sharedData: false })
    for (const path of ['/health', '/v1/manager/status']) {
      const response = await test.request(`${test.discovery.baseUrl}${path}`, {
        headers: { authorization: `Bearer ${test.discovery.managerToken}` }
      })
      expect(response.status).toBe(200)
      const capabilities = (await response.json()).capabilities
      expect(capabilities).not.toContain('memory-lifecycle-v1')
      expect(capabilities).not.toContain('collaboration-followup-store-v1')
    }
    await expect(ensureServiceManager(test.input)).rejects.toMatchObject({ kind: 'capability_incompatible' })
    expect(test.executeMemory).not.toHaveBeenCalled()
  })
})
