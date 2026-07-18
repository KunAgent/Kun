import { chmod, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'
import {
  EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
  EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
  ExtensionMediaProcessService,
  runBoundedProcess
} from './extension-media-process-service.js'
import {
  ExtensionMediaFfmpegService,
  validateAndSubstituteFfmpegArguments
} from './extension-media-ffmpeg-service.js'

const roots: string[] = []
const MEDIA_PROCESS_TEST_TIMEOUT_MS = 15_000

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'kun-media-ffmpeg-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  const bin = join(root, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg')
  await mkdir(join(workspace, 'exports'), { recursive: true })
  await writeFile(join(workspace, 'clip.mp4'), Buffer.from('source-video'))
  await writeFile(bin, `#!/usr/bin/env node
const fs = require('node:fs')
if (process.argv.includes('-version')) {
  process.stdout.write('ffmpeg version 7.1-test\\n')
  process.exit(0)
}
const target = process.argv.at(-1)
fs.writeFileSync(target, Buffer.from('rendered-video'))
process.stdout.write('frame=12\\nout_time_us=1250000\\ntotal_size=14\\nspeed=2.5x\\nprogress=end\\n')
`)
  if (process.platform !== 'win32') await chmod(bin, 0o755)
  const principal: ExtensionPrincipal = {
    extensionId: 'acme.video',
    extensionVersion: '1.0.0',
    permissions: [
      'media.read',
      'media.process',
      'media.export',
      'workspace.read',
      'workspace.write'
    ],
    workspaceRoots: [workspace],
    workspaceTrusted: true
  }
  const handles = new ExtensionMediaHandleService({ dataDir })
  const input = await handles.register(principal, {
    workspaceRoot: workspace,
    path: 'clip.mp4',
    mode: 'read',
    source: 'workspace'
  })
  const output = await handles.register(principal, {
    workspaceRoot: workspace,
    path: 'exports/final.mp4',
    mode: 'write',
    source: 'workspace'
  })
  const processes = new ExtensionMediaProcessService({
    handleService: handles,
    ffmpegPath: bin,
    pathEnv: process.env.PATH,
    processRunner: (_executable, args, options) =>
      runBoundedProcess(process.execPath, [bin, ...args], options)
  })
  const ffmpeg = new ExtensionMediaFfmpegService({ handleService: handles, processService: processes })
  return {
    root,
    workspace,
    dataDir,
    bin,
    principal,
    handles,
    input,
    output,
    ffmpeg,
    processRunner: (_executable: string, args: string[], options: Parameters<typeof runBoundedProcess>[2]) =>
      runBoundedProcess(process.execPath, [bin, ...args], options)
  }
}

