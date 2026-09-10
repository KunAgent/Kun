'use strict'

// Exercise the worker using the packaged Electron executable and real unpacked
// dependencies. This does not open a window or touch the user's profile.
const { spawnSync } = require('node:child_process')
const { existsSync, statSync } = require('node:fs')
const { resolve, join, dirname } = require('node:path')
const { Worker } = require('node:worker_threads')
const { checkKokoroWorker } = require('./check-kokoro-worker.cjs')

function option(name) { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1] }
async function main() {
  const assetDir = resolve(option('--assets') || process.env.KUN_KOKORO_TEST_ASSETS || 'dist/kokoro-test-assets')
  for (const file of ['model_quantized.onnx', 'af_heart.bin']) {
    if (!existsSync(join(assetDir, file))) throw new Error(`Missing test asset: ${join(assetDir, file)}`)
  }
  if (option('--worker')) {
    const entry = resolve(option('--worker'))
    checkKokoroWorker(entry)
    const worker = new Worker(entry)
    try {
      const result = await new Promise((resolveResult, reject) => {
        const timer = setTimeout(() => reject(new Error('Packaged speech timed out')), 120_000)
        worker.on('error', reject)
        worker.on('message', message => {
          if (message.type === 'ready') worker.postMessage({
            type: 'synthesize', id: 'packaged-smoke', text: 'The packaged speech worker is ready.',
            modelPath: join(assetDir, 'model_quantized.onnx'), voicePath: join(assetDir, 'af_heart.bin'),
            voiceId: 'af_heart', language: 'en-us', speed: 1
          })
          if (message.type === 'result') {
            clearTimeout(timer)
            if (!message.ok || !(message.sampleCount > 0)) reject(new Error(message.message || 'Empty packaged audio'))
            else resolveResult({ sampleCount: message.sampleCount, durationSeconds: message.durationSeconds, sampleRate: message.sampleRate })
          }
        })
        worker.on('exit', () => { clearTimeout(timer); reject(new Error('Packaged speech worker exited')) })
      })
      console.log(JSON.stringify(result))
    } finally { await worker.terminate() }
    return
  }
  const app = resolve(option('--app') || 'dist/mac-arm64/Kun.app')
  let executable = app
  let resources = join(dirname(app), 'resources')
  if (app.endsWith('.app')) {
    executable = join(app, 'Contents', 'MacOS', 'Kun')
    resources = join(app, 'Contents', 'Resources')
  } else if (statSync(app).isDirectory()) {
    executable = join(app, process.platform === 'win32' ? 'Kun.exe' : 'kun')
    resources = join(app, 'resources')
  }
  const entry = join(resources, 'app.asar.unpacked', 'out', 'main', 'local-kokoro-worker-entry.js')
  checkKokoroWorker(entry)
  const run = spawnSync(executable, [__filename, '--worker', entry, '--assets', assetDir], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, stdio: 'inherit', timeout: 150_000
  })
  if (run.error || run.status !== 0) throw run.error || new Error(`Packaged speech failed (${run.status})`)
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1 })
