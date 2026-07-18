import { describe, expect, it } from 'vitest'
import {
  ArtifactHostActionRequestSchema,
  ArtifactHostActionResultSchema,
  GeneratedArtifactSchema,
  JobEventSchema,
  JobProgressSchema,
  JobSnapshotSchema,
  MediaAudioAnalysisCapabilitiesSchema,
  MediaAudioAnalysisResultSchema,
  MediaAnalyzeVisualFramesRequestSchema,
  MediaAnalyzeVisualFramesResultSchema,
  MediaEmbedVisualQueryRequestSchema,
  MediaEmbedVisualQueryResultSchema,
  MediaMetadataSchema,
  MediaCapabilitiesSchema,
  MediaCreateCacheTargetRequestSchema,
  MediaProbeResultSchema,
  MediaReadTextRequestSchema,
  MediaReadTextResultSchema,
  MediaResourceLeaseSchema,
  MediaStartFfmpegJobRequestSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaArchiveJobResultSchema,
  MediaStartArchiveJobRequestSchema,
  MediaStartArchiveJobResultSchema,
  MediaVisualModelStatusSchema,
  PermissionSchema,
  ResultPreviewSourceSchema,
  ToolResultSchema,
  isExtensionViewSafeMethod
} from '../src/index.js'

const handleId = 'media_handle_000001'
const artifactId = 'artifact_ref_000001'
const jobId = 'job_0001'
const now = '2026-07-13T00:00:00.000Z'

const artifact = {
  schemaVersion: 1,
  artifactId,
  ownerExtensionId: 'acme.video-editor',
  ownerExtensionVersion: '1.1.0',
  workspaceId: 'workspace-1',
  mediaHandleId: handleId,
  displayName: 'export.mp4',
  mediaKind: 'video',
  mimeType: 'video/mp4',
  byteSize: 1024,
  completionIdentity: 'sha256:fake-completion-identity',
  provenance: { jobId, operation: 'media.ffmpeg' }
} as const

const snapshot = {
  schemaVersion: 1,
  id: jobId,
  kind: 'media.ffmpeg',
  kindSchemaVersion: 1,
  ownerExtensionId: 'acme.video-editor',
  ownerExtensionVersion: '1.1.0',
  workspaceId: 'workspace-1',
  initiatingOperation: 'media.startFfmpegJob',
  state: 'completed',
  executionAttempt: 1,
  createdAt: now,
  updatedAt: now,
  startedAt: now,
  terminalAt: now,
  result: { schemaVersion: 1, generatedArtifacts: [artifact] },
  latestCursor: 'cursor_0001'
} as const

