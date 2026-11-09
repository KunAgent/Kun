import { afterEach, expect, it, vi } from 'vitest'
import type { DesktopAuthority } from '@kun/control-runtime/desktop'
import { ControlDesktop } from './desktop'
import { desktopActivityGate } from '../remote-desktop/activity-gate'

const hosts: ControlDesktop[] = []
afterEach(async () => { vi.restoreAllMocks(); for (const host of hosts.splice(0)) await host.stopAll() })
it('a stale ended event cannot release another controller activity reservation', async () => {
  let handle = ''
  const rpc = { closed:false, call:vi.fn(async (_method:string, value:any) => {
    if (value?.method === 'status') return { supported:true,enabled:true,displays:[],active:undefined }
    if (value?.method === 'capabilities') return []
    if (value?.method === 'invoke') { handle=value.context.handle; return {state:'viewing',session:{startId:'start'}} }
  }) }
  const host = new ControlDesktop({ supported:()=>true,displays:()=>[],indicator:{hide(){}},arbiter:{release:async()=>{}} } as any,async()=>rpc as any)
  hosts.push(host)
  await host.invoke('desktop.session.start',{startId:'start',origin:{kind:'code',id:'thread'},displayToken:'display',displayRevision:'revision',quality:'balanced'},
    {accountId:'owner',deviceId:'peer',authorizationId:'grant',scopes:['desktop.view'],current:()=>true,emit:()=>{}})
  expect(desktopActivityGate.busy()).toBe(true)
  host.emit('old-authority',{event:'desktop.session.ended',startId:'start',confirmed:true})
  expect(desktopActivityGate.busy()).toBe(true)
  host.emit(handle,{event:'desktop.session.ended',startId:'another-start',confirmed:true})
  expect(desktopActivityGate.busy()).toBe(true)
  host.emit(handle,{event:'desktop.session.ended',startId:'start',confirmed:true})
  expect(desktopActivityGate.busy()).toBe(false)
})

async function activeHost() {
  let handle = ''
  const stop = vi.fn(async () => {}), emit = vi.fn()
  const rpc = { closed: false, call: vi.fn(async (_method: string, value: any) => {
    if (value?.method === 'status') return { supported: true, enabled: true, displays: [], active: undefined }
    if (value?.method === 'capabilities') return []
    if (value?.method === 'stopAll') return stop()
    if (value?.method === 'invoke') { handle = value.context.handle; return { state: 'viewing', session: { startId: 'start' } } }
  }) }
  const host = new ControlDesktop({ supported: () => true, displays: () => [], indicator: { hide() {} }, arbiter: { release: async () => {} } } as any, async () => rpc as any)
  hosts.push(host)
  const authority: DesktopAuthority = { accountId: 'owner', deviceId: 'peer', authorizationId: 'grant', scopes: ['desktop.view'], current: () => true, emit }
  await host.invoke('desktop.session.start', { startId: 'start', origin: { kind: 'code', id: 'thread' }, displayToken: 'display', displayRevision: 'revision', quality: 'balanced' }, authority)
  return { host, stop, emit, handle, authority }
}

it('runs cleanup and releases ownership after an RPC failure while preserving that error', async () => {
  const { host, stop, handle, emit } = await activeHost(), error = new Error('stop RPC failed')
  stop.mockRejectedValueOnce(error)
  const cleanup = vi.spyOn(host.ports, 'cleanup'), release = vi.spyOn(desktopActivityGate, 'release')
  await expect(host.stopAll()).rejects.toBe(error)
  expect(cleanup).toHaveBeenCalledOnce()
  expect(desktopActivityGate.busy()).toBe(false)
  expect(release).toHaveBeenCalledExactlyOnceWith(host.id)
  host.emit(handle, { event: 'test' })
  expect(emit).not.toHaveBeenCalled()
})

it('retains ownership and contexts after cleanup fails and permits recovery on retry', async () => {
  const { host, handle, emit, authority } = await activeHost(), error = new Error('capture stop failed')
  const cleanup = vi.spyOn(host.ports, 'cleanup').mockRejectedValueOnce(error)
  const release = vi.spyOn(desktopActivityGate, 'release')
  await expect(host.stopAll()).rejects.toBe(error)
  expect(desktopActivityGate.busy()).toBe(true)
  expect(release).not.toHaveBeenCalled()
  host.emit(handle, { event: 'test' })
  expect(emit).toHaveBeenCalledOnce()
  await expect(host.invoke('desktop.access.get', {}, authority)).rejects.toThrow('DESKTOP_CLEANUP_UNCONFIRMED')
  await host.stopAll('cleanup_retry')
  expect(cleanup).toHaveBeenCalledTimes(2)
  expect(desktopActivityGate.busy()).toBe(false)
  expect(release).toHaveBeenCalledExactlyOnceWith(host.id)
  await expect(host.invoke('desktop.access.get', {}, authority)).resolves.toMatchObject({ busy: false })
  host.emit(handle, { event: 'test' })
  expect(emit).toHaveBeenCalledOnce()
})

it('preserves cleanup and RPC diagnostics together without releasing ownership when both fail', async () => {
  const { host, stop, authority } = await activeHost()
  const rpcError = new Error('stop RPC failed'), cleanupError = new Error('capture stop failed')
  stop.mockRejectedValueOnce(rpcError)
  vi.spyOn(host.ports, 'cleanup').mockRejectedValueOnce(cleanupError)
  const release = vi.spyOn(desktopActivityGate, 'release')
  const failure = await host.stopAll().then(() => undefined, (error: unknown) => error)
  expect(failure).toBeInstanceOf(AggregateError)
  expect((failure as AggregateError).message).toBe('DESKTOP_STOP_AND_CLEANUP_FAILED')
  expect((failure as AggregateError).errors).toEqual([cleanupError, rpcError])
  expect(desktopActivityGate.busy()).toBe(true)
  expect(release).not.toHaveBeenCalled()
  await expect(host.invoke('desktop.access.get', {}, authority)).rejects.toThrow('DESKTOP_CLEANUP_UNCONFIRMED')
  await host.stopAll('cleanup_retry')
  expect(release).toHaveBeenCalledExactlyOnceWith(host.id)
})

it('shares concurrent stops and releases ownership only once after cleanup completes', async () => {
  const { host, stop } = await activeHost()
  let finish!: () => void
  const cleanup = vi.spyOn(host.ports, 'cleanup').mockImplementationOnce(() => new Promise<void>(resolve => { finish = resolve }))
  const release = vi.spyOn(desktopActivityGate, 'release')
  const first = host.stopAll(), second = host.stopAll()
  expect(second).toBe(first)
  await vi.waitFor(() => expect(cleanup).toHaveBeenCalledOnce())
  expect(stop).toHaveBeenCalledOnce()
  expect(desktopActivityGate.busy()).toBe(true)
  expect(release).not.toHaveBeenCalled()
  finish(); await Promise.all([first, second])
  expect(release).toHaveBeenCalledExactlyOnceWith(host.id)
  expect(desktopActivityGate.busy()).toBe(false)
})
