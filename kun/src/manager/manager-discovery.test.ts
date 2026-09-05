import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  createManagerDiscoveryRecord,
  KUN_MANAGER_PROTOCOL_VERSION,
  managerDiscoveryPath,
  publishManagerDiscovery,
  readManagerHandoffDiscovery,
  readManagerHandoffDiscoveryStrict,
  readManagerDiscovery,
  removeManagerDiscovery,
  withManagerStartLock
} from './manager-discovery.js'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function root(): Promise<string> {
  const value = await mkdtemp(join(tmpdir(), 'kun-manager-discovery-'))
  roots.push(value)
  return value
}

function input() {
  return {
    pid: process.pid,
    startedAt: '2026-08-01T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18991,
    baseUrl: 'http://127.0.0.1:18991',
    managerToken: 'manager-secret',
    serviceVersion: '0.1.0',
    dataDir: '/tmp/kun-data',
    settingsPath: '/tmp/Kun/kun-settings.json'
  }
}

describe('manager discovery', () => {
  it('creates a versioned protocol record', () => {
    expect(createManagerDiscoveryRecord({
      ...input(),
      instanceId: 'manager-a',
      buildId: 'b'.repeat(64)
    })).toMatchObject({
      version: 1,
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: 'manager-a',
      buildId: 'b'.repeat(64)
    })
  })

  it('keeps a legacy discovery record without build identity readable', async () => {
    const controlDir = await root()
    await writeFile(managerDiscoveryPath(controlDir), JSON.stringify({
      ...input(),
      version: 1,
      protocolVersion: KUN_MANAGER_PROTOCOL_VERSION,
      instanceId: 'legacy-manager'
    }), 'utf8')

    const legacy = await readManagerDiscovery(controlDir)
    expect(legacy).toMatchObject({ instanceId: 'legacy-manager' })
    expect(legacy).not.toHaveProperty('buildId')
  })

  it('reads older safe schemas only through the handoff contract', async () => {
    const controlDir = await root()
    await writeFile(managerDiscoveryPath(controlDir), JSON.stringify({
      ...input(),
      version: 7,
      protocolVersion: 3,
      instanceId: 'older-manager',
      futureField: ['ignored', 'for-handoff']
    }), 'utf8')

    expect(await readManagerDiscovery(controlDir)).toBeNull()
    expect(await readManagerHandoffDiscovery(controlDir)).toMatchObject({
      instanceId: 'older-manager',
      version: 7,
      protocolVersion: 3,
      futureField: ['ignored', 'for-handoff']
    })
    expect(await removeManagerDiscovery(controlDir, 'older-manager')).toBe(true)
  })

  it('rejects unsafe Manager handoff endpoints and missing identity fields', async () => {
    const controlDir = await root()
    await writeFile(managerDiscoveryPath(controlDir), JSON.stringify({
      ...input(),
      version: 1,
      protocolVersion: 1,
      instanceId: 'unsafe-manager',
      host: 'example.com',
      baseUrl: 'http://example.com:18991'
    }), 'utf8')
    expect(await readManagerHandoffDiscovery(controlDir)).toBeNull()

    await writeFile(managerDiscoveryPath(controlDir), JSON.stringify({
      ...input(),
      version: 1,
      protocolVersion: 1
    }), 'utf8')
    expect(await readManagerHandoffDiscovery(controlDir)).toBeNull()
  })

  it('publishes an owner-only discovery record', async () => {
    const controlDir = await root()
    const record = await publishManagerDiscovery(controlDir, { ...input(), instanceId: 'manager-a' })
    expect(await readManagerDiscovery(controlDir)).toEqual(record)
    expect(JSON.parse(await readFile(managerDiscoveryPath(controlDir), 'utf8'))).toEqual(record)
    if (process.platform !== 'win32') {
      expect((await stat(managerDiscoveryPath(controlDir))).mode & 0o777).toBe(0o600)
    }
  })

  it('rejects malformed and oversized records', async () => {
    const controlDir = await root()
    await writeFile(managerDiscoveryPath(controlDir), '{broken', 'utf8')
    expect(await readManagerDiscovery(controlDir)).toBeNull()
    expect(await readManagerHandoffDiscovery(controlDir)).toBeNull()
    await writeFile(managerDiscoveryPath(controlDir), 'x'.repeat(65 * 1024), 'utf8')
    expect(await readManagerDiscovery(controlDir)).toBeNull()
    expect(await readManagerHandoffDiscovery(controlDir)).toBeNull()
  })

  it('fails closed in strict replacement probes when discovery exists but is invalid', async () => {
    const controlDir = await root()
    await writeFile(managerDiscoveryPath(controlDir), '{broken', 'utf8')

    await expect(readManagerHandoffDiscoveryStrict(controlDir)).rejects.toThrow(
      /invalid Kun Service Manager discovery/u
    )
    await rm(managerDiscoveryPath(controlDir))
    await expect(readManagerHandoffDiscoveryStrict(controlDir)).resolves.toBeNull()
  })

  it('does not let an old manager remove a replacement record', async () => {
    const controlDir = await root()
    await publishManagerDiscovery(controlDir, { ...input(), instanceId: 'manager-old' })
    await publishManagerDiscovery(controlDir, { ...input(), instanceId: 'manager-new' })
    expect(await removeManagerDiscovery(controlDir, 'manager-old')).toBe(false)
    expect(await removeManagerDiscovery(controlDir, 'manager-new')).toBe(true)
  })

  it('serializes manager startup elections', async () => {
    const controlDir = await root()
    let active = 0
    let peak = 0
    await Promise.all(Array.from({ length: 4 }, () => withManagerStartLock(controlDir, async () => {
      active += 1
      peak = Math.max(peak, active)
      await new Promise((resolve) => setTimeout(resolve, 10))
      active -= 1
    })))
    expect(peak).toBe(1)
  })
})
