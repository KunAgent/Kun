import { describe, expect, it, vi } from 'vitest'
import type { ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import type { OwnedServiceManagerSession } from '../../../kun/src/manager/owned-service-manager-session.js'
import type { ServiceManagerConnection } from '../../../kun/src/manager/manager-client.js'
import { DesktopProcessStack } from './desktop-process-stack'

function fixture() {
  const child = Object.assign(new EventEmitter(), { exitCode: null, signalCode: null }) as ChildProcess
  const connection = { discovery: { instanceId: 'manager-1' } } as ServiceManagerConnection
  const ensure = vi.fn(async () => connection)
  const stop = vi.fn(async () => undefined)
  const close = vi.fn(async () => undefined)
  const current = vi.fn(() => ({ child, connection }))
  const session = { ensure, stop, close, current } as unknown as OwnedServiceManagerSession
  const stack = new DesktopProcessStack(() => session)
  const input = { dataDir: '/tmp/profile', flavor: 'production' as const }
  return { child, connection, ensure, stop, close, current, stack, input }
}

describe('desktop process stack', () => {
  it('fences late Manager readiness after quit and cleans the exact candidate', async () => {
    const f = fixture()
    let ready!: (value: ServiceManagerConnection) => void
    f.ensure.mockImplementationOnce(() => new Promise((resolve) => { ready = resolve }))
    const starting = f.stack.ensureManager(f.input)
    f.stack.beginStop(true)
    ready(f.connection)
    await expect(starting).rejects.toThrow('closed during')
    expect(f.stop).toHaveBeenCalledOnce()
    await expect(f.stack.ensureManager(f.input)).rejects.toThrow('shutting down')
  })

  it('stops Manager without a Runtime when the application only opened settings', async () => {
    const f = fixture()
    await f.stack.ensureManager(f.input)
    await f.stack.stopManager(Date.now() + 1000, true)
    expect(f.close).toHaveBeenCalledOnce()
    f.stack.resumeAfterFailedUpdate()
    expect(() => f.stack.assertCanStart()).toThrow('shutting down')
  })

  it('keeps the Manager alive on a normal Runtime restart', async () => {
    const f = fixture()
    await f.stack.ensureManager(f.input)
    const stopRuntime = vi.fn(async () => undefined)
    expect(await f.stack.recoverManager(stopRuntime)).toBe(f.connection)
    expect(stopRuntime).not.toHaveBeenCalled()
    expect(f.stop).not.toHaveBeenCalled()
  })

  it('drains the old Runtime before replacing a crashed Manager', async () => {
    const f = fixture()
    await f.stack.ensureManager(f.input)
    Object.defineProperty(f.child, 'exitCode', { value: 1 })
    const order: string[] = []
    f.stop.mockImplementation(async () => { order.push('manager-stop') })
    f.ensure.mockImplementation(async () => { order.push('manager-start'); return f.connection })
    await f.stack.recoverManager(async () => { order.push('runtime-stop') })
    expect(order).toEqual(['runtime-stop', 'manager-stop', 'manager-start'])
  })

  it('does not restart a crashed Manager when quit races recovery', async () => {
    const f = fixture()
    await f.stack.ensureManager(f.input)
    Object.defineProperty(f.child, 'exitCode', { value: 1 })
    await expect(f.stack.recoverManager(async () => f.stack.beginStop(true))).rejects.toThrow('shutting down')
    expect(f.ensure).toHaveBeenCalledOnce()
  })

  it('permits an explicit failed-update recovery while keeping quit terminal', async () => {
    const f = fixture()
    await f.stack.ensureManager(f.input)
    await f.stack.stopManager(Date.now() + 1000)
    expect(f.stop).toHaveBeenCalledOnce()
    expect(f.close).not.toHaveBeenCalled()
    expect(() => f.stack.assertCanStart()).toThrow()
    f.stack.resumeAfterFailedUpdate()
    await f.stack.ensureManager(f.input)
    expect(f.ensure).toHaveBeenCalledTimes(2)
  })
})
