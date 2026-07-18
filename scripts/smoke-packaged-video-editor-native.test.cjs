'use strict'

const assert = require('node:assert/strict')
const { realpathSync } = require('node:fs')
const { chmod, mkdtemp, readFile, rm, writeFile } = require('node:fs/promises')
const { tmpdir } = require('node:os')
const { join, resolve } = require('node:path')
const test = require('node:test')
const { parse: parseYaml } = require('yaml')
const {
  createDeterministicVideoFixtureInvocations,
  resolveHostMediaExecutable
} = require('./lib/extension-native-media-smoke.cjs')
const {
  EXTENSION_VERSION,
  EXPECTED_TOOL_IDS,
  SUCCESS_MARKER,
  assertContent,
  assertCompletedArtifacts,
  assertH264Probe,
  assertPackagedReexecResult,
  assertRegisteredToolIds,
  assertReleaseArchive,
  assertSrtSidecar,
  createNpmInvocation,
  createPackagedReexecInvocation,
  parseCaptionMode
} = require('./smoke-packaged-video-editor-native.cjs')
const {
  createNativeMediaSmokeInvocation
} = require('./run-extension-native-media-smoke.cjs')

const root = resolve(__dirname, '..')
const PACKAGED_COMMAND = 'npm run smoke:packaged-video-editor-native'
const NATIVE_BROKER_COMMAND = 'npm run smoke:extension-native-media'
const EVIDENCE_COMMAND = 'npm run evidence:extension-native'
const VIDEO_EDITOR_PACK_COMMAND = 'npm run pack:kun-video-editor'

test('requires the complete packaged P0-P2 video tool surface', () => {
  const registrations = EXPECTED_TOOL_IDS.map((name) => ({ declaration: { name } }))
  assert.doesNotThrow(() => assertRegisteredToolIds(registrations))
  assert.throws(
    () => assertRegisteredToolIds(registrations.slice(1)),
    /missing: video-project/
  )
  assert.throws(
    () => assertRegisteredToolIds([
      ...registrations.slice(1),
      { declaration: { name: 'video-unknown' } }
    ]),
    /unexpected: video-unknown/
  )
})

test('keeps burned captions strict by default and allows an explicit sidecar fallback', () => {
  assert.equal(parseCaptionMode(undefined), 'both')
  assert.equal(parseCaptionMode('both'), 'both')
  assert.equal(parseCaptionMode('sidecar'), 'sidecar')
  assert.throws(() => parseCaptionMode('none'), /must be both or sidecar/)
})

test('resolves an explicit host media executable and fails closed for missing paths', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-native-media-resolve-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const executable = join(directory, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  await writeFile(executable, '')
  if (process.platform !== 'win32') await chmod(executable, 0o700)
  assert.equal(resolveHostMediaExecutable('ffmpeg', {
    environment: { KUN_FFMPEG_PATH: executable },
    platform: process.platform
  }), realpathSync(executable))
  assert.throws(() => resolveHostMediaExecutable('ffprobe', {
    environment: { KUN_FFPROBE_PATH: join(directory, 'missing') },
    platform: process.platform
  }), /does not identify an executable file/)
  assert.throws(() => resolveHostMediaExecutable('ffmpeg', {
    environment: { KUN_FFMPEG_PATH: 'relative/ffmpeg' },
    platform: process.platform
  }), /absolute path/)
  assert.throws(() => resolveHostMediaExecutable('ffprobe', {
    environment: { PATH: '' },
    platform: process.platform
  }), /required for the fail-closed media smoke/)
})

