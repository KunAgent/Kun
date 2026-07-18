import {
  MediaAudioAnalysisCapabilitiesSchema,
  MediaBeatAnalysisResultSchema,
  MediaSilenceAnalysisResultSchema,
  MediaStartAudioAnalysisJobRequestSchema,
  MediaStartAudioAnalysisJobResultSchema,
  MediaSyncFeaturesAnalysisResultSchema,
  type JobReference,
  type MediaAudioAnalysisCapabilities,
  type MediaStartAudioAnalysisJobRequest,
  type MediaStartAudioAnalysisJobResult,
  type ParsedMediaStartAudioAnalysisJobRequest
} from '@kun/extension-api'
import type { JsonValue } from '../extensions/types.js'
import { extensionWorkspaceKey } from '../extensions/paths.js'
import type { ExtensionPrincipal } from './extension-agent-service.js'
import {
  ExtensionJobService,
  type ExtensionJobCoreExecutor
} from './extension-job-service.js'
import type { ExtensionJobSnapshot } from './extension-job-types.js'
import { ExtensionMediaProcessService } from './extension-media-process-service.js'

const MEDIA_AUDIO_ANALYSIS_JOB_KIND = 'media.audio-analysis'
const REQUIRED_PERMISSIONS = [
  'jobs.manage',
  'media.read',
  'media.process',
  'workspace.read'
] as const

export class ExtensionAudioAnalysisJobError extends Error {
  readonly retryable: boolean
  readonly category: 'permission' | 'scope' | 'unavailable' | 'invalid'

  constructor(
    readonly code:
      | 'permission_denied'
      | 'workspace_denied'
      | 'analysis_unavailable'
      | 'invalid_checkpoint',
    message: string,
    options: {
      retryable?: boolean
      category?: ExtensionAudioAnalysisJobError['category']
    } = {}
  ) {
    super(message)
    this.retryable = options.retryable ?? false
    this.category = options.category ?? 'invalid'
  }
}

/**
 * Durable, owner-scoped adapter for fixed local audio-analysis algorithms.
 * Extension code can observe and cancel these jobs through the generic Jobs
 * API; paths and executable arguments never enter the checkpoint or result.
 */
export class ExtensionAudioAnalysisJobService {
  private readonly unregisterExecutor: () => void

