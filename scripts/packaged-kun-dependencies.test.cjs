'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtempSync, mkdirSync, rmSync, writeFileSync } = require('node:fs')
const { createRequire } = require('node:module')
const { tmpdir } = require('node:os')
const { dirname, join } = require('node:path')
const test = require('node:test')
const { default: beforePack } = require('./before-pack.cjs')
const { default: afterPack } = require('./after-pack.cjs')
const {
  lockedKunDependencies,
  validateInstalledKunDependencies,
  validatePackagedKunDependencies
} = require('./packaged-kun-dependencies.cjs')

const builderRequire = createRequire(require.resolve('electron-builder/package.json'))
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'))
const { createPackageWithOptions, statFile } = appBuilderRequire('@electron/asar')

const assistant = '@kun/assistant-agent'
const remote = '@kun/remote-protocol'
const dependencies = {
  [assistant]: 'file:vendor/kun-assistant/kun-assistant-agent-0.7.2.tgz',
  [remote]: 'file:vendor/kun-remote/kun-remote-protocol-0.22.1.tgz',
  '@kun/extension-api': '1.5.0'
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, JSON.stringify(value))
}

function manifestAt(root, name, version) {
  writeJson(join(root, 'node_modules', ...name.split('/'), 'package.json'), { name, version })
}

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'kun-pack-dependencies-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const projectDir = join(dir, 'project')
  const archiveSource = join(dir, 'archive-source')
  const archive = join(dir, 'output', 'resources', 'app.asar')
  const packages = {
    '': { dependencies },
    [`node_modules/${assistant}`]: { version: '0.7.2', resolved: dependencies[assistant] },
    [`node_modules/${remote}`]: { version: '0.22.1', resolved: dependencies[remote] },
    'node_modules/@kun/extension-api': { link: true, resolved: 'packages/extension-api' }
  }
  writeJson(join(projectDir, 'package.json'), { dependencies })
  writeJson(join(projectDir, 'package-lock.json'), { packages })
  for (const root of [projectDir, archiveSource]) {
    manifestAt(root, assistant, '0.7.2')
    manifestAt(root, remote, '0.22.1')
  }
  return { projectDir, archiveSource, archive, packages }
}

async function pack(source, archive) {
  mkdirSync(dirname(archive), { recursive: true })
  await createPackageWithOptions(source, archive, { unpack: '**/node_modules/@kun/remote-protocol/**/*' })
}

test('checks installed and packed root dependencies against the lockfile, including unpacked ASAR files', async (t) => {
  const { projectDir, archiveSource, archive } = fixture(t)
  await pack(archiveSource, archive)
  assert.equal(statFile(archive, `node_modules/${remote}/package.json`).unpacked, true)
  assert.deepEqual(lockedKunDependencies(projectDir), [
    { name: assistant, version: '0.7.2' },
    { name: remote, version: '0.22.1' }
  ])
  assert.doesNotThrow(() => validateInstalledKunDependencies(projectDir))
  assert.doesNotThrow(() => validatePackagedKunDependencies(projectDir, archive))
})

test('before-pack rejects the reported stale assistant-agent before resource preparation', async (t) => {
  const { projectDir } = fixture(t)
  manifestAt(projectDir, assistant, '0.5.1')
  await assert.rejects(
    beforePack({ packager: { projectDir }, electronPlatformName: 'win32', arch: 'x64' }),
    /@kun\/assistant-agent mismatch[\s\S]*0\.7\.2[\s\S]*0\.5\.1[\s\S]*npm ci/
  )
})

test('after-pack rejects a stale assistant-agent actually embedded in the Windows archive', async (t) => {
  const { projectDir, archiveSource, archive } = fixture(t)
  manifestAt(archiveSource, assistant, '0.5.1')
  await pack(archiveSource, archive)
  assert.doesNotThrow(() => validateInstalledKunDependencies(projectDir))
  await assert.rejects(
    afterPack({
      appOutDir: dirname(dirname(archive)),
      electronPlatformName: 'win32',
      arch: 'x64',
      packager: { projectDir }
    }),
    /@kun\/assistant-agent mismatch[\s\S]*app\.asar[\s\S]*0\.7\.2[\s\S]*0\.5\.1[\s\S]*npm ci/
  )
})

test('rejects a stale unpacked root remote-protocol even without a Kun duplicate', async (t) => {
  const { projectDir, archiveSource, archive } = fixture(t)
  manifestAt(archiveSource, remote, '0.22.0')
  await pack(archiveSource, archive)
  assert.throws(
    () => validatePackagedKunDependencies(projectDir, archive),
    /@kun\/remote-protocol mismatch[\s\S]*0\.22\.1[\s\S]*0\.22\.0/
  )
})

test('reads a freshly rebuilt archive even when the output path is reused', async (t) => {
  const { projectDir, archiveSource, archive } = fixture(t)
  await pack(archiveSource, archive)
  assert.doesNotThrow(() => validatePackagedKunDependencies(projectDir, archive))
  writeJson(join(archiveSource, 'extra', 'metadata.json'), { padding: 'x'.repeat(300) })
  manifestAt(archiveSource, assistant, '0.5.1')
  await pack(archiveSource, archive)
  assert.throws(
    () => validatePackagedKunDependencies(projectDir, archive),
    /@kun\/assistant-agent mismatch[\s\S]*0\.7\.2[\s\S]*0\.5\.1/
  )
})

test('rejects missing or inconsistent lock entries and missing installed and packaged copies', async (t) => {
  const { projectDir, archiveSource, archive, packages } = fixture(t)
  const lockPath = join(projectDir, 'package-lock.json')
  packages[`node_modules/${assistant}`].resolved = 'file:old.tgz'
  writeJson(lockPath, { packages })
  assert.throws(() => validateInstalledKunDependencies(projectDir), /Invalid locked production dependency @kun\/assistant-agent/)
  delete packages[`node_modules/${assistant}`]
  writeJson(lockPath, { packages })
  assert.throws(() => validateInstalledKunDependencies(projectDir), /@kun\/assistant-agent does not match package-lock\.json/)
  packages[`node_modules/${assistant}`] = { version: '0.7.2', resolved: dependencies[assistant] }
  writeJson(lockPath, { packages })
  rmSync(join(projectDir, 'node_modules', '@kun', 'assistant-agent'), { recursive: true })
  assert.throws(() => validateInstalledKunDependencies(projectDir), /installed @kun\/assistant-agent manifest; run npm ci/)
  rmSync(join(archiveSource, 'node_modules', '@kun', 'assistant-agent'), { recursive: true })
  await pack(archiveSource, archive)
  assert.throws(() => validatePackagedKunDependencies(projectDir, archive), /Cannot read @kun\/assistant-agent from .*app\.asar/)
})

test('the installed assistant-agent provides the named ESM exports required at startup', () => {
  execFileSync(process.execPath, [
    '--input-type=module',
    '-e',
    "import { WindowsPrivatePipe, secureWindowsDirectory } from '@kun/assistant-agent'; " +
      "if (typeof WindowsPrivatePipe !== 'function' || typeof secureWindowsDirectory !== 'function') process.exit(1)"
  ], { cwd: join(__dirname, '..'), stdio: 'pipe' })
})
