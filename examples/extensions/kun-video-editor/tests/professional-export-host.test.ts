import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { JsonObject, ToolResult } from '@kun/extension-api'
import {
  createExtensionTestHarness,
  createGeneratedArtifactFixture,
  type ExtensionTestHarness
} from '@kun/extension-test'
import { afterEach, describe, expect, it } from 'vitest'
import { activate, VIDEO_TOOL_IDS } from '../src/host/extension.js'

const roots: string[] = []
const permissions = [
  'commands.register', 'ui.views', 'ui.actions', 'webview', 'agent.run',
  'tools.register', 'storage.workspace', 'workspace.read', 'workspace.write',
  'media.read', 'media.process', 'media.export', 'jobs.manage'
]

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })))
})

describe('professional export Host integration', () => {
  it('projects only probed codecs, effects, muxers, and the honest CPU fallback', async () => {
    const harness = await activatedHarness()
    setCapabilities(harness, [
      'libx264-encoder', 'libx265-encoder', 'aac-encoder',
      'eq-filter', 'boxblur-filter', 'mp4-muxer'
    ])

    const inspected = await invoke(harness, 'video-inspect', { action: 'export-capabilities' })

    expect(inspected.content).toMatchObject({
      outcome: 'export-capabilities',
      capabilities: {
        backend: { id: 'ffmpeg', available: true, capabilitiesDigest: expect.stringMatching(/^[a-f0-9]{64}$/u) },
        formats: {
          'h264-mp4': true,
          'h265-mp4': true,
          'prores-mov': false,
          'ffv1-mkv': false
        },
        effects: {
          'color.basic': true,
          blur: true,
          sharpen: false
        },
        acceleration: {
          cpu: true,
          preferGpuFallsBackToCpu: true,
          gpuAvailable: false
        }
      }
    })
    expect(JSON.stringify(inspected)).not.toContain(harness.context.workspaceContext!.root)
    await harness.dispose()
  })

  it('queues an H.265 CPU export with pinned settings evidence and recovers it after restart', async () => {
    const harness = await projectWithMedia()
    setCapabilities(harness, [
      'libx265-encoder', 'aac-encoder', 'mp4-muxer'
    ])
    const outputHandle = 'professional_h265_output_0001'
    harness.media.addHandle(exportHandle(outputHandle, 'h265.mp4', 'video/mp4'))

    const queued = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'h265-mp4',
      outputHandleId: outputHandle,
      width: 1280,
      height: 720,
      frameRate: { numerator: 24, denominator: 1 },
      quality: 'master',
      acceleration: 'cpu'
    })
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      renderKind: 'h265-mp4',
      requestedRenderKind: 'h265-mp4',
      portableEquivalent: false,
      advancedSettingsDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      advancedCapabilitiesDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })
    const jobId = String(content(queued).jobId)
    const request = latestRenderRequest(harness)
    const args = request.arguments as string[]
    expect(args).toEqual(expect.arrayContaining([
      '-c:v', 'libx265', '-preset', 'slow', '-crf', '14', '-tag:v', 'hvc1', '-f', 'mp4'
    ]))
    expect(args.join(' ')).toContain('scale=1280:720:flags=lanczos')
    expect(args.join(' ')).toContain('fps=24/1')
    expect(request.metadata).toMatchObject({
      renderKind: 'h265-mp4',
      requestedRenderKind: 'h265-mp4',
      portableEquivalent: false,
      advancedSettingsDigest: content(queued).advancedSettingsDigest,
      advancedCapabilitiesDigest: content(queued).advancedCapabilitiesDigest
    })

    harness.jobs.start(jobId)
    harness.media.addHandle({
      ...exportHandle(outputHandle, 'h265.mp4', 'video/mp4'),
      byteSize: 16_384,
      completionIdentity: 'professional-h265-complete'
    })
    harness.media.setProbe(outputHandle, videoProbe(outputHandle, 'hevc'))
    const artifact = createGeneratedArtifactFixture({
      artifactId: 'artifact_professional_h265_0001',
      ownerExtensionId: harness.identity.id,
      ownerExtensionVersion: harness.identity.version,
      workspaceId: harness.context.workspaceContext!.id,
      mediaHandleId: outputHandle,
      displayName: 'h265.mp4',
      mediaKind: 'video',
      mimeType: 'video/mp4',
      byteSize: 16_384,
      completionIdentity: 'professional-h265-complete',
      provenance: {
        jobId,
        operation: 'media.startFfmpegJob',
        metadata: request.metadata as JsonObject
      }
    })
    harness.jobs.complete(jobId, { schemaVersion: 1, generatedArtifacts: [artifact] })
    harness.storage.workspace.delete(`render-job:${jobId}`)

    const recovered = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(recovered.content).toMatchObject({
      outcome: 'completed',
      tracked: true,
      technicallyValidated: true,
      renderKind: 'h265-mp4',
      requestedRenderKind: 'h265-mp4',
      portableEquivalent: false,
      advancedSettingsDigest: content(queued).advancedSettingsDigest
    })
    expect(recovered.generatedArtifacts).toEqual([artifact])
    harness.media.setProbe(outputHandle, videoProbe(outputHandle, 'h264'))
    const mismatched = await invoke(harness, 'video-render-status', { jobId, projectId: 'agent-demo' })
    expect(mismatched.content).toMatchObject({
      outcome: 'invalid-output',
      technicallyValidated: false,
      renderKind: 'h265-mp4',
      artifacts: []
    })
    expect(mismatched.generatedArtifacts).toBeUndefined()
    await harness.dispose()
  })

  it('uses FFV1/MKV only when ProRes portable fallback is explicitly allowed', async () => {
    const harness = await projectWithMedia()
    setCapabilities(harness, ['ffv1-encoder', 'pcm-s24-encoder', 'matroska-muxer'])

    const unavailable = await invoke(harness, 'video-render', {
      projectId: 'agent-demo', expectedRevision: 1, kind: 'prores-mov'
    })
    expect(unavailable.content).toMatchObject({
      outcome: 'unavailable',
      code: 'ADVANCED_EXPORT_UNSUPPORTED',
      requestedRenderKind: 'prores-mov'
    })
    expect(harness.transport.requests.map(({ method }) => method)).not.toContain('media.pickSaveTarget')

    const outputHandle = 'professional_ffv1_output_0001'
    harness.media.addHandle(exportHandle(outputHandle, 'portable.mkv', 'video/x-matroska'))
    const queued = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      kind: 'prores-mov',
      outputHandleId: outputHandle,
      allowPortableEquivalent: true,
      acceleration: 'cpu'
    })
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      renderKind: 'ffv1-mkv',
      requestedRenderKind: 'prores-mov',
      portableEquivalent: true
    })
    const request = latestRenderRequest(harness)
    expect(request.outputs).toEqual({ video: outputHandle })
    expect(request.arguments).toEqual(expect.arrayContaining([
      '-c:v', 'ffv1', '-pix_fmt', 'yuv422p10le',
      '-c:a', 'pcm_s24le', '-f', 'matroska'
    ]))
    expect(request.metadata).toMatchObject({
      renderKind: 'ffv1-mkv',
      requestedRenderKind: 'prores-mov',
      portableEquivalent: true
    })
    await harness.dispose()
  })

  it('compiles an enabled effect through the reviewed CPU filter and rejects unavailable GPU-only policy', async () => {
    const harness = await projectWithMedia()
    await invoke(harness, 'video-update-timeline', {
      projectId: 'agent-demo',
      expectedRevision: 1,
      operations: [{
        type: 'set-item-effects',
        itemId: 'item-interview',
        effects: [{ id: 'blur-main', type: 'blur', enabled: true, parameters: { radius: 4 } }]
      }]
    })
    setCapabilities(harness, [
      'libx264-encoder', 'aac-encoder', 'boxblur-filter', 'mp4-muxer'
    ])
    const outputHandle = 'professional_effect_output_001'
    harness.media.addHandle(exportHandle(outputHandle, 'effect.mp4', 'video/mp4'))

    const queued = await invoke(harness, 'video-render', {
      projectId: 'agent-demo', expectedRevision: 2, kind: 'h264-mp4', outputHandleId: outputHandle
    })
    expect(queued.content).toMatchObject({
      outcome: 'queued',
      advancedCapabilitiesDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      effectSemanticsDigest: expect.stringMatching(/^[a-f0-9]{64}$/u)
    })
    const request = latestRenderRequest(harness)
    expect((request.arguments as string[]).join(' ')).toContain(
      'boxblur=luma_radius=4:luma_power=1:chroma_radius=4:chroma_power=1'
    )

    const gpuOnly = await invoke(harness, 'video-render', {
      projectId: 'agent-demo',
      expectedRevision: 2,
      kind: 'h265-mp4',
      acceleration: 'require-gpu'
    })
    expect(gpuOnly.content).toMatchObject({
      outcome: 'unavailable',
      code: 'ADVANCED_EFFECT_UNSUPPORTED',
      requestedRenderKind: 'h265-mp4'
    })
    expect(String(content(gpuOnly).message)).toContain('No output target was selected')
    expect(harness.transport.requests.filter(({ method }) => method === 'media.startFfmpegJob')).toHaveLength(1)
    await harness.dispose()
  })

  it('round-trips a bounded OTIO preview with stable timecode and an explicit loss manifest', async () => {
    const harness = await projectWithMedia()
    const exported = await invoke(harness, 'video-inspect', {
      action: 'otio-export-preview', projectId: 'agent-demo', expectedRevision: 1
    })
    expect(exported.content).toMatchObject({
      outcome: 'otio-export-preview',
      projectId: 'agent-demo',
      projectRevision: 1,
      documentInline: true,
      durableExportAvailable: false,
      documentDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      projectDigest: expect.stringMatching(/^[a-f0-9]{64}$/u),
      timecodeMappings: [expect.objectContaining({
        id: 'item-interview',
        sequenceId: 'sequence-main',
        startTimecode: '00:00:00:00'
      })],
      lossManifest: {
        adapterId: 'kun.otio-json',
        adapterVersion: '1.0.0',
        kunRoundTripLossless: true
      }
    })
    const document = content(exported).document as JsonObject
    const imported = await invoke(harness, 'video-inspect', {
      action: 'otio-import-preview', document
    })
    expect(imported.content).toMatchObject({
      outcome: 'otio-import-preview',
      fidelity: 'kun-metadata',
      project: {
        id: 'agent-demo',
        revision: 1,
        counts: { assets: 1, items: 1 }
      },
      mediaRelinkRequired: ['interview'],
      persisted: false,
      lossManifest: { kunRoundTripLossless: true }
    })
    expect(JSON.stringify({ exported, imported })).not.toContain(harness.context.workspaceContext!.root)
    const stillStored = await invoke(harness, 'video-project', { action: 'get', projectId: 'agent-demo' })
    expect(stillStored.content).toMatchObject({ project: { currentRevision: 1 } })
    await harness.dispose()
  })

  it('preflights an executable path-opaque durable project package transaction', async () => {
    const harness = await projectWithMedia()
    const preflight = await invoke(harness, 'video-inspect', {
      action: 'project-package-preflight',
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetIds: ['interview'],
      missingMediaPolicy: 'record-incomplete',
      includeReceipts: true,
      includeChatProvenance: true
    })
    expect(preflight.content).toMatchObject({
      outcome: 'project-package-preflight',
      executable: true,
      projectId: 'agent-demo',
      sequenceId: 'sequence-main',
      pinnedRevision: 1,
      selectedAssetCount: 1,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      deduplicatedAssetCount: 0,
      knownInputBytes: 4096,
      complete: true,
      missingAssetIds: [],
      provenance: {
        receiptsRequested: true,
        receiptCount: 1,
        chatRequested: true,
        chatScope: 'available only from an authenticated Agent tool invocation',
        generationLineageEntries: 0,
        revisionLedgerEntries: 2
      },
      engine: {
        selfContainedBuilderAvailable: true,
        cancellationAndRestartModelAvailable: true,
        integrityAlgorithm: 'sha256',
        binaryReader: 'opaque-host-handle',
        outputSink: 'atomic-durable-media-archive-job'
      },
      blockedCapabilities: []
    })
    expect(JSON.stringify(preflight)).not.toContain('professional_media_source_001')
    expect(JSON.stringify(preflight)).not.toContain(harness.context.workspaceContext!.root)
    await expect(invoke(harness, 'video-inspect', {
      action: 'project-package-preflight',
      projectId: 'agent-demo',
      expectedRevision: 1,
      assetIds: ['interview', 'interview']
    })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' })
    await harness.dispose()
  })
})

