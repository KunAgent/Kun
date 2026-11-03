const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const test = require('node:test')
const { linuxRealExecutableName } = require('./after-pack-launchers.cjs')

const root = join(__dirname, '..')
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))

function loadConfig(flavor) {
  const key = require.resolve('../electron-builder.config.cjs')
  const previous = process.env.KUN_APP_FLAVOR
  process.env.KUN_APP_FLAVOR = flavor
  delete require.cache[key]
  try {
    return require(key)
  } finally {
    if (previous === undefined) delete process.env.KUN_APP_FLAVOR
    else process.env.KUN_APP_FLAVOR = previous
    delete require.cache[key]
  }
}

test('the window identity comes from desktopName, not from the renamed Electron binary', () => {
  // afterPack renames the real binary to <executable>.electron-bin; without desktopName
  // Chromium names the window after it, and no .desktop entry can match that.
  assert.match(manifest.desktopName, /^[a-z0-9-]+\.desktop$/u)
  assert.equal(loadConfig('production').linux.syncDesktopName, true)
  assert.equal(loadConfig('production').extraMetadata.desktopName, undefined)
})

test('a development build keeps its own desktop entry', () => {
  const development = loadConfig('development').extraMetadata.desktopName
  assert.match(development, /^[a-z0-9-]+\.desktop$/u)
  assert.notEqual(development, manifest.desktopName)
})

test('the deb AppArmor profile covers both the launcher and the renamed Electron binary', () => {
  const config = loadConfig('production')
  assert.equal(config.deb.appArmorProfile, 'build/linux-apparmor-profile.tpl')
  const template = readFileSync(join(root, config.deb.appArmorProfile), 'utf8')
  // electron-builder replaces only `${name}` macros; render it the same way.
  const rendered = template.replace(/\$\{([a-zA-Z]+)\}/gu, (_match, name) => {
    const values = { executable: 'kun-gui', sanitizedProductName: 'Kun' }
    assert.ok(name in values, `unexpected macro ${name}`)
    return values[name]
  })
  const realBinary = linuxRealExecutableName('kun-gui')
  assert.equal(realBinary, 'kun-gui.electron-bin')
  assert.match(rendered, /^profile "kun-gui" "\/opt\/Kun\/\{kun-gui,kun-gui\.electron-bin\}" flags=\(unconfined\) \{$/mu)
  assert.match(rendered, /^\s+userns,$/mu)
})
