import { build } from 'esbuild'
import { fork, type ChildProcess } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { ServiceManagerState } from '../manager/service-manager-state.js'
import { startIsolatedRuntimeManagerHeartbeat } from './runtime-isolated-heartbeat.js'

let root: string, workerUrl: URL, childPath: string
beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kun-isolated-heartbeat-'))
  await symlink(resolve(import.meta.dirname, '../../node_modules'), join(root, 'node_modules'),
    process.platform === 'win32' ? 'junction' : 'dir')
  const workerPath = join(root, 'heartbeat-worker.mjs')
  const clientPath = join(root, 'heartbeat-client.mjs')
  for (const [entry, outfile] of [
    ['runtime-heartbeat-worker.ts', workerPath], ['runtime-isolated-heartbeat.ts', clientPath]
  ]) {
    await build({ entryPoints: [resolve(import.meta.dirname, entry!)], outfile,
      bundle: true, packages: 'external', platform: 'node', format: 'esm', target: 'node22', logLevel: 'silent' })
  }
  workerUrl = pathToFileURL(workerPath)
  childPath = join(root, 'blocked-runtime.mjs')
  await writeFile(childPath, `
    import { startIsolatedRuntimeManagerHeartbeat } from ${JSON.stringify(pathToFileURL(clientPath).href)};
    process.once('message', async ({manager, registration}) => {
      const keepAlive = setInterval(() => {}, 1000);
      let accepted;
      const first = new Promise(resolve => { accepted = resolve; });
      const handle = await startIsolatedRuntimeManagerHeartbeat({
        manager, registration, intervalMs: 1000,
        onAuthorityChange: state => { if (state === 'holder') accepted(); },
        onOwnershipLost: reason => process.send({kind: 'lost', reason}), log: () => {}
      }, {workerUrl: new URL(${JSON.stringify(workerUrl.href)})});
      await first;
      process.send({kind: 'blocking'});
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 22000);
      process.send({kind: 'resumed'});
      await handle.stop();
      clearInterval(keepAlive);
      process.disconnect();
    });
  `)
}, 30_000)
afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }) })

const registration = () => ({
  flavor: 'production' as const, instanceId: 'runtime', pid: process.pid, startedAt: new Date().toISOString(),
  host: '127.0.0.1', port: 18899, baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'test-runtime-token'
})

