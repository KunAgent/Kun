import { access, mkdir, mkdtemp, rm } from 'node:fs/promises'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterAll, describe, expect, it } from 'vitest'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import { ExtensionMediaFfmpegService } from './extension-media-ffmpeg-service.js'
import { ExtensionMediaHandleService } from './extension-media-handle-service.js'
import { ExtensionMediaProcessService } from './extension-media-process-service.js'

const runNative = process.env.KUN_RUN_MEDIA_SMOKE === '1'
const suite = runNative ? describe : describe.skip
const roots: string[] = []
const execFileAsync = promisify(execFile)

afterAll(async () => {
  await Promise.all(roots.map((root) => rm(root, { recursive: true, force: true })))
})

suite('native FFmpeg media broker smoke', () => {
  it('probes, renders a proof frame, exports H.264, post-probes, and cancels safely', async () => {
    const ffmpegPath = await executable('ffmpeg')
    const ffprobePath = await executable('ffprobe')
    const root = await mkdtemp(join(tmpdir(), 'kun-native-media-'))
    roots.push(root)
    const workspace = join(root, 'workspace')
    const dataDir = join(root, 'data')
    await mkdir(join(workspace, 'exports'), { recursive: true })
    const sourcePath = join(workspace, 'source.mp4')
    await execFileAsync(ffmpegPath, [
      '-nostdin', '-hide_banner', '-loglevel', 'error', '-y',
      '-f', 'lavfi', '-i', 'testsrc=size=320x180:rate=30',
      '-t', '1', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', sourcePath
    ], { timeout: 30_000, maxBuffer: 1024 * 1024 })

    const principal: ExtensionPrincipal = {
      extensionId: 'kun.video-editor',
      extensionVersion: '1.1.0',
      permissions: [
        'media.read', 'media.process', 'media.export',
        'workspace.read', 'workspace.write'
      ],
      workspaceRoots: [workspace],
      workspaceTrusted: true
    }
    const handles = new ExtensionMediaHandleService({ dataDir })
    const processes = new ExtensionMediaProcessService({
      handleService: handles,
      ffmpegPath,
      ffprobePath
    })
    const broker = new ExtensionMediaFfmpegService({
      handleService: handles,
      processService: processes,
      maxOutputBytes: 128 * 1024 * 1024
    })
    const source = await handles.register(principal, {
      workspaceRoot: workspace,
      path: 'source.mp4',
      mode: 'read',
      source: 'workspace'
    })
    const sourceProbe = await processes.probe(principal, source.id)
    expect(sourceProbe.streams).toContainEqual(expect.objectContaining({
      kind: 'video', width: 320, height: 180
    }))

    const proofTarget = await handles.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/proof.jpg',
      mode: 'write',
      source: 'workspace'
    })
    const proof = await broker.execute(principal, {
      arguments: ['-i', '{{input:source}}', '-frames:v', '1', '{{output:proof}}'],
      inputs: { source: source.id },
      outputs: { proof: proofTarget.id }
    }, { operationId: 'native-proof' })
    expect(proof.generatedMedia[0]).toMatchObject({ mimeType: 'image/jpeg', source: 'generated' })

    const exportTarget = await handles.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/final.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const rendered = await broker.execute(principal, {
      arguments: [
        '-i', '{{input:source}}',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-pix_fmt', 'yuv420p',
        '{{output:video}}'
      ],
      inputs: { source: source.id },
      outputs: { video: exportTarget.id }
    }, { operationId: 'native-export' })
    const finalProbe = await processes.probe(principal, rendered.generatedMedia[0]!.id)
    expect(finalProbe.streams).toContainEqual(expect.objectContaining({
      kind: 'video', codecName: 'h264', width: 320, height: 180
    }))

    const cancelledTarget = await handles.register(principal, {
      workspaceRoot: workspace,
      path: 'exports/cancelled.mp4',
      mode: 'write',
      source: 'workspace'
    })
    const controller = new AbortController()
    const cancelled = broker.execute(principal, {
      arguments: [
        '-re', '-stream_loop', '100', '-i', '{{input:source}}',
        '-t', '30', '-c:v', 'libx264', '{{output:video}}'
      ],
      inputs: { source: source.id },
      outputs: { video: cancelledTarget.id }
    }, { operationId: 'native-cancel', signal: controller.signal })
    setTimeout(() => controller.abort(), 150)
    await expect(cancelled).rejects.toMatchObject({ code: 'process_cancelled' })
  }, 60_000)
})

async function executable(name: 'ffmpeg' | 'ffprobe'): Promise<string> {
  const configured = process.env[`KUN_${name.toUpperCase()}_PATH`]
  const candidates = [configured, `/opt/homebrew/bin/${name}`, `/usr/local/bin/${name}`, `/usr/bin/${name}`]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate)
      return candidate
    } catch {
      // Continue to the next host-native location.
    }
  }
  throw new Error(`${name} is required when KUN_RUN_MEDIA_SMOKE=1`)
}
