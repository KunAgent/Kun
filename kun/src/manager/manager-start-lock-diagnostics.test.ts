import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { classifyStartLock } from './manager-start-lock-diagnostics.js'
import { withManagerStartLock } from './manager-start-lock.js'
import { inspectRuntimeProcess } from '../server/runtime-process-identity.js'

vi.mock('../server/runtime-process-identity.js', async (original) => ({
  ...await original<typeof import('../server/runtime-process-identity.js')>(), inspectRuntimeProcess: vi.fn()
}))
const roots: string[] = []
afterEach(async () => {
  vi.restoreAllMocks()
  vi.mocked(inspectRuntimeProcess).mockReset()
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true })
})
async function fixture(text?: string) {
  const directory = await mkdtemp(join(tmpdir(), 'kun-start-lock-'))
  roots.push(directory)
  const path = join(directory, '.manager-start.lock')
  if (text !== undefined) await writeFile(path, text)
  return { directory, path }
}

describe('startup lock diagnostics', () => {
  it.each([['', 'empty'], ['{"pid":', 'malformed'], ['{}', 'invalid'], ['{"pid":-1}', 'invalid']])(
    'classifies %j independently of owner liveness', (text, state) => {
      expect(classifyStartLock(text!)).toEqual({ state })
      expect(inspectRuntimeProcess).not.toHaveBeenCalled()
    }
  )
  it('distinguishes dead, reused, live and unknown identities', () => {
    const text = JSON.stringify({ pid: 42, acquiredAt: '2026-01-01T00:00:00.000Z', processIdentity: 'birth' })
    const kill = vi.spyOn(process, 'kill').mockImplementation(() => { throw Object.assign(new Error(), { code: 'ESRCH' }) })
    expect(classifyStartLock(text)).toEqual({ state: 'dead', pid: 42 })
    kill.mockReturnValue(true)
    vi.mocked(inspectRuntimeProcess).mockReturnValue({ identity: 'later-birth' })
    expect(classifyStartLock(text).state).toBe('reused')
    vi.mocked(inspectRuntimeProcess).mockReturnValue({ identity: 'birth' })
    expect(classifyStartLock(text).state).toBe('alive')
    vi.mocked(inspectRuntimeProcess).mockReturnValue(undefined)
    expect(classifyStartLock(text).state).toBe('unknown')
    for (const code of ['EPERM', 'EACCES', 'UNKNOWN']) {
      kill.mockImplementation(() => { throw Object.assign(new Error(), { code }) })
      expect(classifyStartLock(text).state).toBe('unknown')
    }
  })
})

describe('manager startup lock', () => {
  it('propagates business EEXIST exactly once and permits the next owner', async () => {
    const f = await fixture()
    const failure = Object.assign(new Error('business EEXIST'), { code: 'EEXIST' })
    const action = vi.fn(async () => { throw failure })
    await expect(withManagerStartLock(f.directory, action)).rejects.toBe(failure)
    expect(action).toHaveBeenCalledTimes(1)
    await expect(withManagerStartLock(f.directory, async () => 7)).resolves.toBe(7)
  })
  it('rejects an already cancelled attempt before creating metadata or running work', async () => {
    const f = await fixture()
    const cancel = new AbortController(); cancel.abort(new Error('cancelled'))
    const action = vi.fn()
    await expect(withManagerStartLock(f.directory, action, cancel.signal)).rejects.toThrow('cancelled')
    expect(action).not.toHaveBeenCalled()
    await expect(readFile(f.path)).rejects.toMatchObject({ code: 'ENOENT' })
  })
  it('cancels a waiter without a late action after the holder releases', async () => {
    const f = await fixture()
    let release!: () => void
    let entered!: () => void
    const ready = new Promise<void>((resolve) => { entered = resolve })
    const held = withManagerStartLock(f.directory, async () => {
      entered(); await new Promise<void>((resolve) => { release = resolve })
    })
    await ready
    vi.mocked(inspectRuntimeProcess).mockReturnValue({ identity: 'unavailable-in-test' })
    const cancel = new AbortController()
    const action = vi.fn()
    const waiting = withManagerStartLock(f.directory, action, cancel.signal)
    cancel.abort(new Error('closed'))
    await expect(waiting).rejects.toThrow('closed')
    release(); await held
    expect(action).not.toHaveBeenCalled()
  })
  it('honors an expired total deadline before acquisition', async () => {
    const f = await fixture()
    const action = vi.fn()
    await expect(withManagerStartLock(f.directory, action, undefined, {
      deadline: performance.now() - 1, scope: 'settingsPath', attemptId: 'attempt-one'
    })).rejects.toMatchObject({ reason: 'timeout', diagnostic: { scope: 'settingsPath', path: f.path, attemptId: 'attempt-one' } })
    expect(action).not.toHaveBeenCalled()
  })
  it.skipIf(process.platform === 'win32')('reports unreadable metadata as IO rather than confirmed ownership', async () => {
    const f = await fixture()
    await mkdir(f.path)
    await expect(withManagerStartLock(f.directory, vi.fn())).rejects.toMatchObject({
      reason: 'unverifiable', diagnostic: { ownerState: 'invalid' }
    })
  })
  it.skipIf(process.platform === 'win32')('bounds syntax damage waiting and preserves unverifiable metadata', async () => {
    const f = await fixture('{"pid":')
    const action = vi.fn()
    await expect(withManagerStartLock(f.directory, action, undefined, { timeoutMs: 80 })).rejects.toMatchObject({
      reason: 'timeout', diagnostic: { ownerState: 'malformed' }
    })
    expect(action).not.toHaveBeenCalled()
    expect(await readFile(f.path, 'utf8')).toBe('{"pid":')
  })
})