async function activatedHarness(): Promise<ExtensionTestHarness> {
  const root = await mkdtemp(join(tmpdir(), 'kun-professional-export-host-'))
  roots.push(root)
  const harness = createExtensionTestHarness({
    identity: {
      id: 'kun-examples.kun-video-editor',
      publisher: 'kun-examples',
      name: 'kun-video-editor',
      version: '0.4.0'
    },
    permissions,
    workspace: { id: 'video-workspace', name: 'Video Workspace', root, trusted: true, active: true }
  })
  await harness.activate(activate)
  return harness
}

async function projectWithMedia(): Promise<ExtensionTestHarness> {
  const harness = await activatedHarness()
  await invoke(harness, 'video-project', {
    action: 'create', projectId: 'agent-demo', name: 'Agent Demo'
  })
  const sourceHandle = 'professional_media_source_001'
  harness.media.addHandle({
    handleId: sourceHandle,
    mode: 'read',
    kind: 'video',
    displayName: 'interview.mp4',
    mimeType: 'video/mp4',
    byteSize: 4096
  })
  harness.media.setProbe(sourceHandle, videoProbe(sourceHandle, 'h264'))
  await invoke(harness, 'video-probe', {
    projectId: 'agent-demo', expectedRevision: 0, mediaHandleId: sourceHandle, assetId: 'interview'
  })
  return harness
}

