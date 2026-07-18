import { createHash } from 'node:crypto'
import { MAX_MEDIA_OTIO_TEXT_BYTES } from '@kun/extension-api'
import type {
  ExtensionContext,
  ExtensionErrorData,
  GeneratedArtifact,
  JsonObject,
  JsonValue,
  JobSnapshot,
  MediaCapabilities,
  MediaMetadata,
  MediaProbeResult,
  ToolInvocationContext,
  ToolResult
} from '@kun/extension-api'
import { replaceAsciiControlCharacters } from '../text-safety.js'
import {
  ProjectService,
  TimelineOperationSchema,
  VideoEngineError,
  appendPreviewHistory,
  applySpeakerAttributionPlan,
  applyTimelineOperations,
  applyTimelineScript,
  beatSnapTargets,
  boundedEffectCatalog,
  buildVideoSelectionAttachment,
  buildEditableCaptions,
  buildSpeakerAttributionPlan,
  comparePreviewHistory,
  combineAudioSourceFingerprints,
  compileMulticamProgramIr,
  compileMulticamProgramProject,
  compileRenderIr,
  createMediaFolder,
  defaultFfmpegCapabilities,
  deleteMediaFolder,
  emptyPreviewHistory,
  framesToMicroseconds,
  generateRenderPlan,
  generateTimelineMarkdown,
  flattenNestedRenderIr,
  importTranscript,
  inspectMulticamProgram,
  inspectComposedTimeline,
  inspectRawMedia,
  mediaLibraryPage,
  microsecondsToFrames,
  negotiateRenderIr,
  negotiateAdvancedEffects,
  negotiateAdvancedExport,
  organizeMediaAssets,
  planAudioSynchronization,
  exportProjectToOtio,
  importProjectFromOtio,
  serializeOtioInterchange,
  PROJECT_PACKAGE_LIMITS,
  parseTimelineScriptHeader,
  planBatchMediaImport,
  planDecomposeNestedSequence,
  planReplaceTimelineItemFromPreview,
  projectDurationFrames,
  readCompactProjectWindow,
  readMediaIntelligenceEvidence,
  resolveProjectContext,
  resolveInteractivePlayback,
  renderIrDigest,
  selectPreviewHistory,
  sequenceDurationFrames,
  updateMediaFolder,
  validateHistory,
  type AssetTimeRange,
  type AudioSyncAnalysis,
  type DiarizationRecord,
  type ImportedDiarizationTurn,
  type AdvancedEffectExecutionPlan,
  type AdvancedExportPlan,
  type AdvancedExportSettings,
  type CaptionBuildOptions,
  type FfmpegRenderStep,
  type MediaAsset,
  type MulticamGroup,
  type MutationReceipt,
  type InterchangeLossManifest,
  type PreviewHistory,
  type PreviewHistoryEntry,
  type PreviewSource,
  type ProjectSelectionPatch,
  type ProofArtifactBinding,
  type RenderBackendCapabilities,
  type RenderKind,
  type RevisionAuthor,
  type SpeakerIdentity,
  type TextRenderStep,
  type TimelineItem,
  type TimelineOperation,
  type Transcript,
  type VideoProject
} from '../engine/index.js'
import {
  planMulticamEditorAction,
  type MulticamEditorAction
} from './multicam-control.js'
import { VIDEO_TOOL_DECLARATIONS } from './tool-contracts.js'
import { DerivedMediaService } from './derived-media-service.js'
import {
  GenerationControlPlane,
  type GenerationReferenceResolver
} from './generation-control-plane.js'
import {
  GenerationService,
  type GenerationExecutionBroker,
  type GenerationMaterialization
} from './generation-service.js'
import { KunLocalAudioAnalysisBroker } from './kun-audio-analysis-broker.js'
import {
  MediaIntelligenceService,
  type AnalysisOutcome,
  type IntelligenceRecord
} from './media-intelligence-service.js'
import {
  observedAdvancedFfmpegCapabilities,
  observedRenderBackendCapabilities,
  professionalExportCapabilityProjection
} from './professional-export.js'
import {
  prepareProjectPackageArchiveExport,
  startProjectPackageArchiveExport
} from './project-package-export-service.js'
import {
  OTIO_OUTPUT_MIME_TYPE,
  prepareOtioInterchangeExport,
  startOtioInterchangeExport
} from './otio-interchange-service.js'

const MAX_PROJECTS = 100
const MAX_ASSETS = 100
const MAX_TRACKS = 64
const MAX_ITEMS = 500
const MAX_CAPTIONS = 500
const MAX_TRANSCRIPTS = 100
const MAX_TRANSCRIPT_SEGMENTS = 500
const MAX_SEQUENCES = 32
const MAX_MEDIA_FOLDERS = 256
const MAX_LINK_GROUPS = 256
const MAX_MULTICAM_GROUPS = 64
const MAX_SCRIPT_BYTES = 240 * 1024
const ACTIVE_PROJECT_KEY = 'active-project'
const PREVIEW_HISTORY_PREFIX = 'preview-history:'
const RENDER_RECORD_PREFIX = 'render-job:'
const PROJECT_PACKAGE_RECORD_PREFIX = 'project-package-job:'
const OTIO_EXPORT_RECORD_PREFIX = 'otio-export-job:'
const RENDER_TRACKING_CANCELLATION_WAIT_MS = 12_000
const INLINE_OTIO_PREVIEW_BYTES = 96 * 1024
const INTERCHANGE_MAPPING_PREVIEW_LIMIT = 256
const PACKAGE_PREFLIGHT_ASSET_PREVIEW_LIMIT = 200
const PACKAGE_PREFLIGHT_DEDUPE_PREVIEW_LIMIT = 64

type RenderRecord = {
  schemaVersion: 1
  jobId: string
  projectId: string
  sequenceId: string
  pinnedRevision: number
  renderIrDigest: string
  backendCapabilitiesDigest: string
  renderRange: { startFrame: number; endFrame: number }
  playbackMode: 'source-fast-path' | 'composed-proof'
  renderKind: RenderKind
  requestedRenderKind?: 'h264-mp4' | 'h265-mp4' | 'prores-mov'
  advancedSettingsDigest?: string
  advancedCapabilitiesDigest?: string
  effectSemanticsDigest?: string
  portableEquivalent?: boolean
  captionMode: 'none' | 'burned' | 'sidecar' | 'both'
  subtitleFormat: 'srt' | 'vtt'
  canvasPreset: VideoProject['canvas']['preset']
  proofFrame?: number
  expectedArtifacts: Array<{
    mediaKind: 'image' | 'video' | 'audio' | 'subtitle'
    mimeType: string
  }>
  createdAt: string
}

type ProjectPackageExportRecord = {
  schemaVersion: 1
  jobId: string
  projectId: string
  sequenceId: string
  pinnedRevision: number
  packageId: string
  manifestDigest: string
  complete: boolean
  selectedAssetCount: number
  embeddedAssetCount: number
  uniqueMediaCount: number
  deduplicatedAssetCount: number
  missingAssetIds: string[]
  missingMediaPolicy: 'fail' | 'omit'
  createdAt: string
}

type OtioExportRecord = {
  schemaVersion: 1
  jobId: string
  projectId: string
  sequenceId: string
  pinnedRevision: number
  adapterId: 'kun.otio-json'
  adapterVersion: '1.0.0'
  documentDigest: string
  projectDigest: string
  documentBytes: number
  lossManifest: InterchangeLossManifest
  createdAt: string
}

type RenderCapabilityAssessment =
  | { failure: ToolResult }
  | {
      backendCapabilities: RenderBackendCapabilities
      selectedRenderKind: RenderKind
      advancedEffects?: AdvancedEffectExecutionPlan
      advancedExport?: AdvancedExportPlan
    }

type ToolInput = Readonly<Record<string, unknown>>

// Node Host packages are installed without an extension-local node_modules
// tree. Keep the Host entrypoint runtime-self-contained instead of importing
// the SDK error class at activation time. The broker consumes this public
// structural error shape, while tests may still throw the SDK implementation.
class ExtensionApiError extends Error {
  readonly code: ExtensionErrorData['code']
  readonly operation?: string
  readonly extensionId?: string
  readonly retryable: boolean
  readonly details?: JsonObject
  readonly documentation?: string

  constructor(data: ExtensionErrorData) {
    super(data.message)
    this.name = 'ExtensionApiError'
    this.code = data.code
    this.operation = data.operation
    this.extensionId = data.extensionId
    this.retryable = data.retryable
    this.details = data.details
    this.documentation = data.documentation
  }
}

export class VideoEditorTools {
  private projectService?: ProjectService
  private derivedMediaService?: DerivedMediaService
  private mediaIntelligenceService?: MediaIntelligenceService
  private generationServiceInstance?: GenerationService
  private generationControlPlaneInstance?: GenerationControlPlane

  constructor(
    private readonly context: ExtensionContext,
    private readonly options: { generationBroker?: GenerationExecutionBroker } = {}
  ) {}

  async register(): Promise<void> {
    for (const declaration of VIDEO_TOOL_DECLARATIONS) {
      this.context.subscriptions.add(
        await this.context.tools.registerTool(declaration, (input, invocation) =>
          this.invoke(declaration.id, input, invocation)
        )
      )
    }
  }

  async invoke(
    toolId: string,
    input: JsonObject,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    try {
      assertNotCancelled(invocation)
      const parsed = asRecord(input, toolId)
      switch (toolId) {
        case 'video-project':
          return await this.videoProject(parsed)
        case 'video-inspect':
          return await this.videoInspect(parsed)
        case 'video-probe':
          return await this.videoProbe(parsed, invocation)
        case 'video-transcribe':
          return await this.videoTranscribe(parsed, 'agent', invocation)
        case 'video-read-script':
          return await this.videoReadScript(parsed)
        case 'video-apply-script':
          return await this.videoApplyScript(parsed, 'agent', invocation)
        case 'video-update-timeline':
          return await this.videoUpdateTimeline(parsed, 'agent', invocation)
        case 'video-analyze-visual':
          return await this.videoAnalyzeVisual(parsed, invocation)
        case 'video-analyze-audio':
          return await this.videoAnalyzeAudio(parsed, 'agent', invocation)
        case 'video-analysis-status':
          return await this.videoAnalysisStatus(parsed)
        case 'video-analysis-cancel':
          return await this.videoAnalysisCancel(parsed)
        case 'video-interchange':
          return await this.videoInterchange(parsed, invocation)
        case 'video-interchange-status':
          return await this.videoInterchange({ ...parsed, action: 'status' }, invocation)
        case 'video-interchange-cancel':
          return await this.videoInterchange({ ...parsed, action: 'cancel' }, invocation)
        case 'video-generation-catalog':
          return await this.videoGenerationCatalog()
        case 'video-generation-request':
          return await this.videoGenerationRequest(parsed)
        case 'video-generation-status':
          return await this.videoGenerationStatus(parsed)
        case 'video-generation-cancel':
          return await this.videoGenerationCancel(parsed)
        case 'video-project-package':
          return await this.videoProjectPackage(parsed, invocation)
        case 'video-project-package-status':
          return await this.videoProjectPackage({ ...parsed, action: 'status' }, invocation)
        case 'video-project-package-cancel':
          return await this.videoProjectPackage({ ...parsed, action: 'cancel' }, invocation)
        case 'video-render':
          return await this.videoRender(parsed, invocation)
        case 'video-render-status':
          return await this.videoRenderStatus(parsed)
        case 'video-render-cancel':
          return await this.videoRenderCancel(parsed)
        case 'video-undo':
          return await this.videoUndo(parsed, invocation)
        default:
          throw new ToolInputError(`Unknown video tool: ${toolId}`)
      }
    } catch (error) {
      if (error instanceof VideoEngineError) throw publicEngineError(error, toolId)
      throw error
    }
  }

  async editorRequest(value: JsonValue): Promise<JsonValue> {
    try {
      return await this.editorRequestResult(value) as unknown as JsonValue
    } catch (error) {
      if (error instanceof VideoEngineError) throw publicEngineError(error, 'editor-request')
      throw error
    }
  }

  private async editorRequestResult(value: JsonValue): Promise<ToolResult> {
    const request = asRecord(value, 'editor-request')
    exactKeys(request, ['action', 'payload'])
    const action = enumValue(request.action, [
      'project.list',
      'project.active',
      'project.get',
      'project.select',
      'project.create',
      'project.update',
      'context.update',
      'context.attach-selection',
      'project.undo',
      'project.redo',
      'sequence.decompose',
      'script.read',
      'script.apply',
      'media.list',
      'media.import',
      'media.import-batch',
      'media.reauthorize',
      'media.folder.create',
      'media.folder.update',
      'media.folder.delete',
      'media.organize',
      'transcript.import',
      'caption.generate',
      'preview.list',
      'preview.add',
      'preview.select',
      'preview.compare',
      'preview.replace',
      'export-capabilities',
      'otio-export-preview',
      'otio-import-preview',
      'interchange.export',
      'interchange.status',
      'interchange.cancel',
      'interchange.import-preview',
      'interchange.import',
      'project-package-preflight',
      'project-package.export',
      'project-package.status',
      'project-package.cancel',
      'render.list',
      'render.start',
      'render.status',
      'render.cancel',
      'derived.list',
      'derived.start',
      'derived.retry',
      'derived.cancel',
      'derived.cleanup',
      'analysis.capabilities',
      'analysis.visual-opt-in',
      'analysis.visual-install',
      'analysis.visual-index',
      'analysis.visual-search',
      'analysis.list',
      'analysis.evidence',
      'analysis.vad',
      'analysis.vad-apply',
      'analysis.speaker-import',
      'analysis.speaker-preview',
      'analysis.speaker-apply',
      'analysis.beats',
      'analysis.denoise-metadata',
      'analysis.sync-preview',
      'analysis.sync-apply',
      'analysis.status',
      'analysis.cancel',
      'generation.catalog',
      'generation.list',
      'generation.request',
      'generation.retry',
      'generation.status',
      'generation.cancel',
      'generation.insert',
      'multicam.inspect',
      'multicam.create',
      'multicam.labels',
      'multicam.sync-confirm',
      'multicam.layout-upsert',
      'multicam.delete',
      'multicam.switch',
      'multicam.layout',
      'multicam.merge'
    ] as const, 'action')
    const payload = request.payload === undefined ? {} : asRecord(request.payload, 'payload')
    const invocation = this.commandInvocation(action)
    let response: ToolResult
    switch (action) {
      case 'project.list':
        response = await this.videoProject({ ...payload, action: 'list' })
        break
      case 'project.active':
        response = await this.videoProject({ ...payload, action: 'active' }, 'manual')
        break
      case 'project.get':
        response = await this.videoProject({ ...payload, action: 'get' }, 'manual')
        break
      case 'project.select':
        response = await this.videoProject({ ...payload, action: 'select' }, 'manual')
        break
      case 'project.create':
        response = await this.videoProject({ ...payload, action: 'create' }, 'manual')
        break
      case 'project.update':
        response = await this.videoUpdateTimeline(payload, 'manual')
        break
      case 'context.update':
        response = await this.videoUpdateContext(payload)
        break
      case 'context.attach-selection':
        response = await this.videoSelectionAttachment(payload)
        break
      case 'project.undo':
      case 'project.redo':
        response = await this.videoHistory(payload, action === 'project.undo' ? 'undo' : 'redo')
        break
      case 'sequence.decompose':
        response = await this.videoDecomposeSequence(payload)
        break
      case 'script.read':
        response = await this.videoReadScript(payload)
        break
      case 'script.apply':
        response = await this.videoApplyScript(payload, 'manual')
        break
      case 'media.list':
        response = await this.videoInspect({ ...payload, action: 'media-library' })
        break
      case 'media.import':
        response = await this.videoProbe(payload, invocation, 'manual')
        break
      case 'media.import-batch':
        response = await this.videoProbeBatch(payload, invocation)
        break
      case 'media.reauthorize':
        response = await this.videoReauthorize(payload, invocation)
        break
      case 'media.folder.create':
      case 'media.folder.update':
      case 'media.folder.delete':
      case 'media.organize':
        response = await this.videoMediaLibraryMutation(payload, action)
        break
      case 'transcript.import':
        response = await this.videoTranscribe(payload, 'manual')
        break
      case 'caption.generate':
        response = await this.videoGenerateCaptions(payload)
        break
      case 'preview.list':
      case 'preview.add':
      case 'preview.select':
      case 'preview.compare':
      case 'preview.replace':
        response = await this.videoPreview(payload, action)
        break
      case 'export-capabilities':
      case 'otio-export-preview':
      case 'otio-import-preview':
      case 'project-package-preflight':
        response = await this.videoInspect({ ...payload, action })
        break
      case 'interchange.export':
        response = await this.videoInterchange({ ...payload, action: 'export' }, invocation)
        break
      case 'interchange.status':
        response = await this.videoInterchange({ ...payload, action: 'status' }, invocation)
        break
      case 'interchange.cancel':
        response = await this.videoInterchange({ ...payload, action: 'cancel' }, invocation)
        break
      case 'interchange.import-preview':
        response = await this.videoInterchangeImport(payload, false)
        break
      case 'interchange.import':
        response = await this.videoInterchangeImport(payload, true)
        break
      case 'project-package.export':
        response = await this.videoProjectPackage({ ...payload, action: 'export' }, invocation)
        break
      case 'project-package.status':
        response = await this.videoProjectPackage({ ...payload, action: 'status' }, invocation)
        break
      case 'project-package.cancel':
        response = await this.videoProjectPackage({ ...payload, action: 'cancel' }, invocation)
        break
      case 'render.list':
        response = await this.videoRenderList(payload)
        break
      case 'render.start':
        response = await this.videoRender(payload, invocation)
        break
      case 'render.status':
        response = await this.videoRenderStatus(payload)
        break
      case 'render.cancel':
        response = await this.videoRenderCancel(payload)
        break
      case 'derived.list':
        response = await this.videoDerivedList(payload)
        break
      case 'derived.start':
        response = await this.videoDerivedStart(payload)
        break
      case 'derived.retry':
        response = await this.videoDerivedStart(payload, true)
        break
      case 'derived.cancel':
        response = await this.videoDerivedCancel(payload)
        break
      case 'derived.cleanup':
        response = await this.videoDerivedCleanup(payload)
        break
      case 'analysis.capabilities':
      case 'analysis.list':
      case 'analysis.evidence':
      case 'analysis.status':
        response = await this.videoAnalysisStatus({
          ...payload,
          action: action.slice('analysis.'.length) === 'status'
            ? 'operation'
            : action.slice('analysis.'.length)
        })
        break
      case 'analysis.visual-search':
        response = await this.videoAnalysisStatus({ ...payload, action: 'visual-search' })
        break
      case 'analysis.visual-opt-in':
        response = await this.videoVisualOptIn(payload)
        break
      case 'analysis.visual-install':
        response = await this.videoVisualInstall(payload, invocation)
        break
      case 'analysis.visual-index':
        response = await this.videoAnalyzeVisual(payload, invocation)
        break
      case 'analysis.vad':
      case 'analysis.vad-apply':
      case 'analysis.denoise-metadata':
      case 'analysis.speaker-import':
      case 'analysis.speaker-preview':
      case 'analysis.speaker-apply':
      case 'analysis.beats':
      case 'analysis.sync-preview':
      case 'analysis.sync-apply':
        response = await this.videoAnalyzeAudio({
          ...payload,
          action: action.slice('analysis.'.length) === 'beats'
            ? 'beat-grid'
            : action.slice('analysis.'.length) === 'speaker-import'
              ? 'speaker-import'
              : action.slice('analysis.'.length) === 'speaker-preview'
                ? 'speaker-attribution-preview'
                : action.slice('analysis.'.length) === 'speaker-apply'
                  ? 'speaker-attribution-apply'
                  : action.slice('analysis.'.length)
        }, 'manual', invocation)
        break
      case 'analysis.cancel':
        response = await this.videoAnalysisCancel(payload)
        break
      case 'generation.catalog':
        response = await this.videoGenerationCatalog()
        break
      case 'generation.list':
      case 'generation.status':
        response = await this.videoGenerationStatus({
          ...payload,
          action: action === 'generation.list' ? 'list' : 'status'
        })
        break
      case 'generation.request':
        response = await this.videoGenerationRequest(payload)
        break
      case 'generation.retry':
        response = await this.videoGenerationRetry(payload)
        break
      case 'generation.cancel':
        response = await this.videoGenerationCancel(payload)
        break
      case 'generation.insert':
        response = await this.videoGenerationInsert(payload)
        break
      case 'multicam.inspect':
        response = await this.videoInspect({ ...payload, action: 'multicam' })
        break
      case 'multicam.create':
      case 'multicam.labels':
      case 'multicam.sync-confirm':
      case 'multicam.layout-upsert':
      case 'multicam.delete':
      case 'multicam.switch':
      case 'multicam.layout':
      case 'multicam.merge':
        response = await this.videoMulticamMutation(payload, action)
        break
    }
    return response
  }

  private async videoGenerationCatalog(): Promise<ToolResult> {
    const content = await this.generationControlPlane().catalog()
    return result(content, content.outcome === 'available'
      ? 'Read the bounded provider-neutral generation catalog'
      : 'Generation is unavailable; ordinary editing and export remain available')
  }

  private async videoGenerationRequest(input: ToolInput): Promise<ToolResult> {
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.projectRevision, 'projectRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const content = await this.generationControlPlane().request(input)
    return result(content, content.outcome === 'queued'
      ? 'Created a durable generation placeholder before dispatching provider work'
      : content.outcome === 'confirmation-required'
        ? 'Generation requires explicit provider, upload, or bounded-cost confirmation'
        : 'Generation request returned without fabricating media')
  }

