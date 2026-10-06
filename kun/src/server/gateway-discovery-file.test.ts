import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GatewayDiscoveryPublisher, removeGatewayDiscovery } from './gateway-discovery-file.js'

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
    expect(publisher.status()).toEqual({ allowed: true, advertised: true, path: file })
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
})