async function managerServer(heartbeat: () => boolean) {
  let calls = 0
  const server = createServer((request, response) => {
    request.resume()
    calls += 1
    const accepted = heartbeat()
    response.writeHead(accepted ? 200 : 409, { 'content-type': 'application/json' })
    response.end(JSON.stringify(accepted ? { accepted } : { code: 'runtime_instance_changed' }))
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('No Manager address')
  const manager = { discovery: {
    instanceId: 'manager', baseUrl: `http://127.0.0.1:${address.port}`, managerToken: 'test-token',
    appOwner: { ownerSessionId: 'app', ownerKind: 'gui', ownerPid: process.pid,
      ownerStartedAt: new Date().toISOString(), ownerProcessIdentity: 'test', generation: 1 }
  } } as ServiceManagerConnection
  return { manager, calls: () => calls, close: async () => {
    server.closeAllConnections()
    await new Promise<void>(resolve => server.close(() => resolve()))
  } }
}

describe('isolated Runtime heartbeat', () => {
  it('parks authority and falls back to the same Manager if the worker exits', async () => {
    const exitPath = join(root, 'exiting-worker.mjs')
    await writeFile(exitPath, `
      import { parentPort } from 'node:worker_threads';
      parentPort.postMessage({kind: 'ready'});
      setTimeout(() => process.exit(1), 50);
    `)
    const server = await managerServer(() => true)
    const authority = vi.fn(), lost = vi.fn()
    const handle = await startIsolatedRuntimeManagerHeartbeat({
      manager: server.manager, registration: registration(), intervalMs: 20,
      onAuthorityChange: authority, onOwnershipLost: lost, log: () => {}
    }, { workerUrl: pathToFileURL(exitPath) })
    try {
      await vi.waitFor(() => expect(authority).toHaveBeenCalledWith('grace'))
      await vi.waitFor(() => expect(authority).toHaveBeenCalledWith('holder'))
      expect(lost).not.toHaveBeenCalled()
    } finally {
      await handle.stop()
      await server.close()
    }
  })

  it('keeps twelve leased turns owned through a real 22-second main-loop stall', async () => {
    const state = new ServiceManagerState()
    state.register(registration())
    const leases = Array.from({ length: 12 }, (_, index) => state.acquireLease({
      threadId: `thread-${index}`, turnId: `turn-${index}`, ownerFlavor: 'production', ownerInstanceId: 'runtime'
    }))
    let expired = 0, rejected = 0
    const reconcile = setInterval(() => { expired += state.expireStale().length }, 500)
    const server = await managerServer(() => {
      const accepted = state.heartbeat('production', 'runtime')
      if (!accepted) rejected += 1
      return accepted
    })
    let child: ChildProcess | undefined
    try {
      child = fork(childPath, [], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] })
      let stderr = ''
      child.stderr!.on('data', chunk => { stderr += String(chunk) })
      const messages: string[] = []
      child.on('message', (message: { kind: string }) => messages.push(message.kind))
      const exited = new Promise<number | null>((resolve, reject) => {
        child!.once('error', reject)
        child!.once('exit', resolve)
      })
      child.send({ manager: server.manager, registration: registration() })
      expect(await exited, stderr).toBe(0)
      expect(messages).toEqual(['blocking', 'resumed'])
      expect(server.calls()).toBeGreaterThan(15)
      expect(rejected).toBe(0)
      expect(expired).toBe(0)
      for (const lease of leases) expect(state.lease(lease.threadId)?.fencingToken).toBe(lease.fencingToken)
    } finally {
      clearInterval(reconcile)
      child?.kill()
      await server.close()
    }
  }, 40_000)

  it('stops renewing when main progress disappears and never elects or replaces the Manager', async () => {
    const server = await managerServer(() => true)
    const authority = vi.fn(), lost = vi.fn()
    const handle = await startIsolatedRuntimeManagerHeartbeat({
      manager: server.manager, registration: registration(), intervalMs: 20,
      onAuthorityChange: authority, onOwnershipLost: lost, log: () => {}
    }, { workerUrl, progressTimeoutMs: 200, progressIntervalMs: 10_000 })
    try {
      await vi.waitFor(() => expect(authority).toHaveBeenCalledWith('holder'))
      await vi.waitFor(() => expect(authority).toHaveBeenCalledWith('grace'))
      const calls = server.calls()
      await new Promise(resolve => setTimeout(resolve, 200))
      expect(server.calls()).toBe(calls)
      expect(lost).not.toHaveBeenCalled()
    } finally {
      await handle.stop()
      await server.close()
    }
  })

  it('reports an explicit slot rejection once and stops all requests after shutdown', async () => {
    let accept = true
    const server = await managerServer(() => accept)
    const lost = vi.fn()
    const handle = await startIsolatedRuntimeManagerHeartbeat({
      manager: server.manager, registration: registration(), intervalMs: 20,
      onAuthorityChange: () => {}, onOwnershipLost: lost, log: () => {}
    }, { workerUrl })
    try {
      await vi.waitFor(() => expect(server.calls()).toBeGreaterThan(0))
      accept = false
      await vi.waitFor(() => expect(lost).toHaveBeenCalledOnce())
      expect(lost).toHaveBeenCalledWith(expect.objectContaining({ source: 'heartbeat_rejected' }))
      await handle.stop()
      const calls = server.calls()
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(server.calls()).toBe(calls)
    } finally {
      await handle.stop()
      await server.close()
    }
  })
})
