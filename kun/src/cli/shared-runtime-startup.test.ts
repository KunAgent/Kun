import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import type { RuntimeRegistration } from '../contracts/runtime-flavor.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import type { RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { ensureSharedRuntime } from './shared-runtime.js'

const buildId = 'a'.repeat(64)
const capabilities = buildRuntimeCapabilityManifest({
  model: modelCapabilitiesForModel('fixture')
})

describe('shared runtime startup ownership', () => {
  it('does not treat first Manager registration as ready and terminates the timed-out candidate', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-shared-starting-owner-'))
    const dataDir = join(root, 'data')
    const pidPath = join(root, 'candidate.pid')
    const manager = managerConnection(dataDir)
    const startedAt = '2026-09-02T00:00:00.000Z'
    let candidatePid = 0
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${manager.discovery.baseUrl}/v1/runtimes/production`) {
        candidatePid = await readPid(pidPath)
        return Response.json({
          registration: candidatePid > 0
            ? registration(candidatePid, startedAt)
            : null
        })
      }
      if (target === 'http://127.0.0.1:18899/v1/runtime/info') {
        return Response.json(runtimeInfo(candidatePid, startedAt, dataDir))
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    const fixture = String.raw`
const fs = require('node:fs');
fs.writeFileSync(process.argv[1], String(process.pid));
setInterval(() => {}, 1000);
`
    try {
      await expect(ensureSharedRuntime({
        dataDir,
        manager,
        expectedBuildId: buildId,
        timeoutMs: 250,
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', fixture, pidPath],
          runAsNode: false
        }
      })).rejects.toThrow(/did not become ready/)

      candidatePid ||= await readPid(pidPath)
      expect(candidatePid).toBeGreaterThan(0)
      expect(await waitForProcessExit(candidatePid)).toBe(true)
    } finally {
      await killIfAlive(candidatePid)
      await rm(root, { recursive: true, force: true })
    }
  })

  it('waits for a compatible starting winner after its own candidate exits early', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-shared-startup-winner-'))
    const dataDir = join(root, 'data')
    const candidatePidPath = join(root, 'candidate.pid')
    const manager = managerConnection(dataDir)
    const winnerPid = process.pid
    const startedAt = '2026-09-02T00:01:00.000Z'
    const winner = registration(winnerPid, startedAt)
    let managerReads = 0
    let candidatePid = 0
    const fetchImpl = (async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${manager.discovery.baseUrl}/v1/runtimes/production`) {
        managerReads += 1
        return Response.json({ registration: managerReads > 2 ? winner : null })
      }
      if (target === `${winner.baseUrl}/v1/runtime/info`) {
        return Response.json(runtimeInfo(winnerPid, startedAt, dataDir))
      }
      return new Response('', { status: 404 })
    }) as typeof fetch
    const fixture = String.raw`
const fs = require('node:fs');
fs.writeFileSync(process.argv[1], String(process.pid));
setTimeout(() => process.exit(17), 60);
`
    const publishWinner = setTimeout(() => {
      void writeFile(
        join(dataDir, 'runtime.json'),
        `${JSON.stringify(discovery(winner, dataDir), null, 2)}\n`,
        'utf8'
      )
    }, 180)
    try {
      const connection = await ensureSharedRuntime({
        dataDir,
        manager,
        expectedBuildId: buildId,
        timeoutMs: 1_000,
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', fixture, candidatePidPath],
          runAsNode: false
        }
      })

      candidatePid = await readPid(candidatePidPath)
      expect(connection.discovery.instanceId).toBe(winner.instanceId)
      expect(connection.discovery.pid).toBe(winnerPid)
      expect(await waitForProcessExit(candidatePid)).toBe(true)
    } finally {
      clearTimeout(publishWinner)
      await killIfAlive(candidatePid)
      await rm(root, { recursive: true, force: true })
    }
  })
})

function managerConnection(dataDir: string): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 5,
      instanceId: 'manager-startup-test',
      pid: process.pid,
      startedAt: '2026-09-02T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-secret',
      serviceVersion: '0.3.8',
      buildId,
      dataDir,
      settingsPath: join(dataDir, 'kun-settings.json')
    }
  }
}

function registration(pid: number, startedAt: string): RuntimeRegistration {
  return {
    flavor: 'production',
    instanceId: `runtime-${pid}`,
    pid,
    startedAt,
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'runtime-secret',
    buildId
  }
}

function discovery(owner: RuntimeRegistration, dataDir: string): RuntimeDiscoveryRecord {
  return {
    version: 2,
    instanceId: owner.instanceId,
    pid: owner.pid,
    startedAt: owner.startedAt,
    host: owner.host,
    port: owner.port,
    baseUrl: owner.baseUrl,
    runtimeToken: owner.runtimeToken,
    insecure: false,
    serviceVersion: '0.3.8',
    flavor: owner.flavor,
    buildId: owner.buildId,
    launchMode: 'shared',
    logPath: join(dataDir, 'logs', 'runtime.log')
  }
}

function runtimeInfo(pid: number, startedAt: string, dataDir: string): Record<string, unknown> {
  return {
    instanceId: `runtime-${pid}`,
    serviceVersion: '0.3.8',
    buildId,
    launchMode: 'shared',
    host: '127.0.0.1',
    port: 18899,
    dataDir,
    model: 'fixture',
    approvalPolicy: 'on-request',
    sandboxMode: 'workspace-write',
    insecure: false,
    startedAt,
    pid,
    capabilities
  }
}

async function readPid(path: string): Promise<number> {
  try {
    const value = Number((await readFile(path, 'utf8')).trim())
    return Number.isInteger(value) && value > 0 ? value : 0
  } catch {
    return 0
  }
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!processAlive(pid)) return true
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  return !processAlive(pid)
}

function processAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

async function killIfAlive(pid: number): Promise<void> {
  if (!processAlive(pid) || pid === process.pid) return
  try {
    process.kill(pid, 'SIGKILL')
  } catch {
    return
  }
  await waitForProcessExit(pid)
}
