import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import test from 'node:test'
import { parse } from 'yaml'
import { readArgs } from './publish-r2-support.mjs'
import {
  formatBytes,
  planLatestPrune,
  planReleaseArchivePrune,
  readKeepCount
} from './publish-r2-prune.mjs'

const RELEASES = 'deepseek-gui/channels/stable/releases/'
const LATEST = 'deepseek-gui/channels/stable/latest/'

function object(key, lastModified, size = 100) {
  return { key, lastModified, size }
}

function archive(tag, lastModified, size = 100) {
  return [
    object(`${RELEASES}${tag}/Kun-${tag.replace(/^v|^dev-/, '')}-mac-arm64.dmg`, lastModified, size),
    object(`${RELEASES}${tag}/release-mac.json`, lastModified, 1)
  ]
}

test('archive prune keeps the newest uploads and always keeps the published tag', () => {
  const plan = planReleaseArchivePrune({
    prefix: RELEASES,
    objects: [
      ...archive('v0.3.8', 1000),
      ...archive('v0.3.9', 2000),
      ...archive('v0.4.0', 3000),
      ...archive('v0.4.1', 4000),
      object(`${RELEASES}notes.txt`, 5000),
      object(`${RELEASES}nightly/Kun.dmg`, 5000)
    ],
    keep: 2,
    // A rollback can point latest at an older archive; it must survive the count window.
    protectedTags: new Set(['v0.3.9'])
  })

  assert.deepEqual(plan.keptTags, ['v0.4.1', 'v0.4.0', 'v0.3.9'])
  assert.deepEqual(plan.deletedTags, [{ tag: 'v0.3.8', bytes: 101 }])
  assert.deepEqual(plan.deleteKeys, [
    `${RELEASES}v0.3.8/Kun-0.3.8-mac-arm64.dmg`,
    `${RELEASES}v0.3.8/release-mac.json`
  ])
  assert.equal(plan.deleteBytes, 101)
  assert.deepEqual(plan.unrecognized, [`${RELEASES}notes.txt`, `${RELEASES}nightly/Kun.dmg`])
})

test('archive prune orders daily tags by upload time, not by tag spelling', () => {
  const plan = planReleaseArchivePrune({
    prefix: RELEASES,
    objects: [
      ...archive('v0.4.0', 3000),
      ...archive('dev-20261017.1200', 1000),
      ...archive('dev-20261018.0000', 2000)
    ],
    keep: 2,
    protectedTags: new Set(['v0.4.0'])
  })
  assert.deepEqual(plan.keptTags, ['v0.4.0', 'dev-20261018.0000'])
  assert.deepEqual(plan.deletedTags.map(({ tag }) => tag), ['dev-20261017.1200'])
})

test('latest prune removes old installers but keeps recent blockmaps and feed files', () => {
  const files = (version, at) => [
    object(`${LATEST}Kun-${version}-mac-arm64.zip`, at, 1000),
    object(`${LATEST}Kun-${version}-mac-arm64.zip.blockmap`, at, 10),
    object(`${LATEST}Kun-${version}-win-x64.exe`, at, 1000),
    object(`${LATEST}Kun-${version}-win-x64.exe.blockmap`, at, 10)
  ]
  const plan = planLatestPrune({
    prefix: LATEST,
    objects: [
      ...files('0.3.9', 1000),
      ...files('0.4.0', 2000),
      ...files('0.4.1', 3000),
      object(`${LATEST}latest.json`, 3000),
      object(`${LATEST}latest-mac.yml`, 3000),
      object(`${LATEST}Kun-TUI-0.2.0-mac-arm64.tar.gz`, 10)
    ],
    currentVersion: '0.4.1',
    keepBlockmaps: 2
  })

  assert.deepEqual(plan.deletedVersions, ['0.4.0', '0.3.9'])
  assert.deepEqual(plan.deleteKeys.sort(), [
    `${LATEST}Kun-0.3.9-mac-arm64.zip`,
    `${LATEST}Kun-0.3.9-mac-arm64.zip.blockmap`,
    `${LATEST}Kun-0.3.9-win-x64.exe`,
    `${LATEST}Kun-0.3.9-win-x64.exe.blockmap`,
    `${LATEST}Kun-0.4.0-mac-arm64.zip`,
    `${LATEST}Kun-0.4.0-win-x64.exe`
  ])
  assert.equal(plan.deleteBytes, 4020)
})

test('latest prune never deletes the published version even when it is not the newest upload', () => {
  const plan = planLatestPrune({
    prefix: LATEST,
    objects: [
      object(`${LATEST}Kun-20261017.1200-linux-amd64.deb`, 1000),
      object(`${LATEST}Kun-20261018.0000-linux-amd64.deb`, 2000)
    ],
    currentVersion: '20261017.1200',
    keepBlockmaps: 0
  })
  assert.deepEqual(plan.deleteKeys, [`${LATEST}Kun-20261018.0000-linux-amd64.deb`])
})

test('keep counts are validated integers read from release flags', () => {
  const { flags } = readArgs(['prune', '--keep', '4', '--keep-blockmaps', '0', '--dry-run'])
  assert.equal(readKeepCount(flags, 'keep', 3, 1), 4)
  assert.equal(readKeepCount(flags, 'keep-blockmaps', 10, 0), 0)
  assert.equal(readKeepCount(new Map(), 'keep', 3, 1), 3)
  assert.equal(flags.get('dry-run'), true)
  assert.throws(() => readKeepCount(new Map([['keep', '0']]), 'keep', 3, 1), /--keep must be an integer >= 1/)
  assert.throws(() => readKeepCount(new Map([['keep', '2.5']]), 'keep', 3, 1), /--keep must be/)
})

test('formats freed bytes for release logs', () => {
  assert.equal(formatBytes(512), '512 B')
  assert.equal(formatBytes(1536), '1.5 KB')
  assert.equal(formatBytes(3 * 1024 ** 3), '3.0 GB')
})

test('stable and daily workflows prune only after the new release is public', () => {
  const readJobs = (file) =>
    parse(readFileSync(new URL(`../.github/workflows/${file}`, import.meta.url), 'utf8')).jobs
  const release = readJobs('release.yml')['prune-r2']
  assert.deepEqual(release.needs, ['prepare', 'accept-and-publish'])
  assert.equal(release.if, "github.event_name != 'workflow_dispatch'")
  assert.deepEqual(release.permissions, { contents: 'read' })
  assert.match(release.steps.at(-1).run, /publish-r2\.mjs prune --tag "\$\{TAG_NAME\}" --channel stable$/)

  const daily = readJobs('daily-dev-prerelease.yml')['prune-r2']
  assert.deepEqual(daily.needs, ['prepare', 'publish'])
  assert.deepEqual(daily.permissions, { contents: 'read' })
  assert.match(daily.steps.at(-1).run, /publish-r2\.mjs prune --tag "\$\{TAG_NAME\}" --channel frontier$/)
})
