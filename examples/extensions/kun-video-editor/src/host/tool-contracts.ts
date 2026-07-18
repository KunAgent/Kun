import type { ExtensionToolDeclarationInput, JsonObject } from '@kun/extension-api'

export const VIDEO_TOOL_IDS = [
  'video-project',
  'video-inspect',
  'video-probe',
  'video-transcribe',
  'video-read-script',
  'video-apply-script',
  'video-update-timeline',
  'video-analyze-visual',
  'video-analyze-audio',
  'video-analysis-status',
  'video-analysis-cancel',
  'video-interchange',
  'video-interchange-status',
  'video-interchange-cancel',
  'video-generation-catalog',
  'video-generation-request',
  'video-generation-status',
  'video-generation-cancel',
  'video-project-package',
  'video-project-package-status',
  'video-project-package-cancel',
  'video-render',
  'video-render-status',
  'video-render-cancel',
  'video-undo'
] as const

export type VideoToolId = (typeof VIDEO_TOOL_IDS)[number]

const stableId = {
  type: 'string', minLength: 1, maxLength: 128,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$'
} satisfies JsonObject
const opaqueHandle = {
  type: 'string', minLength: 16, maxLength: 512, pattern: '^[A-Za-z0-9_-]+$'
} satisfies JsonObject
const analysisRecordId = {
  type: 'string', minLength: 1, maxLength: 512,
  pattern: '^[A-Za-z0-9][A-Za-z0-9._:~-]{0,511}$'
} satisfies JsonObject
const generationRecordId = {
  type: 'string', minLength: 8, maxLength: 256,
  pattern: '^[A-Za-z0-9._~-]+$'
} satisfies JsonObject
const generationProviderId = {
  type: 'string', minLength: 1, maxLength: 64,
  pattern: '^[a-z][a-z0-9._-]{0,63}$'
} satisfies JsonObject
const revision = { type: 'integer', minimum: 0, maximum: Number.MAX_SAFE_INTEGER } satisfies JsonObject
const boundedOutput = {
  type: 'object',
  properties: { outcome: { type: 'string', minLength: 1, maxLength: 64 } },
  required: ['outcome'],
  additionalProperties: true
} satisfies JsonObject

