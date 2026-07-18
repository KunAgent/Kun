import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  collectNativeArtifacts,
  createNativeEvidence,
  inspectMediaToolchain,
  resolveEvidenceCommit,
  writeNativeEvidence
} from './write-extension-native-evidence.mjs'

const COMMIT = '0123456789abcdef0123456789abcdef01234567'
const MEDIA_TOOLCHAIN = {
  ffmpegVersion: 'ffmpeg version 7.1 Copyright FFmpeg developers',
  ffprobeVersion: 'ffprobe version 7.1 Copyright FFmpeg developers',
  libx264: true,
  drawtext: true
}

async function temporaryDist(t) {
  const root = await mkdtemp(join(tmpdir(), 'kun-native-evidence-test-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  return root
}

test('collects exactly the final two-architecture macOS artifacts', async (t) => {
  const dist = await temporaryDist(t)
  for (const name of [
    'Kun-1.2.3-dev-4-mac-arm64.dmg',
    'Kun-1.2.3-dev-4-mac-arm64.zip',
    'Kun-1.2.3-dev-4-mac-x64.dmg',
    'Kun-1.2.3-dev-4-mac-x64.zip'
  ]) await writeFile(join(dist, name), name)
  await writeFile(join(dist, 'Kun-1.2.3-dev-4-mac-arm64.zip.blockmap'), 'ignored')

  assert.deepEqual(
    (await collectNativeArtifacts({ distDirectory: dist, platform: 'darwin' }))
      .map((path) => path.slice(dist.length + 1)),
    [
      'Kun-1.2.3-dev-4-mac-arm64.dmg',
      'Kun-1.2.3-dev-4-mac-arm64.zip',
      'Kun-1.2.3-dev-4-mac-x64.dmg',
      'Kun-1.2.3-dev-4-mac-x64.zip'
    ]
  )
})

test('fails closed for missing, duplicate, wrong-architecture, and non-file artifacts', async (t) => {
  const dist = await temporaryDist(t)
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }),
    /exactly one/
  )

  const first = join(dist, 'Kun-1.2.3-linux-x86_64.AppImage')
  await writeFile(first, 'first')
  const wrongArchitecture = join(dist, 'Kun-1.2.3-linux-arm64.AppImage')
  await writeFile(wrongArchitecture, 'wrong architecture')
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }),
    /Unexpected native linux artifact.*arm64/
  )
  await rm(wrongArchitecture)
  assert.deepEqual(await collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }), [first])

  await writeFile(join(dist, 'Kun-2.0.0-linux-x86_64.AppImage'), 'duplicate')
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }),
    /found 2/
  )

  await rm(join(dist, 'Kun-2.0.0-linux-x86_64.AppImage'))
  await rm(first)
  await mkdir(first)
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }),
    /regular file/
  )

  await rm(first, { recursive: true })
  const target = join(dist, 'target.AppImage')
  await writeFile(target, 'target')
  await symlink(target, first)
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'linux' }),
    /regular file/
  )

  const windowsDist = await temporaryDist(t)
  await writeFile(join(windowsDist, 'Kun-1.2.3-win-x64.EXE'), 'wrong case')
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: windowsDist, platform: 'win32' }),
    /Unexpected native win32 artifact.*\.EXE/
  )
})

