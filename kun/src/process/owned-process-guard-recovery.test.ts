import { spawn, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { afterEach, describe, expect, it } from 'vitest'
import { OWNED_PROCESS_GUARD_SOURCE } from './owned-process-guard.js'

const children: ChildProcess[] = []
const directories: string[] = []
afterEach(async () => {
  await Promise.all(children.splice(0).map(async (child) => {
    if (child.exitCode !== null || child.signalCode !== null) return
    const exited = once(child, 'exit')
    child.kill('SIGKILL')
    await exited
  }))
  await Promise.all(directories.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), 'kun-guard-recovery-'))
  directories.push(directory)
  const block = join(directory, 'inspection-unavailable')
  // Only inject the OS inspection failure. Both the guard and its contained
  // target are real processes, and all termination uses the production guard.
  const guard = spawn(process.execPath, ['-e', `
    const childProcess = require('node:child_process');
    const originalExec = childProcess.execFileSync;
    childProcess.execFileSync = (file, args, options) => {
      if (args[0] === '-axo' && require('node:fs').existsSync(${JSON.stringify(block)})) {
        throw Object.assign(new Error('fixture process listing timeout'), { code: 'ETIMEDOUT' });
      }
      return originalExec(file, args, options);
    };
    ${OWNED_PROCESS_GUARD_SOURCE}
  `], { stdio: ['ignore', 'ignore', 'pipe', 'ipc'], env: { ...process.env, LC_ALL: 'C' } })
  children.push(guard)
  await once(guard, 'message')
  const target = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000); process.send("ready")'], {
    detached: true, stdio: ['ignore', 'ignore', 'ignore', 'ipc']
  })
  children.push(target)
  await once(target, 'message')
  let nextId = 0
  const request = (message: Record<string, unknown>) => new Promise<void>((resolve, reject) => {
    const id = ++nextId
    const onMessage = (value: unknown) => {
      const response = value as { id?: number; error?: string }
      if (response.id !== id) return
      guard.off('message', onMessage)
      if (response.error) reject(new Error(response.error))
      else resolve()
    }
    guard.on('message', onMessage)
    guard.send({ ...message, id })
  })
  await request({ type: 'register', pid: target.pid, ownerLossGraceMs: 3000 })
  return { target, request, block }
}

describe.skipIf(process.platform === 'win32')('owned process guard recovery', () => {
  it('waits through an inconclusive process listing and stops only after inspection recovers', async () => {
    const f = await fixture()
    await writeFile(f.block, '')
    let outcome: 'pending' | 'stopped' | 'failed' = 'pending'
    const stop = f.request({ type: 'stop', pid: f.target.pid, graceMs: 0, timeoutMs: 3000 })
      .then(() => { outcome = 'stopped' }, () => { outcome = 'failed' })
    await delay(700)
    expect(outcome).toBe('pending')
    expect(f.target.exitCode).toBeNull()
    expect(f.target.signalCode).toBeNull()
    await rm(f.block)
    await stop
    expect(outcome).toBe('stopped')
    expect(f.target.signalCode).toBe('SIGKILL')
  })

  it('preserves an unverifiable group at the deadline and gives an explicit retry a fresh budget', async () => {
    const f = await fixture()
    await writeFile(f.block, '')
    await expect(f.request({ type: 'stop', pid: f.target.pid, graceMs: 0, timeoutMs: 100 }))
      .rejects.toThrow('process listing timed out')
    expect(f.target.exitCode).toBeNull()
    expect(f.target.signalCode).toBeNull()
    const retry = f.request({ type: 'stop', pid: f.target.pid, graceMs: 0, timeoutMs: 3000 })
    // Keep inspection unavailable past the previous attempt's deadline.
    let failed = false
    void retry.catch(() => { failed = true })
    await delay(700)
    expect(failed).toBe(false)
    await rm(f.block)
    await expect(retry).resolves.toBeUndefined()
    expect(f.target.signalCode).toBe('SIGKILL')
  })
})
