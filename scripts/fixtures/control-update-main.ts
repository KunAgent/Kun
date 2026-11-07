import { app, net } from 'electron'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { startControlProcess, type ControlProcess } from '../../src/main/control-host/process'

const resources = process.env.KUN_CONTROL_TEST_RESOURCES!
const temporary = process.env.KUN_CONTROL_TEST_HOME!
app.setPath('userData', join(temporary, 'electron-profile'))
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => app.exit(1), 180000)

app.whenReady().then(async () => {
  let live: ControlProcess | undefined
  let manager: any
  let ticks = 0
  const task = spawn(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("tick\\n"),100)'],
    { env: { ELECTRON_RUN_AS_NODE: '1' }, stdio: ['ignore', 'pipe', 'ignore'] })
  task.stdout.on('data', () => ticks++)
  try {
    // Load the actual packaged SDK and pinned trust, through Electron's ASAR loader.
    const { ControlPackageManager } = require(join(resources, 'app.asar/node_modules/@kun/control-host/src/index.js'))
    const { BASELINES, UPDATE_TRUST } = require(join(resources, 'app.asar/node_modules/@kun/control-runtime/dist/info.js'))
    assert.equal(UPDATE_TRUST.origin, 'https://api-kun-server.com')
    const key = `${process.platform}-${process.arch}`, baseline = BASELINES[key]
    const versions: string[] = []
    let injectFailure = false
    const driver = {
      async probe(directory: string, release: any) {
        const probe = await startControlProcess(directory, release, {}, () => {}, () => {})
        try { assert.equal((await probe.rpc.call('health')).releaseId, release.releaseId) }
        finally { await probe.stop() }
      },
      async activate(directory: string, release: any) {
        await live?.stop()
        live = await startControlProcess(directory, release, {}, () => {}, () => {})
        const health = await live.rpc.call('health')
        if (injectFailure && release.version !== '0.1.2') {
          injectFailure = false
          await live.stop()
          throw Error('CONTROL_ACTIVATION_FAILED')
        }
        versions.push(health.version)
      },
      async drain() { return true }, async resume() {}, async stop() { await live?.stop(); live = undefined }
    }
    const options = { baseline: { directory: join(resources, 'control-baselines', key), manifestHash: baseline.manifestHash },
      trust: UPDATE_TRUST, host: { platform: process.platform, arch: process.arch, hostApi: 1,
        buildId: `kun-control-host-1-electron${process.versions.electron}-node${process.versions.node}` },
      driver, fetch: (input: string, init: RequestInit) => net.fetch(input, init) }
    manager = new ControlPackageManager({ ...options, home: join(temporary, 'successful-update') })
    assert.equal((await manager.initialize()).version, '0.1.2')
    assert.equal((await manager.check()).candidateVersion, '0.1.3')
    const tickBeforeUpdate = ticks
    assert.equal((await manager.install()).version, '0.1.3')
    const health = await live!.rpc.call('health')
    assert.equal(health.version, '0.1.3')
    assert.deepEqual(health.components, ['mobile-access', 'desktop-control'])
    assert.equal(task.exitCode, null); assert.ok(ticks > tickBeforeUpdate)
    await manager.shutdown()
    manager = new ControlPackageManager({ ...options, home: join(temporary, 'activation-failure') })
    await manager.initialize()
    injectFailure = true
    const failed = await manager.install()
    assert.equal(failed.phase, 'rolled_back'); assert.equal(failed.version, '0.1.2')
    assert.equal((await live!.rpc.call('health')).version, '0.1.2')
    assert.equal(task.exitCode, null)
    await manager.shutdown()
    console.log(JSON.stringify({ packagedSdk: true, productionTrust: true, downloadedVersion: '0.1.3',
      rollbackVersion: failed.version, parallelTaskSurvived: true, taskTicks: ticks, versions }))
    clearTimeout(timeout); task.kill(); app.exit(0)
  } catch (error) {
    await manager?.shutdown().catch(() => {}); await live?.stop().catch(() => {})
    clearTimeout(timeout); task.kill(); console.error(error instanceof Error ? error.message : 'control_update_failed'); app.exit(1)
  }
})