  private async videoGenerationStatus(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['action', 'projectId', 'recordId'])
    const action = enumValue(input.action, ['list', 'status'] as const, 'action')
    const projectId = stableId(input.projectId, 'projectId')
    // Loading the project prevents a caller from using stale generation
    // metadata as an alternate project-discovery channel.
    await this.service().loadProject(projectId)
    const content = action === 'list'
      ? await this.generationControlPlane().list({ projectId })
      : await this.generationControlPlane().status({
          projectId,
          recordId: generationOpaqueId(input.recordId, 'recordId')
        })
    const records = action === 'list' && Array.isArray(content.records)
      ? content.records
      : [content]
    for (const record of records) {
      if (
        record && typeof record === 'object' && !Array.isArray(record) &&
        record.state === 'ready' &&
        typeof record.id === 'string' &&
        Array.isArray(record.outputs) && record.outputs.length > 1
      ) {
        await this.materializeGenerationRecord(projectId, record.id, {
          requireRequestRevision: true,
          autoOnlyMultiple: true
        })
      }
    }
    return result({
      outcome: action === 'list' ? 'listed' : 'status',
      ...content
    }, action === 'list'
      ? 'Read bounded owned generation placeholders and jobs'
      : 'Read one owned generation placeholder or job')
  }

  private async videoGenerationRetry(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'recordId', 'consent'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const content = await this.generationControlPlane().retry({
      projectId,
      recordId: generationOpaqueId(input.recordId, 'recordId'),
      consent: input.consent
    })
    return result(content, content.outcome === 'queued'
      ? 'Reauthorized and retried the persisted idempotent generation request'
      : 'Generation retry returned without exposing its persisted prompt or media handles')
  }

  private async videoGenerationCancel(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'recordId'])
    const projectId = stableId(input.projectId, 'projectId')
    await this.service().loadProject(projectId)
    const content = await this.generationControlPlane().cancel({
      projectId,
      recordId: generationOpaqueId(input.recordId, 'recordId')
    })
    return result({ outcome: 'cancelled', record: content }, 'Requested cancellation for one owned generation job')
  }

  private async videoGenerationInsert(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'recordId', 'outputId', 'addToTimeline',
      'timelineStartFrame', 'stillDurationFrames'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const recordId = generationOpaqueId(input.recordId, 'recordId')
    const outputId = generationOpaqueId(input.outputId, 'outputId')
    const addToTimeline = input.addToTimeline === undefined
      ? true
      : optionalBoolean(input.addToTimeline, 'addToTimeline')!
    const timelineStartFrame = input.timelineStartFrame === undefined
      ? undefined
      : nonNegativeInteger(input.timelineStartFrame, 'timelineStartFrame')
    const stillDurationFrames = input.stillDurationFrames === undefined
      ? undefined
      : boundedPositiveInteger(input.stillDurationFrames, 'stillDurationFrames', 1, 1_080_000)
    const materialized = await this.materializeGenerationRecord(projectId, recordId, {
      expectedRevision,
      selectedOutputId: outputId,
      addToTimeline,
      timelineStartFrame,
      stillDurationFrames
    })
    if (!materialized.selectedAsset) {
      throw new ToolInputError('The selected generation output could not be materialized.')
    }
    return result({
      outcome: materialized.changed ? 'inserted' : 'already-in-project',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: materialized.project.currentRevision,
      ...(materialized.receipt ? { receipt: materialized.receipt } : {}),
      asset: generatedAssetSummary(materialized.selectedAsset),
      materializedVariantCount: materialized.assets.length,
      addedToTimeline: materialized.addedToTimeline
    }, materialized.changed
      ? `Materialized verified generation variants at revision ${materialized.project.currentRevision}`
      : 'The verified generation outputs are already present in the project')
  }

  /**
   * Resolves one owned ready generation record into the project atomically.
   * Automatic completion is fenced to the request revision; an explicit
   * insertion is separately fenced by the caller's current project revision.
   */
  private async materializeGenerationRecord(
    projectId: string,
    recordId: string,
    options: {
      expectedRevision?: number
      requireRequestRevision?: boolean
      autoOnlyMultiple?: boolean
      selectedOutputId?: string
      addToTimeline?: boolean
      timelineStartFrame?: number
      stillDurationFrames?: number
    }
  ): Promise<{
    project: VideoProject
    assets: MediaAsset[]
    selectedAsset?: MediaAsset
    changed: boolean
    addedToTimeline: boolean
    receipt?: MutationReceipt
  }> {
    const current = await this.service().loadProject(projectId)
    if (options.expectedRevision !== undefined) {
      assertExpectedRevision(current, options.expectedRevision)
    }
    const materializations = await this.generationService().materializations(projectId, recordId)
    if (materializations.length === 0) {
      throw new ToolInputError('The generation record has no verified outputs.')
    }
    if (options.autoOnlyMultiple && materializations.length < 2) {
      return { project: current, assets: [], changed: false, addedToTimeline: false }
    }
    const identity = materializations[0]!
    if (materializations.some((entry) =>
      entry.recordId !== identity.recordId ||
      entry.jobId !== identity.jobId ||
      entry.projectRevision !== identity.projectRevision ||
      entry.outputPolicy !== identity.outputPolicy ||
      entry.primaryAssetId !== identity.primaryAssetId
    )) {
      throw new ToolInputError('Generation materialization identities are inconsistent.')
    }

    const assets = materializations.map((entry) => generatedAssetFromMaterialization(current, entry))
    if (new Set(assets.map(({ id }) => id)).size !== assets.length) {
      throw new ToolInputError('Generation outputs resolve to duplicate project asset identities.')
    }
    const selectedIndex = options.selectedOutputId === undefined
      ? -1
      : materializations.findIndex(({ output }) => output.id === options.selectedOutputId)
    if (options.selectedOutputId !== undefined && selectedIndex < 0) {
      throw new ToolInputError('Generation output does not belong to this record.')
    }
    const selectedAsset = selectedIndex < 0 ? undefined : assets[selectedIndex]
    const missingAssets: MediaAsset[] = []
    for (const asset of assets) {
      const existing = current.assets.find(({ id }) => id === asset.id)
      if (!existing) {
        missingAssets.push(asset)
        continue
      }
      if (!sameGeneratedMaterialization(existing, asset)) {
        throw new ToolInputError(`Generated asset identity ${asset.id} is already used by different media.`)
      }
    }

    if (
      options.requireRequestRevision &&
      missingAssets.length > 0 &&
      current.currentRevision !== identity.projectRevision
    ) {
      return {
        project: current,
        assets,
        ...(selectedAsset ? { selectedAsset } : {}),
        changed: false,
        addedToTimeline: false
      }
    }

    let candidate = missingAssets.length > 0
      ? planBatchMediaImport(current, missingAssets).project
      : structuredClone(current)
    let addedToTimeline = false
    if (selectedAsset && options.addToTimeline) {
      const materializedAsset = candidate.assets.find(({ id }) => id === selectedAsset.id)
      if (!materializedAsset) throw new ToolInputError('Materialized generation asset is missing from the project.')
      const itemId = `item-${materializedAsset.id}`
      const existingItem = candidate.items.find(({ id }) => id === itemId)
      if (existingItem && existingItem.assetId !== materializedAsset.id) {
        throw new ToolInputError(`Timeline item identity ${itemId} is already used by different media.`)
      }
      if (!existingItem) {
        const item = initialItem(candidate, materializedAsset)
        if (options.timelineStartFrame !== undefined) item.timelineStartFrame = options.timelineStartFrame
        if (materializedAsset.kind === 'image' && options.stillDurationFrames !== undefined) {
          const durationUs = Math.max(1, framesToMicroseconds(options.stillDurationFrames, candidate.fps))
          materializedAsset.durationUs = Math.max(materializedAsset.durationUs, durationUs)
          item.durationFrames = options.stillDurationFrames
          item.sourceEndUs = durationUs
        }
        candidate = applyTimelineOperations(candidate, [{ type: 'add-item', item }]).project
        addedToTimeline = true
      }
    }
    if (missingAssets.length === 0 && !addedToTimeline) {
      return {
        project: current,
        assets,
        ...(selectedAsset ? {
          selectedAsset: current.assets.find(({ id }) => id === selectedAsset.id) ?? selectedAsset
        } : {}),
        changed: false,
        addedToTimeline: false
      }
    }

    try {
      const committed = await this.service().saveProjectWithReceipt(candidate, current.currentRevision, {
        author: options.requireRequestRevision ? 'system' : 'manual',
        sourceOperation: options.requireRequestRevision ? 'generation.materialize' : 'generation.insert',
        summary: `Materialized ${assets.length} verified generation output${assets.length === 1 ? '' : 's'}`
      })
      await this.publishProjectChange(committed.project, 'generation-materialized', committed.receipt)
      return {
        project: committed.project,
        assets,
        ...(selectedAsset ? {
          selectedAsset: committed.project.assets.find(({ id }) => id === selectedAsset.id) ?? selectedAsset
        } : {}),
        changed: true,
        addedToTimeline,
        receipt: committed.receipt
      }
    } catch (error) {
      if (options.requireRequestRevision && error instanceof VideoEngineError && error.code === 'revision_conflict') {
        const latest = await this.service().loadProject(projectId)
        const complete = assets.every((asset) => {
          const existing = latest.assets.find(({ id }) => id === asset.id)
          return existing !== undefined && sameGeneratedMaterialization(existing, asset)
        })
        if (complete) {
          return {
            project: latest,
            assets,
            ...(selectedAsset ? {
              selectedAsset: latest.assets.find(({ id }) => id === selectedAsset.id) ?? selectedAsset
            } : {}),
            changed: false,
            addedToTimeline: false
          }
        }
        return {
          project: latest,
          assets,
          ...(selectedAsset ? { selectedAsset } : {}),
          changed: false,
          addedToTimeline: false
        }
      }
      throw error
    }
  }

  private async videoAnalysisStatus(input: ToolInput): Promise<ToolResult> {
    const action = enumValue(input.action, ['capabilities', 'list', 'evidence', 'operation', 'visual-search'] as const, 'action')
    exactKeys(input, [
      'action', 'projectId', 'expectedRevision', 'analysisId', 'operationId', 'query',
      'minimumScore', 'offset', 'limit', 'pageSize'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    if (action === 'capabilities') {
      const [capabilities, denoiseMetadata, visual, speakerIdentities] = await Promise.all([
        this.intelligenceService().audioCapabilities(),
        this.intelligenceService().denoiseMetadataCapability(),
        this.intelligenceService().visualProvisioning(),
        this.intelligenceService().listSpeakerIdentities(projectId)
      ])
      return result({
        outcome: 'capabilities',
        projectId,
        currentRevision: project.currentRevision,
        capabilities: capabilities as unknown as JsonObject,
        denoiseMetadata: denoiseMetadata as unknown as JsonObject,
        visual: visual as unknown as JsonObject,
        speakerAdapters: this.intelligenceService().speakerAdapters() as unknown as JsonValue,
        speakerIdentities: speakerIdentities as unknown as JsonValue
      }, 'Read verified local media-analysis capabilities')
    }
    if (action === 'visual-search') {
      const outcome = await this.intelligenceService().searchVisual({
        project,
        indexId: analysisIdentifier(input.analysisId, 'analysisId'),
        query: boundedString(input.query, 'query', 1, 256),
        ...(input.minimumScore === undefined ? {} : {
          minimumScore: boundedNumber(input.minimumScore, 'minimumScore', -1, 1)
        }),
        ...(input.offset === undefined ? {} : { offset: nonNegativeInteger(input.offset, 'offset') }),
        ...(input.pageSize === undefined ? {} : {
          pageSize: boundedPositiveInteger(input.pageSize, 'pageSize', 1, 100)
        })
      })
      if (outcome.outcome !== 'ready') {
        return result({
          outcome: 'unavailable',
          projectId,
          currentRevision: project.currentRevision,
          code: outcome.code,
          remediation: outcome.remediation,
          local: true,
          networkUsed: false
        }, 'Visual moment search is unavailable; no match was fabricated')
      }
      return result({
        outcome: 'ready',
        projectId,
        currentRevision: project.currentRevision,
        page: outcome.page as unknown as JsonObject
      }, `Read ${outcome.page.results.length} bounded uncalibrated visual moment matches`)
    }
    if (action === 'list') {
      const records = await this.intelligenceService().listRecords(projectId)
      const summaries = await Promise.all(records.slice(0, 512).map(async (record) => {
        const currentGrant = await this.intelligenceService().matchesCurrentGrantBinding(project, record)
        const summary = analysisRecordSummary(record, currentGrant ? project : undefined)
        summary.currentGrant = currentGrant
        return summary
      }))
      return result({
        outcome: 'listed',
        projectId,
        currentRevision: project.currentRevision,
        records: summaries,
        recordsTruncated: records.length > 512,
        operations: this.intelligenceService().listOperations(projectId)
          .filter(({ projectRevision }) => projectRevision === expectedRevision)
      }, `Read ${records.length} immutable local analysis records`)
    }
    if (action === 'evidence') {
      const analysisId = analysisIdentifier(input.analysisId, 'analysisId')
      const record = await this.intelligenceService().getRecord(projectId, analysisId)
      if (!record) throw new ToolInputError(`Media-intelligence evidence does not exist: ${analysisId}`)
      if (!await this.intelligenceService().matchesCurrentGrantBinding(project, record)) {
        throw new VideoEngineError(
          'invalid_operation',
          'Media-intelligence evidence belongs to an older or revoked media grant; reauthorize and analyze again.'
        )
      }
      const evidence = await this.intelligenceService().readEvidence(projectId, analysisId, {
        ...(input.offset === undefined ? {} : { offset: nonNegativeInteger(input.offset, 'offset') }),
        ...(input.limit === undefined ? {} : {
          limit: boundedPositiveInteger(input.limit, 'limit', 1, 500)
        })
      })
      return result({
        outcome: 'evidence',
        projectId,
        currentRevision: project.currentRevision,
        evidence: evidence as unknown as JsonObject
      }, `Read bounded ${evidence.kind} evidence`)
    }
    const operationId = analysisIdentifier(input.operationId, 'operationId')
    const progress = this.intelligenceService().status(operationId)
    if (!progress || progress.projectId !== projectId) {
      throw new ToolInputError(`Local analysis operation does not exist in this project: ${operationId}`)
    }
    if (progress.projectRevision !== expectedRevision) {
      throw new VideoEngineError('revision_conflict', 'Local analysis operation belongs to a different project revision', {
        expectedRevision,
        currentRevision: progress.projectRevision
      })
    }
    return result({ outcome: 'operation', progress: progress as unknown as JsonObject },
      `Local analysis operation ${operationId} is ${progress.status}`)
  }

  private async videoAnalysisCancel(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'operationId'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const operationId = analysisIdentifier(input.operationId, 'operationId')
    const progress = this.intelligenceService().status(operationId)
    if (!progress || progress.projectId !== projectId || progress.projectRevision !== expectedRevision) {
      throw new ToolInputError('Local analysis operation is missing or no longer belongs to this project revision.')
    }
    const accepted = await this.intelligenceService().cancel(operationId)
    return result({ outcome: accepted ? 'cancelled' : 'not-running', operationId, accepted },
      accepted ? 'Cancelled local audio analysis' : 'Local audio analysis was already terminal')
  }

  private async videoVisualOptIn(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'enabled'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    if (typeof input.enabled !== 'boolean') throw new ToolInputError('enabled must be a boolean.')
    const capability = await this.intelligenceService().setVisualOptIn(input.enabled)
    return result({
      outcome: input.enabled ? 'enabled' : 'disabled',
      projectId,
      currentRevision: project.currentRevision,
      capability: capability as unknown as JsonObject
    }, input.enabled
      ? 'Enabled workspace-local visual indexing opt-in; no model download or inference was started'
      : 'Disabled workspace-local visual indexing opt-in')
  }

  private async videoVisualInstall(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const controller = new AbortController()
    const subscription = invocation.cancellation.onCancellationRequested(() => controller.abort())
    try {
      if (invocation.cancellation.isCancellationRequested) controller.abort()
      const installed = await this.intelligenceService().requestVisualModelInstall(controller.signal)
      return result({
        outcome: installed.outcome,
        projectId,
        currentRevision: project.currentRevision,
        capability: installed.capability as unknown as JsonObject
      }, installed.outcome === 'ready'
        ? 'Host Broker verified the local visual model installation'
        : 'No approved Host model installation operation is available; no download was attempted')
    } finally {
      await subscription.dispose()
    }
  }

  private async videoAnalyzeVisual(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'assetId', 'intervalUs', 'maxFrames', 'allowPartial'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const assetId = stableId(input.assetId, 'assetId')
    const asset = project.assets.find(({ id }) => id === assetId)
    if (!asset || !['video', 'image', 'animation'].includes(asset.kind)) {
      throw new ToolInputError('Visual indexing requires a current video, image, or supported animation asset.')
    }
    if (!asset.mediaHandleId) {
      throw new VideoEngineError('invalid_operation', 'Visual indexing requires a current Host media grant.')
    }
    if (input.allowPartial !== undefined && typeof input.allowPartial !== 'boolean') {
      throw new ToolInputError('allowPartial must be a boolean.')
    }
    const controller = new AbortController()
    const subscription = invocation.cancellation.onCancellationRequested(() => controller.abort())
    try {
      if (invocation.cancellation.isCancellationRequested) controller.abort()
      const outcome = await this.intelligenceService().startVisualIndex({
        project,
        assetId,
        ...(input.intervalUs === undefined ? {} : {
          intervalUs: boundedPositiveInteger(input.intervalUs, 'intervalUs', 100_000, 60_000_000)
        }),
        ...(input.maxFrames === undefined ? {} : {
          maxFrames: boundedPositiveInteger(input.maxFrames, 'maxFrames', 1, 2_000)
        }),
        ...(input.allowPartial === undefined ? {} : { allowPartial: input.allowPartial }),
        signal: controller.signal
      })
      const currentProject = await this.service().loadProject(projectId)
      const revisionStale = currentProject.currentRevision !== expectedRevision
      if (outcome.outcome === 'ready') {
        const evidence = readMediaIntelligenceEvidence(outcome.record, { limit: 200 })
        return result({
          outcome: 'ready',
          projectId,
          pinnedRevision: expectedRevision,
          currentRevision: currentProject.currentRevision,
          revisionStale,
          operationId: outcome.operationId,
          deduplicated: outcome.deduplicated,
          record: analysisRecordSummary(outcome.record, project),
          evidence: evidence as unknown as JsonObject
        }, revisionStale
          ? 'Visual index completed for the pinned source evidence, but the project revision changed; refresh before using it'
          : `Visual index is ready with ${outcome.record.indexedSampleCount} immutable local frame embeddings`)
      }
      if (outcome.outcome === 'unavailable') {
        return result({
          outcome: 'unavailable',
          projectId,
          pinnedRevision: expectedRevision,
          currentRevision: currentProject.currentRevision,
          revisionStale,
          capability: outcome.capability as unknown as JsonObject
        }, 'Visual indexing is unavailable; no model download, upload, or synthetic evidence occurred')
      }
      return result({
        ...outcome,
        projectId,
        pinnedRevision: expectedRevision,
        currentRevision: currentProject.currentRevision,
        revisionStale
      } as unknown as JsonObject, outcome.outcome === 'cancelled'
        ? 'Visual indexing was cancelled and no partial index was published'
        : 'Visual indexing failed without publishing an incomplete index')
    } finally {
      await subscription.dispose()
    }
  }

  private async videoAnalyzeAudio(
    input: ToolInput,
    author: RevisionAuthor = 'agent',
    invocation?: ToolInvocationContext
  ): Promise<ToolResult> {
    const action = enumValue(
      input.action,
      [
        'vad', 'vad-apply', 'speaker', 'speaker-import', 'speaker-attribution-preview',
        'speaker-attribution-apply', 'beat-grid', 'denoise-metadata', 'sync-preview', 'sync-apply'
      ] as const,
      'action'
    )
    exactKeys(input, [
      'action', 'projectId', 'expectedRevision', 'assetId', 'referenceAssetId', 'targetAssetId',
      'referenceItemId', 'targetItemId', 'analysisId', 'seed', 'maximumOffsetUs', 'threshold',
      'minimumSeparation', 'confidenceThreshold', 'document'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)

    if (action === 'speaker') {
      const adapters = this.intelligenceService().speakerAdapters()
      const local = adapters.find(({ descriptor }) => descriptor.execution === 'local-model')
      if (!local || local.outcome !== 'ready') {
        return result({
          outcome: 'unavailable',
          projectId,
          currentRevision: project.currentRevision,
          code: local?.code ?? 'speaker_inference_broker_unavailable',
          remediation: local?.remediation ?? 'This Kun build has no approved local speaker inference broker.',
          adapters: adapters as unknown as JsonValue,
          importAvailable: adapters.some(({ descriptor, outcome }) =>
            descriptor.execution === 'import' && outcome === 'ready'),
          local: true,
          networkUsed: false
        }, 'Local speaker diarization is unavailable; no speaker identity or turn was fabricated')
      }
      return result({
        outcome: 'unavailable',
        projectId,
        currentRevision: project.currentRevision,
        code: 'speaker_registry_enrollment_required',
        remediation: 'A verified local speaker model is present, but this project has no brokered enrollment workflow. Import reviewed speaker evidence instead.',
        adapters: adapters as unknown as JsonValue,
        local: true,
        networkUsed: false
      }, 'Speaker inference requires reviewed identity enrollment; no identity was guessed')
    }

    if (action === 'speaker-import') {
      if (author !== 'manual') {
        throw new ToolInputError('Speaker evidence import requires an explicit right-sidebar user action.')
      }
      const imported = strictSpeakerImportDocument(input.document)
      const cancellation = new AbortController()
      const cancellationSubscription = invocation?.cancellation.onCancellationRequested(() => cancellation.abort())
      try {
        if (invocation?.cancellation.isCancellationRequested) cancellation.abort()
        const outcome = await this.intelligenceService().importSpeakerEvidence({
          project,
          assetId: stableId(input.assetId, 'assetId'),
          identities: imported.identities,
          turns: imported.turns,
          confidenceThreshold: imported.confidenceThreshold,
          completeness: imported.completeness,
          signal: cancellation.signal
        })
        if (outcome.outcome !== 'ready') return analysisToolResult(project, outcome, 'speaker diarization import')
        const evidence = readMediaIntelligenceEvidence(outcome.record, { limit: 200 })
        return result({
          outcome: 'ready',
          projectId,
          currentRevision: project.currentRevision,
          operationId: outcome.operationId,
          deduplicated: outcome.deduplicated,
          record: analysisRecordSummary(outcome.record, project),
          evidence: evidence as unknown as JsonObject,
          identities: await this.intelligenceService().listSpeakerIdentities(projectId) as unknown as JsonValue
        }, `Imported ${outcome.record.turns.length} reviewed speaker turns without reading a path or running inference`)
      } finally {
        await cancellationSubscription?.dispose()
      }
    }

    if (action === 'speaker-attribution-preview' || action === 'speaker-attribution-apply') {
      const record = await this.requiredAnalysisRecord(project, input.analysisId, 'speaker-diarization')
      const plan = buildSpeakerAttributionPlan(project, record)
      const projection = speakerAttributionPlanProjection(plan)
      if (action === 'speaker-attribution-preview') {
        return result({
          outcome: 'preview',
          projectId,
          currentRevision: project.currentRevision,
          plan: projection,
          transcriptSegments: plan.transcriptSegments.slice(0, 200) as unknown as JsonValue,
          captions: plan.captions.slice(0, 100) as unknown as JsonValue,
          truncated: plan.transcriptSegments.length > 200 || plan.captions.length > 100
        }, `Previewed ${plan.transcriptSegments.length} transcript and ${plan.captions.length} caption speaker attributions`)
      }
      if (plan.transcriptSegments.length === 0 && plan.captions.length === 0) {
        return result({
          outcome: 'refused',
          code: 'SPEAKER_ATTRIBUTION_NO_OVERLAP',
          projectId,
          currentRevision: project.currentRevision,
          analysisId: record.id
        }, 'No transcript or caption range overlaps this speaker evidence; no project change was made')
      }
      const applied = applySpeakerAttributionPlan(project, plan)
      const committed = await this.service().saveProjectWithReceipt(applied.project, expectedRevision, {
        author,
        ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
        sourceOperation: 'audio-analysis.speaker-attribution-apply',
        summary: `Applied reviewed speaker attribution ${record.id}`
      })
      await this.publishProjectChange(committed.project, 'speaker-attribution-applied', committed.receipt)
      return result({
        outcome: 'applied',
        projectId,
        previousRevision: expectedRevision,
        currentRevision: committed.project.currentRevision,
        analysisId: record.id,
        plan: projection,
        applied: {
          transcriptSegments: applied.attributedTranscriptSegmentCount,
          captions: applied.attributedCaptionCount,
          identified: applied.identifiedCount,
          uncertain: applied.uncertainCount
        },
        receipt: committed.receipt as unknown as JsonObject
      }, `Applied speaker attribution; ${applied.uncertainCount} unknown, overlapping, or uncertain targets remain explicitly unlabelled`)
    }

    if (action === 'vad-apply') {
      const record = await this.requiredAnalysisRecord(project, input.analysisId, 'vad')
      const ranges = record.silence
        .filter(({ disposition, confidence }) =>
          disposition === 'safe-to-suggest' && confidence >= record.suggestionConfidenceThreshold
        )
        .map(({ sourceRange }) => ({ ...sourceRange, reason: 'silence' as const }))
      if (ranges.length === 0) {
        return result({
          outcome: 'refused',
          code: 'VAD_CONFIDENCE_BELOW_THRESHOLD',
          projectId,
          currentRevision: project.currentRevision,
          analysisId: record.id,
          threshold: record.suggestionConfidenceThreshold,
          message: 'No silence suggestion reached the declared confidence threshold; no timeline change was made.'
        }, 'Refused low-confidence silence removal')
      }
      const preview = applyTimelineScript(project, generateTimelineMarkdown(project), ranges)
      const committed = await this.service().saveProjectWithReceipt(preview.project, expectedRevision, {
        author,
        ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
        sourceOperation: 'audio-analysis.vad-apply',
        summary: `Removed ${ranges.length} confidence-qualified silence ranges`
      })
      await this.publishProjectChange(committed.project, 'vad-silence-applied', committed.receipt)
      return result({
        outcome: 'applied',
        projectId,
        previousRevision: expectedRevision,
        currentRevision: committed.project.currentRevision,
        analysisId: record.id,
        appliedRangeCount: ranges.length,
        threshold: record.suggestionConfidenceThreshold,
        receipt: committed.receipt as unknown as JsonObject
      }, `Applied ${ranges.length} confidence-qualified silence ranges transactionally`)
    }

    if (action === 'sync-apply') {
      const record = await this.requiredAnalysisRecord(project, input.analysisId, 'audio-sync')
      const referenceItemId = stableId(input.referenceItemId, 'referenceItemId')
      const targetItemId = stableId(input.targetItemId, 'targetItemId')
      const plan = planAudioSynchronization(project, referenceItemId, targetItemId, record)
      if (plan.outcome !== 'ready' || !plan.operation) {
        return result({
          outcome: 'refused',
          code: 'AUDIO_SYNC_UNCERTAIN',
          projectId,
          currentRevision: project.currentRevision,
          analysisId: record.id,
          preview: plan as unknown as JsonObject,
          message: 'Audio synchronization confidence or separation is insufficient; no clip was moved.'
        }, 'Refused uncertain audio synchronization without changing the timeline')
      }
      const committed = await this.service().applyOperationsWithReceipt(
        projectId,
        expectedRevision,
        [plan.operation],
        {
          author,
          ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
          sourceOperation: 'audio-analysis.sync-apply',
          summary: `Applied confidence-qualified audio synchronization ${record.id}`
        }
      )
      await this.publishProjectChange(committed.project, 'audio-sync-applied', committed.receipt)
      return result({
        outcome: 'applied',
        projectId,
        previousRevision: expectedRevision,
        currentRevision: committed.project.currentRevision,
        analysisId: record.id,
        preview: plan as unknown as JsonObject,
        receipt: committed.receipt as unknown as JsonObject
      }, `Moved the target clip by ${plan.deltaFrames} frames using confidence-qualified sync evidence`)
    }

    const cancellation = new AbortController()
    const cancellationSubscription = invocation?.cancellation.onCancellationRequested(() => cancellation.abort())
    try {
      if (invocation?.cancellation.isCancellationRequested) cancellation.abort()
      if (action === 'vad') {
        const outcome = await this.intelligenceService().analyzeVad({
          project,
          assetId: stableId(input.assetId, 'assetId'),
          signal: cancellation.signal
        })
        return analysisToolResult(project, outcome, 'VAD/silence')
      }
      if (action === 'beat-grid') {
        const outcome = await this.intelligenceService().analyzeBeats({
          project,
          assetId: stableId(input.assetId, 'assetId'),
          signal: cancellation.signal
        })
        return analysisToolResult(project, outcome, 'beat/downbeat')
      }
      if (action === 'denoise-metadata') {
        const outcome = await this.intelligenceService().analyzeDenoiseMetadata({
          project,
          assetId: stableId(input.assetId, 'assetId'),
          ...(input.confidenceThreshold === undefined ? {} : {
            confidenceThreshold: boundedNumber(input.confidenceThreshold, 'confidenceThreshold', 0, 1)
          }),
          signal: cancellation.signal
        })
        return analysisToolResult(project, outcome, 'denoise metadata')
      }
      const referenceAssetId = stableId(input.referenceAssetId, 'referenceAssetId')
      const targetAssetId = stableId(input.targetAssetId, 'targetAssetId')
      const referenceItemId = stableId(input.referenceItemId, 'referenceItemId')
      const targetItemId = stableId(input.targetItemId, 'targetItemId')
      const outcome = await this.intelligenceService().analyzeSync({
        project,
        referenceAssetId,
        targetAssetId,
        seed: nonNegativeInteger(input.seed, 'seed'),
        maximumOffsetUs: input.maximumOffsetUs === undefined
          ? 10_000_000
          : nonNegativeInteger(input.maximumOffsetUs, 'maximumOffsetUs'),
        ...(input.threshold === undefined ? {} : {
          threshold: boundedNumber(input.threshold, 'threshold', 0, 1)
        }),
        ...(input.minimumSeparation === undefined ? {} : {
          minimumSeparation: boundedNumber(input.minimumSeparation, 'minimumSeparation', 0, 1)
        }),
        signal: cancellation.signal
      })
      if (outcome.outcome !== 'ready') return analysisToolResult(project, outcome, 'audio synchronization')
      const preview = planAudioSynchronization(project, referenceItemId, targetItemId, outcome.record)
      return result({
        outcome: preview.outcome === 'ready' ? 'ready' : 'uncertain',
        projectId,
        currentRevision: project.currentRevision,
        operationId: outcome.operationId,
        deduplicated: outcome.deduplicated,
        record: analysisRecordSummary(outcome.record, project),
        preview: preview as unknown as JsonObject,
        evidence: readMediaIntelligenceEvidence(outcome.record, { limit: 1 }) as unknown as JsonObject
      }, preview.outcome === 'ready'
        ? `Previewed a ${preview.deltaFrames}-frame audio synchronization move; apply requires a separate revision-fenced transaction`
        : 'Audio synchronization is uncertain; no clip was moved')
    } finally {
      await cancellationSubscription?.dispose()
    }
  }

  private async requiredAnalysisRecord<K extends 'vad' | 'speaker-diarization' | 'beat-grid' | 'denoise-metadata' | 'audio-sync'>(
    project: VideoProject,
    value: unknown,
    kind: K
  ): Promise<Extract<IntelligenceRecord, { kind: K }>> {
    const analysisId = analysisIdentifier(value, 'analysisId')
    const record = await this.intelligenceService().getRecord(project.id, analysisId)
    if (!record || !hasAnalysisKind(record, kind)) {
      throw new ToolInputError(`Expected ${kind} analysis evidence: ${analysisId}`)
    }
    assertAnalysisSourcesCurrent(project, record)
    if (!await this.intelligenceService().matchesCurrentGrantBinding(project, record)) {
      throw new VideoEngineError(
        'invalid_operation',
        'Cached analysis evidence belongs to an older or revoked media grant; run the analysis again.'
      )
    }
    return record as Extract<IntelligenceRecord, { kind: K }>
  }

  private async videoDerivedList(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId'])
    const projectId = stableId(input.projectId, 'projectId')
    await this.service().loadProject(projectId)
    const listed = await this.derivedService().list(projectId)
    return result({
      outcome: 'listed',
      projectId,
      records: listed.records,
      usage: listed.usage,
      recoveryDiagnostics: listed.recoveryDiagnostics
    }, `Listed ${listed.records.length} derived media records`)
  }

  private async videoDerivedStart(input: ToolInput, retry = false): Promise<ToolResult> {
    exactKeys(input, [
      'projectId',
      'expectedRevision',
      'assetId',
      'kind',
      'outputHandleId',
      'priority',
      'parameters',
      ...(retry ? ['recordId'] : [])
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, nonNegativeInteger(input.expectedRevision, 'expectedRevision'))
    const kind = enumValue(
      input.kind,
      ['waveform', 'thumbnail', 'filmstrip', 'proxy', 'proof', 'preview'] as const,
      'kind'
    )
    const started = await this.derivedService().start({
      project,
      assetId: stableId(input.assetId, 'assetId'),
      kind,
      ...(input.outputHandleId === undefined
        ? {}
        : { outputHandleId: opaqueHandle(input.outputHandleId, 'outputHandleId') }),
      ...(input.priority === undefined ? {} : {
        priority: enumValue(
          input.priority,
          ['background', 'user', 'interactive', 'export'] as const,
          'priority'
        )
      }),
      ...(input.parameters === undefined ? {} : {
        normalizedParameters: asRecord(input.parameters, 'parameters')
      }),
      ...(retry ? { retryRecordId: stableId(input.recordId, 'recordId') } : {})
    })
    return result({
      outcome: started.outcome,
      projectId,
      currentRevision: project.currentRevision,
      record: started.record,
      jobId: started.jobId ?? null,
      message: started.message ?? null
    }, `${started.outcome === 'queued' ? 'Queued' : 'Resolved'} ${kind} derived media`)
  }

  private async videoDerivedCancel(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'recordId'])
    const projectId = stableId(input.projectId, 'projectId')
    const record = await this.derivedService().cancel(
      projectId,
      stableId(input.recordId, 'recordId')
    )
    return result({ outcome: 'cancelled', projectId, record }, 'Cancelled derived media work')
  }

  private async videoDerivedCleanup(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'includeReady'])
    const projectId = stableId(input.projectId, 'projectId')
    const includeReady = input.includeReady === true
    const cleaned = await this.derivedService().cleanup(projectId, includeReady)
    return result({
      outcome: 'cleaned',
      projectId,
      removedIds: cleaned.removedIds,
      usage: cleaned.usage
    }, `Removed ${cleaned.removedIds.length} derived media records`)
  }

  private async videoInspect(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, [
      'action', 'projectId', 'expectedRevision', 'expectedGeneration', 'sequenceId',
      'startFrame', 'endFrame', 'itemLimit', 'captionLimit', 'includeCaptionText',
      'includeEffects', 'includeKeyframes', 'assetId', 'transcriptId', 'segmentOffset',
      'segmentLimit', 'includeWords', 'sampleFrames', 'frame', 'folderId', 'query',
      'offset', 'limit', 'previewEntryIds', 'document', 'assetIds', 'missingMediaPolicy',
      'includeReceipts', 'includeChatProvenance', 'groupId'
    ])
    const action = enumValue(
      input.action,
      [
        'context', 'project-window', 'raw-media', 'composed-frame', 'catalog',
        'media-library', 'preview-history', 'selection-attachment', 'export-capabilities',
        'otio-export-preview', 'otio-import-preview', 'project-package-preflight', 'multicam'
      ] as const,
      'action'
    )
    if (action === 'catalog') {
      return result({ outcome: 'catalog', catalog: boundedEffectCatalog() as unknown as JsonObject },
        'Read the bounded video effects, blend, text-animation, and keyframe catalog')
    }
    if (action === 'export-capabilities') {
      try {
        const capabilities = await this.context.media.getCapabilities()
        return result({
          outcome: 'export-capabilities',
          capabilities: professionalExportCapabilityProjection(capabilities)
        }, 'Read the probed professional export and deterministic CPU fallback capabilities')
      } catch {
        return result({
          outcome: 'unavailable',
          code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
          retryable: true,
          message: 'Kun could not inspect the local FFmpeg capability inventory; no codec or GPU capability was assumed.'
        }, 'Professional export capability inspection is unavailable')
      }
    }
    if (action === 'otio-import-preview') {
      if (input.document === undefined) {
        throw new ToolInputError('otio-import-preview requires an inline OTIO JSON document.')
      }
      const imported = importProjectFromOtio(asRecord(input.document, 'document'))
      const mappings = interchangeMappingPreview(imported.timecodeMappings)
      return result({
        outcome: 'otio-import-preview',
        adapterId: imported.adapterId,
        adapterVersion: imported.adapterVersion,
        sourceDocumentDigest: imported.sourceDocumentDigest,
        fidelity: imported.fidelity,
        project: interchangeProjectSummary(imported.project),
        mediaRelinkRequired: imported.mediaRelinkRequired,
        timecodeMappings: mappings.items as unknown as JsonValue,
        timecodeMappingsTruncated: mappings.truncated,
        lossManifest: imported.lossManifest as unknown as JsonValue,
        persisted: false,
        message: 'The OTIO document was validated and normalized in memory only; no project or media grant was changed.'
      }, `Validated OTIO import preview for ${imported.project.id} without persisting it`)
    }
    const projectId = input.projectId === undefined
      ? await this.storedActiveProjectId()
      : stableId(input.projectId, 'projectId')
    if (!projectId) {
      if (action !== 'context') throw new ToolInputError(`${action} requires projectId.`)
      return result({
        outcome: 'no-active-context',
        workspaceId: this.workspaceId()
      }, 'No active video project or selection context exists in this workspace')
    }
    const project = await this.service().loadProject(projectId)
    const expectedRevision = input.expectedRevision === undefined
      ? undefined
      : nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const sequenceId = input.sequenceId === undefined
      ? undefined
      : stableId(input.sequenceId, 'sequenceId')

    if (action === 'otio-export-preview') {
      if (expectedRevision === undefined) {
        throw new ToolInputError('otio-export-preview requires expectedRevision to pin the exported project snapshot.')
      }
      assertExpectedRevision(project, expectedRevision)
      const exported = exportProjectToOtio(project)
      const bytes = serializeOtioInterchange(exported)
      const mappings = interchangeMappingPreview(exported.timecodeMappings)
      const documentInline = bytes.byteLength <= INLINE_OTIO_PREVIEW_BYTES
      return result({
        outcome: 'otio-export-preview',
        adapterId: exported.adapterId,
        adapterVersion: exported.adapterVersion,
        projectId: exported.projectId,
        projectRevision: exported.projectRevision,
        documentDigest: exported.documentDigest,
        projectDigest: exported.projectDigest,
        documentBytes: bytes.byteLength,
        documentInline,
        document: documentInline ? exported.document as unknown as JsonValue : null,
        timecodeMappings: mappings.items as unknown as JsonValue,
        timecodeMappingsTruncated: mappings.truncated,
        lossManifest: exported.lossManifest as unknown as JsonValue,
        durableExportAvailable: false,
        message: documentInline
          ? 'This bounded OTIO JSON is an inline preview. Kun has not written a durable export artifact.'
          : 'The OTIO document exceeds the bounded inline preview limit. Kun needs an atomic JSON output broker before it can write a durable artifact.'
      }, `Prepared revision ${expectedRevision} OTIO interchange preview with an explicit loss manifest`)
    }

    if (action === 'project-package-preflight') {
      if (expectedRevision === undefined) {
        throw new ToolInputError('project-package-preflight requires expectedRevision to pin the project snapshot.')
      }
      assertExpectedRevision(project, expectedRevision)
      return await this.projectPackagePreflight(project, input)
    }

    if (action === 'context') {
      const context = resolveProjectContext(project, {
        ...(expectedRevision === undefined ? {} : { expectedRevision }),
        ...(input.expectedGeneration === undefined ? {} : {
          expectedGeneration: nonNegativeInteger(input.expectedGeneration, 'expectedGeneration')
        }),
        ...(sequenceId ? { sequenceId } : {})
      })
      return result({ outcome: 'context', context },
        `Resolved ${context.status} video context at revision ${context.revision}`)
    }
    if (expectedRevision !== undefined) assertExpectedRevision(project, expectedRevision)

    if (action === 'project-window') {
      const window = readCompactProjectWindow(project, {
        ...(sequenceId ? { sequenceId } : {}),
        startFrame: nonNegativeInteger(input.startFrame, 'startFrame'),
        endFrame: nonNegativeInteger(input.endFrame, 'endFrame'),
        ...(input.itemLimit === undefined ? {} : {
          itemLimit: boundedPositiveInteger(input.itemLimit, 'itemLimit', 1, 200)
        }),
        ...(input.captionLimit === undefined ? {} : {
          captionLimit: boundedPositiveInteger(input.captionLimit, 'captionLimit', 1, 100)
        }),
        includeCaptionText: optionalBoolean(input.includeCaptionText, 'includeCaptionText') ?? false,
        includeEffects: optionalBoolean(input.includeEffects, 'includeEffects') ?? false,
        includeKeyframes: optionalBoolean(input.includeKeyframes, 'includeKeyframes') ?? false
      })
      return result({ outcome: 'project-window', window },
        `Read compact project window at revision ${window.revision}`)
    }

    if (action === 'raw-media') {
      const inspection = inspectRawMedia(project, {
        assetId: stableId(input.assetId, 'assetId'),
        ...(input.transcriptId === undefined ? {} : {
          transcriptId: stableId(input.transcriptId, 'transcriptId')
        }),
        ...(input.segmentOffset === undefined ? {} : {
          segmentOffset: nonNegativeInteger(input.segmentOffset, 'segmentOffset')
        }),
        ...(input.segmentLimit === undefined ? {} : {
          segmentLimit: boundedPositiveInteger(input.segmentLimit, 'segmentLimit', 1, 100)
        }),
        includeWords: optionalBoolean(input.includeWords, 'includeWords') ?? false,
        ...(input.sampleFrames === undefined ? {} : {
          sampleFrames: boundedArray(input.sampleFrames, 'sampleFrames', 0, 16)
            .map((value, index) => nonNegativeInteger(value, `sampleFrames[${index}]`))
        })
      })
      return result({ outcome: 'raw-media', inspection },
        `Inspected raw media evidence for ${inspection.asset.id}`)
    }

    if (action === 'media-library') {
      const page = mediaLibraryPage(project, {
        ...(input.folderId === undefined ? {} : { folderId: stableId(input.folderId, 'folderId') }),
        ...(input.query === undefined ? {} : { query: boundedString(input.query, 'query', 0, 256) }),
        ...(input.offset === undefined ? {} : { offset: nonNegativeInteger(input.offset, 'offset') }),
        ...(input.limit === undefined ? {} : {
          limit: boundedPositiveInteger(input.limit, 'limit', 1, 100)
        })
      })
      return result({
        outcome: 'media-library',
        projectId,
        revision: project.currentRevision,
        folders: (project.mediaFolders ?? []).slice(0, MAX_MEDIA_FOLDERS),
        foldersTruncated: (project.mediaFolders?.length ?? 0) > MAX_MEDIA_FOLDERS,
        page: {
          ...page,
          assets: page.assets.map(assetProjection)
        }
      }, `Read ${page.assets.length} of ${page.total} media library assets`)
    }

    if (action === 'preview-history') {
      const history = await this.loadPreviewHistory(projectId)
      return result({ outcome: 'preview-history', history: history as unknown as JsonObject },
        `Read ${history.entries.length} bounded preview entries`)
    }

    if (action === 'selection-attachment') {
      if (expectedRevision === undefined) {
        throw new ToolInputError('selection-attachment requires expectedRevision.')
      }
      const history = await this.loadPreviewHistory(projectId)
      const previewEntryIds = input.previewEntryIds === undefined
        ? []
        : boundedArray(input.previewEntryIds, 'previewEntryIds', 0, 64)
          .map((entry, index) => stableId(entry, `previewEntryIds[${index}]`))
      const knownEntries = new Set(history.entries.map(({ id }) => id))
      const missing = previewEntryIds.find((id) => !knownEntries.has(id))
      if (missing) throw new ToolInputError(`Preview history entry does not exist: ${missing}`)
      const attachment = buildVideoSelectionAttachment(project, previewEntryIds)
      return result({ outcome: 'selection-attachment', attachment: attachment as unknown as JsonObject },
        `Read revision-bound selection attachment at revision ${project.currentRevision}`)
    }

    if (action === 'multicam') {
      const groups = (project.multicamGroups ?? []).slice(0, MAX_MULTICAM_GROUPS)
      if (input.groupId === undefined) {
        return result({
          outcome: 'multicam',
          projectId,
          currentRevision: project.currentRevision,
          groups: groups.map(multicamGroupProjection),
          hiddenGroupCount: Math.max(0, (project.multicamGroups?.length ?? 0) - groups.length)
        }, `Read ${groups.length} bounded multicam groups at revision ${project.currentRevision}`)
      }
      const groupId = stableId(input.groupId, 'groupId')
      const group = groups.find(({ id }) => id === groupId) ??
        (project.multicamGroups ?? []).find(({ id }) => id === groupId)
      if (!group) throw new ToolInputError(`Multicam group does not exist: ${groupId}`)
      const program = inspectMulticamProgram(project, groupId)
      let renderReady = false
      let irDigest: string | null = null
      let renderRefusal: string | null = null
      try {
        irDigest = renderIrDigest(compileMulticamProgramIr(project, groupId))
        renderReady = true
      } catch (error) {
        renderRefusal = boundedPublicErrorMessage(error)
      }
      return result({
        outcome: 'multicam',
        projectId,
        currentRevision: project.currentRevision,
        group: multicamGroupProjection(group),
        program: program as unknown as JsonObject,
        renderReady,
        renderIrDigest: irDigest,
        renderRefusal
      }, `Inspected multicam program ${groupId} at revision ${project.currentRevision}`)
    }

    let capabilities: MediaCapabilities
    try {
      capabilities = await this.context.media.getCapabilities()
    } catch {
      return result({
        outcome: 'unavailable',
        code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
        projectId,
        currentRevision: project.currentRevision,
        message: 'Composed inspection requires a current bounded render capability report.'
      }, 'Composed inspection capability report is unavailable')
    }
    const inspection = inspectComposedTimeline(
      project,
      nonNegativeInteger(input.frame, 'frame'),
      ffmpegRenderBackendCapabilities(capabilities),
      await this.proofBindings(projectId),
      sequenceId ?? project.activeSequenceId
    )
    return result({ outcome: 'composed-frame', inspection },
      `Inspected composed frame ${inspection.frameLabel} at revision ${inspection.revision}`, {
        technicallyValidated: false,
        visuallyInspected: false,
        proofStatus: inspection.proofStatus
      })
  }

  private async projectPackagePreflight(
    project: VideoProject,
    input: ToolInput
  ): Promise<ToolResult> {
    const receiptsRequested = optionalBoolean(input.includeReceipts, 'includeReceipts') ?? false
    const chatRequested = optionalBoolean(input.includeChatProvenance, 'includeChatProvenance') ?? false
    const selectedIds = packageAssetIds(project, input.assetIds)
    const missingMediaPolicy = packageMissingPolicy(input.missingMediaPolicy)
    const lastReceipt = this.service().getLastReceipt(project.id)
    const prepared = await prepareProjectPackageArchiveExport({
      context: this.context,
      project,
      includeMedia: [...selectedIds].sort(),
      missingMediaPolicy,
      ...(receiptsRequested && lastReceipt ? { receipts: [lastReceipt] } : {}),
      includeChatProvenance: false
    })
    const plan = prepared.plan
    return result({
      outcome: 'project-package-preflight',
      executable: true,
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      pinnedRevision: project.currentRevision,
      missingMediaPolicy,
      packageId: plan.packageId,
      manifestDigest: plan.manifestDigest,
      selectedAssetCount: plan.selectedAssetCount,
      embeddedAssetCount: plan.embeddedAssetCount,
      uniqueMediaCount: plan.uniqueMediaCount,
      deduplicatedAssetCount: plan.deduplicatedAssetCount,
      knownInputBytes: plan.knownInputBytes,
      complete: plan.complete,
      missingAssetIds: plan.missingAssetIds.slice(0, PACKAGE_PREFLIGHT_ASSET_PREVIEW_LIMIT),
      missingAssetIdsTruncated: Math.max(
        0,
        plan.missingAssetIds.length - PACKAGE_PREFLIGHT_ASSET_PREVIEW_LIMIT
      ),
      provenance: {
        receiptsRequested,
        receiptCount: plan.manifest.provenance.receiptCount,
        chatRequested,
        chatScope: chatRequested
          ? 'available only from an authenticated Agent tool invocation'
          : 'not-requested',
        generationLineageEntries: plan.manifest.provenance.generationLineageCount,
        revisionLedgerEntries: plan.manifest.provenance.revisionCount
      },
      engine: {
        schemaVersion: 1,
        selfContainedBuilderAvailable: true,
        cancellationAndRestartModelAvailable: true,
        integrityAlgorithm: 'sha256',
        binaryReader: 'opaque-host-handle',
        outputSink: 'atomic-durable-media-archive-job'
      },
      limits: {
        mediaAssets: PROJECT_PACKAGE_LIMITS.mediaAssets,
        mediaObjectBytes: PROJECT_PACKAGE_LIMITS.mediaObjectBytes,
        totalMediaBytes: PROJECT_PACKAGE_LIMITS.totalMediaBytes,
        packageBytes: PROJECT_PACKAGE_LIMITS.packageBytes
      },
      blockedCapabilities: [],
      message: 'The package plan is ready for a user-approved ZIP target. Binary media remains path-opaque and will be streamed by the durable Host archive executor.'
    }, `Prepared an executable project-package plan with ${plan.uniqueMediaCount} unique media objects`)
  }

  private async videoProjectPackage(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    const action = enumValue(input.action, ['preflight', 'export', 'status', 'cancel'] as const, 'action')
    if (action === 'status' || action === 'cancel') {
      exactKeys(input, ['action', 'projectId', 'jobId'])
      const projectId = stableId(input.projectId, 'projectId')
      const jobId = boundedString(input.jobId, 'jobId', 1, 256)
      const record = await this.loadProjectPackageRecord(jobId)
      if (!record || record.projectId !== projectId) {
        throw new ToolInputError('The durable job is not a tracked project package for this project.')
      }
      if (action === 'cancel') {
        const cancelled = await this.context.jobs.cancel({ jobId })
        return result({
          outcome: cancelled.accepted ? 'cancellation-requested' : 'not-cancelled',
          accepted: cancelled.accepted,
          job: projectPackageJobProjection(cancelled.snapshot, record)
        }, cancelled.accepted
          ? `Requested cancellation for project package ${jobId}`
          : `Project package ${jobId} is already terminal`)
      }
      const snapshot = await this.context.jobs.get(jobId)
      this.assertOwnedProjectPackageSnapshot(snapshot)
      return result({
        outcome: 'status',
        job: projectPackageJobProjection(snapshot, record)
      }, `Project package ${jobId} is ${snapshot.state}`)
    }

    exactKeys(input, [
      'action', 'projectId', 'expectedRevision', 'assetIds', 'missingMediaPolicy',
      'includeReceipts', 'includeChatProvenance', 'outputHandleId'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const selectedIds = packageAssetIds(project, input.assetIds)
    const missingMediaPolicy = packageMissingPolicy(input.missingMediaPolicy)
    const includeReceipts = optionalBoolean(input.includeReceipts, 'includeReceipts') ?? true
    const includeChatProvenance = optionalBoolean(
      input.includeChatProvenance,
      'includeChatProvenance'
    ) ?? true
    const lastReceipt = this.service().getLastReceipt(project.id)
    const prepared = await prepareProjectPackageArchiveExport({
      context: this.context,
      project,
      includeMedia: [...selectedIds].sort(),
      missingMediaPolicy,
      ...(includeReceipts && lastReceipt ? { receipts: [lastReceipt] } : {}),
      includeChatProvenance,
      invocation
    })
    const plan = prepared.plan
    if (action === 'preflight') {
      return result({
        outcome: 'preflight',
        projectId,
        pinnedRevision: expectedRevision,
        packageId: plan.packageId,
        manifestDigest: plan.manifestDigest,
        complete: plan.complete,
        selectedAssetCount: plan.selectedAssetCount,
        embeddedAssetCount: plan.embeddedAssetCount,
        uniqueMediaCount: plan.uniqueMediaCount,
        deduplicatedAssetCount: plan.deduplicatedAssetCount,
        missingAssetIds: plan.missingAssetIds,
        missingMediaPolicy,
        provenance: plan.manifest.provenance,
        executable: true
      }, `Prepared project package ${plan.packageId} at revision ${expectedRevision}`)
    }

    let ownsOutputHandle = false
    let outputHandleId: string
    if (input.outputHandleId === undefined) {
      const selected = await this.context.media.pickSaveTarget({
        suggestedName: `${safeProjectPackageName(project.name)}.kun-video.zip`,
        filters: [{
          name: 'Kun Video Project Package',
          extensions: ['zip'],
          mimeTypes: ['application/zip']
        }]
      })
      if (selected.outcome === 'cancelled') {
        return result({ outcome: 'cancelled', projectId, pinnedRevision: expectedRevision },
          'Project package target selection was cancelled')
      }
      outputHandleId = selected.target.handleId
      ownsOutputHandle = true
    } else {
      outputHandleId = opaqueHandle(input.outputHandleId, 'outputHandleId')
    }
    let started = false
    try {
      assertNotCancelled(invocation)
      await invocation.reportProgress({ message: 'Submitting durable project package job', fraction: 0.5 })
      const job = await startProjectPackageArchiveExport({
        context: this.context,
        plan,
        outputHandleId
      })
      started = true
      const record: ProjectPackageExportRecord = {
        schemaVersion: 1,
        jobId: job.jobId,
        projectId,
        sequenceId: project.activeSequenceId,
        pinnedRevision: expectedRevision,
        packageId: plan.packageId,
        manifestDigest: plan.manifestDigest,
        complete: plan.complete,
        selectedAssetCount: plan.selectedAssetCount,
        embeddedAssetCount: plan.embeddedAssetCount,
        uniqueMediaCount: plan.uniqueMediaCount,
        deduplicatedAssetCount: plan.deduplicatedAssetCount,
        missingAssetIds: plan.missingAssetIds,
        missingMediaPolicy,
        createdAt: new Date().toISOString()
      }
      try {
        await this.context.storage.workspace.set(projectPackageKey(job.jobId), record)
      } catch {
        const confirmed = await this.loadProjectPackageRecord(job.jobId)
        if (!confirmed || confirmed.manifestDigest !== record.manifestDigest) {
          await this.context.jobs.cancel({ jobId: job.jobId }).catch(() => undefined)
          throw new ExtensionApiError({
            code: 'INTERNAL_ERROR',
            message: `Project package tracking could not be persisted for ${job.jobId}; cancellation was requested.`,
            operation: 'video-project-package',
            retryable: false,
            details: { jobId: job.jobId, cancellationAttempted: true }
          })
        }
      }
      await invocation.reportProgress({ message: 'Durable project package queued', fraction: 1 })
      return result({
        outcome: 'queued',
        job: projectPackageJobProjection({
          schemaVersion: 1,
          id: job.jobId,
          kind: job.kind,
          kindSchemaVersion: 1,
          ownerExtensionId: this.context.extension.id,
          ownerExtensionVersion: this.context.extension.version,
          workspaceId: this.workspaceId(),
          initiatingOperation: 'media.startArchiveJob',
          state: job.state,
          executionAttempt: 0,
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
          latestCursor: job.cursor
        }, record)
      }, `Queued atomic project package ${plan.packageId}`)
    } finally {
      if (!started && ownsOutputHandle) {
        await this.context.media.release({ resource: 'handle', handleId: outputHandleId })
          .catch(() => undefined)
      }
    }
  }

  private async videoInterchange(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    const action = enumValue(input.action, ['export', 'status', 'cancel'] as const, 'action')
    if (action === 'status' || action === 'cancel') {
      exactKeys(input, ['action', 'projectId', 'jobId', 'reason'])
      const projectId = stableId(input.projectId, 'projectId')
      const jobId = boundedString(input.jobId, 'jobId', 8, 512)
      const record = await this.loadOtioExportRecord(jobId)
      if (!record || record.projectId !== projectId) {
        throw new ToolInputError('The durable job is not a tracked OTIO export for this project.')
      }
      const snapshot = action === 'cancel'
        ? (await this.context.jobs.cancel({
            jobId,
            ...(input.reason === undefined
              ? {}
              : { reason: boundedString(input.reason, 'reason', 1, 512) })
          })).snapshot
        : await this.context.jobs.get(jobId)
      return await this.otioExportStatusResult(snapshot, record)
    }

    exactKeys(input, ['action', 'projectId', 'expectedRevision', 'outputHandleId'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const prepared = prepareOtioInterchangeExport(project)
    let ownsOutputHandle = false
    let outputHandleId: string
    if (input.outputHandleId === undefined) {
      const selected = await this.context.media.pickSaveTarget({
        suggestedName: `${safeInterchangeName(project.name)}-revision-${expectedRevision}.otio`,
        filters: [{
          name: 'OpenTimelineIO JSON',
          extensions: ['otio'],
          mimeTypes: [OTIO_OUTPUT_MIME_TYPE]
        }]
      })
      if (selected.outcome === 'cancelled') {
        return result({ outcome: 'cancelled', projectId, pinnedRevision: expectedRevision },
          'OTIO export target selection was cancelled')
      }
      outputHandleId = selected.target.handleId
      ownsOutputHandle = true
    } else {
      outputHandleId = opaqueHandle(input.outputHandleId, 'outputHandleId')
    }
    let started = false
    try {
      assertNotCancelled(invocation)
      await invocation.reportProgress({ message: 'Submitting durable OTIO interchange job', fraction: 0.5 })
      const job = await startOtioInterchangeExport({
        context: this.context,
        prepared,
        outputHandleId
      })
      started = true
      const exported = prepared.exported
      const record: OtioExportRecord = {
        schemaVersion: 1,
        jobId: job.jobId,
        projectId,
        sequenceId: project.activeSequenceId,
        pinnedRevision: expectedRevision,
        adapterId: exported.adapterId,
        adapterVersion: exported.adapterVersion,
        documentDigest: exported.documentDigest,
        projectDigest: exported.projectDigest,
        documentBytes: prepared.byteLength,
        lossManifest: exported.lossManifest,
        createdAt: new Date().toISOString()
      }
      try {
        await this.context.storage.workspace.set(otioExportKey(job.jobId), record as unknown as JsonValue)
      } catch {
        const confirmed = await this.loadOtioExportRecord(job.jobId)
        if (!confirmed || confirmed.documentDigest !== record.documentDigest) {
          await this.context.jobs.cancel({ jobId: job.jobId }).catch(() => undefined)
          throw new ExtensionApiError({
            code: 'INTERNAL_ERROR',
            message: `OTIO tracking could not be persisted for ${job.jobId}; cancellation was requested.`,
            operation: 'video-interchange',
            retryable: false,
            details: { jobId: job.jobId, cancellationAttempted: true }
          })
        }
      }
      await invocation.reportProgress({ message: 'Durable OTIO interchange queued', fraction: 1 })
      return result({
        outcome: 'queued',
        job: otioExportJobProjection({
          schemaVersion: 1,
          id: job.jobId,
          kind: job.kind,
          kindSchemaVersion: 1,
          ownerExtensionId: this.context.extension.id,
          ownerExtensionVersion: this.context.extension.version,
          workspaceId: this.workspaceId(),
          initiatingOperation: 'media.startFfmpegJob',
          state: job.state,
          executionAttempt: 0,
          createdAt: record.createdAt,
          updatedAt: record.createdAt,
          latestCursor: job.cursor
        }, record, expectedRevision)
      }, `Queued revision ${expectedRevision} OTIO interchange export`)
    } finally {
      if (!started && ownsOutputHandle) {
        await this.context.media.release({ resource: 'handle', handleId: outputHandleId })
          .catch(() => undefined)
      }
    }
  }

  private async videoInterchangeImport(
    input: ToolInput,
    persist: boolean
  ): Promise<ToolResult> {
    exactKeys(input, persist
      ? [
          'inputHandleId', 'expectedDocumentDigest', 'expectedSourceProjectId',
          'expectedSourceRevision', 'targetProjectId'
        ]
      : ['inputHandleId'])
    const inputHandleId = opaqueHandle(input.inputHandleId, 'inputHandleId')
    const selected = await this.context.media.readText({
      handleId: inputHandleId,
      maxBytes: MAX_MEDIA_OTIO_TEXT_BYTES
    })
    if (![
      OTIO_OUTPUT_MIME_TYPE,
      'application/json',
      'application/octet-stream'
    ].includes(selected.mimeType)) {
      throw new ToolInputError('Selected interchange document is not OTIO JSON.')
    }
    const imported = importProjectFromOtio(selected.content)
    const mappings = interchangeMappingPreview(imported.timecodeMappings)
    if (!persist) {
      const existingProjectIds = new Set(
        (await this.service().listProjects()).map(({ id }) => id)
      )
      return result({
        outcome: 'interchange-import-preview',
        inputHandleId,
        displayName: safeInterchangeDisplayName(selected.displayName),
        adapterId: imported.adapterId,
        adapterVersion: imported.adapterVersion,
        sourceDocumentDigest: imported.sourceDocumentDigest,
        sourceProjectId: imported.project.id,
        sourceProjectRevision: imported.project.currentRevision,
        suggestedProjectId: suggestedImportProjectId(imported.project.id, existingProjectIds),
        fidelity: imported.fidelity,
        project: interchangeProjectSummary(imported.project),
        mediaRelinkRequired: imported.mediaRelinkRequired,
        timecodeMappings: mappings.items as unknown as JsonValue,
        timecodeMappingsTruncated: mappings.truncated,
        lossManifest: imported.lossManifest as unknown as JsonValue,
        persisted: false,
        confirmationRequired: true
      }, `Previewed OTIO import ${imported.sourceDocumentDigest.slice(0, 12)} without persisting it`)
    }
    const expectedDocumentDigest = sha256Digest(input.expectedDocumentDigest, 'expectedDocumentDigest')
    const expectedSourceProjectId = stableId(input.expectedSourceProjectId, 'expectedSourceProjectId')
    const expectedSourceRevision = nonNegativeInteger(
      input.expectedSourceRevision,
      'expectedSourceRevision'
    )
    const targetProjectId = stableId(input.targetProjectId, 'targetProjectId')
    if (
      imported.sourceDocumentDigest !== expectedDocumentDigest ||
      imported.project.id !== expectedSourceProjectId ||
      imported.project.currentRevision !== expectedSourceRevision
    ) {
      throw new ToolInputError(
        'The OTIO document changed after preview; preview it again before importing.'
      )
    }
    const project = await this.service().importProject({
      project: imported.project,
      targetProjectId,
      expectedSourceProjectId,
      expectedSourceRevision,
      sourceDocumentDigest: expectedDocumentDigest
    })
    await this.selectActiveProject(project, 'selected', 'manual')
    await this.publishProjectChange(project, 'interchange-imported', ['project', ...project.sequences.map(({ id }) => id)])
    return result({
      outcome: 'interchange-imported',
      sourceDocumentDigest: expectedDocumentDigest,
      sourceProjectId: expectedSourceProjectId,
      sourceProjectRevision: expectedSourceRevision,
      project: await this.projectViewProjection(project),
      mediaRelinkRequired: imported.mediaRelinkRequired,
      lossManifest: imported.lossManifest as unknown as JsonValue,
      persisted: true,
      overwritten: false
    }, `Imported OTIO as new project ${targetProjectId}; existing projects were not overwritten`)
  }

  private async otioExportStatusResult(
    snapshot: JobSnapshot,
    record: OtioExportRecord
  ): Promise<ToolResult> {
    this.assertOwnedOtioExportSnapshot(snapshot)
    const currentRevision = await this.currentRevision(record.projectId)
    const artifacts = validOtioArtifacts(snapshot, record)
    const valid = snapshot.state === 'completed' && artifacts.length === 1
    const content: JsonObject = {
      outcome: snapshot.state === 'completed' && !valid ? 'invalid-output' : snapshot.state,
      job: otioExportJobProjection(snapshot, record, currentRevision),
      technicallyValidated: valid,
      visualInspection: 'not-applicable',
      artifacts
    }
    return {
      content,
      summary: snapshot.state === 'completed'
        ? valid
          ? `OTIO export ${snapshot.id} completed with a validated document artifact`
          : `OTIO export ${snapshot.id} completed but its document artifact is invalid`
        : `OTIO export ${snapshot.id} is ${snapshot.state}`,
      metadata: { machineValidatedOnly: valid, visuallyInspected: false },
      ...(valid ? { generatedArtifacts: artifacts } : {})
    }
  }

  private async videoUpdateContext(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'expectedGeneration', 'sequenceId', 'playheadFrame',
      'selectedAssetIds', 'selectedItemIds', 'selectedCaptionIds', 'selectedWordIds', 'range'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const patch: ProjectSelectionPatch = {
      ...(input.sequenceId === undefined ? {} : { sequenceId: stableId(input.sequenceId, 'sequenceId') }),
      ...(input.playheadFrame === undefined ? {} : {
        playheadFrame: nonNegativeInteger(input.playheadFrame, 'playheadFrame')
      }),
      ...(input.selectedAssetIds === undefined ? {} : {
        selectedAssetIds: stableIdArray(input.selectedAssetIds, 'selectedAssetIds')
      }),
      ...(input.selectedItemIds === undefined ? {} : {
        selectedItemIds: stableIdArray(input.selectedItemIds, 'selectedItemIds')
      }),
      ...(input.selectedCaptionIds === undefined ? {} : {
        selectedCaptionIds: stableIdArray(input.selectedCaptionIds, 'selectedCaptionIds')
      }),
      ...(input.selectedWordIds === undefined ? {} : {
        selectedWordIds: stableIdArray(input.selectedWordIds, 'selectedWordIds')
      }),
      ...(input.range === undefined ? {} : { range: selectionRange(input.range) })
    }
    const updated = await this.service().updateSelection(
      projectId,
      nonNegativeInteger(input.expectedRevision, 'expectedRevision'),
      nonNegativeInteger(input.expectedGeneration, 'expectedGeneration'),
      patch
    )
    await this.publishSelectionChange(updated)
    return result({ outcome: 'context-updated', ...updated },
      `Updated video selection generation ${updated.generation}`)
  }

  private async videoSelectionAttachment(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'previewEntryIds'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const history = await this.loadPreviewHistory(projectId)
    const previewEntryIds = input.previewEntryIds === undefined
      ? []
      : boundedArray(input.previewEntryIds, 'previewEntryIds', 0, 64)
        .map((entry, index) => stableId(entry, `previewEntryIds[${index}]`))
    const knownEntries = new Set(history.entries.map(({ id }) => id))
    const missing = previewEntryIds.find((id) => !knownEntries.has(id))
    if (missing) throw new ToolInputError(`Preview history entry does not exist: ${missing}`)
    const attachment = buildVideoSelectionAttachment(project, previewEntryIds)
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.selection-attached',
      payload: attachment as unknown as JsonValue
    })
    return result({
      outcome: 'selection-attached',
      attachment: attachment as unknown as JsonObject
    }, `Built revision-bound video selection context for revision ${project.currentRevision}`)
  }

  private async videoDecomposeSequence(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'itemId'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const itemId = stableId(input.itemId, 'itemId')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const outer = project.items.find(({ id }) => id === itemId)
    if (!outer?.nestedSequenceId) throw new ToolInputError(`Timeline item is not a nested sequence: ${itemId}`)
    const nested = project.sequences.find(({ id }) => id === outer.nestedSequenceId)
    if (!nested) throw new ToolInputError(`Nested sequence does not exist: ${outer.nestedSequenceId}`)
    const parent = project.sequences.find(({ id }) => id === project.activeSequenceId)
    if (!parent) throw new ToolInputError(`Active sequence does not exist: ${project.activeSequenceId}`)
    const trackMap: Record<string, string> = {}
    for (const childTrack of nested.tracks) {
      const target = parent.tracks.find((track) => track.id === childTrack.id && track.kind === childTrack.kind) ??
        (childTrack.kind === 'video'
          ? parent.tracks.find(({ id, kind }) => id === outer.trackId && kind === 'video')
          : undefined) ??
        parent.tracks.find(({ kind }) => kind === childTrack.kind)
      if (!target) {
        throw new ToolInputError(`No ${childTrack.kind} track is available to decompose ${childTrack.id}.`)
      }
      trackMap[childTrack.id] = target.id
    }
    const plan = planDecomposeNestedSequence(project, {
      parentSequenceId: parent.id,
      itemId,
      trackMap
    })
    const committed = await this.service().applyOperationsWithReceipt(
      projectId,
      expectedRevision,
      plan.operations,
      {
        author: 'manual',
        sourceOperation: 'sequence.decompose',
        summary: `Decomposed nested sequence ${plan.nestedSequenceId}`
      }
    )
    await this.publishProjectChange(committed.project, 'sequence-decomposed', committed.receipt)
    return result({
      outcome: 'sequence-decomposed',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      receipt: committed.receipt as unknown as JsonObject,
      nestedSequenceId: plan.nestedSequenceId,
      operationCount: plan.operations.length,
      warnings: plan.warnings
    }, `Decomposed ${itemId} at revision ${committed.project.currentRevision}`)
  }

  private async videoMediaLibraryMutation(
    input: ToolInput,
    action: 'media.folder.create' | 'media.folder.update' | 'media.folder.delete' | 'media.organize'
  ): Promise<ToolResult> {
    const commonKeys = ['projectId', 'expectedRevision'] as const
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    let candidate: VideoProject
    let summary: string
    if (action === 'media.folder.create') {
      exactKeys(input, [...commonKeys, 'folderId', 'name', 'parentId'])
      const folderId = stableId(input.folderId, 'folderId')
      candidate = createMediaFolder(project, {
        id: folderId,
        name: boundedString(input.name, 'name', 1, 160),
        ...(input.parentId === undefined ? {} : { parentId: stableId(input.parentId, 'parentId') })
      }).project
      summary = `Created media folder ${folderId}`
    } else if (action === 'media.folder.update') {
      exactKeys(input, [...commonKeys, 'folderId', 'name', 'parentId'])
      const folderId = stableId(input.folderId, 'folderId')
      if (input.name === undefined && input.parentId === undefined) {
        throw new ToolInputError('Media folder update requires name or parentId.')
      }
      candidate = updateMediaFolder(project, folderId, {
        ...(input.name === undefined ? {} : { name: boundedString(input.name, 'name', 1, 160) }),
        ...(input.parentId === undefined
          ? {}
          : { parentId: input.parentId === null ? null : stableId(input.parentId, 'parentId') })
      }).project
      summary = `Updated media folder ${folderId}`
    } else if (action === 'media.folder.delete') {
      exactKeys(input, [...commonKeys, 'folderId', 'moveContentsToFolderId'])
      const folderId = stableId(input.folderId, 'folderId')
      const moveContentsToFolderId = input.moveContentsToFolderId === undefined || input.moveContentsToFolderId === null
        ? undefined
        : stableId(input.moveContentsToFolderId, 'moveContentsToFolderId')
      candidate = deleteMediaFolder(project, folderId, moveContentsToFolderId).project
      summary = `Deleted media folder ${folderId}`
    } else {
      exactKeys(input, [...commonKeys, 'assetIds', 'folderId'])
      const assetIds = boundedArray(input.assetIds, 'assetIds', 1, 64)
        .map((entry, index) => stableId(entry, `assetIds[${index}]`))
      const folderId = input.folderId === undefined || input.folderId === null
        ? undefined
        : stableId(input.folderId, 'folderId')
      candidate = organizeMediaAssets(project, assetIds, folderId).project
      summary = `Organized ${assetIds.length} media assets`
    }
    const committed = await this.service().saveProjectWithReceipt(candidate, expectedRevision, {
      author: 'manual',
      sourceOperation: action,
      summary
    })
    await this.publishProjectChange(committed.project, 'media-library-updated', committed.receipt)
    return result({
      outcome: action,
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      receipt: committed.receipt as unknown as JsonObject,
      mediaFolders: (committed.project.mediaFolders ?? []).slice(0, MAX_MEDIA_FOLDERS),
      assets: committed.project.assets.slice(0, MAX_ASSETS).map(assetProjection),
      truncated: (committed.project.mediaFolders?.length ?? 0) > MAX_MEDIA_FOLDERS ||
        committed.project.assets.length > MAX_ASSETS
    }, `${summary} at revision ${committed.project.currentRevision}`)
  }

  private async videoPreview(
    input: ToolInput,
    action: 'preview.list' | 'preview.add' | 'preview.select' | 'preview.compare' | 'preview.replace'
  ): Promise<ToolResult> {
    const projectId = stableId(input.projectId, 'projectId')
    const project = await this.service().loadProject(projectId)
    let history = await this.loadPreviewHistory(projectId)
    if (action === 'preview.list') {
      exactKeys(input, ['projectId'])
      return result({
        outcome: 'preview-list',
        history: history as unknown as JsonObject,
        comparison: null
      }, `Listed ${history.entries.length} bounded preview entries`)
    }

    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    assertExpectedRevision(project, expectedRevision)
    if (action === 'preview.add') {
      exactKeys(input, ['projectId', 'expectedRevision', 'entryId', 'label', 'source'])
      const source = previewSource(input.source)
      assertPreviewSource(project, source)
      const label = boundedString(input.label, 'label', 1, 160)
      const entry: PreviewHistoryEntry = {
        id: input.entryId === undefined
          ? previewEntryId(project, history, source, label)
          : stableId(input.entryId, 'entryId'),
        projectId,
        createdAt: new Date().toISOString(),
        label,
        source
      }
      history = appendPreviewHistory(history, entry)
      await this.savePreviewHistory(projectId, history)
      await this.publishPreviewHistory(history)
      return result({ outcome: 'preview-added', history: history as unknown as JsonObject },
        `Added preview ${entry.id}`)
    }
    if (action === 'preview.select') {
      exactKeys(input, ['projectId', 'expectedRevision', 'entryId'])
      history = selectPreviewHistory(history, stableId(input.entryId, 'entryId'))
      await this.savePreviewHistory(projectId, history)
      await this.publishPreviewHistory(history)
      return result({ outcome: 'preview-selected', history: history as unknown as JsonObject },
        `Selected preview ${history.activeEntryId ?? ''}`)
    }
    if (action === 'preview.compare') {
      exactKeys(input, ['projectId', 'expectedRevision', 'leftEntryId', 'rightEntryId', 'mode'])
      const comparison = comparePreviewHistory(
        history,
        stableId(input.leftEntryId, 'leftEntryId'),
        stableId(input.rightEntryId, 'rightEntryId'),
        enumValue(input.mode, ['wipe', 'side-by-side'] as const, 'mode')
      )
      return result({
        outcome: 'preview-comparison',
        history: history as unknown as JsonObject,
        comparison: comparison as unknown as JsonObject
      }, 'Compared two bounded preview sources')
    }

    exactKeys(input, ['projectId', 'expectedRevision', 'itemId', 'entryId'])
    const entryId = stableId(input.entryId, 'entryId')
    const entry = history.entries.find(({ id }) => id === entryId)
    if (!entry) throw new ToolInputError(`Preview history entry does not exist: ${entryId}`)
    if (entry.source.kind === 'timeline') {
      throw new ToolInputError('A timeline proof cannot replace a source clip; select an asset or generated preview.')
    }
    const operations = planReplaceTimelineItemFromPreview(project, {
      itemId: stableId(input.itemId, 'itemId'),
      preview: entry.source
    })
    const committed = await this.service().applyOperationsWithReceipt(projectId, expectedRevision, operations, {
      author: 'manual',
      sourceOperation: 'preview.replace',
      summary: `Replaced a timeline item from preview ${entry.id}`
    })
    await this.publishProjectChange(committed.project, 'preview-replaced', committed.receipt)
    return result({
      outcome: 'preview-replaced',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      receipt: committed.receipt as unknown as JsonObject,
      history: history as unknown as JsonObject
    }, `Replaced timeline media at revision ${committed.project.currentRevision}`)
  }

  private async loadPreviewHistory(projectId: string): Promise<PreviewHistory> {
    const value = await this.context.storage.workspace.get<JsonValue>(`${PREVIEW_HISTORY_PREFIX}${projectId}`)
    if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
      return emptyPreviewHistory()
    }
    try {
      const history = structuredClone(value) as PreviewHistory
      validateHistory(history)
      if (history.entries.some((entry) => entry.projectId !== projectId)) return emptyPreviewHistory()
      return history
    } catch {
      return emptyPreviewHistory()
    }
  }

  private async savePreviewHistory(projectId: string, history: PreviewHistory): Promise<void> {
    validateHistory(history)
    if (history.entries.some((entry) => entry.projectId !== projectId)) {
      throw new ToolInputError('Preview history cannot cross project boundaries.')
    }
    await this.context.storage.workspace.set(
      `${PREVIEW_HISTORY_PREFIX}${projectId}`,
      history as unknown as JsonValue
    )
  }

  private async publishPreviewHistory(history: PreviewHistory): Promise<void> {
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.preview-history-changed',
      payload: {
        schemaVersion: 1,
        generation: history.generation,
        activeEntryId: history.activeEntryId ?? null,
        entryCount: history.entries.length
      }
    })
  }

  private async projectViewProjection(project: VideoProject): Promise<JsonObject> {
    return projectProjection(project, await this.loadPreviewHistory(project.id))
  }

  private async videoUndo(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const committed = await this.service().undoAgent(
      projectId,
      expectedRevision,
      agentActorId(invocation)
    )
    await this.publishProjectChange(committed.project, 'agent-undo', committed.receipt)
    return mutationResult('undone', committed.receipt, committed.project,
      `Undid the Agent's eligible video edit at revision ${committed.project.currentRevision}`)
  }

  private async videoProject(
    input: ToolInput,
    source: RevisionAuthor = 'agent'
  ): Promise<ToolResult> {
    exactKeys(input, ['action', 'projectId', 'name', 'fps', 'canvasPreset', 'expectedRevision'])
    const action = enumValue(
      input.action,
      ['active', 'list', 'get', 'create', 'select'] as const,
      'action'
    )
    const service = this.service()
    if (action === 'active') return this.activeProject(service)
    if (action === 'list') {
      const listed = await service.listProjectsWithDiagnostics()
      const projects = listed.projects
      const bounded = projects.slice(0, MAX_PROJECTS)
      return result({
        outcome: 'listed',
        workspaceId: this.workspaceId(),
        projects: bounded,
        diagnostics: listed.diagnostics.slice(0, MAX_PROJECTS),
        truncated: projects.length > bounded.length
      }, `Listed ${bounded.length} video projects`)
    }

    const projectId = stableId(input.projectId, 'projectId')
    if (action === 'create') {
      const name = boundedString(input.name, 'name', 1, 160)
      const fps = input.fps === undefined ? undefined : rational(input.fps, 'fps')
      const canvasPreset = input.canvasPreset === undefined
        ? undefined
        : enumValue(input.canvasPreset, ['16:9', '9:16', '1:1'] as const, 'canvasPreset')
      const project = await service.createProject({ id: projectId, name, fps, canvasPreset })
      await this.selectActiveProject(project, 'created', source)
      await this.publishProjectChange(project, 'project-created', ['project'])
      return result({
        outcome: 'created',
        workspaceId: this.workspaceId(),
        project: await this.projectViewProjection(project),
        truncated: projectProjectionIsTruncated(project)
      }, `Created video project ${project.id}`)
    }

    const project = await service.loadProject(projectId)
    if (input.expectedRevision !== undefined) {
      assertExpectedRevision(project, nonNegativeInteger(input.expectedRevision, 'expectedRevision'))
    }
    if (action === 'select') {
      await this.selectActiveProject(project, 'selected', source)
    }
    return result({
      outcome: action === 'select' ? 'selected' : 'loaded',
      workspaceId: this.workspaceId(),
      project: await this.projectViewProjection(project),
      truncated: projectProjectionIsTruncated(project)
    }, `${action === 'select' ? 'Selected' : 'Loaded'} video project ${project.id} revision ${project.currentRevision}`)
  }

  private async activeProject(service: ProjectService): Promise<ToolResult> {
    const value = await this.context.storage.workspace.get<JsonValue>(ACTIVE_PROJECT_KEY)
    if (value === undefined) {
      return result({
        outcome: 'no-active-project',
        workspaceId: this.workspaceId()
      }, 'No video project is active in this workspace')
    }

    const stored = value !== null && typeof value === 'object' && !Array.isArray(value)
      ? value as ToolInput
      : undefined
    let projectId: string | undefined
    try {
      if (stored?.schemaVersion === 1) projectId = stableId(stored.projectId, 'active projectId')
    } catch {
      projectId = undefined
    }
    if (!projectId) {
      await this.context.storage.workspace.delete(ACTIVE_PROJECT_KEY)
      return result({
        outcome: 'stale-active-project',
        workspaceId: this.workspaceId()
      }, 'The stored active video project was invalid and has been cleared')
    }

    let project: VideoProject
    try {
      project = await service.loadProject(projectId)
    } catch (error) {
      await this.context.storage.workspace.delete(ACTIVE_PROJECT_KEY)
      return result({
        outcome: 'stale-active-project',
        workspaceId: this.workspaceId(),
        projectId,
        diagnosticCode: error instanceof VideoEngineError ? error.code : 'invalid_project'
      }, `The active video project ${projectId} is unavailable and was cleared`)
    }

    return result({
      outcome: 'active',
      workspaceId: this.workspaceId(),
      project: await this.projectViewProjection(project),
      truncated: projectProjectionIsTruncated(project)
    }, `Resolved active video project ${project.id} revision ${project.currentRevision}`)
  }

  private async selectActiveProject(
    project: VideoProject,
    transition: 'created' | 'selected',
    source: RevisionAuthor
  ): Promise<void> {
    const previousProjectId = await this.storedActiveProjectId()
    await this.context.storage.workspace.set(ACTIVE_PROJECT_KEY, {
      schemaVersion: 1,
      projectId: project.id
    })
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.project-changed',
      payload: {
        schemaVersion: 1,
        projectId: project.id,
        activeProjectId: project.id,
        previousProjectId: previousProjectId ?? null,
        revision: project.currentRevision,
        generation: project.eventGeneration,
        sequenceId: project.activeSequenceId,
        selectionGeneration: project.selection.generation,
        reason: 'active-project-changed',
        transition,
        source,
        changedIds: ['active-project']
      }
    })
  }

  private async storedActiveProjectId(): Promise<string | undefined> {
    const value = await this.context.storage.workspace.get<JsonValue>(ACTIVE_PROJECT_KEY)
    if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
    const stored = value as ToolInput
    if (stored.schemaVersion !== 1) return undefined
    try {
      return stableId(stored.projectId, 'active projectId')
    } catch {
      return undefined
    }
  }

  private async videoReadScript(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision'])
    const project = await this.service().loadProject(stableId(input.projectId, 'projectId'))
    if (input.expectedRevision !== undefined) {
      assertExpectedRevision(project, nonNegativeInteger(input.expectedRevision, 'expectedRevision'))
    }
    const markdown = generateTimelineMarkdown(project)
    const header = parseTimelineScriptHeader(markdown)
    const bytes = Buffer.byteLength(markdown, 'utf8')
    const bounded = bytes <= MAX_SCRIPT_BYTES
      ? markdown
      : `${Buffer.from(markdown, 'utf8').subarray(0, MAX_SCRIPT_BYTES).toString('utf8')}\n\n[projection truncated]\n`
    return result({
      outcome: 'script',
      projectId: project.id,
      currentRevision: project.currentRevision,
      digest: header.digest,
      timelineMarkdown: bounded,
      truncated: bytes > MAX_SCRIPT_BYTES,
      totalBytes: bytes
    }, `Read timeline.md for revision ${project.currentRevision}`)
  }

  private async videoProbeBatch(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'items', 'folderId', 'addToTimeline'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const current = await this.service().loadProject(projectId)
    assertExpectedRevision(current, expectedRevision)
    const folderId = input.folderId === undefined ? undefined : stableId(input.folderId, 'folderId')
    const addToTimeline = optionalBoolean(input.addToTimeline, 'addToTimeline') ?? true
    const requests = boundedArray(input.items, 'items', 1, 64).map((value, index) => {
      const item = asRecord(value, `items[${index}]`)
      exactKeys(item, ['mediaHandleId', 'assetId', 'assetKind', 'stillDurationFrames'])
      return {
        mediaHandleId: opaqueHandle(item.mediaHandleId, `items[${index}].mediaHandleId`),
        ...(item.assetId === undefined ? {} : { assetId: stableId(item.assetId, `items[${index}].assetId`) }),
        ...(item.assetKind === undefined ? {} : {
          assetKind: enumValue(item.assetKind, ['image', 'animation'] as const, `items[${index}].assetKind`)
        }),
        ...(item.stillDurationFrames === undefined ? {} : {
          stillDurationFrames: boundedPositiveInteger(
            item.stillDurationFrames,
            `items[${index}].stillDurationFrames`,
            1,
            1_080_000
          )
        })
      }
    })

    let capabilities: MediaCapabilities
    try {
      capabilities = await this.context.media.getCapabilities()
    } catch {
      return result({
        outcome: 'unavailable',
        code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
        projectId,
        currentRevision: expectedRevision,
        changedIds: [],
        retryable: true,
        message: 'Kun could not inspect local ffprobe availability. No selected media was bound to the project.'
      }, 'Media capability inspection unavailable for atomic batch import')
    }
    if (!capabilities.ffprobe.available) {
      return result({
        outcome: 'unavailable',
        code: 'FFPROBE_UNAVAILABLE',
        projectId,
        currentRevision: expectedRevision,
        changedIds: [],
        retryable: true,
        message: 'Kun cannot import the selected media because ffprobe is unavailable. No selected media was bound to the project.'
      }, 'ffprobe is unavailable for atomic batch import')
    }

    assertNotCancelled(invocation)
    await invocation.reportProgress({ message: 'Probing Host-granted media', fraction: 0.1 })
    const assets = await Promise.all(requests.map(async (request, index) => {
      const metadata = await this.context.media.stat({ handleId: request.mediaHandleId })
      const probe = await this.context.media.probe({ handleId: request.mediaHandleId })
      const assetId = request.assetId ??
        `asset-${createHash('sha256').update(metadata.handleId).digest('hex').slice(0, 16)}`
      const asset = assetFromProbe(assetId, metadata, probe, {
        ...(request.assetKind ? { assetKind: request.assetKind } : {}),
        ...(request.stillDurationFrames === undefined ? {} : {
          stillDurationFrames: request.stillDurationFrames
        }),
        fps: current.fps
      })
      if (folderId) asset.folderId = folderId
      if (current.assets.some(({ id }) => id === asset.id)) {
        throw new ToolInputError(
          `Asset ${asset.id} from items[${index}] already exists; use its existing stable identity.`
        )
      }
      return asset
    }))

    assertNotCancelled(invocation)
    await invocation.reportProgress({ message: 'Probing Host-granted media', fraction: 0.55 })
    let candidate = planBatchMediaImport(current, assets).project
    if (addToTimeline) {
      for (const asset of assets) {
        candidate = applyTimelineOperations(candidate, [{ type: 'add-item', item: initialItem(candidate, asset) }]).project
      }
    }
    const committed = await this.service().saveProjectWithReceipt(candidate, expectedRevision, {
      author: 'manual',
      sourceOperation: 'media.import-batch',
      summary: `Imported and probed ${assets.length} media assets atomically`
    })
    await this.publishProjectChange(committed.project, 'assets-imported', committed.receipt)
    await invocation.reportProgress({ message: 'Media import complete', fraction: 1 })
    return result({
      outcome: 'imported-batch',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      importedCount: assets.length,
      receipt: committed.receipt as unknown as JsonObject,
      assets: assets.map(assetProjection)
    }, `Imported ${assets.length} media assets at revision ${committed.project.currentRevision}`)
  }

  private async videoProbe(
    input: ToolInput,
    invocation: ToolInvocationContext,
    author: RevisionAuthor = 'agent'
  ): Promise<ToolResult> {
    exactKeys(input, [
      'projectId',
      'expectedRevision',
      'mediaHandleId',
      'assetId',
      'assetKind',
      'folderId',
      'stillDurationFrames',
      'addToTimeline',
      'thumbnailOutputHandleId',
      'waveformOutputHandleId'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const current = await this.service().loadProject(projectId)
    assertExpectedRevision(current, expectedRevision)
    let capabilities: MediaCapabilities
    try {
      capabilities = await this.context.media.getCapabilities()
    } catch {
      return result({
        outcome: 'unavailable',
        code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
        projectId,
        currentRevision: expectedRevision,
        changedIds: [],
        retryable: true,
        message: 'Kun could not inspect local ffprobe availability. Install or configure the local media tools and retry; no project data was changed.'
      }, 'Media capability inspection unavailable')
    }
    if (!capabilities.ffprobe.available) {
      return result({
        outcome: 'unavailable',
        code: 'FFPROBE_UNAVAILABLE',
        projectId,
        currentRevision: expectedRevision,
        changedIds: [],
        retryable: true,
        message: 'Kun cannot import this media because ffprobe is unavailable. Install or configure ffprobe and retry; no project data was changed.'
      }, 'ffprobe is unavailable for media import')
    }
    if (
      !capabilities.ffmpeg.available &&
      (input.thumbnailOutputHandleId !== undefined || input.waveformOutputHandleId !== undefined)
    ) {
      return result({
        outcome: 'unavailable',
        code: 'FFMPEG_UNAVAILABLE',
        projectId,
        currentRevision: expectedRevision,
        changedIds: [],
        retryable: true,
        message: 'Kun cannot generate the requested thumbnail or waveform because FFmpeg is unavailable. Retry without derived outputs, or install or configure FFmpeg; no project data was changed.'
      }, 'FFmpeg is unavailable for derived media')
    }
    let metadata: MediaMetadata
    if (input.mediaHandleId === undefined) {
      let selection
      try {
        selection = await this.context.media.pickFiles({
          multiple: false,
          maxFiles: 1,
          filters: [{
            name: 'Video, audio, and images',
            extensions: ['mp4', 'mov', 'mkv', 'webm', 'm4a', 'mp3', 'wav', 'png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'],
            mimeTypes: ['video/*', 'audio/*', 'image/*']
          }]
        })
      } catch (error) {
        const interaction = interactionRequired(error, 'Select media in the Kun desktop editor, then retry with the granted mediaHandleId.')
        if (interaction) return result(interaction, 'Media import requires protected interaction')
        throw error
      }
      if (selection.outcome === 'cancelled') {
        return result({ outcome: 'cancelled', code: 'MEDIA_CANCELLED', message: 'Media selection was cancelled.' }, 'Media selection cancelled')
      }
      metadata = selection.files[0]!
    } else {
      const handleId = opaqueHandle(input.mediaHandleId, 'mediaHandleId')
      metadata = await this.context.media.stat({ handleId })
    }

    assertNotCancelled(invocation)
    await invocation.reportProgress({ message: 'Probing Host-granted media', fraction: 0.2 })
    const probe = await this.context.media.probe({ handleId: metadata.handleId })
    const assetId = input.assetId === undefined
      ? `asset-${createHash('sha256').update(metadata.handleId).digest('hex').slice(0, 16)}`
      : stableId(input.assetId, 'assetId')
    const assetKind = input.assetKind === undefined
      ? undefined
      : enumValue(input.assetKind, ['image', 'animation'] as const, 'assetKind')
    const stillDurationFrames = input.stillDurationFrames === undefined
      ? undefined
      : boundedPositiveInteger(input.stillDurationFrames, 'stillDurationFrames', 1, 1_080_000)
    const folderId = input.folderId === undefined ? undefined : stableId(input.folderId, 'folderId')
    const asset = assetFromProbe(assetId, metadata, probe, {
      ...(assetKind ? { assetKind } : {}),
      ...(stillDurationFrames === undefined ? {} : { stillDurationFrames }),
      fps: current.fps
    })
    if (folderId) asset.folderId = folderId
    if (current.assets.some(({ id }) => id === asset.id)) {
      throw new ToolInputError(`Asset ${asset.id} already exists; use its existing stable identity.`)
    }

    let candidate = planBatchMediaImport(current, [asset]).project
    if (input.addToTimeline !== false) {
      const item = initialItem(candidate, asset)
      candidate = applyTimelineOperations(candidate, [{ type: 'add-item', item }]).project
    }
    const committed = await this.service().saveProjectWithReceipt(candidate, expectedRevision, {
      author,
      ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
      sourceOperation: 'video-probe',
      summary: `Imported and probed ${asset.name}`
    })
    const saved = committed.project
    await this.publishProjectChange(saved, 'asset-imported', committed.receipt)
    await invocation.reportProgress({ message: 'Persisted probed asset metadata', fraction: 0.65 })

    const jobs: JsonObject[] = []
    if (input.thumbnailOutputHandleId !== undefined) {
      const outputHandle = opaqueHandle(input.thumbnailOutputHandleId, 'thumbnailOutputHandleId')
      const started = await this.context.media.startFfmpegJob({
        arguments: [
          '-nostdin', '-i', '{{input:source}}', '-frames:v', '1', '-vf', 'scale=640:-2',
          '-f', 'image2', '{{output:thumbnail}}'
        ],
        inputs: { source: metadata.handleId },
        outputs: { thumbnail: outputHandle },
        idempotencyKey: `${invocation.invocation.invocationId}:thumbnail`,
        metadata: { projectId, revision: saved.currentRevision, assetId, derivedKind: 'thumbnail' }
      })
      jobs.push(jobReferenceProjection(started.job, 'thumbnail'))
    }
    if (input.waveformOutputHandleId !== undefined) {
      const outputHandle = opaqueHandle(input.waveformOutputHandleId, 'waveformOutputHandleId')
      const started = await this.context.media.startFfmpegJob({
        arguments: [
          '-nostdin', '-i', '{{input:source}}', '-filter_complex',
          'showwavespic=s=1200x240:colors=white', '-frames:v', '1', '-f', 'image2',
          '{{output:waveform}}'
        ],
        inputs: { source: metadata.handleId },
        outputs: { waveform: outputHandle },
        idempotencyKey: `${invocation.invocation.invocationId}:waveform`,
        metadata: { projectId, revision: saved.currentRevision, assetId, derivedKind: 'waveform' }
      })
      jobs.push(jobReferenceProjection(started.job, 'waveform'))
    }
    await invocation.reportProgress({ message: 'Media import complete', fraction: 1 })
    return result({
      outcome: 'imported',
      projectId,
      currentRevision: saved.currentRevision,
      receipt: committed.receipt,
      asset: assetProjection(asset),
      metadata: probeProjection(probe),
      jobs
    }, `Imported ${asset.name} at revision ${saved.currentRevision}`)
  }

  private async videoReauthorize(
    input: ToolInput,
    invocation: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'assetId', 'mediaHandleId'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const assetId = stableId(input.assetId, 'assetId')
    const mediaHandleId = opaqueHandle(input.mediaHandleId, 'mediaHandleId')
    const current = await this.service().loadProject(projectId)
    assertExpectedRevision(current, expectedRevision)
    const assetIndex = current.assets.findIndex(({ id }) => id === assetId)
    if (assetIndex < 0) throw new ToolInputError(`Asset ${assetId} does not exist.`)
    const previous = current.assets[assetIndex]!
    const metadata = await this.context.media.stat({ handleId: mediaHandleId })
    assertNotCancelled(invocation)
    await invocation.reportProgress({ message: 'Probing replacement media grant', fraction: 0.25 })
    const probe = await this.context.media.probe({ handleId: mediaHandleId })
    const replacement = {
      ...assetFromProbe(assetId, metadata, probe, {
        ...(previous.kind === 'image' || previous.kind === 'animation'
          ? { assetKind: previous.kind, stillDurationUs: previous.durationUs }
          : {}),
        fps: current.fps
      }),
      name: previous.name,
      transcriptIds: [...previous.transcriptIds],
      ...(previous.folderId ? { folderId: previous.folderId } : {}),
      ...(previous.generatedLineage ? { generatedLineage: structuredClone(previous.generatedLineage) } : {})
    }
    if (replacement.kind !== previous.kind) {
      throw new ToolInputError(
        `Replacement media kind ${replacement.kind} does not match ${previous.kind} asset ${assetId}.`
      )
    }
    const committed = await this.service().relinkMedia(projectId, expectedRevision, {
      assetId,
      replacement
    }, {
      author: 'manual',
      sourceOperation: 'media.reauthorize',
      summary: `Reauthorized ${previous.name}`
    })
    const saved = committed.project
    const savedAsset = saved.assets.find(({ id }) => id === assetId) ?? replacement
    await this.derivedService().synchronizeProject(saved)
    await this.publishProjectChange(saved, 'asset-reauthorized', committed.receipt)
    if (previous.mediaHandleId && previous.mediaHandleId !== mediaHandleId) {
      await this.context.media.release({
        resource: 'handle',
        handleId: previous.mediaHandleId
      }).catch(() => undefined)
    }
    await invocation.reportProgress({ message: 'Replacement media grant saved', fraction: 1 })
    return result({
      outcome: 'reauthorized',
      projectId,
      currentRevision: saved.currentRevision,
      receipt: committed.receipt,
      asset: assetProjection(savedAsset)
    }, `Reauthorized ${previous.name} at revision ${saved.currentRevision}`)
  }

  private async videoTranscribe(
    input: ToolInput,
    author: RevisionAuthor = 'agent',
    invocation?: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'assetId', 'transcriptId', 'mode', 'format',
      'language', 'source', 'segments'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const assetId = stableId(input.assetId, 'assetId')
    const transcriptId = stableId(input.transcriptId, 'transcriptId')
    const mode = enumValue(input.mode, ['import', 'local-asr'] as const, 'mode')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const asset = project.assets.find(({ id }) => id === assetId)
    if (!asset) throw new ToolInputError(`Asset ${assetId} does not exist in project ${projectId}.`)

    if (mode === 'local-asr') {
      return result({
        outcome: 'unavailable',
        projectId,
        previousRevision: expectedRevision,
        currentRevision: expectedRevision,
        changedIds: [],
        summary: 'Local ASR execution is unavailable through the negotiated Extension API. Import a timed SRT, VTT, or JSON transcript; no media was uploaded and no text was invented.',
        details: { code: 'transcriber_unavailable', networkUsed: false }
      }, 'Local transcriber unavailable')
    }

    if ((input.source === undefined) === (input.segments === undefined)) {
      throw new ToolInputError('Transcript import requires exactly one of source or segments.')
    }
    const language = input.language === undefined
      ? undefined
      : boundedString(input.language, 'language', 1, 32)
    const format = input.segments === undefined
      ? enumValue(input.format, ['srt', 'vtt', 'json'] as const, 'format')
      : 'json'
    const source = input.segments === undefined
      ? boundedString(input.source, 'source', 1, 524_288)
      : JSON.stringify({
          segments: boundedArray(input.segments, 'segments', 1, 20_000).map(transcriptSegmentInput)
        })
    const transcript = importTranscript(source, { format, transcriptId, asset, language })
    const candidate = structuredClone(project)
    const existingIndex = candidate.transcripts.findIndex(({ id }) => id === transcript.id)
    if (existingIndex >= 0) candidate.transcripts[existingIndex] = transcript
    else candidate.transcripts.push(transcript)
    const candidateAsset = candidate.assets.find(({ id }) => id === assetId)!
    candidateAsset.transcriptIds = [...new Set([...candidateAsset.transcriptIds, transcript.id])].sort()
    const committed = await this.service().saveProjectWithReceipt(candidate, expectedRevision, {
      author,
      ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
      sourceOperation: 'video-transcribe',
      summary: `Imported ${transcript.provenance.toUpperCase()} transcript ${transcript.id}`
    })
    const saved = committed.project
    const changedIds = [assetId, transcript.id]
    await this.publishProjectChange(saved, 'transcript-imported', committed.receipt)
    return result({
      outcome: 'transcribed',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: saved.currentRevision,
      changedIds,
      receipt: committed.receipt,
      summary: `Imported ${transcript.segments.length} timed transcript segments without network access.`,
      details: transcriptProjection(transcript, MAX_TRANSCRIPT_SEGMENTS)
    }, `Imported transcript at revision ${saved.currentRevision}`)
  }

  private async videoApplyScript(
    input: ToolInput,
    author: RevisionAuthor = 'agent',
    invocation?: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'timelineMarkdown', 'ranges', 'summary'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const markdown = boundedString(input.timelineMarkdown, 'timelineMarkdown', 1, 262_144)
    const ranges = boundedArray(input.ranges, 'ranges', 1, 2_000).map(assetRange)
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    if (author === 'agent') assertTimedTranscriptEvidence(project, ranges)
    const applied = applyTimelineScript(project, markdown, ranges)
    const summary = input.summary === undefined
      ? `Applied ${applied.removed.length} transcript-timed cuts`
      : boundedString(input.summary, 'summary', 1, 512)
    const committed = await this.service().saveProjectWithReceipt(applied.project, expectedRevision, {
      author,
      ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
      sourceOperation: 'video-apply-script',
      summary
    })
    const saved = committed.project
    await this.publishProjectChange(saved, 'script-applied', committed.receipt)
    return result({
      outcome: 'applied',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: saved.currentRevision,
      changedIds: applied.changedIds,
      receipt: committed.receipt,
      summary,
      details: { removedRanges: applied.removed }
    }, `Applied timeline script at revision ${saved.currentRevision}`)
  }

  private async videoGenerateCaptions(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'assetId', 'trackId', 'idPrefix', 'maxWords',
      'maxRenderedWidthPx', 'maxDurationFrames', 'placement', 'style', 'animation'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const trackId = input.trackId === undefined
      ? project.tracks.find(({ kind }) => kind === 'caption')?.id
      : stableId(input.trackId, 'trackId')
    if (!trackId) throw new ToolInputError('Caption generation requires an existing caption track.')
    const assetId = input.assetId === undefined ? undefined : stableId(input.assetId, 'assetId')
    const transcripts = assetId === undefined
      ? project.transcripts
      : project.transcripts.filter((transcript) => transcript.assetId === assetId)
    if (transcripts.length === 0) throw new ToolInputError('Caption generation requires a timed transcript.')
    const plan = buildEditableCaptions(project, transcripts, {
      trackId,
      ...(input.idPrefix === undefined ? {} : { idPrefix: boundedString(input.idPrefix, 'idPrefix', 1, 96) }),
      ...(input.maxWords === undefined ? {} : { maxWords: positiveInteger(input.maxWords, 'maxWords') }),
      ...(input.maxRenderedWidthPx === undefined
        ? {}
        : { maxRenderedWidthPx: positiveInteger(input.maxRenderedWidthPx, 'maxRenderedWidthPx') }),
      ...(input.maxDurationFrames === undefined
        ? {}
        : { maxDurationFrames: positiveInteger(input.maxDurationFrames, 'maxDurationFrames') }),
      ...(input.placement === undefined
        ? {}
        : { placement: enumValue(input.placement, ['top', 'center', 'bottom'] as const, 'placement') }),
      ...(input.style === undefined ? {} : { style: captionBuildStyle(input.style) }),
      ...(input.animation === undefined ? {} : { animation: captionBuildAnimation(input.animation) })
    })
    if (plan.operations.length === 0) {
      throw new ToolInputError('The selected transcript has no visible timed words on the active sequence.')
    }
    const committed = await this.service().applyOperationsWithReceipt(
      projectId,
      expectedRevision,
      plan.operations,
      {
        author: 'manual',
        sourceOperation: 'caption.generate',
        summary: `Generated ${plan.operations.length} editable transcript captions`
      }
    )
    await this.publishProjectChange(committed.project, 'captions-generated', committed.receipt)
    return result({
      outcome: 'generated',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      generatedCount: plan.operations.length,
      interpolatedWordCount: plan.interpolatedWordCount,
      warnings: plan.warnings,
      receipt: committed.receipt as unknown as JsonObject,
      captions: plan.captions.slice(0, MAX_CAPTIONS) as unknown as JsonValue,
      truncated: plan.captions.length > MAX_CAPTIONS
    }, `Generated ${plan.operations.length} editable captions at revision ${committed.project.currentRevision}`)
  }

  private async videoUpdateTimeline(
    input: ToolInput,
    author: RevisionAuthor = 'agent',
    invocation?: ToolInvocationContext
  ): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision', 'operations', 'summary'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const operations = boundedArray(input.operations, 'operations', 1, 200)
      .map(strictTimelineOperation)
    const current = await this.service().loadProject(projectId)
    assertExpectedRevision(current, expectedRevision)
    if (author === 'agent') assertAgentMulticamSyncAuthority(current, operations)
    const preview = applyTimelineOperations(current, operations)
    const summary = input.summary === undefined
      ? `Applied ${operations.length} structured timeline operations`
      : boundedString(input.summary, 'summary', 1, 512)
    const committed = await this.service().applyOperationsWithReceipt(projectId, expectedRevision, operations, {
      author,
      ...(author === 'agent' ? { actorId: agentActorId(invocation) } : {}),
      sourceOperation: 'video-update-timeline',
      summary
    })
    const saved = committed.project
    await this.publishProjectChange(saved, 'timeline-updated', committed.receipt)
    return result({
      outcome: 'updated',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: saved.currentRevision,
      changedIds: preview.changedIds,
      receipt: committed.receipt,
      summary,
      details: { operationCount: operations.length }
    }, `Updated timeline at revision ${saved.currentRevision}`)
  }

  private async videoMulticamMutation(
    input: ToolInput,
    action: MulticamEditorAction
  ): Promise<ToolResult> {
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const current = await this.service().loadProject(projectId)
    assertExpectedRevision(current, expectedRevision)
    const planned = planMulticamEditorAction(current, action, input)
    const preview = applyTimelineOperations(current, planned.operations)
    const committed = await this.service().applyOperationsWithReceipt(
      projectId,
      expectedRevision,
      planned.operations,
      {
        author: 'manual',
        sourceOperation: action,
        summary: planned.summary
      }
    )
    await this.publishProjectChange(committed.project, planned.reason, committed.receipt)
    return result({
      outcome: action.slice('multicam.'.length),
      projectId,
      previousRevision: expectedRevision,
      currentRevision: committed.project.currentRevision,
      changedIds: preview.changedIds,
      receipt: committed.receipt,
      multicamGroups: (committed.project.multicamGroups ?? [])
        .slice(0, MAX_MULTICAM_GROUPS)
        .map(multicamGroupProjection)
    }, `${planned.summary} at revision ${committed.project.currentRevision}`)
  }

  private async videoHistory(input: ToolInput, action: 'undo' | 'redo'): Promise<ToolResult> {
    exactKeys(input, ['projectId', 'expectedRevision'])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const committed = action === 'undo'
      ? await this.service().undoWithReceipt(projectId, expectedRevision, 'manual')
      : await this.service().redoWithReceipt(projectId, expectedRevision, 'manual')
    const project = committed.project
    await this.publishProjectChange(project, `project-${action}`, committed.receipt)
    return result({
      outcome: action === 'undo' ? 'undone' : 'redone',
      projectId,
      previousRevision: expectedRevision,
      currentRevision: project.currentRevision,
      changedIds: ['history'],
      receipt: committed.receipt,
      summary: `${action === 'undo' ? 'Undid' : 'Redid'} the previous project revision.`,
      details: { project: await this.projectViewProjection(project) }
    }, `${action === 'undo' ? 'Undid' : 'Redid'} project at revision ${project.currentRevision}`)
  }

  private async videoRender(input: ToolInput, invocation: ToolInvocationContext): Promise<ToolResult> {
    exactKeys(input, [
      'projectId', 'expectedRevision', 'kind', 'outputHandleId', 'proofFrame',
      'captionMode', 'subtitleOutputHandleId', 'subtitleFormat', 'idempotencyKey',
      'width', 'height', 'frameRate', 'quality', 'acceleration',
      'allowPortableEquivalent', 'audio', 'multicamGroupId', 'startFrame', 'endFrame'
    ])
    const projectId = stableId(input.projectId, 'projectId')
    const expectedRevision = nonNegativeInteger(input.expectedRevision, 'expectedRevision')
    const kind = enumValue(
      input.kind,
      ['proof-frame', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'audio-aac', 'subtitles'] as const,
      'kind'
    )
    const subtitleFormat = input.subtitleFormat === undefined
      ? 'srt'
      : enumValue(input.subtitleFormat, ['srt', 'vtt'] as const, 'subtitleFormat')
    const captionMode = input.captionMode === undefined
      ? 'none'
      : enumValue(input.captionMode, ['none', 'burned', 'sidecar', 'both'] as const, 'captionMode')
    if (kind === 'subtitles' && captionMode !== 'none') {
      throw new ToolInputError('Standalone subtitle export does not accept a media caption mode.')
    }
    if ((captionMode === 'sidecar' || captionMode === 'both') && !isRequestedFinalVideoKind(kind)) {
      throw new ToolInputError('Caption sidecars are supported only for a final video export.')
    }
    if (captionMode === 'burned' && kind === 'audio-aac') {
      throw new ToolInputError('Burned captions require a proof, preview, or final video render.')
    }
    // Reject path-shaped or otherwise invalid caller input before project
    // compilation/capability probing so validation order cannot be used to
    // bypass the opaque-handle boundary on an empty project.
    const suppliedOutputHandleId = input.outputHandleId === undefined
      ? undefined
      : opaqueHandle(input.outputHandleId, 'outputHandleId')
    const suppliedSubtitleOutputHandleId = input.subtitleOutputHandleId === undefined
      ? undefined
      : opaqueHandle(input.subtitleOutputHandleId, 'subtitleOutputHandleId')
    const project = await this.service().loadProject(projectId)
    assertExpectedRevision(project, expectedRevision)
    const multicamGroupId = input.multicamGroupId === undefined
      ? undefined
      : stableId(input.multicamGroupId, 'multicamGroupId')
    const renderProject = multicamGroupId
      ? compileMulticamProgramProject(project, multicamGroupId)
      : project
    const hasStartFrame = input.startFrame !== undefined
    const hasEndFrame = input.endFrame !== undefined
    if (hasStartFrame !== hasEndFrame) {
      throw new ToolInputError('A render range requires both startFrame and endFrame.')
    }
    if (hasStartFrame && !multicamGroupId) {
      throw new ToolInputError('A bounded render range is currently available only for a multicam program.')
    }
    const renderRange = hasStartFrame
      ? {
          startFrame: nonNegativeInteger(input.startFrame, 'startFrame'),
          endFrame: positiveInteger(input.endFrame, 'endFrame')
        }
      : undefined
    if (renderRange && renderRange.endFrame <= renderRange.startFrame) {
      throw new ToolInputError('endFrame must be greater than startFrame.')
    }
    if (kind !== 'proof-frame' && input.proofFrame !== undefined) {
      throw new ToolInputError('proofFrame is supported only for proof-frame renders.')
    }
    const proofFrame = kind === 'proof-frame'
      ? input.proofFrame === undefined
        ? 0
        : nonNegativeInteger(input.proofFrame, 'proofFrame')
      : undefined
    const advancedSettings = professionalRenderSettings(renderProject, kind, input)
    const capabilityAssessment = await this.renderCapabilityAssessment(
      renderProject,
      kind,
      captionMode,
      proofFrame,
      renderRange,
      advancedSettings
    )
    if ('failure' in capabilityAssessment) return capabilityAssessment.failure
    const selectedRenderKind = capabilityAssessment.selectedRenderKind

    let outputHandleId: string
    let ownsOutputHandle = false
    if (suppliedOutputHandleId === undefined) {
      let selection
      try {
        selection = await this.context.media.pickSaveTarget({
          suggestedName: renderFileName(project, selectedRenderKind, subtitleFormat),
          filters: [renderFilter(selectedRenderKind, subtitleFormat)]
        })
      } catch (error) {
        const interaction = interactionRequired(error, 'Choose an export target in the Kun desktop editor, then retry with its outputHandleId.')
        if (interaction) return result(interaction, 'Render requires protected interaction')
        throw error
      }
      if (selection.outcome === 'cancelled') {
        return result({ outcome: 'cancelled', code: 'MEDIA_CANCELLED', message: 'Export target selection was cancelled.' }, 'Export selection cancelled')
      }
      outputHandleId = selection.target.handleId
      ownsOutputHandle = true
    } else {
      outputHandleId = suppliedOutputHandleId
    }

    let subtitleOutputHandleId: string | undefined
    let ownsSubtitleOutputHandle = false
    let renderStarted = false
    try {
    if (captionMode === 'sidecar' || captionMode === 'both') {
      if (suppliedSubtitleOutputHandleId === undefined) {
        let selection
        try {
          selection = await this.context.media.pickSaveTarget({
            suggestedName: `${project.id}-revision-${project.currentRevision}.${subtitleFormat}`,
            filters: [{
              name: subtitleFormat === 'srt' ? 'SubRip captions' : 'WebVTT captions',
              extensions: [subtitleFormat],
              mimeTypes: [subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt']
            }]
          })
        } catch (error) {
          const interaction = interactionRequired(error, 'Choose a protected subtitle export target, then retry with its subtitleOutputHandleId.')
          if (interaction) return result(interaction, 'Caption sidecar export requires protected interaction')
          throw error
        }
        if (selection.outcome === 'cancelled') {
          return result({ outcome: 'cancelled', code: 'MEDIA_CANCELLED', message: 'Subtitle export target selection was cancelled.' }, 'Subtitle export selection cancelled')
        }
        subtitleOutputHandleId = selection.target.handleId
        ownsSubtitleOutputHandle = true
      } else {
        subtitleOutputHandleId = suppliedSubtitleOutputHandleId
      }
    } else if (
      input.subtitleOutputHandleId !== undefined ||
      (kind !== 'subtitles' && input.subtitleFormat !== undefined)
    ) {
      throw new ToolInputError('Subtitle output fields require captionMode sidecar or both.')
    }
    const plan = generateRenderPlan(renderProject, {
      kind: selectedRenderKind,
      expectedRevision,
      outputHandleId,
      proofFrame,
      ...(renderRange ?? {}),
      captionMode,
      subtitleFormat,
      backendCapabilities: capabilityAssessment.backendCapabilities,
      ...(capabilityAssessment.advancedEffects
        ? { advancedEffects: capabilityAssessment.advancedEffects }
        : {}),
      ...(capabilityAssessment.advancedExport
        ? { advancedExport: capabilityAssessment.advancedExport }
        : {}),
      ...(subtitleOutputHandleId ? { subtitleOutputHandleId } : {})
    })
    const textSteps = plan.steps.filter(
      (renderStep): renderStep is TextRenderStep => renderStep.kind === 'write-text'
    )
    const ffmpegSteps = plan.steps.filter(
      (step): step is FfmpegRenderStep => step.kind === 'ffmpeg'
    )
    const standaloneSubtitles = selectedRenderKind === 'subtitles'
    if (
      textSteps.length > 1 ||
      (standaloneSubtitles
        ? textSteps.length !== 1 || ffmpegSteps.length !== 0
        : ffmpegSteps.length !== 1)
    ) {
      throw new ToolInputError(
        'This render plan exceeds the supported single-media/single-sidecar export transaction.'
      )
    }
    if (textSteps[0] && new TextEncoder().encode(textSteps[0].content).byteLength > 192 * 1024) {
      throw new ToolInputError(
        'The generated subtitle sidecar exceeds the 192 KiB durable-job limit; shorten or split the caption export.'
      )
    }
    const inputs: Record<string, string> = {}
    const step = ffmpegSteps[0]
    if (step) {
      for (const [name, reference] of Object.entries(step.inputs)) {
        if (reference.kind !== 'media-handle') {
          throw new ToolInputError(`Render input ${name} is not backed by a durable media handle.`)
        }
        inputs[name] = opaqueHandle(reference.reference, `render input ${name}`)
      }
    }
    assertNotCancelled(invocation)
    await invocation.reportProgress({ message: 'Submitting durable media job', fraction: 0.5 })
    const started = await this.context.media.startFfmpegJob({
      arguments: step?.args ?? [],
      inputs,
      outputs: step?.outputs ?? {},
      ...(textSteps.length === 1 ? {
        textOutputs: {
          [textSteps[0]!.id]: {
            handleId: opaqueHandle(textSteps[0]!.output, 'subtitle output'),
            mimeType: textSteps[0]!.mime,
            content: textSteps[0]!.content
          }
        }
      } : {}),
      ...(input.idempotencyKey === undefined
        ? {}
        : { idempotencyKey: boundedString(input.idempotencyKey, 'idempotencyKey', 1, 256) }),
      metadata: {
        projectId,
        multicamGroupId: multicamGroupId ?? null,
        pinnedRevision: expectedRevision,
        renderKind: selectedRenderKind,
        ...(isRequestedFinalVideoKind(kind) ? { requestedRenderKind: kind } : {}),
        ...(capabilityAssessment.advancedExport ? {
          advancedSettingsDigest: capabilityAssessment.advancedExport.settingsDigest,
          advancedCapabilitiesDigest: capabilityAssessment.advancedExport.capabilitiesDigest,
          portableEquivalent: capabilityAssessment.advancedExport.capabilityEvidence.portableEquivalent
        } : capabilityAssessment.advancedEffects ? {
          advancedCapabilitiesDigest: capabilityAssessment.advancedEffects.capabilitiesDigest
        } : {}),
        ...(capabilityAssessment.advancedEffects ? {
          effectSemanticsDigest: capabilityAssessment.advancedEffects.renderSemanticsDigest
        } : {}),
        captionMode,
        subtitleFormat,
        canvasPreset: project.canvas.preset,
        proofFrame: proofFrame ?? null,
        sequenceId: plan.sequenceId,
        renderIrDigest: plan.renderIrDigest,
        backendCapabilitiesDigest: plan.backendCapabilitiesDigest,
        renderRange: plan.renderIr.range,
        playbackMode: plan.playback.mode,
        technicalValidation: 'pending',
        visualInspection: 'not-performed'
      }
    })
    renderStarted = true
    const record: RenderRecord = {
      schemaVersion: 1,
      jobId: started.job.jobId,
      projectId,
      sequenceId: plan.sequenceId,
      pinnedRevision: expectedRevision,
      renderIrDigest: plan.renderIrDigest,
      backendCapabilitiesDigest: plan.backendCapabilitiesDigest,
      renderRange: structuredClone(plan.renderIr.range),
      playbackMode: plan.playback.mode,
      renderKind: selectedRenderKind,
      ...(isRequestedFinalVideoKind(kind) ? { requestedRenderKind: kind } : {}),
      ...(capabilityAssessment.advancedExport ? {
        advancedSettingsDigest: capabilityAssessment.advancedExport.settingsDigest,
        advancedCapabilitiesDigest: capabilityAssessment.advancedExport.capabilitiesDigest,
        portableEquivalent: capabilityAssessment.advancedExport.capabilityEvidence.portableEquivalent
      } : capabilityAssessment.advancedEffects ? {
        advancedCapabilitiesDigest: capabilityAssessment.advancedEffects.capabilitiesDigest
      } : {}),
      ...(capabilityAssessment.advancedEffects ? {
        effectSemanticsDigest: capabilityAssessment.advancedEffects.renderSemanticsDigest
      } : {}),
      captionMode,
      subtitleFormat,
      canvasPreset: project.canvas.preset,
      ...(proofFrame !== undefined ? { proofFrame } : {}),
      expectedArtifacts: plan.artifacts.map((artifact) => ({
        mediaKind: artifact.kind,
        mimeType: artifact.mime
      })),
      createdAt: new Date().toISOString()
    }
    try {
      await this.context.storage.workspace.set(renderKey(started.job.jobId), record)
    } catch {
      const confirmed = await this.loadRenderRecord(started.job.jobId)
      if (!confirmed || !sameRenderTrackingRecord(confirmed, record)) {
        const cancellation = await this.cancelAfterRenderTrackingFailure(started.job.jobId)
        throw new ExtensionApiError({
          code: 'INTERNAL_ERROR',
          message: `Durable render tracking could not be persisted after job ${started.job.jobId} started. ` +
            `Cancellation was attempted and the durable job is ${cancellation.state}; ` +
            'use video-render-status with this jobId before retrying.',
          operation: 'video-render',
          retryable: false,
          details: {
            jobId: started.job.jobId,
            state: cancellation.state,
            cancellationAttempted: true,
            cancellationAccepted: cancellation.accepted,
            trackingPersisted: false
          }
        })
      }
    }
    await invocation.reportProgress({ message: 'Durable media job queued', fraction: 1 })
    return result({
      outcome: 'queued',
      jobId: started.job.jobId,
      state: started.job.state,
      projectId,
      multicamGroupId: multicamGroupId ?? null,
      pinnedRevision: expectedRevision,
      renderKind: selectedRenderKind,
      requestedRenderKind: isRequestedFinalVideoKind(kind) ? kind : null,
      advancedSettingsDigest: capabilityAssessment.advancedExport?.settingsDigest ?? null,
      advancedCapabilitiesDigest: capabilityAssessment.advancedExport?.capabilitiesDigest ??
        capabilityAssessment.advancedEffects?.capabilitiesDigest ?? null,
      effectSemanticsDigest: capabilityAssessment.advancedEffects?.renderSemanticsDigest ?? null,
      portableEquivalent: capabilityAssessment.advancedExport?.capabilityEvidence.portableEquivalent ?? false,
      sequenceId: plan.sequenceId,
      renderIrDigest: plan.renderIrDigest,
      backendCapabilitiesDigest: plan.backendCapabilitiesDigest,
      renderRange: plan.renderIr.range,
      playbackMode: plan.playback.mode,
      proofStale: false,
      technicallyValidated: false,
      visualInspection: 'not-performed',
      artifacts: []
    }, `Queued ${selectedRenderKind} render for revision ${expectedRevision}`)
    } finally {
      if (!renderStarted) {
        const ownedHandles = [
          ...(ownsOutputHandle ? [outputHandleId] : []),
          ...(ownsSubtitleOutputHandle && subtitleOutputHandleId ? [subtitleOutputHandleId] : [])
        ]
        await Promise.all(ownedHandles.map((handleId) =>
          this.context.media.release({ resource: 'handle', handleId }).catch(() => undefined)
        ))
      }
    }
  }

  private async renderCapabilityAssessment(
    project: VideoProject,
    kind: RenderKind,
    captionMode: RenderRecord['captionMode'],
    proofFrame: number | undefined,
    renderRange: { startFrame: number; endFrame: number } | undefined,
    advancedSettings: AdvancedExportSettings | undefined
  ): Promise<RenderCapabilityAssessment> {
    // Standalone subtitle exports are durable bounded text writes. They do not
    // execute or validate media and must remain available without FFmpeg.
    if (kind === 'subtitles') {
      return {
        backendCapabilities: textRenderBackendCapabilities(),
        selectedRenderKind: 'subtitles'
      }
    }

    let capabilities: MediaCapabilities
    try {
      capabilities = await this.context.media.getCapabilities()
    } catch {
      return { failure: result({
        outcome: 'unavailable',
        code: 'MEDIA_CAPABILITIES_UNAVAILABLE',
        projectId: project.id,
        currentRevision: project.currentRevision,
        changedIds: [],
        retryable: true,
        renderKind: kind,
        captionMode,
        missingCapabilities: ['capability-inspection'],
        message: `Kun could not inspect local FFmpeg and ffprobe capabilities for the ${kind} render. ` +
          'Install or configure both media executables and retry. No output target was selected and no render job was started.'
      }, 'Media capability inspection unavailable; no render was started') }
    }

    const missing: Array<{
      code: string
      id: string
      label: string
      guidance: string
    }> = []
    if (!capabilities.ffprobe.available) {
      missing.push({
        code: 'FFPROBE_UNAVAILABLE',
        id: 'ffprobe',
        label: 'ffprobe executable',
        guidance: 'Install or configure ffprobe so Kun can validate generated media.'
      })
    }
    if (!capabilities.ffmpeg.available) {
      missing.push({
        code: 'FFMPEG_UNAVAILABLE',
        id: 'ffmpeg',
        label: 'FFmpeg executable',
        guidance: 'Install or configure FFmpeg for media rendering.'
      })
    }

    const features = new Set<string>(capabilities.ffmpeg.features)
    if (
      capabilities.ffmpeg.available &&
      (kind === 'preview' || (kind === 'h264-mp4' && advancedSettings === undefined)) &&
      !features.has('libx264-encoder')
    ) {
      missing.push({
        code: 'LIBX264_ENCODER_UNAVAILABLE',
        id: 'libx264-encoder',
        label: 'libx264 encoder',
        guidance: 'Use an FFmpeg build that includes the libx264 encoder.'
      })
    }
    const timelineHasAudio = project.items.some((item) =>
      project.assets.some((asset) => asset.id === item.assetId && asset.audio !== undefined)
    )
    if (
      capabilities.ffmpeg.available &&
      (kind === 'audio-aac' ||
        ((kind === 'preview' || (kind === 'h264-mp4' && advancedSettings === undefined)) && timelineHasAudio)) &&
      !features.has('aac-encoder')
    ) {
      missing.push({
        code: 'AAC_ENCODER_UNAVAILABLE',
        id: 'aac-encoder',
        label: 'AAC encoder',
        guidance: 'Use an FFmpeg build that includes the AAC encoder.'
      })
    }
    if (
      capabilities.ffmpeg.available &&
      (captionMode === 'burned' || captionMode === 'both') &&
      !features.has('drawtext-filter')
    ) {
      missing.push({
        code: 'DRAWTEXT_FILTER_UNAVAILABLE',
        id: 'drawtext-filter',
        label: 'drawtext filter',
        guidance: "Retry with captionMode 'none' or 'sidecar', or use an FFmpeg build that includes drawtext."
      })
    }

    const hasEnabledEffects = project.items.some((item) => item.effects?.some(({ enabled }) => enabled))
    const useAdvancedNegotiation = advancedSettings !== undefined || hasEnabledEffects
    const advancedCapabilities = useAdvancedNegotiation
      ? observedAdvancedFfmpegCapabilities(capabilities)
      : undefined
    const renderIr = flattenNestedRenderIr(project, compileRenderIr(project, {
      textPolicy: captionMode,
      ...(proofFrame === undefined
        ? renderRange ? { range: renderRange } : {}
        : { range: { startFrame: proofFrame, endFrame: proofFrame + 1 } })
    }))
    let selectedRenderKind = kind
    let advancedEffects: AdvancedEffectExecutionPlan | undefined
    let advancedExport: AdvancedExportPlan | undefined
    if (advancedCapabilities) {
      advancedEffects = negotiateAdvancedEffects(renderIr, advancedCapabilities, {
        target: kind === 'proof-frame' || kind === 'preview' ? 'preview' : 'export',
        acceleration: advancedSettings?.acceleration ?? 'cpu'
      })
      for (const issue of advancedEffects.issues) {
        missing.push({
          code: 'ADVANCED_EFFECT_UNSUPPORTED',
          id: issue.capability,
          label: `${issue.nodeId}: ${issue.capability}`,
          guidance: issue.guidance
        })
      }
    }
    if (advancedSettings && advancedCapabilities) {
      advancedExport = negotiateAdvancedExport(renderIr, advancedSettings, advancedCapabilities)
      for (const issue of advancedExport.issues) {
        missing.push({
          code: 'ADVANCED_EXPORT_UNSUPPORTED',
          id: issue.capability,
          label: `${issue.nodeId}: ${issue.capability}`,
          guidance: issue.guidance
        })
      }
      if (advancedExport.selected) selectedRenderKind = advancedExport.selected.format
    }
    const backendCapabilities = advancedCapabilities
      ? observedRenderBackendCapabilities(capabilities, advancedCapabilities)
      : ffmpegRenderBackendCapabilities(capabilities)
    const capabilityReport = negotiateRenderIr(renderIr, backendCapabilities, selectedRenderKind)
    for (const unsupported of capabilityReport.unsupported) {
      if (missing.some(({ id }) => id === unsupported.capability)) continue
      missing.push({
        code: 'RENDER_IR_NODE_UNSUPPORTED',
        id: unsupported.capability,
        label: `${unsupported.nodeId}: ${unsupported.capability}`,
        guidance: unsupported.guidance
      })
    }

    if (missing.length > 0) {
      const labels = missing.map(({ label }) => label)
      const guidance = missing.map(({ guidance: item }) => item)
      return { failure: result({
        outcome: 'unavailable',
        code: missing[0]!.code,
        projectId: project.id,
        currentRevision: project.currentRevision,
        changedIds: [],
        retryable: true,
        renderKind: selectedRenderKind,
        requestedRenderKind: kind,
        captionMode,
        missingCapabilities: missing.map(({ id }) => id),
        unsupportedNodes: capabilityReport.unsupported.map((unsupported) => ({
          nodeId: unsupported.nodeId,
          nodeType: unsupported.nodeType,
          capability: unsupported.capability,
          message: unsupported.message,
          guidance: unsupported.guidance
        })),
        advancedIssues: [
          ...(advancedEffects?.issues ?? []),
          ...(advancedExport?.issues ?? [])
        ].slice(0, 64) as unknown as JsonValue,
        capabilityEvidence: advancedExport?.capabilityEvidence as unknown as JsonValue ?? null,
        backendCapabilitiesDigest: capabilityReport.capabilitiesDigest,
        message: `Cannot start the ${selectedRenderKind} render; missing media capability: ${labels.join(', ')}. ` +
          `${guidance.join(' ')} No output target was selected and no render job was started.`
      }, `Render unavailable: missing ${labels.join(', ')}`) }
    }
    return {
      backendCapabilities,
      selectedRenderKind,
      ...(advancedEffects ? { advancedEffects } : {}),
      ...(advancedExport ? { advancedExport } : {})
    }
  }

  private async cancelAfterRenderTrackingFailure(
    jobId: string
  ): Promise<{ state: JobSnapshot['state'] | 'unknown'; accepted: boolean }> {
    try {
      const cancellation = await this.context.jobs.cancel({
        jobId,
        reason: 'Render tracking persistence failed after durable job admission'
      })
      const terminal = await this.waitForTerminalJob(cancellation.snapshot)
      return { state: terminal.state, accepted: cancellation.accepted }
    } catch {
      try {
        return { state: (await this.context.jobs.get(jobId)).state, accepted: false }
      } catch {
        return { state: 'unknown', accepted: false }
      }
    }
  }

  private async waitForTerminalJob(initial: JobSnapshot): Promise<JobSnapshot> {
    if (isTerminalJobState(initial.state)) return initial
    let subscription: Awaited<ReturnType<ExtensionContext['jobs']['subscribe']>> | undefined
    try {
      subscription = await this.context.jobs.subscribe({
        jobId: initial.id,
        afterCursor: initial.latestCursor
      })
      const activeSubscription = subscription
      if (isTerminalJobState(activeSubscription.snapshot.state)) return activeSubscription.snapshot
      return await new Promise<JobSnapshot>((resolve) => {
        let settled = false
        const finish = (snapshot: JobSnapshot): void => {
          if (settled) return
          settled = true
          clearTimeout(timeout)
          resolve(snapshot)
        }
        const timeout = setTimeout(() => {
          void this.context.jobs.get(initial.id).then(finish, () => finish(activeSubscription.snapshot))
        }, RENDER_TRACKING_CANCELLATION_WAIT_MS)
        activeSubscription.onEvent(() => {
          if (isTerminalJobState(activeSubscription.snapshot.state)) finish(activeSubscription.snapshot)
        })
        if (isTerminalJobState(activeSubscription.snapshot.state)) finish(activeSubscription.snapshot)
      })
    } catch {
      try {
        return await this.context.jobs.get(initial.id)
      } catch {
        return initial
      }
    } finally {
      try {
        await subscription?.dispose()
      } catch {
        // The durable snapshot remains queryable by jobId even if unsubscribe loses the Host connection.
      }
    }
  }

  private async videoRenderStatus(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['jobId', 'projectId'])
    const jobId = boundedString(input.jobId, 'jobId', 8, 512)
    const projectId = input.projectId === undefined
      ? undefined
      : stableId(input.projectId, 'projectId')
    const snapshot = await this.context.jobs.get(jobId)
    const record = await this.scopedRenderRecord(snapshot, projectId)
    return await this.renderStatusResult(snapshot, record)
  }

  private async videoRenderList(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, [])
    const page = await this.context.jobs.list({
      filter: { kinds: ['media.ffmpeg'], workspaceId: this.workspaceId() },
      limit: 200
    })
    const records: JsonObject[] = []
    let untrackedCount = 0
    for (const snapshot of page.items) {
      try {
        this.assertOwnedRenderSnapshot(snapshot)
        const record = await this.loadOrRecoverRenderRecord(snapshot)
        if (!record) {
          untrackedCount += 1
          continue
        }
        records.push({
          jobId: record.jobId,
          projectId: record.projectId,
          sequenceId: record.sequenceId,
          pinnedRevision: record.pinnedRevision,
          renderIrDigest: record.renderIrDigest,
          backendCapabilitiesDigest: record.backendCapabilitiesDigest,
          renderKind: record.renderKind,
          requestedRenderKind: record.requestedRenderKind ?? null,
          advancedSettingsDigest: record.advancedSettingsDigest ?? null,
          advancedCapabilitiesDigest: record.advancedCapabilitiesDigest ?? null,
          effectSemanticsDigest: record.effectSemanticsDigest ?? null,
          portableEquivalent: record.portableEquivalent ?? false,
          createdAt: record.createdAt
        })
      } catch {
        untrackedCount += 1
      }
    }
    return result({
      outcome: 'listed',
      records,
      truncated: page.page.hasMore,
      untrackedCount
    }, `Listed ${records.length} tracked video renders`)
  }

  private async videoRenderCancel(input: ToolInput): Promise<ToolResult> {
    exactKeys(input, ['jobId', 'projectId', 'reason'])
    const jobId = boundedString(input.jobId, 'jobId', 8, 512)
    const projectId = input.projectId === undefined
      ? undefined
      : stableId(input.projectId, 'projectId')
    const snapshot = await this.context.jobs.get(jobId)
    const record = await this.scopedRenderRecord(snapshot, projectId)
    if (!record) {
      throw new ToolInputError(
        'The durable job has no verified video-render tracking record and cannot be cancelled by this tool.'
      )
    }
    const cancellation = await this.context.jobs.cancel({
      jobId,
      ...(input.reason === undefined
        ? {}
        : { reason: boundedString(input.reason, 'reason', 1, 512) })
    })
    return await this.renderStatusResult(cancellation.snapshot, record)
  }

  private async renderStatusResult(
    snapshot: JobSnapshot,
    record: RenderRecord | undefined
  ): Promise<ToolResult> {
    const currentRevision = record
      ? await this.currentRevision(record.projectId)
      : undefined
    const proofStale = record !== undefined && currentRevision !== undefined
      ? currentRevision !== record.pinnedRevision
      : false
    const validation = await this.validateArtifacts(snapshot, record)
    const outcome = snapshot.state === 'completed' && !validation.valid
      ? 'invalid-output'
      : snapshot.state
    const content: JsonObject = {
      outcome,
      jobId: snapshot.id,
      state: snapshot.state,
      tracked: record !== undefined,
      ...(record ? {
        projectId: record.projectId,
        sequenceId: record.sequenceId,
        pinnedRevision: record.pinnedRevision,
        renderIrDigest: record.renderIrDigest,
        backendCapabilitiesDigest: record.backendCapabilitiesDigest,
        renderRange: record.renderRange,
        playbackMode: record.playbackMode,
        renderKind: record.renderKind,
        requestedRenderKind: record.requestedRenderKind ?? null,
        advancedSettingsDigest: record.advancedSettingsDigest ?? null,
        advancedCapabilitiesDigest: record.advancedCapabilitiesDigest ?? null,
        effectSemanticsDigest: record.effectSemanticsDigest ?? null,
        portableEquivalent: record.portableEquivalent ?? false,
        captionMode: record.captionMode,
        subtitleFormat: record.subtitleFormat,
        canvasPreset: record.canvasPreset,
        proofFrame: record.proofFrame ?? null,
        currentRevision: currentRevision ?? null,
        projectAvailable: currentRevision !== undefined
      } : {}),
      proofStale,
      technicallyValidated: validation.valid,
      visualInspection: 'not-performed',
      evidenceCurrent: validation.valid && !proofStale,
      ...(snapshot.progress ? { progress: snapshot.progress as unknown as JsonObject } : {}),
      ...(snapshot.error ? { error: snapshot.error as unknown as JsonObject } : {}),
      artifacts: validation.artifacts,
      ...(validation.reason ? { message: validation.reason } : {})
    }
    return {
      content,
      summary: renderStatusSummary(snapshot, validation.valid, proofStale),
      metadata: {
        machineValidatedOnly: validation.valid,
        visuallyInspected: false,
        proofStale,
        evidenceCurrent: validation.valid && !proofStale
      },
      ...(validation.valid && !proofStale && validation.artifacts.length > 0
        ? { generatedArtifacts: validation.artifacts }
        : {})
    }
  }

  private async scopedRenderRecord(
    snapshot: JobSnapshot,
    expectedProjectId: string | undefined
  ): Promise<RenderRecord | undefined> {
    this.assertOwnedRenderSnapshot(snapshot)
    const record = await this.loadOrRecoverRenderRecord(snapshot)
    if (expectedProjectId !== undefined && record?.projectId !== expectedProjectId) {
      throw new ToolInputError(
        'The durable job could not be verified as a render for the requested project.'
      )
    }
    return record
  }

  private assertOwnedRenderSnapshot(snapshot: JobSnapshot): void {
    if (
      snapshot.ownerExtensionId !== this.context.extension.id ||
      snapshot.ownerExtensionVersion !== this.context.extension.version ||
      snapshot.workspaceId !== this.workspaceId() ||
      snapshot.kind !== 'media.ffmpeg' ||
      snapshot.initiatingOperation !== 'media.startFfmpegJob'
    ) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: 'The durable job is not an owned video render in this workspace.',
        operation: 'video-render-status',
        retryable: false
      })
    }
  }

  private service(): ProjectService {
    const workspace = this.context.workspaceContext
    if (!workspace?.active || !workspace.trusted) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: 'The video editor requires an active trusted workspace.',
        operation: 'video-project',
        retryable: true
      })
    }
    this.projectService ??= new ProjectService(workspace.root)
    return this.projectService
  }

  private derivedService(): DerivedMediaService {
    this.derivedMediaService ??= new DerivedMediaService(this.context)
    return this.derivedMediaService
  }

  private intelligenceService(): MediaIntelligenceService {
    this.mediaIntelligenceService ??= new MediaIntelligenceService(
      this.context,
      new KunLocalAudioAnalysisBroker(this.context)
    )
    return this.mediaIntelligenceService
  }

  private generationService(): GenerationService {
    this.generationServiceInstance ??= new GenerationService(
      this.context,
      this.options.generationBroker
    )
    return this.generationServiceInstance
  }

  private generationControlPlane(): GenerationControlPlane {
    if (!this.generationControlPlaneInstance) {
      const references: GenerationReferenceResolver = {
        resolve: async (projectId, assetIds) => {
          const project = await this.service().loadProject(projectId)
          return assetIds.map((assetId) => {
            const asset = project.assets.find(({ id }) => id === assetId)
            if (!asset) throw new ToolInputError(`Generation reference asset ${assetId} does not exist.`)
            if ((asset.availability ?? 'online') !== 'online' || !asset.mediaHandleId) {
              throw new ToolInputError(`Generation reference asset ${assetId} is not currently authorized.`)
            }
            return {
              assetId,
              mediaHandleId: asset.mediaHandleId,
              kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'video' ? 'video' : 'image',
              ...(asset.sourceIdentity ? {
                sourceFingerprint: {
                  algorithm: 'sha256' as const,
                  value: asset.sourceIdentity.value
                }
              } : {})
            }
          })
        }
      }
      this.generationControlPlaneInstance = new GenerationControlPlane(this.generationService(), references)
    }
    return this.generationControlPlaneInstance
  }

  private commandInvocation(action: string): ToolInvocationContext {
    const invocationId = `editor-request-${Date.now().toString(36)}`
    return {
      invocation: {
        invocationId,
        toolId: `editor-request:${action}`,
        input: {},
        workspaceId: this.context.workspaceContext?.id
      },
      cancellation: {
        isCancellationRequested: false,
        onCancellationRequested: () => ({ dispose() {} })
      },
      reportProgress: async (progress) => {
        await this.context.ui.postMessage({
          channel: 'kun-video-editor.command-progress',
          payload: {
            schemaVersion: 1,
            action,
            invocationId,
            message: progress.message ?? null,
            fraction: progress.fraction ?? null,
            data: progress.data ?? null
          }
        })
      }
    }
  }

  private workspaceId(): string {
    const workspace = this.context.workspaceContext
    if (!workspace?.active || !workspace.trusted) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: 'The video editor requires an active trusted workspace.',
        operation: 'video-project',
        retryable: true
      })
    }
    return workspace.id
  }

  private async publishProjectChange(
    project: VideoProject,
    reason: string,
    receiptOrChangedIds: MutationReceipt | readonly string[]
  ): Promise<void> {
    const receipt = Array.isArray(receiptOrChangedIds)
      ? undefined
      : receiptOrChangedIds as MutationReceipt
    const changedIds = receipt
      ? [...receipt.createdIds, ...receipt.changedIds, ...receipt.removedIds].map(({ id }) => id)
      : receiptOrChangedIds as readonly string[]
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.project-changed',
      payload: {
        schemaVersion: 1,
        projectId: project.id,
        revision: project.currentRevision,
        generation: project.eventGeneration,
        sequenceId: project.activeSequenceId,
        selectionGeneration: project.selection.generation,
        reason,
        changedIds: [...changedIds].slice(0, 2_000),
        ...(receipt ? {
          receipt: receipt as unknown as JsonObject,
          attribution: receipt.attribution,
          proofInvalidated: receipt.proofInvalidated
        } : {})
      }
    })
  }

  private async publishSelectionChange(updated: {
    projectId: string
    revision: number
    generation: number
    eventGeneration: number
    selection: VideoProject['selection']
  }): Promise<void> {
    await this.context.ui.postMessage({
      channel: 'kun-video-editor.selection-changed',
      payload: {
        schemaVersion: 1,
        projectId: updated.projectId,
        revision: updated.revision,
        generation: updated.generation,
        eventGeneration: updated.eventGeneration,
        selection: updated.selection
      }
    })
  }

  private async proofBindings(projectId: string): Promise<ProofArtifactBinding[]> {
    const page = await this.context.jobs.list({
      filter: { kinds: ['media.ffmpeg'], workspaceId: this.workspaceId() },
      limit: 200
    })
    const bindings: ProofArtifactBinding[] = []
    for (const snapshot of page.items) {
      if (bindings.length >= 16) break
      try {
        this.assertOwnedRenderSnapshot(snapshot)
        const record = await this.loadOrRecoverRenderRecord(snapshot)
        if (
          !record ||
          record.projectId !== projectId ||
          (record.renderKind !== 'proof-frame' && record.renderKind !== 'preview')
        ) continue
        const validation = snapshot.state === 'completed'
          ? await this.validateArtifacts(snapshot, record)
          : undefined
        bindings.push({
          id: record.jobId,
          kind: record.renderKind === 'proof-frame' ? 'proof' : 'preview',
          projectId: record.projectId,
          sequenceId: record.sequenceId,
          revision: record.pinnedRevision,
          irDigest: record.renderIrDigest,
          capabilitiesDigest: record.backendCapabilitiesDigest,
          ...(record.proofFrame === undefined ? {} : { frame: record.proofFrame }),
          status: snapshot.state === 'completed'
            ? validation?.valid ? 'ready' : 'invalid'
            : snapshot.state === 'failed' || snapshot.state === 'cancelled'
              ? 'failed'
              : snapshot.state === 'interrupted'
                ? 'interrupted'
                : 'pending'
        })
      } catch {
        // Ignore unowned or malformed jobs; they are not valid project evidence.
      }
    }
    return bindings
  }

  private async loadRenderRecord(jobId: string): Promise<RenderRecord | undefined> {
    let value: JsonValue | undefined
    try {
      value = await this.context.storage.workspace.get<JsonValue>(renderKey(jobId))
    } catch {
      return undefined
    }
    return storedRenderRecord(value, jobId)
  }

  private async loadProjectPackageRecord(
    jobId: string
  ): Promise<ProjectPackageExportRecord | undefined> {
    let value: JsonValue | undefined
    try {
      value = await this.context.storage.workspace.get<JsonValue>(projectPackageKey(jobId))
    } catch {
      return undefined
    }
    return storedProjectPackageRecord(value, jobId)
  }

  private async loadOtioExportRecord(jobId: string): Promise<OtioExportRecord | undefined> {
    let value: JsonValue | undefined
    try {
      value = await this.context.storage.workspace.get<JsonValue>(otioExportKey(jobId))
    } catch {
      return undefined
    }
    return storedOtioExportRecord(value, jobId)
  }

  private assertOwnedOtioExportSnapshot(snapshot: JobSnapshot): void {
    if (
      snapshot.ownerExtensionId !== this.context.extension.id ||
      snapshot.ownerExtensionVersion !== this.context.extension.version ||
      snapshot.workspaceId !== this.workspaceId() ||
      snapshot.kind !== 'media.ffmpeg' ||
      snapshot.initiatingOperation !== 'media.startFfmpegJob'
    ) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: 'The durable job is not an owned OTIO export in this workspace.',
        operation: 'video-interchange-status',
        retryable: false
      })
    }
  }

  private assertOwnedProjectPackageSnapshot(snapshot: JobSnapshot): void {
    if (
      snapshot.ownerExtensionId !== this.context.extension.id ||
      snapshot.ownerExtensionVersion !== this.context.extension.version ||
      snapshot.workspaceId !== this.workspaceId() ||
      snapshot.kind !== 'media.archive' ||
      snapshot.initiatingOperation !== 'media.startArchiveJob'
    ) {
      throw new ExtensionApiError({
        code: 'PERMISSION_DENIED',
        message: 'The durable job is not an owned project-package export in this workspace.',
        operation: 'video-project-package',
        retryable: false
      })
    }
  }

  private async loadOrRecoverRenderRecord(snapshot: JobSnapshot): Promise<RenderRecord | undefined> {
    const stored = await this.loadRenderRecord(snapshot.id)
    const recovered = recoverRenderRecord(snapshot)
    if (stored && (!recovered || sameRenderTrackingRecord(stored, recovered))) return stored
    if (!recovered) return stored
    try {
      await this.context.storage.workspace.set(renderKey(snapshot.id), recovered)
    } catch {
      // Core-owned result provenance remains the source of truth when extension storage is unavailable.
    }
    return recovered
  }

  private async currentRevision(projectId: string): Promise<number | undefined> {
    try {
      return (await this.service().loadProject(projectId)).currentRevision
    } catch {
      return undefined
    }
  }

  private async validateArtifacts(
    snapshot: JobSnapshot,
    record: RenderRecord | undefined
  ): Promise<{ valid: boolean; artifacts: GeneratedArtifact[]; reason?: string }> {
    if (snapshot.state !== 'completed') return { valid: false, artifacts: [] }
    const artifacts = snapshot.result?.generatedArtifacts ?? []
    if (!record || artifacts.length === 0 || artifacts.length !== record.expectedArtifacts.length) {
      return {
        valid: false,
        artifacts: [],
        reason: 'The completed job did not publish a verified artifact for its pinned render request.'
      }
    }
    try {
      const unmatchedExpected = [...record.expectedArtifacts]
      for (const artifact of artifacts) {
        if (
          artifact.ownerExtensionId !== this.context.extension.id ||
          artifact.ownerExtensionVersion !== this.context.extension.version ||
          artifact.workspaceId !== this.workspaceId() ||
          artifact.availability !== 'available' ||
          artifact.provenance.jobId !== snapshot.id ||
          artifact.byteSize <= 0
        ) {
          throw new Error('artifact identity does not match the pinned render')
        }
        const provenance = artifact.provenance.metadata
        if (
          !provenance ||
          provenance.projectId !== record.projectId ||
          provenance.sequenceId !== record.sequenceId ||
          provenance.pinnedRevision !== record.pinnedRevision ||
          provenance.renderIrDigest !== record.renderIrDigest ||
          provenance.backendCapabilitiesDigest !== record.backendCapabilitiesDigest ||
          !sameRenderRange(provenance.renderRange, record.renderRange) ||
          provenance.playbackMode !== record.playbackMode ||
          provenance.renderKind !== record.renderKind ||
          (record.requestedRenderKind !== undefined && provenance.requestedRenderKind !== record.requestedRenderKind) ||
          (record.advancedSettingsDigest !== undefined && provenance.advancedSettingsDigest !== record.advancedSettingsDigest) ||
          (record.advancedCapabilitiesDigest !== undefined && provenance.advancedCapabilitiesDigest !== record.advancedCapabilitiesDigest) ||
          (record.effectSemanticsDigest !== undefined && provenance.effectSemanticsDigest !== record.effectSemanticsDigest) ||
          (record.portableEquivalent !== undefined && provenance.portableEquivalent !== record.portableEquivalent) ||
          provenance.captionMode !== record.captionMode ||
          provenance.subtitleFormat !== record.subtitleFormat ||
          provenance.canvasPreset !== record.canvasPreset ||
          (record.proofFrame !== undefined && provenance.proofFrame !== record.proofFrame)
        ) {
          throw new Error('artifact provenance does not match the pinned render settings')
        }
        const expectedIndex = unmatchedExpected.findIndex((expected) =>
          expected.mediaKind === artifact.mediaKind && expected.mimeType === artifact.mimeType
        )
        if (expectedIndex < 0) throw new Error('artifact media type was not requested by the pinned render')
        unmatchedExpected.splice(expectedIndex, 1)
        const stat = await this.context.media.stat({ handleId: artifact.mediaHandleId })
        if (
          stat.revoked ||
          stat.byteSize === undefined ||
          stat.byteSize <= 0 ||
          (stat.completionIdentity !== undefined && stat.completionIdentity !== artifact.completionIdentity)
        ) {
          throw new Error('artifact media is unavailable or replaced')
        }
        if (artifact.mediaKind === 'video') {
          const probe = await this.context.media.probe({ handleId: artifact.mediaHandleId })
          const videoStream = probe.streams.find(({ kind }) => kind === 'video')
          if (
            !videoStream ||
            (probe.container.durationMicros ?? 0) <= 0 ||
            !matchesRenderedVideoTarget(record.renderKind, videoStream.codecName, probe.container.formatNames)
          ) {
            throw new Error('rendered video does not match the pinned codec/container target')
          }
        }
        if (artifact.mediaKind === 'audio') {
          const probe = await this.context.media.probe({ handleId: artifact.mediaHandleId })
          const audioStream = probe.streams.find(({ kind }) => kind === 'audio')
          if (
            !audioStream ||
            (probe.container.durationMicros ?? 0) <= 0 ||
            (record.renderKind === 'audio-aac' && audioStream.codecName?.toLocaleLowerCase() !== 'aac')
          ) {
            throw new Error('rendered audio does not match the pinned codec target')
          }
        }
        if (artifact.mediaKind === 'subtitle') {
          const probe = await this.context.media.probe({ handleId: artifact.mediaHandleId })
          if (!probe.streams.some(({ kind }) => kind === 'subtitle')) {
            throw new Error('subtitle artifact is missing a subtitle stream')
          }
        }
      }
      if (unmatchedExpected.length > 0) throw new Error('one or more requested artifacts are missing')
      return { valid: true, artifacts }
    } catch {
      return {
        valid: false,
        artifacts: [],
        reason: 'The job reached completed state, but the output failed bounded artifact or post-probe validation.'
      }
    }
  }
}

