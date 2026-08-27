import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import type { RuntimeDiscoveryRecord } from '../server/runtime-discovery.js'
import { buildRuntimeCapabilityManifest } from '../contracts/capabilities.js'
import { modelCapabilitiesForModel } from '../loop/model-context-profile.js'
import {
  ensureSharedRuntime,
  inspectSharedRuntime,
  probeRuntimeDiscovery,
  resolveSharedRuntime,
  runRuntimeCommand,
  stopSharedRuntime
} from './shared-runtime.js'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { acquireRuntimeDataDirMigrationLock } from '../server/runtime-data-dir-migration-lock.js'

function record(overrides: Partial<RuntimeDiscoveryRecord> = {}): RuntimeDiscoveryRecord {
  return {
    version: 2,
    instanceId: 'runtime-a',
    pid: process.pid,
    startedAt: '2026-07-22T00:00:00.000Z',
    host: '127.0.0.1',
    port: 18899,
    baseUrl: 'http://127.0.0.1:18899',
    runtimeToken: 'secret',
    insecure: false,
    serviceVersion: '0.1.0',
    launchMode: 'shared',
    ...overrides
  }
}

function managerConnection(dataDir: string): ServiceManagerConnection {
  return {
    discovery: {
      version: 1,
      protocolVersion: 3,
      instanceId: 'manager-a',
      pid: process.pid,
      startedAt: '2026-07-22T00:00:00.000Z',
      host: '127.0.0.1',
      port: 18700,
      baseUrl: 'http://127.0.0.1:18700',
      managerToken: 'manager-secret',
      serviceVersion: '0.1.0',
      dataDir,
      settingsPath: join(dataDir, 'kun-settings.json')
    }
  }
}

