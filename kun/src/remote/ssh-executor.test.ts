import { describe, expect, it, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { SshExecutor, type SshChildProcess, type SshSpawnFn } from './ssh-executor.js'

/** A scriptable fake `ssh` child process for deterministic executor tests. */
class FakeChild extends EventEmitter implements SshChildProcess {
  stdout = new EventEmitter() as unknown as SshChildProcess['stdout']
  stderr = new EventEmitter() as unknown as SshChildProcess['stderr']
  stdin?: SshChildProcess['stdin']
  killed: NodeJS.Signals | undefined
  kill(signal?: NodeJS.Signals): void {
    this.killed = signal ?? 'SIGTERM'
  }
}

function fakeSpawn(script: (child: FakeChild, command: string, args: readonly string[]) => void): {
  spawn: SshSpawnFn
  calls: { command: string; args: readonly string[] }[]
} {
  const calls: { command: string; args: readonly string[] }[] = []
  const spawn: SshSpawnFn = (command, args) => {
    calls.push({ command, args })
    const child = new FakeChild()
    queueMicrotask(() => script(child, command, args))
    return child
  }
  return { spawn, calls }
}

describe('SshExecutor', () => {
  it('runs ssh with shell:false argv and returns a structured outcome', async () => {
    const { spawn, calls } = fakeSpawn((child) => {
      ;(child.stdout as unknown as EventEmitter).emit('data', 'on branch main\n')
      child.emit('close', 0, null)
    })
    const exec = new SshExecutor({ alias: 'prod', remoteDir: '/srv/api', spawn, nowMs: () => 0 })
    const outcome = await exec.exec('git status')

    expect(calls[0].command).toBe('ssh')
    expect(calls[0].args).toContain('-o')
    expect(calls[0].args).toContain('BatchMode=yes')
    expect(calls[0].args.at(-2)).toBe('prod')
    expect(calls[0].args.at(-1)).toBe("cd -- '/srv/api' && git status")
    expect(outcome).toMatchObject({
      alias: 'prod',
      remoteDir: '/srv/api',
      command: 'git status',
      stdout: 'on branch main\n',
      exitCode: 0,
      timedOut: false
    })
  })

  it('caps stdout to maxOutputBytes to avoid unbounded memory growth', async () => {
    const { spawn } = fakeSpawn((child) => {
      ;(child.stdout as unknown as EventEmitter).emit('data', 'x'.repeat(50))
      ;(child.stdout as unknown as EventEmitter).emit('data', 'y'.repeat(50))
      child.emit('close', 0, null)
    })
    const outcome = await new SshExecutor({ alias: 'prod', spawn, maxOutputBytes: 64 }).exec('cat big.log')
    expect(outcome.stdout.length).toBe(64)
    expect(outcome.truncated).toBe(true)
  })

  it('caps by UTF-8 bytes without cutting a multibyte character', async () => {
    const { spawn } = fakeSpawn((child) => {
      ;(child.stdout as unknown as EventEmitter).emit('data', Buffer.from('中文测试', 'utf8'))
      child.emit('close', 0, null)
    })
    const outcome = await new SshExecutor({ alias: 'prod', spawn, maxOutputBytes: 6 }).exec('cat')
    expect(outcome.stdout).toBe('中文')
    expect(Buffer.byteLength(outcome.stdout, 'utf8')).toBe(6)
    expect(outcome.stdout).not.toContain('�')
  })

  it('captures a non-zero exit code and stderr', async () => {
    const { spawn } = fakeSpawn((child) => {
      ;(child.stderr as unknown as EventEmitter).emit('data', 'fatal: not a repo')
      child.emit('close', 128, null)
    })
    const outcome = await new SshExecutor({ alias: 'prod', spawn }).exec('git status')
    expect(outcome.exitCode).toBe(128)
    expect(outcome.stderr).toBe('fatal: not a repo')
  })

  it('sends an input payload through stdin instead of argv', async () => {
    let input: string | Buffer | undefined
    const calls: { command: string; args: readonly string[] }[] = []
    const spawn: SshSpawnFn = (command, args) => {
      calls.push({ command, args })
      const child = new FakeChild()
      child.stdin = { end: (data?: string | Buffer) => { input = data } }
      queueMicrotask(() => child.emit('close', 0, null))
      return child
    }
    await new SshExecutor({ alias: 'prod', spawn }).exec('cat > file', { input: 'secret-content' })
    expect(input).toBe('secret-content')
    expect(calls[0].args.join(' ')).not.toContain('secret-content')
  })

  it('kills the process and reports timedOut on timeout', async () => {
    let killed = false
    const { spawn } = fakeSpawn((child) => {
      // Never emit close until killed.
      const original = child.kill.bind(child)
      child.kill = (signal) => { killed = true; original(signal); child.emit('close', null, 'SIGTERM') }
    })
    const outcome = await new SshExecutor({ alias: 'prod', spawn }).exec('sleep 100', { timeoutMs: 10 })
    expect(killed).toBe(true)
    expect(outcome.timedOut).toBe(true)
  })

  it('escalates to SIGKILL when the process ignores SIGTERM after the grace period', async () => {
    vi.useFakeTimers()
    try {
      const signals: (NodeJS.Signals | undefined)[] = []
      const { spawn } = fakeSpawn((child) => {
        // Ignore SIGTERM entirely; record signals and only close on SIGKILL.
        child.kill = (signal) => {
          signals.push(signal ?? 'SIGTERM')
          if (signal === 'SIGKILL') child.emit('close', null, 'SIGKILL')
        }
      })
      const exec = new SshExecutor({ alias: 'prod', spawn, killGraceMs: 1_000 })
      const promise = exec.exec('sleep 100', { timeoutMs: 10 })
      // Let the queued spawn script run and the timeout fire.
      await vi.advanceTimersByTimeAsync(20)
      expect(signals).toEqual(['SIGTERM'])
      // After the grace period, the executor escalates to SIGKILL.
      await vi.advanceTimersByTimeAsync(1_000)
      expect(signals).toContain('SIGKILL')
      const outcome = await promise
      expect(outcome.timedOut).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes caller abort from timeout', async () => {
    const controller = new AbortController()
    const { spawn } = fakeSpawn((child) => {
      child.kill = (signal) => child.emit('close', null, signal ?? 'SIGTERM')
      controller.abort()
    })
    const outcome = await new SshExecutor({ alias: 'prod', spawn }).exec('sleep 100', { signal: controller.signal })
    expect(outcome.aborted).toBe(true)
    expect(outcome.timedOut).toBe(false)
  })

  it('rejects on spawn error', async () => {
    const { spawn } = fakeSpawn((child) => child.emit('error', new Error('ssh: command not found')))
    await expect(new SshExecutor({ alias: 'prod', spawn }).exec('ls')).rejects.toThrow(/command not found/)
  })

  it('rejects construction with an unsafe alias', () => {
    expect(() => new SshExecutor({ alias: '-oProxyCommand=evil', spawn: fakeSpawn(() => undefined).spawn })).toThrow(/unsafe/)
  })

  it('probe reports ok + latency on exit 0', async () => {
    let t = 0
    const { spawn } = fakeSpawn((child) => child.emit('close', 0, null))
    const exec = new SshExecutor({ alias: 'prod', spawn, nowMs: () => (t += 5) })
    const probe = await exec.probe()
    expect(probe.ok).toBe(true)
    expect(typeof probe.latencyMs).toBe('number')
  })
})
