'use strict'

const assert = require('node:assert/strict')
const { EventEmitter } = require('node:events')
const { readFileSync, readdirSync } = require('node:fs')
const { join, resolve } = require('node:path')
const { runInNewContext } = require('node:vm')

const PRELOAD_BRIDGES = {
  'index.cjs': 'kunGui',
  'protected-room-dialog.cjs': 'kunProtectedRoom',
  'extension-view.cjs': 'kunExtension',
  'extension-protected-surface.cjs': undefined,
  'storage-relocation-recovery.cjs': 'kunStorageRelocationRecovery',
  'runtime-data-recovery.cjs': 'kunRuntimeDataRecovery',
  'tray-quota.cjs': 'kunTrayQuota'
}

// Model Electron's sandboxed preload loader, not Node's unrestricted require.
// https://www.electronjs.org/docs/latest/tutorial/sandbox#preload-scripts
// In particular, installed npm dependencies and relative Rollup chunks cannot
// be required here even when they exist in app.asar/node_modules.
function executeSandboxedPreload(source, { filename = 'preload.cjs', platform = process.platform } = {}) {
  const bridges = new Map()
  const requires = []
  const calls = []
  const ipcRenderer = new EventEmitter()
  ipcRenderer.invoke = async (...args) => {
    calls.push(args)
    return { channel: args[0] }
  }
  ipcRenderer.send = (...args) => calls.push(args)
  ipcRenderer.sendSync = () => undefined
  const electron = {
    contextBridge: {
      exposeInMainWorld: (name, api) => {
        assert(!bridges.has(name), `Duplicate bridge: ${name}`)
        bridges.set(name, api)
      },
      exposeInIsolatedWorld: () => {}
    },
    ipcRenderer,
    webFrame: { executeJavaScriptInIsolatedWorld: async () => undefined },
    webUtils: { getPathForFile: () => '/sandbox-smoke/file' }
  }
  const allowed = new Map([
    ['electron', electron],
    ...['events', 'timers', 'url'].flatMap((name) => [
      [name, require(`node:${name}`)],
      [`node:${name}`, require(`node:${name}`)]
    ])
  ])
  const context = {
    require: (specifier) => {
      requires.push(specifier)
      if (!allowed.has(specifier)) throw new Error(`Sandbox preload cannot require: ${specifier}`)
      return allowed.get(specifier)
    },
    exports: {},
    module: { exports: {} },
    process: {
      argv: ['electron', '--kun-home-dir=/sandbox-smoke/home'],
      platform,
      env: {},
      versions: { electron: 'sandbox-smoke' },
      sandboxed: true,
      contextIsolated: true
    },
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    AbortController,
    DOMException,
    console,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    setImmediate,
    clearImmediate,
    window: { addEventListener: () => {}, removeEventListener: () => {} },
    document: { readyState: 'loading', getElementById: () => null }
  }
  runInNewContext(source, context, { filename, timeout: 5_000 })
  return { bridges, calls, ipcRenderer, requires }
}

async function assertWorkbenchBridge(loaded) {
  const api = loaded.bridges.get('kunGui')
  assert(api, 'Built preload did not expose window.kunGui')
  for (const method of ['getSettings', 'runtimeRequest', 'runDesktopCommand', 'onProviderMutationFlushRequest']) {
    assert.equal(typeof api[method], 'function', `Missing workbench bridge: ${method}`)
  }
  const dispose = api.onProviderMutationFlushRequest(() => {})
  assert.equal(typeof dispose, 'function', 'Provider mutation subscription must be disposable')
  dispose()
  assert(!Object.hasOwn(api, 'googleWorkspace'), 'Retired Google Workspace bridge must not be exposed')
}

async function checkBuiltPreloads(directory) {
  const files = readdirSync(directory).filter((file) => file.endsWith('.cjs'))
  for (const required of Object.keys(PRELOAD_BRIDGES)) {
    assert(files.includes(required), `Missing built preload: ${required}`)
  }
  for (const platform of ['linux', 'darwin', 'win32']) {
    for (const file of files) {
      const loaded = executeSandboxedPreload(readFileSync(join(directory, file), 'utf8'), {
        filename: join(directory, file), platform
      })
      const bridge = PRELOAD_BRIDGES[file]
      if (bridge) assert(loaded.bridges.has(bridge), `${file} did not expose ${bridge} on ${platform}`)
      if (file === 'index.cjs') await assertWorkbenchBridge(loaded)
    }
  }
  return files.length
}

if (require.main === module) {
  checkBuiltPreloads(resolve(process.argv[2] || join(__dirname, '..', 'out', 'preload'))).then(
    (count) => console.log(`Built sandboxed preload check OK: ${count} entries, 3 platform contexts.`),
    (error) => {
      console.error(`[built-preload] ${error.stack || error}`)
      process.exitCode = 1
    }
  )
}

module.exports = { assertWorkbenchBridge, checkBuiltPreloads, executeSandboxedPreload }
