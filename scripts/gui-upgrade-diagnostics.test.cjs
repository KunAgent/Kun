'use strict'

const assert = require('node:assert/strict')
const { execFileSync } = require('node:child_process')
const { mkdtemp, mkdir, readFile, rm, symlink, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { archiveGuiUpgradeEvidence } = require('./gui-upgrade-diagnostics.cjs')

async function archiveFixture(withLinks) {
  const root = await mkdtemp(join(tmpdir(), 'kun-evidence-test-'))
  try {
    const parent = join(root, 'temporary')
    const scenario = join(parent, 'kun-gui-upgrade-normal-test')
    const profile = join(scenario, 'desktop-profile')
    await mkdir(profile, { recursive: true })
    await writeFile(join(profile, 'settings.json'), '{"version":"0.3.8"}')
    await writeFile(join(scenario, 'failure.txt'), 'replacement timed out')
    await mkdir(join(scenario, 'installed'))
    await writeFile(join(scenario, 'installed', 'binary'), 'omit installed application')
    await writeFile(join(scenario, 'installer.exe'), 'omit installer')
    await mkdir(join(parent, 'unrelated-session'))
    await writeFile(join(parent, 'unrelated-session', 'private.txt'), 'do not collect')
    if (withLinks) {
      await symlink('/nonexistent/chromium-socket', join(profile, 'SingletonSocket'))
      await symlink('/nonexistent/other-link', join(profile, 'dangling-link'))
    }
    const output = join(root, 'evidence.tar.gz')
    await archiveGuiUpgradeEvidence(parent, output)
    const listing = execFileSync('tar', ['-tzf', output], { encoding: 'utf8' })
    assert.match(listing, /desktop-profile\/settings.json/)
    assert.match(listing, /failure.txt/)
    assert.doesNotMatch(listing, /installed|installer.exe|unrelated-session|SingletonSocket/)
    if (withLinks) assert.match(listing, /dangling-link/)
    assert.deepEqual(JSON.parse(await readFile(`${output}.json`, 'utf8')).roots,
      ['kun-gui-upgrade-normal-test'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('diagnostic archives retain evidence and omit installed binaries and unrelated directories', () => archiveFixture(false))
test('dangling Chromium and profile links do not prevent evidence upload',
  { skip: process.platform === 'win32' }, () => archiveFixture(true))

test('an early failure still produces a diagnostic index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-evidence-empty-'))
  try {
    const output = join(root, 'evidence.tar.gz')
    await archiveGuiUpgradeEvidence(root, output)
    assert.deepEqual(JSON.parse(await readFile(`${output}.json`, 'utf8')).roots, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
