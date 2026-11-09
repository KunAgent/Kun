import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { PassThrough } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { spawnOwnedProcess } from '../../process/owned-process.js'
import { spawnCapture } from './spawn-capture.js'

vi.mock('../../process/owned-process.js', () => ({ spawnOwnedProcess: vi.fn() }))
afterEach(() => vi.resetAllMocks())

function helper() {
  const stdout = new PassThrough()
  const stderr = new PassThrough()
  const child = Object.assign(new EventEmitter(), { stdout, stderr, pid: undefined,
    kill: vi.fn(() => { queueMicrotask(() => child.emit('close', null)); return true }) })
  vi.mocked(spawnOwnedProcess).mockResolvedValue(child as unknown as ChildProcess)
  return child
}

async function listening(child: ReturnType<typeof helper>) {
  await vi.waitFor(() => expect(child.listenerCount('close')).toBe(1))
}
function detached(child: ReturnType<typeof helper>) {
  expect(child.stdout.listenerCount('data')).toBe(0)
  expect(child.stderr.listenerCount('data')).toBe(0)
  expect(child.listenerCount('error')).toBe(0)
  expect(child.listenerCount('close')).toBe(0)
}

describe('spawnCapture completion cleanup', () => {
  it('detaches output and completion closures after each of three normal helpers', async () => {
    for (let index = 0; index < 3; index++) {
      const child = helper()
      const pending = spawnCapture('fixture', [], { cwd: process.cwd() })
      await listening(child)
      child.stdout.write(`output ${index}`)
      child.stderr.write('warning')
      child.emit('close', 0)
      expect(await pending).toMatchObject({ stdout: `output ${index}`, stderr: 'warning', exitCode: 0 })
      detached(child)
    }
  })

  it('detaches both pipes and the close listener when a child reports an error', async () => {
    const child = helper()
    const pending = spawnCapture('fixture', [], { cwd: process.cwd(), timeoutMs: 5000 })
    const rejected = expect(pending).rejects.toThrow('controlled helper failure')
    await listening(child)
    child.stdout.write('buffer before error')
    child.emit('error', new Error('controlled helper failure'))
    await rejected
    detached(child)
  })

  it('removes the abort hook and output closures after cancellation closes the helper', async () => {
    const child = helper()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')
    const pending = spawnCapture('fixture', [], { cwd: process.cwd(), signal: controller.signal })
    const rejected = expect(pending).rejects.toThrow('command aborted')
    await listening(child)
    controller.abort()
    await rejected
    expect(child.kill).toHaveBeenCalledOnce()
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
    detached(child)
  })
})
