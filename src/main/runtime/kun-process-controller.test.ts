import { EventEmitter } from 'node:events'
import type { ChildProcess } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { KunProcessController } from './kun-process-controller'

function child(pid = 1): ChildProcess {
  return Object.assign(new EventEmitter(), {
    pid,
    exitCode: null,
    signalCode: null
  }) as unknown as ChildProcess
}

describe('KunProcessController', () => {
  it('shares one in-flight startup and permits a later fresh startup', async () => {
    const controller = new KunProcessController<never>()
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const factory = vi.fn(() => gate)

    const first = controller.start(factory)
    const second = controller.start(factory)
    expect(second).toBe(first)
    await vi.waitFor(() => expect(factory).toHaveBeenCalledTimes(1))

    release()
    await first
    await controller.start(async () => undefined)
    expect(factory).toHaveBeenCalledTimes(1)
  })

  it('reports only ready children that were not intentionally stopped', () => {
    const controller = new KunProcessController<never>()
    const handler = vi.fn()
    const crashed = child(1)
    const stopped = child(2)
    controller.setUnexpectedExitHandler(handler)
    controller.registerChild(crashed)
    controller.markReady(crashed)
    controller.registerChild(stopped)
    controller.markReady(stopped)
    controller.markIntentionalStop(stopped, 'settings-restart')

    expect(controller.shouldReportUnexpectedExit(crashed)).toBe(true)
    expect(controller.shouldReportUnexpectedExit(stopped)).toBe(false)
    controller.reportUnexpectedExit({ code: 1, signal: null, stderrTail: 'failed', generation: 1 })
    expect(handler).toHaveBeenCalledOnce()
  })

  it('classifies an explicit stop and ignores duplicate exit events', () => {
    const controller = new KunProcessController<never>()
    const runtime = child(3)
    const generation = controller.registerChild(runtime)
    controller.markReady(runtime)
    controller.markIntentionalStop(runtime, 'settings-restart')

    const first = controller.recordExit(runtime, { code: null, signal: 'SIGTERM' })
    expect(first).toMatchObject({
      expected: true,
      reason: 'settings-restart',
      stale: false
    })
    expect(first?.generation.generation).toBe(generation.generation)
    expect(controller.recordExit(runtime, { code: null, signal: 'SIGTERM' })).toBeNull()
  })

  it('treats an unrequested SIGTERM as unexpected', () => {
    const controller = new KunProcessController<never>()
    const runtime = child(4)
    controller.registerChild(runtime)
    controller.markReady(runtime)

    expect(controller.recordExit(runtime, { code: null, signal: 'SIGTERM' })).toMatchObject({
      expected: false,
      reason: 'unknown',
      stale: false
    })
  })

  it('marks a late exit from an older generation as stale', () => {
    const controller = new KunProcessController<never>()
    const oldRuntime = child(5)
    const newRuntime = child(6)
    controller.registerChild(oldRuntime)
    controller.markReady(oldRuntime)
    controller.registerChild(newRuntime)
    controller.markReady(newRuntime)

    expect(controller.recordExit(oldRuntime, { code: null, signal: 'SIGTERM' })).toMatchObject({
      expected: false,
      stale: true
    })
    expect(controller.recordExit(newRuntime, { code: 0, signal: null })).toMatchObject({
      expected: false,
      stale: false
    })
  })

  it('clears only the child instance that still owns the controller', () => {
    const controller = new KunProcessController<never>()
    const current = child(1)
    const stale = child(2)
    controller.child = current
    controller.childPort = 18899

    expect(controller.clearChild(stale)).toBe(false)
    expect(controller.child).toBe(current)
    expect(controller.clearChild(current)).toBe(true)
    expect(controller.child).toBeNull()
    expect(controller.childPort).toBeNull()
  })
})