  constructor(private readonly options: {
    jobs: ExtensionJobService
    media: ExtensionMediaProcessService
  }) {
    const executor: ExtensionJobCoreExecutor = {
      kind: MEDIA_AUDIO_ANALYSIS_JOB_KIND,
      execute: async (snapshot, context) => {
        const request = parseCheckpoint(context.checkpoint?.data)
        const principal = executionPrincipal(snapshot, context.workspaceRoot)
        if (request.analysis === 'beat-grid') {
          await context.reportProgress({
            phase: 'beat-analysis',
            completed: 0,
            total: 1,
            unit: 'source',
            percentage: 0,
            message: 'Measuring bounded local beat evidence'
          })
          const evidence = await this.options.media.analyzeBeatGridForCore(
            principal,
            request.inputHandleId,
            {
              maxMarkers: request.maxMarkers,
              signal: context.signal
            }
          )
          await context.reportProgress({
            phase: 'beat-analysis',
            completed: 1,
            total: 1,
            unit: 'source',
            percentage: 100,
            message: evidence.markers.length > 0
              ? 'Local beat evidence ready'
              : 'Analysis complete; no confident beat grid was found'
          })
          return {
            schemaVersion: 1,
            data: MediaBeatAnalysisResultSchema.parse({
              schemaVersion: 1,
              analysis: 'beat-grid',
              source: evidence.source,
              provenance: {
                algorithm: 'kun.pcm-onset-autocorrelation',
                algorithmVersion: '1.0.0',
                local: true,
                networkUsed: false
              },
              ...(evidence.tempoBpm === undefined ? {} : { tempoBpm: evidence.tempoBpm }),
              markers: evidence.markers,
              analyzedDurationMicros: evidence.analyzedDurationMicros,
              truncated: evidence.truncated
            }) as JsonValue,
            generatedArtifacts: []
          }
        }
        if (request.analysis === 'silence') {
          await context.reportProgress({
            phase: 'silence-analysis',
            completed: 0,
            total: 1,
            unit: 'source',
            percentage: 0,
            message: 'Measuring bounded local silence evidence'
          })
          const evidence = await this.options.media.analyzeSilenceForCore(
            principal,
            request.inputHandleId,
            {
              noiseThresholdDb: request.noiseThresholdDb,
              minimumSilenceMicros: request.minimumSilenceMicros,
              maxIntervals: request.maxIntervals,
              signal: context.signal
            }
          )
          await context.reportProgress({
            phase: 'silence-analysis',
            completed: 1,
            total: 1,
            unit: 'source',
            percentage: 100,
            message: 'Local silence evidence ready'
          })
          return {
            schemaVersion: 1,
            data: MediaSilenceAnalysisResultSchema.parse({
              schemaVersion: 1,
              analysis: 'silence',
              source: evidence.source,
              provenance: {
                algorithm: 'ffmpeg.silencedetect',
                algorithmVersion: '1.0.0',
                local: true,
                networkUsed: false
              },
              parameters: {
                noiseThresholdDb: request.noiseThresholdDb,
                minimumSilenceMicros: request.minimumSilenceMicros
              },
              intervals: evidence.intervals,
              analyzedDurationMicros: evidence.analyzedDurationMicros,
              truncated: evidence.truncated
            }) as JsonValue,
            generatedArtifacts: []
          }
        }

        await context.reportProgress({
          phase: 'sync-features',
          completed: 0,
          total: 2,
          unit: 'source',
          percentage: 0,
          message: 'Extracting reference audio features locally'
        })
        const reference = await this.options.media.extractSyncFeaturesForCore(
          principal,
          request.referenceHandleId,
          {
            samplePeriodMicros: request.samplePeriodMicros,
            maximumDurationMicros: request.maximumDurationMicros,
            maxFeaturePoints: request.maxFeaturePoints,
            signal: context.signal
          }
        )
        await context.reportProgress({
          phase: 'sync-features',
          completed: 1,
          total: 2,
          unit: 'source',
          percentage: 50,
          message: 'Extracting target audio features locally'
        })
        const target = await this.options.media.extractSyncFeaturesForCore(
          principal,
          request.targetHandleId,
          {
            samplePeriodMicros: request.samplePeriodMicros,
            maximumDurationMicros: request.maximumDurationMicros,
            maxFeaturePoints: request.maxFeaturePoints,
            signal: context.signal
          }
        )
        await context.reportProgress({
          phase: 'sync-features',
          completed: 2,
          total: 2,
          unit: 'source',
          percentage: 100,
          message: 'Bounded synchronization features ready'
        })
        return {
          schemaVersion: 1,
          data: MediaSyncFeaturesAnalysisResultSchema.parse({
            schemaVersion: 1,
            analysis: 'sync-features',
            reference: reference.source,
            target: target.source,
            provenance: {
              algorithm: 'kun.pcm-energy-envelope',
              algorithmVersion: '1.0.0',
              local: true,
              networkUsed: false
            },
            seed: request.seed,
            samplePeriodMicros: request.samplePeriodMicros,
            referenceFeatures: reference.features,
            targetFeatures: target.features,
            referenceAnalyzedDurationMicros: reference.analyzedDurationMicros,
            targetAnalyzedDurationMicros: target.analyzedDurationMicros,
            truncated: reference.truncated || target.truncated
          }) as JsonValue,
          generatedArtifacts: []
        }
      },
      recover: () => 'interrupt'
    }
    this.unregisterExecutor = options.jobs.registerCoreExecutor(executor)
  }

  async capabilities(principal: ExtensionPrincipal): Promise<MediaAudioAnalysisCapabilities> {
    if (!principal.permissions.includes('media.process')) {
      throw new ExtensionAudioAnalysisJobError(
        'permission_denied',
        'Missing permission: media.process',
        { category: 'permission' }
      )
    }
    const capabilities = await this.options.media.audioAnalysisCapabilities(principal)
    const ready = (
      analysis: 'silence' | 'beat-grid' | 'sync-features',
      available: boolean,
      algorithm: string,
      requiredPrimitive: string
    ) => available
      ? {
          analysis,
          available: true as const,
          algorithm,
          algorithmVersion: '1.0.0',
          local: true as const,
          networkUsed: false as const
        }
      : {
          analysis,
          available: false as const,
          code: capabilities.executablesAvailable
            ? 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE' as const
            : 'AUDIO_ANALYSIS_EXECUTABLE_UNAVAILABLE' as const,
          remediation: capabilities.executablesAvailable
            ? `The installed FFmpeg build does not expose the required ${requiredPrimitive} primitive.`
            : 'Install FFmpeg and FFprobe in a reviewed Host location, then retry.',
          retryable: true,
          local: true as const,
          networkUsed: false as const
        }
    return MediaAudioAnalysisCapabilitiesSchema.parse({
      schemaVersion: 1,
      probedAt: capabilities.probedAt,
      analyses: [
        ready(
          'silence',
          capabilities.silence,
          'ffmpeg.silencedetect',
          'silencedetect filter'
        ),
        ready(
          'beat-grid',
          capabilities.beatGrid,
          'kun.pcm-onset-autocorrelation',
          'pcm_s16le encoder and s16le muxer'
        ),
        ready(
          'sync-features',
          capabilities.syncFeatures,
          'kun.pcm-energy-envelope',
          'pcm_s16le encoder and s16le muxer'
        )
      ]
    })
  }

