import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GatewayDiscoveryPublisher, gatewayDiscoveryOwnerLive, removeGatewayDiscovery } from './gateway-discovery-file.js'

let dir: string
const previous = process.env.KUN_GATEWAY_DISCOVERY_FILE
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'kun-discovery-'))
  process.env.KUN_GATEWAY_DISCOVERY_FILE = join(dir, 'gateway.json')
})
afterEach(() => {
  if (previous === undefined) delete process.env.KUN_GATEWAY_DISCOVERY_FILE
  else process.env.KUN_GATEWAY_DISCOVERY_FILE = previous
  rmSync(dir, { recursive: true, force: true })
})

const input = { baseUrl: 'http://127.0.0.1:18899/', version: '1.0.0', instanceId: 'inst-1' }

describe('gateway discovery publisher', () => {
  it('publishes a user-only file without secrets and follows the setting both ways', async () => {
    let wanted = true
    const publisher = new GatewayDiscoveryPublisher(input, () => wanted)
    await publisher.reconcile()
    const file = join(dir, 'gateway.json')
    const record = JSON.parse(readFileSync(file, 'utf8'))
    expect(record).toMatchObject({ name: 'kun', baseUrl: 'http://127.0.0.1:18899', v1: 'http://127.0.0.1:18899/v1', instanceId: 'inst-1' })
    expect(Object.keys(record).some((key) => /key|token|secret/i.test(key))).toBe(false)
    if (process.platform !== 'win32') expect(statSync(file).mode & 0o777).toBe(0o600)
    expect(publisher.status()).toEqual({ allowed: true, advertised: true, path: file, owner: 'self' })
    wanted = false
    await publisher.reconcile()
    expect(existsSync(file)).toBe(false)
    wanted = true
    await publisher.reconcile()
    await publisher.stop()
    expect(existsSync(file)).toBe(false)
  })
  it('never publishes when the runtime may not advertise, and leaves another instance\'s file alone', async () => {
    const blocked = new GatewayDiscoveryPublisher(input, () => true, false)
    await blocked.reconcile()
    expect(blocked.status().advertised).toBe(false)
    const file = join(dir, 'gateway.json')
    writeFileSync(file, JSON.stringify({ instanceId: 'other' }))
    await removeGatewayDiscovery('inst-1')
    expect(existsSync(file)).toBe(true)
  })
  it('republishes when the file disappears while it runs', async () => {
    const publisher = new GatewayDiscoveryPublisher(input, () => true)
    await publisher.reconcile()
    const file = join(dir, 'gateway.json')
    rmSync(file)
    await publisher.reconcile()
    expect(JSON.parse(readFileSync(file, 'utf8')).instanceId).toBe('inst-1')
  })
  it('leaves a live instance\'s file alone and takes over once that instance is gone', async () => {
    const file = join(dir, 'gateway.json')
    writeFileSync(file, JSON.stringify({ name: 'kun', instanceId: 'packaged', pid: 4242, baseUrl: 'http://127.0.0.1:18900' }))
    let live = true
    let now = 0
    const publisher = new GatewayDiscoveryPublisher(input, () => true, true, { ownerLive: async () => live, now: () => now })
    await publisher.reconcile()
    expect(JSON.parse(readFileSync(file, 'utf8')).instanceId).toBe('packaged')
    expect(publisher.status()).toMatchObject({ advertised: false, owner: 'other', other: { pid: 4242, baseUrl: 'http://127.0.0.1:18900' } })
    // The other instance quits normally and removes its own file.
    rmSync(file)
    await publisher.reconcile()
    expect(JSON.parse(readFileSync(file, 'utf8')).instanceId).toBe('inst-1')
    // A crashed owner leaves its file; once the liveness check expires it is replaced.
    writeFileSync(file, JSON.stringify({ name: 'kun', instanceId: 'crashed', pid: 4243 }))
    live = false
    now = 60_000
    await publisher.reconcile()
    expect(publisher.status()).toMatchObject({ advertised: true, owner: 'self' })
    expect(JSON.parse(readFileSync(file, 'utf8')).instanceId).toBe('inst-1')
    await publisher.stop()
    expect(existsSync(file)).toBe(false)
  })
  it('does not remove another instance\'s file when its own setting is off', async () => {
    const file = join(dir, 'gateway.json')
    writeFileSync(file, JSON.stringify({ name: 'kun', instanceId: 'packaged', pid: 4242 }))
    const publisher = new GatewayDiscoveryPublisher(input, () => false, true, { ownerLive: async () => true })
    await publisher.reconcile()
    expect(existsSync(file)).toBe(true)
    expect(publisher.status()).toMatchObject({ advertised: false, owner: 'other' })
  })
  it('treats a reused pid or an unreachable hello as gone', async () => {
    expect(await gatewayDiscoveryOwnerLive({ pid: process.pid, instanceId: 'x', hello: 'http://127.0.0.1:1/api/hello' })).toBe(false)
    expect(await gatewayDiscoveryOwnerLive({ pid: 2 ** 22 + 12_345, instanceId: 'x', hello: 'http://127.0.0.1:1/api/hello' })).toBe(false)
    expect(await gatewayDiscoveryOwnerLive({ pid: process.pid, instanceId: 'x', hello: 'https://example.com/api/hello' })).toBe(false)
  })
})