describe('validateAndSubstituteFfmpegArguments', () => {
  it('substitutes only exact declared resource placeholders', () => {
    expect(validateAndSubstituteFfmpegArguments(
      [
        '-ss', '0.125000', '-i', '{{input:source}}',
        '-c:v', 'libx264', '-r', '30000/1001', '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).toEqual([
      '-ss', '0.125000',
      '-protocol_whitelist', EXTENSION_MEDIA_INPUT_PROTOCOL_WHITELIST,
      '-format_whitelist', EXTENSION_MEDIA_INPUT_FORMAT_WHITELIST,
      '-i', '/host/source.mp4',
      '-c:v', 'libx264', '-r', '30000/1001', '/host/.staging.mp4'
    ])
  })

  it('accepts reviewed inline drawtext while rejecting file-backed options', () => {
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-i', '{{input:source}}',
        '-vf', "drawtext=text=Hello\\\\: % $ ` {{ fontfile=/etc/passwd:font=Kun Sans:expansion=none:fontsize=32:x=10:y=20",
        '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).not.toThrow()
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-i', '{{input:source}}',
        '-vf', 'drawtext=text=Hello:expansion=none:fontfile=/etc/passwd',
        '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).toThrow()
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-i', '{{input:source}}',
        '-vf', 'drawtext=text=Hello:font=../Kun Sans:expansion=none',
        '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).toThrow()
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-i', '{{input:source}}',
        '-vf', 'drawtext=textfile=/etc/passwd:expansion=none',
        '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).toThrow()
  })

  it('accepts the reviewed composed-video filter chain used by the editor', () => {
    const graph = [
      'color=c=#000000:s=1920x1080:r=30000/1001:d=1.500000[base]',
      '[0:v]setpts=(PTS-STARTPTS)/1*1,scale=1920:1080:force_original_aspect_ratio=decrease,' +
        'format=rgba,colorchannelmixer=aa=1.0000,setpts=PTS+0.000000/TB[vprep0]',
      "[base][vprep0]overlay=x='(W-w)/2':y='(H-h)/2':eof_action=pass:" +
        "enable='between(t,0.000000,1.500000)'[vcomp0]",
      "[vcomp0]drawtext=text=Hello\\\\: % $ `:expansion=none:fontcolor=0xFFFFFF:" +
        "font=sans-serif:fontsize=48:box=1:boxcolor=0x000000@0.65:boxborderw=12:x=(w-text_w)/2:" +
        "y=h-text_h-h/12:enable='between(t,0.000000,1.500000)'[captioned0]"
    ].join(';')
    expect(() => validateAndSubstituteFfmpegArguments(
      ['-i', '{{input:source}}', '-filter_complex', graph, '-map', '[captioned0]', '{{output:video}}'],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).not.toThrow()
  })

  it('accepts the bounded progressive filmstrip filter chain', () => {
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-nostdin', '-i', '{{input:source}}', '-vf',
        'fps=1/5.000000,scale=320:-2,tile=3x1',
        '-frames:v', '1', '-f', 'image2', '{{output:filmstrip}}'
      ],
      { source: '/host/source.mp4' },
      { filmstrip: '/host/.staging.png' }
    )).not.toThrow()
  })

  it('accepts the reviewed deterministic CPU effect filters', () => {
    const graph = [
      '[0:v]eq=brightness=0.1:contrast=1.2:saturation=0.9:gamma=1.1,' +
        'colorbalance=rs=0.1:bs=-0.1:gm=0.05,' +
        'boxblur=luma_radius=4:luma_power=1:chroma_radius=4:chroma_power=1,' +
        'unsharp=5:5:1.25:5:5:0,vignette=angle=1.204277[effected]',
      '[effected]scale=1280:720:flags=lanczos,fps=24/1[output]'
    ].join(';')
    expect(() => validateAndSubstituteFfmpegArguments(
      ['-i', '{{input:source}}', '-filter_complex', graph, '-map', '[output]', '{{output:video}}'],
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).not.toThrow()
  })

  it.each([
    [
      'H.265 MP4',
      [
        '-c:v', 'libx265', '-preset', 'slow', '-crf', '14', '-pix_fmt', 'yuv420p',
        '-tag:v', 'hvc1', '-c:a', 'aac', '-ar', '48000', '-ac', '2', '-b:a', '192k',
        '-movflags', '+faststart', '-f', 'mp4'
      ]
    ],
    [
      'ProRes MOV',
      [
        '-c:v', 'prores_ks', '-profile:v', '3', '-pix_fmt', 'yuv422p10le',
        '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2', '-f', 'mov'
      ]
    ],
    [
      'FFV1 Matroska portable fallback',
      [
        '-c:v', 'ffv1', '-level', '3', '-coder', '1', '-context', '1',
        '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s24le', '-ar', '48000', '-ac', '2',
        '-f', 'matroska'
      ]
    ]
  ])('accepts the reviewed %s advanced export profile', (_label, codecArgs) => {
    expect(() => validateAndSubstituteFfmpegArguments(
      [
        '-nostdin', '-i', '{{input:source}}', '-vf',
        'scale=1280:720:flags=lanczos,fps=24/1',
        '-map', '0:v:0', '-map', '0:a:0',
        ...codecArgs,
        '{{output:video}}'
      ],
      { source: '/host/source.mp4' },
      { video: '/host/.staging-output' }
    )).not.toThrow()
  })

  it.each([
    ['-i', 'https://example.com/video.mp4', '{{output:video}}'],
    ['-i', '../secret.mp4', '{{output:video}}'],
    ['-i', '@args.txt', '{{output:video}}'],
    ['-i', '{{input:source}}', '-filter_script', 'filter.txt', '{{output:video}}'],
    ['-i', '{{input:source}}', '-vf', 'movie=/etc/passwd', '{{output:video}}'],
    ['-i', '{{input:source}}', '-progress', 'pipe:2', '{{output:video}}'],
    ['-f', 'concat', '-safe', '0', '-i', '{{input:source}}', '{{output:video}}'],
    ['-i', '{{input:source}}', '-f', 'hls', '{{output:video}}'],
    ['-i', '{{input:source}}', '-pass', '1', '{{output:video}}'],
    ['-i', '{{input:source}}', '-passlogfile:v', '{{output:video}}'],
    ['-i', '{{input:source}}', '-dump_attachment:t:0', '{{output:video}}'],
    ['-i', '{{input:source}}', '-hls_segment_filename', '{{output:video}}']
  ])('rejects undeclared paths, protocols, response files, and Host-reserved options', (...args) => {
    expect(() => validateAndSubstituteFfmpegArguments(
      args,
      { source: '/host/source.mp4' },
      { video: '/host/.staging.mp4' }
    )).toThrow()
  })
})