function setCapabilities(harness: ExtensionTestHarness, features: string[]): void {
  harness.media.setCapabilities({
    probedAt: new Date().toISOString(),
    ffprobe: { name: 'ffprobe', available: true, version: '6.1', features: [] },
    ffmpeg: { name: 'ffmpeg', available: true, version: '6.1', features }
  })
}

async function invoke(
  harness: ExtensionTestHarness,
  id: (typeof VIDEO_TOOL_IDS)[number],
  input: JsonObject
): Promise<ToolResult> {
  const registration = [...harness.tools.registrations]
    .find(([, declaration]) => declaration.id === id)?.[0]
  if (!registration) throw new Error(`Tool ${id} was not registered`)
  return await harness.tools.invoke(registration, input) as ToolResult
}

function content(result: ToolResult): JsonObject {
  if (result.content === null || typeof result.content !== 'object' || Array.isArray(result.content)) {
    throw new Error('Expected object tool content')
  }
  return result.content
}

function latestRenderRequest(harness: ExtensionTestHarness): JsonObject {
  const params = harness.transport.requests
    .filter(({ method }) => method === 'media.startFfmpegJob')
    .at(-1)?.params
  if (!params || typeof params !== 'object' || Array.isArray(params)) throw new Error('No render request')
  return params as JsonObject
}

function exportHandle(handleId: string, displayName: string, mimeType: string): JsonObject {
  return { handleId, mode: 'export', kind: 'video', displayName, mimeType, byteSize: 0 }
}

function videoProbe(handleId: string, codecName: string): JsonObject {
  return {
    schemaVersion: 1,
    handleId,
    container: { formatNames: ['mp4'], durationMicros: 3_000_000 },
    streams: [
      {
        index: 0,
        kind: 'video',
        codecName,
        durationMicros: 3_000_000,
        frameRate: { numerator: 30, denominator: 1 },
        width: 1920,
        height: 1080,
        disposition: { default: true }
      },
      {
        index: 1,
        kind: 'audio',
        codecName: 'aac',
        durationMicros: 3_000_000,
        sampleRate: 48_000,
        channelCount: 2,
        disposition: { default: true }
      }
    ]
  }
}