function result(content: JsonObject, summary: string, metadata?: JsonObject): ToolResult {
  return { content, summary, ...(metadata ? { metadata } : {}) }
}

function projectProjection(project: VideoProject, previewHistory: PreviewHistory = emptyPreviewHistory()): JsonObject {
  const transcripts: JsonObject[] = []
  let remainingSegments = MAX_TRANSCRIPT_SEGMENTS
  for (const transcript of project.transcripts.slice(0, MAX_TRANSCRIPTS)) {
    const limit = Math.max(0, remainingSegments)
    const projection = transcriptProjection(transcript, limit)
    remainingSegments -= Math.min(transcript.segments.length, limit)
    transcripts.push(projection)
  }
  const sequences = project.sequences.slice(0, MAX_SEQUENCES).map((sequence) => ({
    id: sequence.id,
    name: sequence.name,
    active: sequence.id === project.activeSequenceId,
    viewState: structuredClone(sequence.viewState),
    durationFrames: sequenceDurationFrames(sequence),
    itemCount: sequence.items.length,
    captionCount: sequence.captions.length,
    nestedByCount: project.sequences.reduce(
      (count, parent) => count + parent.items.filter(({ nestedSequenceId }) => nestedSequenceId === sequence.id).length,
      0
    )
  }))
  const projectedItemIds = new Set(project.items.slice(0, MAX_ITEMS).map(({ id }) => id))
  const activeLinkGroups = project.linkGroups.filter((group) =>
    group.itemIds.every((itemId) => project.items.some(({ id }) => id === itemId))
  )
  const linkGroups = activeLinkGroups
    .filter((group) => group.itemIds.some((itemId) => projectedItemIds.has(itemId)))
    .slice(0, MAX_LINK_GROUPS)
    .map((group) => structuredClone(group))
  const activePreviewIds = previewHistory.activeEntryId ? [previewHistory.activeEntryId] : []
  const selectionAttachment = buildVideoSelectionAttachment(project, activePreviewIds)
  const multicamGroups = (project.multicamGroups ?? [])
    .slice(0, MAX_MULTICAM_GROUPS)
    .map(multicamGroupProjection)
  return {
    // This is the bounded Host/View projection schema, not the durable project
    // document schema. Keep it stable while the on-disk project moves to v2.
    schemaVersion: 1,
    id: project.id,
    name: project.name,
    fps: project.fps,
    canvas: project.canvas,
    currentRevision: project.currentRevision,
    eventGeneration: project.eventGeneration,
    activeSequenceId: project.activeSequenceId,
    sequences,
    mediaFolders: (project.mediaFolders ?? []).slice(0, MAX_MEDIA_FOLDERS),
    linkGroups,
    multicamGroups,
    selection: project.selection,
    selectionAttachment: selectionAttachment as unknown as JsonObject,
    previewHistory: previewHistory as unknown as JsonObject,
    canUndo: project.undoStack.length > 0,
    canRedo: project.redoStack.length > 0,
    updatedAt: project.updatedAt,
    durationFrames: projectDurationFrames(project),
    playback: interactivePlaybackProjection(project),
    counts: {
      assets: project.assets.length,
      tracks: project.tracks.length,
      items: project.items.length,
      captions: project.captions.length,
      transcripts: project.transcripts.length,
      revisions: project.revisions.length,
      sequences: project.sequences.length,
      mediaFolders: project.mediaFolders?.length ?? 0,
      linkGroups: activeLinkGroups.length,
      multicamGroups: project.multicamGroups?.length ?? 0
    },
    hiddenCounts: {
      sequences: Math.max(0, project.sequences.length - sequences.length),
      mediaFolders: Math.max(0, (project.mediaFolders?.length ?? 0) - MAX_MEDIA_FOLDERS),
      linkGroups: Math.max(0, activeLinkGroups.length - linkGroups.length),
      multicamGroups: Math.max(0, (project.multicamGroups?.length ?? 0) - multicamGroups.length)
    },
    assets: project.assets.slice(0, MAX_ASSETS).map(assetProjection),
    tracks: project.tracks.slice(0, MAX_TRACKS),
    items: project.items.slice(0, MAX_ITEMS),
    captions: project.captions.slice(0, MAX_CAPTIONS),
    transcripts,
    revisions: project.revisions.slice(-50).map((entry) => ({
      revision: entry.revision,
      parentRevision: entry.parentRevision,
      author: entry.author,
      sourceOperation: entry.sourceOperation,
      timestamp: entry.timestamp,
      summary: entry.summary,
      restoredFromRevision: entry.restoredFromRevision ?? null
    }))
  }
}

