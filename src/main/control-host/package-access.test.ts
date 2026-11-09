import { expect, it, vi } from 'vitest'
import type { RpcPeer } from '@kun/control-host'
import { ControlPackageAccess } from './package-access'

function fixture() {
  let rpc: RpcPeer | undefined, stopped = false
  const manager = {
    status: vi.fn(() => ({phase: 'ready'})),
    initialize: vi.fn(async () => ({phase: 'not_installed'})),
    check: vi.fn(async () => ({phase: 'available', candidateVersion: '1.0.0'})),
    apply: vi.fn(async () => ({phase: 'ready'})),
    recover: vi.fn(async () => ({phase: 'ready'})),
    install: vi.fn(async () => { rpc = {closed: false} as RpcPeer; return {phase: 'ready', version: '1.0.0'} })
  }
  const access = new ControlPackageAccess(manager, () => rpc, () => stopped)
  return {access, manager, setCurrent(value?: RpcPeer) {rpc = value}, stop() {stopped = true}}
}
it('restores local state and handles passive requests without installing', async () => {
  const f = fixture()
  await f.access.initialize()
  expect(await f.access.available()).toBeUndefined()
  await f.access.operation('check')
  expect(f.manager.initialize).toHaveBeenCalledTimes(1)
  expect(f.manager.check).toHaveBeenCalledTimes(1)
  expect(f.manager.install).not.toHaveBeenCalled()
})
it('merges concurrent first-use and manual installation while keeping an existing runtime unchanged', async () => {
  const f = fixture()
  const [a, b] = await Promise.all([f.access.ready(), f.access.ready(), f.access.operation('install')])
  expect(a).toBe(b)
  expect(f.manager.install).toHaveBeenCalledTimes(1)
  expect(await f.access.ready()).toBe(a)
  expect(f.manager.install).toHaveBeenCalledTimes(1)
})
it('keeps failed installation retryable and does not install during passive state reads', async () => {
  const f = fixture()
  f.manager.install.mockRejectedValueOnce(Error('offline'))
  await expect(f.access.ready()).rejects.toThrow('offline')
  expect(await f.access.available()).toBeUndefined()
  expect(f.manager.install).toHaveBeenCalledTimes(1)
  expect((await f.access.ready()).closed).toBe(false)
  expect(f.manager.install).toHaveBeenCalledTimes(2)
})
it('serializes an explicit check before first installation', async () => {
  const f = fixture(), order: string[] = []
  let finish!: () => void
  f.manager.check.mockImplementationOnce(async () => {
    order.push('check'); await new Promise<void>(resolve => {finish = resolve}); order.push('checked')
    return {phase: 'available', candidateVersion: '1.0.0'}
  })
  f.manager.install.mockImplementationOnce(async () => {
    order.push('install'); f.setCurrent({closed: false} as RpcPeer)
    return {phase: 'ready', version: '1.0.0'}
  })
  const checking = f.access.operation('check'), ready = f.access.ready()
  await vi.waitFor(() => expect(order).toEqual(['check']))
  finish(); await checking; await ready
  expect(order).toEqual(['check', 'checked', 'install'])
})
it('does not start a queued installation or expose a late runtime after shutdown', async () => {
  const f = fixture()
  f.stop()
  await expect(f.access.ready()).rejects.toThrow('CONTROL_HOST_STOPPED')
  await expect(f.access.operation('install')).rejects.toThrow('CONTROL_HOST_STOPPED')
  expect(f.manager.install).not.toHaveBeenCalled()
})
it.each(['apply', 'recover'] as const)('reuses the runtime restored by queued %s without networking or upgrading', async operation => {
  const f = fixture(), restored = {closed: false} as RpcPeer
  let finish!: () => void
  f.manager[operation].mockImplementationOnce(async () => {
    await new Promise<void>(resolve => {finish = resolve}); f.setCurrent(restored)
    return {phase: 'ready'}
  })
  f.manager.install.mockRejectedValueOnce(Error('offline'))
  const applying = f.access.operation(operation), demanded = f.access.ready()
  await vi.waitFor(() => expect(finish).toBeTypeOf('function'))
  finish(); await applying
  expect(await demanded).toBe(restored)
  expect(f.manager.install).not.toHaveBeenCalled()
})
it('keeps manual installation explicit even when a usable runtime already exists', async () => {
  const f = fixture(); f.setCurrent({closed: false} as RpcPeer)
  await f.access.ready()
  expect(f.manager.install).not.toHaveBeenCalled()
  await f.access.operation('install')
  expect(f.manager.install).toHaveBeenCalledTimes(1)
})
it('shares one failed automatic first attempt and retries only on a later demand', async () => {
  const f = fixture(); f.manager.install.mockRejectedValueOnce(Error('offline'))
  const results = await Promise.allSettled([f.access.ready(), f.access.ready()])
  expect(results.map(value => value.status)).toEqual(['rejected', 'rejected'])
  expect(f.manager.install).toHaveBeenCalledTimes(1)
  await f.access.ready()
  expect(f.manager.install).toHaveBeenCalledTimes(2)
})
it('does not roll back a healthy runtime installed while crash recovery was queued', async () => {
  const f = fixture()
  await Promise.all([f.access.operation('install'), f.access.operation('recover')])
  expect(f.manager.install).toHaveBeenCalledTimes(1)
  expect(f.manager.recover).not.toHaveBeenCalled()
  expect((await f.access.ready()).closed).toBe(false)
})