describe('Extension API v1.1 media schemas', () => {
  it('publishes the least-privilege media and job permissions', () => {
    for (const permission of ['media.read', 'media.process', 'media.export', 'jobs.manage']) {
      expect(PermissionSchema.parse(permission)).toBe(permission)
    }
  })

  it('accepts bounded opaque metadata and rejects path disclosure', () => {
    expect(MediaMetadataSchema.parse({
      handleId,
      mode: 'read',
      kind: 'video',
      displayName: 'interview.mp4',
      mimeType: 'video/mp4',
      byteSize: 2048,
      lastAccessedAt: now,
      workspaceRelativeDisplayLocation: 'media/interview.mp4'
    })).toMatchObject({ handleId, lastAccessedAt: now, revoked: false })
    expect(MediaMetadataSchema.safeParse({
      handleId: '/private/interview.mp4',
      mode: 'read',
      kind: 'video',
      displayName: 'interview.mp4'
    }).success).toBe(false)
    expect(MediaMetadataSchema.safeParse({
      handleId,
      mode: 'read',
      kind: 'video',
      displayName: 'interview.mp4',
      workspaceRelativeDisplayLocation: '/private/interview.mp4'
    }).success).toBe(false)
  })

  it('defines a bounded Host-owned cache target request', () => {
    expect(MediaCreateCacheTargetRequestSchema.parse({
      format: 'png',
      purpose: 'derived-waveform-partial'
    })).toEqual({ format: 'png', purpose: 'derived-waveform-partial' })
    expect(MediaCreateCacheTargetRequestSchema.safeParse({
      format: 'png',
      purpose: '../private/output'
    }).success).toBe(false)
    expect(isExtensionViewSafeMethod('media.createCacheTarget')).toBe(true)
  })

  it('normalizes probe rationals and bounds resource leases', () => {
    expect(MediaProbeResultSchema.parse({
      schemaVersion: 1,
      handleId,
      container: { formatNames: ['mov', 'mp4'], durationMicros: 1_000_000 },
      streams: [{
        index: 0,
        kind: 'video',
        codecName: 'h264',
        frameRate: { numerator: 30_000, denominator: 1001 },
        width: 1920,
        height: 1080,
        disposition: { default: true }
      }]
    }).streams[0].frameRate).toEqual({ numerator: 30_000, denominator: 1001 })
    expect(MediaResourceLeaseSchema.parse({
      leaseId: 'media_lease_000001',
      handleId,
      url: 'kun-media://lease/media_lease_000001',
      mimeType: 'video/mp4',
      expiresAt: now
    }).url).toMatch(/^kun-media:/)
  })

  it('defines bounded UTF-8 text reads without exposing a path', () => {
    expect(MediaReadTextRequestSchema.parse({ handleId, maxBytes: 32 })).toEqual({
      handleId,
      maxBytes: 32
    })
    expect(MediaReadTextResultSchema.parse({
      handleId,
      displayName: 'captions.srt',
      mimeType: 'application/x-subrip',
      byteSize: 6,
      content: '你好'
    })).toMatchObject({ handleId, content: '你好' })
    expect(MediaReadTextResultSchema.safeParse({
      handleId,
      displayName: 'captions.srt',
      mimeType: 'application/x-subrip',
      byteSize: 2,
      content: '你好'
    }).success).toBe(false)
    expect(MediaReadTextRequestSchema.safeParse({
      handleId,
      maxBytes: 2 * 1024 * 1024 + 1
    }).success).toBe(false)
  })

  it('publishes bounded media executable capabilities without paths', () => {
    const capabilities = MediaCapabilitiesSchema.parse({
      probedAt: now,
      ffprobe: { name: 'ffprobe', available: true, version: '8.0.1' },
      ffmpeg: {
        name: 'ffmpeg',
        available: true,
        version: '8.0.1',
        features: ['libx264-encoder', 'aac-encoder']
      }
    })
    expect(capabilities.ffprobe.features).toEqual([])
    expect(capabilities.ffmpeg.features).toEqual(['libx264-encoder', 'aac-encoder'])
    expect(JSON.stringify(capabilities)).not.toContain('/opt/')
  })

  it('defines path-opaque local audio-analysis capabilities and requests', () => {
    const capabilities = MediaAudioAnalysisCapabilitiesSchema.parse({
      schemaVersion: 1,
      probedAt: now,
      analyses: [
        {
          analysis: 'silence', available: true,
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'beat-grid', available: false,
          code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
          remediation: 'Install a verified local beat analyzer.', retryable: false,
          local: true, networkUsed: false
        },
        {
          analysis: 'sync-features', available: true,
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        }
      ]
    })
    expect(capabilities.analyses[1]).toMatchObject({
      analysis: 'beat-grid', available: false, networkUsed: false
    })
    expect(MediaStartAudioAnalysisJobRequestSchema.parse({
      analysis: 'silence', inputHandleId: handleId
    })).toMatchObject({
      analysis: 'silence', noiseThresholdDb: -35, minimumSilenceMicros: 300_000
    })
    expect(MediaStartAudioAnalysisJobRequestSchema.parse({
      analysis: 'sync-features',
      referenceHandleId: handleId,
      targetHandleId: 'media_handle_000002',
      seed: 42
    })).toMatchObject({
      seed: 42, samplePeriodMicros: 100_000, maxFeaturePoints: 4_096
    })
    expect(MediaStartAudioAnalysisJobRequestSchema.safeParse({
      analysis: 'silence', inputHandleId: '/private/interview.wav'
    }).success).toBe(false)
    expect(MediaStartAudioAnalysisJobRequestSchema.safeParse({
      analysis: 'sync-features',
      referenceHandleId: handleId,
      targetHandleId: handleId,
      seed: 42
    }).success).toBe(false)
    expect(isExtensionViewSafeMethod('media.getAudioAnalysisCapabilities')).toBe(true)
    expect(isExtensionViewSafeMethod('media.startAudioAnalysisJob')).toBe(true)
  })

  it('defines verified path-opaque local visual model, frame, and query contracts', () => {
    const descriptor = {
      adapterId: 'kun.local.visual-features',
      adapterVersion: '1.0.0',
      modelId: 'kun-visual-features',
      modelVersion: '1.0.0',
      packageId: 'kun-bundled.visual-features-v1',
      manifestSha256: 'a'.repeat(64),
      files: [{ name: 'visual-features-v1.json', sha256: 'b'.repeat(64), byteSize: 582 }],
      embeddingDimensions: 24,
      execution: 'local',
      querySemantics: 'bounded-visual-features-v1'
    } as const
    const status = MediaVisualModelStatusSchema.parse({
      schemaVersion: 1,
      state: 'installed',
      descriptor,
      receipt: {
        broker: 'kun-model-broker',
        packageSource: 'bundled',
        packageId: descriptor.packageId,
        modelId: descriptor.modelId,
        modelVersion: descriptor.modelVersion,
        manifestSha256: descriptor.manifestSha256,
        files: descriptor.files,
        downloadVerified: false,
        sourceVerified: true,
        installVerified: true,
        signatureVerified: true,
        installedAt: now
      },
      installSupported: true,
      checkedAt: now,
      remediation: 'Verified bundled local visual package ready.',
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false
    })
    expect(status.receipt).toMatchObject({
      packageSource: 'bundled',
      downloadVerified: false,
      sourceVerified: true
    })
    const adapter = {
      id: descriptor.adapterId,
      version: descriptor.adapterVersion,
      modelId: descriptor.modelId,
      modelVersion: descriptor.modelVersion,
      packageId: descriptor.packageId,
      manifestSha256: descriptor.manifestSha256,
      embeddingDimensions: descriptor.embeddingDimensions,
      execution: 'local'
    } as const
    const request = MediaAnalyzeVisualFramesRequestSchema.parse({
      inputHandleId: handleId,
      samples: [{ sampleId: 'frame:asset-1:0', startMicros: 0, endMicros: 1_000_000, representativeMicros: 500_000 }],
      adapter
    })
    expect(request.samples[0]).toMatchObject({ representativeMicros: 500_000 })
    expect(MediaAnalyzeVisualFramesRequestSchema.safeParse({
      ...request,
      inputHandleId: '/private/interview.mp4'
    }).success).toBe(false)
    expect(MediaAnalyzeVisualFramesResultSchema.parse({
      outcome: 'ready',
      source: { handleId, fingerprint: 'c'.repeat(64), fingerprintAlgorithm: 'sha256-file-identity-v1' },
      adapter,
      embeddings: [{ sampleId: request.samples[0]!.sampleId, vector: new Array(24).fill(0.1) }],
      provenance: {
        algorithm: 'kun.rgb-edge-features', algorithmVersion: '1.0.0',
        decodedFrameWidth: 32, decodedFrameHeight: 32, local: true, networkUsed: false
      }
    }).outcome).toBe('ready')
    expect(MediaEmbedVisualQueryRequestSchema.parse({ query: 'bright red', adapter }).query).toBe('bright red')
    expect(MediaEmbedVisualQueryResultSchema.parse({
      outcome: 'unavailable',
      code: 'VISUAL_QUERY_UNSUPPORTED',
      remediation: 'Use supported measured visual concepts.',
      retryable: false,
      local: true,
      networkUsed: false
    })).toMatchObject({ outcome: 'unavailable', networkUsed: false })
    for (const method of [
      'media.getVisualModelStatus',
      'media.installVisualModel',
      'media.analyzeVisualFrames',
      'media.embedVisualQuery'
    ]) expect(isExtensionViewSafeMethod(method)).toBe(true)
  })

  it('defines a bounded path-opaque durable archive job contract', () => {
    const request = MediaStartArchiveJobRequestSchema.parse({
      format: 'zip',
      outputHandleId: 'media_package_output_0001',
      idempotencyKey: 'project-package-revision-7',
      entries: [
        { kind: 'media', inputHandleId: handleId, archivePath: 'media/interview.mp4' },
        {
          kind: 'inline-text', archivePath: 'project/project.json',
          mimeType: 'application/json', content: '{"schemaVersion":2}'
        }
      ]
    })
    expect(request.entries).toHaveLength(2)
    expect(MediaStartArchiveJobRequestSchema.safeParse({
      ...request,
      entries: [{ kind: 'media', inputHandleId: handleId, archivePath: '../private/video.mp4' }]
    }).success).toBe(false)
    expect(MediaStartArchiveJobRequestSchema.safeParse({
      ...request,
      entries: [
        { kind: 'media', inputHandleId: handleId, archivePath: 'same' },
        { kind: 'inline-text', archivePath: 'same', mimeType: 'text/plain', content: 'duplicate' }
      ]
    }).success).toBe(false)
    expect(MediaStartArchiveJobResultSchema.parse({
      outcome: 'started', job: { jobId, kind: 'media.archive', state: 'queued', cursor: 'cursor_1' }
    })).toMatchObject({ outcome: 'started', job: { kind: 'media.archive' } })
    expect(MediaArchiveJobResultSchema.parse({
      schemaVersion: 1, format: 'zip', entryCount: 2,
      inputBytes: 2048, archiveBytes: 1024, sha256: 'a'.repeat(64),
      generatedMedia: {
        handleId: 'media_package_readable_001', mode: 'read', kind: 'data',
        displayName: 'project.kun-project.zip', mimeType: 'application/zip', byteSize: 1024
      }
    })).toMatchObject({ entryCount: 2, generatedMedia: { kind: 'data' } })
    expect(isExtensionViewSafeMethod('media.startArchiveJob')).toBe(true)
  })

  it('bounds attributable silence and seeded sync-feature evidence', () => {
    const source = {
      handleId,
      fingerprint: 'a'.repeat(64),
      fingerprintAlgorithm: 'sha256-file-identity-v1'
    }
    expect(MediaAudioAnalysisResultSchema.parse({
      schemaVersion: 1,
      analysis: 'silence',
      source,
      provenance: {
        algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
        local: true, networkUsed: false
      },
      parameters: { noiseThresholdDb: -35, minimumSilenceMicros: 300_000 },
      intervals: [{
        startMicros: 0, endMicros: 500_000,
        confidence: 1, confidenceSemantics: 'threshold-classification'
      }],
      analyzedDurationMicros: 1_000_000,
      truncated: false
    })).toMatchObject({ analysis: 'silence', intervals: [{ confidence: 1 }] })

    const features = Array.from({ length: 8 }, (_, index) => index / 8)
    expect(MediaAudioAnalysisResultSchema.parse({
      schemaVersion: 1,
      analysis: 'sync-features',
      reference: source,
      target: {
        ...source,
        handleId: 'media_handle_000002',
        fingerprint: 'b'.repeat(64)
      },
      provenance: {
        algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
        local: true, networkUsed: false
      },
      seed: 42,
      samplePeriodMicros: 100_000,
      referenceFeatures: features,
      targetFeatures: features,
      referenceAnalyzedDurationMicros: 800_000,
      targetAnalyzedDurationMicros: 800_000,
      truncated: false
    })).toMatchObject({ analysis: 'sync-features', seed: 42 })
    expect(MediaStartAudioAnalysisJobResultSchema.parse({
      outcome: 'unavailable',
      analysis: 'beat-grid',
      code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE',
      remediation: 'No verified beat/downbeat analyzer is installed.',
      retryable: false,
      local: true,
      networkUsed: false
    })).toMatchObject({ outcome: 'unavailable', networkUsed: false })
  })

  it('requires handle maps for FFmpeg jobs rather than file paths', () => {
    expect(MediaStartFfmpegJobRequestSchema.parse({
      arguments: ['-i', '{{input:source}}', '{{output:export}}'],
      inputs: { source: handleId },
      outputs: { export: 'media_export_00001' },
      scheduling: { priority: 'interactive', maxAttempts: 3, retryBaseDelayMs: 250 },
      textOutputs: {
        captions: {
          handleId: 'media_subtitle_0001',
          mimeType: 'application/x-subrip',
          content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
        }
      }
    })).toMatchObject({
      inputs: { source: handleId },
      scheduling: { priority: 'interactive', maxAttempts: 3, retryBaseDelayMs: 250 },
      textOutputs: { captions: { handleId: 'media_subtitle_0001' } }
    })
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: ['-i', '{{input:source}}', '{{output:export}}'],
      inputs: { source: handleId },
      outputs: { export: 'media_export_00001' },
      scheduling: { priority: 'background', maxAttempts: 4, retryBaseDelayMs: 1 }
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: ['-i', '/private/interview.mp4'],
      inputs: { source: '/private/interview.mp4' },
      outputs: { export: 'media_export_00001' }
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: ['-i', '{{input:source}}', '{{output:export}}'],
      inputs: { source: handleId },
      outputs: { export: 'media_export_00001' },
      textOutputs: {
        captions: {
          handleId: '/private/captions.srt',
          mimeType: 'text/html',
          content: '<script>alert(1)</script>'
        }
      }
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: ['-i', '{{input:source}}', '{{output:export}}'],
      inputs: { source: handleId },
      outputs: { export: 'media_export_00001' },
      textOutputs: {
        captions: {
          handleId: 'media_subtitle_0001',
          mimeType: 'text/vtt',
          content: '😀'.repeat(50_000)
        }
      }
    }).success).toBe(false)
  })

  it('admits bounded text-only jobs without admitting an FFmpeg command shape', () => {
    const textOnly = {
      arguments: [],
      inputs: {},
      outputs: {},
      textOutputs: {
        captions: {
          handleId: 'media_subtitle_0001',
          mimeType: 'application/x-subrip' as const,
          content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n'
        }
      }
    }
    expect(MediaStartFfmpegJobRequestSchema.parse(textOnly)).toEqual(textOnly)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      ...textOnly,
      arguments: ['-version']
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      ...textOnly,
      inputs: { source: handleId }
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: [],
      inputs: {},
      outputs: {}
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      arguments: [],
      inputs: {},
      outputs: { export: 'media_export_00001' }
    }).success).toBe(false)
  })

  it('admits only bounded path-opaque OpenTimelineIO JSON text outputs', () => {
    const document = {
      OTIO_SCHEMA: 'SerializableCollection.1',
      name: 'Cut',
      children: [],
      metadata: { kun: { projectId: 'project-1' } }
    }
    const request = {
      arguments: [],
      inputs: {},
      outputs: {},
      textOutputs: {
        interchange: {
          handleId: 'media_otio_target_0001',
          mimeType: 'application/x-otio+json' as const,
          content: JSON.stringify(document)
        }
      }
    }
    expect(MediaStartFfmpegJobRequestSchema.parse(request)).toEqual(request)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      ...request,
      textOutputs: {
        interchange: {
          ...request.textOutputs.interchange,
          content: JSON.stringify({
            ...document,
            children: [{ target_url: 'file:///Users/alice/private.mov' }]
          })
        }
      }
    }).success).toBe(false)
    expect(MediaStartFfmpegJobRequestSchema.safeParse({
      ...request,
      textOutputs: {
        interchange: { ...request.textOutputs.interchange, content: '{not-json' }
      }
    }).success).toBe(false)
  })
})

