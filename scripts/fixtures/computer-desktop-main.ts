import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { RemoteDesktopService, type DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { ElectronDesktopCapture } from '../../src/main/remote-desktop/capture-host'
import { DesktopInputArbiter } from '../../src/main/remote-desktop/input-arbiter'

app.setPath('userData',join(app.getAppPath(),'profile'))
app.on('window-all-closed',()=>{})
let service: RemoteDesktopService, receiver: BrowserWindow, captureWindow: BrowserWindow | undefined
let inputCount=0,releases=0
const states: unknown[]=[]
const authority={accountId:'fixture-owner',deviceId:'fixture-controller',hostId:'fixture-host',purpose:'desktop' as const,
  authorizationId:'fixture-authority',scopes:['desktop.view','desktop.control'],current:()=>true,
  emit:(value:unknown)=>{if(receiver&&!receiver.isDestroyed())receiver.webContents.send('fixture:event',value)}}
const timeout=setTimeout(()=>finish(Error('computer smoke timed out')),30000)
async function finish(error?:unknown) {
  clearTimeout(timeout)
  await service?.stopAll('fixture_ended').catch(()=>{})
  if(error)console.error(error instanceof Error?error.message:String(error))
  for(const window of BrowserWindow.getAllWindows())window.destroy()
  app.exit(error?1:0)
}
app.whenReady().then(async()=>{
  const deps:DesktopEngineDependencies={supported:()=>true,permissions:async()=>({screenRecording:'granted',accessibility:'granted'}),
    displays:()=>[{id:1,primary:true,fingerprint:'synthetic',label:'Synthetic display',pixelWidth:320,pixelHeight:200,rotation:0}],
    id:randomUUID,now:()=>performance.now(),ice:async()=>[],arbiter:new DesktopInputArbiter(),diagnostic:value=>states.push(value),
    authorizeOrigin:async(actor,origin)=>{assert.equal(actor.purpose,'desktop');assert.deepEqual(origin,{kind:'device',id:'fixture-host'})},
    input:()=>({start:async()=>{},ready:async()=>{},setupLease:async()=>{},lease:async()=>{},
      input:async value=>{assert.ok(['key','text.commit'].includes(String(value.type)));inputCount++},release:async()=>{releases++},stop:async()=>{releases++}}),
    capture:(id,receive)=>{
      const capture=new ElectronDesktopCapture(id,receive,()=>join(app.getAppPath(),'control'))
      const open=capture.open.bind(capture)
      capture.open=async()=>{
        await open()
        captureWindow=BrowserWindow.getAllWindows().find(window=>window.webContents.getURL().endsWith('/capture/index.html'))
        assert.ok(captureWindow);captureWindow.setSize(320,200)
        captureWindow.webContents.session.setDisplayMediaRequestHandler((request,callback)=>{
          assert.equal(request.frame,captureWindow!.webContents.mainFrame);callback({video:request.frame!})
        })
        await captureWindow.webContents.executeJavaScript(`(()=>{const c=document.createElement('canvas');c.width=320;c.height=200;document.body.appendChild(c);const x=c.getContext('2d');let n=0;setInterval(()=>{x.fillStyle='rgb('+((n++*13)%255)+',40,70)';x.fillRect(0,0,320,200)},100)})()`)
      }
      return capture
    }
  }
  service=new RemoteDesktopService(deps)
  await service.configureRemoteAccess(true)
  receiver=new BrowserWindow({show:false,webPreferences:{partition:'computer-fixture-receiver',preload:join(app.getAppPath(),'receiver-preload.cjs'),sandbox:true,nodeIntegration:false,contextIsolation:true,backgroundThrottling:false,autoplayPolicy:'no-user-gesture-required'}})
  receiver.webContents.session.setPermissionRequestHandler((_contents,_permission,callback)=>callback(false))
  receiver.webContents.session.setPermissionCheckHandler(()=>false)
  receiver.webContents.session.setDisplayMediaRequestHandler((_request,callback)=>callback({}))
  ipcMain.handle('fixture:invoke',(event,method,params)=>{assert.equal(event.sender,receiver.webContents);return service.invoke(method,params,authority)})
  ipcMain.handle('fixture:stats',()=>({inputCount,releases}))
  ipcMain.on('fixture:fail',(_event,value)=>{void finish(Error(value))})
  ipcMain.on('fixture:complete',async(event,value)=>{
    try {
      assert.equal(event.sender,receiver.webContents);assert.equal(value.phase,'ended')
      assert.ok(inputCount>=3);assert.ok(releases>0);assert.equal((await service.status()).active,undefined)
      assert.ok(captureWindow?.isDestroyed())
      console.log(JSON.stringify({computerDesktop:true,electron:process.versions.electron,realFrames:value.frames,viewBeforeControl:true,inputCount,keyboardReleased:true,hostCleanupConfirmed:true,states}))
      await finish()
    } catch(error){await finish(error)}
  })
  await receiver.loadFile(join(app.getAppPath(),'receiver.html'))
}).catch(finish)
