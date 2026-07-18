import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'
import {
  EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
  EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
  ExtensionMediaProcessError,
  ExtensionMediaProcessService,
  detectBeatGridFromPcm,
  defaultMediaDiscoveryDirectories,
  runBoundedProcess
} from './extension-media-process-service.js'

const roots: string[] = []
const MEDIA_PROCESS_TEST_TIMEOUT_MS = 15_000

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture(scriptBody: string) {
  const root = await mkdtemp(join(tmpdir(), 'kun-media-process-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  const bin = join(root, process.platform === 'win32' ? 'ffprobe.exe' : 'ffprobe')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'clip.mp4'), Buffer.from('video-fixture'))
  await writeFile(bin, `#!/usr/bin/env node\n${scriptBody}\n`)
  if (process.platform !== 'win32') await chmod(bin, 0o755)
  const principal: ExtensionPrincipal = {
    extensionId: 'acme.video',
    extensionVersion: '1.0.0',
    permissions: ['media.read', 'media.process', 'workspace.read'],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  const handles = new ExtensionMediaHandleService({ dataDir })
  const handle = await handles.register(principal, {
    workspaceRoot: workspace,
    path: 'clip.mp4',
    mode: 'read',
    source: 'workspace'
  })
  const resolvedBin = await realpath(bin)
  return {
    root,
    workspace,
    dataDir,
    bin: resolvedBin,
    principal,
    handles,
    handle,
    processRunner: (_executable: string, args: string[], options: Parameters<typeof runBoundedProcess>[2]) =>
      runBoundedProcess(process.execPath, [resolvedBin, ...args], options)
  }
}

function createMediaProcessService(
  test: Awaited<ReturnType<typeof fixture>>,
  options: Omit<ConstructorParameters<typeof ExtensionMediaProcessService>[0], 'handleService' | 'processRunner'> = {}
): ExtensionMediaProcessService {
  return new ExtensionMediaProcessService({
    handleService: test.handles,
    processRunner: test.processRunner,
    ...options
  })
}

describe('ExtensionMediaProcessService', { timeout: MEDIA_PROCESS_TEST_TIMEOUT_MS }, () => {
  it('discovers a configured binary without returning its path', async () => {
    const test = await fixture(`process.stdout.write('ffprobe version 7.1-test\\n')`)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    const capability = (await service.capabilities(test.principal)).ffprobe
    expect(capability).toEqual({
      name: 'ffprobe',
      available: true,
      source: 'configured',
      version: '7.1-test'
    })
    expect(JSON.stringify(capability)).not.toContain(test.root)
  })

  it('discovers reviewed desktop prefixes before an inherited shell PATH', async () => {
    const test = await fixture(`process.stdout.write('ffprobe version 7.1-reviewed\\n')`)
    const service = createMediaProcessService(test, {
      pathEnv: process.env.PATH,
      discoveryDirectories: [test.root]
    })
    await expect(service.capabilities(test.principal)).resolves.toMatchObject({
      ffprobe: {
        name: 'ffprobe',
        available: true,
        source: 'path',
        version: '7.1-reviewed'
      }
    })
    expect(defaultMediaDiscoveryDirectories('darwin')).toEqual(expect.arrayContaining([
      '/opt/homebrew/opt/ffmpeg-full/bin',
      '/usr/local/opt/ffmpeg-full/bin'
    ]))
  })

  it('reports only the reviewed ffmpeg features used by public render plans', async () => {
    const test = await fixture(`
      const args = process.argv.slice(2)
      if (args.includes('-version')) process.stdout.write('ffmpeg version 8.0-test\\n')
      else if (args.includes('-encoders')) process.stdout.write(' V..... libx264 H.264\\n V..... libx265 HEVC\\n V..... prores_ks ProRes\\n V..... ffv1 FFV1\\n A..... aac AAC\\n A..... flac FLAC\\n A..... pcm_s24le PCM\\n V..... dangerous_extra ignored\\n')
      else if (args.includes('-filters')) process.stdout.write(' T.. drawtext V->V\\n ..S subtitles V->V\\n T.. eq V->V\\n T.. colorbalance V->V\\n T.. boxblur V->V\\n T.. unsharp V->V\\n T.. vignette V->V\\n ... arbitrary ignored\\n')
      else if (args.includes('-muxers')) process.stdout.write('  E mp4 MP4\\n  E mov MOV\\n  E matroska Matroska\\n  E dangerous ignored\\n')
    `)
    const service = createMediaProcessService(test, {
      ffmpegPath: test.bin,
      pathEnv: process.env.PATH
    })
    await expect(service.capabilities(test.principal)).resolves.toMatchObject({
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        version: '8.0-test',
        features: [
          'libx264-encoder',
          'libx265-encoder',
          'prores-ks-encoder',
          'ffv1-encoder',
          'aac-encoder',
          'flac-encoder',
          'pcm-s24-encoder',
          'drawtext-filter',
          'subtitles-filter',
          'eq-filter',
          'colorbalance-filter',
          'boxblur-filter',
          'unsharp-filter',
          'vignette-filter',
          'mp4-muxer',
          'mov-muxer',
          'matroska-muxer'
        ]
      }
    })
  })

  it('reads a successful FFmpeg filter inventory with variable display flags from stderr', async () => {
    const test = await fixture(`
      const args = process.argv.slice(2)
      if (args.includes('-version')) process.stdout.write('ffmpeg version 8.0-stderr-inventory\\n')
      else if (args.includes('-encoders')) process.stdout.write(' V..... libx264 H.264\\n A..... aac AAC\\n')
      else if (args.includes('-filters')) process.stderr.write(' TSC. drawtext V->V Draw text\\n')
      else if (args.includes('-muxers')) process.stdout.write('  E mp4 MP4\\n')
    `)
    const service = createMediaProcessService(test, {
      ffmpegPath: test.bin,
      pathEnv: process.env.PATH
    })

    await expect(service.capabilities(test.principal)).resolves.toMatchObject({
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        features: expect.arrayContaining([
          'libx264-encoder',
          'aac-encoder',
          'drawtext-filter',
          'mp4-muxer'
        ])
      }
    })
  })

  it('uses a fixed ffprobe profile and returns normalized bounded metadata', async () => {
    const payload = {
      format: {
        format_name: 'mov,mp4',
        format_long_name: 'QuickTime / MOV',
        duration: '1.250',
        start_time: '-0.125',
        size: '999',
        bit_rate: '1024'
      },
      streams: [{
        index: 0,
        codec_type: 'video',
        codec_name: 'h264',
        time_base: '1/90000',
        avg_frame_rate: '30000/1001',
        width: 1920,
        height: 1080,
        duration: '1.25',
        tags: { rotate: '90', language: 'eng' },
        disposition: { default: 1, forced: 0 }
      }]
    }
    const script = `
const args = process.argv.slice(2)
const expected = [
  '-v','error','-hide_banner',
  '-protocol_whitelist',${JSON.stringify(EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST)},
  '-format_whitelist',${JSON.stringify(EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST)},
  '-print_format','json','-show_format','-show_streams','-show_chapters'
]
if (expected.some((value, index) => args[index] !== value) || args.length !== expected.length + 1) process.exit(22)
process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`
    const test = await fixture(script)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    const result = await service.probe(test.principal, test.handle.id)
    expect(result).toMatchObject({
      schemaVersion: 1,
      handleId: test.handle.id,
      container: {
        formatNames: ['mov', 'mp4'],
        formatLongName: 'QuickTime / MOV',
        durationMicros: 1_250_000,
        startTimeMicros: -125_000,
        bitRate: 1024
      },
      streams: [{
        index: 0,
        kind: 'video',
        codecName: 'h264',
        frameRate: { numerator: 30_000, denominator: 1001 },
        width: 1920,
        height: 1080,
        rotationDegrees: 90,
        language: 'eng',
        disposition: { default: true, forced: false, attachedPicture: false }
      }]
    })
    expect(JSON.stringify(result)).not.toContain(test.workspace)
  })

  it('allows local SRT and WebVTT demuxers and accepts a subtitle stream without duration', async () => {
    expect(EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST.split(',')).toEqual(
      expect.arrayContaining(['srt', 'webvtt'])
    )
    for (const subtitle of [{
      formatName: 'srt',
      formatLongName: 'SubRip subtitle',
      codecName: 'subrip'
    }, {
      formatName: 'webvtt',
      formatLongName: 'WebVTT subtitle',
      codecName: 'webvtt'
    }]) {
      const payload = {
        format: {
          format_name: subtitle.formatName,
          format_long_name: subtitle.formatLongName
        },
        streams: [{
          index: 0,
          codec_type: 'subtitle',
          codec_name: subtitle.codecName,
          time_base: '1/1000',
          disposition: { default: 0, forced: 0 }
        }]
      }
      const script = `process.stdout.write(${JSON.stringify(JSON.stringify(payload))})`
      const test = await fixture(script)
      const service = createMediaProcessService(test, {
        ffprobePath: test.bin,
        pathEnv: process.env.PATH
      })
      const result = await service.probe(test.principal, test.handle.id)
      expect(result).toMatchObject({
        container: {
          formatNames: [subtitle.formatName],
          formatLongName: subtitle.formatLongName
        },
        streams: [{
          index: 0,
          kind: 'subtitle',
          codecName: subtitle.codecName,
          timeBase: { numerator: 1, denominator: 1000 }
        }]
      })
      expect(result.container.durationMicros).toBeUndefined()
      expect(result.streams[0]?.durationMicros).toBeUndefined()
    }
  })

  it('checks permission before attempting executable discovery', async () => {
    const test = await fixture(`process.exit(99)`)
    const service = createMediaProcessService(test, {
      ffprobePath: join(test.root, 'missing')
    })
    await expect(service.probe({ ...test.principal, permissions: [] }, test.handle.id))
      .rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('rejects image-sequence pattern syntax in a granted input name before spawn', async () => {
    const test = await fixture(`process.exit(99)`)
    await writeFile(join(test.workspace, 'frame%03d.png'), Buffer.from('image-fixture'))
    const patterned = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'frame%03d.png',
      mode: 'read',
      source: 'workspace'
    })
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    await expect(service.probe(test.principal, patterned.id))
      .rejects.toMatchObject({ code: 'invalid_probe_output' })
  })

  it('bounds output and cancellation without exposing local paths', async () => {
    const test = await fixture(`process.stdout.write('x'.repeat(8192)); setTimeout(() => {}, 30_000)`)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH,
      maxProbeOutputBytes: 1024
    })
    let caught: unknown
    try {
      await service.probe(test.principal, test.handle.id)
    } catch (error) {
      caught = error
    }
    expect(caught).toBeInstanceOf(ExtensionMediaProcessError)
    expect(caught).toMatchObject({ code: 'output_limit' })
    expect(String((caught as Error).message)).not.toContain(test.root)
  })

  it('reports invalid JSON with a stable redacted error', async () => {
    const test = await fixture(`process.stdout.write('{invalid')`)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    await expect(service.probe(test.principal, test.handle.id))
      .rejects.toMatchObject({ code: 'invalid_probe_output' })
  })

  it('reports missing executables and aborts a running probe', async () => {
    const test = await fixture(`setTimeout(() => process.stdout.write('{}'), 30_000)`)
    const missing = createMediaProcessService(test, {
      ffprobePath: join(test.root, 'missing-ffprobe'),
      pathEnv: ''
    })
    await expect(missing.probe(test.principal, test.handle.id))
      .rejects.toMatchObject({ code: 'executable_unavailable' })

    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    const controller = new AbortController()
    const pending = service.probe(test.principal, test.handle.id, { signal: controller.signal })
    setTimeout(() => controller.abort(), 25)
    await expect(pending).rejects.toMatchObject({ code: 'process_cancelled' })
  })

  it('negotiates verified silence plus Host-owned PCM sync and beat-analysis primitives', async () => {
    const test = await fixture(`
      const args = process.argv.slice(2)
      if (args.includes('-version')) process.stdout.write('ffmpeg version 8.0-audio-analysis\\n')
      else if (args.includes('-encoders')) process.stdout.write(' A..... pcm_s16le PCM\\n')
      else if (args.includes('-filters')) process.stdout.write(' ... silencedetect A->A\\n')
      else if (args.includes('-muxers')) process.stdout.write('  E s16le raw PCM\\n')
    `)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      ffmpegPath: test.bin,
      pathEnv: process.env.PATH
    })
    await expect(service.audioAnalysisCapabilities(test.principal)).resolves.toMatchObject({
      silence: true,
      syncFeatures: true,
      beatGrid: true
    })
  })

  it('runs fixed path-opaque silence, beat-grid, and bounded sync-feature analysis profiles', async () => {
    const probePayload = {
      format: { format_name: 'wav', duration: '16.000' },
      streams: [{
        index: 0,
        codec_type: 'audio',
        codec_name: 'pcm_s16le',
        duration: '16.000',
        sample_rate: '48000',
        channels: 1,
        disposition: { default: 1, forced: 0 }
      }]
    }
    const script = `
const args = process.argv.slice(2)
if (args.includes('-version')) process.stdout.write('ffmpeg version 8.0-analysis-fixture\\n')
else if (args.includes('-encoders') || args.includes('-filters') || args.includes('-muxers')) process.stdout.write('')
else if (args.includes('-show_format')) process.stdout.write(${JSON.stringify(JSON.stringify(probePayload))})
else if (args.some((value) => value.startsWith('silencedetect='))) {
  process.stderr.write('[silencedetect @ fixture] silence_start: 0.100000\\n')
  process.stderr.write('[silencedetect @ fixture] silence_end: 0.600000 | silence_duration: 0.500000\\n')
  process.stderr.write('[silencedetect @ fixture] silence_start: 1.500000\\n')
} else if (args.includes('pcm_s16le')) {
  const rateIndex = args.indexOf('-ar')
  const rate = Number(args[rateIndex + 1])
  if (rate === 200) {
    const samples = Buffer.alloc(3200 * 2)
    for (let beat = 0; beat < 32; beat += 1) {
      const amplitude = beat % 4 === 0 ? 30000 : 18000
      const start = beat * 100
      for (let index = start; index < start + 10; index += 1) {
        samples.writeInt16LE(index % 2 === 0 ? amplitude : -amplitude, index * 2)
      }
    }
    process.stdout.write(samples)
  } else {
    const samples = Buffer.alloc(2000 * 2)
    for (let index = 0; index < 2000; index += 1) {
      const window = Math.floor(index / 100)
      const amplitude = 500 + ((window * 7919) % 12000)
      samples.writeInt16LE(index % 2 === 0 ? amplitude : -amplitude, index * 2)
    }
    process.stdout.write(samples)
  }
} else process.exit(23)
`
    const test = await fixture(script)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      ffmpegPath: test.bin,
      pathEnv: process.env.PATH
    })
    const silence = await service.analyzeSilenceForCore(test.principal, test.handle.id, {
      noiseThresholdDb: -35,
      minimumSilenceMicros: 300_000,
      maxIntervals: 10
    })
    expect(silence).toMatchObject({
      intervals: [
        {
          startMicros: 100_000,
          endMicros: 600_000,
          confidence: 1,
          confidenceSemantics: 'threshold-classification'
        },
        { startMicros: 1_500_000, endMicros: 16_000_000 }
      ],
      analyzedDurationMicros: 16_000_000,
      truncated: false
    })
    const sync = await service.extractSyncFeaturesForCore(test.principal, test.handle.id, {
      samplePeriodMicros: 100_000,
      maximumDurationMicros: 2_000_000,
      maxFeaturePoints: 20
    })
    expect(sync.features).toHaveLength(20)
    expect(sync.features.some((value) => value < 0)).toBe(true)
    expect(sync.features.some((value) => value > 0)).toBe(true)
    expect(sync).toMatchObject({
      source: {
        handleId: test.handle.id,
        fingerprintAlgorithm: 'sha256-file-identity-v1'
      },
      analyzedDurationMicros: 2_000_000,
      truncated: true
    })
    expect(sync.source.fingerprint).toMatch(/^[a-f0-9]{64}$/u)
    const beats = await service.analyzeBeatGridForCore(test.principal, test.handle.id, {
      maxMarkers: 20
    })
    expect(beats).toMatchObject({
      tempoBpm: 120,
      analyzedDurationMicros: 16_000_000,
      truncated: true,
      source: {
        handleId: test.handle.id,
        fingerprintAlgorithm: 'sha256-file-identity-v1'
      }
    })
    expect(beats.markers).toHaveLength(20)
    expect(beats.markers.some(({ kind }) => kind === 'downbeat')).toBe(true)
    expect(beats.markers.every(({ confidence }) => confidence >= 0.65)).toBe(true)
    expect(JSON.stringify({ silence, sync, beats })).not.toContain(test.workspace)
  })

  it('returns no beat markers for ambiguous constant PCM instead of fabricating a grid', () => {
    const pcm = Buffer.alloc(10_000 * 2)
    for (let index = 0; index < 10_000; index += 1) pcm.writeInt16LE(2_000, index * 2)
    expect(detectBeatGridFromPcm(pcm, 100)).toMatchObject({
      markers: [],
      analyzedDurationMicros: 50_000_000,
      truncated: false
    })
  })

  it('terminates the supervised descendant process tree on cancellation', async () => {
    const test = await fixture(`
const fs = require('node:fs')
const { spawn } = require('node:child_process')
const descendant = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
  stdio: 'ignore',
  windowsHide: true
})
fs.writeFileSync(process.argv.at(-1) + '.descendant-pid', String(descendant.pid))
setInterval(() => {}, 1000)
`)
    const service = createMediaProcessService(test, {
      ffprobePath: test.bin,
      pathEnv: process.env.PATH
    })
    const controller = new AbortController()
    const pending = service.probe(test.principal, test.handle.id, { signal: controller.signal })
    const pidFile = join(test.workspace, 'clip.mp4.descendant-pid')
    const descendantPid = await waitForDescendantPid(pidFile)
    controller.abort()
    await expect(pending).rejects.toMatchObject({ code: 'process_cancelled' })
    await expectProcessExit(descendantPid)
  }, 10_000)
})

async function waitForDescendantPid(path: string): Promise<number> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      const pid = Number((await readFile(path, 'utf8')).trim())
      if (Number.isSafeInteger(pid) && pid > 0) return pid
    } catch {
      // The supervised probe has not written its child PID yet.
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error('Timed out waiting for the supervised descendant PID')
}

async function expectProcessExit(pid: number): Promise<void> {
  const deadline = Date.now() + 3_000
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ESRCH') return
      throw error
    }
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 20))
  }
  throw new Error(`Supervised descendant ${pid} survived cancellation`)
}
