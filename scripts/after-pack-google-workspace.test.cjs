const assert = require('node:assert/strict')
const test = require('node:test')
const { mkdtempSync, mkdirSync, cpSync, readFileSync, writeFileSync, rmSync, symlinkSync } = require('node:fs')
const { join } = require('node:path')
const { tmpdir } = require('node:os')
const { createHash } = require('node:crypto')
const { validateBundledGoogleWorkspace, attestPackagedGoogleWorkspace,
  _internals: { resourceRoot } } = require('./after-pack-google-workspace.cjs')
const signMac = require('./sign-mac-google-workspace.cjs')
const pinned = require('../resources/google-workspace/manifest.json')
const binary = Buffer.from('a verified executable')
const hash = (data) => createHash('sha256').update(data).digest('hex')

function fixture(t, platform = 'linux', arch = 'x64') {
  const temp = mkdtempSync(join(tmpdir(), 'kun-gws-packed-'))
  t.after(() => rmSync(temp, { recursive: true, force: true }))
  const context = { appOutDir: temp, electronPlatformName: platform, arch,
    packager: { appInfo: { productFilename: 'Kun' } } }
  const root = resourceRoot(context)
  mkdirSync(root, { recursive: true })
  const manifest = structuredClone(pinned)
  const asset = manifest.assets[`${platform}-${arch}`]
  asset.size = binary.length
  asset.sha256 = hash(binary)
  const selected = { schemaVersion: 1, version: manifest.version, releaseTag: manifest.releaseTag,
    platform, arch, asset: asset.name, archiveSha256: asset.archiveSha256, size: asset.size, sha256: asset.sha256 }
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest))
  writeFileSync(join(root, 'selected.json'), JSON.stringify(selected))
  writeFileSync(join(root, platform === 'win32' ? 'gws.exe' : 'gws'), binary)
  cpSync(join(__dirname, '../resources/google-workspace/legal'), join(root, 'legal'), { recursive: true })
  return { context, root, manifest, selected }
}

test('packaging validates all supported target layouts against build-owned manifest', (t) => {
  for (const target of Object.keys(pinned.assets)) {
    const [platform, arch] = target.split('-')
    const f = fixture(t, platform, arch)
    assert.doesNotThrow(() => validateBundledGoogleWorkspace(f.context, f.manifest))
  }
})

test('packaging rejects tampered binary even when selected has matching attacker hashes', (t) => {
  const f = fixture(t)
  writeFileSync(join(f.root, 'gws'), 'modified executable')
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /SHA-256/)
  writeFileSync(join(f.root, 'selected.json'), JSON.stringify({ ...f.selected, sha256: hash('modified executable') }))
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /selected target/)
  const changed = structuredClone(f.manifest)
  changed.assets['linux-x64'].sha256 = hash('modified executable')
  writeFileSync(join(f.root, 'manifest.json'), JSON.stringify(changed))
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /pinned build manifest/)
})

test('packaging rejects a missing license, wrong platform, symlink or duplicate executable', (t) => {
  let f = fixture(t)
  rmSync(join(f.root, 'legal', 'LICENSE'))
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /Missing/)
  f = fixture(t)
  writeFileSync(join(f.root, 'selected.json'), JSON.stringify({ ...f.selected, arch: 'arm64' }))
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /selected target/)
  f = fixture(t)
  rmSync(join(f.root, 'gws'))
  symlinkSync(join(f.root, 'legal/LICENSE'), join(f.root, 'gws'))
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /regular file/)
  f = fixture(t)
  writeFileSync(join(f.root, 'gws.exe'), binary)
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /exactly one/)
})

test('post-sign attestation retains upstream identity and binds the actual packaged bytes', (t) => {
  const f = fixture(t)
  validateBundledGoogleWorkspace(f.context, f.manifest)
  writeFileSync(join(f.root, 'gws'), 'same executable plus platform code signature')
  const attested = attestPackagedGoogleWorkspace(f.root, 'linux', 'x64', f.manifest)
  assert.equal(attested.sha256, f.selected.sha256)
  assert.equal(attested.size, f.selected.size)
  assert.equal(attested.packagedSha256, hash(readFileSync(join(f.root, 'gws'))))
  assert.equal(attested.packagedSize, readFileSync(join(f.root, 'gws')).length)
  assert.throws(() => validateBundledGoogleWorkspace(f.context, f.manifest), /premature/)
})

test('macOS signing attests after nested code and before the outer app seal', async (t) => {
  const f = fixture(t, 'darwin')
  const app = join(f.context.appOutDir, 'Kun.app')
  const events = []
  await signMac({ app, identity: 'preserved', optionsForFile: (file) => ({ file }) }, undefined, {
    attest: (root, platform, arch) => {
      assert.equal(root, f.root)
      assert.equal(platform, 'darwin')
      assert.equal(arch, 'x64')
      events.push('attest')
    },
    sign: async (options) => {
      assert.equal(options.identity, 'preserved')
      const child = join(f.root, 'gws')
      assert.deepEqual(options.optionsForFile(child), { file: child })
      events.push('nested signed')
      assert.deepEqual(options.optionsForFile(app), { file: app })
      events.push('outer sealed')
    }
  })
  assert.deepEqual(events, ['nested signed', 'attest', 'outer sealed'])
  await assert.rejects(signMac({ app }, undefined, { sign: async () => {} }), /did not attest/)
})

test('all packaging entries are wired, with no runtime install hooks', () => {
  const config = require('../electron-builder.config.cjs')
  assert.equal(config.mac.sign, './scripts/sign-mac-google-workspace.cjs')
  assert.equal(config.extraResources.filter((entry) => entry.to?.startsWith('google-workspace')).length, 3)
  const before = readFileSync(join(__dirname, 'before-pack.cjs'), 'utf8')
  const after = readFileSync(join(__dirname, 'after-pack.cjs'), 'utf8')
  assert.match(before, /prepare-google-workspace\.cjs/)
  assert.match(after, /validateBundledGoogleWorkspace\(context\)/)
  assert.match(after, /await signWindowsGoogleWorkspace\(context\)/)
  const pkg = require('../package.json')
  assert.equal(pkg.scripts['prepare:google-workspace'], 'node ./scripts/prepare-google-workspace.cjs')
  assert.match(pkg.scripts['test:packaging'], /after-pack-google-workspace\.test\.cjs/)
})