describe('ExtensionMediaFfmpegService', { timeout: MEDIA_PROCESS_TEST_TIMEOUT_MS }, () => {
  it('renders to staging, promotes atomically, reports progress, and returns a read handle', async () => {
    const test = await fixture()
    const progress: unknown[] = []
    const result = await test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '-c:v', 'libx264', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    }, { operationId: 'job-1', onProgress: (value) => progress.push(value) })
    expect(await readFile(join(test.workspace, 'exports', 'final.mp4'), 'utf8')).toBe('rendered-video')
    expect(result.generatedMedia).toHaveLength(1)
    expect(result.generatedMedia[0]).toMatchObject({
      mode: 'read',
      source: 'generated',
      displayName: 'final.mp4',
      byteSize: 14
    })
    expect(progress).toContainEqual({
      frame: 12,
      outTimeMicros: 1_250_000,
      outputBytes: 14,
      speed: 2.5,
      terminal: true
    })
  })

  it('promotes a text-only subtitle transaction without starting FFmpeg and can roll it back', async () => {
    const test = await fixture()
    const targetPath = join(test.workspace, 'exports', 'captions.srt')
    await writeFile(targetPath, 'original captions')
    const output = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/captions.srt',
      mode: 'write',
      source: 'workspace'
    })
    const runFfmpegForCore = vi.fn(async () => {
      throw new Error('FFmpeg must not start for a text-only media job')
    })
    const service = new ExtensionMediaFfmpegService({
      handleService: test.handles,
      processService: { runFfmpegForCore } as never
    })
    const request = {
      arguments: [],
      inputs: {},
      outputs: {},
      textOutputs: {
        captions: {
          handleId: output.id,
          mimeType: 'application/x-subrip' as const,
          content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
        }
      }
    }

    const transaction = await service.executeTransaction(test.principal, request, {
      operationId: 'text-only-rollback'
    })
    expect(runFfmpegForCore).not.toHaveBeenCalled()
    expect(await readFile(targetPath, 'utf8')).toContain('Hello')
    expect(transaction.generatedMedia).toHaveLength(1)
    expect(transaction.generatedMedia[0]).toMatchObject({
      mode: 'read',
      source: 'generated',
      mimeType: 'application/x-subrip'
    })

    await transaction.rollback()
    expect(await readFile(targetPath, 'utf8')).toBe('original captions')
    await expect(test.handles.resolve(
      test.principal,
      transaction.generatedMedia[0]!.id,
      'read'
    )).rejects.toMatchObject({ code: 'not_found' })
    await expect(test.handles.reserveOutput(test.principal, output.id, 'next-text-job'))
      .resolves.toBeDefined()
    await test.handles.releaseOutputReservation(test.principal, output.id, 'next-text-job')
    expect((await readdir(join(test.workspace, 'exports')))
      .filter((name) => name.includes('.kun-'))).toEqual([])
  })

  it('atomically promotes bounded path-opaque OpenTimelineIO JSON without starting FFmpeg', async () => {
    const test = await fixture()
    const targetPath = join(test.workspace, 'exports', 'timeline.otio')
    const output = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/timeline.otio',
      mode: 'write',
      source: 'workspace'
    })
    const document = JSON.stringify({
      OTIO_SCHEMA: 'SerializableCollection.1',
      name: 'Cut',
      children: [{
        OTIO_SCHEMA: 'Timeline.1',
        metadata: { kun: { id: 'sequence-main' } },
        tracks: { OTIO_SCHEMA: 'Stack.1', children: [] }
      }]
    })
    const runFfmpegForCore = vi.fn(async () => {
      throw new Error('FFmpeg must not start for an OTIO text job')
    })
    const service = new ExtensionMediaFfmpegService({
      handleService: test.handles,
      processService: { runFfmpegForCore } as never
    })
    const transaction = await service.executeTransaction(test.principal, {
      arguments: [],
      inputs: {},
      outputs: {},
      textOutputs: {
        interchange: {
          handleId: output.id,
          mimeType: 'application/x-otio+json',
          content: document
        }
      }
    }, { operationId: 'otio-text-output' })

    expect(runFfmpegForCore).not.toHaveBeenCalled()
    expect(JSON.parse(await readFile(targetPath, 'utf8'))).toMatchObject({
      OTIO_SCHEMA: 'SerializableCollection.1', name: 'Cut'
    })
    expect(transaction.generatedMedia[0]).toMatchObject({
      mimeType: 'application/x-otio+json', source: 'generated'
    })
    await transaction.commit()

    const unsafe = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/unsafe.otio',
      mode: 'write',
      source: 'workspace'
    })
    await expect(service.executeTransaction(test.principal, {
      arguments: [], inputs: {}, outputs: {},
      textOutputs: {
        interchange: {
          handleId: unsafe.id,
          mimeType: 'application/x-otio+json',
          content: JSON.stringify({
            OTIO_SCHEMA: 'SerializableCollection.1',
            children: [{ target_url: 'file:///private/source.mov' }]
          })
        }
      }
    }, { operationId: 'unsafe-otio-text-output' })).rejects.toMatchObject({ code: 'invalid_argument' })
  })

  it('recovers an interrupted text-only output without starting FFmpeg', async () => {
    const test = await fixture()
    const targetPath = join(test.workspace, 'exports', 'recovered-captions.vtt')
    await writeFile(targetPath, 'WEBVTT\n\noriginal\n')
    const output = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/recovered-captions.vtt',
      mode: 'write',
      source: 'workspace'
    })
    const request = {
      arguments: [],
      inputs: {},
      outputs: {},
      textOutputs: {
        captions: {
          handleId: output.id,
          mimeType: 'text/vtt' as const,
          content: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nHello\n'
        }
      }
    }
    const runFfmpegForCore = vi.fn(async () => {
      throw new Error('FFmpeg must not start for a text-only media job')
    })
    const service = new ExtensionMediaFfmpegService({
      handleService: test.handles,
      processService: { runFfmpegForCore } as never
    })
    await service.executeTransaction(test.principal, request, {
      operationId: 'text-only-interrupted'
    })
    expect(await readFile(targetPath, 'utf8')).toContain('Hello')

    const recoveredHandles = new ExtensionMediaHandleService({ dataDir: test.dataDir })
    const recovered = new ExtensionMediaFfmpegService({
      handleService: recoveredHandles,
      processService: { runFfmpegForCore } as never
    })
    await recovered.rollbackInterruptedTransaction(
      test.principal,
      request,
      'text-only-interrupted'
    )

    expect(runFfmpegForCore).not.toHaveBeenCalled()
    expect(await readFile(targetPath, 'utf8')).toBe('WEBVTT\n\noriginal\n')
    expect((await recoveredHandles.list(test.principal))
      .filter(({ source }) => source === 'generated')).toHaveLength(0)
    expect((await readdir(join(test.workspace, 'exports')))
      .filter((name) => name.includes('.kun-'))).toEqual([])
  })

  it('restores prior targets and provisional handles when a running job is recovered', async () => {
    const test = await fixture()
    const targetPath = join(test.workspace, 'exports', 'recovered.mp4')
    await writeFile(targetPath, 'sentinel-original')
    const output = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/recovered.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const request = {
      arguments: ['-i', '{{input:source}}', '-c:v', 'libx264', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: output.id }
    }

    const transaction = await test.ffmpeg.executeTransaction(test.principal, request, {
      operationId: 'job-interrupted-after-promotion'
    })
    expect(await readFile(targetPath, 'utf8')).toBe('rendered-video')
    expect(transaction.generatedMedia).toHaveLength(1)

    const recoveredHandles = new ExtensionMediaHandleService({ dataDir: test.dataDir })
    const recoveredFfmpeg = new ExtensionMediaFfmpegService({
      handleService: recoveredHandles,
      processService: new ExtensionMediaProcessService({
        handleService: recoveredHandles,
        ffmpegPath: test.bin,
        pathEnv: process.env.PATH,
        processRunner: test.processRunner
      })
    })
    await recoveredFfmpeg.rollbackInterruptedTransaction(
      test.principal,
      request,
      'job-interrupted-after-promotion'
    )

    expect(await readFile(targetPath, 'utf8')).toBe('sentinel-original')
    expect((await recoveredHandles.list(test.principal))
      .filter(({ source }) => source === 'generated')).toHaveLength(0)
    await expect(recoveredHandles.reserveOutput(test.principal, output.id, 'next-job'))
      .resolves.toBeDefined()
    await recoveredHandles.releaseOutputReservation(test.principal, output.id, 'next-job')
    expect((await readdir(join(test.workspace, 'exports')))
      .filter((name) => name.includes('.kun-'))).toEqual([])
  })

  it('finalizes provisional handles and backups for a recovered completed job', async () => {
    const test = await fixture()
    const targetPath = join(test.workspace, 'exports', 'completed-recovery.mp4')
    await writeFile(targetPath, 'sentinel-original')
    const output = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/completed-recovery.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const request = {
      arguments: ['-i', '{{input:source}}', '-c:v', 'libx264', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: output.id }
    }
    const transaction = await test.ffmpeg.executeTransaction(test.principal, request, {
      operationId: 'job-completed-before-finalizer'
    })

    const recoveredHandles = new ExtensionMediaHandleService({ dataDir: test.dataDir })
    const recoveredFfmpeg = new ExtensionMediaFfmpegService({
      handleService: recoveredHandles,
      processService: new ExtensionMediaProcessService({
        handleService: recoveredHandles,
        ffmpegPath: test.bin,
        pathEnv: process.env.PATH,
        processRunner: test.processRunner
      })
    })
    await recoveredFfmpeg.commitRecoveredTransaction(
      test.principal,
      request,
      'job-completed-before-finalizer'
    )
    await recoveredFfmpeg.commitRecoveredTransaction(
      test.principal,
      request,
      'job-completed-before-finalizer'
    )

    expect(await readFile(targetPath, 'utf8')).toBe('rendered-video')
    await expect(recoveredHandles.resolve(
      test.principal,
      transaction.generatedMedia[0]!.id,
      'read'
    )).resolves.toMatchObject({ available: true, source: 'generated' })
    expect((await readdir(join(test.workspace, 'exports')))
      .filter((name) => name.includes('.kun-'))).toEqual([])
  })

  it('rejects input/output aliases before starting ffmpeg', async () => {
    const test = await fixture()
    const aliasedOutput = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'clip.mp4',
      mode: 'write',
      source: 'workspace'
    })
    await expect(test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: aliasedOutput.id }
    })).rejects.toMatchObject({ code: 'output_alias' })
    expect(await readFile(join(test.workspace, 'clip.mp4'), 'utf8')).toBe('source-video')
  })

  it('rejects output pattern extensions and releases the reservation', async () => {
    const test = await fixture()
    const patterned = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/frame.%03d',
      mode: 'write',
      source: 'workspace'
    })
    await expect(test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: patterned.id }
    }, { operationId: 'pattern-job' })).rejects.toMatchObject({ code: 'invalid_argument' })
    await expect(test.handles.reserveOutput(test.principal, patterned.id, 'next-job'))
      .resolves.toBeDefined()
    await test.handles.releaseOutputReservation(test.principal, patterned.id, 'next-job')
  })

  it('checks the complete permission set before resolving handles', async () => {
    const test = await fixture()
    await expect(test.ffmpeg.execute({ ...test.principal, permissions: [] }, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    })).rejects.toMatchObject({ code: 'permission_denied' })
  })

  it('rejects oversized and missing declared outputs without publishing artifacts', async () => {
    const oversized = await fixture()
    await writeFile(oversized.bin, `#!/usr/bin/env node
const fs = require('node:fs')
fs.writeFileSync(process.argv.at(-1), Buffer.alloc(2048))
`)
    const oversizedProcesses = new ExtensionMediaProcessService({
      handleService: oversized.handles,
      ffmpegPath: oversized.bin,
      pathEnv: process.env.PATH,
      processRunner: oversized.processRunner
    })
    const bounded = new ExtensionMediaFfmpegService({
      handleService: oversized.handles,
      processService: oversizedProcesses,
      maxOutputBytes: 1024
    })
    await expect(bounded.execute(oversized.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: oversized.input.id },
      outputs: { video: oversized.output.id }
    })).rejects.toMatchObject({ code: 'output_limit' })

    const missing = await fixture()
    await writeFile(missing.bin, '#!/usr/bin/env node\nprocess.exit(0)\n')
    const missingProcesses = new ExtensionMediaProcessService({
      handleService: missing.handles,
      ffmpegPath: missing.bin,
      pathEnv: process.env.PATH,
      processRunner: missing.processRunner
    })
    const invalid = new ExtensionMediaFfmpegService({
      handleService: missing.handles,
      processService: missingProcesses
    })
    await expect(invalid.execute(missing.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: missing.input.id },
      outputs: { video: missing.output.id }
    })).rejects.toMatchObject({ code: 'invalid_output' })
  })

  it('rejects and removes undeclared muxer sidecars from the private staging directory', async () => {
    const test = await fixture()
    await writeFile(test.bin, `#!/usr/bin/env node
const fs = require('node:fs')
const target = process.argv.at(-1)
fs.writeFileSync(target, Buffer.from('playlist'))
fs.writeFileSync(target + '.segment', Buffer.from('sidecar'))
`)
    await expect(test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    })).rejects.toMatchObject({ code: 'invalid_output' })
    expect(await readdir(join(test.workspace, 'exports'))).toEqual([])
  })

  it('rolls every promoted output back when atomic handle completion fails', async () => {
    const test = await fixture()
    const videoPath = join(test.workspace, 'exports', 'existing.mp4')
    const subtitlePath = join(test.workspace, 'exports', 'existing.srt')
    await writeFile(videoPath, Buffer.from('original-video'))
    await writeFile(subtitlePath, Buffer.from('original-subtitle'))
    const video = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/existing.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const subtitle = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/existing.srt',
      mode: 'write',
      source: 'workspace'
    })
    vi.spyOn(test.handles, 'completeOutputsReversibly')
      .mockRejectedValueOnce(new Error('injected completion failure'))

    await expect(test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: video.id },
      textOutputs: {
        captions: {
          handleId: subtitle.id,
          mimeType: 'application/x-subrip',
          content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
        }
      }
    }, { operationId: 'rollback-job' })).rejects.toThrow('injected completion failure')

    expect(await readFile(videoPath, 'utf8')).toBe('original-video')
    expect(await readFile(subtitlePath, 'utf8')).toBe('original-subtitle')
    await expect(test.handles.resolve(test.principal, video.id, 'write')).resolves.toBeDefined()
    await expect(test.handles.resolve(test.principal, subtitle.id, 'write')).resolves.toBeDefined()
    expect((await readdir(join(test.workspace, 'exports'))).sort()).toEqual([
      'existing.mp4',
      'existing.srt'
    ])
  })

  it('promotes bounded text sidecars in the same handle transaction', async () => {
    const test = await fixture()
    const subtitle = await test.handles.register(test.principal, {
      workspaceRoot: test.workspace,
      path: 'exports/final.srt',
      mode: 'write',
      source: 'workspace'
    })
    const result = await test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id },
      textOutputs: {
        captions: {
          handleId: subtitle.id,
          mimeType: 'application/x-subrip',
          content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
        }
      }
    }, { operationId: 'text-output-job' })
    expect(result.generatedMedia).toHaveLength(2)
    expect(await readFile(join(test.workspace, 'exports', 'final.srt'), 'utf8'))
      .toContain('Hello')
  })

  it('checks cancellation after process exit before publishing outputs', async () => {
    const test = await fixture()
    const controller = new AbortController()
    const complete = vi.spyOn(test.handles, 'completeOutputs')
    const service = new ExtensionMediaFfmpegService({
      handleService: test.handles,
      processService: {
        async runFfmpegForCore(_principal: ExtensionPrincipal, args: string[]) {
          await writeFile(args.at(-1)!, Buffer.from('rendered-video'))
          controller.abort()
          return { exitCode: 0 }
        }
      } as never
    })
    await expect(service.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    }, { signal: controller.signal })).rejects.toMatchObject({ code: 'process_cancelled' })
    expect(complete).not.toHaveBeenCalled()
    expect(await readdir(join(test.workspace, 'exports'))).toEqual([])
  })

  it('honors a signal aborted during preparation and releases staging reservations', async () => {
    const test = await fixture()
    const controller = new AbortController()
    controller.abort()
    await expect(test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    }, { operationId: 'already-cancelled', signal: controller.signal }))
      .rejects.toMatchObject({ code: 'process_cancelled' })
    expect(await readdir(join(test.workspace, 'exports'))).toEqual([])
    await expect(test.handles.reserveOutput(test.principal, test.output.id, 'next-job'))
      .resolves.toBeDefined()
    await test.handles.releaseOutputReservation(test.principal, test.output.id, 'next-job')
  })

  it('settles cancellation only after the native process closes and staging is removed', async () => {
    const test = await fixture()
    await writeFile(test.bin, `#!/usr/bin/env node
const fs = require('node:fs')
const target = process.argv.at(-1)
fs.writeFileSync(target, Buffer.from('partial-video'))
process.on('SIGTERM', () => setTimeout(() => process.exit(143), 50))
setInterval(() => {}, 1000)
`)
    const controller = new AbortController()
    const pending = test.ffmpeg.execute(test.principal, {
      arguments: ['-i', '{{input:source}}', '{{output:video}}'],
      inputs: { source: test.input.id },
      outputs: { video: test.output.id }
    }, { signal: controller.signal })
    setTimeout(() => controller.abort(), 50)
    await expect(pending).rejects.toMatchObject({ code: 'process_cancelled' })
    expect(await readdir(join(test.workspace, 'exports'))).toEqual([])
  })
})
