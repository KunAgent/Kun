const { test } = require('node:test')
const assert = require('node:assert/strict')
const { createHash } = require('node:crypto')
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const { finalizeWindowsStartup } = require('./after-sign.cjs')

test('finalizes helper hashes after signer changes executable bytes', () => {
  const directory = mkdtempSync(join(tmpdir(), 'kun-signed-startup-'))
  try {
    const root = join(directory, 'resources/app.asar.unpacked/kun/dist/native/win32-x64')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'manifest.json'), JSON.stringify({ version: 1, arch: 'x64', files: {} }))
    writeFileSync(join(root, 'kun_windows_startup.node'), 'native')
    writeFileSync(join(root, 'kun-owned-launcher.exe'), 'signed executable bytes')
    finalizeWindowsStartup({ arch: 1, appOutDir: directory })
    const manifest = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'))
    assert.equal(manifest.files['kun-owned-launcher.exe'], createHash('sha256').update('signed executable bytes').digest('hex'))
    assert.equal(manifest.files['kun_windows_startup.node'], createHash('sha256').update('native').digest('hex'))
    assert.throws(() => finalizeWindowsStartup({ arch: 3, appOutDir: directory }))
    assert.throws(() => finalizeWindowsStartup({ arch: 0, appOutDir: directory }), /Unsupported/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})
