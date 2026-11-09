import { app, net } from 'electron'
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createHash } from 'node:crypto'
import { spawn } from 'node:child_process'
import { ControlPackageManager } from '@kun/control-host'
import { startControlProcess, type ControlProcess } from '../../src/main/control-host/process'
import { controlViewerEntry, probeControlViewer } from '../../src/main/control-host/viewer-resources'
import { admitControlOperation, pauseControlAdmission, resumeControlAdmission } from '../../src/main/control-host/admission'

const home = process.env.KUN_VIEWER_TEST_HOME!
const issuer = process.env.KUN_VIEWER_ISSUER_ROOT!
app.setPath('userData', join(home, 'electron-profile'))
app.on('window-all-closed', () => {})
const timeout = setTimeout(() => app.exit(1), 75000)
const hash = (value: string) => createHash('sha256').update(value).digest('hex')

app.whenReady().then(async () => {
  let f: any, manager: ControlPackageManager | undefined, live: ControlProcess | undefined
  let activeEntry = '', failActivation = false, ticks = 0
  let releaseViewer: (() => void) | undefined
  const task = spawn(process.execPath, ['-e', 'setInterval(()=>process.stdout.write("tick\\n"),100)'],
    { env: {ELECTRON_RUN_AS_NODE: '1'}, stdio: ['ignore', 'pipe', 'ignore'] })
  task.stdout.on('data', () => ticks++)
  try {
    const { fixture } = await import(pathToFileURL(join(issuer, 'packages/control-host/test/fixtures.mjs')).href)
    f = await fixture()
    async function edit(release: any, file: string, value: string) {
      await writeFile(join(release.directory, file), value)
      release.release.files[file] = {size: Buffer.byteLength(value), sha256: hash(value)}
      const raw = JSON.stringify(release.release) + '\n'
      await writeFile(join(release.directory, 'manifest.json'), raw); release.manifestHash = hash(raw)
    }
    const a = await f.release('1.0.0'), b = await f.release('1.1.0'), broken = await f.release('1.2.0'), failed = await f.release('1.3.0')
    await edit(b, 'viewer/index.html', (await readFile(join(b.directory, 'viewer/index.html'), 'utf8')).replace('Kun 远程桌面', 'Kun 独立更新 B'))
    await edit(broken, 'viewer/viewer.js', 'throw Error("fixture_viewer_boot_failed")')
    const activations: string[] = []
    manager = new ControlPackageManager({ home: join(home, 'packages'), host: f.host, trust: f.trust,
      fetch: (input, init) => net.fetch(String(input), init), driver: {
        async probe(directory, release) {
          const process = await startControlProcess(directory, release, {}, () => {}, () => {})
          try { await process.rpc.call('health'); await probeControlViewer(directory, release) } finally { await process.stop() }
        },
        async activate(directory, release) {
          await live?.stop()
          live = await startControlProcess(directory, release, {}, () => {}, () => {})
          await probeControlViewer(directory, release)
          assert.equal((await live.rpc.call('health')).viewerApi, 1)
          if (failActivation && release.version === '1.3.0') throw Error('CONTROL_ACTIVATION_FAILED')
          activeEntry = controlViewerEntry(directory, release); activations.push(release.version)
        },
        async drain() { return pauseControlAdmission() },
        async resume() { resumeControlAdmission() },
        async stop() { await live?.stop(); live = undefined }
      } })
    assert.equal((await manager.initialize()).phase, 'not_installed')
    assert.equal(live, undefined)
    await f.publishRelease(a)
    assert.equal((await manager.install()).version, '1.0.0')
    const initialEntry = activeEntry
    releaseViewer = admitControlOperation()
    await f.publishRelease(b)
    assert.equal((await manager.install()).phase, 'waiting_for_idle')
    assert.equal(activeEntry, initialEntry)
    releaseViewer(); releaseViewer = undefined
    assert.equal((await manager.apply()).version, '1.1.0')
    assert.notEqual(activeEntry, initialEntry)
    assert.match(await readFile(activeEntry, 'utf8'), /独立更新 B/)
    await f.publishRelease(broken)
    await assert.rejects(manager.install(), /CONTROL_VIEWER_START_TIMEOUT/)
    assert.equal(manager.status().version, '1.1.0')
    assert.equal((await live!.rpc.call('health')).version, '1.1.0')
    await f.publishRelease(failed); failActivation = true
    const reverted = await manager.install()
    assert.equal(reverted.phase, 'rolled_back'); assert.equal(reverted.version, '1.1.0')
    assert.match(await readFile(activeEntry, 'utf8'), /独立更新 B/)
    assert.equal(task.exitCode, null); assert.ok(ticks > 10)
    console.log(JSON.stringify({ downloadedViewer: true, withoutBundledRuntime: true, electron: process.versions.electron, activeSessionDeferred: true,
      brokenViewerRejected: true, rollbackRestoresViewer: true, parallelTestTaskSurvived: true, activations }))
    releaseViewer?.(); await manager.shutdown(); await f.close(); task.kill(); clearTimeout(timeout); app.exit(0)
  } catch (error) {
    releaseViewer?.(); await manager?.shutdown().catch(() => {}); await live?.stop().catch(() => {})
    await f?.close().catch(() => {}); task.kill(); clearTimeout(timeout)
    console.error(error instanceof Error ? error.stack : error); app.exit(1)
  }
})
