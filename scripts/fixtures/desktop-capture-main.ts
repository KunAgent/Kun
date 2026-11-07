import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { ControlDesktop } from '../../src/main/control-host/desktop'
import { startControlProcess, type ControlProcess } from '../../src/main/control-host/process'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain } from 'electron'
import { ElectronDesktopCapture } from '../../src/main/remote-desktop/capture-host'
import { RemoteDesktopService, type DesktopEngineDependencies } from '@kun/control-runtime/desktop'
import { NativeDesktopInput } from '../../src/main/remote-desktop/native-input'
import { DesktopInputArbiter } from '../../src/main/remote-desktop/input-arbiter'

app.setPath('userData', join(app.getAppPath(), 'profile'))
app.on('window-all-closed', () => {})
const baseline = process.env.KUN_CAPTURE_EXPECT_LOAD_FAILURE === '1'
const timeout = setTimeout(() => { console.error('Packaged capture smoke timed out'); app.exit(1) }, 30000)
let receiver: BrowserWindow | undefined
let service: RemoteDesktopService
let controlProcess: ControlProcess | undefined
let controlDesktop: ControlDesktop | undefined
let captureWindow: BrowserWindow | undefined
let answered = false
let session: any
const pendingIce: unknown[] = [], states: unknown[] = [], errors: string[] = []
const authority = { accountId: 'fixture-account', deviceId: 'fixture-phone', authorizationId: 'fixture-grant',
  scopes: ['desktop.view'], current: () => true, emit: (event: any) => {
    if (event.event === 'desktop.signal.ice' && receiver) {
      for (const candidate of event.candidates) void receiver.webContents.executeJavaScript(`window.fixturePeer.addIceCandidate(${JSON.stringify(candidate)})`).catch(() => errors.push('host_ice_failed'))
    }
    if (event.event === 'desktop.session.ended') states.push({ ended: event.reason })
  } }

async function deliverIce(candidate: unknown) {
  await service.invoke('desktop.signal.ice', { sessionId: session.sessionId, epoch: session.epoch,
    candidates: candidate ? [candidate] : [], complete: !candidate }, authority)
}