describe('shared runtime discovery validation', () => {
  it('does not recreate a missing migration target or its logs while launch is fenced', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-migration-'))
    const dataDir = join(root, 'missing', 'data')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir)
    try {
      await expect(ensureSharedRuntime({
        dataDir,
        controlDir: join(root, 'control'),
        fetch: (async () => new Response('', { status: 404 })) as typeof fetch,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })).rejects.toThrow(/migration is active/)
      await expect(stat(dataDir)).rejects.toMatchObject({ code: 'ENOENT' })
      await expect(stat(join(dataDir, 'logs'))).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await migration.release()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('preserves stale production discovery while migration owns the data directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-stop-migration-'))
    const discoveryPath = join(dataDir, 'runtime.json')
    const stale = record({ pid: 2_147_483_647 })
    await writeFile(discoveryPath, `${JSON.stringify(stale, null, 2)}\n`, 'utf8')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir)
    try {
      await expect(stopSharedRuntime(dataDir)).rejects.toThrow(/migration is active/)
      expect(JSON.parse(await readFile(discoveryPath, 'utf8'))).toMatchObject({
        instanceId: stale.instanceId,
        pid: stale.pid
      })
    } finally {
      await migration.release()
    }

    try {
      await expect(stopSharedRuntime(dataDir)).resolves.toBe(false)
      await expect(readFile(discoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('keeps development control-dir discovery cleanup outside the production migration fence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-dv-stop-'))
    const dataDir = join(root, 'data')
    const controlDir = join(root, 'control')
    await mkdir(dataDir, { recursive: true })
    await mkdir(controlDir, { recursive: true })
    const discoveryPath = join(controlDir, 'runtime.development.json')
    const stale = record({ pid: 2_147_483_647, flavor: 'development' })
    await writeFile(discoveryPath, `${JSON.stringify(stale, null, 2)}\n`, 'utf8')
    const migration = await acquireRuntimeDataDirMigrationLock(dataDir)
    try {
      await expect(stopSharedRuntime(dataDir, fetch, {
        runtimeFlavor: 'development',
        controlDir
      })).resolves.toBe(false)
      await expect(readFile(discoveryPath, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      await migration.release()
      await rm(root, { recursive: true, force: true })
    }
  })

  it('uses the GUI-configured data dir by default while preserving explicit precedence', async () => {
    const root = await mkdtemp(join(tmpdir(), 'kun-runtime-gui-data-dir-'))
    const settingsPath = join(root, 'gui', 'kun-settings.json')
    const guiDataDir = join(root, 'legacy-gui-data')
    const explicitDataDir = join(root, 'explicit-data')
    await mkdir(join(root, 'gui'), { recursive: true })
    await writeFile(settingsPath, JSON.stringify({
      provider: { providers: [] },
      agents: { kun: { dataDir: guiDataDir, model: '', providerId: '' } }
    }), 'utf8')
    try {
      let stdout = ''
      expect(await runRuntimeCommand(['status'], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: { KUN_GUI_SETTINGS_PATH: settingsPath },
        fetch: (async () => new Response('', { status: 404 })) as typeof fetch
      })).toBe(0)
      expect(stdout).toContain(`Data directory: ${guiDataDir}`)

      stdout = ''
      expect(await runRuntimeCommand(['status', '--data-dir', explicitDataDir], {
        stdout: { write: (chunk) => { stdout += chunk } },
        stderr: { write: () => undefined },
        env: { KUN_GUI_SETTINGS_PATH: settingsPath },
        fetch: (async () => new Response('', { status: 404 })) as typeof fetch
      })).toBe(0)
      expect(stdout).toContain(`Data directory: ${explicitDataDir}`)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it('rejects non-loopback and URL/port mismatches before sending a token', async () => {
    const fetchImpl = vi.fn()
    await expect(probeRuntimeDiscovery(record({
      host: 'example.com',
      baseUrl: 'http://example.com:18899'
    }), fetchImpl as unknown as typeof fetch)).resolves.toBeNull()
    await expect(probeRuntimeDiscovery(record({
      baseUrl: 'http://127.0.0.1:18900'
    }), fetchImpl as unknown as typeof fetch)).resolves.toBeNull()
    expect(fetchImpl).not.toHaveBeenCalled()
  })

  it('preserves discovery when its live process temporarily misses HTTP probes', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-unresponsive-'))
    const discovery = record({ buildId: 'a'.repeat(64) })
    const fetchImpl = vi.fn(async () => new Response('', { status: 503 })) as unknown as typeof fetch
    try {
      await writeFile(
        join(dataDir, 'runtime.json'),
        `${JSON.stringify(discovery, null, 2)}\n`,
        'utf8'
      )

      await expect(ensureSharedRuntime({
        dataDir,
        expectedBuildId: discovery.buildId,
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })).rejects.toThrow('preserving its discovery record')
      await expect(stopSharedRuntime(dataDir, fetchImpl)).rejects.toThrow(
        'discovery record was preserved'
      )
      expect(JSON.parse(await readFile(join(dataDir, 'runtime.json'), 'utf8'))).toMatchObject({
        instanceId: discovery.instanceId,
        pid: discovery.pid
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('gracefully stops an exact owner whose full info schema is incompatible', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-old-info-'))
    const discovery = record({ pid: 2_147_483_640, buildId: 'a'.repeat(64) })
    const originalKill = process.kill.bind(process)
    let alive = true
    const killSpy = vi.spyOn(process, 'kill').mockImplementation(((pid, signal) => {
      if (pid !== discovery.pid) return originalKill(pid, signal)
      if (alive) return true
      throw Object.assign(new Error('process is gone'), { code: 'ESRCH' })
    }) as typeof process.kill)
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        alive = false
        return Response.json({ accepted: true, instanceId: discovery.instanceId })
      }
      // Identity is correct, but this intentionally predates the current
      // RuntimeInfoResponse capability schema.
      return Response.json({
        instanceId: discovery.instanceId,
        pid: discovery.pid,
        startedAt: discovery.startedAt
      })
    })
    const fetchImpl = fetchMock as unknown as typeof fetch
    try {
      await writeFile(
        join(dataDir, 'runtime.json'),
        `${JSON.stringify(discovery, null, 2)}\n`,
        'utf8'
      )

      await expect(stopSharedRuntime(dataDir, fetchImpl)).resolves.toBe(true)
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true)
      await expect(readFile(join(dataDir, 'runtime.json'), 'utf8'))
        .rejects.toMatchObject({ code: 'ENOENT' })
    } finally {
      killSpy.mockRestore()
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('reuses a healthy manager owner when filesystem discovery is missing', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-manager-runtime-owner-'))
    const buildId = 'a'.repeat(64)
    const managed = record({ buildId, flavor: 'production' })
    const manager = managerConnection(dataDir)
    const capabilities = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    })
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const target = String(url)
      if (target === `${manager.discovery.baseUrl}/v1/runtimes/production`) {
        return Response.json({ registration: {
          flavor: 'production',
          instanceId: managed.instanceId,
          pid: managed.pid,
          startedAt: managed.startedAt,
          host: managed.host,
          port: managed.port,
          baseUrl: managed.baseUrl,
          runtimeToken: managed.runtimeToken,
          buildId
        } })
      }
      if (target === `${managed.baseUrl}/v1/runtime/info`) {
        return Response.json({
          instanceId: managed.instanceId,
          serviceVersion: managed.serviceVersion,
          buildId,
          launchMode: 'shared',
          host: managed.host,
          port: managed.port,
          dataDir,
          model: 'fixture',
          approvalPolicy: 'on-request',
          sandboxMode: 'workspace-write',
          insecure: false,
          startedAt: managed.startedAt,
          pid: managed.pid,
          capabilities
        })
      }
      return new Response('', { status: 404 })
    })
    try {
      const connection = await ensureSharedRuntime({
        dataDir,
        manager,
        expectedBuildId: buildId,
        fetch: fetchMock as unknown as typeof fetch,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })

      expect(connection.discovery).toMatchObject({
        instanceId: managed.instanceId,
        pid: managed.pid,
        buildId
      })
      expect(fetchMock).toHaveBeenCalledTimes(2)
      await expect(readFile(join(dataDir, 'runtime.json'), 'utf8')).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('removes an exact dead manager registration before discovery fallback', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-manager-runtime-stale-'))
    const manager = managerConnection(dataDir)
    const deadPid = 2_147_483_647
    const fetchMock = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const target = String(url)
      if (target === `${manager.discovery.baseUrl}/v1/runtimes/production`) {
        return Response.json({ registration: {
          flavor: 'production',
          instanceId: 'runtime-dead',
          pid: deadPid,
          startedAt: '2026-07-22T00:00:00.000Z',
          host: '127.0.0.1',
          port: 18899,
          baseUrl: 'http://127.0.0.1:18899',
          runtimeToken: 'secret'
        } })
      }
      if (
        target === `${manager.discovery.baseUrl}/v1/runtimes/production/runtime-dead` &&
        init?.method === 'DELETE'
      ) return Response.json({ removed: true })
      return new Response('', { status: 404 })
    })
    try {
      await expect(inspectSharedRuntime(
        dataDir,
        fetchMock as unknown as typeof fetch,
        { runtimeFlavor: 'production', manager }
      )).resolves.toBeNull()
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('defers a normal build handover but not an explicit replacement while the runtime has an active turn', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-active-build-'))
    const discovery = record({ buildId: 'a'.repeat(64) })
    const capabilities = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    })
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') {
        return new Response('', { status: 500 })
      }
      return Response.json({
        instanceId: discovery.instanceId,
        serviceVersion: discovery.serviceVersion,
        buildId: discovery.buildId,
        launchMode: discovery.launchMode,
        host: discovery.host,
        port: discovery.port,
        dataDir,
        model: 'fixture',
        approvalPolicy: 'on-request',
        sandboxMode: 'workspace-write',
        insecure: false,
        startedAt: discovery.startedAt,
        pid: discovery.pid,
        capabilities
      }, {
        headers: { 'x-kun-active-turn-count': '1' }
      })
    })
    const fetchImpl = fetchMock as unknown as typeof fetch
    try {
      await writeFile(
        join(dataDir, 'runtime.json'),
        `${JSON.stringify(discovery, null, 2)}\n`,
        'utf8'
      )

      const resolved = await ensureSharedRuntime({
        dataDir,
        expectedBuildId: 'b'.repeat(64),
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })

      expect(resolved.discovery.instanceId).toBe(discovery.instanceId)
      expect(resolved.activeTurnCount).toBe(1)
      expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(false)

      await expect(ensureSharedRuntime({
        dataDir,
        expectedBuildId: 'b'.repeat(64),
        forceReplace: true,
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })).rejects.toThrow('runtime shutdown failed with HTTP 500')
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })

  it('elects one GUI/TUI-independent custom launch and shuts it down explicitly', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-custom-shared-runtime-'))
    const capabilities = JSON.stringify(buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    }))
    const fixture = String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const dataDir = process.argv[1];
