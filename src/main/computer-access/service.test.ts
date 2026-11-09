import { afterEach, describe, expect, it, vi } from 'vitest'
import { ComputerAccessService } from './service'
import { DesktopActivityGate } from '../remote-desktop/activity-gate'
import { DESKTOP_DEVICE_CAPABILITY, DESKTOP_SCOPED_CAPABILITY, type Socket, type Frame } from '@kun/remote-protocol'

const host = '11111111-1111-4111-8111-111111111111', controller = '22222222-2222-4222-8222-222222222222'
const target = '33333333-3333-4333-8333-333333333333', owner = '44444444-4444-4444-8444-444444444444', grant = '55555555-5555-4555-8555-555555555555'
const alive: ComputerAccessService[] = []
afterEach(async () => { for (const service of alive.splice(0)) await service.dispose() })
function fixture(tier = 'max') {
  const calls: Array<{path:string; device:string; body:any}> = [], invokes: any[] = []
  const gate = new DesktopActivityGate()
  let online: Socket | undefined, denyStop = false, currentSession: any
  const frame = (value: Frame) => online?.onmessage?.({data:JSON.stringify({v:1,...value})})
  const service = new ComputerAccessService({ supported:true, name:'Local Mac', origin:'https://api.example.test', gate,
    account: { getState:async()=>({status:'authenticated',user:{id:owner}}),accessToken:async()=>'token',onState:()=>()=>{},onSessionEnding:()=>()=>{} } as any,
    identity:async(_owner,role)=>({id:role==='host'?host:controller,credential:'a'.repeat(64)}),
    fetch:async(input,init)=>{
      const path=new URL(String(input)).pathname, body=init?.body?JSON.parse(String(init.body)):null
      calls.push({path,body,device:new Headers(init?.headers).get('X-Kun-Device')!})
      const payload = path.endsWith('/entitlements') ? {version:1,userId:owner,tier,effectiveTier:tier,status:tier==='free'?'free':'active',expiresAt:null,checkedAt:new Date().toISOString(),revision:1,features:{mobileRemote:tier!=='free',personalAssistant:['pro','max'].includes(tier)}}
        : path.endsWith('/capabilities') ? {desktop:{computerAccess:true}}
        : path.endsWith('/desktop/devices') ? {devices:[{id:target,installationId:target,name:'Remote Mac',platform:'macos',enabled:true,supported:true,online:true,grantId:grant}]}
        : path.endsWith('/relay-tickets') ? {ticket:'ticket',url:'wss://api.example.test/api/remote/v1/ws'}
        : {ok:true}
      return Response.json(payload)
    },
    socket:()=>{
      const socket: Socket = {onopen:null,onmessage:null,onerror:null,onclose:null,close(){},send(raw){
        const value=JSON.parse(raw)
        if(value.kind!=='invoke') return
        invokes.push(value.payload)
        const {method,params}=value.payload
        let payload:any
        if(method==='desktop.access.get') payload={capabilities:[DESKTOP_DEVICE_CAPABILITY,DESKTOP_SCOPED_CAPABILITY],supported:true,enabled:true,viewAllowed:true,controlAllowed:true,busy:false}
        else if(method==='desktop.session.start') {
          currentSession={schemaVersion:1,startId:params.startId,sessionId:'session',epoch:1,authorizationId:'authority',origin:params.origin,
            display:{token:'display',revision:'revision',pixelWidth:1280,pixelHeight:720,rotation:0},mode:'view',controlAllowed:true,heartbeatMs:2000,setupTimeoutMs:15000,expiresInMs:6000}
          payload={state:'negotiating',session:currentSession,offer:{type:'offer',sdp:'v=0\r\n'}}
        } else if(method==='desktop.session.stop') payload=denyStop?{error:{code:'DESKTOP_CLEANUP_UNCONFIRMED'}}:{state:'ended',startId:currentSession.startId,sessionId:'session',reason:'user_ended',confirmed:true}
        else if(method==='desktop.session.get') payload=denyStop?{state:'viewing',session:currentSession}:{state:'ended',startId:currentSession.startId,sessionId:'session',reason:'user_ended',confirmed:true}
        else payload={mode:'view',controlEpoch:2}
        queueMicrotask(()=>frame({kind:'result',src:target,id:value.id,payload}))
      }}
      online=socket
      queueMicrotask(()=>frame({kind:'hello',payload:{leaseExpiresAt:Date.now()+60000}}))
      return socket
    }
  })
  alive.push(service)
  return {service,gate,calls,invokes,frame,denyStop:(value:boolean)=>{denyStop=value},setTier:(value:string)=>{tier=value}}
}
describe('trusted computer controller',()=>{
  for (const tier of ['free','plus','pro']) it(`blocks ${tier} before creating or registering controller credentials`,async()=>{
    const f=fixture(tier)
    await expect(f.service.refresh()).rejects.toMatchObject({code:'vip_computer_remote_required',status:403})
    expect(f.calls.every(call=>call.path.endsWith('/entitlements'))).toBe(true)
    expect(f.gate.busy()).toBe(false)
  })
  it('rejects an old login snapshot before registering any identity under a new account',async()=>{
    let resolve!: (value: any) => void, observe!: (value: any) => void
    const identity=vi.fn(), fetcher=vi.fn()
    const service=new ComputerAccessService({supported:true,name:'Mac',origin:'https://api.example.test',identity,fetch:fetcher,
      account:{getState:()=>new Promise(done=>{resolve=done}),accessToken:async()=>'new-token',onState:(listener:(value:unknown)=>void)=>{observe=listener;return()=>{}},onSessionEnding:()=>()=>{}} as any,
      socket:()=>{throw Error('unexpected socket')}})
    alive.push(service)
    const loading=service.refresh()
    observe({status:'authenticated',user:{id:target}})
    resolve({status:'authenticated',user:{id:owner}})
    await expect(loading).rejects.toThrow('ACCOUNT_CHANGED')
    expect(identity).not.toHaveBeenCalled();expect(fetcher).not.toHaveBeenCalled()
  })
  it('keeps the existing host identity off and registers a separate controller endpoint',async()=>{
    const f=fixture();await f.service.refresh();await new Promise(resolve=>setTimeout(resolve,10))
    expect(f.calls.find(call=>call.path.endsWith('/desktop/controller'))).toMatchObject({device:host,body:{deviceId:controller}})
    expect(f.calls.find(call=>call.path.endsWith('/desktop/devices'))?.device).toBe(controller)
    expect(f.calls.some(call=>call.path.endsWith('/devices/enabled'))).toBe(false)
    await f.service.open(target);expect(f.gate.outgoing()).toBe(true)
    await expect(f.service.invoke('desktop.session.start',{startId:'start',origin:{kind:'device',id:host},displayToken:'display',displayRevision:'revision',quality:'balanced'})).rejects.toThrow('DESKTOP_AUTHORITY_CHANGED')
    await expect(f.service.invoke('catalog.get' as any,{})).rejects.toThrow('DESKTOP_UNSUPPORTED')
    await f.service.close();expect(f.gate.busy()).toBe(false)
  })
  it('retains the cleanup gate until a matching authoritative ended result arrives',async()=>{
    const f=fixture();await f.service.refresh();await new Promise(resolve=>setTimeout(resolve,10));await f.service.open(target)
    await f.service.invoke('desktop.session.start',{startId:'start',origin:{kind:'device',id:target},displayToken:'display',displayRevision:'revision',quality:'balanced'})
    f.denyStop(true);await f.service.close()
    expect(f.service.status().active?.phase).toBe('unconfirmed');expect(f.gate.busy()).toBe(true)
    f.frame({kind:'event',src:host,payload:{event:'desktop.session.ended',startId:'start',sessionId:'session',epoch:1,confirmed:true,reason:'forged'}})
    expect(f.gate.busy()).toBe(true)
    await expect(f.service.open(target)).rejects.toThrow('DESKTOP_CLEANUP_UNCONFIRMED')
    f.denyStop(false);await f.service.confirmClosed()
    expect(f.service.status().active).toBeUndefined();expect(f.gate.busy()).toBe(false)
  })
  it('checks a fresh Max entitlement before acquisition and closes the existing session on downgrade',async()=>{
    const f=fixture();await f.service.refresh();await new Promise(resolve=>setTimeout(resolve,10));await f.service.open(target)
    await f.service.invoke('desktop.session.start',{startId:'start',origin:{kind:'device',id:target},displayToken:'display',displayRevision:'revision',quality:'balanced'})
    f.setTier('pro')
    await expect(f.service.invoke('desktop.control.acquire',{sessionId:'session',epoch:1})).rejects.toThrow('vip_computer_remote_required')
    await vi.waitFor(()=>expect(f.service.status().active).toBeUndefined())
    expect(f.invokes.some(call=>call.method==='desktop.control.acquire')).toBe(false)
    expect(f.gate.busy()).toBe(false)
  })
})
