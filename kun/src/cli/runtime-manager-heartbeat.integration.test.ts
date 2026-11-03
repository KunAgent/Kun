import { createServer } from 'node:http'
import { describe, expect, it, vi } from 'vitest'
import type { ServiceManagerConnection } from '../manager/manager-client.js'
import { startRuntimeManagerHeartbeat } from './runtime-manager-heartbeat.js'

describe('Runtime heartbeat over local HTTP', () => {
  it('survives a dropped socket on the same Manager, then shuts down only on a confirmed slot rejection', async () => {
    let requests = 0, rejectOwner = false
    const requestPaths: string[] = []
    const server = createServer((request, response) => {
      requests += 1
      requestPaths.push(request.url ?? '')
      if (requests === 1) {
        request.socket.destroy()
        return
      }
      response.writeHead(rejectOwner ? 409 : 200, { 'content-type': 'application/json' })
      response.end(JSON.stringify(rejectOwner ? { code: 'runtime_instance_changed' } : { accepted: true }))
    })
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string') throw new Error('No test Manager address')
    const manager = { discovery: {
      instanceId: 'test-manager', baseUrl: `http://127.0.0.1:${address.port}`, managerToken: 'test-token',
      appOwner: { ownerSessionId: 'test-app', ownerKind: 'gui', ownerPid: process.pid,
        ownerStartedAt: new Date().toISOString(), ownerProcessIdentity: 'test', generation: 1 }
    } } as ServiceManagerConnection
    const onAuthorityChange = vi.fn(), onOwnershipLost = vi.fn(), recoverUnownedManager = vi.fn()
    const heartbeat = startRuntimeManagerHeartbeat({
      manager, intervalMs: 20, onAuthorityChange, onOwnershipLost, recoverUnownedManager, log: () => {},
      registration: {
        flavor: 'production', instanceId: 'test-runtime', pid: process.pid, startedAt: new Date().toISOString(),
        host: '127.0.0.1', port: 18899, baseUrl: 'http://127.0.0.1:18899', runtimeToken: 'test-runtime-token'
      }
    })
    try {
      await vi.waitFor(() => expect(onAuthorityChange).toHaveBeenCalledWith('holder'), { timeout: 5_000 })
      expect(onAuthorityChange).toHaveBeenCalledWith('grace')
      expect(onOwnershipLost).not.toHaveBeenCalled()
      expect(recoverUnownedManager).not.toHaveBeenCalled()
      rejectOwner = true
      await vi.waitFor(() => expect(onOwnershipLost).toHaveBeenCalledOnce(), { timeout: 5_000 })
      expect(onOwnershipLost).toHaveBeenCalledWith({
        code: 'manager_runtime_ownership_lost', source: 'heartbeat_rejected', managerInstanceId: 'test-manager'
      })
      expect(onAuthorityChange).toHaveBeenLastCalledWith('lost')
      expect(requestPaths.every(path => path === '/v1/runtimes/production/heartbeat')).toBe(true)
    } finally {
      heartbeat.stop()
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    }
  }, 15_000)
})
