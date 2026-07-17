import { EventEmitter } from 'node:events'
import { describe, expect, it, vi } from 'vitest'
import { LocalCollaborationServer } from './local-collaboration-server'

describe('LocalCollaborationServer', () => {
  it('initializes once, starts hidden, waits for TLS health and stops its process', async () => {
    const process = new FakeProcess()
    const run = vi.fn(async (_binaryPath: string, _args: string[]) => ({
      stdout: 'serverInstanceId=server-1\noperatorEnrollmentToken=token-1\n'
    }))
    const spawn = vi.fn((_binaryPath: string, _args: string[], _options: { windowsHide: boolean; stdio: 'ignore' }) => process)
    const waitUntilReady = vi.fn(async () => undefined)
    let initialized = false
    const server = new LocalCollaborationServer({
      binaryPath: 'C:\\Kun\\kun-collab-server.exe', dataDir: 'C:\\Kun\\collaboration-server',
      isInitialized: async () => initialized,
      run: async (...args) => { const result = await run(...args); initialized = true; return result },
      spawn, waitUntilReady
    })

    await expect(server.start()).resolves.toMatchObject({
      state: 'running', serverUrl: 'https://127.0.0.1:19443', enrollmentToken: 'token-1'
    })
    await expect(server.start()).resolves.toMatchObject({ state: 'running' })
    expect(run).toHaveBeenCalledTimes(1)
    expect(spawn).toHaveBeenCalledWith(
      'C:\\Kun\\kun-collab-server.exe',
      ['serve', '--data-dir', 'C:\\Kun\\collaboration-server', '--listen', '127.0.0.1:19443'],
      expect.objectContaining({ windowsHide: true })
    )
    expect(waitUntilReady).toHaveBeenCalledWith('https://127.0.0.1:19443')

    await server.stop()
    expect(process.kill).toHaveBeenCalled()
    expect(server.status()).toMatchObject({ state: 'stopped' })
  })
})

class FakeProcess extends EventEmitter {
  exitCode: number | null = null
  killed = false
  kill = vi.fn(() => {
    this.killed = true
    this.exitCode = 0
    this.emit('exit', 0)
    return true
  })
}
