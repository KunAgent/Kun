import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { ControlDesktop } from '../../src/main/control-host/desktop'
import { startControlProcess, type ControlProcess } from '../../src/main/control-host/process'
import { app, BrowserWindow, ipcMain, screen } from 'electron'
import { RemoteDesktopService, type DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { ElectronDesktopCapture } from '../../src/main/remote-desktop/capture-host'
import { createWindowsPrivacyDisplay } from './windows-privacy-display'
import { createPrivacyDisplay } from './mac-privacy-display'
import { exerciseViewerGameSwitch } from './computer-viewer-game'
import { DesktopInputArbiter } from '../../src/main/remote-desktop/input-arbiter'

app.setPath('userData',join(app.getAppPath(),'profile'))
app.on('window-all-closed',()=>{})
let service: RemoteDesktopService, receiver: BrowserWindow, captureWindow: BrowserWindow | undefined
let controlProcess: ControlProcess | undefined
let inputCount=0,releases=0
const states: unknown[]=[]
const privacy = process.env.KUN_FIXTURE_PRIVACY === '1'
let privacyDisplay: Awaited<ReturnType<typeof createPrivacyDisplay>> | undefined
const gaming=process.env.KUN_FIXTURE_GAME==='1'
const measureSeconds=Number(process.env.KUN_FIXTURE_SECONDS)||0
const authority={accountId:'fixture-owner',deviceId:'fixture-controller',hostId:'fixture-host',...(privacy ? {} : {purpose:'desktop' as const}),
  authorizationId:'fixture-authority',scopes:['desktop.view','desktop.control'],current:()=>true,
  emit:(value:unknown)=>{if(privacy && (value as any).event !== 'desktop.signal.ice') states.push(value); if(receiver&&!receiver.isDestroyed())receiver.webContents.send('fixture:event',value)}}
const timeout=setTimeout(()=>finish(Error('computer smoke timed out')),measureSeconds*1000+(process.env.KUN_FIXTURE_VIEWER==='1'?55000:30000))
async function finish(error?:unknown) {
  clearTimeout(timeout)
  await service?.stopAll('fixture_ended').catch(()=>{})
  await controlProcess?.stop()
  await privacyDisplay?.stop()
  if(error)console.error(error instanceof Error?error.message:String(error), JSON.stringify(states))
  for(const window of BrowserWindow.getAllWindows())window.destroy()
  app.exit(error?1:0)
}
app.whenReady().then(async()=>{
  if (privacy) privacyDisplay = process.platform === 'win32' ? await createWindowsPrivacyDisplay() : await createPrivacyDisplay()
  const deps:DesktopEngineDependencies={supported:()=>true, privacySupported:()=>privacy, gameSupported:()=>gaming, systemAudioAllowed:()=>gaming, permissions:async()=>({screenRecording:'granted',accessibility:'granted'}),
    displays:()=>[{id:privacyDisplay?.id ?? 1,primary:true,fingerprint:'synthetic',label:'Synthetic display',pixelWidth:measureSeconds?1920:320,pixelHeight:measureSeconds?1080:200,rotation:0}],
    id:randomUUID,now:()=>performance.now(),ice:async()=>[],arbiter:new DesktopInputArbiter(),diagnostic:value=>states.push(value),
    authorizeOrigin:async(actor,origin)=>{assert.equal(actor.purpose,privacy ? undefined : 'desktop');assert.deepEqual(origin,privacy ? {kind:'code',id:'fixture-thread'} : {kind:'device',id:'fixture-host'})},
    input:()=>({start:async()=>{},ready:async()=>{},setupLease:async()=>{},lease:async()=>{},
      input:async value=>{assert.ok(['key','text.commit','pointer.relative','pointer.gameButton'].includes(String(value.type)));inputCount++;if(privacyDisplay) await privacyDisplay.green()},release:async()=>{releases++},stop:async()=>{releases++}}),
    capture:(id,receive)=>{
      let frames: ReturnType<typeof setInterval> | undefined
      const portal = process.env.KUN_FIXTURE_PORTAL === '1' ? {
        selection:{grantId:'fixture',width:320,height:200,logicalWidth:320,logicalHeight:200,input:true},
        video:async (send:(data:Buffer,consumed:()=>void)=>void)=>{
          let ready=true,index=0
          frames=setInterval(()=>{
            if(!ready)return
            const data=Buffer.alloc(320*200*3/2,128)
            data.fill(32 + ((index++ * 5) % 180),0,320*200)
            ready=false;send(data,()=>{ready=true})
          },17)
        },
        detach:()=>clearInterval(frames)
      } : undefined
      const capture=new ElectronDesktopCapture(id,receive,()=>join(app.getAppPath(),'control'),portal, samples=>{
        let timer: ReturnType<typeof setInterval> | undefined, phase=0
        return { async start() {
          timer=setInterval(()=>{
            const pcm=new Float32Array(960*2)
            for(let frame=0;frame<960;frame++) pcm[frame*2]=pcm[frame*2+1]=Math.sin(phase++*Math.PI/55)*0.2
            samples(new Uint8Array(pcm.buffer))
          },20)
        }, async stop(){clearInterval(timer)} }
      }, false)
      const open=capture.open.bind(capture)
      capture.open=async()=>{
        await open()
        captureWindow=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/capture/index.html'))
        assert.ok(captureWindow)
        const scale = screen.getDisplayMatching(captureWindow.getBounds()).scaleFactor
        captureWindow.setContentSize(measureSeconds ? Math.round(1920 / scale) : 320, measureSeconds ? Math.round(1080 / scale) : 200)
        if (privacy) return // Exercise the production approved-screen selector on the synthetic display.
        captureWindow.webContents.session.setDisplayMediaRequestHandler((request,callback)=>{
          assert.equal(request.frame,captureWindow!.webContents.mainFrame);callback({video:request.frame!, ...(request.audioRequested ? { audio:request.frame! } : {})})
        })
        await captureWindow.webContents.executeJavaScript(`(()=>{
          const c=document.createElement('canvas');c.width=${measureSeconds?1920:320};c.height=${measureSeconds?1080:200}
          document.body.style.margin='0';Object.assign(c.style,{position:'fixed',inset:'0',width:'100vw',height:'100vh'})
          document.body.appendChild(c)
          const x=c.getContext('2d');let n=0
          function draw(){
            n++;x.fillStyle='#172940';x.fillRect(0,0,c.width,c.height)
            for(let i=0;i<48;i++){
              x.fillStyle='hsl('+((i*13+n)%360)+' 75% 55%)'
              x.fillRect((n*(i%5+2)+i*97)%c.width,(i*83)%c.height,c.width/8,c.height/12)
            }
          }
          draw()
          if(${Boolean(measureSeconds)}) {
            // Request each real canvas frame once. Two independent 60 Hz sampling clocks can otherwise miss frames.
            let sourceTrack, next=performance.now()
            function paint(){
              draw();sourceTrack?.requestFrame()
              next=Math.max(next+1000/60,performance.now());setTimeout(paint,Math.max(0,next-performance.now()))
            }
            paint()
            navigator.mediaDevices.getDisplayMedia=async()=>{
              const stream=c.captureStream(0);sourceTrack=stream.getVideoTracks()[0];sourceTrack.requestFrame()
              return stream
            }
            const Peer=window.RTCPeerConnection
            window.RTCPeerConnection=class extends Peer {
              constructor(...args){super(...args);window.fixturePc=this}
            }
          } else setInterval(draw,100)
        })()`)
      }
      return capture
    }
  }
  if (privacy) {
    const directory = join(app.getAppPath(), 'control')
    const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
    const host = new ControlDesktop(deps, async () => controlProcess!.rpc)
    controlProcess = await startControlProcess(directory, manifest, { 'desktop.port': value => host.ports.call(value) },
      (name, value) => {
        if (name === 'desktop.emit') host.emit(value.handle, value.event)
        if (name === 'desktop.diagnostic') states.push(value.value)
      }, () => {})
    await host.attach(controlProcess.rpc)
    service = host
  } else service=new RemoteDesktopService(deps)
  await service.configureRemoteAccess(true)
  receiver=new BrowserWindow({show:false,webPreferences:{partition:'computer-fixture-receiver',preload:join(app.getAppPath(),'receiver-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}})
  receiver.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  receiver.webContents.session.setPermissionCheckHandler(()=>false)
  receiver.webContents.session.setDisplayMediaRequestHandler((_request,callback)=>callback({}))
  ipcMain.handle('fixture:invoke',(event,method,params)=>{assert.equal(event.sender,receiver.webContents);return service.invoke(method,params,authority)})
  ipcMain.handle('fixture:local-color', (event, kind) => { assert.equal(event.sender,receiver.webContents); return privacyDisplay!.requireColor(kind) })
  ipcMain.handle('fixture:stats',()=>({inputCount,releases}))
  ipcMain.handle('fixture:sender-stats', async()=>!captureWindow || captureWindow.isDestroyed() ? null : captureWindow.webContents.executeJavaScript(`(async()=>{
    const pc=window.fixturePc
    const sender=pc?.getSenders().find(s=>s.track?.kind==='video')
    if(!sender)return {}
    const reports=await pc.getStats(), video=[...reports.values()].find(s=>s.type==='outbound-rtp'&&s.kind==='video')
    const source=reports.get(video?.mediaSourceId),transport=reports.get(video?.transportId),pair=reports.get(transport?.selectedCandidatePairId)
    const settings=sender.track.getSettings(), remote=reports.get(video?.remoteId), codec=reports.get(video?.codecId)
    const path=pair && reports.get(pair.localCandidateId)
    const firstCodec=description=>{
      const line=description?.sdp.split('\\r\\n').find(value=>value.startsWith('m=video '))
      const id=line?.split(' ')[3]
      return description?.sdp.split('\\r\\n').filter(value=>value.startsWith('a=rtpmap:'+id+' ')||value.startsWith('a=fmtp:'+id+' ')).join(' ')
    }
    return {framesEncoded:video?.framesEncoded,framesSent:video?.framesSent,encodedWidth:video?.frameWidth,
      encodedHeight:video?.frameHeight,reason:video?.qualityLimitationReason,codec:codec?.mimeType,fmtp:codec?.sdpFmtpLine,
      preferredOffer:firstCodec(pc.localDescription),preferredAnswer:firstCodec(pc.remoteDescription),transport:path?.protocol,route:path?.candidateType,rttMs:1000*(pair?.currentRoundTripTime??0),lost:remote?.packetsLost,
      sourceFps:source?.framesPerSecond,encoder:video?.encoderImplementation,hardware:video?.powerEfficientEncoder,
      sourceFrames:source?.frames,sourceWidth:settings.width,sourceHeight:settings.height,
      bitrateBudget:pair?.availableOutgoingBitrate,targetBitrate:video?.targetBitrate, maxBitrate:sender.getParameters().encodings[0]?.maxBitrate}
  })()`))
  ipcMain.on('fixture:fail',(_event,value)=>{void finish(Error(value))})
  ipcMain.on('fixture:complete',async(event,value)=>{
    try {
      assert.equal(event.sender,receiver.webContents);assert.equal(value.phase,'ended')
      assert.ok(inputCount>=3);assert.ok(releases>0);assert.equal((await service.status()).active,undefined)
      assert.ok(captureWindow?.isDestroyed())
      if (privacyDisplay) await privacyDisplay.requireColor('green')
      console.log(JSON.stringify({computerDesktop:true,privacyScreen:privacy,abruptDisconnect:value.abruptDisconnect===true,electron:process.versions.electron,realFrames:value.frames,viewBeforeControl:true,inputCount,keyboardReleased:true,hostCleanupConfirmed:true,portalFrames:process.env.KUN_FIXTURE_PORTAL==='1',gameAudio:value.gameAudio,measurement:value.measurement,states}))
      await finish()
    } catch(error){await finish(error)}
  })
  if(process.env.KUN_FIXTURE_VIEWER==='1'){
    ipcMain.on('fixture:heartbeat',event=>event.sender.send('fixture:lease'))
    ipcMain.handle('fixture:restart',async()=>{assert.equal((await service.status()).active,undefined)})
    await receiver.loadFile(join(app.getAppPath(),'control/viewer/index.html'))
    await exerciseViewerGameSwitch(receiver)
    console.log(JSON.stringify({computerDesktop:true,viewerGameSwitch:true,gameAudio:true,returnedToOffice:true}))
    await finish()
  }else await receiver.loadFile(join(app.getAppPath(),'receiver.html'))
}).catch(finish)
