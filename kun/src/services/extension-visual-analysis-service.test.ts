import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import type { MediaVisualAdapterBinding } from '@kun/extension-api'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'
import { ExtensionMediaProcessService, runBoundedProcess } from './extension-media-process-service.js'
import {
  ExtensionVisualAnalysisService,
  KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR,
  boundedVisualQueryFeatures
} from './extension-visual-analysis-service.js'

const roots: string[] = []
const systemFfmpeg = ['/opt/homebrew/bin/ffmpeg', '/usr/local/bin/ffmpeg', '/usr/bin/ffmpeg']
  .find((candidate) => existsSync(candidate))
const systemFfprobe = ['/opt/homebrew/bin/ffprobe', '/usr/local/bin/ffprobe', '/usr/bin/ffprobe']
  .find((candidate) => existsSync(candidate))

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('ExtensionVisualAnalysisService', () => {
  it('atomically installs and re-verifies a signed bundled local package without claiming a download', async () => {
    const fixture = await createFixture(defaultMediaScript())
    expect(await fixture.service.status(fixture.principal)).toMatchObject({
      state: 'missing',
      installSupported: true,
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
    const installed = await fixture.service.install(fixture.principal)
    expect(installed).toMatchObject({
      state: 'installed',
      receipt: {
        broker: 'kun-model-broker',
        packageSource: 'bundled',
        downloadVerified: false,
        sourceVerified: true,
        installVerified: true,
        signatureVerified: true
      }
    })
    expect(JSON.stringify(installed)).not.toContain(fixture.root)

    await writeFile(
      join(fixture.dataDir, 'extensions', 'models', 'visual-features-v1', 'visual-features-v1.json'),
      'tampered'
    )
    const failed = await fixture.service.status(fixture.principal)
    expect(failed).toMatchObject({ state: 'failed' })
    expect(failed).not.toHaveProperty('receipt')
  })

  it('decodes real authorized frames into measured features and embeds only supported query concepts', async () => {
    const fixture = await createFixture(defaultMediaScript())
    await fixture.service.install(fixture.principal)
    const result = await fixture.service.analyzeFrames(fixture.principal, {
      inputHandleId: fixture.handleId,
      adapter: adapterBinding(),
      samples: [
        { sampleId: 'frame:asset-1:0', startMicros: 0, endMicros: 1_000_000, representativeMicros: 500_000 },
        { sampleId: 'frame:asset-1:1', startMicros: 1_000_000, endMicros: 2_000_000, representativeMicros: 1_500_000 }
      ]
    })
    expect(result).toMatchObject({
      outcome: 'ready',
      source: {
        handleId: fixture.handleId,
        fingerprintAlgorithm: 'sha256-file-identity-v1'
      },
      provenance: {
        algorithm: 'kun.rgb-edge-features',
        decodedFrameWidth: 32,
        decodedFrameHeight: 32,
        local: true,
        networkUsed: false
      }
    })
    if (result.outcome !== 'ready') throw new Error('expected measured visual embeddings')
    expect(result.embeddings).toHaveLength(2)
    expect(result.embeddings[0]!.vector).toHaveLength(24)
    expect(result.embeddings[0]!.vector).not.toEqual(result.embeddings[1]!.vector)
    expect(JSON.stringify(result)).not.toContain(fixture.workspace)

    const red = await fixture.service.embedQuery(fixture.principal, {
      query: 'bright red 高对比',
      adapter: adapterBinding()
    })
    expect(red).toMatchObject({
      outcome: 'ready',
      matchedConcepts: ['bright', 'high-contrast', 'red'],
      scoreSemantics: 'uncalibrated-cosine',
      local: true,
      networkUsed: false
    })
    expect(await fixture.service.embedQuery(fixture.principal, {
      query: 'a presenter smiles at the camera',
      adapter: adapterBinding()
    })).toMatchObject({
      outcome: 'unavailable',
      code: 'VISUAL_QUERY_UNSUPPORTED',
      networkUsed: false
    })
  }, 15_000)

  it('rejects adapter drift and propagates native cancellation without publishing evidence', async () => {
    const fixture = await createFixture(defaultMediaScript({ waitForRawFrame: true }))
    await fixture.service.install(fixture.principal)
    expect(await fixture.service.analyzeFrames(fixture.principal, {
      inputHandleId: fixture.handleId,
      adapter: { ...adapterBinding(), modelVersion: '2.0.0' },
      samples: [{ sampleId: 'frame:asset-1:0', startMicros: 0, endMicros: 1_000_000, representativeMicros: 500_000 }]
    })).toMatchObject({ outcome: 'unavailable', code: 'VISUAL_MODEL_MISMATCH' })

    const cancellation = new AbortController()
    const pending = fixture.service.analyzeFrames(fixture.principal, {
      inputHandleId: fixture.handleId,
      adapter: adapterBinding(),
      samples: [{ sampleId: 'frame:asset-1:0', startMicros: 0, endMicros: 1_000_000, representativeMicros: 500_000 }]
    }, cancellation.signal)
    setTimeout(() => cancellation.abort(), 50)
    await expect(pending).rejects.toMatchObject({ code: 'process_cancelled' })
  })

  it('produces deterministic nonzero query vectors without hashing arbitrary prose into fake evidence', () => {
    expect(boundedVisualQueryFeatures('warm red')).toEqual(boundedVisualQueryFeatures('warm red'))
    expect(boundedVisualQueryFeatures('warm red')?.vector).toHaveLength(24)
    expect(boundedVisualQueryFeatures('person walking')).toBeUndefined()
    expect(boundedVisualQueryFeatures('one hundred people')).toBeUndefined()
  })

  it.skipIf(!systemFfmpeg || !systemFfprobe)(
    'consumes an actual FFmpeg-decoded red frame and ranks measured red features over blue',
    async () => {
      const root = await mkdtemp(join(tmpdir(), 'kun-visual-real-'))
      roots.push(root)
      const workspace = join(root, 'workspace')
      const dataDir = join(root, 'data')
      const mediaPath = join(workspace, 'red.mp4')
      await mkdir(workspace, { recursive: true })
      await runExecutable(systemFfmpeg!, [
        '-v', 'error', '-f', 'lavfi', '-i', 'color=c=red:s=64x64:d=1',
        '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-y', mediaPath
      ])
      const principal: ExtensionPrincipal = {
        extensionId: 'kun-examples.kun-video-editor',
        extensionVersion: '0.3.0',
        permissions: ['media.read', 'media.process', 'workspace.read'],
        workspaceRoots: [workspace],
        workspaceTrusted: true
      }
      const handles = new ExtensionMediaHandleService({ dataDir })
      const handle = await handles.register(principal, {
        workspaceRoot: workspace,
        path: 'red.mp4',
        mode: 'read',
        source: 'workspace'
      })
      const service = new ExtensionVisualAnalysisService({
        dataDir,
        media: new ExtensionMediaProcessService({
          handleService: handles,
          ffmpegPath: systemFfmpeg,
          ffprobePath: systemFfprobe
        })
      })
      await service.install(principal)
      const analyzed = await service.analyzeFrames(principal, {
        inputHandleId: handle.id,
        adapter: adapterBinding(),
        samples: [{
          sampleId: 'frame:red:0',
          startMicros: 0,
          endMicros: 1_000_000,
          representativeMicros: 500_000
        }]
      })
      if (analyzed.outcome !== 'ready') throw new Error(analyzed.remediation)
      const red = await service.embedQuery(principal, { query: 'red', adapter: adapterBinding() })
      const blue = await service.embedQuery(principal, { query: 'blue', adapter: adapterBinding() })
      if (red.outcome !== 'ready' || blue.outcome !== 'ready') throw new Error('expected color query vectors')
      expect(dot(analyzed.embeddings[0]!.vector, red.vector))
        .toBeGreaterThan(dot(analyzed.embeddings[0]!.vector, blue.vector))
      expect(JSON.stringify(analyzed)).not.toContain(workspace)
    },
    20_000
  )
})

async function createFixture(scriptBody: string) {
  const root = await mkdtemp(join(tmpdir(), 'kun-visual-analysis-'))
  roots.push(root)
  const workspace = join(root, 'workspace')
  const dataDir = join(root, 'data')
  const binary = join(root, process.platform === 'win32' ? 'media-tool.exe' : 'media-tool')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'clip.mp4'), Buffer.from('authorized-video-fixture'))
  await writeFile(binary, `#!/usr/bin/env node\n${scriptBody}\n`)
  if (process.platform !== 'win32') await chmod(binary, 0o755)
  const principal: ExtensionPrincipal = {
    extensionId: 'kun-examples.kun-video-editor',
    extensionVersion: '0.3.0',
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
  const media = new ExtensionMediaProcessService({
    handleService: handles,
    ffprobePath: binary,
    ffmpegPath: binary,
    pathEnv: process.env.PATH,
    processRunner: (_executable, args, options) =>
      runBoundedProcess(process.execPath, [binary, ...args], options)
  })
  return {
    root,
    workspace,
    dataDir,
    principal,
    handleId: handle.id,
    service: new ExtensionVisualAnalysisService({
      dataDir,
      media,
      now: () => new Date('2026-07-14T00:00:00.000Z')
    })
  }
}

function adapterBinding(): MediaVisualAdapterBinding {
  return {
    id: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.adapterId,
    version: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.adapterVersion,
    modelId: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.modelId,
    modelVersion: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.modelVersion,
    packageId: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.packageId,
    manifestSha256: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.manifestSha256,
    embeddingDimensions: KUN_LOCAL_VISUAL_MODEL_DESCRIPTOR.embeddingDimensions,
    execution: 'local'
  }
}

function defaultMediaScript(options: { waitForRawFrame?: boolean } = {}): string {
  const probe = JSON.stringify({
    format: { format_name: 'mov,mp4', duration: '2.000' },
    streams: [{
      index: 0,
      codec_type: 'video',
      codec_name: 'h264',
      duration: '2.000',
      width: 1920,
      height: 1080,
      disposition: { default: 1, forced: 0 }
    }]
  })
  return `
const args = process.argv.slice(2)
if (args.includes('-version')) process.stdout.write('ffmpeg version 8.0-visual-fixture\\n')
else if (args.includes('-encoders') || args.includes('-filters') || args.includes('-muxers')) process.stdout.write('')
else if (args.includes('-show_format')) process.stdout.write(${JSON.stringify(probe)})
else if (args.includes('rawvideo')) {
  ${options.waitForRawFrame ? 'setInterval(() => {}, 1000)' : `
  const seek = Number(args[args.indexOf('-ss') + 1])
  const rgb = Buffer.alloc(32 * 32 * 3)
  for (let pixel = 0; pixel < 32 * 32; pixel += 1) {
    const offset = pixel * 3
    if (seek < 1) { rgb[offset] = 245; rgb[offset + 1] = pixel % 2 === 0 ? 30 : 80; rgb[offset + 2] = 20 }
    else { rgb[offset] = 15; rgb[offset + 1] = 40; rgb[offset + 2] = 235 }
  }
  process.stdout.write(rgb)
  `}
} else process.exit(23)
`
}

async function runExecutable(path: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(path, args, { stdio: ['ignore', 'ignore', 'pipe'], windowsHide: true })
    const diagnostics: Buffer[] = []
    child.stderr.on('data', (chunk: Buffer) => diagnostics.push(chunk))
    child.once('error', reject)
    child.once('close', (code) => {
      if (code === 0) resolve()
      else reject(new Error(`Fixture FFmpeg failed (${code}): ${Buffer.concat(diagnostics).toString('utf8').slice(0, 512)}`))
    })
  })
}

function dot(left: readonly number[], right: readonly number[]): number {
  return left.reduce((total, value, index) => total + value * right[index]!, 0)
}