  async start(
    principal: ExtensionPrincipal,
    rawRequest: MediaStartAudioAnalysisJobRequest
  ): Promise<MediaStartAudioAnalysisJobResult> {
    assertAuthorized(principal)
    const request = MediaStartAudioAnalysisJobRequestSchema.parse(rawRequest)
    if (principal.workspaceRoots.length !== 1) {
      throw new ExtensionAudioAnalysisJobError(
        'workspace_denied',
        'Audio analysis requires exactly one active workspace scope',
        { category: 'scope' }
      )
    }
    const capability = (await this.capabilities(principal)).analyses.find(
      ({ analysis }) => analysis === request.analysis
    )!
    if (!capability.available) {
      return MediaStartAudioAnalysisJobResultSchema.parse({
        outcome: 'unavailable',
        analysis: capability.analysis,
        code: capability.code,
        remediation: capability.remediation,
        retryable: capability.retryable,
        local: true,
        networkUsed: false
      })
    }
    const workspaceRoot = principal.workspaceRoots[0]!
    const created = await this.options.jobs.createAndDispatch({
      owner: {
        extensionId: principal.extensionId,
        extensionVersion: principal.extensionVersion,
        workspaceId: extensionWorkspaceKey(workspaceRoot)
      },
      workspaceRoot,
      kind: MEDIA_AUDIO_ANALYSIS_JOB_KIND,
      kindSchemaVersion: 1,
      initiatingOperation: 'media.startAudioAnalysisJob',
      permissionsSnapshot: [...principal.permissions],
      ...(request.idempotencyKey ? { idempotencyKey: request.idempotencyKey } : {}),
      checkpoint: { schemaVersion: 1, data: request as JsonValue }
    })
    return { outcome: 'started', job: reference(created.snapshot) }
  }

  dispose(): void {
    this.unregisterExecutor()
  }
}

function parseCheckpoint(value: JsonValue | undefined): ParsedMediaStartAudioAnalysisJobRequest {
  const parsed = MediaStartAudioAnalysisJobRequestSchema.safeParse(value)
  if (!parsed.success) {
    throw new ExtensionAudioAnalysisJobError(
      'invalid_checkpoint',
      'Audio-analysis job checkpoint is invalid'
    )
  }
  return parsed.data
}

function executionPrincipal(
  snapshot: ExtensionJobSnapshot,
  workspaceRoot: string
): ExtensionPrincipal {
  return {
    extensionId: snapshot.ownerExtensionId,
    extensionVersion: snapshot.ownerExtensionVersion,
    permissions: [...REQUIRED_PERMISSIONS],
    workspaceRoots: [workspaceRoot],
    workspaceTrusted: true
  }
}

function assertAuthorized(principal: ExtensionPrincipal): void {
  if (!principal.workspaceTrusted) {
    throw new ExtensionAudioAnalysisJobError(
      'workspace_denied',
      'Workspace is not trusted',
      { category: 'scope' }
    )
  }
  for (const permission of REQUIRED_PERMISSIONS) {
    if (!principal.permissions.includes(permission)) {
      throw new ExtensionAudioAnalysisJobError(
        'permission_denied',
        `Missing permission: ${permission}`,
        { category: 'permission' }
      )
    }
  }
}

function reference(snapshot: ExtensionJobSnapshot): JobReference {
  return {
    jobId: snapshot.id,
    kind: snapshot.kind,
    state: snapshot.state,
    cursor: snapshot.latestCursor
  }
}
