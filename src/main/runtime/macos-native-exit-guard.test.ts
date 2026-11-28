import { EventEmitter } from 'node:events'
import { runInNewContext } from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ spawn: vi.fn(), writeSync: vi.fn() }))
vi.mock('node:child_process', () => ({ spawn: mocks.spawn }))
vi.mock('node:fs', () => ({ writeSync: mocks.writeSync }))
import { installMacosNativeExitGuard, MACOS_NATIVE_EXIT_GUARD_SOURCE } from './macos-native-exit-guard'

describe('macOS native exit guard', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('only arms on a successful final quit after cleanup is confirmed', () => {
    const app = new EventEmitter(), unref = vi.fn(), once = vi.fn()
    mocks.spawn.mockReturnValue({ unref, once })
    let complete = false
    installMacosNativeExitGuard(app as never, () => complete, 'darwin')
    app.emit('before-quit', {})
    app.emit('will-quit', {})
    expect(mocks.spawn).not.toHaveBeenCalled()
    complete = true
    app.emit('quit', {}, 0)
    expect(mocks.spawn).toHaveBeenCalledWith(process.execPath,
      ['-e', MACOS_NATIVE_EXIT_GUARD_SOURCE, String(process.pid)], {
        detached: true, stdio: 'ignore', env: { ELECTRON_RUN_AS_NODE: '1' }
      })
    expect(unref).toHaveBeenCalledOnce()
    expect(once).toHaveBeenCalledWith('error', expect.any(Function))
    app.emit('quit', {}, 0)
    expect(mocks.spawn).toHaveBeenCalledOnce()
  })

  it.each([
    ['darwin', false, 0], ['darwin', true, 1], ['win32', true, 0], ['linux', true, 0]
  ] as const)('does not arm for platform=%s, cleanup=%s, exitCode=%s', (platform, complete, code) => {
    const app = new EventEmitter()
    installMacosNativeExitGuard(app as never, () => complete, platform)
    app.emit('quit', {}, code)
    expect(mocks.spawn).not.toHaveBeenCalled()
  })

  it('preserves normal quit when the helper cannot launch', () => {
    mocks.spawn.mockImplementationOnce(() => { throw new Error('spawn unavailable') })
    const app = new EventEmitter()
    installMacosNativeExitGuard(app as never, () => true, 'darwin')
    expect(() => app.emit('quit', {}, 0)).not.toThrow()
  })

  function watchdog(parent = 1234, initialParent = 1234) {
    let now = 0
    const timers: Array<() => void> = []
    const process = { argv: ['electron', String(parent)], ppid: initialParent, kill: vi.fn() }
    runInNewContext(MACOS_NATIVE_EXIT_GUARD_SOURCE, {
      process, Date: { now: () => now }, Number,
      setTimeout: (callback: () => void) => { timers.push(callback) }
    })
    return { process, timers, advance: (time: number) => { now = time; timers.shift()?.() } }
  }

  it('allows a grace period and signals only its still-current parent', () => {
    const f = watchdog()
    expect(f.process.kill).not.toHaveBeenCalled()
    f.advance(9_999)
    expect(f.process.kill).not.toHaveBeenCalled()
    f.advance(10_000)
    expect(f.process.kill).toHaveBeenCalledExactlyOnceWith(1234, 'SIGKILL')
    expect(f.timers).toHaveLength(0)
  })

  it('exits without signalling when the parent has already exited or changed', () => {
    const f = watchdog()
    f.process.ppid = 1
    f.advance(10_000)
    expect(f.process.kill).not.toHaveBeenCalled()
    expect(f.timers).toHaveLength(0)
    expect(watchdog(1234, 1).timers).toHaveLength(0)
  })

  it.each([0, 1, -1, NaN, 1.5])('rejects an invalid parent PID %s', parent => {
    const f = watchdog(parent, parent)
    expect(f.process.kill).not.toHaveBeenCalled()
    expect(f.timers).toHaveLength(0)
  })
})
