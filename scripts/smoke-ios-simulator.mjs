import { build } from 'esbuild'
import { spawn } from 'node:child_process'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const udid = process.argv[2]
if (!udid || !/^[A-Fa-f0-9]{8}(?:-[A-Fa-f0-9]{4}){3}-[A-Fa-f0-9]{12}$/.test(udid))
  throw new Error('Usage: node scripts/smoke-ios-simulator.mjs <dedicated-QA-simulator-udid>')
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const scratch = await mkdtemp(join(tmpdir(), 'kun-simulator-smoke-'))
try {
  const entry = join(scratch, 'smoke.cjs')
  await build({ stdin: { resolveDir: root, contents: `
    import { app, nativeImage } from 'electron'
    import { createHash } from 'node:crypto'
    import { RemoteSimulatorService } from './src/main/remote-simulator/service'
    import { XcodeSimulatorBackend } from './src/main/remote-simulator/adapter'
    const udid = ${JSON.stringify(udid)}
    app.whenReady().then(async () => {
      app.dock?.hide()
      let live = true
      const backend = new XcodeSimulatorBackend(bytes => {
        let picture = nativeImage.createFromBuffer(bytes)
        if (picture.getSize().width > 720) picture = picture.resize({ width: 720 })
        return { image: 'data:image/jpeg;base64,' + picture.toJPEG(45).toString('base64'), ...picture.getSize() }
      })
      const service = new RemoteSimulatorService(backend, async () => {})
      const authority = { accountId: 'smoke', deviceId: 'phone', authorizationId: 'grant', scopes: ['personal', 'desktop.view', 'desktop.control'], current: () => live }
      try {
        console.error('simulator smoke: start and capture')
        const session = await service.invoke('simulator.start', { origin: { kind: 'code', id: 'fixture' }, udid, startId: 'smoke' }, authority)
        const before = await service.invoke('simulator.frame', { sessionId: session.sessionId }, authority)
        console.error('simulator smoke: tap')
        await service.invoke('simulator.input', { sessionId: session.sessionId, sequence: 1, input: { kind: 'tap', x: 0.5, y: 0.5 } }, authority)
        console.error('simulator smoke: swipe')
        await service.invoke('simulator.input', { sessionId: session.sessionId, sequence: 2, input: { kind: 'swipe', x: 0.5, y: 0.8, endX: 0.5, endY: 0.2, durationMs: 500 } }, authority)
        await service.invoke('simulator.input', { sessionId: session.sessionId, sequence: 3, input: { kind: 'button', button: 'home' } }, authority)
        await new Promise(resolve => setTimeout(resolve, 600))
        const after = await service.invoke('simulator.frame', { sessionId: session.sessionId }, authority)
        const digest = frame => createHash('sha256').update(frame.image).digest('hex')
        if (before.capturedAt >= after.capturedAt || before.width <= 0 || before.height <= 0) throw Error('FRAME_DID_NOT_ADVANCE')
        await service.invoke('simulator.stop', { sessionId: session.sessionId }, authority)
        console.log(JSON.stringify({ capture: true, tap: true, swipe: true, home: true, frameAdvanced: true, contentChanged: digest(before) !== digest(after), width: after.width, height: after.height, frameBytes: after.image.length, stopped: true }))
      } finally { live = false; await service.stopAll() }
    }).then(() => app.exit(0), error => { console.error(error.message, error.cause?.message, error.cause?.signal, error.cause?.code, error.cause?.diagnosticStdout); app.exit(1) })
  ` }, outfile: entry, bundle: true, platform: 'node', format: 'cjs', external: ['electron'], logLevel: 'error' })
  const electron = join(root, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron')
  const code = await new Promise((accept, reject) => {
    const child = spawn(electron, [entry], { stdio: 'inherit', env: { ...process.env, ELECTRON_RUN_AS_NODE: undefined } })
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000)
    child.once('error', reject)
    child.once('exit', code => { clearTimeout(timer); accept(code) })
  })
  if (code !== 0) process.exitCode = 1
} finally { await rm(scratch, { recursive: true, force: true }) }
