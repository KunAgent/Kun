import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createNativeEvidence } from './write-extension-native-evidence.mjs'
import {
  resolveExpectedEvidenceCommit,
  verifyNativeEvidenceBundle
} from './verify-extension-native-evidence.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const VERSION = '1.2.3'
const MEDIA_TOOLCHAIN = {
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
  const root = await mkdtemp(join(tmpdir(), 'kun-native-evidence-bundle-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  for (const name of ARTIFACTS) await writeFile(join(root, name), `bytes:${name}`)
  for (const platform of ['darwin', 'win32', 'linux']) {
    const evidence = await createNativeEvidence({
      distDirectory: root,
      platform,
      commit: COMMIT,
      mediaToolchain: MEDIA_TOOLCHAIN,
      environment: {}
    })
    await writeFile(
      join(root, `extension-native-evidence-${platform}.json`),
      `${JSON.stringify(evidence, null, 2)}\n`
    )
  }
  return root
}

test('verifies three commit-bound evidence files against every final native artifact', async (t) => {
  const root = await fixture(t)
  const result = await verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: COMMIT,
    checkedOutCommit: COMMIT.toUpperCase(),
    tagCommit: COMMIT,
    expectedVersion: VERSION
  })
  assert.equal(result.commit, COMMIT)
  assert.equal(result.version, VERSION)
  assert.deepEqual(result.artifacts, [...ARTIFACTS].sort())
  assert.equal(result.evidenceFiles.length, 3)
})

test('rejects stale commits, tag drift, wrong versions, sizes, and hashes', async (t) => {
  const root = await fixture(t)
  const otherCommit = 'fedcba9876543210fedcba9876543210fedcba98'
  assert.throws(() => resolveExpectedEvidenceCommit({
    expectedCommit: COMMIT,
    checkedOutCommit: COMMIT,
    tagCommit: otherCommit
  }), /tag/i)
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: otherCommit,
    checkedOutCommit: otherCommit,
    expectedVersion: VERSION
  }), /commit does not match/i)
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: COMMIT,
    expectedVersion: '9.9.9'
  }), /does not match expected/i)

  await writeFile(join(root, ARTIFACTS[0]), 'tampered-but-different')
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /size mismatch|SHA-256 mismatch/)
})

test('rejects inconsistent platform versions and unproved media toolchain capabilities', async (t) => {
  const inconsistent = await fixture(t)
  const oldLinux = join(inconsistent, 'Kun-1.2.3-linux-x86_64.AppImage')
  const newLinux = join(inconsistent, 'Kun-1.2.4-linux-x86_64.AppImage')
  await rename(oldLinux, newLinux)
  const linuxEvidence = await createNativeEvidence({
    distDirectory: inconsistent,
    platform: 'linux',
    commit: COMMIT,
    mediaToolchain: MEDIA_TOOLCHAIN,
    environment: {}
  })
  await writeFile(
    join(inconsistent, 'extension-native-evidence-linux.json'),
    `${JSON.stringify(linuxEvidence, null, 2)}\n`
  )
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: inconsistent,
    expectedCommit: COMMIT
  }), /do not share one release version/)

  const unproved = await fixture(t)
  const evidencePath = join(unproved, 'extension-native-evidence-darwin.json')
  const evidence = JSON.parse(await readFile(evidencePath, 'utf8'))
  evidence.mediaToolchain.drawtext = false
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`)
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: unproved,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /required libx264\/drawtext capabilities/)
})

test('rejects missing, duplicate, and symlinked downloaded release files', async (t) => {
  const missing = await fixture(t)
  await rm(join(missing, ARTIFACTS.at(-1)))
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: missing,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /missing final artifact/)

  const duplicate = await fixture(t)
  const nested = join(duplicate, 'nested')
  await mkdir(nested)
  await writeFile(join(nested, ARTIFACTS[0]), 'duplicate')
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: duplicate,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /duplicate filename/)

  const linked = await fixture(t)
  await symlink(join(linked, ARTIFACTS[0]), join(linked, 'linked-artifact'))
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: linked,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /must not contain symlinks/)
})

test('rejects every extra native-looking release asset outside the six-file allowlist', async (t) => {
  for (const name of [
    'Kun-1.2.3-linux-arm64.AppImage',
    'Kun-1.2.3-win-arm64.exe',
    'Kun-1.2.3-win-x64.EXE',
    'Kun-1.2.3-win-x64.MSI',
    'Kun-1.2.3-mac-universal.dmg',
    'Kun-1.2.3-mac-universal.zip'
  ]) {
    await t.test(name, async (t) => {
      const root = await fixture(t)
      if (name === 'Kun-1.2.3-win-x64.EXE') {
        await rm(join(root, 'Kun-1.2.3-win-x64.exe'))
      }
      await writeFile(join(root, name), 'unbound extra native artifact')
      await assert.rejects(verifyNativeEvidenceBundle({
        directory: root,
        expectedCommit: COMMIT,
        expectedVersion: VERSION
      }), /unexpected Kun-named asset: Kun-/i)
    })
  }
})

test('allows only canonical same-version blockmaps as unrecorded ancillary assets', async (t) => {
  const root = await fixture(t)
  await writeFile(join(root, 'Kun-1.2.3-win-x64.exe.blockmap'), 'canonical blockmap')
  await verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  })

  await writeFile(join(root, 'Kun-9.9.9-linux-x86_64.AppImage.blockmap'), 'stale blockmap')
  await assert.rejects(verifyNativeEvidenceBundle({
    directory: root,
    expectedCommit: COMMIT,
    expectedVersion: VERSION
  }), /Ancillary native artifact version does not match/)
})
