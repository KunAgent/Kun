import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { withManagerStartLock } from './manager-start-lock.js'
import { runWithStartLock } from './manager-start-lock-support.js'

const roots: string[] = []
async function root() {
  const path = await mkdtemp(join(tmpdir(), 'kun-start-lock-'))
  roots.push(path)
  return path
}
afterEach(async () => { await Promise.all(roots.splice(0).map((path) => rm(path, { recursive: true, force: true }))) })

describe('startup lock boundaries', () => {
  it('never replays a business EEXIST and releases the lock', async () => {
    const directory = await root()
    const failure = Object.assign(new Error('business conflict'), { code: 'EEXIST' })
    const action = vi.fn().mockRejectedValue(failure)
    await expect(withManagerStartLock(directory, action)).rejects.toBe(failure)
    expect(action).toHaveBeenCalledTimes(1)
    await expect(withManagerStartLock(directory, async () => 'next')).resolves.toBe('next')
  })
  it('cancels a waiting contender without a late action', async () => {
    const directory = await root()
    const cancel = new AbortController()
    const action = vi.fn()
    await withManagerStartLock(directory, async () => {
      const waiting = withManagerStartLock(directory, action, cancel.signal)
      cancel.abort(new Error('cancelled'))
      await expect(waiting).rejects.toThrow('cancelled')
    })
    expect(action).not.toHaveBeenCalled()
  })
  it('publishes a birth identity and unique instance for diagnostics', async () => {
    const directory = await root()
    await withManagerStartLock(directory, async () => {
      const owner = JSON.parse(await readFile(join(directory, '.manager-start.lock'), 'utf8'))
      expect(owner).toMatchObject({ pid: process.pid, processIdentity: expect.any(String), instanceId: expect.any(String) })
    })
  })
  it('does not discard cleanup failures or the original business failure', async () => {
    const failure = new Error('action')
    const cleanup = Object.assign(new Error('cleanup'), { code: 'EEXIST' })
    await expect(runWithStartLock(async () => { throw failure }, () => { throw cleanup }))
      .rejects.toMatchObject({ errors: [failure, cleanup], cause: failure })
    await expect(runWithStartLock(async () => 1, () => { throw cleanup })).rejects.toBe(cleanup)
  })
})