function interactivePlaybackProjection(project: VideoProject): JsonObject {
  if (projectDurationFrames(project) <= 0) {
    return {
      mode: 'composed-proof',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision,
      irDigest: null,
      reasons: ['empty-timeline']
    }
  }
  try {
    const decision = resolveInteractivePlayback(compileRenderIr(project, { textPolicy: 'none' }))
    return {
      mode: decision.mode,
      projectId: decision.projectId,
      sequenceId: decision.sequenceId,
      revision: decision.revision,
      irDigest: decision.irDigest,
      sourceAssetId: decision.sourceId ?? null,
      reasons: decision.reasons
    }
  } catch {
    return {
      mode: 'composed-proof',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision,
      irDigest: null,
      reasons: ['render-ir-unavailable']
    }
  }
}

function projectProjectionIsTruncated(project: VideoProject): boolean {
  return project.assets.length > MAX_ASSETS ||
    project.tracks.length > MAX_TRACKS ||
    project.items.length > MAX_ITEMS ||
    project.captions.length > MAX_CAPTIONS ||
    project.sequences.length > MAX_SEQUENCES ||
    (project.mediaFolders?.length ?? 0) > MAX_MEDIA_FOLDERS ||
    (project.multicamGroups?.length ?? 0) > MAX_MULTICAM_GROUPS ||
    project.linkGroups.length > MAX_LINK_GROUPS ||
    project.transcripts.length > MAX_TRANSCRIPTS ||
    project.transcripts.reduce((total, transcript) => total + transcript.segments.length, 0) > MAX_TRANSCRIPT_SEGMENTS
}

