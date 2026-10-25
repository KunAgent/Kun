import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { PassThrough } from 'node:stream'
import { describe, expect, it, vi } from 'vitest'
import { isTransientSpawnError, startHarnessProcess, stripTerminalEscapes } from './harness-process.js'

describe('stripTerminalEscapes', () => {
  it('removes colour, cursor and OSC sequences from captured CLI output', () => {
    const banner = '\u001b[91m\u001b[1mError: \u001b[0mUnexpected error\u001b[2K\u001b]0;opencode\u0007 done'
    expect(stripTerminalEscapes(banner)).toBe('Error: Unexpected error done')
    expect(stripTerminalEscapes('plain text')).toBe('plain text')
  })
})

function fakeChild(): ChildProcess {
  return Object.assign(new EventEmitter(), {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: () => true
  }) as unknown as ChildProcess
}

function spawnError(code: string): Error {
  return Object.assign(new Error(`spawn /bin/sh ${code}`), { code })
}

describe('transient spawn retry', () => {
  it('recognizes resource exhaustion anywhere in the error chain', () => {
    expect(isTransientSpawnError(spawnError('EAGAIN'))).toBe(true)
    expect(isTransientSpawnError(new Error('wrapped', { cause: spawnError('EMFILE') }))).toBe(true)
    expect(isTransientSpawnError(new Error('spawnSync /usr/bin/git ENFILE'))).toBe(true)
    expect(isTransientSpawnError(spawnError('ENOENT'))).toBe(false)
    expect(isTransientSpawnError(new Error('agent exited with code 1'))).toBe(false)
  })

  it('starts again after a refused fork and returns the process that launched', async () => {
    const child = fakeChild()
    const spawn = vi.fn()
      .mockRejectedValueOnce(spawnError('EAGAIN'))
      .mockRejectedValueOnce(spawnError('ENOMEM'))
      .mockResolvedValueOnce(child)
    const process = await startHarnessProcess({ command: 'agent', spawn, spawnRetryDelaysMs: [1, 1] })
    expect(process.child).toBe(child)
    expect(spawn).toHaveBeenCalledTimes(3)
  })

  it('gives up after the last attempt and never retries a wrong launch', async () => {
    const exhausted = vi.fn().mockRejectedValue(spawnError('EAGAIN'))
    await expect(startHarnessProcess({ command: 'agent', spawn: exhausted, spawnRetryDelaysMs: [1, 1] }))
      .rejects.toMatchObject({ code: 'EAGAIN' })
    expect(exhausted).toHaveBeenCalledTimes(3)

    const missing = vi.fn().mockRejectedValue(spawnError('ENOENT'))
    await expect(startHarnessProcess({ command: 'agent', spawn: missing, spawnRetryDelaysMs: [1, 1] }))
      .rejects.toMatchObject({ code: 'ENOENT' })
    expect(missing).toHaveBeenCalledTimes(1)
  })

  it('stops waiting when the start is cancelled', async () => {
    const controller = new AbortController()
    const spawn = vi.fn().mockImplementation(async () => {
      setTimeout(() => controller.abort(new Error('cancelled')), 5)
      throw spawnError('EAGAIN')
    })
    await expect(startHarnessProcess({ command: 'agent', spawn, signal: controller.signal, spawnRetryDelaysMs: [60_000] }))
      .rejects.toThrow('cancelled')
    expect(spawn).toHaveBeenCalledTimes(1)
  })
})