const startedAt = new Date().toISOString();
const instanceId = crypto.randomUUID();
const capabilities = ${capabilities};
const buildId = process.env.KUN_RUNTIME_BUILD_ID;
const server = http.createServer((req, res) => {
  if (req.url === '/v1/runtime/info') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ instanceId, serviceVersion: '0.1.0', buildId, launchMode: 'shared', host: '127.0.0.1', port: server.address().port, dataDir, model: 'fixture', approvalPolicy: 'on-request', sandboxMode: 'workspace-write', insecure: false, startedAt, pid: process.pid, capabilities }));
    return;
  }
  if (req.url === '/v1/runtime/shutdown' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true }));
    try { fs.unlinkSync(path.join(dataDir, 'runtime.json')); } catch {}
    setTimeout(() => { server.close(); process.exit(0); }, 250);
    return;
  }
  if (req.url === '/crash' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true }));
    setTimeout(() => process.exit(23), 10);
    return;
  }
  res.statusCode = 404; res.end();
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const record = { version: 2, instanceId, pid: process.pid, startedAt, host: '127.0.0.1', port, baseUrl: 'http://127.0.0.1:' + port, runtimeToken: process.env.KUN_RUNTIME_TOKEN, insecure: false, serviceVersion: '0.1.0', buildId, launchMode: process.env.KUN_RUNTIME_LAUNCH_MODE, logPath: process.env.KUN_RUNTIME_LOG_PATH };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify(record), { mode: 0o600 });
});
`
    try {
      const buildId = 'a'.repeat(64)
      const launch = {
        dataDir,
        expectedBuildId: buildId,
        launch: { command: process.execPath, args: ['-e', fixture, dataDir], runAsNode: false }
      }
      const [connection, concurrentClient] = await Promise.all([
        ensureSharedRuntime(launch),
        ensureSharedRuntime(launch)
      ])
      expect(connection.discovery.launchMode).toBe('shared')
      expect(connection.discovery.buildId).toBe(buildId)
      expect(concurrentClient.discovery.instanceId).toBe(connection.discovery.instanceId)
      expect(concurrentClient.discovery.pid).toBe(connection.discovery.pid)
      expect(connection.discovery.logPath).toContain('runtime.log')
      const config = JSON.parse(await readFile(join(dataDir, 'config.json'), 'utf8')) as {
        serve: {
          approvalPolicy: string
          sandboxMode: string
          approvalReviewer: string
        }
        capabilities: Record<string, { enabled: boolean }>
      }
      expect(config.serve).toEqual({
        approvalPolicy: 'auto',
        sandboxMode: 'danger-full-access',
        approvalReviewer: 'user'
      })
      expect(config.capabilities).toMatchObject({
        skills: { enabled: true },
        attachments: { enabled: true },
        memory: { enabled: true },
        subagents: { enabled: true }
      })
      await fetch(`${connection.discovery.baseUrl}/crash`, { method: 'POST' })
      for (let attempt = 0; attempt < 100; attempt += 1) {
        if (!await resolveSharedRuntime(dataDir)) break
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
      const recovered = await ensureSharedRuntime(launch)
      expect(recovered.discovery.instanceId).not.toBe(connection.discovery.instanceId)
      expect(recovered.discovery.pid).not.toBe(connection.discovery.pid)
      const stopStartedAt = Date.now()
      expect(await stopSharedRuntime(dataDir)).toBe(true)
      expect(Date.now() - stopStartedAt).toBeGreaterThanOrEqual(150)
    } finally {
      await stopSharedRuntime(dataDir).catch(() => undefined)
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 15_000)

  it('replaces a healthy identity-less runtime once and preserves the data directory', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-build-replace-'))
    const sentinelPath = join(dataDir, 'persisted-thread-sentinel')
    const capabilities = JSON.stringify(buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    }))
    const fixture = String.raw`
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const crypto = require('node:crypto');
const dataDir = process.argv[1];
const startedAt = new Date().toISOString();
const instanceId = crypto.randomUUID();
const buildId = process.env.KUN_RUNTIME_BUILD_ID;
const capabilities = ${capabilities};
const server = http.createServer((req, res) => {
  if (req.url === '/v1/runtime/info') {
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ instanceId, serviceVersion: '0.1.0', buildId, launchMode: 'shared', host: '127.0.0.1', port: server.address().port, dataDir, model: 'fixture', approvalPolicy: 'on-request', sandboxMode: 'workspace-write', insecure: false, startedAt, pid: process.pid, capabilities }));
    return;
  }
  if (req.url === '/v1/runtime/shutdown' && req.method === 'POST') {
    res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ ok: true }));
    setTimeout(() => server.close(() => { try { fs.unlinkSync(path.join(dataDir, 'runtime.json')); } catch {} process.exit(0); }), 10);
    return;
  }
  res.statusCode = 404; res.end();
});
server.listen(0, '127.0.0.1', () => {
  const port = server.address().port;
  const record = { version: 2, instanceId, pid: process.pid, startedAt, host: '127.0.0.1', port, baseUrl: 'http://127.0.0.1:' + port, runtimeToken: process.env.KUN_RUNTIME_TOKEN, insecure: false, serviceVersion: '0.1.0', buildId, launchMode: process.env.KUN_RUNTIME_LAUNCH_MODE, logPath: process.env.KUN_RUNTIME_LOG_PATH };
  fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  fs.writeFileSync(path.join(dataDir, 'runtime.json'), JSON.stringify(record), { mode: 0o600 });
});
`
    const launch = (expectedBuildId?: string) => ({
      dataDir,
      ...(expectedBuildId ? { expectedBuildId } : {}),
      launch: { command: process.execPath, args: ['-e', fixture, dataDir], runAsNode: false }
    })
    try {
      await writeFile(sentinelPath, 'durable-state', 'utf8')
      const first = await ensureSharedRuntime(launch())
      expect(first.discovery.buildId).toBeUndefined()
      const [replacement, concurrent] = await Promise.all([
        ensureSharedRuntime(launch('b'.repeat(64))),
        ensureSharedRuntime(launch('b'.repeat(64)))
      ])

      expect(replacement.discovery.instanceId).not.toBe(first.discovery.instanceId)
      expect(replacement.discovery.buildId).toBe('b'.repeat(64))
      expect(concurrent.discovery.instanceId).toBe(replacement.discovery.instanceId)
      expect(await readFile(sentinelPath, 'utf8')).toBe('durable-state')
    } finally {
      await stopSharedRuntime(dataDir).catch(() => undefined)
      await rm(dataDir, { recursive: true, force: true })
    }
  }, 20_000)

  it('fails closed when a mismatched runtime refuses authenticated shutdown', async () => {
    const dataDir = await mkdtemp(join(tmpdir(), 'kun-shared-runtime-build-stop-failure-'))
    const oldBuildId = 'a'.repeat(64)
    const nextBuildId = 'b'.repeat(64)
    const discovery = record({ buildId: oldBuildId })
    const capabilities = buildRuntimeCapabilityManifest({
      model: modelCapabilitiesForModel('fixture')
    })
    const info = {
      instanceId: discovery.instanceId,
      serviceVersion: discovery.serviceVersion,
      buildId: oldBuildId,
      launchMode: discovery.launchMode,
      host: discovery.host,
      port: discovery.port,
      dataDir,
      model: 'fixture',
      approvalPolicy: 'on-request',
      sandboxMode: 'workspace-write',
      insecure: false,
      startedAt: discovery.startedAt,
      pid: discovery.pid,
      capabilities
    }
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      if (init?.method === 'POST') return new Response('', { status: 503 })
      return Response.json(info)
    })
    const fetchImpl = fetchMock as unknown as typeof fetch

    try {
      await writeFile(
        join(dataDir, 'runtime.json'),
        `${JSON.stringify(discovery, null, 2)}\n`,
        'utf8'
      )

      await expect(ensureSharedRuntime({
        dataDir,
        expectedBuildId: nextBuildId,
        fetch: fetchImpl,
        launch: {
          command: process.execPath,
          args: ['-e', 'process.exit(99)'],
          runAsNode: false
        }
      })).rejects.toThrow('runtime shutdown failed with HTTP 503')
      expect(fetchMock.mock.calls.filter(([, init]) => init?.method === 'POST')).toHaveLength(1)
      expect(JSON.parse(await readFile(join(dataDir, 'runtime.json'), 'utf8'))).toMatchObject({
        instanceId: discovery.instanceId,
        buildId: oldBuildId
      })
    } finally {
      await rm(dataDir, { recursive: true, force: true })
    }
  })
})