app.whenReady().then(async () => {
  try {
    const dependencies: DesktopEngineDependencies = { supported: () => true,
      permissions: async () => ({ screenRecording: 'granted', accessibility: 'denied' }),
      displays: () => [{ id: 1, fingerprint: 'fixture-display', label: 'Synthetic fixture', pixelWidth: 320, pixelHeight: 200, rotation: 0 }],
      capture: (id, receive) => {
        const capture = new ElectronDesktopCapture(id, receive, process.env.KUN_CAPTURE_CONTROL_DIRECTORY ? () => process.env.KUN_CAPTURE_CONTROL_DIRECTORY! : undefined), open = capture.open.bind(capture)
        capture.open = async () => {
          await open()
          captureWindow = BrowserWindow.getAllWindows().find(window => (window.webContents.getURL().endsWith('/remote-desktop-capture.html') || window.webContents.getURL().endsWith('/capture/index.html')))
          assert.ok(captureWindow)
          captureWindow.setSize(320, 200)
          // Capture only this test renderer. Never enumerate or select an OS screen.
          captureWindow.webContents.session.setDisplayMediaRequestHandler((request, callback) => {
            assert.equal(request.frame, captureWindow!.webContents.mainFrame)
            callback({ video: request.frame! })
          })
          await captureWindow.webContents.executeJavaScript(`(() => {
            const canvas=document.createElement('canvas');canvas.width=320;canvas.height=200;document.body.appendChild(canvas);
            const c=canvas.getContext('2d');let x=0;setInterval(()=>{c.fillStyle='rgb('+((x++*7)%255)+',40,80)';c.fillRect(0,0,320,200)},100);
          })()`)
        }
        return capture
      },
      input: lost => new NativeDesktopInput(lost), ice: async () => [], authorizeOrigin: async () => {},
      id: randomUUID, now: () => performance.now(), arbiter: new DesktopInputArbiter(), diagnostic: value => states.push(value)
    }
    if (process.env.KUN_CAPTURE_USE_CONTROL_PROCESS === '1') {
      const directory = process.env.KUN_CAPTURE_CONTROL_DIRECTORY!
      const manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'))
      controlProcess = await startControlProcess(directory, manifest, { 'desktop.port': value => controlDesktop!.ports.call(value) },
        (name, value) => { if (name === 'desktop.emit') controlDesktop!.emit(value.handle, value.event); if (name === 'desktop.diagnostic') states.push(value.value) }, () => errors.push('control_process_exited'))
      controlDesktop = new ControlDesktop(dependencies, async () => controlProcess!.rpc)
      service = controlDesktop
    } else service = new RemoteDesktopService(dependencies)
    const display = (await service.status()).displays[0]
    await service.configure({ enabled: true, displayTokens: [display.token] })
    const result: any = await service.invoke('desktop.session.start', { startId: randomUUID(), origin: { kind: 'code', id: 'fixture-thread' },
      displayToken: display.token, displayRevision: display.revision, quality: 'balanced' }, authority)
    if (baseline) throw Error('Expected the old packaged path to fail')
    session = result.session
    receiver = new BrowserWindow({ show: false, webPreferences: { partition: 'fixture-receiver',
      preload: join(app.getAppPath(), 'receiver-preload.cjs'), sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false, autoplayPolicy: 'no-user-gesture-required' } })
    ipcMain.on('fixture:ice', (event, candidate) => {
      if (event.sender !== receiver?.webContents) return
      if (!answered) pendingIce.push(candidate)
      else void deliverIce(candidate).catch(() => errors.push('receiver_ice_failed'))
    })
    await receiver.loadFile(join(app.getAppPath(), 'receiver.html'))
    const answer = await receiver.webContents.executeJavaScript(`(async () => {
      const session=${JSON.stringify(session)}, pc=new RTCPeerConnection({iceServers:[]});window.fixturePeer=pc;
      const video=document.querySelector('video');video.muted=true;let seq=0;
      window.fixtureState={frames:0,probes:0,ready:false,health:0};
      function frame(){window.fixtureState.frames++;video.requestVideoFrameCallback(frame)}video.requestVideoFrameCallback(frame);
      pc.ontrack=e=>{video.srcObject=e.streams[0]||new MediaStream([e.track]);void video.play()};
      pc.onicecandidate=e=>window.fixture.candidate(e.candidate?e.candidate.toJSON():null);
      pc.ondatachannel=e=>{const c=e.channel;if(c.label==='kun.desktop.control.v1'){
        const send=value=>c.send(JSON.stringify({v:1,sessionId:session.sessionId,epoch:session.epoch,seq:++seq,...value}));
        c.onopen=()=>send({type:'hello'});
        c.onmessage=e=>{const m=JSON.parse(e.data);if(m.type==='ready')window.fixtureState.ready=true;
          if(m.type==='media.health')window.fixtureState.health++;
          if(m.type==='probe'){window.fixtureState.probes++;send({type:'probe.ack',challenge:m.challenge})}}
      }};
      await pc.setRemoteDescription(${JSON.stringify(result.offer)});const answer=await pc.createAnswer();await pc.setLocalDescription(answer);
      return {type:'answer',sdp:answer.sdp};
    })()`)
    await service.invoke('desktop.session.answer', { sessionId: session.sessionId, epoch: session.epoch, answer }, authority)
    answered = true
    for (const candidate of pendingIce.splice(0)) await deliverIce(candidate)
    const limit = performance.now() + 10000
    let media: any
    do {
      media = await receiver.webContents.executeJavaScript('window.fixtureState')
      if (media.ready && media.frames >= 3 && media.probes >= 2 && media.health > 0) break
      await new Promise(resolve => setTimeout(resolve, 100))
    } while (performance.now() < limit)
    assert.ok(media.ready && media.frames >= 3 && media.probes >= 2 && media.health > 0, JSON.stringify({ media, states, errors }))
    assert.deepEqual(errors, [])
    const ended: any = await service.invoke('desktop.session.stop', { sessionId: session.sessionId, observedEpoch: session.epoch, reason: 'user_ended' }, authority)
    assert.equal(ended.confirmed, true)
    assert.equal((await service.status()).active, undefined)
    assert.ok(captureWindow!.isDestroyed())
    await receiver.webContents.executeJavaScript('window.fixturePeer.close();document.querySelector("video").srcObject=null')
    await controlProcess?.stop()
    console.log(JSON.stringify({ controlProcess: Boolean(controlProcess?.exited), electron: process.versions.electron, capturePageLoaded: true, media, hostCleanupConfirmed: true, states }))
    clearTimeout(timeout); receiver.destroy(); app.exit(0)
  } catch (error) {
    await service?.stopAll('host_stopped').catch(() => {})
    await controlProcess?.stop().catch(() => {})
    const expected = baseline && error instanceof Error && error.message.includes('ERR_FILE_NOT_FOUND')
    console.log(JSON.stringify({ baselineRejected: expected, error: expected ? 'ERR_FILE_NOT_FOUND' : error instanceof Error ? error.message : 'unknown', states, errors }))
    clearTimeout(timeout)
    for (const window of BrowserWindow.getAllWindows()) window.destroy()
    app.exit(expected ? 0 : 1)
  }
})
