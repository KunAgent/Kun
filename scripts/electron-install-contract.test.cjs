const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')

const root = join(__dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

test('desktop startup ensures the Electron binary is installed', () => {
  assert.equal(manifest.scripts['ensure:electron'], 'install-electron')

  for (const scriptName of ['dev:app', 'preview']) {
    const command = manifest.scripts[scriptName]
    const ensureIndex = command.indexOf('npm run ensure:electron')
    const electronViteIndex = command.indexOf('electron-vite')

    assert.notEqual(ensureIndex, -1, `${scriptName} must ensure Electron is installed`)
    assert.notEqual(electronViteIndex, -1, `${scriptName} must invoke electron-vite`)
    assert.ok(
      ensureIndex < electronViteIndex,
      `${scriptName} must install Electron before invoking electron-vite`
    )
  }
})
