// Electron half of the unlock probe: the same hidden-window getDisplayMedia path as the real capture host.
const { app, BrowserWindow, desktopCapturer, powerMonitor, session } = require('electron')
const { appendFileSync, writeFileSync } = require('node:fs')
const { join } = require('node:path')

const directory = process.argv[process.argv.length - 1]
const started = Date.now()
const log = value => appendFileSync(join(directory, 'capture.jsonl'), `${JSON.stringify({ t: (Date.now() - started) / 1000, ...value })}\n`, { mode: 0o600 })

const pageScript = `(async () => {
  const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: { max: 30 } }, audio: false })
  const track = stream.getVideoTracks()[0]
  const state = { frames: 0, lastFrameAt: 0, muteEvents: 0, ended: false }
  track.onmute = () => { state.muteEvents++ }
  track.onended = () => { state.ended = true }
  const canvas = document.createElement('canvas')
  canvas.width = 640; canvas.height = 360
  const context = canvas.getContext('2d', { willReadFrequently: true })
  const reader = new MediaStreamTrackProcessor({ track }).readable.getReader()
  ;(async () => {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return
      state.frames++; state.lastFrameAt = performance.now()
      context.drawImage(value, 0, 0, canvas.width, canvas.height)
      value.close()
    }
  })()
  window.probeSample = () => {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data
    let sum = 0, squares = 0
    for (let i = 0; i < pixels.length; i += 4) {
      const y = 0.2126 * pixels[i] + 0.7152 * pixels[i + 1] + 0.0722 * pixels[i + 2]
      sum += y; squares += y * y
    }
    const count = pixels.length / 4, mean = sum / count
    return { frames: state.frames, frameAgeMs: state.frames ? Math.round(performance.now() - state.lastFrameAt) : null, luminance: Math.round(mean),
      contrast: Math.round(Math.sqrt(Math.max(0, squares / count - mean * mean))), trackState: track.readyState, muted: track.muted, muteEvents: state.muteEvents, ended: state.ended }
  }
  window.probeSnapshot = () => canvas.toDataURL('image/png')
  return true
})()`

app.whenReady().then(async () => {
  const ses = session.fromPartition('kun-unlock-probe')
  ses.setPermissionRequestHandler((_contents, _permission, callback) => callback(true))
  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    const [screen] = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 0, height: 0 } })
    callback(screen ? { video: screen } : {})
  })
  const window = new BrowserWindow({ show: false, width: 1, height: 1, webPreferences: { partition: 'kun-unlock-probe', backgroundThrottling: false } })
  const page = join(directory, 'capture.html')
  writeFileSync(page, '<!doctype html><title>probe</title>')
  await window.loadFile(page)

  // Started on an already locked Mac there are no pre-lock frames, so every frame is lock-phase.
  const lockedAtStart = process.env.KUN_UNLOCK_PROBE_LOCKED_AT_START === '1'
  let locked = lockedAtStart, snapshots = 0
  log({ kind: 'start', lockedAtStart, electronIdleState: powerMonitor.getSystemIdleState(1) })
  powerMonitor.on('lock-screen', () => { locked = true; log({ kind: 'electron-lock-screen' }) })
  powerMonitor.on('unlock-screen', () => { locked = false; log({ kind: 'electron-unlock-screen' }) })
  try {
    await window.webContents.executeJavaScript(pageScript, true)
  } catch (error) {
    log({ kind: 'capture-failed', error: String(error?.message ?? error) })
    process.stdout.write('capture-failed\n')
    app.exit(0)
    return
  }
  process.stdout.write('capture-ready\n')
  let lockedSince = 0, tick = 0
  setInterval(async () => {
    try {
      const sample = await window.webContents.executeJavaScript('window.probeSample()', true)
      log({ kind: 'capture', locked, ...sample })
      lockedSince = locked ? lockedSince + 1 : 0
      // Only lock-phase frames are written, so no desktop content lands on disk; skip the first seconds of stale frames.
      if (locked && lockedSince >= 3 && ++tick % 4 === 0 && snapshots < 6 && sample.frameAgeMs !== null && (lockedAtStart || sample.frameAgeMs < lockedSince * 1000 - 1000)) {
        const data = await window.webContents.executeJavaScript('window.probeSnapshot()', true)
        writeFileSync(join(directory, `locked-${++snapshots}.png`), Buffer.from(data.split(',')[1], 'base64'), { mode: 0o600 })
      }
    } catch (error) { log({ kind: 'sample-failed', error: String(error?.message ?? error) }) }
  }, 1000)
})
