import { describe, expect, it, vi } from 'vitest'
import { RemoteTargetRegistry } from './remote-target-registry.js'
import type { ThreadRemoteTarget } from '../contracts/threads.js'
import type { SshChildProcess } from './ssh-executor.js'

const binding: ThreadRemoteTarget = {
  kind: 'ssh',
  alias: 'prod',
  remoteDir: '/srv/api',
  runMode: 'develop',
  production: false,
  protectedPaths: []
}

function child(): SshChildProcess {
  return {
    stdout: { on: () => undefined },
    stderr: { on: () => undefined },
    stdin: { end: () => undefined },
    on: (event: string, listener: (...args: unknown[]) => void) => { if (event === 'close') setTimeout(() => listener(0, null), 0) },
    kill: vi.fn()
  } as unknown as SshChildProcess
}

describe('RemoteTargetRegistry', () => {
  it('primes a remote thread and resolves a handle synchronously', async () => {
    const registry = new RemoteTargetRegistry({
      loadBinding: async () => binding,
      handleOptions: { spawn: () => child() }
    })
    expect(registry.resolve('t1')).toBeUndefined()
    await registry.prime('t1')
    const handle = registry.resolve('t1')
    expect(handle?.runMode).toBe('develop')
    expect(handle?.target.kind).toBe('ssh')
  })

  it('is a no-op for a local thread', async () => {
    const registry = new RemoteTargetRegistry({ loadBinding: async () => null })
    await registry.prime('local')
    expect(registry.resolve('local')).toBeUndefined()
  })
})