test('writes deterministic commit-bound hashes without leaking environment data', async (t) => {
  const dist = await temporaryDist(t)
  const artifact = join(dist, 'Kun-1.2.3-win-x64.exe')
  await writeFile(artifact, 'native artifact')
  const evidence = await createNativeEvidence({
    distDirectory: dist,
    platform: 'win32',
    commit: COMMIT,
    mediaToolchain: MEDIA_TOOLCHAIN,
    environment: {
      GITHUB_REPOSITORY: 'KunAgent/Kun',
      GITHUB_RUN_ID: '1234',
      GITHUB_RUN_ATTEMPT: '2',
      SECRET_VALUE: 'must-not-appear'
    }
  })
  assert.deepEqual(evidence, {
    schemaVersion: 1,
    platform: 'win32',
    commit: COMMIT,
    mediaToolchain: MEDIA_TOOLCHAIN,
    run: {
      repository: 'KunAgent/Kun',
      runId: '1234',
      runAttempt: '2'
    },
    artifacts: [{
      file: 'Kun-1.2.3-win-x64.exe',
      bytes: 15,
      sha256: '9eaa01bd3b56258e0e41821a383e1e6282090e0f355fdf6c10883b38c612e8a8'
    }]
  })

  const output = join(dist, 'evidence.json')
  await writeNativeEvidence({
    distDirectory: dist,
    platform: 'win32',
    commit: COMMIT,
    mediaToolchain: MEDIA_TOOLCHAIN,
    environment: {},
    outputPath: output
  })
  const body = await readFile(output, 'utf8')
  assert.equal(body.endsWith('\n'), true)
  assert.equal(body.includes('must-not-appear'), false)
  await assert.rejects(
    writeNativeEvidence({
      distDirectory: dist,
      platform: 'win32',
      commit: COMMIT,
      mediaToolchain: MEDIA_TOOLCHAIN,
      environment: {},
      outputPath: output
    }),
    /EEXIST/
  )
})

test('rejects unsupported platforms and abbreviated commit identities', async (t) => {
  const dist = await temporaryDist(t)
  await assert.rejects(
    collectNativeArtifacts({ distDirectory: dist, platform: 'freebsd' }),
    /Unsupported/
  )
  await assert.rejects(
    createNativeEvidence({ distDirectory: dist, platform: 'linux', commit: 'deadbeef' }),
    /40-character/
  )
})

test('records bounded path-free tool versions and fails closed without required capabilities', async () => {
  const calls = []
  const execute = (executable, args) => {
    calls.push([executable, args])
    if (args[0] === '-version') {
      return executable.includes('probe')
        ? `${MEDIA_TOOLCHAIN.ffprobeVersion}\nconfiguration: hidden\n`
        : `${MEDIA_TOOLCHAIN.ffmpegVersion}\nconfiguration: hidden\n`
    }
    if (args.includes('-encoders')) return ' V....D libx264 H.264 encoder\n'
    return ' T.C drawtext V->V Draw text\n'
  }
  assert.deepEqual(inspectMediaToolchain({
    environment: { KUN_FFMPEG_PATH: '/private/bin/ffmpeg', KUN_FFPROBE_PATH: '/private/bin/ffprobe' },
    execute
  }), MEDIA_TOOLCHAIN)
  assert.equal(JSON.stringify(inspectMediaToolchain({ environment: {}, execute })).includes('/private'), false)
  assert.equal(calls.length, 8)

  assert.throws(() => inspectMediaToolchain({
    environment: {},
    execute: (_executable, args) => args[0] === '-version'
      ? `${args[0] === '-version' ? 'ffmpeg' : 'ffprobe'} version 7.1\n`
      : ''
  }), /ffprobe version|libx264/)
  await assert.rejects(createNativeEvidence({
    distDirectory: '/unused',
    platform: 'linux',
    commit: COMMIT,
    mediaToolchain: { ...MEDIA_TOOLCHAIN, drawtext: false }
  }), /drawtext/)
})

test('binds evidence to the checked-out commit and rejects stale workflow SHA metadata', () => {
  assert.equal(resolveEvidenceCommit({
    checkedOutCommit: COMMIT,
    environment: { KUN_EVIDENCE_COMMIT: COMMIT.toUpperCase() }
  }), COMMIT)
  assert.throws(() => resolveEvidenceCommit({
    checkedOutCommit: COMMIT,
    environment: { GITHUB_SHA: 'fedcba9876543210fedcba9876543210fedcba98' }
  }), /expected commit.*checked-out commit/i)
})