function multicamGroupProjection(group: MulticamGroup): JsonObject {
  return {
    schemaVersion: group.schemaVersion,
    id: group.id,
    sequenceId: group.sequenceId,
    name: group.name,
    fps: structuredClone(group.fps),
    durationFrames: group.durationFrames,
    referenceMemberId: group.referenceMemberId,
    members: group.members.map((member) => ({
      id: member.id,
      assetId: member.assetId,
      memberLabel: member.memberLabel,
      angleLabel: member.angleLabel,
      sourceFps: structuredClone(member.sourceFps),
      sync: {
        status: member.sync.status,
        offsetFrames: member.sync.offsetFrames,
        ...(member.sync.confidence === undefined ? {} : { confidence: member.sync.confidence }),
        evidence: member.sync.evidence.map((evidence) => ({
          id: evidence.id,
          analysisId: evidence.analysisId,
          kind: evidence.kind,
          referenceMemberId: evidence.referenceMemberId,
          targetMemberId: evidence.targetMemberId,
          confidence: evidence.confidence,
          algorithmId: evidence.algorithmId,
          algorithmVersion: evidence.algorithmVersion
        }))
      },
      coverage: member.coverage.map((segment) => ({
        id: segment.id,
        startFrame: segment.startFrame,
        endFrame: segment.endFrame,
        sourceStartFrame: segment.sourceStartFrame,
        sourceEndFrame: segment.sourceEndFrame
      }))
    })),
    layouts: group.layouts.map((layout) => ({
      id: layout.id,
      label: layout.label,
      slots: layout.slots.map((slot) => ({ ...slot }))
    })),
    programFragments: group.programFragments.map((fragment) => ({
      id: fragment.id,
      startFrame: fragment.startFrame,
      endFrame: fragment.endFrame,
      selection: { ...fragment.selection }
    }))
  }
}

