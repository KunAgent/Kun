import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import test from 'node:test'
import { createNativeEvidence } from './write-extension-native-evidence.mjs'
import {
  assertCleanReleaseCheckout,
  assertTagMatchesCheckout,
  createReleaseDownloadInvocation,
  verifyManualReleaseDirectory
} from './verify-manual-extension-release.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const VERSION = '1.2.3'
const TAG = `v${VERSION}`
const TOOLCHAIN = {
  ffmpegVersion: 'ffmpeg version 7.1 Copyright FFmpeg developers',
  ffprobeVersion: 'ffprobe version 7.1 Copyright FFmpeg developers',
  libx264: true,
  drawtext: true
}
const ARTIFACTS = [
  'Kun-1.2.3-mac-arm64.dmg',
  'Kun-1.2.3-mac-arm64.zip',
  'Kun-1.2.3-mac-x64.dmg',
  'Kun-1.2.3-mac-x64.zip',
  'Kun-1.2.3-win-x64.exe',
  'Kun-1.2.3-linux-x86_64.AppImage'
]

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'kun-manual-release-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ARTIFACTS) await writeFile(join(root, name), `bytes:${name}`)
  for (const platform of ['darwin', 'win32', 'linux']) {
    const evidence = await createNativeEvidence({
      distDirectory: root,
      platform,
      commit: COMMIT,
      mediaToolchain: TOOLCHAIN,
      environment: {}
    })
    await writeFile(
      join(root, `extension-native-evidence-${platform}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`
    )
  }
  await writeFile(join(root, 'kun-video-editor-0.1.0.kunx'), 'extension archive')
  return root
}

test('downloads a tag release with an argument array and no shell', () => {
  const invocation = createReleaseDownloadInvocation({ tag: TAG, directory: '/tmp/release' })
  assert.equal(invocation.command, 'gh')
  assert.deepEqual(invocation.args, [
    'release', 'download', TAG, '--dir', resolve('/tmp/release')
  ])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.timeout, 30 * 60_000)
})

test('requires the fetched release tag and local checkout to identify one commit', () => {
  assert.equal(assertTagMatchesCheckout({
    tag: TAG,
    checkedOutCommit: COMMIT.toUpperCase(),
    tagCommit: COMMIT
  }), COMMIT)
  assert.throws(() => assertTagMatchesCheckout({
    tag: TAG,
    checkedOutCommit: COMMIT,
    tagCommit: 'fedcba9876543210fedcba9876543210fedcba98'
  }), /local HEAD/)
})

test('rejects tracked and untracked release checkout changes before build', () => {
  assert.doesNotThrow(() => assertCleanReleaseCheckout(''))
  assert.throws(() => assertCleanReleaseCheckout(' M package.json\n'), /checkout is dirty/)
  assert.throws(() => assertCleanReleaseCheckout('?? local-release-note.txt\n'), /checkout is dirty/)
})

test('verifies the complete three-platform bundle and exact extension package', async (t) => {
  const directory = await fixture(t)
  const verifiedPackages = []
  const result = await verifyManualReleaseDirectory({
    directory,
    tag: TAG,
    expectedVersion: VERSION,
    checkedOutCommit: COMMIT,
    tagCommit: COMMIT,
    verifyPackage: async ({ input }) => {
      verifiedPackages.push(input)
      return { sha256: 'a'.repeat(64) }
    }
  })
  assert.equal(result.commit, COMMIT)
  assert.equal(result.native.artifacts.length, 6)
  assert.deepEqual(verifiedPackages, [directory])
})

test('fails closed before publish when Linux evidence or artifacts are missing', async (t) => {
  const directory = await fixture(t)
  await rm(join(directory, 'extension-native-evidence-linux.json'))
  await assert.rejects(verifyManualReleaseDirectory({
    directory,
    tag: TAG,
    expectedVersion: VERSION,
    checkedOutCommit: COMMIT,
    tagCommit: COMMIT,
    verifyPackage: async () => ({ sha256: 'a'.repeat(64) })
  }), /exactly one extension-native-evidence-linux/)
})
