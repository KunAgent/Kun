'use strict'

const { spawn } = require('node:child_process')
const { existsSync } = require('node:fs')
const { join } = require('node:path')

// The renderer bundle keeps ~11.5k modules alive while Rollup renders chunks;
// the 0.3.11 release build pushed peak old-space past ~4 GB, which is the
// default V8 heap limit on the 16 GB Linux/Windows CI runners. 6 GB clears the
// current peak while still failing as a diagnosable V8 OOM (not a kernel OOM
// kill) if growth runs away again.
const DEFAULT_MAX_OLD_SPACE_MB = 6144
const HEAP_FLAG = '--max-old-space-size'
const ELECTRON_VITE_BIN = join(
  __dirname,
  '..',
  'node_modules',
  'electron-vite',
  'bin',
  'electron-vite.js'
)

// A caller-provided cap in NODE_OPTIONS (for example the macOS packaging jobs,
// whose 7 GB runners intentionally pin 4096) wins over the default.
function heapArgs(env) {
  const options = env.NODE_OPTIONS ?? ''
  return options.includes(HEAP_FLAG) ? [] : [`${HEAP_FLAG}=${DEFAULT_MAX_OLD_SPACE_MB}`]
}

function main() {
  if (!existsSync(ELECTRON_VITE_BIN)) {
    console.error('[electron-vite-build] electron-vite is not installed; run npm ci first.')
    process.exit(1)
  }
  const heap = heapArgs(process.env)
  if (heap.length === 0) {
    console.log(`[electron-vite-build] respecting ${HEAP_FLAG} from NODE_OPTIONS`)
  } else {
    console.log(`[electron-vite-build] applying ${heap[0]}; override via NODE_OPTIONS`)
  }
  const child = spawn(
    process.execPath,
    [...heap, ELECTRON_VITE_BIN, 'build', ...process.argv.slice(2)],
    { stdio: 'inherit', env: process.env }
  )
  child.on('error', (error) => {
    console.error(`[electron-vite-build] failed to spawn electron-vite: ${error.message}`)
    process.exit(1)
  })
  child.on('exit', (code, signal) => {
    if (signal) {
      try {
        process.kill(process.pid, signal)
        return
      } catch {
        // Signal cannot be redelivered on this platform; fall back to the code.
      }
    }
    process.exit(code ?? 1)
  })
}

if (require.main === module) {
  main()
}

module.exports = { heapArgs }
