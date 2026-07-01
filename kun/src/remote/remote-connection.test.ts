import { describe, expect, it, vi } from 'vitest'
import { RemoteConnection } from './remote-connection.js'
import type { SshExecOutcome } from './ssh-executor.js'

function outcome(overrides: Partial<SshExecOutcome>): SshExecOutcome {
  return {
    alias: 'prod',
    command: 'true',
    stdout: '',
    stderr: '',
    exitCode: 0,
    signal: null,
    durationMs: 5,
    timedOut: false,
    ...overrides
  }
}

describe('RemoteConnection', () => {
  it('coalesces concurrent probes into a single underlying check', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 12 }))
    const conn = new RemoteConnection({ executor: { exec: vi.fn(), probe } })
    const [a, b] = await Promise.all([conn.probe(), conn.probe()])
    expect(probe).toHaveBeenCalledTimes(1)
    expect(a.ok).toBe(true)
    expect(b.ok).toBe(true)
    expect(conn.status()).toBe('connected')
    expect(conn.latencyMs()).toBe(12)
  })

  it('moves from connected to degraded when a probe fails', async () => {
    const results = [{ ok: true, latencyMs: 1 }, { ok: false, error: 'no route to host' }]
    const probe = vi.fn(async () => results.shift()!)
    const conn = new RemoteConnection({ executor: { exec: vi.fn(), probe } })
    await conn.probe()
    expect(conn.status()).toBe('connected')
    await conn.probe()
    expect(conn.status()).toBe('degraded')
    expect(conn.lastError()).toBe('no route to host')
  })

  it('reports statusUnknown for a mutating command when the transport drops mid-flight', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const exec = vi.fn(async () => outcome({ exitCode: 255, stderr: 'client_loop: connection reset by peer' }))
    const conn = new RemoteConnection({ executor: { exec, probe } })
    await conn.probe()
    const result = await conn.run('systemctl restart api', { writes: true })
    expect(result.statusUnknown).toBe(true)
    expect(result.status).toBe('degraded')
  })

  it('does NOT mark a read-only command as statusUnknown on a drop (safe to retry)', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const exec = vi.fn(async () => outcome({ exitCode: 255, stderr: 'Connection timed out', timedOut: true }))
    const conn = new RemoteConnection({ executor: { exec, probe } })
    await conn.probe()
    const result = await conn.run('cat /var/log/app.log', { writes: false })
    expect(result.statusUnknown).toBe(false)
    expect(result.status).toBe('degraded')
  })

  it('returns a successful outcome and stays connected on a normal exit', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const exec = vi.fn(async () => outcome({ stdout: 'hello', exitCode: 0 }))
    const conn = new RemoteConnection({ executor: { exec, probe } })
    const result = await conn.run('echo hello', { writes: false })
    expect(result.statusUnknown).toBe(false)
    expect(result.status).toBe('connected')
    expect(result.outcome?.stdout).toBe('hello')
  })

  it('lazily probes before the first command when disconnected', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const exec = vi.fn(async () => outcome({ stdout: 'ok' }))
    const conn = new RemoteConnection({ executor: { exec, probe } })
    expect(conn.status()).toBe('disconnected')
    await conn.run('pwd', { writes: false })
    expect(probe).toHaveBeenCalledTimes(1)
    expect(exec).toHaveBeenCalledTimes(1)
  })

  it('does not run the command when the target cannot be reached', async () => {
    const probe = vi.fn(async () => ({ ok: false, error: 'auth failed' }))
    const exec = vi.fn()
    const conn = new RemoteConnection({ executor: { exec, probe } })
    const result = await conn.run('pwd', { writes: false })
    expect(exec).not.toHaveBeenCalled()
    expect(result.status).toBe('error')
    expect(result.error).toBe('auth failed')
  })

  it('actually retries a read-only command after a reconnect and succeeds', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    let call = 0
    const exec = vi.fn(async () => {
      call += 1
      return call === 1
        ? outcome({ exitCode: 255, stderr: 'client_loop: connection reset by peer' })
        : outcome({ stdout: 'recovered', exitCode: 0 })
    })
    const conn = new RemoteConnection({ executor: { exec, probe } })
    await conn.probe()
    const result = await conn.run('cat /var/log/app.log', { writes: false })
    expect(exec).toHaveBeenCalledTimes(2)
    expect(result.status).toBe('connected')
    expect(result.statusUnknown).toBe(false)
    expect(result.outcome?.stdout).toBe('recovered')
  })

  it('does not retry a mutating command after a drop (no replay)', async () => {
    const probe = vi.fn(async () => ({ ok: true, latencyMs: 1 }))
    const exec = vi.fn(async () => outcome({ exitCode: 255, stderr: 'broken pipe' }))
    const conn = new RemoteConnection({ executor: { exec, probe } })
    await conn.probe()
    const result = await conn.run('systemctl restart api', { writes: true })
    expect(exec).toHaveBeenCalledTimes(1)
    expect(result.statusUnknown).toBe(true)
  })
})
