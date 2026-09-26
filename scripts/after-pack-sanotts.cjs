'use strict'

const { existsSync, rmSync } = require('node:fs')
const { join } = require('node:path')
const { checkSanottsWorker } = require('./check-sanotts-worker.cjs')

const LEFTOVER_SPEECH_PACKAGES = ['onnxruntime-node', 'phonemizer']

/**
 * sanoTTS inference is WASM, so the pack no longer ships a native speech
 * runtime. Confirm the worker entry is present and drop leftover Kokoro
 * native packages if an old install left them behind.
 */
function checkPackedSanottsRuntime(context, helpers) {
  const { unpackedAppRoot } = helpers
  const root = unpackedAppRoot(context)
  const worker = join(root, 'out', 'main', 'local-sanotts-worker-entry.js')
  if (!existsSync(worker)) {
    throw new Error(`[after-pack] Missing sanoTTS speech worker: ${worker}`)
  }
  checkSanottsWorker(worker)
  for (const packageName of LEFTOVER_SPEECH_PACKAGES) {
    const packageRoot = join(root, 'node_modules', packageName)
    if (!existsSync(packageRoot)) continue
    rmSync(packageRoot, { recursive: true, force: true })
    console.log(`[after-pack] Removed leftover ${packageName}.`)
  }
}

module.exports = { checkPackedSanottsRuntime, LEFTOVER_SPEECH_PACKAGES }