describe('Extension API v1.1 jobs and artifacts', () => {
  it('enforces coherent bounded progress', () => {
    expect(JobProgressSchema.parse({ completed: 2, total: 4, percentage: 50, updatedAt: now }))
      .toMatchObject({ completed: 2, total: 4 })
    expect(JobProgressSchema.safeParse({ completed: 5, total: 4, updatedAt: now }).success).toBe(false)
  })

  it('validates durable snapshots, events, and top-level artifacts', () => {
    expect(JobSnapshotSchema.parse(snapshot)).toMatchObject({ id: jobId, state: 'completed' })
    expect(JobEventSchema.parse({
      schemaVersion: 1,
      jobId,
      kind: 'media.ffmpeg',
      type: 'completed',
      state: 'completed',
      timestamp: now,
      executionAttempt: 1,
      sequence: 3,
      cursor: 'cursor_0003',
      result: snapshot.result
    }).sequence).toBe(3)
    expect(GeneratedArtifactSchema.parse(artifact)).toMatchObject({
      artifactId,
      availability: 'available'
    })
    expect(ToolResultSchema.parse({ content: { ok: true }, generatedArtifacts: [artifact] }))
      .toMatchObject({ generatedArtifacts: [{ artifactId }] })
  })

  it('adds artifact and media handles to result previews without weakening v1.0 sources', () => {
    expect(ResultPreviewSourceSchema.parse({
      sourceId: 'tool-1:artifact-1',
      artifactId,
      mediaHandleId: handleId,
      availability: 'available',
      mimeType: 'video/mp4',
      name: 'export.mp4'
    })).toMatchObject({ artifactId, mediaHandleId: handleId })
    expect(ResultPreviewSourceSchema.parse({
      sourceId: 'tool-1:file-1',
      relativePath: 'exports/legacy.mp4',
      mimeType: 'video/mp4'
    })).toMatchObject({ relativePath: 'exports/legacy.mp4' })
  })

  it('defines path-free Host artifact actions', () => {
    expect(ArtifactHostActionRequestSchema.parse({
      artifactId,
      action: 'reveal'
    })).toEqual({ artifactId, action: 'reveal' })
    expect(ArtifactHostActionResultSchema.parse({ performed: true })).toEqual({ performed: true })
    expect(ArtifactHostActionRequestSchema.safeParse({
      artifactId,
      action: 'open',
      absolutePath: '/private/export.mp4'
    }).success).toBe(false)
    expect(ArtifactHostActionRequestSchema.safeParse({
      artifactId,
      action: 'open',
      ownerExtensionId: 'other.extension'
    }).success).toBe(false)
  })

  it('publishes media/jobs methods in the View-safe catalog but no generic job start', () => {
    expect(isExtensionViewSafeMethod('media.openViewResource')).toBe(true)
    expect(isExtensionViewSafeMethod('media.readText')).toBe(true)
    expect(isExtensionViewSafeMethod('media.getCapabilities')).toBe(true)
    expect(isExtensionViewSafeMethod('media.performArtifactAction')).toBe(true)
    expect(isExtensionViewSafeMethod('media.startArchiveJob')).toBe(true)
    expect(isExtensionViewSafeMethod('jobs.subscribe')).toBe(true)
    expect(isExtensionViewSafeMethod('jobs.start')).toBe(false)
  })
})