function assetProjection(asset: MediaAsset): JsonObject {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    mediaHandleId: asset.mediaHandleId ?? null,
    durationUs: asset.durationUs,
    container: asset.container,
    video: asset.video ?? null,
    audio: asset.audio ?? null,
    still: asset.still ?? null,
    folderId: asset.folderId ?? null,
    availability: asset.availability ?? 'online',
    sourceStatus: {
      availability: asset.availability ?? 'online',
      reason: asset.recovery?.reason ?? null,
      lastVerifiedAt: asset.recovery?.lastVerifiedAt ?? null
    },
    generatedLineage: asset.generatedLineage ? {
      providerId: asset.generatedLineage.providerId,
      modelId: asset.generatedLineage.modelId,
      jobId: asset.generatedLineage.jobId,
      promptDigest: asset.generatedLineage.promptDigest ?? null,
      referenceAssetIds: asset.generatedLineage.referenceAssetIds.slice(0, 32),
      variantOfAssetId: asset.generatedLineage.variantOfAssetId ?? null
    } : null,
    transcriptIds: asset.transcriptIds
  }
}

function generatedAssetFromMaterialization(
  project: VideoProject,
  materialization: GenerationMaterialization
): MediaAsset {
  const output = materialization.output
  const assetId = output.primary ? materialization.primaryAssetId : output.assetId
  const container = output.mimeType.split('/')[1]?.replace(/^x-/u, '').slice(0, 64) || 'generated'
  const defaultStillFrames = Math.max(1, Math.round(
    5 * project.fps.numerator / project.fps.denominator
  ))
  const durationUs = output.kind === 'image'
    ? Math.max(1, framesToMicroseconds(defaultStillFrames, project.fps))
    : output.durationUs
  if (durationUs === undefined) throw new ToolInputError('Verified generated media is missing its duration.')
  if ((output.kind === 'image' || output.kind === 'video') && (!output.width || !output.height)) {
    throw new ToolInputError('Verified generated visual media is missing its dimensions.')
  }
  return {
    id: assetId,
    name: output.displayName,
    kind: output.kind,
    mediaHandleId: output.outputHandleId,
    durationUs,
    container,
    ...(output.kind === 'video' ? {
      video: {
        codec: 'host-verified',
        width: output.width!,
        height: output.height!,
        frameRate: structuredClone(project.fps)
      }
    } : {}),
    ...(output.kind === 'image' ? {
      still: {
        width: output.width!,
        height: output.height!,
        format: container,
        animated: false
      }
    } : {}),
    ...(output.kind === 'audio' ? {
      audio: {
        codec: 'host-verified',
        sampleRate: output.sampleRate!,
        channels: output.channels!
      }
    } : {}),
    generatedLineage: {
      providerId: materialization.providerId,
      modelId: materialization.modelId,
      jobId: materialization.jobId,
      promptDigest: materialization.promptDigest,
      referenceAssetIds: materialization.referenceAssetIds.slice(0, 32),
      ...(!output.primary ? { variantOfAssetId: materialization.primaryAssetId } : {})
    },
    transcriptIds: [],
    availability: 'online',
    sourceIdentity: {
      algorithm: 'sha256',
      value: createHash('sha256').update(output.completionIdentity).digest('hex'),
      ...(output.byteSize === undefined ? {} : { sizeBytes: output.byteSize })
    }
  }
}

function sameGeneratedMaterialization(existing: MediaAsset, expected: MediaAsset): boolean {
  const left = existing.generatedLineage
  const right = expected.generatedLineage
  return existing.id === expected.id &&
    existing.kind === expected.kind &&
    existing.mediaHandleId === expected.mediaHandleId &&
    existing.container === expected.container &&
    existing.sourceIdentity?.algorithm === expected.sourceIdentity?.algorithm &&
    existing.sourceIdentity?.value === expected.sourceIdentity?.value &&
    existing.sourceIdentity?.sizeBytes === expected.sourceIdentity?.sizeBytes &&
    JSON.stringify(existing.video ?? null) === JSON.stringify(expected.video ?? null) &&
    JSON.stringify(existing.audio ?? null) === JSON.stringify(expected.audio ?? null) &&
    JSON.stringify(existing.still ?? null) === JSON.stringify(expected.still ?? null) &&
    left?.providerId === right?.providerId &&
    left?.modelId === right?.modelId &&
    left?.jobId === right?.jobId &&
    left?.promptDigest === right?.promptDigest &&
    left?.variantOfAssetId === right?.variantOfAssetId &&
    JSON.stringify(left?.referenceAssetIds ?? []) === JSON.stringify(right?.referenceAssetIds ?? [])
}

function generatedAssetSummary(asset: MediaAsset): JsonObject {
  return {
    id: asset.id,
    name: asset.name,
    kind: asset.kind,
    durationUs: asset.durationUs,
    availability: asset.availability ?? 'online',
    generatedLineage: asset.generatedLineage ? {
      providerId: asset.generatedLineage.providerId,
      modelId: asset.generatedLineage.modelId,
      jobId: asset.generatedLineage.jobId,
      promptDigest: asset.generatedLineage.promptDigest ?? null,
      referenceAssetIds: asset.generatedLineage.referenceAssetIds.slice(0, 32),
      variantOfAssetId: asset.generatedLineage.variantOfAssetId ?? null
    } : null
  }
}

function transcriptProjection(transcript: Transcript, limit: number): JsonObject {
  const segments = transcript.segments.slice(0, limit)
  return {
    id: transcript.id,
    assetId: transcript.assetId,
    language: transcript.language,
    provenance: transcript.provenance,
    segmentCount: transcript.segments.length,
    segments,
    truncated: transcript.segments.length > segments.length
  }
}

function probeProjection(probe: MediaProbeResult): JsonObject {
  return {
    schemaVersion: probe.schemaVersion,
    handleId: probe.handleId,
    container: probe.container,
    streams: probe.streams.slice(0, 32),
    truncated: probe.streams.length > 32
  }
}

function assetFromProbe(
  assetId: string,
  metadata: MediaMetadata,
  probe: MediaProbeResult,
  options: {
    assetKind?: 'image' | 'animation'
    stillDurationFrames?: number
    stillDurationUs?: number
    fps?: VideoProject['fps']
  } = {}
): MediaAsset {
  const video = probe.streams.find(({ kind }) => kind === 'video')
  const audio = probe.streams.find(({ kind }) => kind === 'audio')
  if (!video && !audio) throw new ToolInputError('The selected media has no supported audio or video stream.')
  const probedDurationUs = probe.container.durationMicros ?? Math.max(
    0,
    ...probe.streams.map(({ durationMicros }) => durationMicros ?? 0)
  )
  const imageLike = metadata.kind === 'image'
  if (options.assetKind && !imageLike) {
    throw new ToolInputError('assetKind image/animation is only valid for a Host-granted image resource.')
  }
  if (imageLike) {
    if (!video?.width || !video.height) {
      throw new ToolInputError('The image probe did not provide bounded dimensions.')
    }
    const kind = options.assetKind ?? inferredImageAssetKind(metadata, probe)
    const fallbackDurationUs = options.stillDurationUs ?? framesToMicroseconds(
      options.stillDurationFrames ?? 150,
      options.fps ?? { numerator: 30, denominator: 1 }
    )
    const durationUs = kind === 'animation' && probedDurationUs > 0 ? probedDurationUs : fallbackDurationUs
    if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
      throw new ToolInputError('The image duration must be a positive bounded value.')
    }
    const format = (probe.container.formatNames[0] ?? extensionOf(metadata.displayName) ?? 'image').slice(0, 64)
    return {
      id: assetId,
      name: metadata.displayName,
      kind,
      mediaHandleId: metadata.handleId,
      durationUs,
      container: probe.container.formatNames.join(',').slice(0, 64) || format,
      still: {
        width: video.width,
        height: video.height,
        format,
        animated: kind === 'animation',
        ...(kind === 'animation' ? {
          frameRate: video.frameRate ?? options.fps ?? { numerator: 30, denominator: 1 },
          loop: true
        } : {})
      },
      transcriptIds: []
    }
  }
  const durationUs = probedDurationUs
  if (!Number.isSafeInteger(durationUs) || durationUs <= 0) {
    throw new ToolInputError('The selected media has no positive bounded duration.')
  }
  if (video && (!video.codecName || !video.width || !video.height || !video.frameRate)) {
    throw new ToolInputError('The video probe did not provide codec, dimensions, and rational frame rate.')
  }
  if (audio && (!audio.codecName || !audio.sampleRate || !audio.channelCount)) {
    throw new ToolInputError('The audio probe did not provide codec, sample rate, and channel count.')
  }
  const rotation = video?.rotationDegrees === undefined
    ? undefined
    : normalizeRotation(video.rotationDegrees)
  return {
    id: assetId,
    name: metadata.displayName,
    kind: video ? 'video' : 'audio',
    mediaHandleId: metadata.handleId,
    durationUs,
    container: probe.container.formatNames.join(',').slice(0, 64) || 'unknown',
    ...(video ? {
      video: {
        codec: video.codecName!,
        width: video.width!,
        height: video.height!,
        frameRate: video.frameRate!,
        ...(rotation === undefined ? {} : { rotation })
      }
    } : {}),
    ...(audio ? {
      audio: {
        codec: audio.codecName!,
        sampleRate: audio.sampleRate!,
        channels: audio.channelCount!
      }
    } : {}),
    transcriptIds: []
  }
}

function initialItem(project: VideoProject, asset: MediaAsset): TimelineItem {
  const kind = asset.kind === 'audio' ? 'audio' : 'video'
  const track = project.tracks.find((candidate) => candidate.kind === kind)
  if (!track) throw new ToolInputError(`The active sequence has no ${kind} track for ${asset.id}.`)
  const trackId = track.id
  const end = project.items
    .filter((item) => item.trackId === trackId)
    .reduce((maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames), 0)
  return {
    id: `item-${asset.id}`,
    assetId: asset.id,
    trackId,
    timelineStartFrame: end,
    durationFrames: Math.max(1, microsecondsToFrames(asset.durationUs, project.fps)),
    sourceStartUs: 0,
    sourceEndUs: asset.durationUs,
    speed: { numerator: 1, denominator: 1 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0
  }
}

function inferredImageAssetKind(metadata: MediaMetadata, probe: MediaProbeResult): 'image' | 'animation' {
  const formats = probe.container.formatNames.map((value) => value.toLocaleLowerCase())
  const extension = extensionOf(metadata.displayName)
  return formats.some((value) => value === 'gif' || value === 'apng') || extension === 'gif' || extension === 'apng'
    ? 'animation'
    : 'image'
}

function interchangeMappingPreview(
  mappings: ReturnType<typeof exportProjectToOtio>['timecodeMappings']
): { items: ReturnType<typeof exportProjectToOtio>['timecodeMappings']; truncated: number } {
  return {
    items: mappings.slice(0, INTERCHANGE_MAPPING_PREVIEW_LIMIT),
    truncated: Math.max(0, mappings.length - INTERCHANGE_MAPPING_PREVIEW_LIMIT)
  }
}

function interchangeProjectSummary(project: VideoProject): JsonObject {
  return {
    id: project.id,
    name: project.name,
    schemaVersion: project.schemaVersion,
    revision: project.currentRevision,
    activeSequenceId: project.activeSequenceId,
    fps: project.fps,
    canvas: project.canvas,
    counts: {
      assets: project.assets.length,
      sequences: project.sequences.length,
      tracks: project.sequences.reduce((total, sequence) => total + sequence.tracks.length, 0),
      items: project.sequences.reduce((total, sequence) => total + sequence.items.length, 0),
      captions: project.sequences.reduce((total, sequence) => total + sequence.captions.length, 0),
      transcripts: project.transcripts.length
    }
  }
}

function packageAssetIds(project: VideoProject, value: unknown): Set<string> {
  if (value === undefined) return new Set(project.assets.map(({ id }) => id))
  const values = boundedArray(value, 'assetIds', 0, PROJECT_PACKAGE_LIMITS.mediaAssets)
    .map((entry, index) => stableId(entry, `assetIds[${index}]`))
  if (new Set(values).size !== values.length) {
    throw new ToolInputError('assetIds must not contain duplicate stable identities.')
  }
  const available = new Set(project.assets.map(({ id }) => id))
  const unknown = values.find((assetId) => !available.has(assetId))
  if (unknown) throw new ToolInputError(`assetIds contains unknown asset ${unknown}.`)
  return new Set(values)
}

function packageMissingPolicy(value: unknown): 'fail' | 'omit' {
  if (value === undefined) return 'fail'
  const selected = enumValue(
    value,
    ['fail', 'omit', 'record-incomplete'] as const,
    'missingMediaPolicy'
  )
  return selected === 'record-incomplete' ? 'omit' : selected
}

function safeProjectPackageName(value: string): string {
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'kun-video-project'
  const safe = leaf
    .replace(/[^A-Za-z0-9._~-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 120)
  return safe || 'kun-video-project'
}

function safeInterchangeName(value: string): string {
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'kun-video-project'
  const safe = leaf
    .normalize('NFKC')
    .replace(/[^A-Za-z0-9._~-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 100)
  return safe || 'kun-video-project'
}

function safeInterchangeDisplayName(value: string): string {
  const leaf = value.split(/[\\/]/u).filter(Boolean).at(-1) ?? 'timeline.otio'
  return replaceAsciiControlCharacters(leaf, '').slice(0, 256) || 'timeline.otio'
}

function suggestedImportProjectId(sourceProjectId: string, existing: ReadonlySet<string>): string {
  for (let suffix = 1; suffix <= 10_000; suffix += 1) {
    const label = suffix === 1 ? '-import' : `-import-${suffix}`
    const candidate = `${sourceProjectId.slice(0, 128 - label.length)}${label}`
    if (!existing.has(candidate)) return candidate
  }
  throw new ToolInputError('No bounded project identity is available for this OTIO import.')
}

function sha256Digest(value: unknown, name: string): string {
  const digest = boundedString(value, name, 64, 64)
  if (!/^[a-f0-9]{64}$/u.test(digest)) throw new ToolInputError(`${name} must be a SHA-256 digest.`)
  return digest
}

function projectPackageKey(jobId: string): string {
  return `${PROJECT_PACKAGE_RECORD_PREFIX}${jobId}`
}

function otioExportKey(jobId: string): string {
  return `${OTIO_EXPORT_RECORD_PREFIX}${jobId}`
}

function storedOtioExportRecord(
  value: JsonValue | undefined,
  expectedJobId: string
): OtioExportRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const record = value as Record<string, JsonValue | undefined>
    if (record.schemaVersion !== 1 || record.adapterId !== 'kun.otio-json' ||
      record.adapterVersion !== '1.0.0') return undefined
    const jobId = boundedString(record.jobId, 'stored OTIO jobId', 8, 512)
    if (jobId !== expectedJobId || !isSha256Digest(record.documentDigest) ||
      !isSha256Digest(record.projectDigest)) return undefined
    const createdAt = boundedString(record.createdAt, 'stored OTIO createdAt', 1, 64)
    if (!Number.isFinite(Date.parse(createdAt))) return undefined
    const lossManifest = storedInterchangeLossManifest(record.lossManifest)
    if (!lossManifest) return undefined
    const documentBytes = nonNegativeInteger(record.documentBytes, 'stored OTIO documentBytes')
    if (documentBytes < 1 || documentBytes > MAX_MEDIA_OTIO_TEXT_BYTES) return undefined
    return {
      schemaVersion: 1,
      jobId,
      projectId: stableId(record.projectId, 'stored OTIO projectId'),
      sequenceId: stableId(record.sequenceId, 'stored OTIO sequenceId'),
      pinnedRevision: nonNegativeInteger(record.pinnedRevision, 'stored OTIO pinnedRevision'),
      adapterId: 'kun.otio-json',
      adapterVersion: '1.0.0',
      documentDigest: record.documentDigest,
      projectDigest: record.projectDigest,
      documentBytes,
      lossManifest,
      createdAt
    }
  } catch {
    return undefined
  }
}

function storedInterchangeLossManifest(value: unknown): InterchangeLossManifest | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const manifest = value as Record<string, unknown>
  if (
    manifest.adapterId !== 'kun.otio-json' || manifest.adapterVersion !== '1.0.0' ||
    typeof manifest.portableLossless !== 'boolean' ||
    typeof manifest.kunRoundTripLossless !== 'boolean' ||
    !Number.isSafeInteger(manifest.truncated) || Number(manifest.truncated) < 0 ||
    !Array.isArray(manifest.entries) || manifest.entries.length > 128
  ) return undefined
  const entries = manifest.entries.flatMap((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return []
    const candidate = entry as Record<string, unknown>
    if (
      typeof candidate.code !== 'string' || candidate.code.length < 1 || candidate.code.length > 128 ||
      (candidate.severity !== 'info' && candidate.severity !== 'warning') ||
      typeof candidate.feature !== 'string' || candidate.feature.length < 1 || candidate.feature.length > 128 ||
      typeof candidate.nodeId !== 'string' || candidate.nodeId.length < 1 || candidate.nodeId.length > 128 ||
      (candidate.preservation !== 'otio-standard' && candidate.preservation !== 'kun-metadata') ||
      typeof candidate.message !== 'string' || candidate.message.length < 1 || candidate.message.length > 1_024
    ) return []
    return [{
      code: candidate.code,
      severity: candidate.severity as 'info' | 'warning',
      feature: candidate.feature,
      nodeId: candidate.nodeId,
      preservation: candidate.preservation as 'otio-standard' | 'kun-metadata',
      message: candidate.message
    }]
  })
  if (entries.length !== manifest.entries.length) return undefined
  return {
    adapterId: 'kun.otio-json',
    adapterVersion: '1.0.0',
    portableLossless: manifest.portableLossless,
    kunRoundTripLossless: manifest.kunRoundTripLossless,
    entries,
    truncated: Number(manifest.truncated)
  }
}

