import { EventEmitter } from 'node:events'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { spawn } = vi.hoisted(() => ({ spawn: vi.fn<() => unknown>(() => { throw Error('unexpected native allocation') }) }))
vi.mock('node:child_process', () => ({ spawn, execFile: vi.fn() }))
vi.mock('electron', () => ({ app: { isPackaged: false, getAppPath: () => '/test' } }))
import { NativeDesktopInput } from './native-input'
beforeEach(() => { spawn.mockReset().mockImplementation(() => { throw Error('unexpected native allocation') }) })

describe('native input allocation cancellation', () => {
  it('stop before the initial continuation prevents a late helper spawn', async () => {
    const input = new NativeDesktopInput(vi.fn(), '/not-executed')
    const start = input.start(1, 42, '1:2')
    const rejected = expect(start).rejects.toThrow('DESKTOP_INPUT_LOST')
    await input.stop()
    await rejected
    expect(spawn).not.toHaveBeenCalled()
  })

  it('stop while fallback cleanup is pending fences both that start and future reuse', async () => {
    const input = new NativeDesktopInput(vi.fn(), '/not-executed')
    let finish!: () => void
    ;(input as any).fallback = new Promise<void>(resolve => { finish = resolve })
    const start = expect(input.start(1, 42, '1:2')).rejects.toThrow('DESKTOP_INPUT_LOST')
    const stopped = input.stop()
    finish()
    await Promise.all([start, stopped])
    await expect(input.start(1, 42, '1:2')).rejects.toThrow('DESKTOP_INPUT_LOST')
    expect(spawn).not.toHaveBeenCalled()
  })

  it('retains the owned ledger after failed cleanup and retries even when the previous fallback resolved', async () => {
    const input = new NativeDesktopInput(vi.fn(), '/not-executed')
    const payloads: string[] = []
    const transport = (code: number) => {
      const child = new EventEmitter() as any
      child.kill = vi.fn()
      child.stdin = new EventEmitter()
      child.stdin.end = (payload: string) => { payloads.push(payload); queueMicrotask(() => child.emit('exit', code)) }
      return child
    }
    ;(input as any).keys.add('ShiftLeft')
    ;(input as any).buttons.add(2)
    spawn.mockImplementationOnce(() => transport(3))
    await expect(input.stop()).rejects.toThrow('DESKTOP_CLEANUP_UNCONFIRMED')
    expect((input as any).keys.has('ShiftLeft')).toBe(true)
    spawn.mockImplementationOnce(() => transport(0))
    await input.stop()
    expect(payloads.map(value => JSON.parse(value))).toEqual([
      { keys: ['ShiftLeft'], buttons: [2] }, { keys: ['ShiftLeft'], buttons: [2] }
    ])
    expect((input as any).keys.size).toBe(0)
    expect((input as any).buttons.size).toBe(0)
    expect(spawn).toHaveBeenCalledTimes(2)
  })
})
