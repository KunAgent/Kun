'use strict'

const assert = require('node:assert/strict')
const { copyFile, lstat, mkdtemp, mkdir, readFile, rm, symlink, writeFile } = require('node:fs/promises')
const { createServer } = require('node:net')
const { tmpdir } = require('node:os')
const { join } = require('node:path')
const test = require('node:test')
const { collectGuiUpgradeEvidence } = require('./gui-upgrade-diagnostics.cjs')

async function collectionFixture(withLinks) {
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
    const output = join(root, 'evidence')
    const index = await collectGuiUpgradeEvidence(parent, output)
    const collected = join(output, 'kun-gui-upgrade-normal-test')
    assert.equal(await readFile(join(collected, 'desktop-profile', 'settings.json'), 'utf8'), '{"version":"0.3.8"}')
    assert.equal(await readFile(join(collected, 'failure.txt'), 'utf8'), 'replacement timed out')
    for (const path of [join(collected, 'installed'), join(collected, 'installer.exe'),
      join(output, 'unrelated-session'), join(collected, 'desktop-profile', 'SingletonSocket'),
      join(collected, 'desktop-profile', 'dangling-link')]) {
      await assert.rejects(lstat(path), { code: 'ENOENT' })
    }
    assert.equal(index.skipped.length, withLinks ? 2 : 0)
    assert.deepEqual(JSON.parse(await readFile(join(output, 'index.json'), 'utf8')).roots,
      ['kun-gui-upgrade-normal-test'])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
}

test('collected diagnostics retain regular evidence and omit installed binaries and unrelated directories', () => collectionFixture(false))
test('dangling Chromium and profile links are skipped without losing regular evidence',
  { skip: process.platform === 'win32' }, () => collectionFixture(true))

test('an early failure still produces a diagnostic index', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-evidence-empty-'))
  try {
    const output = join(root, 'evidence')
    await collectGuiUpgradeEvidence(root, output)
    assert.deepEqual(JSON.parse(await readFile(join(output, 'index.json'), 'utf8')).roots, [])
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('live sockets are skipped instead of passed to artifact upload', { skip: process.platform === 'win32' }, async () => {
  const root = await mkdtemp('/tmp/kun-ev-')
  const server = createServer()
  try {
    const scenario = join(root, 'kun-gui-upgrade-normal')
    await mkdir(scenario)
    await new Promise((resolve, reject) => {
      server.once('error', reject)
      server.listen(join(scenario, 'live.sock'), resolve)
    })
    const output = join(root, 'output')
    const index = await collectGuiUpgradeEvidence(root, output)
    assert.equal(index.skipped.length, 1)
    await assert.rejects(lstat(join(output, 'kun-gui-upgrade-normal', 'live.sock')), { code: 'ENOENT' })
  } finally {
    await new Promise(resolve => server.close(resolve))
    await rm(root, { recursive: true, force: true })
  }
})

test('a file that disappears during collection is recorded without losing other evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'kun-ev-race-'))
  try {
    const scenario = join(root, 'kun-gui-upgrade-normal')
    await mkdir(scenario)
    await writeFile(join(scenario, 'gone.log'), 'gone')
    await writeFile(join(scenario, 'failure.txt'), 'original failure')
    const output = join(root, 'output')
    const index = await collectGuiUpgradeEvidence(root, output, {
      copyFile: async (source, target) => {
        if (source.endsWith('gone.log')) throw Object.assign(new Error('File disappeared'), { code: 'ENOENT' })
        return copyFile(source, target)
      }
    })
    assert.equal(index.warnings[0].code, 'ENOENT')
    assert.equal(await readFile(join(output, 'kun-gui-upgrade-normal', 'failure.txt'), 'utf8'), 'original failure')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