test('creates bounded argument-array-only deterministic H.264 fixtures', () => {
  const ffmpegPath = resolve('/tools/ffmpeg')
  const shortOutput = resolve('/workspace/short.mp4')
  const cancellationOutput = resolve('/workspace/cancellation.mp4')
  const invocations = createDeterministicVideoFixtureInvocations({
    ffmpegPath,
    shortOutput,
    cancellationOutput
  })
  assert.equal(invocations.length, 2)
  assert.deepEqual(invocations.map(({ command }) => command), [ffmpegPath, ffmpegPath])
  assert.deepEqual(invocations.map(({ args }) => args.at(-1)), [shortOutput, cancellationOutput])
  assert.deepEqual(invocations.map(({ args }) => args[args.indexOf('-t') + 1]), ['2', '45'])
  for (const invocation of invocations) {
    assert.ok(invocation.args.includes('libx264'))
    assert.ok(invocation.args.includes('yuv420p'))
    assert.equal(invocation.args.some((argument) => /[;&|`]/u.test(argument)), false)
  }
})

test('reexecutes the smoke in the host-native packaged Kun executable', () => {
  const invocation = createPackagedReexecInvocation({
    runtimeExecutable: '/packaged/Kun',
    scriptPath: '/repo/scripts/smoke-packaged-video-editor-native.cjs',
    argv: ['--resources', '/packaged/resources'],
    environment: {
      PATH: '/usr/bin',
      NODE_OPTIONS: '--inspect',
      ELECTRON_RENDERER_URL: 'http://127.0.0.1:5173'
    }
  })
  assert.equal(invocation.command, resolve('/packaged/Kun'))
  assert.deepEqual(invocation.args, [
    resolve('/repo/scripts/smoke-packaged-video-editor-native.cjs'),
    '--resources',
    '/packaged/resources'
  ])
  assert.equal(invocation.options.shell, false)
  assert.equal(invocation.options.env.ELECTRON_RUN_AS_NODE, '1')
  assert.equal(invocation.options.env.KUN_DISABLE_OS_CREDENTIAL_STORE, '1')
  assert.equal(invocation.options.env.KUN_PACKAGED_VIDEO_EDITOR_NATIVE_SMOKE_REEXEC, '1')
  assert.equal(invocation.options.timeout, 10 * 60_000)
  assert.equal(invocation.options.killSignal, 'SIGKILL')
  assert.equal(invocation.options.env.NODE_OPTIONS, undefined)
  assert.equal(invocation.options.env.ELECTRON_RENDERER_URL, undefined)
  assert.doesNotThrow(() => assertPackagedReexecResult({
    status: 0,
    stdout: `${SUCCESS_MARKER}darwin/arm64): passed\n`,
    stderr: ''
  }))
  assert.throws(() => assertPackagedReexecResult({ status: 0, stdout: '', stderr: '' }), /completion marker/)
  assert.throws(() => assertPackagedReexecResult({ status: 9, stdout: '', stderr: '' }), /child failed/)
})

test('runs npm and the opt-in native suite with explicit fail-closed environments', () => {
  const npm = createNpmInvocation({
    args: ['--prefix', '/repo/example', 'run', 'build'],
    cwd: '/repo',
    runtimeExecutable: '/packaged/Kun',
    environment: { npm_execpath: __filename },
    platform: process.platform
  })
  assert.equal(npm.command, '/packaged/Kun')
  assert.equal(npm.options.shell, false)
  assert.equal(npm.args[0], __filename)

  const native = createNativeMediaSmokeInvocation({
    root: '/repo',
    platform: process.platform,
    environment: {
      KUN_FFMPEG_PATH: process.execPath,
      KUN_FFPROBE_PATH: process.execPath
    }
  })
  assert.equal(native.options.shell, false)
  assert.equal(native.options.env.KUN_RUN_MEDIA_SMOKE, '1')
  assert.equal(native.options.env.KUN_FFMPEG_PATH, process.execPath)
  assert.equal(native.options.env.KUN_FFPROBE_PATH, process.execPath)
  assert.equal(native.options.timeout, 180_000)
  assert.equal(native.options.killSignal, 'SIGKILL')
})

test('validates post-export H.264 probe metadata', () => {
  assert.doesNotThrow(() => assertH264Probe({
    streams: [{ codec_type: 'video', codec_name: 'h264' }],
    format: { duration: '2.0' }
  }))
  assert.throws(() => assertH264Probe({
    streams: [{ codec_type: 'video', codec_name: 'vp9' }],
    format: { duration: '2.0' }
  }), /H\.264/)
  assert.throws(() => assertH264Probe({
    streams: [{ codec_type: 'video', codec_name: 'h264' }],
    format: { duration: '0' }
  }), /positive duration/)
})

test('compares structured tool content by value', () => {
  assert.deepEqual(
    assertContent({ content: { changedIds: [], state: { phase: 'ready' } } }, {
      changedIds: [],
      state: { phase: 'ready' }
    }, 'structured content'),
    { changedIds: [], state: { phase: 'ready' } }
  )
  assert.throws(
    () => assertContent({ content: { changedIds: ['asset-a'] } }, { changedIds: [] }, 'mismatch'),
    /expected content\.changedIds=\[\], got \["asset-a"\]/u
  )
})

test('requires exactly one video and one ordered deterministic SRT artifact', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-native-subtitle-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const subtitle = join(directory, 'final.srt')
  await writeFile(
    subtitle,
    '1\n00:00:00,000 --> 00:00:01,500\nA deterministic packaged caption\n\n'
  )
  assert.equal(
    await assertSrtSidecar(subtitle, 'test SRT'),
    '1\n00:00:00,000 --> 00:00:01,500\nA deterministic packaged caption'
  )
  await writeFile(
    subtitle,
    '2\n00:00:00,000 --> 00:00:01,500\nA deterministic packaged caption\n\n'
  )
  await assert.rejects(() => assertSrtSidecar(subtitle, 'misordered SRT'), /cue ordering\/content/)

  const completed = {
    content: { outcome: 'completed', state: 'completed', technicallyValidated: true },
    generatedArtifacts: [
      {
        artifactId: 'artifact_video',
        availability: 'available',
        mediaKind: 'video',
        mimeType: 'video/mp4'
      },
      {
        artifactId: 'artifact_subtitle',
        availability: 'available',
        mediaKind: 'subtitle',
        mimeType: 'application/x-subrip'
      }
    ]
  }
  assert.deepEqual(
    assertCompletedArtifacts(completed, [
      { mediaKind: 'video', mimeType: 'video/mp4' },
      { mediaKind: 'subtitle', mimeType: 'application/x-subrip' }
    ], 'video/SRT render').map(({ artifactId }) => artifactId),
    ['artifact_video', 'artifact_subtitle']
  )
  assert.throws(() => assertCompletedArtifacts({
    ...completed,
    generatedArtifacts: completed.generatedArtifacts.slice(0, 1)
  }, [
    { mediaKind: 'video', mimeType: 'video/mp4' },
    { mediaKind: 'subtitle', mimeType: 'application/x-subrip' }
  ], 'incomplete video/SRT render'), /exactly 2/)
})

test('accepts only the exact non-empty release archive for byte-identical lifecycle smoke', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'kun-native-release-archive-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const archive = join(directory, 'kun-video-editor-0.4.4.kunx')
  await writeFile(archive, 'release archive bytes')
  assert.doesNotThrow(() => assertReleaseArchive(archive))
  const wrong = join(directory, 'kun-video-editor-9.9.9.kunx')
  await writeFile(wrong, 'wrong release archive')
  assert.throws(() => assertReleaseArchive(wrong), /must be named/)
  await writeFile(archive, '')
  assert.throws(() => assertReleaseArchive(archive), /non-empty regular file/)
})

test('source smoke covers the real packaged video editor lifecycle and media outcomes', async () => {
  const source = await readFile(join(__dirname, 'smoke-packaged-video-editor-native.cjs'), 'utf8')
  for (const marker of [
    "'extension', 'validate'",
    "'extension', 'pack'",
    "'extension', 'install'",
    "'extension', 'uninstall'",
    "'onTool:video-project'",
    "'video-probe'",
    "kind: 'proof-frame'",
    "kind: 'h264-mp4'",
    "'video-update-timeline'",
    "captionMode = 'both'",
    "captionMode: paths.captionMode",
    "captionModeArgument('--caption-mode', 'both')",
    'subtitleOutputHandleId',
    "subtitleFormat: 'srt'",
    'application/x-subrip',
    'assertSrtSidecar',
    "'video-render-cancel'",
    "approvalCount('video-render-status')",
    "approvalCount('video-render-cancel')",
    'assertH264Probe',
    'generatedArtifacts',
    'artifacts.listOwned',
    'smoke.workspaceKey',
    "code: 'FFPROBE_UNAVAILABLE'",
    'ffprobe is unavailable',
    'assertSourcePreserved',
    'source preservation',
    "argumentValue('--archive')",
    'assertReleaseArchive',
    'archiveHash',
    'smoke archive changed during lifecycle validation',
    'ELECTRON_RUN_AS_NODE'
  ]) assert.ok(source.includes(marker), `packaged video smoke omits source marker: ${marker}`)
  assert.match(
    source,
    /setWorkspacePermissionGrant\([\s\S]*?\[\.\.\.active\.grantedPermissions\],[\s\S]*?active\.manifest\.version[\s\S]*?\)/u,
    'packaged video smoke must bind its workspace permission grant to the reviewed extension version'
  )
  assert.doesNotMatch(source, /https?:\/\/(?!invalid\.example)/u)
})

test('PR, release, and daily jobs run both native media smokes before evidence', async () => {
  const workflows = [
    ['PR', '.github/workflows/pr-checks.yml', ['package', 'package-macos', 'package-windows']],
    ['release', '.github/workflows/release.yml', ['build-macos', 'build-windows', 'build-linux']],
    ['daily', '.github/workflows/daily-dev-prerelease.yml', ['build-macos', 'build-windows', 'build-linux']]
  ]
  for (const [label, path, jobIds] of workflows) {
    const document = parseYaml(await readFile(join(root, path), 'utf8'))
    for (const jobId of jobIds) {
      const steps = document.jobs[jobId].steps
      const commands = steps.map((step) => step.run).filter((run) => typeof run === 'string')
      const nativeIndex = commands.indexOf(NATIVE_BROKER_COMMAND)
      const packagedIndex = commands.findIndex((command) => command.startsWith(PACKAGED_COMMAND))
      const evidenceIndex = commands.indexOf(EVIDENCE_COMMAND)
      assert.notEqual(nativeIndex, -1, `${label}/${jobId} omits fail-closed native broker smoke`)
      assert.notEqual(packagedIndex, -1, `${label}/${jobId} omits packaged video editor smoke`)
      assert.notEqual(evidenceIndex, -1, `${label}/${jobId} omits native evidence`)
      assert.ok(nativeIndex < evidenceIndex, `${label}/${jobId} records evidence before native broker smoke`)
      assert.ok(packagedIndex < evidenceIndex, `${label}/${jobId} records evidence before packaged video smoke`)
      for (const command of [NATIVE_BROKER_COMMAND, PACKAGED_COMMAND]) {
        const step = steps.find((candidate) =>
          typeof candidate.run === 'string' &&
          (command === PACKAGED_COMMAND ? candidate.run.startsWith(command) : candidate.run === command))
        assert.equal(step.if, undefined, `${label}/${jobId} conditionally runs ${command}`)
        assert.ok(
          step['continue-on-error'] === undefined || step['continue-on-error'] === false,
          `${label}/${jobId} does not fail closed for ${command}`
        )
        if (command === NATIVE_BROKER_COMMAND) {
          assert.equal(
            step.env?.KUN_RUN_MEDIA_SMOKE,
            '1',
            `${label}/${jobId} does not explicitly opt into the real native FFmpeg suite`
          )
        }
      }
      if (jobId === 'package' || jobId === 'build-linux') {
        const packIndex = commands.indexOf(VIDEO_EDITOR_PACK_COMMAND)
        assert.notEqual(packIndex, -1, `${label}/${jobId} omits deterministic release .kunx pack`)
        assert.ok(packIndex < packagedIndex, `${label}/${jobId} smokes before packing release .kunx`)
        assert.ok(
          commands[packagedIndex].includes(
            `--archive dist/kun-video-editor-${EXTENSION_VERSION}.kunx`
          ),
          `${label}/${jobId} does not smoke the uploaded release .kunx bytes`
        )
      }
    }
  }
})
