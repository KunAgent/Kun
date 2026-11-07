import { app, net } from 'electron'
import assert from 'node:assert/strict'
import { join } from 'node:path'
import { readFile, writeFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { UPDATE_TRUST, CONTROL_HOST_BUILD_GENERATION } from '../../src/main/control-host/update-trust'
import { startControlProcess, type ControlProcess } from '../../src/main/control-host/process'
import { probeControlViewer } from '../../src/main/control-host/viewer-resources'

const home = process.env.KUN_CONTROL_BOOTSTRAP_HOME!
const resources = process.env.KUN_CONTROL_BOOTSTRAP_RESOURCES!
app.setPath('userData', join(home, 'electron-profile'))
app.on('window-all-closed', () => {})
const deadline = setTimeout(() => app.exit(1), 220000)
app.whenReady().then(async () => {
  let manager: any, live: ControlProcess | undefined, offline = true, failActivation = false, ticks = 0, downloads = 0
  const task = spawn(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("tick\\n"),100)'],
    {env: {ELECTRON_RUN_AS_NODE: '1'}, stdio: ['ignore', 'pipe', 'ignore']})
  task.stdout.on('data', () => ticks++)
  try {
    // The updater is loaded from the signed application's actual ASAR, with no runtime npm package present.
    const { ControlPackageManager } = require(join(resources, 'app.asar/node_modules/@kun/control-host/src/index.js'))
    const identity = join(home, 'existing-pairing.enc')
    await writeFile(identity, 'opaque-existing-identity-fixture')
    const options = { trust: UPDATE_TRUST, host: {platform: process.platform, arch: process.arch, hostApi: 1, minimumVersion: '0.1.6',
      buildId: `kun-control-host-${CONTROL_HOST_BUILD_GENERATION}-electron${process.versions.electron}-node${process.versions.node}`},
      fetch: async (input: string, init: RequestInit) => {
        downloads++
        if (offline) throw Error('fixture_offline')
        return net.fetch(String(input), init)
      }, driver: {
        async probe(directory: string, release: any) {
          const process = await startControlProcess(directory, release, {}, () => {}, () => {})
          try { await process.rpc.call('health'); await probeControlViewer(directory, release) } finally { await process.stop() }
        },
        async activate(directory: string, release: any) {
          await live?.stop()
          live = await startControlProcess(directory, release, {}, () => {}, () => {})
          await probeControlViewer(directory, release)
          assert.equal((await live.rpc.call('health')).viewerApi, 1)
          if (failActivation) {failActivation = false; throw Error('fixture_first_activation_failed')}
        },
        async drain() { return true }, async resume() {}, async stop() {await live?.stop(); live = undefined}
      } }
    manager = new ControlPackageManager({...options, home: join(home, 'packages')})
    assert.equal((await manager.initialize()).phase, 'not_installed'); assert.equal(downloads, 0)
    await assert.rejects(manager.install())
    offline = false
    const installed = await manager.install()
    assert.equal(installed.phase, 'ready'); assert.equal(installed.version, '0.1.6')
    assert.ok(downloads > 0)
    await manager.shutdown()
    offline = true; const before = downloads
    manager = new ControlPackageManager({...options, home: join(home, 'packages')})
    assert.equal((await manager.initialize()).version, '0.1.6'); assert.equal(downloads, before)
    await manager.shutdown()
    offline = false; failActivation = true
    manager = new ControlPackageManager({...options, home: join(home, 'first-failure')})
    await manager.initialize(); await assert.rejects(manager.install())
    assert.equal((await manager.install()).phase, 'ready')
    assert.equal(await readFile(identity, 'utf8'), 'opaque-existing-identity-fixture')
    assert.equal(task.exitCode, null); assert.ok(ticks > 0)
    await manager.shutdown()
    console.log(JSON.stringify({noBundledControl: true, packagedUpdater: true, productionDownload: installed.version,
      offlineRetry: true, cachedOfflineStart: true, firstActivationRetry: true, parallelTestTaskSurvived: true}))
    task.kill(); clearTimeout(deadline); app.exit(0)
  } catch (error) {
    await manager?.shutdown().catch(() => {}); await live?.stop().catch(() => {})
    task.kill(); clearTimeout(deadline); console.error(error instanceof Error ? error.stack : error); app.exit(1)
  }
})