function otioExportJobProjection(
  snapshot: JobSnapshot,
  record: OtioExportRecord,
  currentRevision: number | undefined
): JsonObject {
  return {
    jobId: snapshot.id,
    kind: snapshot.kind,
    state: snapshot.state,
    cursor: snapshot.latestCursor,
    projectId: record.projectId,
    sequenceId: record.sequenceId,
    pinnedRevision: record.pinnedRevision,
    currentRevision: currentRevision ?? null,
    stale: currentRevision !== undefined && currentRevision !== record.pinnedRevision,
    adapterId: record.adapterId,
    adapterVersion: record.adapterVersion,
    documentDigest: record.documentDigest,
    projectDigest: record.projectDigest,
    documentBytes: record.documentBytes,
    lossManifest: record.lossManifest as unknown as JsonValue,
    ...(snapshot.progress ? { progress: snapshot.progress as unknown as JsonObject } : {}),
    ...(snapshot.error ? { error: snapshot.error as unknown as JsonObject } : {})
  }
}

function validOtioArtifacts(
  snapshot: JobSnapshot,
  record: OtioExportRecord
): GeneratedArtifact[] {
  const artifacts = snapshot.result?.generatedArtifacts ?? []
  if (artifacts.length !== 1) return []
  const artifact = artifacts[0]!
  const metadata = artifact.provenance.metadata
  if (
    artifact.availability !== 'available' ||
    artifact.mediaKind !== 'document' ||
    artifact.mimeType !== OTIO_OUTPUT_MIME_TYPE ||
    artifact.provenance.jobId !== snapshot.id ||
    artifact.provenance.operation !== 'media.startFfmpegJob' ||
    metadata?.projectId !== record.projectId ||
    metadata?.pinnedRevision !== record.pinnedRevision ||
    metadata?.interchangeAdapterId !== record.adapterId ||
    metadata?.interchangeAdapterVersion !== record.adapterVersion ||
    metadata?.documentDigest !== record.documentDigest ||
    metadata?.projectDigest !== record.projectDigest ||
    metadata?.lossCount !== record.lossManifest.entries.length ||
    metadata?.portableLossless !== record.lossManifest.portableLossless ||
    metadata?.kunRoundTripLossless !== record.lossManifest.kunRoundTripLossless
  ) return []
  return [artifact]
}

function storedProjectPackageRecord(
  value: JsonValue | undefined,
  expectedJobId: string
): ProjectPackageExportRecord | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  try {
    const record = value as Record<string, JsonValue | undefined>
    if (record.schemaVersion !== 1) return undefined
    const jobId = boundedString(record.jobId, 'stored package jobId', 1, 256)
    if (jobId !== expectedJobId) return undefined
    const missingMediaPolicy = enumValue(
      record.missingMediaPolicy,
      ['fail', 'omit'] as const,
      'stored package missingMediaPolicy'
    )
    const missingAssetIds = boundedArray(
      record.missingAssetIds,
      'stored package missingAssetIds',
      0,
      PROJECT_PACKAGE_LIMITS.mediaAssets
    ).map((entry, index) => stableId(entry, `stored package missingAssetIds[${index}]`))
    if (typeof record.complete !== 'boolean') return undefined
    const createdAt = boundedString(record.createdAt, 'stored package createdAt', 1, 64)
    if (!Number.isFinite(Date.parse(createdAt))) return undefined
    if (!isSha256Digest(record.manifestDigest)) return undefined
    return {
      schemaVersion: 1,
      jobId,
      projectId: stableId(record.projectId, 'stored package projectId'),
      sequenceId: stableId(record.sequenceId, 'stored package sequenceId'),
      pinnedRevision: nonNegativeInteger(record.pinnedRevision, 'stored package pinnedRevision'),
      packageId: stableId(record.packageId, 'stored package packageId'),
      manifestDigest: record.manifestDigest,
      complete: record.complete,
      selectedAssetCount: nonNegativeInteger(
        record.selectedAssetCount,
        'stored package selectedAssetCount'
      ),
      embeddedAssetCount: nonNegativeInteger(
        record.embeddedAssetCount,
        'stored package embeddedAssetCount'
      ),
      uniqueMediaCount: nonNegativeInteger(
        record.uniqueMediaCount,
        'stored package uniqueMediaCount'
      ),
      deduplicatedAssetCount: nonNegativeInteger(
        record.deduplicatedAssetCount,
        'stored package deduplicatedAssetCount'
      ),
      missingAssetIds,
      missingMediaPolicy,
      createdAt
    }
  } catch {
    return undefined
  }
}

function projectPackageJobProjection(
  snapshot: JobSnapshot,
  record: ProjectPackageExportRecord
): JsonObject {
  return {
    jobId: snapshot.id,
    kind: snapshot.kind,
    state: snapshot.state,
    cursor: snapshot.latestCursor,
    projectId: record.projectId,
    sequenceId: record.sequenceId,
    pinnedRevision: record.pinnedRevision,
    packageId: record.packageId,
    manifestDigest: record.manifestDigest,
    complete: record.complete,
    selectedAssetCount: record.selectedAssetCount,
    embeddedAssetCount: record.embeddedAssetCount,
    uniqueMediaCount: record.uniqueMediaCount,
    deduplicatedAssetCount: record.deduplicatedAssetCount,
    missingAssetIds: record.missingAssetIds,
    missingMediaPolicy: record.missingMediaPolicy,
    ...(snapshot.progress ? { progress: snapshot.progress as unknown as JsonObject } : {}),
    ...(snapshot.error ? { error: snapshot.error as unknown as JsonObject } : {}),
    ...(snapshot.result?.data === undefined ? {} : { result: snapshot.result.data })
  }
}

function extensionOf(name: string): string | undefined {
  const match = /\.([A-Za-z0-9]{1,16})$/u.exec(name)
  return match?.[1]?.toLocaleLowerCase()
}

function normalizeRotation(value: number): 0 | 90 | 180 | 270 {
  const normalized = ((value % 360) + 360) % 360
  const candidates = [0, 90, 180, 270] as const
  return candidates.reduce((closest, candidate) =>
    Math.abs(candidate - normalized) < Math.abs(closest - normalized) ? candidate : closest
  )
}

function renderFileName(
  project: VideoProject,
  kind: RenderKind,
  subtitleFormat: 'srt' | 'vtt' = 'srt'
): string {
  const suffix = kind === 'proof-frame'
    ? 'proof.png'
    : kind === 'audio-aac'
      ? 'audio.m4a'
      : kind === 'subtitles'
        ? `captions.${subtitleFormat}`
        : kind === 'prores-mov'
          ? 'video.mov'
          : kind === 'ffv1-mkv'
            ? 'video.mkv'
            : 'video.mp4'
  return `${project.id}-revision-${project.currentRevision}-${suffix}`
}

function renderFilter(
  kind: RenderKind,
  subtitleFormat: 'srt' | 'vtt' = 'srt'
): { name: string; extensions: string[]; mimeTypes: string[] } {
  if (kind === 'proof-frame') return { name: 'PNG image', extensions: ['png'], mimeTypes: ['image/png'] }
  if (kind === 'audio-aac') return { name: 'AAC audio', extensions: ['m4a'], mimeTypes: ['audio/mp4'] }
  if (kind === 'subtitles') return subtitleFormat === 'srt'
    ? { name: 'SubRip captions', extensions: ['srt'], mimeTypes: ['application/x-subrip'] }
    : { name: 'WebVTT captions', extensions: ['vtt'], mimeTypes: ['text/vtt'] }
  if (kind === 'h265-mp4') return { name: 'H.265 video', extensions: ['mp4'], mimeTypes: ['video/mp4'] }
  if (kind === 'prores-mov') return { name: 'ProRes video', extensions: ['mov'], mimeTypes: ['video/quicktime'] }
  if (kind === 'ffv1-mkv') return { name: 'FFV1 video', extensions: ['mkv'], mimeTypes: ['video/x-matroska'] }
  return { name: 'H.264 video', extensions: ['mp4'], mimeTypes: ['video/mp4'] }
}

function matchesRenderedVideoTarget(
  kind: RenderKind,
  codecName: string | undefined,
  formatNames: readonly string[]
): boolean {
  const codec = codecName?.toLocaleLowerCase()
  const formats = new Set(formatNames
    .flatMap((value) => value.toLocaleLowerCase().split(','))
    .map((value) => value.trim()))
  if (kind === 'preview' || kind === 'h264-mp4') {
    return codec === 'h264' && (formats.has('mp4') || formats.has('mov'))
  }
  if (kind === 'h265-mp4') {
    return (codec === 'hevc' || codec === 'h265') && (formats.has('mp4') || formats.has('mov'))
  }
  if (kind === 'prores-mov') {
    return Boolean(codec?.startsWith('prores')) && (formats.has('mov') || formats.has('mp4'))
  }
  if (kind === 'ffv1-mkv') {
    return codec === 'ffv1' && (formats.has('matroska') || formats.has('webm'))
  }
  return false
}

function isRequestedFinalVideoKind(
  kind: RenderKind
): kind is 'h264-mp4' | 'h265-mp4' | 'prores-mov' {
  return kind === 'h264-mp4' || kind === 'h265-mp4' || kind === 'prores-mov'
}

function professionalRenderSettings(
  project: VideoProject,
  kind: RenderKind,
  input: ToolInput
): AdvancedExportSettings | undefined {
  const keys = [
    'width', 'height', 'frameRate', 'quality', 'acceleration',
    'allowPortableEquivalent', 'audio'
  ] as const
  const hasSettings = keys.some((key) => input[key] !== undefined)
  if (!isRequestedFinalVideoKind(kind)) {
    if (hasSettings) {
      throw new ToolInputError('Professional codec, quality, resolution, and acceleration settings require a final video render.')
    }
    return undefined
  }
  if (kind === 'h264-mp4' && !hasSettings) return undefined
  const format: AdvancedExportSettings['format'] = kind
  const timelineHasAudio = project.items.some((item) =>
    project.assets.some((asset) => asset.id === item.assetId && asset.audio !== undefined)
  )
  let audio: AdvancedExportSettings['audio']
  if (input.audio !== undefined) {
    const value = asRecord(input.audio, 'audio')
    exactKeys(value, ['codec', 'sampleRate', 'channels', 'bitrateKbps'])
    const codec = enumValue(value.codec, ['aac', 'pcm-s24', 'flac'] as const, 'audio.codec')
    const requestedSampleRate = boundedPositiveInteger(value.sampleRate, 'audio.sampleRate', 44_100, 96_000)
    if (![44_100, 48_000, 96_000].includes(requestedSampleRate)) {
      throw new ToolInputError('audio.sampleRate contains an unsupported value.')
    }
    const sampleRate = requestedSampleRate as 44_100 | 48_000 | 96_000
    audio = {
      codec,
      sampleRate,
      channels: boundedPositiveInteger(value.channels, 'audio.channels', 1, 16),
      ...(value.bitrateKbps === undefined ? {} : {
        bitrateKbps: boundedPositiveInteger(value.bitrateKbps, 'audio.bitrateKbps', 32, 1_536)
      })
    }
  } else if (timelineHasAudio) {
    audio = {
      codec: format === 'prores-mov' ? 'pcm-s24' : 'aac',
      sampleRate: 48_000,
      channels: 2,
      ...(format === 'prores-mov' ? {} : { bitrateKbps: 192 })
    }
  }
  return {
    format,
    width: input.width === undefined
      ? project.canvas.width
      : boundedPositiveInteger(input.width, 'width', 2, 16_384),
    height: input.height === undefined
      ? project.canvas.height
      : boundedPositiveInteger(input.height, 'height', 2, 16_384),
    frameRate: input.frameRate === undefined ? structuredClone(project.fps) : rational(input.frameRate, 'frameRate'),
    quality: input.quality === undefined
      ? 'high'
      : enumValue(input.quality, ['draft', 'balanced', 'high', 'master'] as const, 'quality'),
    acceleration: input.acceleration === undefined
      ? 'cpu'
      : enumValue(input.acceleration, ['cpu', 'prefer-gpu', 'require-gpu'] as const, 'acceleration'),
    allowPortableEquivalent: optionalBoolean(input.allowPortableEquivalent, 'allowPortableEquivalent') ?? false,
    ...(audio ? { audio } : {})
  }
}

function jobReferenceProjection(
  job: { jobId: string; kind: string; state: string; cursor: string },
  purpose: string
): JsonObject {
  return { purpose, jobId: job.jobId, kind: job.kind, state: job.state, cursor: job.cursor }
}

function renderKey(jobId: string): string {
  return `${RENDER_RECORD_PREFIX}${jobId}`
}

function ffmpegRenderBackendCapabilities(capabilities: MediaCapabilities): RenderBackendCapabilities {
  const profile = defaultFfmpegCapabilities()
  const features = new Set(capabilities.ffmpeg.features)
  return {
    ...profile,
    version: capabilities.ffmpeg.version ?? 'unknown',
    codecs: capabilities.ffmpeg.available
      ? [
          'png',
          ...(features.has('libx264-encoder') ? ['h264'] : []),
          ...(features.has('aac-encoder') ? ['aac'] : [])
        ]
      : [],
    filters: capabilities.ffmpeg.available
      ? profile.filters.filter((filter) =>
          filter !== 'drawtext' || features.has('drawtext-filter'))
      : [],
    // The broker currently exposes encoder/filter inventory, not an arbitrary
    // system-font catalog. Advertise only the generic family used by the
    // canonical default so custom font requests fail visibly before export.
    fonts: capabilities.ffmpeg.available && features.has('drawtext-filter') ? ['sans-serif'] : []
  }
}

function textRenderBackendCapabilities(): RenderBackendCapabilities {
  const profile = defaultFfmpegCapabilities()
  return {
    ...profile,
    id: 'kun-text-output',
    version: '1',
    codecs: [],
    filters: [],
    effects: [],
    colorSpaces: [],
    fonts: []
  }
}

function storedRenderRecord(value: JsonValue | undefined, jobId: string): RenderRecord | undefined {
  if (value === undefined || value === null || typeof value !== 'object' || Array.isArray(value)) {
    return undefined
  }
  const record = value as ToolInput
  if (
    record.schemaVersion !== 1 ||
    record.jobId !== jobId ||
    typeof record.projectId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(record.projectId) ||
    record.projectId === '.' ||
    record.projectId === '..' ||
    typeof record.sequenceId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(record.sequenceId) ||
    !Number.isSafeInteger(record.pinnedRevision) ||
    Number(record.pinnedRevision) < 0 ||
    !isSha256Digest(record.renderIrDigest) ||
    !isSha256Digest(record.backendCapabilitiesDigest) ||
    !isRenderRange(record.renderRange) ||
    (record.playbackMode !== 'source-fast-path' && record.playbackMode !== 'composed-proof') ||
    !['proof-frame', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'ffv1-mkv', 'audio-aac', 'subtitles'].includes(String(record.renderKind)) ||
    (record.requestedRenderKind !== undefined &&
      !['h264-mp4', 'h265-mp4', 'prores-mov'].includes(String(record.requestedRenderKind))) ||
    (record.advancedSettingsDigest !== undefined && !isSha256Digest(record.advancedSettingsDigest)) ||
    (record.advancedCapabilitiesDigest !== undefined && !isSha256Digest(record.advancedCapabilitiesDigest)) ||
    (record.effectSemanticsDigest !== undefined && !isSha256Digest(record.effectSemanticsDigest)) ||
    (record.portableEquivalent !== undefined && typeof record.portableEquivalent !== 'boolean') ||
    !['none', 'burned', 'sidecar', 'both'].includes(String(record.captionMode)) ||
    (record.subtitleFormat !== 'srt' && record.subtitleFormat !== 'vtt') ||
    !['16:9', '9:16', '1:1'].includes(String(record.canvasPreset)) ||
    (record.proofFrame !== undefined &&
      (!Number.isSafeInteger(record.proofFrame) || Number(record.proofFrame) < 0)) ||
    (record.renderKind === 'proof-frame') !== (record.proofFrame !== undefined) ||
    typeof record.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(record.createdAt)) ||
    !Array.isArray(record.expectedArtifacts) ||
    record.expectedArtifacts.length < 1 ||
    record.expectedArtifacts.length > 2
  ) {
    return undefined
  }
  const candidate = record as RenderRecord
  const expected = expectedArtifactsFromRenderRecordFields(candidate)
  if (
    !expected ||
    expected.length !== candidate.expectedArtifacts.length ||
    !expected.every((artifact, index) => {
      const actual = candidate.expectedArtifacts[index]
      return actual?.mediaKind === artifact.mediaKind && actual.mimeType === artifact.mimeType
    })
  ) {
    return undefined
  }
  return candidate
}

function recoverRenderRecord(snapshot: JobSnapshot): RenderRecord | undefined {
  if (snapshot.kind !== 'media.ffmpeg' || snapshot.initiatingOperation !== 'media.startFfmpegJob') {
    return undefined
  }
  const artifacts = snapshot.result?.generatedArtifacts ?? []
  if (artifacts.length === 0) return undefined
  const fields = renderRecordFieldsFromArtifact(artifacts[0]!, snapshot)
  if (!fields) return undefined
  for (const artifact of artifacts.slice(1)) {
    const candidate = renderRecordFieldsFromArtifact(artifact, snapshot)
    if (!candidate || !sameRenderRecordFields(fields, candidate)) return undefined
  }
  const expectedArtifacts = expectedArtifactsFromRenderRecordFields(fields)
  if (!expectedArtifacts) return undefined
  return {
    schemaVersion: 1,
    jobId: snapshot.id,
    ...fields,
    expectedArtifacts,
    createdAt: snapshot.createdAt
  }
}

function renderRecordFieldsFromArtifact(
  artifact: GeneratedArtifact,
  snapshot: JobSnapshot
): Omit<RenderRecord, 'schemaVersion' | 'jobId' | 'expectedArtifacts' | 'createdAt'> | undefined {
  if (
    artifact.ownerExtensionId !== snapshot.ownerExtensionId ||
    artifact.ownerExtensionVersion !== snapshot.ownerExtensionVersion ||
    artifact.workspaceId !== snapshot.workspaceId ||
    artifact.provenance.jobId !== snapshot.id ||
    artifact.provenance.operation !== snapshot.initiatingOperation ||
    !['image', 'video', 'audio', 'subtitle'].includes(artifact.mediaKind)
  ) return undefined
  const metadata = artifact.provenance.metadata
  if (!metadata) return undefined
  const projectId = metadata.projectId
  const sequenceId = metadata.sequenceId
  const pinnedRevision = metadata.pinnedRevision
  const renderIrDigest = metadata.renderIrDigest
  const backendCapabilitiesDigest = metadata.backendCapabilitiesDigest
  const renderRange = metadata.renderRange
  const playbackMode = metadata.playbackMode
  const renderKind = metadata.renderKind
  const requestedRenderKind = metadata.requestedRenderKind === null
    ? undefined
    : metadata.requestedRenderKind
  const advancedSettingsDigest = metadata.advancedSettingsDigest === null
    ? undefined
    : metadata.advancedSettingsDigest
  const advancedCapabilitiesDigest = metadata.advancedCapabilitiesDigest === null
    ? undefined
    : metadata.advancedCapabilitiesDigest
  const effectSemanticsDigest = metadata.effectSemanticsDigest === null
    ? undefined
    : metadata.effectSemanticsDigest
  const portableEquivalent = metadata.portableEquivalent === null
    ? undefined
    : metadata.portableEquivalent
  const captionMode = metadata.captionMode
  const subtitleFormat = metadata.subtitleFormat
  const canvasPreset = metadata.canvasPreset
  const proofFrame = metadata.proofFrame === null ? undefined : metadata.proofFrame
  if (
    typeof projectId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(projectId) ||
    typeof sequenceId !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(sequenceId) ||
    !Number.isSafeInteger(pinnedRevision) || Number(pinnedRevision) < 0 ||
    !isSha256Digest(renderIrDigest) ||
    !isSha256Digest(backendCapabilitiesDigest) ||
    !isRenderRange(renderRange) ||
    (playbackMode !== 'source-fast-path' && playbackMode !== 'composed-proof') ||
    !['proof-frame', 'preview', 'h264-mp4', 'h265-mp4', 'prores-mov', 'ffv1-mkv', 'audio-aac', 'subtitles'].includes(String(renderKind)) ||
    (requestedRenderKind !== undefined &&
      !['h264-mp4', 'h265-mp4', 'prores-mov'].includes(String(requestedRenderKind))) ||
    (advancedSettingsDigest !== undefined && !isSha256Digest(advancedSettingsDigest)) ||
    (advancedCapabilitiesDigest !== undefined && !isSha256Digest(advancedCapabilitiesDigest)) ||
    (effectSemanticsDigest !== undefined && !isSha256Digest(effectSemanticsDigest)) ||
    (portableEquivalent !== undefined && typeof portableEquivalent !== 'boolean') ||
    !['none', 'burned', 'sidecar', 'both'].includes(String(captionMode)) ||
    (subtitleFormat !== 'srt' && subtitleFormat !== 'vtt') ||
    !['16:9', '9:16', '1:1'].includes(String(canvasPreset)) ||
    (proofFrame !== undefined && (!Number.isSafeInteger(proofFrame) || Number(proofFrame) < 0)) ||
    (renderKind === 'proof-frame') !== (proofFrame !== undefined)
  ) return undefined
  return {
    projectId,
    sequenceId,
    pinnedRevision: Number(pinnedRevision),
    renderIrDigest,
    backendCapabilitiesDigest,
    renderRange,
    playbackMode,
    renderKind: renderKind as RenderKind,
    ...(requestedRenderKind === undefined ? {} : {
      requestedRenderKind: requestedRenderKind as RenderRecord['requestedRenderKind']
    }),
    ...(advancedSettingsDigest === undefined ? {} : { advancedSettingsDigest }),
    ...(advancedCapabilitiesDigest === undefined ? {} : { advancedCapabilitiesDigest }),
    ...(effectSemanticsDigest === undefined ? {} : { effectSemanticsDigest }),
    ...(portableEquivalent === undefined ? {} : { portableEquivalent }),
    captionMode: captionMode as RenderRecord['captionMode'],
    subtitleFormat,
    canvasPreset: canvasPreset as VideoProject['canvas']['preset'],
    ...(proofFrame !== undefined ? { proofFrame: Number(proofFrame) } : {})
  }
}

function sameRenderRecordFields(
  left: Omit<RenderRecord, 'schemaVersion' | 'jobId' | 'expectedArtifacts' | 'createdAt'>,
  right: Omit<RenderRecord, 'schemaVersion' | 'jobId' | 'expectedArtifacts' | 'createdAt'>
): boolean {
  return left.projectId === right.projectId &&
    left.sequenceId === right.sequenceId &&
    left.pinnedRevision === right.pinnedRevision &&
    left.renderIrDigest === right.renderIrDigest &&
    left.backendCapabilitiesDigest === right.backendCapabilitiesDigest &&
    left.renderRange.startFrame === right.renderRange.startFrame &&
    left.renderRange.endFrame === right.renderRange.endFrame &&
    left.playbackMode === right.playbackMode &&
    left.renderKind === right.renderKind &&
    left.requestedRenderKind === right.requestedRenderKind &&
    left.advancedSettingsDigest === right.advancedSettingsDigest &&
    left.advancedCapabilitiesDigest === right.advancedCapabilitiesDigest &&
    left.effectSemanticsDigest === right.effectSemanticsDigest &&
    left.portableEquivalent === right.portableEquivalent &&
    left.captionMode === right.captionMode &&
    left.subtitleFormat === right.subtitleFormat &&
    left.canvasPreset === right.canvasPreset &&
    left.proofFrame === right.proofFrame
}

function expectedArtifactsFromRenderRecordFields(
  fields: Omit<RenderRecord, 'schemaVersion' | 'jobId' | 'expectedArtifacts' | 'createdAt'>
): RenderRecord['expectedArtifacts'] | undefined {
  if (fields.renderKind === 'proof-frame') {
    if (fields.captionMode !== 'none' && fields.captionMode !== 'burned') return undefined
    return [{ mediaKind: 'image', mimeType: 'image/png' }]
  }
  if (fields.renderKind === 'preview') {
    if (fields.captionMode !== 'none' && fields.captionMode !== 'burned') return undefined
    return [{ mediaKind: 'video', mimeType: 'video/mp4' }]
  }
  if (fields.renderKind === 'audio-aac') {
    if (fields.captionMode !== 'none') return undefined
    return [{ mediaKind: 'audio', mimeType: 'audio/mp4' }]
  }
  if (fields.renderKind === 'subtitles') {
    if (fields.captionMode !== 'none') return undefined
    return [{
      mediaKind: 'subtitle',
      mimeType: fields.subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt'
    }]
  }
  const expected: RenderRecord['expectedArtifacts'] = []
  if (fields.captionMode === 'sidecar' || fields.captionMode === 'both') {
    expected.push({
      mediaKind: 'subtitle',
      mimeType: fields.subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt'
    })
  }
  expected.push({
    mediaKind: 'video',
    mimeType: fields.renderKind === 'prores-mov'
      ? 'video/quicktime'
      : fields.renderKind === 'ffv1-mkv'
        ? 'video/x-matroska'
        : 'video/mp4'
  })
  return expected
}

function sameRenderTrackingRecord(left: RenderRecord, right: RenderRecord): boolean {
  return left.schemaVersion === right.schemaVersion &&
    left.jobId === right.jobId &&
    left.createdAt === right.createdAt &&
    sameRenderRecordFields(left, right) &&
    left.expectedArtifacts.length === right.expectedArtifacts.length &&
    left.expectedArtifacts.every((expected, index) => {
      const candidate = right.expectedArtifacts[index]
      return candidate?.mediaKind === expected.mediaKind && candidate.mimeType === expected.mimeType
    })
}

function isSha256Digest(value: unknown): value is string {
  return typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value)
}

function isRenderRange(value: unknown): value is RenderRecord['renderRange'] {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const range = value as { startFrame?: unknown; endFrame?: unknown }
  return Number.isSafeInteger(range.startFrame) && Number(range.startFrame) >= 0 &&
    Number.isSafeInteger(range.endFrame) && Number(range.endFrame) > Number(range.startFrame)
}

function sameRenderRange(value: unknown, expected: RenderRecord['renderRange']): boolean {
  return isRenderRange(value) &&
    value.startFrame === expected.startFrame &&
    value.endFrame === expected.endFrame
}

function isTerminalJobState(state: JobSnapshot['state']): boolean {
  return state === 'completed' || state === 'failed' || state === 'cancelled' || state === 'interrupted'
}

function renderStatusSummary(snapshot: JobSnapshot, validated: boolean, stale: boolean): string {
  if (snapshot.state !== 'completed') return `Render job ${snapshot.id} is ${snapshot.state}.`
  if (!validated) return `Render job ${snapshot.id} completed but its output failed artifact validation.`
  return `Render job ${snapshot.id} completed with technical validation${stale ? '; its proof is stale for the current revision' : ''}. No visual inspection is implied.`
}

function interactionRequired(error: unknown, continuation: string): JsonObject | undefined {
  const code = extensionApiErrorCode(error)
  if (code === undefined) return undefined
  if (!['INTERACTION_REQUIRED', 'HOST_UNAVAILABLE', 'UNSUPPORTED_CAPABILITY'].includes(code)) {
    return undefined
  }
  return {
    outcome: 'interaction-required',
    code: 'MEDIA_INTERACTION_REQUIRED',
    message: 'This operation requires a protected Kun desktop picker.',
    continuation
  }
}

function extensionApiErrorCode(error: unknown): string | undefined {
  if (error instanceof ExtensionApiError) return error.code
  if (error === null || typeof error !== 'object' || Array.isArray(error)) return undefined
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' ? code : undefined
}

function assertExpectedRevision(project: VideoProject, expectedRevision: number): void {
  if (project.currentRevision !== expectedRevision) {
    throw new VideoEngineError('revision_conflict', 'Project revision has changed', {
      expectedRevision,
      currentRevision: project.currentRevision
    })
  }
}

function assertNotCancelled(invocation: ToolInvocationContext): void {
  if (invocation.cancellation.isCancellationRequested) {
    throw new ExtensionApiError({
      code: 'CANCELLED',
      message: 'The video tool invocation was cancelled.',
      operation: invocation.invocation.toolId,
      retryable: false
    })
  }
}

function asRecord(value: unknown, label: string): ToolInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new ToolInputError(`${label} input must be an object.`)
  }
  return value as ToolInput
}

function exactKeys(input: ToolInput, keys: readonly string[]): void {
  const allowed = new Set(keys)
  const unexpected = Object.keys(input).find((key) => !allowed.has(key))
  if (unexpected) throw new ToolInputError(`Unexpected input field: ${unexpected}`)
}

function boundedPublicErrorMessage(error: unknown): string {
  const message = error instanceof Error && error.message
    ? error.message
    : 'The multicam program is not ready for canonical rendering.'
  return message.slice(0, 512)
}

function stableId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value) ||
    value === '.' ||
    value === '..'
  ) {
    throw new ToolInputError(`${label} must be a bounded stable identifier.`)
  }
  return value
}

function opaqueHandle(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 16 ||
    value.length > 512 ||
    !/^[A-Za-z0-9_-]+$/u.test(value)
  ) {
    throw new ToolInputError(`${label} must be an opaque Host-granted media handle.`)
  }
  return value
}

function generationOpaqueId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 8 ||
    value.length > 256 ||
    !/^[A-Za-z0-9._~-]+$/u.test(value)
  ) {
    throw new ToolInputError(`${label} must be a bounded opaque generation identifier.`)
  }
  return value
}

function boundedString(
  value: unknown,
  label: string,
  minimum: number,
  maximum: number
): string {
  if (typeof value !== 'string' || value.length < minimum || value.length > maximum) {
    throw new ToolInputError(`${label} must contain ${minimum}-${maximum} characters.`)
  }
  return value
}

function nonNegativeInteger(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new ToolInputError(`${label} must be a non-negative safe integer.`)
  }
  return Number(value)
}

function positiveInteger(value: unknown, label: string): number {
  const parsed = nonNegativeInteger(value, label)
  if (parsed === 0) throw new ToolInputError(`${label} must be a positive safe integer.`)
  return parsed
}

function boundedPositiveInteger(value: unknown, label: string, minimum: number, maximum: number): number {
  const parsed = positiveInteger(value, label)
  if (parsed < minimum || parsed > maximum) {
    throw new ToolInputError(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return parsed
}

function optionalBoolean(value: unknown, label: string): boolean | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'boolean') throw new ToolInputError(`${label} must be a boolean.`)
  return value
}

function stableIdArray(value: unknown, label: string): string[] {
  return [...new Set(boundedArray(value, label, 0, 200)
    .map((entry, index) => stableId(entry, `${label}[${index}]`)))]
}

function selectionRange(value: unknown): { startFrame: number; endFrame: number } | undefined {
  if (value === null) return undefined
  const range = asRecord(value, 'range')
  exactKeys(range, ['startFrame', 'endFrame'])
  const startFrame = nonNegativeInteger(range.startFrame, 'range.startFrame')
  const endFrame = nonNegativeInteger(range.endFrame, 'range.endFrame')
  if (endFrame <= startFrame) throw new ToolInputError('Selection range must be a non-empty half-open interval.')
  return { startFrame, endFrame }
}

