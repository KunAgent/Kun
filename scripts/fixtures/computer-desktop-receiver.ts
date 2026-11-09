import { DesktopSessionManager } from '@kun/control-runtime/controller'
import { BrowserDesktopPeer } from '../../src/renderer/src/computer-viewer/browser-peer'
import { validateDesktopParams, validateDesktopResult, type DesktopMethod, type DesktopParams } from '@kun/remote-protocol'

const fixture=(window as any).fixture, video=document.querySelector('video')!
let frames=0
const manager=new DesktopSessionManager({kind:'device',id:'fixture-host'},{id:()=>crypto.randomUUID(),current:()=>true,
  signal:{ice:async()=>({schemaVersion:1,iceServers:[],expiresAt:Date.now()+600000}),events:listener=>fixture.events(listener),
    invoke:async<M extends DesktopMethod>(method:M,params:DesktopParams[M])=>{validateDesktopParams(method,params);return validateDesktopResult(method,await fixture.invoke(method,params))}},
  peer:(_session,servers,events)=>new BrowserDesktopPeer(servers,video,events)})
const frame=()=>{frames++;if(manager.snapshot().phase==='negotiating')void manager.frameRendered({width:video.videoWidth,height:video.videoHeight});video.requestVideoFrameCallback(frame)}
video.requestVideoFrameCallback(frame)
async function until(check:()=>boolean|Promise<boolean>,message:string){const deadline=performance.now()+12000;while(!await check()){if(performance.now()>deadline)throw Error(message+': '+JSON.stringify(manager.snapshot()));await new Promise(resolve=>setTimeout(resolve,50))}}
void(async()=>{
  const displays=await manager.displays();await manager.open(displays[0])
  await until(()=>manager.snapshot().phase==='viewing'&&manager.snapshot().mediaStatus==='healthy'&&frames>=3,'video not ready')
  await manager.acquire();if(manager.snapshot().phase!=='controlling')throw Error('control not acquired')
  manager.input('key',{code:'KeyA',pressed:true});manager.input('key',{code:'KeyA',pressed:false});manager.input('text.commit',{text:'合成测试'})
  await until(async()=>(await fixture.stats()).inputCount>=3,'input did not reach bounded host sink')
  manager.release();await until(async()=>(await fixture.stats()).releases>0,'input not released')
  await manager.close('user_ended');await until(()=>manager.snapshot().phase==='ended','cleanup not confirmed')
  fixture.complete({phase:manager.snapshot().phase,frames})
})().catch((error:Error)=>{void manager.close('fixture_failed');fixture.fail(error.message)})
