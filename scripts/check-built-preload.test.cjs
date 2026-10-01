'use strict'

const assert = require('node:assert/strict')
const { mkdtempSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { assertWorkbenchBridge, checkBuiltPreloads, executeSandboxedPreload } = require('./check-built-preload.cjs')

for (const specifier of ['zod', 'node:fs', 'node:os', './shared-chunk.cjs']) {
  test(`rejects forbidden built-preload dependency ${specifier}`, () => {
    assert.throws(() => executeSandboxedPreload(`require(${JSON.stringify(specifier)})`), {
      message: `Sandbox preload cannot require: ${specifier}`
    })
  })
}

test('allows only the documented Electron sandbox module subset', () => {
  const loaded = executeSandboxedPreload(`
    for (const name of ['events', 'timers', 'url']) {
      require(name)
      require('node:' + name)
    }
    require('electron').contextBridge.exposeInMainWorld('bridge', { sandboxed: process.sandboxed })
  `)
  assert.equal(loaded.bridges.get('bridge').sandboxed, true)
})

test('fails when the preload aborts before exposing the complete workbench', async () => {
  const loaded = executeSandboxedPreload('')
  await assert.rejects(assertWorkbenchBridge(loaded), /did not expose window.kunGui/u)
})

test('does not silently pass before production preloads have been built', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'kun-built-preload-'))
  try {
    await assert.rejects(checkBuiltPreloads(directory), /Missing built preload: index.cjs/u)
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
})