function agentActorId(invocation?: ToolInvocationContext): string {
  return invocation?.invocation.runId ?? invocation?.invocation.threadId ?? 'kun-agent'
}

function assertTimedTranscriptEvidence(
  project: VideoProject,
  ranges: readonly AssetTimeRange[]
): void {
  for (const range of ranges) {
    const asset = project.assets.find(({ id }) => id === range.assetId)
    if (!asset) throw new ToolInputError(`Destructive range refers to missing asset ${range.assetId}.`)
    if (range.endUs > asset.durationUs) {
      throw new ToolInputError(`Destructive range exceeds source duration for asset ${range.assetId}.`)
    }
    const transcriptIds = new Set(asset.transcriptIds)
    const intervals = project.transcripts
      .filter(({ id, assetId }) => assetId === asset.id && transcriptIds.has(id))
      .flatMap(({ segments }) => segments.map(({ startUs, endUs }) => ({ startUs, endUs })))
      .sort((left, right) => left.startUs - right.startUs || left.endUs - right.endUs)
    let cursor = range.startUs
    for (const interval of intervals) {
      if (interval.endUs <= cursor) continue
      if (interval.startUs > cursor) break
      cursor = Math.max(cursor, interval.endUs)
      if (cursor >= range.endUs) break
    }
    if (cursor < range.endUs) {
      throw new ToolInputError(
        `Destructive Agent edit for asset ${range.assetId} lacks continuous timed transcript evidence. ` +
        'Import or generate a timed transcript, refresh inspection, or request explicit user guidance.'
      )
    }
  }
}

function mutationResult(
  outcome: string,
  receipt: MutationReceipt,
  project: VideoProject,
  summary: string
): ToolResult {
  return result({
    outcome,
    projectId: project.id,
    sequenceId: project.activeSequenceId,
    previousRevision: receipt.previousRevision,
    currentRevision: receipt.newRevision,
    generation: receipt.generation,
    changedIds: [...receipt.createdIds, ...receipt.changedIds, ...receipt.removedIds]
      .map(({ id }) => id),
    receipt: receipt as unknown as JsonObject
  }, summary)
}

function rational(value: unknown, label: string): { numerator: number; denominator: number } {
  const object = asRecord(value, label)
  exactKeys(object, ['numerator', 'denominator'])
  const numerator = nonNegativeInteger(object.numerator, `${label}.numerator`)
  const denominator = nonNegativeInteger(object.denominator, `${label}.denominator`)
  if (numerator === 0 || denominator === 0) throw new ToolInputError(`${label} values must be positive.`)
  return { numerator, denominator }
}

function enumValue<const T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string
): T[number] {
  if (typeof value !== 'string' || !values.includes(value)) {
    throw new ToolInputError(`${label} contains an unsupported value.`)
  }
  return value as T[number]
}

function boundedArray(value: unknown, label: string, minimum: number, maximum: number): unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) {
    throw new ToolInputError(`${label} must contain ${minimum}-${maximum} entries.`)
  }
  return value
}

function assetRange(value: unknown): AssetTimeRange {
  const range = asRecord(value, 'range')
  exactKeys(range, ['assetId', 'startUs', 'endUs', 'reason'])
  const startUs = nonNegativeInteger(range.startUs, 'range.startUs')
  const endUs = nonNegativeInteger(range.endUs, 'range.endUs')
  if (endUs <= startUs) throw new ToolInputError('A transcript edit range must have positive duration.')
  return {
    assetId: stableId(range.assetId, 'range.assetId'),
    startUs,
    endUs,
    ...(range.reason === undefined
      ? {}
      : { reason: enumValue(range.reason, ['filler', 'silence', 'selection'] as const, 'range.reason') })
  }
}

function transcriptSegmentInput(value: unknown): JsonObject {
  const segment = asRecord(value, 'segment')
  exactKeys(segment, ['id', 'startUs', 'endUs', 'text', 'words'])
  const startUs = nonNegativeInteger(segment.startUs, 'segment.startUs')
  const endUs = nonNegativeInteger(segment.endUs, 'segment.endUs')
  if (endUs <= startUs) throw new ToolInputError('Transcript segments must have positive duration.')
  const words = segment.words === undefined
    ? undefined
    : boundedArray(segment.words, 'segment.words', 0, 20_000).map((value): JsonObject => {
        const word = asRecord(value, 'word')
        exactKeys(word, ['id', 'startUs', 'endUs', 'text', 'confidence'])
        const wordStart = nonNegativeInteger(word.startUs, 'word.startUs')
        const wordEnd = nonNegativeInteger(word.endUs, 'word.endUs')
        if (wordEnd <= wordStart) throw new ToolInputError('Transcript words must have positive duration.')
        return {
          id: stableId(word.id, 'word.id'),
          startUs: wordStart,
          endUs: wordEnd,
          text: boundedString(word.text, 'word.text', 1, 1024),
          ...(word.confidence === undefined
            ? {}
            : { confidence: boundedNumber(word.confidence, 'word.confidence', 0, 1) })
        }
      })
  return {
    id: stableId(segment.id, 'segment.id'),
    startUs,
    endUs,
    text: boundedString(segment.text, 'segment.text', 1, 16_384),
    ...(words === undefined ? {} : { words })
  }
}

function captionBuildStyle(value: unknown): NonNullable<CaptionBuildOptions['style']> {
  const style = asRecord(value, 'style')
  exactKeys(style, ['fontSize', 'color', 'background', 'fontFamily', 'fontWeight', 'maxWidthRatio'])
  return {
    ...(style.fontSize === undefined ? {} : { fontSize: boundedNumber(style.fontSize, 'style.fontSize', 8, 256) }),
    ...(style.color === undefined ? {} : { color: captionColor(style.color, 'style.color') }),
    ...(style.background === undefined ? {} : { background: captionColor(style.background, 'style.background') }),
    ...(style.fontFamily === undefined
      ? {}
      : { fontFamily: boundedString(style.fontFamily, 'style.fontFamily', 1, 128) }),
    ...(style.fontWeight === undefined
      ? {}
      : { fontWeight: boundedNumber(style.fontWeight, 'style.fontWeight', 100, 900) }),
    ...(style.maxWidthRatio === undefined
      ? {}
      : { maxWidthRatio: boundedNumber(style.maxWidthRatio, 'style.maxWidthRatio', 0.1, 1) })
  }
}

function captionBuildAnimation(value: unknown): NonNullable<CaptionBuildOptions['animation']> {
  const animation = asRecord(value, 'animation')
  exactKeys(animation, ['kind', 'durationFrames'])
  return {
    kind: enumValue(animation.kind, ['none', 'fade', 'word-highlight'] as const, 'animation.kind'),
    ...(animation.durationFrames === undefined
      ? {}
      : { durationFrames: nonNegativeInteger(animation.durationFrames, 'animation.durationFrames') })
  }
}

function captionColor(value: unknown, label: string): string {
  const color = boundedString(value, label, 7, 7)
  if (!/^#[0-9A-Fa-f]{6}$/u.test(color)) throw new ToolInputError(`${label} must be a six-digit hexadecimal color.`)
  return color
}

function previewSource(value: unknown): PreviewSource {
  const source = asRecord(value, 'source')
  const kind = enumValue(source.kind, ['asset', 'timeline', 'generated'] as const, 'source.kind')
  if (kind === 'asset') {
    exactKeys(source, ['kind', 'assetId', 'startUs', 'endUs'])
    const startUs = nonNegativeInteger(source.startUs, 'source.startUs')
    const endUs = positiveInteger(source.endUs, 'source.endUs')
    if (endUs <= startUs) throw new ToolInputError('Preview source range must be non-empty.')
    return { kind, assetId: stableId(source.assetId, 'source.assetId'), startUs, endUs }
  }
  if (kind === 'timeline') {
    exactKeys(source, ['kind', 'sequenceId', 'revision', 'startFrame', 'endFrame', 'artifactId'])
    const startFrame = nonNegativeInteger(source.startFrame, 'source.startFrame')
    const endFrame = positiveInteger(source.endFrame, 'source.endFrame')
    if (endFrame <= startFrame) throw new ToolInputError('Preview timeline range must be non-empty.')
    return {
      kind,
      sequenceId: stableId(source.sequenceId, 'source.sequenceId'),
      revision: nonNegativeInteger(source.revision, 'source.revision'),
      startFrame,
      endFrame,
      ...(source.artifactId === undefined ? {} : { artifactId: stableId(source.artifactId, 'source.artifactId') })
    }
  }
  exactKeys(source, ['kind', 'assetId', 'jobId', 'variantIndex'])
  return {
    kind,
    assetId: stableId(source.assetId, 'source.assetId'),
    jobId: stableId(source.jobId, 'source.jobId'),
    variantIndex: nonNegativeInteger(source.variantIndex, 'source.variantIndex')
  }
}

function assertPreviewSource(project: VideoProject, source: PreviewSource): void {
  if (source.kind === 'timeline') {
    const sequence = project.sequences.find(({ id }) => id === source.sequenceId)
    if (!sequence) throw new ToolInputError(`Preview sequence does not exist: ${source.sequenceId}`)
    if (source.revision > project.currentRevision) {
      throw new ToolInputError('Preview source revision cannot be newer than the project.')
    }
    if (source.endFrame > sequenceDurationFrames(sequence)) {
      throw new ToolInputError('Preview timeline range exceeds the sequence duration.')
    }
    return
  }
  const asset = project.assets.find(({ id }) => id === source.assetId)
  if (!asset) throw new ToolInputError(`Preview asset does not exist: ${source.assetId}`)
  if (source.kind === 'asset' && source.endUs > asset.durationUs) {
    throw new ToolInputError('Preview source range exceeds the asset duration.')
  }
  if (source.kind === 'generated' && asset.generatedLineage?.jobId !== source.jobId) {
    throw new ToolInputError('Generated preview lineage does not match the selected asset.')
  }
}

function previewEntryId(
  project: VideoProject,
  history: PreviewHistory,
  source: PreviewSource,
  label: string
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ projectId: project.id, generation: history.generation + 1, source, label }))
    .digest('hex')
    .slice(0, 12)
  return `preview-${project.currentRevision}-${history.generation + 1}-${digest}`
}

function strictTimelineOperation(value: unknown): TimelineOperation {
  const operation = asRecord(value, 'operation')
  const type = boundedString(operation.type, 'operation.type', 1, 64)
  const keys: Record<string, readonly string[]> = {
    'add-item': ['type', 'item'],
    'split-item': ['type', 'itemId', 'atFrame'],
    'trim-item': ['type', 'itemId', 'startFrame', 'endFrame'],
    'delete-item': ['type', 'itemId'],
    'move-item': ['type', 'itemId', 'trackId', 'timelineStartFrame'],
    'reorder-item': ['type', 'itemId', 'beforeItemId'],
    'update-transform': ['type', 'itemId', 'transform', 'opacity'],
    'update-track-state': ['type', 'trackId', 'muted', 'locked', 'syncLocked'],
    'update-item-properties': [
      'type', 'itemId', 'volume', 'fadeInFrames', 'fadeOutFrames', 'muted', 'visible', 'locked'
    ],
    'set-link-group': ['type', 'group'],
    'delete-link-group': ['type', 'linkGroupId'],
    'create-sequence': ['type', 'sequenceId', 'name', 'activate'],
    'duplicate-sequence': ['type', 'sourceSequenceId', 'sequenceId', 'name', 'activate'],
    'rename-sequence': ['type', 'sequenceId', 'name'],
    'select-sequence': ['type', 'sequenceId'],
    'open-sequence': ['type', 'sequenceId'],
    'close-sequence': ['type', 'sequenceId', 'fallbackSequenceId'],
    'delete-sequence': ['type', 'sequenceId'],
    'set-sequence-view': ['type', 'sequenceId', 'zoom', 'scrollFrame'],
    'set-item-keyframes': ['type', 'itemId', 'keyframes'],
    'set-item-effects': ['type', 'itemId', 'effects'],
    'update-item-composition': ['type', 'itemId', 'crop', 'opacity', 'blendMode'],
    'retime-item': ['type', 'itemId', 'speed'],
    'add-caption': ['type', 'caption'],
    'update-caption': ['type', 'captionId', 'patch'],
    'delete-caption': ['type', 'captionId'],
    'set-canvas': ['type', 'preset', 'fit'],
    'set-multicam-group': ['type', 'group'],
    'delete-multicam-group': ['type', 'groupId'],
    'switch-multicam-angle': [
      'type', 'groupId', 'memberId', 'startFrame', 'endFrame',
      'coveragePolicy', 'minimumSyncConfidence'
    ],
    'apply-multicam-layout': [
      'type', 'groupId', 'layoutId', 'startFrame', 'endFrame',
      'coveragePolicy', 'minimumSyncConfidence'
    ],
    'merge-multicam-program': ['type', 'groupId']
  }
  const allowed = keys[type]
  if (!allowed) throw new ToolInputError(`Unsupported timeline operation: ${type}`)
  exactKeys(operation, allowed)
  if (type === 'add-item') strictTimelineItem(operation.item)
  if (type === 'add-caption') strictCaption(operation.caption, 'operation.caption')
  if (type === 'update-caption') strictCaptionPatch(operation.patch)
  if (type === 'update-transform') strictTransformPatch(operation.transform)
  if (type === 'set-link-group') strictLinkGroup(operation.group)
  if (type === 'set-item-keyframes') strictKeyframeTracks(operation.keyframes, 'operation.keyframes')
  if (type === 'set-item-effects') strictEffects(operation.effects, 'operation.effects')
  if (type === 'update-item-composition' && operation.crop !== undefined) {
    exactKeys(asRecord(operation.crop, 'operation.crop'), ['left', 'top', 'right', 'bottom'])
  }
  if (type === 'retime-item') rational(operation.speed, 'operation.speed')
  return TimelineOperationSchema.parse(operation)
}

function assertAgentMulticamSyncAuthority(
  project: VideoProject,
  operations: readonly TimelineOperation[]
): void {
  for (const operation of operations) {
    if (operation.type !== 'set-multicam-group') continue
    const current = (project.multicamGroups ?? []).find(({ id }) => id === operation.group.id)
    for (const member of operation.group.members) {
      const previous = current?.members.find(({ id }) => id === member.id)
      if (previous) {
        if (JSON.stringify(previous.sync) !== JSON.stringify(member.sync)) {
          throw new ToolInputError(
            'Agent multicam updates cannot create or alter synchronization evidence; ' +
            'use verified analysis or an explicit right-sidebar user confirmation.'
          )
        }
        continue
      }
      const isReference = member.id === operation.group.referenceMemberId
      const allowed = isReference
        ? member.sync.status === 'reference' && member.sync.offsetFrames === 0 &&
          member.sync.confidence === 1 && member.sync.evidence.length === 0
        : member.sync.status === 'unknown' && member.sync.confidence === undefined &&
          member.sync.evidence.length === 0
      if (!allowed) {
        throw new ToolInputError(
          'New Agent multicam members must remain unsynchronized until attributable evidence exists.'
        )
      }
    }
  }
}

function strictTimelineItem(value: unknown): void {
  const item = asRecord(value, 'operation.item')
  exactKeys(item, [
    'id', 'assetId', 'trackId', 'timelineStartFrame', 'durationFrames', 'sourceStartUs',
    'sourceEndUs', 'speed', 'transform', 'opacity', 'fadeInFrames', 'fadeOutFrames',
    'linkGroupId', 'nestedSequenceId', 'crop', 'blendMode', 'volume', 'muted', 'visible', 'locked',
    'effects', 'keyframes'
  ])
  rational(item.speed, 'operation.item.speed')
  strictTransform(item.transform, 'operation.item.transform')
  if (item.crop !== undefined) {
    exactKeys(asRecord(item.crop, 'operation.item.crop'), ['left', 'top', 'right', 'bottom'])
  }
  if (item.effects !== undefined) strictEffects(item.effects, 'operation.item.effects')
  if (item.keyframes !== undefined) strictKeyframeTracks(item.keyframes, 'operation.item.keyframes')
}

function strictEffects(value: unknown, label: string): void {
  boundedArray(value, label, 0, 32).forEach((entry, index) => {
    const effect = asRecord(entry, `${label}[${index}]`)
    exactKeys(effect, ['id', 'type', 'enabled', 'parameters'])
    const parameters = asRecord(effect.parameters, `${label}[${index}].parameters`)
    if (Object.keys(parameters).length > 64) {
      throw new ToolInputError(`${label}[${index}].parameters exceeds its limit.`)
    }
  })
}

function strictKeyframeTracks(value: unknown, label: string): void {
  boundedArray(value, label, 0, 32).forEach((entry, index) => {
    const track = asRecord(entry, `${label}[${index}]`)
    exactKeys(track, ['id', 'property', 'interpolation', 'points'])
    boundedArray(track.points, `${label}[${index}].points`, 1, 2_048)
      .forEach((point, child) => {
        exactKeys(asRecord(point, `${label}[${index}].points[${child}]`), ['id', 'frame', 'value'])
      })
  })
}

function strictLinkGroup(value: unknown): void {
  const group = asRecord(value, 'operation.group')
  exactKeys(group, ['id', 'kind', 'itemIds', 'locked'])
  boundedArray(group.itemIds, 'operation.group.itemIds', 2, 32)
}

function strictTransform(value: unknown, label: string): void {
  const transform = asRecord(value, label)
  exactKeys(transform, ['x', 'y', 'scaleX', 'scaleY', 'rotation'])
}

function strictTransformPatch(value: unknown): void {
  const transform = asRecord(value, 'operation.transform')
  exactKeys(transform, ['x', 'y', 'scaleX', 'scaleY', 'rotation'])
}

function strictCaption(value: unknown, label: string): void {
  const caption = asRecord(value, label)
  exactKeys(caption, [
    'id', 'trackId', 'startFrame', 'endFrame', 'text', 'placement', 'style',
    'sourceTranscriptId', 'sourceSegmentIds', 'words', 'animation'
  ])
  strictCaptionDetails(caption, label)
}

function strictCaptionPatch(value: unknown): void {
  const patch = asRecord(value, 'operation.patch')
  exactKeys(patch, [
    'trackId', 'startFrame', 'endFrame', 'text', 'placement', 'style',
    'sourceTranscriptId', 'sourceSegmentIds', 'words', 'animation'
  ])
  strictCaptionDetails(patch, 'operation.patch')
}

function strictCaptionDetails(caption: ToolInput, label: string): void {
  if (caption.style !== undefined) {
    exactKeys(
      asRecord(caption.style, `${label}.style`),
      ['fontSize', 'color', 'background', 'fontFamily', 'fontWeight', 'maxWidthRatio']
    )
  }
  if (caption.sourceSegmentIds !== undefined) {
    boundedArray(caption.sourceSegmentIds, `${label}.sourceSegmentIds`, 0, 256)
  }
  if (caption.words !== undefined) {
    boundedArray(caption.words, `${label}.words`, 0, 512).forEach((value, index) => {
      exactKeys(
        asRecord(value, `${label}.words[${index}]`),
        ['id', 'text', 'startFrame', 'endFrame', 'sourceWordId']
      )
    })
  }
  if (caption.animation !== undefined) {
    exactKeys(asRecord(caption.animation, `${label}.animation`), ['kind', 'durationFrames'])
  }
}

function boundedNumber(value: unknown, label: string, minimum: number, maximum: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new ToolInputError(`${label} must be between ${minimum} and ${maximum}.`)
  }
  return value
}

function analysisIdentifier(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length < 1 ||
    value.length > 512 ||
    !/^[A-Za-z0-9][A-Za-z0-9._:~-]{0,511}$/u.test(value)
  ) {
    throw new ToolInputError(`${label} must be a bounded local analysis identifier.`)
  }
  return value
}

function strictSpeakerImportDocument(value: unknown): {
  identities: SpeakerIdentity[]
  turns: ImportedDiarizationTurn[]
  confidenceThreshold: number
  completeness: 'complete' | 'partial'
} {
  const document = asRecord(value, 'document')
  exactKeys(document, [
    'schemaVersion', 'adapterId', 'identities', 'turns', 'confidenceThreshold', 'completeness'
  ])
  if (document.schemaVersion !== 1) throw new ToolInputError('Speaker import document schemaVersion must be 1.')
  if (document.adapterId !== 'kun.imported-speaker-labels') {
    throw new ToolInputError('Speaker import document must use the registered kun.imported-speaker-labels adapter.')
  }
  const timestamp = new Date().toISOString()
  const identityIds = new Set<string>()
  const identities = boundedArray(document.identities, 'document.identities', 1, 256)
    .map((entry, index): SpeakerIdentity => {
      const identity = asRecord(entry, `document.identities[${index}]`)
      exactKeys(identity, ['id', 'label', 'aliases', 'sourceEvidenceIds'])
      const id = stableId(identity.id, `document.identities[${index}].id`)
      if (identityIds.has(id)) throw new ToolInputError(`Duplicate speaker identity: ${id}`)
      identityIds.add(id)
      return {
        id,
        label: boundedString(identity.label, `document.identities[${index}].label`, 1, 128),
        aliases: identity.aliases === undefined
          ? []
          : boundedArray(identity.aliases, `document.identities[${index}].aliases`, 0, 32)
            .map((alias, child) => boundedString(alias, `document.identities[${index}].aliases[${child}]`, 1, 128)),
        sourceEvidenceIds: identity.sourceEvidenceIds === undefined
          ? []
          : boundedArray(identity.sourceEvidenceIds, `document.identities[${index}].sourceEvidenceIds`, 0, 256)
            .map((idValue, child) => stableId(idValue, `document.identities[${index}].sourceEvidenceIds[${child}]`)),
        createdAt: timestamp,
        updatedAt: timestamp
      }
    })
  const turns = boundedArray(document.turns, 'document.turns', 1, 20_000)
    .map((entry, index): ImportedDiarizationTurn => {
      const turn = asRecord(entry, `document.turns[${index}]`)
      exactKeys(turn, [
        'id', 'startUs', 'endUs', 'status', 'speakerId', 'overlapSpeakerIds',
        'confidence', 'sourceEvidenceIds'
      ])
      const status = enumValue(turn.status, ['identified', 'unknown', 'overlap'] as const, `document.turns[${index}].status`)
      const overlapSpeakerIds = turn.overlapSpeakerIds === undefined
        ? undefined
        : boundedArray(turn.overlapSpeakerIds, `document.turns[${index}].overlapSpeakerIds`, 0, 8)
          .map((idValue, child) => stableId(idValue, `document.turns[${index}].overlapSpeakerIds[${child}]`))
      const sourceEvidenceIds = turn.sourceEvidenceIds === undefined
        ? undefined
        : boundedArray(turn.sourceEvidenceIds, `document.turns[${index}].sourceEvidenceIds`, 0, 32)
          .map((idValue, child) => stableId(idValue, `document.turns[${index}].sourceEvidenceIds[${child}]`))
      return {
        id: stableId(turn.id, `document.turns[${index}].id`),
        startUs: nonNegativeInteger(turn.startUs, `document.turns[${index}].startUs`),
        endUs: boundedPositiveInteger(turn.endUs, `document.turns[${index}].endUs`, 1, Number.MAX_SAFE_INTEGER),
        status,
        ...(turn.speakerId === undefined ? {} : {
          speakerId: stableId(turn.speakerId, `document.turns[${index}].speakerId`)
        }),
        ...(overlapSpeakerIds === undefined ? {} : { overlapSpeakerIds }),
        confidence: boundedNumber(turn.confidence, `document.turns[${index}].confidence`, 0, 1),
        ...(sourceEvidenceIds === undefined ? {} : { sourceEvidenceIds })
      }
    })
  return {
    identities,
    turns,
    confidenceThreshold: document.confidenceThreshold === undefined
      ? 0.7
      : boundedNumber(document.confidenceThreshold, 'document.confidenceThreshold', 0, 1),
    completeness: document.completeness === undefined
      ? 'complete'
      : enumValue(document.completeness, ['complete', 'partial'] as const, 'document.completeness')
  }
}

function speakerAttributionPlanProjection(
  plan: ReturnType<typeof buildSpeakerAttributionPlan>
): JsonObject {
  const values = [...plan.transcriptSegments, ...plan.captions]
  return {
    schemaVersion: 1,
    analysisId: plan.analysisId,
    transcriptSegmentCount: plan.transcriptSegments.length,
    captionCount: plan.captions.length,
    identifiedCount: values.filter(({ status }) => status === 'identified').length,
    uncertainCount: values.filter(({ status }) => status !== 'identified').length,
    warnings: plan.warnings.slice(0, 100)
  }
}

function analysisRecordSummary(record: IntelligenceRecord, project?: VideoProject): JsonObject {
  if ('adapter' in record && record.id.startsWith('visual-index:')) {
    return {
      schemaVersion: 1,
      id: record.id,
      kind: 'visual-index',
      assetId: record.assetId,
      completeness: record.completeness,
      indexedSampleCount: record.indexedSampleCount,
      plannedSampleCount: record.plannedSampleCount,
      omittedSampleCount: record.omittedSampleCount,
      adapterId: record.adapter.id,
      adapterVersion: record.adapter.version,
      modelId: record.adapter.modelId,
      modelVersion: record.adapter.modelVersion,
      packageId: record.adapter.packageId,
      manifestSha256: record.adapter.manifestSha256,
      intervalUs: record.parameters.intervalUs,
      maxFrames: record.parameters.maxFrames,
      samplingStrategy: record.parameters.samplingStrategy,
      immutable: true
    }
  }
  if (hasAnalysisKind(record, 'vad')) {
    return {
      schemaVersion: 1,
      id: record.id,
      kind: record.kind,
      assetId: record.assetId,
      completeness: record.completeness,
      silenceCount: record.silence.length,
      safeSuggestionCount: record.silence.filter(({ disposition }) => disposition === 'safe-to-suggest').length,
      suggestionConfidenceThreshold: record.suggestionConfidenceThreshold,
      provenance: record.provenance as unknown as JsonObject,
      immutable: true
    }
  }
  if (hasAnalysisKind(record, 'beat-grid')) {
    const allSnapTargets = project ? beatSnapTargets(project, record) : []
    const snapTargets = allSnapTargets
      .slice(0, 4_096)
      .map(({ id, frame, kind, confidence }) => ({
        id: `beat-${createHash('sha256').update(id).digest('hex').slice(0, 32)}`,
        frame,
        kind,
        confidence
      }))
    return {
      schemaVersion: 1,
      id: record.id,
      kind: record.kind,
      assetId: record.assetId,
      completeness: record.completeness,
      markerCount: record.markers.length,
      snapTargets,
      snapTargetsTruncated: allSnapTargets.length > snapTargets.length,
      ...(record.tempoBpm === undefined ? {} : { tempoBpm: record.tempoBpm }),
      provenance: record.provenance as unknown as JsonObject,
      immutable: true
    }
  }
  if (hasAnalysisKind(record, 'denoise-metadata')) {
    return {
      schemaVersion: 1,
      id: record.id,
      kind: record.kind,
      assetId: record.assetId,
      completeness: record.completeness,
      status: record.status,
      confidence: record.confidence,
      confidenceThreshold: record.confidenceThreshold,
      noiseProfile: record.noiseProfile as unknown as JsonObject,
      recommendation: record.recommendation as unknown as JsonObject,
      metadataOnly: true,
      provenance: record.provenance as unknown as JsonObject,
      immutable: true
    }
  }
  if (hasAnalysisKind(record, 'speaker-diarization')) {
    return {
      schemaVersion: 1,
      id: record.id,
      kind: record.kind,
      assetId: record.assetId,
      completeness: record.completeness,
      turnCount: record.turns.length,
      identifiedTurnCount: record.turns.filter(({ uncertain, speakerId }) => !uncertain && speakerId).length,
      uncertainTurnCount: record.uncertainTurnCount,
      provenance: record.provenance as unknown as JsonObject,
      immutable: true
    }
  }
  if (hasAnalysisKind(record, 'audio-sync')) {
    return {
      schemaVersion: 1,
      id: record.id,
      kind: record.kind,
      referenceAssetId: record.referenceAssetId,
      targetAssetId: record.targetAssetId,
      seed: record.seed,
      proposedTargetDeltaUs: record.proposedTargetDeltaUs,
      confidence: record.confidence,
      separation: record.separation,
      threshold: record.threshold,
      minimumSeparation: record.minimumSeparation,
      outcome: record.outcome,
      ...(record.refusalReason ? { refusalReason: record.refusalReason } : {}),
      provenance: record.provenance as unknown as JsonObject,
      immutable: true
    }
  }
  return {
    schemaVersion: 1,
    id: record.id,
    kind: 'speaker-diarization',
    immutable: true
  }
}

function assertAnalysisSourcesCurrent(
  project: VideoProject,
  record: Extract<IntelligenceRecord, {
    kind: 'vad' | 'speaker-diarization' | 'beat-grid' | 'denoise-metadata' | 'audio-sync'
  }>
): void {
  if (record.kind !== 'audio-sync') {
    const asset = project.assets.find(({ id }) => id === record.assetId)
    if (!asset) throw new ToolInputError(`Analysis source asset no longer exists: ${record.assetId}`)
    if (
      asset.sourceIdentity?.algorithm === 'sha256' &&
      asset.sourceIdentity.value !== record.provenance.sourceFingerprint.value
    ) {
      throw new VideoEngineError(
        'invalid_operation',
        'Cached analysis evidence belongs to an older source identity; run the analysis again.'
      )
    }
    return
  }
  const reference = project.assets.find(({ id }) => id === record.referenceAssetId)
  const target = project.assets.find(({ id }) => id === record.targetAssetId)
  if (!reference || !target) {
    throw new ToolInputError('Audio synchronization source assets no longer exist.')
  }
  if (
    reference.sourceIdentity?.algorithm !== 'sha256' ||
    target.sourceIdentity?.algorithm !== 'sha256'
  ) return
  const combined = combineAudioSourceFingerprints(reference.sourceIdentity, target.sourceIdentity)
  if (combined.value !== record.provenance.sourceFingerprint.value) {
    throw new VideoEngineError(
      'invalid_operation',
      'Cached synchronization evidence belongs to older source identities; preview synchronization again.'
    )
  }
}

function hasAnalysisKind<K extends 'vad' | 'speaker-diarization' | 'beat-grid' | 'denoise-metadata' | 'audio-sync'>(
  record: IntelligenceRecord,
  kind: K
): record is Extract<IntelligenceRecord, { kind: K }> {
  return !record.id.startsWith('visual-index:') &&
    'kind' in record &&
    record.kind === kind
}

function analysisToolResult<T extends IntelligenceRecord>(
  project: VideoProject,
  outcome: AnalysisOutcome<T>,
  label: string
): ToolResult {
  if (outcome.outcome === 'ready') {
    const evidence = readMediaIntelligenceEvidence(outcome.record, { limit: 200 })
    return result({
      outcome: 'ready',
      projectId: project.id,
      currentRevision: project.currentRevision,
      operationId: outcome.operationId,
      deduplicated: outcome.deduplicated,
      record: analysisRecordSummary(outcome.record, project),
      evidence: evidence as unknown as JsonObject
    }, `${label} evidence is ready${outcome.deduplicated ? ' from the immutable local cache' : ''}`)
  }
  if (outcome.outcome === 'unavailable') {
    return result({
      outcome: 'unavailable',
      projectId: project.id,
      currentRevision: project.currentRevision,
      code: outcome.code,
      remediation: outcome.remediation,
      local: true,
      networkUsed: false
    }, `${label} analysis is unavailable; no evidence was fabricated`)
  }
  if (outcome.outcome === 'cancelled') {
    return result({
      outcome: 'cancelled',
      projectId: project.id,
      currentRevision: project.currentRevision,
      operationId: outcome.operationId
    }, `${label} analysis was cancelled`)
  }
  return result({
    outcome: 'failed',
    projectId: project.id,
    currentRevision: project.currentRevision,
    operationId: outcome.operationId,
    error: outcome.error as unknown as JsonObject
  }, `${label} analysis failed`)
}

function publicEngineError(error: VideoEngineError, operation: string): ExtensionApiError {
  const conflict = error.code === 'revision_conflict' || error.code === 'script_stale'
  const safeDetails: JsonObject = { engineCode: error.code }
  for (const key of [
    'expectedRevision',
    'currentRevision',
    'scriptRevision',
    'expectedGeneration',
    'currentGeneration'
  ] as const) {
    const value = error.details[key]
    if (typeof value === 'number' && Number.isSafeInteger(value)) safeDetails[key] = value
  }
  return new ExtensionApiError({
    code: conflict ? 'CONFLICT' : error.code === 'project_not_found' ? 'NOT_FOUND' : 'VALIDATION_FAILED',
    message: error.message,
    operation,
    retryable: conflict,
    details: safeDetails
  })
}

export class ToolInputError extends ExtensionApiError {

  constructor(message: string) {
    super({ code: 'INVALID_ARGUMENT', message, retryable: false })
    this.name = 'ToolInputError'
  }
}