export const VIDEO_TOOL_DECLARATIONS = [
  {
    id: 'video-project',
    description: 'Resolve the active project, list projects, purely read one project, or explicitly create/select the authoritative workspace project. Read the current revision before any edit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['active', 'list', 'get', 'create', 'select'] },
        projectId: stableId,
        name: { type: 'string', minLength: 1, maxLength: 160 },
        fps: { type: 'object' },
        canvasPreset: { type: 'string', enum: ['16:9', '9:16', '1:1'] },
        expectedRevision: revision
      },
      required: ['action'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-inspect',
    description: 'Resolve revision-bound video context; inspect media, multicam programs, proofs, and export capabilities; preview OTIO interchange; or preflight a self-contained package without mutating project state or reading Webview DOM.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'context', 'project-window', 'raw-media', 'composed-frame', 'catalog',
            'media-library', 'preview-history', 'selection-attachment', 'export-capabilities',
            'otio-export-preview', 'otio-import-preview', 'project-package-preflight', 'multicam'
          ]
        },
        projectId: stableId,
        expectedRevision: revision,
        expectedGeneration: revision,
        sequenceId: stableId,
        groupId: stableId,
        startFrame: revision,
        endFrame: revision,
        itemLimit: { type: 'integer', minimum: 1, maximum: 200 },
        captionLimit: { type: 'integer', minimum: 1, maximum: 100 },
        includeCaptionText: { type: 'boolean' },
        includeEffects: { type: 'boolean' },
        includeKeyframes: { type: 'boolean' },
        assetId: stableId,
        transcriptId: stableId,
        segmentOffset: revision,
        segmentLimit: { type: 'integer', minimum: 1, maximum: 100 },
        includeWords: { type: 'boolean' },
        sampleFrames: { type: 'array', maxItems: 16, items: revision },
        frame: revision,
        folderId: stableId,
        query: { type: 'string', maxLength: 256 },
        offset: revision,
        limit: { type: 'integer', minimum: 1, maximum: 100 },
        previewEntryIds: { type: 'array', maxItems: 64, items: stableId },
        document: { type: 'object', additionalProperties: true },
        assetIds: { type: 'array', maxItems: 512, items: stableId },
        missingMediaPolicy: { type: 'string', enum: ['fail', 'omit', 'record-incomplete'] },
        includeReceipts: { type: 'boolean' },
        includeChatProvenance: { type: 'boolean' }
      },
      required: ['action'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-probe',
    description: 'Import or probe one Host-granted video, audio, still, or supported animation handle, persist normalized asset metadata, and optionally request thumbnail or waveform jobs. Never accepts paths.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        mediaHandleId: opaqueHandle,
        assetId: stableId,
        assetKind: { type: 'string', enum: ['image', 'animation'] },
        folderId: stableId,
        stillDurationFrames: { type: 'integer', minimum: 1, maximum: 1_080_000 },
        addToTimeline: { type: 'boolean' },
        thumbnailOutputHandleId: opaqueHandle,
        waveformOutputHandleId: opaqueHandle
      },
      required: ['projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-transcribe',
    description: 'Import a bounded timed transcript into an asset, or report local-ASR capability as unavailable without inventing text or uploading media.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        assetId: stableId,
        transcriptId: stableId,
        mode: { type: 'string', enum: ['import', 'local-asr'] },
        format: { type: 'string', enum: ['srt', 'vtt', 'json'] },
        language: { type: 'string', minLength: 1, maxLength: 32 },
        source: { type: 'string', minLength: 1, maxLength: 524_288 },
        segments: { type: 'array', minItems: 1, maxItems: 20_000, items: { type: 'object' } }
      },
      required: ['projectId', 'expectedRevision', 'assetId', 'transcriptId', 'mode'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-read-script',
    description: 'Read the deterministic revision-bound timeline.md projection for transcript-first review.',
    inputSchema: {
      type: 'object',
      properties: { projectId: stableId, expectedRevision: revision },
      required: ['projectId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-apply-script',
    description: 'Apply explicit timed source ranges from an unchanged revision-bound timeline.md projection as one transactional Agent edit.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        timelineMarkdown: { type: 'string', minLength: 1, maxLength: 262_144 },
        ranges: { type: 'array', minItems: 1, maxItems: 2_000, items: { type: 'object' } },
        summary: { type: 'string', minLength: 1, maxLength: 512 }
      },
      required: ['projectId', 'expectedRevision', 'timelineMarkdown', 'ranges'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-update-timeline',
    description: 'Apply bounded typed sequence, timeline, multicam, link-group, caption, composition, effect, keyframe, retime, track-state, or canvas operations at an expected revision.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        operations: { type: 'array', minItems: 1, maxItems: 200, items: { type: 'object' } },
        summary: { type: 'string', minLength: 1, maxLength: 512 }
      },
      required: ['projectId', 'expectedRevision', 'operations'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-analyze-visual',
    description: 'Build one revision-fenced immutable local visual index from a Host-granted media asset after explicit workspace opt-in and verified Host model installation. It never accepts model URLs, file paths, or unverified model metadata.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        assetId: stableId,
        intervalUs: { type: 'integer', minimum: 100000, maximum: 60000000 },
        maxFrames: { type: 'integer', minimum: 1, maximum: 2000 },
        allowPartial: { type: 'boolean' }
      },
      required: ['projectId', 'expectedRevision', 'assetId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-analyze-audio',
    description: 'Run local path-opaque silence/beat analysis, request bounded denoise metadata without changing audio, report honest speaker-model availability, preview/apply reviewed immutable speaker attribution, or preview/apply confidence-qualified seeded audio synchronization. Unknown, overlapping, and low-confidence evidence stays explicit.',
    inputSchema: {
      type: 'object',
      properties: {
        action: {
          type: 'string',
          enum: [
            'vad', 'vad-apply', 'speaker', 'speaker-attribution-preview',
            'speaker-attribution-apply', 'beat-grid', 'denoise-metadata', 'sync-preview', 'sync-apply'
          ]
        },
        projectId: stableId,
        expectedRevision: revision,
        assetId: stableId,
        referenceAssetId: stableId,
        targetAssetId: stableId,
        referenceItemId: stableId,
        targetItemId: stableId,
        analysisId: analysisRecordId,
        seed: { type: 'integer', minimum: 0, maximum: 2147483647 },
        maximumOffsetUs: { type: 'integer', minimum: 0, maximum: 3600000000 },
        threshold: { type: 'number', minimum: 0, maximum: 1 },
        minimumSeparation: { type: 'number', minimum: 0, maximum: 1 },
        confidenceThreshold: { type: 'number', minimum: 0, maximum: 1 }
      },
      required: ['action', 'projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-analysis-status',
    description: 'Read local audio/visual/speaker-analysis capabilities, immutable cached evidence, speaker identity registry status, bounded operation progress, or paged visual moment matches for one revision-fenced project. This never starts indexing or mutates project state.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['capabilities', 'list', 'evidence', 'operation', 'visual-search'] },
        projectId: stableId,
        expectedRevision: revision,
        analysisId: analysisRecordId,
        operationId: analysisRecordId,
        query: { type: 'string', minLength: 1, maxLength: 256 },
        minimumScore: { type: 'number', minimum: -1, maximum: 1 },
        offset: revision,
        pageSize: { type: 'integer', minimum: 1, maximum: 100 },
        limit: { type: 'integer', minimum: 1, maximum: 500 }
      },
      required: ['action', 'projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 262_144
  },
  {
    id: 'video-analysis-cancel',
    description: 'Cancel one in-flight local media-analysis operation only after verifying its project and pinned revision.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        operationId: analysisRecordId
      },
      required: ['projectId', 'expectedRevision', 'operationId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-interchange',
    description: 'Start a durable atomic OpenTimelineIO JSON export at an exact project revision. Stable IDs/timecodes and a bounded explicit loss manifest are retained; the destination is an opaque user-approved Host grant.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['export'] },
        projectId: stableId,
        expectedRevision: revision,
        outputHandleId: opaqueHandle
      },
      required: ['action', 'projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-interchange-status',
    description: 'Read one owned tracked OTIO export, including its pinned/current revisions, progress, generated document artifact, and original bounded loss manifest.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        jobId: { type: 'string', minLength: 8, maxLength: 512 }
      },
      required: ['projectId', 'jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-interchange-cancel',
    description: 'Cancel one owned tracked OTIO export after verifying its project and workspace ownership.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        jobId: { type: 'string', minLength: 8, maxLength: 512 },
        reason: { type: 'string', minLength: 1, maxLength: 512 }
      },
      required: ['projectId', 'jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-generation-catalog',
    description: 'Read the bounded provider-neutral local/BYOK/remote generation model catalog, permissions, privacy, reference limits, and cost bounds. Returns an honest unavailable result when no approved broker is connected.',
    inputSchema: {
      type: 'object',
      properties: {},
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-generation-request',
    description: 'Request or explicitly retry one bounded image, video, audio, or upscale job at a pinned project revision. Remote permission, reference upload, and bounded cost intent are explicit; Host authorization remains mandatory and provider credentials never enter the tool.',
    inputSchema: {
      type: 'object',
      properties: {
        task: { type: 'string', enum: ['image', 'video', 'audio', 'upscale'] },
        projectId: stableId,
        projectRevision: revision,
        providerId: generationProviderId,
        modelId: generationProviderId,
        prompt: { type: 'string', minLength: 1, maxLength: 8_000 },
        negativePrompt: { type: 'string', minLength: 1, maxLength: 4_000 },
        referenceAssetIds: { type: 'array', maxItems: 8, items: stableId },
        variants: { type: 'integer', minimum: 1, maximum: 8 },
        seed: revision,
        output: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['image', 'video', 'audio'] },
            width: { type: 'integer', minimum: 1, maximum: 65_536 },
            height: { type: 'integer', minimum: 1, maximum: 65_536 },
            durationUs: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
          },
          required: ['kind'],
          additionalProperties: false
        },
        outputPolicy: { type: 'string', enum: ['resolve-placeholder', 'add-variants'] },
        idempotencyKey: generationRecordId,
        consent: {
          type: 'object',
          properties: {
            providerPermissionApproved: { type: 'boolean' },
            mediaUploadApproved: { type: 'boolean' },
            costApproved: { type: 'boolean' },
            approvedMaximumMinor: revision,
            currency: { type: 'string', pattern: '^[A-Z]{3}$' },
            confirmedAt: { type: 'string', minLength: 20, maxLength: 64 }
          },
          required: [
            'providerPermissionApproved', 'mediaUploadApproved', 'costApproved',
            'approvedMaximumMinor', 'currency', 'confirmedAt'
          ],
          additionalProperties: false
        },
        retryRecordId: generationRecordId
      },
      required: [
        'task', 'projectId', 'projectRevision', 'providerId', 'modelId', 'prompt',
        'referenceAssetIds', 'variants', 'output', 'outputPolicy', 'idempotencyKey', 'consent'
      ],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'external',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-generation-status',
    description: 'Read a bounded list of owned generation placeholders/jobs or one owned status. Raw prompts, provider credentials, protected handles, endpoints, and reusable URLs are omitted.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['list', 'status'] },
        projectId: stableId,
        recordId: generationRecordId
      },
      required: ['action', 'projectId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-generation-cancel',
    description: 'Cancel one owned generation job through its separate authority-bearing operation without exposing provider or media credentials.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        recordId: generationRecordId
      },
      required: ['projectId', 'recordId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-project-package',
    description: 'Preflight or start an atomic durable self-contained ZIP project package at a pinned revision. Includes every sequence, explicit media selection/missing policy, bounded receipts and invocation provenance, generation lineage, and source-identity deduplication. Binary media stays behind opaque Host grants.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['preflight', 'export'] },
        projectId: stableId,
        expectedRevision: revision,
        assetIds: { type: 'array', maxItems: 512, items: stableId },
        missingMediaPolicy: { type: 'string', enum: ['fail', 'omit'] },
        includeReceipts: { type: 'boolean' },
        includeChatProvenance: { type: 'boolean' },
        outputHandleId: opaqueHandle
      },
      required: ['action', 'projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-project-package-status',
    description: 'Read one owned tracked durable project-package job and its atomic archive result without exposing Host paths.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        jobId: { type: 'string', minLength: 8, maxLength: 512 }
      },
      required: ['projectId', 'jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-project-package-cancel',
    description: 'Cancel one owned tracked durable project-package job after verifying its project identity.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        jobId: { type: 'string', minLength: 8, maxLength: 512 }
      },
      required: ['projectId', 'jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-render',
    description: 'Start a durable brokered proof, preview, audio, H.264, H.265, or ProRes/portable-equivalent export job from the canonical timeline or a source-preserving multicam program, with probed codec/effect evidence, bounded settings, captions, a pinned revision, and opaque output grants.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision,
        multicamGroupId: stableId,
        startFrame: revision,
        endFrame: revision,
        kind: {
          type: 'string',
          enum: ['proof-frame', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'audio-aac', 'subtitles']
        },
        outputHandleId: opaqueHandle,
        proofFrame: revision,
        captionMode: { type: 'string', enum: ['none', 'burned', 'sidecar', 'both'] },
        subtitleOutputHandleId: opaqueHandle,
        subtitleFormat: { type: 'string', enum: ['srt', 'vtt'] },
        idempotencyKey: { type: 'string', minLength: 1, maxLength: 256 },
        width: { type: 'integer', minimum: 2, maximum: 16384 },
        height: { type: 'integer', minimum: 2, maximum: 16384 },
        frameRate: {
          type: 'object',
          properties: {
            numerator: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
            denominator: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER }
          },
          required: ['numerator', 'denominator'],
          additionalProperties: false
        },
        quality: { type: 'string', enum: ['draft', 'balanced', 'high', 'master'] },
        acceleration: { type: 'string', enum: ['cpu', 'prefer-gpu', 'require-gpu'] },
        allowPortableEquivalent: { type: 'boolean' },
        audio: {
          type: 'object',
          properties: {
            codec: { type: 'string', enum: ['aac', 'pcm-s24', 'flac'] },
            sampleRate: { type: 'integer', enum: [44100, 48000, 96000] },
            channels: { type: 'integer', minimum: 1, maximum: 16 },
            bitrateKbps: { type: 'integer', minimum: 32, maximum: 1536 }
          },
          required: ['codec', 'sampleRate', 'channels'],
          additionalProperties: false
        }
      },
      required: ['projectId', 'expectedRevision', 'kind'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'write',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-render-status',
    description: 'Read one owned durable render job without side effects and return only project-matched, technically validated generated artifacts.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', minLength: 8, maxLength: 512 },
        projectId: stableId
      },
      required: ['jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'read',
    idempotent: true,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-render-cancel',
    description: 'Cancel one owned, tracked durable video render after verifying its optional project identity.',
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', minLength: 8, maxLength: 512 },
        projectId: stableId,
        reason: { type: 'string', minLength: 1, maxLength: 512 }
      },
      required: ['jobId'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  },
  {
    id: 'video-undo',
    description: 'Undo only the calling Agent run\'s most recent eligible video edit and refuse if a manual or foreign mutation intervened.',
    inputSchema: {
      type: 'object',
      properties: {
        projectId: stableId,
        expectedRevision: revision
      },
      required: ['projectId', 'expectedRevision'],
      additionalProperties: false
    },
    outputSchema: boundedOutput,
    sideEffects: 'destructive',
    idempotent: false,
    maxOutputBytes: 131_072
  }
] as const satisfies readonly ExtensionToolDeclarationInput[]

export function videoToolDeclaration(id: VideoToolId): ExtensionToolDeclarationInput {
  const declaration = VIDEO_TOOL_DECLARATIONS.find((candidate) => candidate.id === id)
  if (!declaration) throw new Error(`Unknown video tool declaration: ${id}`)
  return declaration
}
