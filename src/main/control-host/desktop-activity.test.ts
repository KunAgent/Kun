import { afterEach, expect, it, vi } from 'vitest'
import { ControlDesktop } from './desktop'
import { desktopActivityGate } from '../remote-desktop/activity-gate'

const hosts: ControlDesktop[] = []
afterEach(async () => { for (const host of hosts.splice(0)) await host.stopAll() })
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
