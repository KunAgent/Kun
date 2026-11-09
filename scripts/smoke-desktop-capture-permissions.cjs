const assert = require('node:assert/strict')
const { app, BrowserWindow } = require('electron')
const { mkdtempSync, rmSync, writeFileSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { buildSync } = require('esbuild')

// Real Electron permission dispatch, using only this fixture's own web contents.
// It never selects a desktop screen, opens camera/microphone, or loads user data.
const temporary = mkdtempSync(join(tmpdir(), 'kun-capture-permissions-'))
app.setPath('userData', join(temporary, 'profile'))
app.on('window-all-closed', () => {})
writeFileSync(join(temporary, 'capture.html'), '<!doctype html><title>Kun capture permission fixture</title><body style="background:blue">Synthetic capture fixture</body>')
buildSync({ entryPoints: [join(__dirname, '../src/main/remote-desktop/capture-permissions.ts')],
  bundle: true, platform: 'node', format: 'cjs', outfile: join(temporary, 'policy.cjs') })
const { permitsDesktopCapture } = require(join(temporary, 'policy.cjs'))

async function scenario(mode, camera = false) {
  const window = new BrowserWindow({ show: false, width: 320, height: 200,
    webPreferences: { partition: `capture-permission-${mode}-${camera}`, sandbox: true, contextIsolation: true,
      nodeIntegration: false, backgroundThrottling: false } })
  const requests = [], checks = []
  let selectedOwnFrame = false
  const session = window.webContents.session
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    requests.push({ permission, mediaTypes: details.mediaTypes })
    callback(contents === window.webContents && (mode === 'old'
      ? permission === 'display-capture' : permitsDesktopCapture(permission, details, 'request')))
  })
  session.setPermissionCheckHandler((contents, permission, _origin, details) => {
    checks.push({ permission, mediaType: details.mediaType })
    return contents === window.webContents && (mode === 'old'
      ? permission === 'display-capture' : permitsDesktopCapture(permission, details, 'check'))
  })
  session.setDisplayMediaRequestHandler((request, callback) => {
    if (request.frame !== window.webContents.mainFrame || request.audioRequested || !request.videoRequested) return callback({})
    selectedOwnFrame = true
    callback({ video: request.frame })
  })
  try {
    await window.loadFile(join(temporary, 'capture.html'))
    const result = await window.webContents.executeJavaScript(`(async () => {
      try {
        const stream = await navigator.mediaDevices.${camera ? 'getUserMedia' : 'getDisplayMedia'}({video:true,audio:false});
        const track=stream.getVideoTracks()[0]; const live=track.readyState==='live';
        for(const t of stream.getTracks())t.stop();
        return {live,ended:track.readyState==='ended'};
      } catch(error) {return {error:error.name};}
    })()`)
    return { mode, camera, requests, checks, selectedOwnFrame, ...result }
  } finally { window.destroy() }
}

const timeout = setTimeout(() => { console.error('Capture permission smoke timed out'); app.exit(1) }, 20000)
app.whenReady().then(async () => {
  try {
    const old = await scenario('old')
    assert.equal(old.error, 'NotAllowedError')
    assert.equal(old.selectedOwnFrame, false)
    assert.ok(old.requests.some(request => request.permission === 'media' && request.mediaTypes?.length === 0))
    const fixed = await scenario('fixed')
    assert.equal(fixed.live, true, JSON.stringify(fixed))
    assert.equal(fixed.ended, true)
    assert.equal(fixed.selectedOwnFrame, true)
    const camera = await scenario('fixed', true)
    assert.equal(camera.error, 'NotAllowedError')
    assert.equal(camera.selectedOwnFrame, false)
    const evidence = { electron: process.versions.electron, old, fixed, camera }
    if (process.env.KUN_CAPTURE_PERMISSION_EVIDENCE) writeFileSync(process.env.KUN_CAPTURE_PERMISSION_EVIDENCE, JSON.stringify(evidence, null, 2))
    console.log(JSON.stringify(evidence))
    clearTimeout(timeout); rmSync(temporary, { recursive: true, force: true }); app.exit(0)
  } catch (error) { clearTimeout(timeout); console.error(error.message); app.exit(1) }
})
