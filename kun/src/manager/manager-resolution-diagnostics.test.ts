import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { publishManagerDiscovery, KUN_MANAGER_PROTOCOL_VERSION } from './manager-discovery.js'
import { inspectServiceManager } from './manager-resolution.js'
import { KUN_MANAGER_CAPABILITIES } from './service-manager.js'

const roots: string[] = []
afterEach(async () => {
  vi.useRealTimers()
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'manager-probe-'))
  roots.push(root)
  const discovery = await publishManagerDiscovery(root, {
    pid: process.pid, startedAt: new Date().toISOString(), host: '127.0.0.1', port: 19991,
    baseUrl: 'http://127.0.0.1:19991', managerToken: 'never-log-me',
    serviceVersion: 'test', dataDir: root, settingsPath: join(root, 'settings.json')
  })
  const health = { status: 'ok', service: 'kun-service-manager',
    protocolVersion: KUN_MANAGER_PROTOCOL_VERSION, instanceId: discovery.instanceId,
    pid: discovery.pid, startedAt: discovery.startedAt, serviceVersion: discovery.serviceVersion,
    capabilities: [...KUN_MANAGER_CAPABILITIES] }
  return { root, discovery, health }
}
describe('structured Manager diagnostics', () => {
  it.each([
    ['protocol_incompatible', { protocolVersion: 999 }],
    ['identity_mismatch', { instanceId: 'different' }],
    ['health_invalid', { service: 'unrelated' }],
    ['capability_incompatible', { capabilities: [] }]
  ])('classifies %s without retrying or leaking secrets', async (kind, patch) => {
    const { root, health } = await fixture()
    const request = vi.fn(async () => Response.json({ ...health, ...patch }))
    const result = await inspectServiceManager(root, request, { attempts: 3 })
    expect(result).toMatchObject({ state: 'unavailable', error: { code: 'service_manager_unavailable', kind } })
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(result)).not.toContain('never-log-me')
  })
  it('retries a transient refusal then returns the exact ready identity', async () => {
    const { root, health, discovery } = await fixture()
    const request = vi.fn().mockRejectedValueOnce(Object.assign(new Error('secret'), { code: 'ECONNREFUSED' }))
      .mockImplementation(async () => Response.json(health))
    const result = await inspectServiceManager(root, request, { attempts: 3 })
    expect(result).toMatchObject({ state: 'ready', discovery })
    expect(request).toHaveBeenCalledTimes(2)
  })
  it('bounds refusals to three attempts and preserves only the safe reason', async () => {
    const { root } = await fixture()
    const request = vi.fn(async () => { throw Object.assign(new Error('Bearer secret'), { code: 'ECONNREFUSED' }) })
    const result = await inspectServiceManager(root, request, { attempts: 100 })
    expect(request).toHaveBeenCalledTimes(3)
    expect(result).toMatchObject({ state: 'unavailable', error: { kind: 'transport_refused' } })
    expect(JSON.stringify(result)).not.toContain('secret')
  })
  it('does not fetch after its overall deadline', async () => {
    const { root } = await fixture()
    const request = vi.fn()
    expect(await inspectServiceManager(root, request, { deadline: Date.now() - 1, attempts: 3 }))
      .toMatchObject({ state: 'unavailable', error: { kind: 'transport_timeout' } })
    expect(request).not.toHaveBeenCalled()
  })
  it('does not collapse an old protocol or malformed discovery into missing', async () => {
    const { root, discovery } = await fixture()
    await writeFile(join(root, 'manager.json'), JSON.stringify({ ...discovery, protocolVersion: 1 }))
    expect(await inspectServiceManager(root)).toMatchObject({ state: 'unavailable', error: { kind: 'protocol_incompatible' } })
    await writeFile(join(root, 'manager.json'), '{')
    expect(await inspectServiceManager(root)).toMatchObject({ state: 'unavailable', error: { kind: 'discovery_invalid' } })
  })
})
