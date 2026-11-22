import { measureMotion } from './stream-performance'
import { DesktopSessionManager } from '@kun/control-runtime/controller'
import { BrowserDesktopPeer } from '../../src/renderer/src/computer-viewer/browser-peer'
import { validateDesktopParams, validateDesktopResult, type DesktopMethod, type DesktopParams } from '@kun/remote-protocol'

const fixture=(window as any).fixture, video=document.querySelector('video')!
let frames=0, measuredPeer: BrowserDesktopPeer | undefined
const manager=new DesktopSessionManager({kind:'device',id:'fixture-host'},{id:()=>crypto.randomUUID(),current:()=>true,
  signal:{ice:async()=>({schemaVersion:1,iceServers:[],expiresAt:Date.now()+600000}),events:listener=>fixture.events(listener),
    invoke:async<M extends DesktopMethod>(method:M,params:DesktopParams[M])=>{validateDesktopParams(method,params);return validateDesktopResult(method,await fixture.invoke(method,params))}},
  peer:(_session,servers,events)=>(measuredPeer=new BrowserDesktopPeer(servers,video,events, fixture.gaming))})
const frame=()=>{frames++;if(manager.snapshot().phase==='negotiating')void manager.frameRendered({width:video.videoWidth,height:video.videoHeight});video.requestVideoFrameCallback(frame)}
video.requestVideoFrameCallback(frame)
async function until(check:()=>boolean|Promise<boolean>,message:string){const deadline=performance.now()+12000;while(!await check()){if(performance.now()>deadline)throw Error(message+': '+JSON.stringify(manager.snapshot()));await new Promise(resolve=>setTimeout(resolve,50))}}
void(async()=>{
  const displays=await manager.displays();await manager.open(displays[0],fixture.gaming?'game60':'balanced')
  await until(()=>manager.snapshot().phase==='viewing'&&manager.snapshot().mediaStatus==='healthy'&&frames>=3,'video not ready')
  let gameAudio = false
  if (fixture.gaming) {
    const media = video.srcObject as MediaStream
    if (media.getAudioTracks().length !== 1) throw Error('missing negotiated system output')
    const context = new AudioContext(), meter=context.createAnalyser()
    context.createMediaStreamSource(media).connect(meter)
    const samples = new Float32Array(meter.fftSize)
    await context.resume()
    await until(()=>{meter.getFloatTimeDomainData(samples);return samples.some(x=>Math.abs(x)>0.02)}, 'system audio not decoded')
    gameAudio=true; await context.close()
  }
  await until(async()=>{
    if(manager.snapshot().mediaStatus!=='healthy')return false
    try {await manager.acquire()} catch(error) {
      if(String(error).includes('DESKTOP_CONTROL_REQUIRED'))return false
      throw error
    }
    return manager.snapshot().phase==='controlling'
  },'control not acquired on fresh media')
  manager.input('key',{code:'KeyA',pressed:true});manager.input('key',{code:'KeyA',pressed:false});manager.input('text.commit',{text:'合成测试'})
  if (fixture.gaming) {
    manager.input('pointer.relative',{deltaX:20,deltaY:-5})
    manager.input('pointer.gameButton',{button:'left',pressed:true})
    manager.input('pointer.gameButton',{button:'left',pressed:false})
  }
  await until(async()=>(await fixture.stats()).inputCount>=(fixture.gaming?6:3),'input did not reach bounded host sink')
  manager.release();await until(async()=>(await fixture.stats()).releases>0,'input not released')
  const measurement=fixture.measureSeconds ? await measureMotion(fixture.measureSeconds,video,()=>frames,
    ()=>manager.snapshot(),()=>measuredPeer?.videoSample(),()=>fixture.senderStats()) : undefined
  await manager.close('user_ended');await until(()=>manager.snapshot().phase==='ended','cleanup not confirmed')
  fixture.complete({phase:manager.snapshot().phase,frames,gameAudio,measurement})
})().catch((error:Error)=>{void manager.close('fixture_failed');fixture.fail(error.message)})
