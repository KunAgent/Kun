import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { HarnessDetector, spawnCaptured } from './harness-detector.js'
import { HarnessCatalog } from './harness-catalog.js'
import { resolveExecutable, spawnOwnedProcess, stopOwnedProcess } from '../process/owned-process.js'

vi.mock('../process/owned-process.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../process/owned-process.js')>(),
  spawnOwnedProcess: vi.fn(), stopOwnedProcess: vi.fn(async () => undefined), resolveExecutable: vi.fn(async () => '/selected/bin/opencode')
}))
const spawn = vi.mocked(spawnOwnedProcess), stop = vi.mocked(stopOwnedProcess)
beforeEach(() => { spawn.mockReset(); stop.mockClear() })
function fixture() {
  const child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(), stderr: new PassThrough(), exitCode: null, signalCode: null
  })
  return child as unknown as ChildProcess
}

describe('bounded captured metadata process', () => {
  it('does not spawn for pre-aborted detection', async () => {
    const signal = AbortSignal.abort(new Error('cancelled'))
    await expect(spawnCaptured('fixture', ['--version'], { timeoutMs: 100, signal })).rejects.toThrow('cancelled')
    expect(spawn).not.toHaveBeenCalled()
  })
  it('stops an active process on abort and forwards the selected environment', async () => {
    const child = fixture(), controller = new AbortController()
    spawn.mockResolvedValue(child)
    const pending = spawnCaptured('fixture', ['--version'], {
      timeoutMs: 1000, signal: controller.signal, env: { SELECTED_PROFILE: 'fixture' }
    })
    await vi.waitFor(() => expect(spawn).toHaveBeenCalled())
    controller.abort(new Error('cancelled'))
    await expect(pending).rejects.toThrow('cancelled')
    expect(stop).toHaveBeenCalledExactlyOnceWith(child, { graceMs: 0 })
    expect(spawn.mock.calls[0][2]?.env).toMatchObject({ SELECTED_PROFILE: 'fixture' })
  })
  it('reclaims a launcher result received after the deadline', async () => {
    const child = fixture()
    let finish!: (value: ChildProcess) => void
    spawn.mockImplementation(() => new Promise((resolve) => { finish = resolve }))
    expect(await spawnCaptured('fixture', ['--version'], { timeoutMs: 20 }))
      .toMatchObject({ timedOut: true, exitCode: null })
    finish(child)
    await vi.waitFor(() => expect(stop).toHaveBeenCalledExactlyOnceWith(child, { graceMs: 0 }))
  })
  it('caps captured output and tears down after a successful version exit', async () => {
    const child = fixture()
    spawn.mockResolvedValue(child)
    const pending = spawnCaptured('fixture', ['--version'], { timeoutMs: 1000 })
    await vi.waitFor(() => expect(child.listenerCount('exit')).toBe(1))
    child.stdout!.emit('data', Buffer.alloc(100_000, 'a'))
    child.stderr!.emit('data', Buffer.alloc(100_000, 'b'))
    child.emit('exit', 0)
    const result = await pending
    expect(result.stdout.length).toBe(64 * 1024)
    expect(result.stderr.length).toBe(64 * 1024)
    expect(result).toMatchObject({ exitCode: 0, timedOut: false })
    expect(stop).toHaveBeenCalledExactlyOnceWith(child, { graceMs: 0 })
  })
})


it('resolves metadata against the same launch PATH as the child', async () => {
  const original = new HarnessCatalog({ custom: () => [] }).get('opencode')!
  const definition = { ...original, launch: { ...original.launch!, env: { PATH: '/selected/bin' } } }
  const detector = new HarnessDetector({
    definitions: () => [definition], overrides: () => ({}),
    spawnCaptured: async () => ({ stdout: '1.1.47', stderr: '', timedOut: false, exitCode: 0 }),
    probeLogin: async () => 'unknown', nowMs: Date.now, nowIso: () => new Date().toISOString()
  })
  expect(await detector.status('opencode')).toMatchObject({ resolvedCommand: '/selected/bin/opencode' })
  expect(resolveExecutable).toHaveBeenCalledWith('opencode', {
    env: expect.objectContaining({ PATH: expect.stringMatching(/^\/selected\/bin(?:[:;]|$)/) })
  })
})
