import {
  ExtensionApiError,
  ResultPreviewOpenPayloadSchema,
  type AgentRunEvent,
  type ExtensionHostClient,
  type GeneratedArtifact,
  type JobSnapshot,
  type JsonObject,
  type JsonValue,
  type MediaMetadata,
  type MediaResourceLease
} from '@kun/extension-api'
import { useCallback, useEffect, useMemo, useReducer, useRef } from 'react'
import {
  containsAsciiControlCharacters,
  replaceNullOrLineBreaks
} from '../text-safety.js'
import {
  INITIAL_EDITOR_STATE,
  VIEW_LIMITS,
  editorReducer,
  generatedArtifacts,
  toPersistedState,
  type CanvasFit,
  type CanvasPreset,
  type AssetProjection,
  type AudioAnalysisCapabilitiesProjection,
  type AudioAnalysisRecordProjection,
  type AudioSyncPreviewProjection,
  type DenoiseMetadataCapabilityProjection,
  type DerivedMediaKind,
  type DerivedMediaRecordProjection,
  type DerivedStorageUsageProjection,
  type EditorAction,
  type EditorNotice,
  type EditorState,
  type EditorWorkspace,
  type GenerationRecordProjection,
  type GenerationStateProjection,
  type MediaLibraryPageProjection,
  type MediaIntelligenceEvidenceProjection,
  type MediaIntelligenceProgressProjection,
  type PersistedEditorState,
  type PreviewComparisonProjection,
  type PreviewHistoryEntryProjection,
  type PreviewHistoryProjection,
  type PreviewSourceProjection,
  type ProjectChange,
  type ProjectPackageMissingMediaPolicy,
  type ProjectPackageTicket,
  type InterchangeLossManifestProjection,
  type OtioExportTicket,
  type OtioImportPreview,
  type OtioTimecodeMappingProjection,
  type MulticamGroupProjection,
  type ProjectProjection,
  type ProjectSummary,
  type RenderTicket,
  type SpeakerAdapterProjection,
  type SpeakerAttributionPlanProjection,
  type SpeakerIdentityProjection,
  type TimelineOperation,
  type VisualMomentPageProjection,
  type VisualProvisioningProjection
} from './model.js'
import type {
  GenerationCatalog,
  GenerationConsent,
  GenerationModelDescriptor,
  GenerationProviderDescriptor
} from '../engine/generation.js'
import type { GenerationPanelRequest } from './generation-panel.js'
import { formatMessage, messagesFor, type MessageKey } from './i18n.js'
import { renderCapabilityDetails } from './render-capability.js'
import type {
  MulticamCreateRequest,
  MulticamLayoutRequest,
  MulticamRenameRequest,
  MulticamSelectionRequest,
  MulticamSwitchRequest,
  MulticamSyncConfirmation
} from './multicam-panel.js'

const TERMINAL_AGENT_STATES = new Set(['completed', 'failed', 'cancelled', 'budget-exhausted'])
const TERMINAL_JOB_STATES = new Set(['completed', 'failed', 'cancelled', 'interrupted'])
const JOB_STATUS_RECONCILE_INTERVAL_MS = 1_000
const SELECTION_SYNC_DEBOUNCE_MS = 120
const EDITOR_COMMAND = 'editor-request'
const COMMAND_PROGRESS_MESSAGE_KEYS: Readonly<Record<string, MessageKey>> = {
  'Probing Host-granted media': 'commandProgressProbingMedia',
  'Persisted probed asset metadata': 'commandProgressMediaMetadataSaved',
  'Media import complete': 'commandProgressImportComplete',
  'Probing replacement media grant': 'commandProgressProbingReplacement',
  'Replacement media grant saved': 'commandProgressReplacementSaved',
  'Submitting durable media job': 'commandProgressSubmittingJob',
  'Durable media job queued': 'commandProgressJobQueued',
  'Submitting durable project package job': 'commandProgressSubmittingProjectPackage',
  'Durable project package queued': 'commandProgressProjectPackageQueued'
}

export type EditorController = {
  state: EditorState
  refreshAll(): Promise<void>
  retryInitialization(): Promise<void>
  setActiveWorkspace(workspace: EditorWorkspace): void
  createProject(
    name: string,
    preset: CanvasPreset,
    fps?: { numerator: number; denominator: number }
  ): Promise<void>
  openProject(projectId: string): Promise<void>
  importMedia(options?: { folderId?: string; addToTimeline?: boolean }): Promise<void>
  loadMediaLibraryPage(options?: { folderId?: string; query?: string; offset?: number; limit?: number }): Promise<void>
  importTranscript(): Promise<void>
  checkLocalTranscriber(): Promise<void>
  generateCaptions(): Promise<void>
  openAsset(assetId: string): Promise<void>
  openDerivedResource?(recordId: string): Promise<string | undefined>
  refreshActiveLease(): Promise<void>
  recoverMedia(assetId?: string): Promise<void>
  refreshDerived(): Promise<void>
  startDerived(kind: Extract<DerivedMediaKind, 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy'>): Promise<void>
  retryDerived(record: DerivedMediaRecordProjection): Promise<void>
  cancelDerived(recordId: string): Promise<void>
  cleanupDerived(includeReady?: boolean): Promise<void>
  refreshMediaIntelligence(): Promise<void>
  setVisualOptIn(enabled: boolean): Promise<void>
  requestVisualModelInstall(): Promise<void>
  indexVisual(assetId: string): Promise<void>
  searchVisualMoments(indexId: string, query: string, offset?: number): Promise<void>
  analyzeVad(assetId: string): Promise<void>
  applyVadAnalysis(analysisId: string): Promise<void>
  importSpeakerEvidence(assetId: string, document: string): Promise<void>
  previewSpeakerAttribution(analysisId: string): Promise<void>
  applySpeakerAttribution(analysisId: string): Promise<void>
  analyzeBeats(assetId: string): Promise<void>
  analyzeDenoiseMetadata(assetId: string): Promise<void>
  previewAudioSync(referenceItemId: string, targetItemId: string, seed?: number): Promise<void>
  applyAudioSync(analysisId: string, referenceItemId: string, targetItemId: string): Promise<void>
  cancelMediaIntelligence(operationId: string): Promise<void>
  refreshGeneration(): Promise<void>
  requestGeneration(request: GenerationPanelRequest): Promise<void>
  retryGeneration(recordId: string, consent: GenerationConsent): Promise<void>
  cancelGeneration(recordId: string): Promise<void>
  insertGeneratedVariant(recordId: string, outputId: string): Promise<void>
  createMulticam(request: MulticamCreateRequest): Promise<void>
  renameMulticamLabels(request: MulticamRenameRequest): Promise<void>
  confirmMulticamSync(request: MulticamSyncConfirmation): Promise<void>
  switchMulticam(request: MulticamSwitchRequest): Promise<void>
  mergeMulticam(groupId: string): Promise<void>
  applyMulticamLayout(request: MulticamLayoutRequest): Promise<void>
  previewMulticam(request: MulticamSelectionRequest): Promise<void>
  applyOperations(operations: TimelineOperation[], summary: string): Promise<void>
  createSequence(name: string, activate?: boolean): Promise<void>
  duplicateSequence(sequenceId: string, name: string, activate?: boolean): Promise<void>
  renameSequence(sequenceId: string, name: string): Promise<void>
  selectSequence(sequenceId: string): Promise<void>
  closeSequence(sequenceId: string): Promise<void>
  deleteSequence(sequenceId: string): Promise<void>
  setSequenceView(sequenceId: string, zoom: number, scrollFrame: number): Promise<void>
  decomposeNested(itemId: string): Promise<void>
  createMediaFolder(name: string, parentId?: string): Promise<void>
  updateMediaFolder(folderId: string, patch: { name?: string; parentId?: string | null }): Promise<void>
  deleteMediaFolder(folderId: string, moveContentsToFolderId?: string): Promise<void>
  organizeMedia(assetIds: string[], folderId?: string): Promise<void>
  refreshPreviewHistory(): Promise<void>
  addPreview(source: PreviewSourceProjection, label: string): Promise<void>
  selectPreview(entryId: string): Promise<void>
  openPreviewResource(entryId: string): Promise<PreviewResource | undefined>
  comparePreviews(leftEntryId: string, rightEntryId: string, mode: 'wipe' | 'side-by-side'): Promise<void>
  replaceSelectedFromPreview(entryId: string): Promise<void>
  attachSelection(previewEntryIds?: string[]): Promise<void>
  undo(): Promise<void>
  redo(): Promise<void>
  readScript(): Promise<void>
  editScript(markdown: string): void
  applyScript(ranges: Array<{ assetId: string; startUs: number; endUs: number; reason?: 'filler' | 'silence' | 'selection' }>): Promise<void>
  seek(frame: number): void
  togglePlaying(): void
  selectItem(itemId?: string): void
  selectCaption(captionId?: string): void
  setTranscriptWindow(start: number): void
  setTimelineWindow(start: number): void
  startAgent(prompt: string): Promise<void>
  steerAgent(prompt: string): Promise<void>
  cancelAgent(): Promise<void>
  startRender(
    kind: RenderTicket['renderKind'],
    captionMode: 'none' | 'burned' | 'sidecar' | 'both',
    subtitleFormat?: 'srt' | 'vtt',
    options?: {
      multicamGroupId?: string
      range?: { startFrame: number; endFrame: number }
    }
  ): Promise<void>
  cancelJob(jobId: string): Promise<void>
  startProjectPackage(options: ProjectPackageExportOptions): Promise<void>
  refreshProjectPackage(jobId: string): Promise<void>
  cancelProjectPackage(jobId: string): Promise<void>
  startOtioExport(): Promise<void>
  refreshOtioExport(jobId: string): Promise<void>
  cancelOtioExport(jobId: string): Promise<void>
  previewOtioImport(): Promise<void>
  confirmOtioImport(targetProjectId: string): Promise<void>
  cancelOtioImportPreview(): Promise<void>
  openArtifact(artifact: GeneratedArtifact): Promise<void>
  revealArtifact(artifact: GeneratedArtifact): Promise<void>
  dismissNotice(id: string): void
}

export type ProjectPackageExportOptions = {
  missingMediaPolicy: ProjectPackageMissingMediaPolicy
  includeReceipts: boolean
  includeAgentProvenance: boolean
  mediaScope: 'all' | 'selected'
  assetIds?: string[]
}

export type PreviewResource = {
  entryId: string
  title: string
  url: string
  mediaKind: 'video' | 'audio' | 'image'
}

export function useEditorController(client: ExtensionHostClient): EditorController {
  const [state, dispatch] = useReducer(editorReducer, INITIAL_EDITOR_STATE)
  const stateRef = useRef(state)
  const localeRef = useRef(state.locale)
  const ownedLeaseIds = useRef(new Set<string>())
  const derivedLeaseCache = useRef(new Map<string, MediaResourceLease>())
  const derivedLeaseRequests = useRef(new Map<string, Promise<MediaResourceLease>>())
  const pendingOtioImportHandle = useRef<string | undefined>(undefined)
  const initializationGeneration = useRef(0)
  const projectLoadGeneration = useRef(0)
  const activeProjectResolutionGeneration = useRef(0)
  const mediaLibraryLoadGeneration = useRef(0)
  const selectionSyncInFlight = useRef(false)
  const openMediaHandleRef = useRef<((handleId: string) => Promise<void>) | undefined>(undefined)
  stateRef.current = state

  const copy = useCallback((key: MessageKey, values?: Readonly<Record<string, string | number>>): string => {
    return formatMessage(messagesFor(localeRef.current)[key], values)
  }, [])

  const pushNotice = useCallback((notice: Omit<EditorNotice, 'id'> & { id?: string }) => {
    dispatch({
      type: 'notice',
      value: { ...notice, id: notice.id ?? `notice-${Date.now().toString(36)}` }
    })
  }, [])

  const execute = useCallback(async (action: string, payload: JsonObject = {}): Promise<Record<string, unknown>> => {
    const result = await client.commands.executeCommand<JsonValue>(EDITOR_COMMAND, { action, payload })
    const outer = asRecord(result, copy('invalidHostResponse'))
    return isRecord(outer.content) ? outer.content : outer
  }, [client, copy])

  const releaseAllLeases = useCallback(async (): Promise<void> => {
    const leaseIds = [...ownedLeaseIds.current]
    ownedLeaseIds.current.clear()
    derivedLeaseCache.current.clear()
    derivedLeaseRequests.current.clear()
    await Promise.all(leaseIds.map((leaseId) =>
      client.media.release({ resource: 'lease', leaseId }).catch(() => undefined)
    ))
    dispatch({ type: 'active-media', handleId: undefined, url: undefined })
  }, [client])

  const loadDerived = useCallback(async (
    projectId: string,
    expectedRevision = stateRef.current.project?.id === projectId
      ? stateRef.current.project.currentRevision
      : -1
  ): Promise<void> => {
    const content = await execute('derived.list', { projectId })
    const records = Array.isArray(content.records)
      ? content.records.map(derivedRecordFrom).filter((value): value is DerivedMediaRecordProjection => value !== undefined)
      : []
    const usage = derivedUsageFrom(content.usage)
    const recoveryDiagnostics = Array.isArray(content.recoveryDiagnostics)
      ? content.recoveryDiagnostics.filter((value): value is string => typeof value === 'string').slice(0, 32)
      : []
    dispatch({
      type: 'derived',
      projectId,
      revision: expectedRevision,
      records,
      ...(usage ? { usage } : {}),
      recoveryDiagnostics
    })
  }, [execute])

  const loadPreviewHistory = useCallback(async (projectId: string): Promise<void> => {
    const content = await execute('preview.list', { projectId })
    const history = previewHistoryFrom(content.history)
    if (history) dispatch({ type: 'preview-history', projectId, value: history })
    const comparison = previewComparisonFrom(content.comparison)
    if (comparison) dispatch({ type: 'preview-comparison', projectId, value: comparison })
  }, [execute])

  const loadMediaIntelligence = useCallback(async (
    projectId: string,
    expectedRevision: number,
    preferredAssetId = stateRef.current.project?.id === projectId
      ? stateRef.current.selectedAssetId
      : undefined
  ): Promise<void> => {
    const [capabilityContent, listContent] = await Promise.all([
      execute('analysis.capabilities', { projectId, expectedRevision }),
      execute('analysis.list', { projectId, expectedRevision })
    ])
    const capabilities = audioAnalysisCapabilitiesFrom(capabilityContent.capabilities)
    const denoiseMetadataCapability = denoiseMetadataCapabilityFrom(capabilityContent.denoiseMetadata)
    const visualProvisioning = visualProvisioningFrom(capabilityContent.visual)
    const speakerAdapters = speakerAdaptersFrom(capabilityContent.speakerAdapters)
    const speakerIdentities = speakerIdentitiesFrom(capabilityContent.speakerIdentities)
    const records = Array.isArray(listContent.records)
      ? listContent.records
        .map(audioAnalysisRecordFrom)
        .filter((value): value is AudioAnalysisRecordProjection => value !== undefined)
      : []
    const operations = Array.isArray(listContent.operations)
      ? listContent.operations
        .map(mediaIntelligenceProgressFrom)
        .filter((value): value is MediaIntelligenceProgressProjection => value !== undefined)
      : []
    const currentEvidenceRecord = records.find((record) =>
      record.id === stateRef.current.mediaIntelligenceEvidence?.recordId &&
      record.currentGrant !== false
    )
    const cachedSpeaker = [...records].reverse().find((record) =>
      record.kind === 'speaker-diarization' &&
      record.currentGrant !== false &&
      (preferredAssetId === undefined || record.assetId === preferredAssetId)
    )
    const cachedVad = [...records].reverse().find((record) =>
      record.kind === 'vad' &&
      record.currentGrant !== false &&
      (preferredAssetId === undefined || record.assetId === preferredAssetId)
    )
    const cachedDenoise = [...records].reverse().find((record) =>
      record.kind === 'denoise-metadata' &&
      record.currentGrant !== false &&
      (preferredAssetId === undefined || record.assetId === preferredAssetId)
    )
    const cachedEvidenceRecord = currentEvidenceRecord ?? cachedSpeaker ?? cachedVad ?? cachedDenoise
    let evidence: MediaIntelligenceEvidenceProjection | undefined
    if (cachedEvidenceRecord) {
      const evidenceContent = await execute('analysis.evidence', {
        projectId,
        expectedRevision,
        analysisId: cachedEvidenceRecord.id,
        offset: 0,
        limit: 200
      }).catch(() => undefined)
      evidence = mediaIntelligenceEvidenceFrom(evidenceContent?.evidence)
    }
    dispatch({
      type: 'audio-analysis-state',
      projectId,
      revision: expectedRevision,
      ...(capabilities ? { capabilities } : {}),
      ...(denoiseMetadataCapability ? { denoiseMetadataCapability } : {}),
      ...(visualProvisioning ? { visualProvisioning } : {}),
      speakerAdapters,
      speakerIdentities,
      records,
      operations,
      ...(evidence ? { evidence } : {})
    })
  }, [execute])

  const loadGeneration = useCallback(async (projectId: string): Promise<void> => {
    const [catalogContent, listContent] = await Promise.all([
      execute('generation.catalog'),
      execute('generation.list', { projectId })
    ])
    const catalog = generationCatalogFrom(catalogContent.catalog)
    if (!catalog) throw new Error(copy('invalidHostResponse'))
    const records = Array.isArray(listContent.records)
      ? listContent.records
        .map(generationRecordFrom)
        .filter((value): value is GenerationRecordProjection => value !== undefined)
      : []
    const recoveryDiagnostics = Array.isArray(listContent.recoveryDiagnostics)
      ? listContent.recoveryDiagnostics
        .filter((value): value is string => typeof value === 'string')
        .map((value) => value.slice(0, 512))
        .slice(0, 32)
      : []
    const value: GenerationStateProjection = {
      catalog,
      outcome: catalogContent.outcome === 'available' ? 'available' : 'unavailable',
      ...(typeof catalogContent.message === 'string'
        ? { unavailableMessage: catalogContent.message.slice(0, 512) }
        : {}),
      records,
      recoveryDiagnostics
    }
    dispatch({ type: 'generation-state', projectId, value })
  }, [copy, execute])

  const loadProject = useCallback(async (projectId: string): Promise<ProjectProjection> => {
    const generation = ++projectLoadGeneration.current
    mediaLibraryLoadGeneration.current += 1
    const content = await execute('project.get', { projectId })
    const project = projectFrom(content, copy('invalidProjectProjection'))
    if (generation !== projectLoadGeneration.current) return project
    if (stateRef.current.project && stateRef.current.project.id !== project.id) {
      await releaseAllLeases()
      if (generation !== projectLoadGeneration.current) return project
    }
    dispatch({ type: 'project', value: project })
    await loadPreviewHistory(project.id).catch(() => undefined)
    void loadMediaIntelligence(
      project.id,
      project.currentRevision,
      project.selection.selectedAssetIds[0] ?? project.assets[0]?.id
    ).catch(() => undefined)
    void loadGeneration(project.id).catch(() => undefined)
    return project
  }, [copy, execute, loadGeneration, loadMediaIntelligence, loadPreviewHistory, releaseAllLeases])

  const loadMediaLibraryPage = useCallback(async (
    options: { folderId?: string; query?: string; offset?: number; limit?: number } = {}
  ): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const generation = ++mediaLibraryLoadGeneration.current
    const query = options.query?.trim().slice(0, 256) ?? ''
    const offset = Number.isSafeInteger(options.offset) && Number(options.offset) >= 0
      ? Number(options.offset)
      : 0
    const limit = Number.isSafeInteger(options.limit) && Number(options.limit) >= 1 && Number(options.limit) <= 100
      ? Number(options.limit)
      : VIEW_LIMITS.virtualWindow
    try {
      const content = await execute('media.list', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        ...(options.folderId ? { folderId: options.folderId } : {}),
        ...(query ? { query } : {}),
        offset,
        limit
      })
      const page = mediaLibraryPageFrom(content, {
        projectId: project.id,
        revision: project.currentRevision,
        ...(options.folderId ? { folderId: options.folderId } : {}),
        query
      }, copy('invalidHostResponse'))
      if (
        generation !== mediaLibraryLoadGeneration.current ||
        stateRef.current.project?.id !== page.projectId ||
        stateRef.current.project.currentRevision !== page.revision
      ) return
      dispatch({ type: 'media-library', value: page })
    } catch (error) {
      if (
        generation !== mediaLibraryLoadGeneration.current ||
        stateRef.current.project?.id !== project.id ||
        stateRef.current.project.currentRevision !== project.currentRevision
      ) return
      pushNotice({
        ...classifyError(
          error,
          copy('editorOperationFailed'),
          copy('completeProtectedInteraction'),
          isOpaqueHostError(error) || error instanceof ExtensionApiError,
          'editorOperationFailed'
        ),
        id: 'media-library-load-failed'
      })
    }
  }, [copy, execute, pushNotice])

  const syncSelectionContext = useCallback(async (): Promise<void> => {
    if (selectionSyncInFlight.current) return
    const snapshot = stateRef.current
    const project = snapshot.project
    if (!snapshot.initialized || !project) return
    const local = localSelectionProjection(snapshot, project)
    if (selectionFingerprint(local) === selectionFingerprint(project.selection)) return
    selectionSyncInFlight.current = true
    try {
      const content = await execute('context.update', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        expectedGeneration: project.selection.generation,
        sequenceId: local.sequenceId,
        playheadFrame: local.playheadFrame,
        selectedAssetIds: local.selectedAssetIds,
        selectedItemIds: local.selectedItemIds,
        selectedCaptionIds: local.selectedCaptionIds,
        selectedWordIds: local.selectedWordIds,
        range: local.range ?? null
      })
      const updated = selectionUpdateFrom(content)
      if (
        updated &&
        stateRef.current.project?.id === updated.projectId &&
        stateRef.current.project.currentRevision === updated.revision
      ) {
        dispatch({ type: 'selection-synced', ...updated })
      }
    } catch (error) {
      if (stateRef.current.project?.id === project.id) {
        const notice = classifyError(
          error,
          copy('projectChanged'),
          copy('completeProtectedInteraction'),
          false
        )
        if (notice.retryable) void loadProject(project.id)
        else pushNotice({ ...notice, id: 'selection-sync-failed' })
      }
    } finally {
      selectionSyncInFlight.current = false
    }
  }, [copy, execute, loadProject, pushNotice])

  const loadProjects = useCallback(async (): Promise<ProjectSummary[]> => {
    const content = await execute('project.list')
    const projects = Array.isArray(content.projects)
      ? content.projects.filter(isProjectSummary).slice(0, VIEW_LIMITS.projects)
      : []
    const invalidProjectIds = Array.isArray(content.diagnostics)
      ? content.diagnostics
        .filter((value): value is Record<string, unknown> => isRecord(value) && typeof value.id === 'string')
        .map(({ id }) => String(id))
        .slice(0, VIEW_LIMITS.projects)
      : []
    if (invalidProjectIds.length > 0) {
      const values = {
        count: invalidProjectIds.length,
        projects: invalidProjectIds.join(', ')
      }
      pushNotice({
        id: 'invalid-projects-skipped',
        severity: 'warning',
        message: formatMessage(copy('invalidProjectsSkipped'), values),
        messageKey: 'invalidProjectsSkipped',
        messageValues: values
      })
    }
    dispatch({ type: 'projects', value: projects })
    return projects
  }, [copy, execute, pushNotice])

  const loadActiveProject = useCallback(async (): Promise<ProjectProjection | null | undefined> => {
    const generation = ++activeProjectResolutionGeneration.current
    const active = await execute('project.active')
    if (generation !== activeProjectResolutionGeneration.current) return undefined
    if (!isRecord(active.project)) return null
    return await loadProject(projectFrom(active, copy('invalidProjectProjection')).id)
  }, [copy, execute, loadProject])

  const loadProjectPackageSnapshot = useCallback(async (
    ticket: ProjectPackageTicket
  ): Promise<JobSnapshot> => {
    const content = await execute('project-package.status', {
      projectId: ticket.projectId,
      jobId: ticket.jobId
    })
    assertProjectPackageProjection(content.job, ticket, copy('invalidHostResponse'))
    const snapshot = await client.jobs.get(ticket.jobId)
    assertProjectPackageSnapshot(snapshot, ticket, copy('invalidHostResponse'))
    return snapshot
  }, [client, copy, execute])

  const loadOtioExportSnapshot = useCallback(async (
    ticket: OtioExportTicket
  ): Promise<JobSnapshot> => {
    const content = await execute('interchange.status', {
      projectId: ticket.projectId,
      jobId: ticket.jobId
    })
    assertOtioExportProjection(content.job, ticket, copy('invalidHostResponse'))
    const snapshot = await client.jobs.get(ticket.jobId)
    assertOtioExportSnapshot(snapshot, ticket, copy('invalidHostResponse'))
    if (snapshot.state === 'completed' && content.technicallyValidated !== true) {
      throw new Error(copy('interchangeInvalidOutput'))
    }
    return snapshot
  }, [client, copy, execute])

  const refreshJobs = useCallback(async (
    packageTickets: ProjectPackageTicket[] = stateRef.current.projectPackageTickets,
    otioTickets: OtioExportTicket[] = stateRef.current.otioExportTickets
  ): Promise<JobSnapshot[]> => {
    const [page, tracked] = await Promise.all([
      client.jobs.list({ limit: VIEW_LIMITS.jobs }),
      execute('render.list')
    ])
    if (Array.isArray(tracked.records)) {
      for (const record of tracked.records) {
        if (isRenderTicket(record)) dispatch({ type: 'render-ticket', value: record })
      }
    }
    const restoredPackages = (await Promise.all(packageTickets.slice(-VIEW_LIMITS.jobs).map(async (ticket) => {
      try {
        return await loadProjectPackageSnapshot(ticket)
      } catch {
        // The workspace-scoped jobs page remains a safe fallback. A transient
        // tracking read must not discard a persisted package ticket.
        return undefined
      }
    }))).filter((snapshot): snapshot is JobSnapshot => snapshot !== undefined)
    const restoredOtio = (await Promise.all(otioTickets.slice(-VIEW_LIMITS.jobs).map(async (ticket) => {
      try {
        return await loadOtioExportSnapshot(ticket)
      } catch {
        return undefined
      }
    }))).filter((snapshot): snapshot is JobSnapshot => snapshot !== undefined)
    const jobs = [...page.items, ...restoredPackages, ...restoredOtio]
    dispatch({ type: 'jobs', value: jobs })
    return jobs
  }, [client, execute, loadOtioExportSnapshot, loadProjectPackageSnapshot])

  const restoreRun = useCallback(async (runId: string | undefined): Promise<void> => {
    if (!runId) return
    try {
      dispatch({ type: 'agent-run', value: await client.agent.getRun(runId) })
    } catch {
      pushNotice({
        id: 'run-unavailable',
        severity: 'warning',
        message: copy('previousAgentUnavailable'),
        messageKey: 'previousAgentUnavailable'
      })
    }
  }, [client, copy, pushNotice])

  const refreshAll = useCallback(async (): Promise<void> => {
    dispatch({ type: 'reconnect' })
    try {
      await Promise.all([
        loadProjects(),
        refreshJobs(),
        loadActiveProject().then(async (project) => {
          if (project === null) {
            await releaseAllLeases()
            dispatch({ type: 'clear-project' })
          }
        })
      ])
      if (stateRef.current.agentRun) await restoreRun(stateRef.current.agentRun.id)
      dispatch({ type: 'connection', value: 'online' })
    } catch (error) {
      dispatch({ type: 'connection', value: 'offline' })
      pushNotice(classifyError(
        error,
        copy('reconnectFailed'),
        copy('completeProtectedInteraction'),
        true,
        'reconnectFailed'
      ))
    }
  }, [copy, loadActiveProject, loadProjects, pushNotice, refreshJobs, releaseAllLeases, restoreRun])

  const initializeEditor = useCallback(async (retrying = false): Promise<void> => {
    const generation = ++initializationGeneration.current
    if (retrying) dispatch({ type: 'reconnect' })
    try {
      const [restored] = await Promise.all([
        client.ui.getViewState<JsonValue>(),
        loadProjects()
      ])
      if (generation !== initializationGeneration.current) return
      const persisted = persistedState(restored)
      dispatch({ type: 'initialized', ...(persisted ? { persisted } : {}) })
      await refreshJobs(
        persisted?.projectPackageTickets ?? [],
        persisted?.otioExportTickets ?? []
      )
      if (generation !== initializationGeneration.current) return
      await loadActiveProject()
      if (generation !== initializationGeneration.current) return
      await restoreRun(persisted?.activeRunId)
      if (generation !== initializationGeneration.current) return
      dispatch({ type: 'dismiss-notice', id: 'initialization-failed' })
      dispatch({ type: 'connection', value: 'online' })
    } catch (error) {
      if (generation !== initializationGeneration.current) return
      dispatch({ type: 'initialized' })
      dispatch({ type: 'connection', value: 'offline' })
      pushNotice({
        ...classifyError(
          error,
          copy('editorInitializeFailed'),
          copy('completeProtectedInteraction'),
          true,
          'editorInitializeFailed'
        ),
        id: 'initialization-failed'
      })
    }
  }, [client, copy, loadActiveProject, loadProjects, pushNotice, refreshJobs, restoreRun])

  const activeDerivedKey = useMemo(() => state.derivedRecords
    .filter(({ status }) => ['queued', 'running', 'partial'].includes(status))
    .map(({ id, generation }) => `${id}:${generation}`)
    .sort()
    .join('|'), [state.derivedRecords])

  useEffect(() => {
    if (!state.initialized || !state.project) return
    const local = localSelectionProjection(state, state.project)
    if (selectionFingerprint(local) === selectionFingerprint(state.project.selection)) return
    const timeout = globalThis.setTimeout(() => {
      void syncSelectionContext()
    }, SELECTION_SYNC_DEBOUNCE_MS)
    return () => globalThis.clearTimeout(timeout)
  }, [
    state.initialized,
    state.playheadFrame,
    state.project,
    state.selectedAssetId,
    state.selectedCaptionId,
    state.selectedItemId,
    syncSelectionContext
  ])

  useEffect(() => {
    let disposed = false
    let themeChanged = false
    let localeChanged = false
    const themeSubscription = client.ui.onDidChangeTheme((value) => {
      themeChanged = true
      dispatch({ type: 'theme', value })
    })
    const localeSubscription = client.ui.onDidChangeLocale((value) => {
      localeChanged = true
      localeRef.current = value
      dispatch({ type: 'locale', value })
    })
    void client.ui.getTheme().then((value) => {
      if (!disposed && !themeChanged) dispatch({ type: 'theme', value })
    }).catch((error) => {
      if (!disposed) pushNotice(classifyError(
        error,
        copy('hostClientError'),
        copy('completeProtectedInteraction'),
        true,
        'hostClientError'
      ))
    })
    void client.ui.getLocale().then((value) => {
      if (disposed || localeChanged) return
      localeRef.current = value
      dispatch({ type: 'locale', value })
    }).catch((error) => {
      if (!disposed) pushNotice(classifyError(
        error,
        copy('hostClientError'),
        copy('completeProtectedInteraction'),
        true,
        'hostClientError'
      ))
    })
    return () => {
      disposed = true
      void themeSubscription.dispose()
      void localeSubscription.dispose()
    }
  }, [client, copy, pushNotice])

  useEffect(() => {
    let disposed = false
    void client.media.getCapabilities().then((value) => {
      if (!disposed) dispatch({ type: 'media-capabilities', value })
    }).catch((error) => {
      if (!disposed) pushNotice(classifyError(
        error,
        copy('mediaCapabilitiesUnavailable'),
        copy('completeProtectedInteraction'),
        true,
        'mediaCapabilitiesUnavailable'
      ))
    })
    return () => { disposed = true }
  }, [client, copy, pushNotice])

  useEffect(() => {
    void initializeEditor()
    return () => { initializationGeneration.current += 1 }
  }, [initializeEditor])

  useEffect(() => {
    const errorSubscription = client.onDidError((error) => pushNotice(classifyError(
      error,
      copy('hostClientError'),
      copy('completeProtectedInteraction'),
      true,
      'hostClientError'
    )))
    const messageSubscription = client.ui.onDidReceiveMessage((message) => {
      if (message.channel === 'kun.extension.view.overflow') {
        void refreshAll()
        return
      }
      if (message.channel === 'kun-video-editor.project-changed') {
        const change = projectChange(message.payload, copy('projectChanged'))
        if (change) dispatch({ type: 'project-change', value: change })
        if (
          change &&
          (change.projectId === stateRef.current.project?.id || change.reason === 'active-project-changed')
        ) {
          if (change.reason === 'active-project-changed') activeProjectResolutionGeneration.current += 1
          void loadProject(change.projectId)
        }
        return
      }
      if (message.channel === 'kun-video-editor.selection-changed') {
        const updated = selectionUpdateFrom(message.payload)
        if (updated) dispatch({ type: 'selection-synced', ...updated })
        return
      }
      if (message.channel === 'kun-video-editor.derived-changed') {
        const payload = isRecord(message.payload) ? message.payload : undefined
        const record = derivedRecordFrom(payload?.record)
        if (record) dispatch({ type: 'derived-record', value: record })
        const projectId = record?.projectId
        if (projectId && projectId === stateRef.current.project?.id) {
          void loadDerived(projectId)
        }
        return
      }
      if (message.channel === 'kun-video-editor.media-intelligence-progress') {
        const progress = mediaIntelligenceProgressFrom(message.payload)
        if (progress) dispatch({ type: 'media-intelligence-progress', value: progress })
        return
      }
      if (message.channel === 'kun-video-editor.generation-progress') {
        const payload = isRecord(message.payload) ? message.payload : undefined
        const record = generationRecordFrom(payload?.record)
        if (record) dispatch({ type: 'generation-record', value: record })
        return
      }
      if (message.channel === 'kun-video-editor.active-project-changed') {
        const change = projectChange(message.payload, copy('projectChanged'))
        if (change) {
          activeProjectResolutionGeneration.current += 1
          dispatch({ type: 'project-change', value: change })
          void loadProject(change.projectId)
        }
        return
      }
      if (message.channel === 'kun.resultPreview.open') {
        const preview = ResultPreviewOpenPayloadSchema.safeParse(message.payload)
        if (preview.success) {
          dispatch({ type: 'result-preview', value: preview.data })
          if (preview.data.result.mediaHandleId) {
            void openMediaHandleRef.current?.(preview.data.result.mediaHandleId)
          }
        }
        return
      }
      if (message.channel === 'kun-video-editor.command-progress') {
        const progress = isRecord(message.payload) ? message.payload : {}
        if (typeof progress.message === 'string') {
          const key = COMMAND_PROGRESS_MESSAGE_KEYS[progress.message] ?? 'commandProgressGeneric'
          pushNotice({
            id: 'command-progress',
            severity: 'info',
            message: copy(key),
            messageKey: key
          })
        }
      }
    })
    return () => {
      void errorSubscription.dispose()
      void messageSubscription.dispose()
    }
  }, [client, copy, loadDerived, loadProject, pushNotice, refreshAll])

  const activeGenerationKey = useMemo(() => state.generation.records
    .filter(({ state: recordState }) => ['placeholder', 'queued', 'running', 'cancelling'].includes(recordState))
    .map(({ id, generation }) => `${id}:${generation}`)
    .sort()
    .join('|'), [state.generation.records])

  useEffect(() => {
    const projectId = state.project?.id
    if (!projectId) return
    let disposed = false
    let loading = false
    const refresh = (): void => {
      if (disposed || loading) return
      loading = true
      void loadGeneration(projectId).catch(() => undefined).finally(() => { loading = false })
    }
    if (activeGenerationKey) refresh()
    const timer = activeGenerationKey
      ? setInterval(refresh, JOB_STATUS_RECONCILE_INTERVAL_MS)
      : undefined
    return () => {
      disposed = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [activeGenerationKey, loadGeneration, state.project?.id])

  useEffect(() => {
    const projectId = state.project?.id
    if (!projectId) return
    let disposed = false
    let loading = false
    const refresh = (): void => {
      if (disposed || loading) return
      loading = true
      void loadDerived(projectId).catch((error) => {
        if (!disposed) pushNotice(classifyError(
          error,
          copy('derivedStatusUnavailable'),
          copy('completeProtectedInteraction'),
          true,
          'derivedStatusUnavailable'
        ))
      }).finally(() => { loading = false })
    }
    refresh()
    const timer = activeDerivedKey
      ? setInterval(refresh, JOB_STATUS_RECONCILE_INTERVAL_MS)
      : undefined
    return () => {
      disposed = true
      if (timer !== undefined) clearInterval(timer)
    }
  }, [activeDerivedKey, copy, loadDerived, pushNotice, state.project?.id])

  useEffect(() => {
    if (!state.initialized) return
    const timeout = setTimeout(() => {
      void client.ui.setViewState(toPersistedState(stateRef.current)).catch((error) => {
        pushNotice(classifyError(
          error,
          copy('viewStateSaveFailed'),
          copy('completeProtectedInteraction'),
          true,
          'viewStateSaveFailed'
        ))
      })
    }, 180)
    return () => clearTimeout(timeout)
  }, [
    client,
    copy,
    pushNotice,
    state.activeWorkspace,
    state.agentRun?.id,
    state.initialized,
    state.playheadFrame,
    state.otioExportTickets,
    state.project?.id,
    state.projectPackageTickets,
    state.renderTickets,
    state.selectedItemId,
    state.transcriptWindowStart
  ])

  useEffect(() => {
    const run = state.agentRun
    if (!run || TERMINAL_AGENT_STATES.has(run.state)) return
    let disposed = false
    let subscription: Awaited<ReturnType<typeof client.agent.subscribe>> | undefined
    let eventSubscription: { dispose(): void | Promise<void> } | undefined
    void client.agent.subscribe({
      runId: run.id,
      afterSequence: stateRef.current.agentEvents.at(-1)?.sequence ?? 0
    }).then((created) => {
      if (disposed) return void created.dispose()
      subscription = created
      eventSubscription = created.onEvent((event) => {
        dispatch({ type: 'agent-event', value: event })
        if (event.type === 'state' || event.type === 'terminal') {
          void client.agent.getRun(run.id).then((value) => dispatch({ type: 'agent-run', value }))
        }
        if (agentEventChangesProject(event) && stateRef.current.project) {
          void loadProject(stateRef.current.project.id)
        }
      })
    }).catch((error) => pushNotice(classifyError(
      error,
      copy('agentStreamDisconnected'),
      copy('completeProtectedInteraction'),
      true,
      'agentStreamDisconnected'
    )))
    return () => {
      disposed = true
      void eventSubscription?.dispose()
      void subscription?.dispose()
    }
  }, [client, copy, loadProject, pushNotice, state.agentRun?.id, state.reconnectToken])

  const activeJobsKey = useMemo(() => state.jobs
    .filter(({ state: jobState }) => !TERMINAL_JOB_STATES.has(jobState))
    .map(({ id, state: jobState }) => `${id}:${jobState}`)
    .sort()
    .join('|'), [state.jobs])

  useEffect(() => {
    const active = state.jobs.filter(({ state: jobState }) => !TERMINAL_JOB_STATES.has(jobState))
    const disposables: Array<{ dispose(): void | Promise<void> }> = []
    let disposed = false
    let reconcileInFlight = false
    for (const job of active) {
      void client.jobs.subscribe({ jobId: job.id, afterCursor: job.latestCursor }).then((subscription) => {
        if (disposed) return void subscription.dispose()
        disposables.push(subscription)
        // Register first: the SDK delivers buffered/replayed events synchronously
        // from onEvent() and folds them into the subscription snapshot.
        disposables.push(subscription.onEvent((event) => dispatch({ type: 'job-event', value: event })))
        dispatch({
          type: 'jobs',
          value: [
            ...stateRef.current.jobs.filter(({ id }) => id !== subscription.snapshot.id),
            subscription.snapshot
          ]
        })
        if (subscription.replayGap) {
          pushNotice({
            id: `job-gap-${job.id}`,
            severity: 'warning',
            message: copy('jobProgressExpired'),
            messageKey: 'jobProgressExpired'
          })
        }
      }).catch((error) => {
        const values = { id: job.id }
        pushNotice(classifyError(
          error,
          formatMessage(copy('jobDisconnected'), values),
          copy('completeProtectedInteraction'),
          true,
          'jobDisconnected',
          values
        ))
      })
    }
    const reconcileTimer = active.length > 0
      ? setInterval(() => {
        if (disposed || reconcileInFlight) return
        const tracked = stateRef.current.jobs.filter(({ state: jobState }) =>
          !TERMINAL_JOB_STATES.has(jobState)
        )
        if (tracked.length === 0) return
        reconcileInFlight = true
        void Promise.all(tracked.map(async (job) => {
          try {
            return await client.jobs.get(job.id)
          } catch {
            // The live subscription remains the primary path. A transient status
            // read must not disconnect it or spam the user with duplicate errors.
            return job
          }
        })).then((snapshots) => {
          if (disposed) return
          const refreshed = new Map(snapshots.map((snapshot) => [snapshot.id, snapshot]))
          dispatch({
            type: 'jobs',
            value: stateRef.current.jobs.map((job) => refreshed.get(job.id) ?? job)
          })
        }).finally(() => { reconcileInFlight = false })
      }, JOB_STATUS_RECONCILE_INTERVAL_MS)
      : undefined
    return () => {
      disposed = true
      if (reconcileTimer !== undefined) clearInterval(reconcileTimer)
      for (const disposable of disposables) void disposable.dispose()
    }
  }, [activeJobsKey, client, copy, pushNotice, state.reconnectToken])

  useEffect(() => () => {
    for (const leaseId of ownedLeaseIds.current) {
      void client.media.release({ resource: 'lease', leaseId }).catch(() => undefined)
    }
    const handleId = pendingOtioImportHandle.current
    if (handleId) {
      pendingOtioImportHandle.current = undefined
      void client.media.release({ resource: 'handle', handleId }).catch(() => undefined)
    }
  }, [client])

  const withBusy = useCallback(async (operation: () => Promise<void>): Promise<void> => {
    dispatch({ type: 'busy', value: true })
    try {
      await operation()
    } catch (error) {
      const currentRevision = revisionFromError(error)
      if (isRevisionConflict(error) && stateRef.current.project) {
        dispatch({
          type: 'conflict',
          expectedRevision: stateRef.current.project.currentRevision,
          ...(currentRevision === undefined ? {} : { currentRevision })
        })
        await loadProject(stateRef.current.project.id).catch(() => undefined)
      }
      pushNotice(classifyError(
        error,
        copy('editorOperationFailed'),
        copy('completeProtectedInteraction'),
        isOpaqueHostError(error) || error instanceof ExtensionApiError,
        'editorOperationFailed'
      ))
    } finally {
      dispatch({ type: 'busy', value: false })
    }
  }, [copy, loadProject, pushNotice])

  const createProject = useCallback(async (
    name: string,
    preset: CanvasPreset,
    fps: { numerator: number; denominator: number } = { numerator: 30, denominator: 1 }
  ): Promise<void> => {
    await withBusy(async () => {
      const normalized = name.trim().slice(0, 160)
      if (!normalized) throw new Error(copy('projectNameRequired'))
      const idBase = normalized.toLowerCase().replace(/[^a-z0-9._~-]+/gu, '-').replace(/^-|-$/gu, '') || 'video'
      const projectId = `${idBase.slice(0, 96)}-${Date.now().toString(36)}`
      const content = await execute('project.create', {
        projectId,
        name: normalized,
        canvasPreset: preset,
        fps
      })
      const created = projectFrom(content, copy('invalidProjectProjection'))
      await loadProject(created.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const openProject = useCallback(async (projectId: string): Promise<void> => {
    await withBusy(async () => {
      await execute('project.select', { projectId })
      await loadProject(projectId)
    })
  }, [execute, loadProject, withBusy])

  const refreshGeneration = useCallback(async (): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    await loadGeneration(project.id)
  }, [copy, loadGeneration])

  const requestGeneration = useCallback(async (request: GenerationPanelRequest): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      if (request.projectId !== project.id || request.projectRevision !== project.currentRevision) {
        throw new Error(copy('projectChanged'))
      }
      const content = await execute('generation.request', request as unknown as JsonObject)
      if (content.outcome === 'confirmation-required') {
        throw new Error(typeof content.message === 'string'
          ? content.message.slice(0, 512)
          : copy('editorOperationFailed'))
      }
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'generation-unavailable',
          severity: 'warning',
          message: typeof content.message === 'string'
            ? content.message.slice(0, 512)
            : copy('editorOperationFailed')
        })
      }
      await loadGeneration(project.id)
    })
  }, [copy, execute, loadGeneration, pushNotice, withBusy])

  const retryGeneration = useCallback(async (
    recordId: string,
    consent: GenerationConsent
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('generation.retry', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        recordId,
        consent: consent as unknown as JsonObject
      })
      if (content.outcome === 'confirmation-required' || content.outcome === 'unavailable') {
        pushNotice({
          id: `generation-retry-${recordId}`,
          severity: 'warning',
          message: typeof content.message === 'string'
            ? content.message.slice(0, 512)
            : copy('editorOperationFailed')
        })
      }
      await loadGeneration(project.id)
    })
  }, [copy, execute, loadGeneration, pushNotice, withBusy])

  const cancelGeneration = useCallback(async (recordId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('generation.cancel', { projectId: project.id, recordId })
      await loadGeneration(project.id)
    })
  }, [copy, execute, loadGeneration, withBusy])

  const insertGeneratedVariant = useCallback(async (
    recordId: string,
    outputId: string
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('generation.insert', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        recordId,
        outputId,
        addToTimeline: true,
        timelineStartFrame: project.selection.playheadFrame,
        stillDurationFrames: 150
      })
      if (!['inserted', 'already-in-project'].includes(String(content.outcome))) {
        throw new Error(copy('invalidHostResponse'))
      }
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const importMedia = useCallback(async (
    options: { folderId?: string; addToTimeline?: boolean } = {}
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      if (stateRef.current.mediaCapabilities?.ffprobe.available === false) {
        pushNotice({
          id: 'ffprobe-unavailable',
          severity: 'warning',
          message: copy('ffprobeUnavailable'),
          messageKey: 'ffprobeUnavailable'
        })
        return
      }
      const selection = await client.media.pickFiles({
        multiple: true,
        maxFiles: 32,
        filters: [{
          name: copy('chooseMedia'),
          extensions: [
            'mp4', 'mov', 'mkv', 'webm', 'm4a', 'mp3', 'wav',
            'png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'
          ],
          mimeTypes: ['video/*', 'audio/*', 'image/*']
        }]
      })
      if (selection.outcome === 'cancelled') return
      try {
        const content = await execute('media.import-batch', {
          projectId: project.id,
          expectedRevision: project.currentRevision,
          items: selection.files.map((file) => ({
            mediaHandleId: file.handleId,
            ...(visualAssetKind(file.displayName, file.kind) ? {
              assetKind: visualAssetKind(file.displayName, file.kind),
              stillDurationFrames: 150
            } : {})
          })),
          addToTimeline: options.addToTimeline ?? true,
          ...(options.folderId ? { folderId: options.folderId } : {})
        })
        if (content.outcome === 'unavailable') {
          const messageKey: MessageKey = content.code === 'FFPROBE_UNAVAILABLE'
            ? 'ffprobeUnavailable'
            : 'mediaCapabilitiesUnavailable'
          pushNotice({
            id: 'media-import-unavailable',
            severity: 'warning',
            message: copy(messageKey),
            messageKey
          })
          await Promise.all(selection.files.map(({ handleId }) =>
            client.media.release({ resource: 'handle', handleId }).catch(() => undefined)
          ))
          await loadProject(project.id)
          await loadProjects()
          return
        }
        const currentRevision = safeInteger(content.currentRevision)
        if (
          content.outcome !== 'imported-batch' ||
          safeInteger(content.importedCount) !== selection.files.length ||
          currentRevision !== project.currentRevision + 1
        ) {
          throw new Error(copy('invalidHostResponse'))
        }
        dispatch({ type: 'media', value: selection.files })
      } catch (error) {
        const authoritative = await loadProject(project.id).catch(() => undefined)
        // A lost response may hide a successful atomic commit. Only revoke the
        // picker grants when the authoritative revision proves no commit won;
        // otherwise preserving the grants is safer than taking bound media offline.
        let releasable = authoritative?.currentRevision === project.currentRevision
          ? selection.files
          : []
        if (authoritative && authoritative.currentRevision > project.currentRevision) {
          try {
            const retainedHandles = new Set<string>()
            let offset = 0
            for (let pageIndex = 0; pageIndex < 6; pageIndex += 1) {
              const pageContent = await execute('media.list', {
                projectId: project.id,
                expectedRevision: authoritative.currentRevision,
                offset,
                limit: 100
              })
              const page = mediaLibraryPageFrom(pageContent, {
                projectId: project.id,
                revision: authoritative.currentRevision,
                query: ''
              }, copy('invalidHostResponse'))
              for (const asset of page.assets) {
                if (asset.mediaHandleId) retainedHandles.add(asset.mediaHandleId)
              }
              if (page.hiddenAfter === 0) {
                releasable = selection.files.filter(({ handleId }) => !retainedHandles.has(handleId))
                break
              }
              if (page.assets.length === 0) throw new Error(copy('invalidHostResponse'))
              offset += page.assets.length
            }
          } catch {
            // Keep ambiguous picker grants alive rather than revoke media that
            // may have committed on the lost-response path.
            releasable = []
          }
        }
        await Promise.all(releasable.map(({ handleId }) =>
          client.media.release({ resource: 'handle', handleId }).catch(() => undefined)
        ))
        throw error
      }
      await loadProject(project.id)
      await loadProjects()
    })
  }, [client, copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const importTranscript = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const assetId = stateRef.current.selectedAssetId
      if (!assetId || !assetFromState(stateRef.current, assetId)) {
        throw new Error(copy('selectAssetForTranscript'))
      }
      const selection = await client.media.pickFiles({
        multiple: false,
        maxFiles: 1,
        filters: [{
          name: copy('chooseTranscript'),
          extensions: ['srt', 'vtt', 'json'],
          mimeTypes: ['application/x-subrip', 'text/vtt', 'application/json', 'text/plain']
        }]
      })
      if (selection.outcome === 'cancelled') return
      const file = selection.files[0]!
      try {
        const text = await client.media.readText({ handleId: file.handleId, maxBytes: 512 * 1024 })
        const format = transcriptFormat(
          text.displayName,
          text.mimeType,
          copy('unsupportedTranscriptFormat')
        )
        const content = await execute('transcript.import', {
          projectId: project.id,
          expectedRevision: project.currentRevision,
          assetId,
          transcriptId: `transcript-${Date.now().toString(36)}`,
          mode: 'import',
          format,
          source: text.content
        })
        const values = { count: transcriptSegmentCount(content) }
        pushNotice({
          id: 'transcript-imported',
          severity: 'info',
          message: formatMessage(copy('transcriptImported'), values),
          messageKey: 'transcriptImported',
          messageValues: values
        })
        await loadProject(project.id)
        await loadProjects()
      } finally {
        await client.media.release({ resource: 'handle', handleId: file.handleId }).catch(() => undefined)
      }
    })
  }, [client, copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const checkLocalTranscriber = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const assetId = stateRef.current.selectedAssetId
      if (!assetId) throw new Error(copy('selectAssetForTranscript'))
      const content = await execute('transcript.import', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId,
        transcriptId: `transcript-check-${Date.now().toString(36)}`,
        mode: 'local-asr'
      })
      pushNotice({
        id: 'local-transcriber-status',
        severity: content.outcome === 'unavailable' ? 'warning' : 'info',
        message: content.outcome === 'unavailable'
          ? copy('localTranscriberUnavailable')
          : copy('localTranscriberAvailable'),
        messageKey: content.outcome === 'unavailable'
          ? 'localTranscriberUnavailable'
          : 'localTranscriberAvailable'
      })
    })
  }, [copy, execute, pushNotice, withBusy])

  const generateCaptions = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const selectedAssetId = stateRef.current.selectedAssetId
      const transcripts = selectedAssetId
        ? project.transcripts.filter(({ assetId }) => assetId === selectedAssetId)
        : project.transcripts
      const captionTrack = project.tracks.find(({ kind }) => kind === 'caption')
      if (!captionTrack || transcripts.length === 0) throw new Error(copy('transcriptRequiredForCaptions'))
      const content = await execute('caption.generate', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        trackId: captionTrack.id,
        ...(selectedAssetId ? { assetId: selectedAssetId } : {}),
        idPrefix: `caption-auto-${Date.now().toString(36)}`,
        placement: 'bottom',
        style: { fontSize: 42, color: '#FFFFFF', background: '#000000', maxWidthRatio: 0.84 },
        animation: { kind: 'none' }
      })
      const values = { count: safeInteger(content.generatedCount) ?? 0 }
      pushNotice({
        id: 'captions-generated',
        severity: 'info',
        message: formatMessage(copy('generatedCaptions'), values),
        messageKey: 'generatedCaptions',
        messageValues: values
      })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const openMediaHandle = useCallback(async (handleId: string): Promise<void> => {
    const existing = stateRef.current.leases[handleId]
    if (existing && Date.parse(existing.expiresAt) - Date.now() > 30_000) {
      dispatch({ type: 'active-media', handleId, url: existing.url })
      return
    }
    try {
      const previous = stateRef.current.activeMediaHandleId
      if (previous && previous !== handleId) {
        const lease = stateRef.current.leases[previous]
        if (lease) {
          ownedLeaseIds.current.delete(lease.leaseId)
          await client.media.release({ resource: 'lease', leaseId: lease.leaseId }).catch(() => undefined)
        }
      }
      const lease = await client.media.openViewResource({ handleId })
      ownedLeaseIds.current.add(lease.leaseId)
      dispatch({ type: 'lease', value: lease })
      dispatch({ type: 'active-media', handleId, url: lease.url })
    } catch (error) {
      if (isRevokedMediaError(error)) dispatch({ type: 'media-revoked', handleId })
      throw error
    }
  }, [client])
  openMediaHandleRef.current = openMediaHandle

  const openAsset = useCallback(async (assetId: string): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const asset = assetFromState(stateRef.current, assetId)
    if (!asset?.mediaHandleId) {
      pushNotice({
        id: 'asset-unavailable',
        severity: 'warning',
        message: copy('assetUnavailable'),
        messageKey: 'assetUnavailable'
      })
      return
    }
    dispatch({ type: 'selection', assetId })
    await withBusy(() => openMediaHandle(asset.mediaHandleId!))
  }, [copy, openMediaHandle, pushNotice, withBusy])

  const openPassiveMediaHandle = useCallback(async (handleId: string): Promise<string> => {
    const existing = derivedLeaseCache.current.get(handleId) ?? stateRef.current.leases[handleId]
    if (existing && Date.parse(existing.expiresAt) - Date.now() > 30_000) return existing.url
    if (existing) {
      derivedLeaseCache.current.delete(handleId)
      ownedLeaseIds.current.delete(existing.leaseId)
      await client.media.release({ resource: 'lease', leaseId: existing.leaseId }).catch(() => undefined)
      dispatch({ type: 'lease-release', handleId })
    }
    let request = derivedLeaseRequests.current.get(handleId)
    if (!request) {
      request = client.media.openViewResource({ handleId })
      derivedLeaseRequests.current.set(handleId, request)
    }
    let lease: MediaResourceLease
    try {
      lease = await request
    } finally {
      if (derivedLeaseRequests.current.get(handleId) === request) derivedLeaseRequests.current.delete(handleId)
    }
    derivedLeaseCache.current.set(handleId, lease)
    ownedLeaseIds.current.add(lease.leaseId)
    dispatch({ type: 'lease', value: lease })
    return lease.url
  }, [client])

  const openDerivedResource = useCallback(async (recordId: string): Promise<string | undefined> => {
    const record = stateRef.current.derivedRecords.find(({ id }) => id === recordId)
    const handleId = record?.artifactHandleId
    if (!handleId) return undefined
    return await openPassiveMediaHandle(handleId)
  }, [openPassiveMediaHandle])

  const refreshActiveLease = useCallback(async (): Promise<void> => {
    const handleId = stateRef.current.activeMediaHandleId
    if (!handleId) return
    const lease = stateRef.current.leases[handleId]
    if (lease) {
      ownedLeaseIds.current.delete(lease.leaseId)
      await client.media.release({ resource: 'lease', leaseId: lease.leaseId }).catch(() => undefined)
    }
    dispatch({ type: 'lease-release', handleId })
    await withBusy(() => openMediaHandle(handleId))
  }, [client, openMediaHandle, withBusy])

  const recoverMedia = useCallback(async (requestedAssetId?: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const assetId = requestedAssetId ?? stateRef.current.selectedAssetId
      const asset = assetFromState(stateRef.current, assetId)
      if (!asset) throw new Error(copy('assetUnavailable'))
      const selection = await client.media.pickFiles({
        multiple: false,
        maxFiles: 1,
        filters: [{
          name: copy('chooseReplacementMedia'),
          extensions: asset.kind === 'video'
            ? ['mp4', 'mov', 'mkv', 'webm']
            : asset.kind === 'audio'
              ? ['m4a', 'mp3', 'wav']
              : ['png', 'jpg', 'jpeg', 'webp', 'gif', 'apng'],
          mimeTypes: [asset.kind === 'animation' ? 'image/*' : `${asset.kind}/*`]
        }]
      })
      if (selection.outcome === 'cancelled') return
      const replacement = selection.files[0]!
      dispatch({ type: 'media', value: [replacement] })
      try {
        await releaseAllLeases()
        await execute('media.reauthorize', {
          projectId: project.id,
          expectedRevision: project.currentRevision,
          assetId: asset.id,
          mediaHandleId: replacement.handleId
        })
      } catch (error) {
        await client.media.release({
          resource: 'handle',
          handleId: replacement.handleId
        }).catch(() => undefined)
        throw error
      }
      const values = { name: asset.name }
      pushNotice({
        id: `asset-reauthorized-${asset.id}`,
        severity: 'info',
        message: formatMessage(copy('mediaReauthorized'), values),
        messageKey: 'mediaReauthorized',
        messageValues: values
      })
      await loadProject(project.id)
    })
  }, [client, copy, execute, loadProject, pushNotice, releaseAllLeases, withBusy])

  const refreshDerived = useCallback(async (): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    await loadDerived(project.id)
  }, [copy, loadDerived])

  const refreshMediaIntelligence = useCallback(async (): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    await loadMediaIntelligence(project.id, project.currentRevision)
  }, [copy, loadMediaIntelligence])

  const setVisualOptIn = useCallback(async (enabled: boolean): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.visual-opt-in', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        enabled
      })
      const visualProvisioning = visualProvisioningFrom(content.capability)
      dispatch({
        type: 'audio-analysis-state',
        projectId: project.id,
        revision: project.currentRevision,
        ...(visualProvisioning ? { visualProvisioning } : {}),
        clearVisualMomentPage: true
      })
      await loadMediaIntelligence(project.id, project.currentRevision)
    })
  }, [copy, execute, loadMediaIntelligence, withBusy])

  const requestVisualModelInstall = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.visual-install', {
        projectId: project.id,
        expectedRevision: project.currentRevision
      })
      const visualProvisioning = visualProvisioningFrom(content.capability)
      if (visualProvisioning) {
        dispatch({
          type: 'audio-analysis-state',
          projectId: project.id,
          revision: project.currentRevision,
          visualProvisioning
        })
      }
      if (content.outcome !== 'ready') {
        pushNotice({
          id: 'visual-model-install-unavailable',
          severity: 'warning',
          message: visualProvisioning?.remediation ?? copy('visualModelUnavailable'),
          retryable: false
        })
      }
    })
  }, [copy, execute, pushNotice, withBusy])

  const indexVisual = useCallback(async (assetId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.visual-index', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId,
        intervalUs: 2_000_000,
        maxFrames: 240,
        allowPartial: false
      })
      if (content.outcome === 'unavailable') {
        const capability = visualProvisioningFrom(content.capability)
        if (capability) {
          dispatch({
            type: 'audio-analysis-state',
            projectId: project.id,
            revision: project.currentRevision,
            visualProvisioning: capability
          })
        }
        pushNotice({
          id: 'visual-index-unavailable',
          severity: 'warning',
          message: capability?.remediation ?? copy('visualModelUnavailable'),
          retryable: false
        })
        return
      }
      await loadMediaIntelligence(project.id, project.currentRevision)
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const searchVisualMoments = useCallback(async (
    indexId: string,
    query: string,
    offset = 0
  ): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const normalized = query.normalize('NFKC').trim()
    if (!normalized || normalized.length > 256) return
    const content = await execute('analysis.visual-search', {
      projectId: project.id,
      expectedRevision: project.currentRevision,
      analysisId: indexId,
      query: normalized,
      minimumScore: -1,
      offset: Math.max(0, Math.floor(offset)),
      pageSize: 20
    })
    if (content.outcome !== 'ready') {
      pushNotice({
        id: 'visual-search-unavailable',
        severity: 'warning',
        message: typeof content.remediation === 'string'
          ? content.remediation.slice(0, 1_024)
          : copy('visualModelUnavailable'),
        retryable: false
      })
      return
    }
    const visualMomentPage = visualMomentPageFrom(content.page, indexId)
    if (visualMomentPage) {
      dispatch({
        type: 'audio-analysis-state',
        projectId: project.id,
        revision: project.currentRevision,
        visualMomentPage
      })
    }
  }, [copy, execute, pushNotice])

  const analyzeVad = useCallback(async (assetId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.vad', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId
      })
      const evidence = mediaIntelligenceEvidenceFrom(content.evidence)
      if (evidence) dispatch({ type: 'audio-analysis-state', projectId: project.id, revision: project.currentRevision, evidence })
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'audio-vad-unavailable',
          severity: 'warning',
          message: copy('audioVadUnavailable'),
          messageKey: 'audioVadUnavailable'
        })
      }
      await loadMediaIntelligence(project.id, project.currentRevision)
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const applyVadAnalysis = useCallback(async (analysisId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.vad-apply', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        analysisId
      })
      if (content.outcome === 'refused') {
        pushNotice({
          id: 'audio-vad-refused',
          severity: 'warning',
          message: copy('audioAnalysisConfidenceRefused'),
          messageKey: 'audioAnalysisConfidenceRefused'
        })
        return
      }
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const importSpeakerEvidence = useCallback(async (
    assetId: string,
    serializedDocument: string
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      if (serializedDocument.length < 2 || serializedDocument.length > 2_097_152) {
        throw new Error(copy('speakerImportInvalid'))
      }
      let document: unknown
      try {
        document = JSON.parse(serializedDocument)
      } catch {
        throw new Error(copy('speakerImportInvalid'))
      }
      if (!isRecord(document)) throw new Error(copy('speakerImportInvalid'))
      const content = await execute('analysis.speaker-import', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId,
        document: document as JsonObject
      })
      const evidence = mediaIntelligenceEvidenceFrom(content.evidence)
      const identities = speakerIdentitiesFrom(content.identities)
      const record = audioAnalysisRecordFrom(content.record)
      if (content.outcome !== 'ready' || !evidence || !record || record.kind !== 'speaker-diarization') {
        throw new Error(copy('speakerImportInvalid'))
      }
      await loadMediaIntelligence(project.id, project.currentRevision, assetId)
      dispatch({
        type: 'audio-analysis-state',
        projectId: project.id,
        revision: project.currentRevision,
        evidence,
        speakerIdentities: identities,
        clearSpeakerAttributionPlan: true
      })
      const count = record.turnCount ?? evidence.total
      pushNotice({
        id: `speaker-imported-${record.id}`,
        severity: 'info',
        message: formatMessage(copy('speakerImportComplete'), { count }),
        messageKey: 'speakerImportComplete',
        messageValues: { count }
      })
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const previewSpeakerAttribution = useCallback(async (analysisId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.speaker-preview', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        analysisId
      })
      const plan = speakerAttributionPlanFrom(content.plan)
      if (content.outcome !== 'preview' || !plan || plan.analysisId !== analysisId) {
        throw new Error(copy('speakerAttributionPreviewInvalid'))
      }
      dispatch({
        type: 'audio-analysis-state',
        projectId: project.id,
        revision: project.currentRevision,
        speakerAttributionPlan: plan
      })
    })
  }, [copy, execute, withBusy])

  const applySpeakerAttribution = useCallback(async (analysisId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.speaker-apply', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        analysisId
      })
      if (content.outcome === 'refused') {
        pushNotice({
          id: 'speaker-attribution-refused',
          severity: 'warning',
          message: copy('speakerAttributionNoOverlap'),
          messageKey: 'speakerAttributionNoOverlap'
        })
        return
      }
      const plan = speakerAttributionPlanFrom(content.plan)
      if (content.outcome !== 'applied' || !plan || plan.analysisId !== analysisId) {
        throw new Error(copy('speakerAttributionPreviewInvalid'))
      }
      await loadProject(project.id)
      await loadProjects()
      pushNotice({
        id: `speaker-attribution-applied-${analysisId}`,
        severity: 'info',
        message: formatMessage(copy('speakerAttributionApplied'), {
          identified: plan.identifiedCount,
          uncertain: plan.uncertainCount
        }),
        messageKey: 'speakerAttributionApplied',
        messageValues: { identified: plan.identifiedCount, uncertain: plan.uncertainCount }
      })
    })
  }, [copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const analyzeBeats = useCallback(async (assetId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.beats', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId
      })
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'audio-beats-unavailable',
          severity: 'warning',
          message: copy('audioBeatUnavailable'),
          messageKey: 'audioBeatUnavailable'
        })
      }
      const evidence = mediaIntelligenceEvidenceFrom(content.evidence)
      if (evidence) dispatch({ type: 'audio-analysis-state', projectId: project.id, revision: project.currentRevision, evidence })
      await loadMediaIntelligence(project.id, project.currentRevision)
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const analyzeDenoiseMetadata = useCallback(async (assetId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.denoise-metadata', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId,
        confidenceThreshold: 0.7
      })
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'audio-denoise-unavailable',
          severity: 'warning',
          message: copy('audioDenoiseUnavailable'),
          messageKey: 'audioDenoiseUnavailable',
          retryable: content.retryable === true
        })
      }
      const evidence = mediaIntelligenceEvidenceFrom(content.evidence)
      if (evidence) {
        dispatch({
          type: 'audio-analysis-state',
          projectId: project.id,
          revision: project.currentRevision,
          evidence
        })
      }
      await loadMediaIntelligence(project.id, project.currentRevision, assetId)
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const previewAudioSync = useCallback(async (
    referenceItemId: string,
    targetItemId: string,
    seed = 0
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const reference = project.items.find(({ id }) => id === referenceItemId)
      const target = project.items.find(({ id }) => id === targetItemId)
      if (!reference || !target) throw new Error(copy('audioSyncSelectTwoClips'))
      const content = await execute('analysis.sync-preview', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        referenceAssetId: reference.assetId,
        targetAssetId: target.assetId,
        referenceItemId,
        targetItemId,
        seed: Math.max(0, Math.min(0x7fffffff, Math.floor(seed))),
        maximumOffsetUs: 10_000_000,
        threshold: 0.82,
        minimumSeparation: 0.03
      })
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'audio-sync-unavailable',
          severity: 'warning',
          message: copy('audioSyncUnavailable'),
          messageKey: 'audioSyncUnavailable'
        })
        return
      }
      const preview = audioSyncPreviewFrom(content.preview)
      const evidence = mediaIntelligenceEvidenceFrom(content.evidence)
      dispatch({
        type: 'audio-analysis-state',
        projectId: project.id,
        revision: project.currentRevision,
        ...(preview ? { syncPreview: preview } : {}),
        ...(evidence ? { evidence } : {})
      })
      await loadMediaIntelligence(project.id, project.currentRevision)
    })
  }, [copy, execute, loadMediaIntelligence, pushNotice, withBusy])

  const applyAudioSync = useCallback(async (
    analysisId: string,
    referenceItemId: string,
    targetItemId: string
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('analysis.sync-apply', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        analysisId,
        referenceItemId,
        targetItemId
      })
      if (content.outcome === 'refused') {
        pushNotice({
          id: 'audio-sync-refused',
          severity: 'warning',
          message: copy('audioSyncConfidenceRefused'),
          messageKey: 'audioSyncConfidenceRefused'
        })
        return
      }
      dispatch({ type: 'audio-analysis-state', projectId: project.id, revision: project.currentRevision, clearSyncPreview: true })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, pushNotice, withBusy])

  const cancelMediaIntelligence = useCallback(async (operationId: string): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    await execute('analysis.cancel', {
      projectId: project.id,
      expectedRevision: project.currentRevision,
      operationId
    })
    await loadMediaIntelligence(project.id, project.currentRevision)
  }, [copy, execute, loadMediaIntelligence])

  const startDerivedRequest = useCallback(async (
    kind: 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy',
    retryRecord?: DerivedMediaRecordProjection
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const assetId = retryRecord?.assetId ?? stateRef.current.selectedAssetId
      const asset = assetFromState(stateRef.current, assetId)
      if (!asset?.mediaHandleId) throw new Error(copy('selectAssetForDerived'))
      const target = derivedTarget(kind, project.id, asset.id, copy)
      const selection = await client.media.pickSaveTarget({
        suggestedName: target.suggestedName,
        filters: [{
          name: target.filterName,
          extensions: [target.extension],
          mimeTypes: [target.mimeType]
        }]
      })
      if (selection.outcome === 'cancelled') return
      let content: Record<string, unknown>
      try {
        content = await execute(retryRecord ? 'derived.retry' : 'derived.start', {
          projectId: project.id,
          expectedRevision: project.currentRevision,
          assetId: asset.id,
          kind,
          outputHandleId: selection.target.handleId,
          priority: kind === 'thumbnail' || kind === 'waveform' ? 'interactive' : 'user',
          parameters: derivedParameters(kind, asset.durationUs),
          ...(retryRecord ? { recordId: retryRecord.id } : {})
        })
      } catch (error) {
        // The Host service persists the opaque output grant before admission.
        // Keep it alive after an ambiguous transport failure for safe recovery.
        if (!isOpaqueHostError(error)) {
          await client.media.release({
            resource: 'handle',
            handleId: selection.target.handleId
          }).catch(() => undefined)
        }
        throw error
      }
      const record = derivedRecordFrom(content.record)
      if (record) dispatch({ type: 'derived-record', value: record })
      if (content.outcome !== 'queued') {
        await client.media.release({
          resource: 'handle',
          handleId: selection.target.handleId
        }).catch(() => undefined)
      } else {
        dispatch({ type: 'media', value: [selection.target] })
        if (typeof content.jobId === 'string') {
          const snapshot = await client.jobs.get(content.jobId)
          dispatch({ type: 'jobs', value: [...stateRef.current.jobs, snapshot] })
        }
      }
      if (content.outcome === 'unavailable') {
        pushNotice({
          id: 'derived-media-unavailable',
          severity: 'warning',
          message: copy('derivedFfmpegUnavailable'),
          messageKey: 'derivedFfmpegUnavailable'
        })
      }
      await loadDerived(project.id)
    })
  }, [client, copy, execute, loadDerived, pushNotice, withBusy])

  const startDerived = useCallback(async (
    kind: 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy'
  ): Promise<void> => await startDerivedRequest(kind), [startDerivedRequest])

  const retryDerived = useCallback(async (record: DerivedMediaRecordProjection): Promise<void> => {
    if (!['waveform', 'thumbnail', 'filmstrip', 'proxy'].includes(record.kind)) {
      pushNotice({
        id: `derived-retry-unsupported-${record.id}`,
        severity: 'warning',
        message: copy('derivedRetryUnsupported'),
        messageKey: 'derivedRetryUnsupported'
      })
      return
    }
    await startDerivedRequest(record.kind as 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy', record)
  }, [copy, pushNotice, startDerivedRequest])

  const cancelDerived = useCallback(async (recordId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('derived.cancel', { projectId: project.id, recordId })
      await loadDerived(project.id)
    })
  }, [copy, execute, loadDerived, withBusy])

  const cleanupDerived = useCallback(async (includeReady = false): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('derived.cleanup', { projectId: project.id, includeReady })
      await loadDerived(project.id)
    })
  }, [copy, execute, loadDerived, withBusy])

  const applyOperations = useCallback(async (operations: TimelineOperation[], summary: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('project.update', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        operations: operations as unknown as JsonValue,
        summary: summary.slice(0, 512)
      })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const createSequence = useCallback(async (name: string, activate = true): Promise<void> => {
    const normalized = boundedName(name, copy('sequenceNameRequired'))
    await applyOperations([{
      type: 'create-sequence',
      sequenceId: localId('sequence', normalized),
      name: normalized,
      activate
    }], formatMessage(copy('sequenceCreateSummary'), { name: normalized }))
  }, [applyOperations, copy])

  const duplicateSequence = useCallback(async (
    sequenceId: string,
    name: string,
    activate = true
  ): Promise<void> => {
    const normalized = boundedName(name, copy('sequenceNameRequired'))
    await applyOperations([{
      type: 'duplicate-sequence',
      sourceSequenceId: sequenceId,
      sequenceId: localId('sequence-copy', normalized),
      name: normalized,
      activate
    }], formatMessage(copy('sequenceDuplicateSummary'), { name: normalized }))
  }, [applyOperations, copy])

  const renameSequence = useCallback(async (sequenceId: string, name: string): Promise<void> => {
    const normalized = boundedName(name, copy('sequenceNameRequired'))
    await applyOperations(
      [{ type: 'rename-sequence', sequenceId, name: normalized }],
      formatMessage(copy('sequenceRenameSummary'), { name: normalized })
    )
  }, [applyOperations, copy])

  const selectSequence = useCallback(async (sequenceId: string): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const sequence = project.sequences.find(({ id }) => id === sequenceId)
    if (!sequence) throw new Error(copy('sequenceUnavailable'))
    await applyOperations([
      ...(sequence.viewState.open ? [] : [{ type: 'open-sequence' as const, sequenceId }]),
      { type: 'select-sequence', sequenceId }
    ], formatMessage(copy('sequenceSelectSummary'), { name: sequence.name }))
  }, [applyOperations, copy])

  const closeSequence = useCallback(async (sequenceId: string): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const sequence = project.sequences.find(({ id }) => id === sequenceId)
    if (!sequence) throw new Error(copy('sequenceUnavailable'))
    const isActive = project.activeSequenceId === sequenceId
    const fallback = project.sequences.find((candidate) => candidate.id !== sequenceId && candidate.viewState.open) ??
      project.sequences.find((candidate) => candidate.id !== sequenceId)
    if (isActive && !fallback) throw new Error(copy('sequenceCloseFinal'))
    await applyOperations([
      ...(isActive && fallback && !fallback.viewState.open
        ? [{ type: 'open-sequence' as const, sequenceId: fallback.id }]
        : []),
      {
        type: 'close-sequence',
        sequenceId,
        ...(isActive && fallback ? { fallbackSequenceId: fallback.id } : {})
      }
    ], formatMessage(copy('sequenceCloseSummary'), { name: sequence.name }))
  }, [applyOperations, copy])

  const deleteSequence = useCallback(async (sequenceId: string): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const sequence = project.sequences.find(({ id }) => id === sequenceId)
    if (!sequence) throw new Error(copy('sequenceUnavailable'))
    await applyOperations(
      [{ type: 'delete-sequence', sequenceId }],
      formatMessage(copy('sequenceDeleteSummary'), { name: sequence.name })
    )
  }, [applyOperations, copy])

  const setSequenceView = useCallback(async (
    sequenceId: string,
    zoom: number,
    scrollFrame: number
  ): Promise<void> => {
    await applyOperations(
      [{ type: 'set-sequence-view', sequenceId, zoom, scrollFrame }],
      copy('sequenceViewSummary')
    )
  }, [applyOperations, copy])

  const decomposeNested = useCallback(async (itemId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('sequence.decompose', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        itemId
      })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const createMediaFolder = useCallback(async (name: string, parentId?: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const normalized = boundedName(name, copy('folderNameRequired'))
      await execute('media.folder.create', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        folderId: localId('folder', normalized),
        name: normalized,
        ...(parentId ? { parentId } : {})
      })
      await loadProject(project.id)
    })
  }, [copy, execute, loadProject, withBusy])

  const updateMediaFolder = useCallback(async (
    folderId: string,
    patch: { name?: string; parentId?: string | null }
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('media.folder.update', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        folderId,
        ...(patch.name === undefined ? {} : { name: boundedName(patch.name, copy('folderNameRequired')) }),
        ...(patch.parentId === undefined ? {} : { parentId: patch.parentId })
      })
      await loadProject(project.id)
    })
  }, [copy, execute, loadProject, withBusy])

  const deleteMediaFolder = useCallback(async (
    folderId: string,
    moveContentsToFolderId?: string
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('media.folder.delete', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        folderId,
        ...(moveContentsToFolderId ? { moveContentsToFolderId } : {})
      })
      await loadProject(project.id)
    })
  }, [copy, execute, loadProject, withBusy])

  const organizeMedia = useCallback(async (assetIds: string[], folderId?: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      if (assetIds.length < 1 || assetIds.length > 64) throw new Error(copy('mediaSelectionRequired'))
      await execute('media.organize', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetIds: [...new Set(assetIds)].slice(0, 64),
        folderId: folderId ?? null
      })
      await loadProject(project.id)
    })
  }, [copy, execute, loadProject, withBusy])

  const refreshPreviewHistory = useCallback(async (): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    await loadPreviewHistory(project.id)
  }, [copy, loadPreviewHistory])

  const addPreview = useCallback(async (
    source: PreviewSourceProjection,
    label: string
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('preview.add', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        entryId: localId('preview', label),
        label: boundedName(label, copy('previewLabelRequired')),
        source: source as unknown as JsonValue
      })
      dispatchPreviewResult(project.id, content, dispatch)
    })
  }, [copy, execute, withBusy])

  const selectPreview = useCallback(async (entryId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('preview.select', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        entryId
      })
      dispatchPreviewResult(project.id, content, dispatch)
      const entry = previewEntryFrom(content.entry) ??
        stateRef.current.previewHistory.entries.find(({ id }) => id === entryId)
      if (!entry) return
      const source = entry.source
      if (source.kind === 'asset' || source.kind === 'generated') {
        await openAsset(source.assetId)
      } else if (source.artifactId) {
        const artifact = artifactsForJobs(stateRef.current.jobs)
          .find(({ artifactId }) => artifactId === source.artifactId)
        if (artifact && artifactUsesPlayer(artifact)) await openMediaHandle(artifact.mediaHandleId)
      }
    })
  }, [copy, execute, openAsset, openMediaHandle, withBusy])

  const openPreviewResource = useCallback(async (entryId: string): Promise<PreviewResource | undefined> => {
    const state = stateRef.current
    const project = requiredProject(state, copy('openProjectFirst'))
    const entry = state.previewHistory.entries.find(({ id }) => id === entryId)
    if (!entry) return undefined
    const source = entry.source
    if (source.kind === 'asset' || source.kind === 'generated') {
      const asset = assetFromState(stateRef.current, source.assetId)
      if (!asset?.mediaHandleId) return undefined
      const mediaKind = asset.kind === 'audio'
        ? 'audio'
        : asset.kind === 'image'
          ? 'image'
          : 'video'
      return {
        entryId,
        title: entry.label,
        url: await openPassiveMediaHandle(asset.mediaHandleId),
        mediaKind
      }
    }
    if (!source.artifactId) return undefined
    const artifact = artifactsForJobs(state.jobs)
      .find(({ artifactId }) => artifactId === source.artifactId)
    if (!artifact || !artifactUsesPlayer(artifact)) return undefined
    return {
      entryId,
      title: entry.label,
      url: await openPassiveMediaHandle(artifact.mediaHandleId),
      mediaKind: artifact.mediaKind as PreviewResource['mediaKind']
    }
  }, [copy, openPassiveMediaHandle])

  const comparePreviews = useCallback(async (
    leftEntryId: string,
    rightEntryId: string,
    mode: 'wipe' | 'side-by-side'
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('preview.compare', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        leftEntryId,
        rightEntryId,
        mode
      })
      dispatchPreviewResult(project.id, content, dispatch)
    })
  }, [copy, execute, withBusy])

  const replaceSelectedFromPreview = useCallback(async (entryId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const itemId = stateRef.current.selectedItemId
      if (!itemId) throw new Error(copy('selectClipForReplacement'))
      const content = await execute('preview.replace', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        itemId,
        entryId
      })
      dispatchPreviewResult(project.id, content, dispatch)
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const attachSelection = useCallback(async (previewEntryIds: string[] = []): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      if (previewEntryIds.length > 64) throw new Error(copy('selectionAttachmentTooLarge'))
      const content = await execute('context.attach-selection', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        previewEntryIds: [...new Set(previewEntryIds)]
      })
      const attachment = asRecord(content.attachment, copy('invalidHostResponse'))
      const revision = safeInteger(attachment.revision)
      const generation = safeInteger(attachment.selectionGeneration)
      if (revision === undefined || generation === undefined) {
        throw new Error(copy('invalidHostResponse'))
      }
      await client.ui.attachComposerContext({
        schemaVersion: 1,
        id: 'video-selection',
        title: formatMessage(copy('selectionContextTitle'), { project: project.name }),
        summary: formatMessage(copy('selectionContextSummary'), {
          revision,
          items: Array.isArray(attachment.selectedItemIds) ? attachment.selectedItemIds.length : 0,
          previews: Array.isArray(attachment.previewEntryIds) ? attachment.previewEntryIds.length : 0
        }),
        reference: attachment as JsonObject,
        revision,
        generation
      })
      pushNotice({
        id: 'selection-attached',
        severity: 'info',
        message: copy('selectionAttached'),
        messageKey: 'selectionAttached'
      })
    })
  }, [client, copy, execute, pushNotice, withBusy])

  const history = useCallback(async (action: 'project.undo' | 'project.redo'): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute(action, { projectId: project.id, expectedRevision: project.currentRevision })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const undo = useCallback(() => history('project.undo'), [history])
  const redo = useCallback(() => history('project.redo'), [history])

  const readScript = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('script.read', { projectId: project.id, expectedRevision: project.currentRevision })
      const markdown = typeof content.timelineMarkdown === 'string' ? content.timelineMarkdown : ''
      const digest = typeof content.digest === 'string' ? content.digest : ''
      dispatch({ type: 'script', revision: safeInteger(content.currentRevision) ?? project.currentRevision, digest, markdown })
    })
  }, [copy, execute, withBusy])

  const editScript = useCallback((markdown: string) => dispatch({ type: 'script-edit', markdown }), [])

  const applyScript = useCallback(async (
    ranges: Array<{ assetId: string; startUs: number; endUs: number; reason?: 'filler' | 'silence' | 'selection' }>
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      let script = stateRef.current.script
      if (!script) {
        const content = await execute('script.read', {
          projectId: project.id,
          expectedRevision: project.currentRevision
        })
        script = {
          revision: safeInteger(content.currentRevision) ?? project.currentRevision,
          digest: typeof content.digest === 'string' ? content.digest : '',
          markdown: typeof content.timelineMarkdown === 'string' ? content.timelineMarkdown : '',
          dirty: false
        }
        dispatch({
          type: 'script',
          revision: script.revision,
          digest: script.digest,
          markdown: script.markdown
        })
      }
      if (ranges.length === 0 || ranges.length > 2_000) throw new Error(copy('rangesRequired'))
      await execute('script.apply', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        timelineMarkdown: script.markdown,
        ranges: ranges as unknown as JsonValue,
        summary: copy('scriptApplySummary')
      })
      const updated = await loadProject(project.id)
      const content = await execute('script.read', {
        projectId: updated.id,
        expectedRevision: updated.currentRevision
      })
      dispatch({
        type: 'script',
        revision: safeInteger(content.currentRevision) ?? updated.currentRevision,
        digest: typeof content.digest === 'string' ? content.digest : '',
        markdown: typeof content.timelineMarkdown === 'string' ? content.timelineMarkdown : ''
      })
    })
  }, [copy, execute, loadProject, withBusy])

  const startAgent = useCallback(async (prompt: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const input = prompt.trim()
      if (!input) throw new Error(copy('agentGoalRequired'))
      const created = await client.agent.createRun({
        input,
        profileId: 'video-editor',
        visibility: 'private',
        metadata: { projectId: project.id, expectedRevision: project.currentRevision },
        budget: { maxTokens: 32_768, maxElapsedMs: 1_800_000, maxModelRequests: 48, maxToolInvocations: 96, maxEvents: 4_000 }
      })
      dispatch({ type: 'agent-run', value: created.run })
    })
  }, [client, copy, withBusy])

  const steerAgent = useCallback(async (prompt: string): Promise<void> => {
    await withBusy(async () => {
      const run = stateRef.current.agentRun
      if (!run) throw new Error(copy('noAgentRun'))
      const input = prompt.trim()
      if (!input) throw new Error(copy('guidanceEmpty'))
      const result = await client.agent.steer({ runId: run.id, input })
      dispatch({ type: 'agent-run', value: result.run })
    })
  }, [client, copy, withBusy])

  const cancelAgent = useCallback(async (): Promise<void> => {
    const run = stateRef.current.agentRun
    if (!run) return
    await withBusy(async () => {
      const result = await client.agent.cancel({ runId: run.id, reason: copy('agentCanceledByUser') })
      dispatch({ type: 'agent-run', value: result.run })
    })
  }, [client, copy, withBusy])

  const startRender = useCallback(async (
    kind: RenderTicket['renderKind'],
    captionMode: 'none' | 'burned' | 'sidecar' | 'both',
    subtitleFormat: 'srt' | 'vtt' = 'srt',
    options: {
      multicamGroupId?: string
      range?: { startFrame: number; endFrame: number }
    } = {}
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      assertRenderCapabilities(stateRef.current, kind, captionMode, copy)
      const extension = kind === 'proof-frame'
        ? 'png'
        : kind === 'audio-aac'
          ? 'm4a'
          : kind === 'subtitles'
            ? subtitleFormat
            : 'mp4'
      const mimeType = kind === 'proof-frame'
        ? 'image/png'
        : kind === 'audio-aac'
          ? 'audio/mp4'
          : kind === 'subtitles'
            ? subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt'
            : 'video/mp4'
      const picked = await client.media.pickSaveTarget({
        suggestedName: `${project.id}-revision-${project.currentRevision}.${extension}`,
        filters: [{ name: copy('chooseRenderedMedia'), extensions: [extension], mimeTypes: [mimeType] }]
      })
      if (picked.outcome === 'cancelled') return
      const selectedTargets = [picked.target]
      const releaseSelectedTargets = async (): Promise<void> => {
        await Promise.all(selectedTargets.map(({ handleId }) =>
          client.media.release({ resource: 'handle', handleId }).catch(() => undefined)
        ))
      }
      let subtitleTarget: typeof picked.target | undefined
      if (captionMode === 'sidecar' || captionMode === 'both') {
        let subtitle
        try {
          subtitle = await client.media.pickSaveTarget({
            suggestedName: `${project.id}-revision-${project.currentRevision}.${subtitleFormat}`,
            filters: [{
              name: subtitleFormat === 'srt' ? copy('chooseSubRipCaptions') : copy('chooseWebVttCaptions'),
              extensions: [subtitleFormat],
              mimeTypes: [subtitleFormat === 'srt' ? 'application/x-subrip' : 'text/vtt']
            }]
          })
        } catch (error) {
          await releaseSelectedTargets()
          throw error
        }
        if (subtitle.outcome === 'cancelled') {
          await releaseSelectedTargets()
          return
        }
        subtitleTarget = subtitle.target
        selectedTargets.push(subtitle.target)
      }
      let content: Record<string, unknown>
      try {
        content = await execute('render.start', {
          projectId: project.id,
          expectedRevision: project.currentRevision,
          kind,
          outputHandleId: picked.target.handleId,
          ...(kind === 'proof-frame' ? { proofFrame: stateRef.current.playheadFrame } : {}),
          ...(options.multicamGroupId ? { multicamGroupId: options.multicamGroupId } : {}),
          ...(options.range ?? {}),
          captionMode,
          ...(kind === 'subtitles' ? { subtitleFormat } : {}),
          ...(subtitleTarget ? {
            subtitleOutputHandleId: subtitleTarget.handleId,
            subtitleFormat
          } : {}),
          idempotencyKey: `${project.id}-${project.currentRevision}-${kind}-${options.multicamGroupId ?? 'timeline'}-${Date.now().toString(36)}`
        })
      } catch (error) {
        // An opaque transport failure may have happened after the durable job
        // accepted these handles. Keep them alive so recovery/status can work.
        if (!isOpaqueHostError(error)) await releaseSelectedTargets()
        throw error
      }
      if (content.outcome === 'unavailable') {
        await releaseSelectedTargets()
        const messageKey = renderCapabilityMessageKey(content.code)
        const capabilityDetails = renderCapabilityDetails(content)
        pushNotice({
          id: 'render-capability-unavailable',
          severity: 'warning',
          message: copy(messageKey),
          messageKey,
          ...(capabilityDetails.length > 0 ? { capabilityDetails } : {})
        })
        return
      }
      if (content.outcome === 'cancelled') {
        await releaseSelectedTargets()
        return
      }
      if (content.outcome !== 'queued' || typeof content.jobId !== 'string') {
        await releaseSelectedTargets()
        throw new Error(copy('renderJobMissing'))
      }
      dispatch({ type: 'media', value: selectedTargets })
      const ticket: RenderTicket = {
        jobId: content.jobId,
        projectId: project.id,
        pinnedRevision: safeInteger(content.pinnedRevision) ?? project.currentRevision,
        renderKind: isRenderKind(content.renderKind) ? content.renderKind : kind,
        createdAt: new Date().toISOString()
      }
      dispatch({ type: 'render-ticket', value: ticket })
      const snapshot = await client.jobs.get(ticket.jobId)
      dispatch({ type: 'jobs', value: [...stateRef.current.jobs, snapshot] })
    })
  }, [client, copy, execute, pushNotice, withBusy])

  const runMulticamMutation = useCallback(async (
    action:
      | 'multicam.create'
      | 'multicam.labels'
      | 'multicam.sync-confirm'
      | 'multicam.switch'
      | 'multicam.layout'
      | 'multicam.merge',
    payload: Record<string, unknown>
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute(action, {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        ...payload
      })
      await loadProject(project.id)
      await loadProjects()
    })
  }, [copy, execute, loadProject, loadProjects, withBusy])

  const createMulticam = useCallback(async (request: MulticamCreateRequest): Promise<void> => {
    const project = requiredProject(stateRef.current, copy('openProjectFirst'))
    const name = boundedName(request.name, copy('multicamNameRequired'))
    const groupId = localId('multicam', name)
    const selectedAssets = request.assetIds.map((assetId) => {
      const asset = project.assets.find((candidate) => candidate.id === assetId)
      if (!asset || asset.kind !== 'video' || (asset.availability ?? 'online') !== 'online') {
        throw new Error(copy('multicamSourceUnavailable'))
      }
      return asset
    })
    const members = selectedAssets.map((asset, index) => ({
      id: `${groupId.slice(0, 118)}-m${index + 1}`,
      assetId: asset.id,
      memberLabel: asset.name.normalize('NFKC').trim().slice(0, 96),
      angleLabel: `${index + 1}. ${asset.name.normalize('NFKC').trim()}`.slice(0, 96)
    }))
    const referenceIndex = request.assetIds.indexOf(request.referenceAssetId)
    if (referenceIndex < 0 || !members[referenceIndex]) throw new Error(copy('multicamReferenceRequired'))
    await runMulticamMutation('multicam.create', {
      groupId,
      sequenceId: project.activeSequenceId,
      name,
      referenceMemberId: members[referenceIndex].id,
      members,
      createDefaultLayout: true
    })
  }, [copy, runMulticamMutation])

  const renameMulticamLabels = useCallback(async (request: MulticamRenameRequest): Promise<void> => {
    await runMulticamMutation('multicam.labels', {
      groupId: request.groupId,
      ...(request.groupName ? { name: request.groupName } : {}),
      ...(request.memberId ? {
        members: [{
          memberId: request.memberId,
          ...(request.memberLabel ? { memberLabel: request.memberLabel } : {}),
          ...(request.angleLabel ? { angleLabel: request.angleLabel } : {})
        }]
      } : {})
    })
  }, [runMulticamMutation])

  const confirmMulticamSync = useCallback(async (
    request: MulticamSyncConfirmation
  ): Promise<void> => {
    await runMulticamMutation('multicam.sync-confirm', request)
  }, [runMulticamMutation])

  const switchMulticam = useCallback(async (request: MulticamSwitchRequest): Promise<void> => {
    await runMulticamMutation('multicam.switch', {
      groupId: request.groupId,
      memberId: request.memberId,
      ...request.range,
      coveragePolicy: request.coveragePolicy
    })
  }, [runMulticamMutation])

  const mergeMulticam = useCallback(async (groupId: string): Promise<void> => {
    await runMulticamMutation('multicam.merge', { groupId })
  }, [runMulticamMutation])

  const applyMulticamLayout = useCallback(async (request: MulticamLayoutRequest): Promise<void> => {
    await runMulticamMutation('multicam.layout', {
      groupId: request.groupId,
      layoutId: request.layoutId,
      ...request.range,
      coveragePolicy: request.coveragePolicy
    })
  }, [runMulticamMutation])

  const previewMulticam = useCallback(async (request: MulticamSelectionRequest): Promise<void> => {
    await startRender('preview', 'none', 'srt', {
      multicamGroupId: request.groupId,
      range: request.range
    })
  }, [startRender])

  const cancelJob = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      await execute('render.cancel', {
        jobId,
        projectId: project.id,
        reason: copy('renderCanceledByUser')
      })
      const snapshot = await client.jobs.get(jobId)
      dispatch({
        type: 'jobs',
        value: stateRef.current.jobs.map((job) => job.id === jobId ? snapshot : job)
      })
    })
  }, [client, copy, execute, withBusy])

  const startProjectPackage = useCallback(async (
    options: ProjectPackageExportOptions
  ): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const selectedAssetIds = options.mediaScope === 'selected'
        ? [...new Set(options.assetIds ?? [])]
          .filter((assetId) => project.assets.some(({ id }) => id === assetId))
          .slice(0, VIEW_LIMITS.assets)
        : []
      if (options.mediaScope === 'selected' && selectedAssetIds.length === 0) {
        throw new Error(copy('projectPackageSelectMediaFirst'))
      }
      const content = await execute('project-package.export', {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        ...(options.mediaScope === 'selected' ? { assetIds: selectedAssetIds } : {}),
        missingMediaPolicy: options.missingMediaPolicy,
        includeReceipts: options.includeReceipts,
        includeChatProvenance: options.includeAgentProvenance
      })
      if (content.outcome === 'cancelled') return
      if (content.outcome !== 'queued') throw new Error(copy('projectPackageJobMissing'))
      const ticket = projectPackageTicketFrom(
        content.job,
        project,
        options,
        copy('invalidHostResponse')
      )
      const action = { type: 'project-package-ticket', value: ticket } as const
      const nextState = editorReducer(stateRef.current, action)
      dispatch(action)
      try {
        // Persist immediately after the Host has durably accepted the job so a
        // View close/reopen cannot lose the project/revision ownership fence.
        await client.ui.setViewState(toPersistedState(nextState))
      } catch (error) {
        pushNotice({
          ...classifyError(
            error,
            copy('projectPackageTrackingSaveFailed'),
            copy('completeProtectedInteraction'),
            true,
            'projectPackageTrackingSaveFailed'
          ),
          id: `project-package-track-${ticket.jobId}`
        })
      }
      try {
        const snapshot = await client.jobs.get(ticket.jobId)
        assertProjectPackageSnapshot(snapshot, ticket, copy('invalidHostResponse'))
        dispatch({ type: 'jobs', value: [...stateRef.current.jobs, snapshot] })
      } catch (error) {
        pushNotice({
          ...classifyError(
            error,
            copy('projectPackageStatusUnavailable'),
            copy('completeProtectedInteraction'),
            true,
            'projectPackageStatusUnavailable'
          ),
          id: `project-package-status-${ticket.jobId}`
        })
      }
    })
  }, [client, copy, execute, pushNotice, withBusy])

  const refreshProjectPackage = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const ticket = requiredProjectPackageTicket(stateRef.current, jobId, copy('projectPackageNotTracked'))
      const snapshot = await loadProjectPackageSnapshot(ticket)
      dispatch({
        type: 'jobs',
        value: [...stateRef.current.jobs.filter(({ id }) => id !== snapshot.id), snapshot]
      })
    })
  }, [copy, loadProjectPackageSnapshot, withBusy])

  const cancelProjectPackage = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const ticket = requiredProjectPackageTicket(stateRef.current, jobId, copy('projectPackageNotTracked'))
      const content = await execute('project-package.cancel', {
        projectId: ticket.projectId,
        jobId: ticket.jobId
      })
      assertProjectPackageProjection(content.job, ticket, copy('invalidHostResponse'))
      const snapshot = await client.jobs.get(ticket.jobId)
      assertProjectPackageSnapshot(snapshot, ticket, copy('invalidHostResponse'))
      dispatch({
        type: 'jobs',
        value: [...stateRef.current.jobs.filter(({ id }) => id !== snapshot.id), snapshot]
      })
    })
  }, [client, copy, execute, withBusy])

  const startOtioExport = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const project = requiredProject(stateRef.current, copy('openProjectFirst'))
      const content = await execute('interchange.export', {
        projectId: project.id,
        expectedRevision: project.currentRevision
      })
      if (content.outcome === 'cancelled') return
      if (content.outcome !== 'queued') throw new Error(copy('interchangeJobMissing'))
      const ticket = otioExportTicketFrom(content.job, project, copy('invalidHostResponse'))
      const action = { type: 'otio-export-ticket', value: ticket } as const
      const nextState = editorReducer(stateRef.current, action)
      dispatch(action)
      try {
        await client.ui.setViewState(toPersistedState(nextState))
      } catch (error) {
        pushNotice({
          ...classifyError(
            error,
            copy('interchangeTrackingSaveFailed'),
            copy('completeProtectedInteraction'),
            true,
            'interchangeTrackingSaveFailed'
          ),
          id: `otio-track-${ticket.jobId}`
        })
      }
      try {
        const snapshot = await client.jobs.get(ticket.jobId)
        assertOtioExportSnapshot(snapshot, ticket, copy('invalidHostResponse'))
        dispatch({ type: 'jobs', value: [...stateRef.current.jobs, snapshot] })
      } catch (error) {
        pushNotice({
          ...classifyError(
            error,
            copy('interchangeStatusUnavailable'),
            copy('completeProtectedInteraction'),
            true,
            'interchangeStatusUnavailable'
          ),
          id: `otio-status-${ticket.jobId}`
        })
      }
    })
  }, [client, copy, execute, pushNotice, withBusy])

  const refreshOtioExport = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const ticket = requiredOtioExportTicket(stateRef.current, jobId, copy('interchangeNotTracked'))
      const snapshot = await loadOtioExportSnapshot(ticket)
      dispatch({
        type: 'jobs',
        value: [...stateRef.current.jobs.filter(({ id }) => id !== snapshot.id), snapshot]
      })
    })
  }, [copy, loadOtioExportSnapshot, withBusy])

  const cancelOtioExport = useCallback(async (jobId: string): Promise<void> => {
    await withBusy(async () => {
      const ticket = requiredOtioExportTicket(stateRef.current, jobId, copy('interchangeNotTracked'))
      const content = await execute('interchange.cancel', {
        projectId: ticket.projectId,
        jobId: ticket.jobId
      })
      assertOtioExportProjection(content.job, ticket, copy('invalidHostResponse'))
      const snapshot = await client.jobs.get(ticket.jobId)
      assertOtioExportSnapshot(snapshot, ticket, copy('invalidHostResponse'))
      dispatch({
        type: 'jobs',
        value: [...stateRef.current.jobs.filter(({ id }) => id !== snapshot.id), snapshot]
      })
    })
  }, [client, copy, execute, withBusy])

  const previewOtioImport = useCallback(async (): Promise<void> => {
    await withBusy(async () => {
      const selection = await client.media.pickFiles({
        multiple: false,
        maxFiles: 1,
        filters: [{
          name: copy('interchangeChooseDocument'),
          extensions: ['otio', 'json'],
          mimeTypes: ['application/x-otio+json', 'application/json']
        }]
      })
      if (selection.outcome === 'cancelled') return
      const selected = selection.files[0]
      if (!selected) throw new Error(copy('interchangePreviewInvalid'))
      try {
        const content = await execute('interchange.import-preview', {
          inputHandleId: selected.handleId
        })
        const preview = otioImportPreviewFrom(content, copy('interchangePreviewInvalid'))
        const previous = pendingOtioImportHandle.current
        pendingOtioImportHandle.current = preview.inputHandleId
        dispatch({ type: 'otio-import-preview', value: preview })
        if (previous && previous !== preview.inputHandleId) {
          await client.media.release({ resource: 'handle', handleId: previous }).catch(() => undefined)
        }
      } catch (error) {
        await client.media.release({ resource: 'handle', handleId: selected.handleId }).catch(() => undefined)
        throw error
      }
    })
  }, [client, copy, execute, withBusy])

  const confirmOtioImport = useCallback(async (targetProjectId: string): Promise<void> => {
    await withBusy(async () => {
      const preview = stateRef.current.otioImportPreview
      if (!preview || pendingOtioImportHandle.current !== preview.inputHandleId) {
        throw new Error(copy('interchangePreviewRequired'))
      }
      const normalizedTarget = targetProjectId.trim()
      if (!stableProjectionId(normalizedTarget)) throw new Error(copy('interchangeTargetInvalid'))
      const content = await execute('interchange.import', {
        inputHandleId: preview.inputHandleId,
        expectedDocumentDigest: preview.sourceDocumentDigest,
        expectedSourceProjectId: preview.sourceProjectId,
        expectedSourceRevision: preview.sourceProjectRevision,
        targetProjectId: normalizedTarget
      })
      if (
        content.outcome !== 'interchange-imported' ||
        content.persisted !== true ||
        content.overwritten !== false ||
        !isRecord(content.project) ||
        content.project.id !== normalizedTarget
      ) throw new Error(copy('invalidHostResponse'))
      pendingOtioImportHandle.current = undefined
      dispatch({ type: 'otio-import-preview', value: undefined })
      await client.media.release({
        resource: 'handle',
        handleId: preview.inputHandleId
      }).catch(() => undefined)
      await loadProjects()
      await loadProject(normalizedTarget)
    })
  }, [client, copy, execute, loadProject, loadProjects, withBusy])

  const cancelOtioImportPreview = useCallback(async (): Promise<void> => {
    const handleId = pendingOtioImportHandle.current
    pendingOtioImportHandle.current = undefined
    dispatch({ type: 'otio-import-preview', value: undefined })
    if (handleId) {
      await client.media.release({ resource: 'handle', handleId }).catch(() => undefined)
    }
  }, [client])

  const openArtifact = useCallback(async (artifact: GeneratedArtifact): Promise<void> => {
    if (artifact.availability !== 'available') {
      pushNotice({
        id: `artifact-${artifact.artifactId}`,
        severity: 'warning',
        message: copy('artifactUnavailable'),
        messageKey: 'artifactUnavailable'
      })
      return
    }
    if (artifactUsesPlayer(artifact)) {
      await withBusy(() => openMediaHandle(artifact.mediaHandleId))
      return
    }
    await withBusy(async () => {
      await client.media.performArtifactAction({ artifactId: artifact.artifactId, action: 'open' })
    })
  }, [client, copy, openMediaHandle, pushNotice, withBusy])

  const revealArtifact = useCallback(async (artifact: GeneratedArtifact): Promise<void> => {
    if (artifact.availability !== 'available') {
      pushNotice({
        id: `artifact-${artifact.artifactId}`,
        severity: 'warning',
        message: copy('artifactUnavailable'),
        messageKey: 'artifactUnavailable'
      })
      return
    }
    await withBusy(async () => {
      await client.media.performArtifactAction({ artifactId: artifact.artifactId, action: 'reveal' })
    })
  }, [client, copy, pushNotice, withBusy])

  return {
    state,
    refreshAll,
    retryInitialization: () => initializeEditor(true),
    setActiveWorkspace: (workspace) => dispatch({ type: 'active-workspace', value: workspace }),
    createProject,
    openProject,
    importMedia,
    loadMediaLibraryPage,
    importTranscript,
    checkLocalTranscriber,
    generateCaptions,
    openAsset,
    openDerivedResource,
    refreshActiveLease,
    recoverMedia,
    refreshDerived,
    startDerived,
    retryDerived,
    cancelDerived,
    cleanupDerived,
    refreshMediaIntelligence,
    setVisualOptIn,
    requestVisualModelInstall,
    indexVisual,
    searchVisualMoments,
    analyzeVad,
    applyVadAnalysis,
    importSpeakerEvidence,
    previewSpeakerAttribution,
    applySpeakerAttribution,
    analyzeBeats,
    analyzeDenoiseMetadata,
    previewAudioSync,
    applyAudioSync,
    cancelMediaIntelligence,
    refreshGeneration,
    requestGeneration,
    retryGeneration,
    cancelGeneration,
    insertGeneratedVariant,
    createMulticam,
    renameMulticamLabels,
    confirmMulticamSync,
    switchMulticam,
    mergeMulticam,
    applyMulticamLayout,
    previewMulticam,
    applyOperations,
    createSequence,
    duplicateSequence,
    renameSequence,
    selectSequence,
    closeSequence,
    deleteSequence,
    setSequenceView,
    decomposeNested,
    createMediaFolder,
    updateMediaFolder,
    deleteMediaFolder,
    organizeMedia,
    refreshPreviewHistory,
    addPreview,
    selectPreview,
    openPreviewResource,
    comparePreviews,
    replaceSelectedFromPreview,
    attachSelection,
    undo,
    redo,
    readScript,
    editScript,
    applyScript,
    seek: (frame) => dispatch({ type: 'seek', frame }),
    togglePlaying: () => dispatch({ type: 'playing', value: !stateRef.current.playing }),
    selectItem: (itemId) => dispatch({ type: 'selection', itemId, captionId: undefined }),
    selectCaption: (captionId) => dispatch({ type: 'selection', captionId, itemId: undefined }),
    setTranscriptWindow: (start) => dispatch({ type: 'transcript-window', start }),
    setTimelineWindow: (start) => dispatch({ type: 'timeline-window', start }),
    startAgent,
    steerAgent,
    cancelAgent,
    startRender,
    cancelJob,
    startProjectPackage,
    refreshProjectPackage,
    cancelProjectPackage,
    startOtioExport,
    refreshOtioExport,
    cancelOtioExport,
    previewOtioImport,
    confirmOtioImport,
    cancelOtioImportPreview,
    openArtifact,
    revealArtifact,
    dismissNotice: (id) => dispatch({ type: 'dismiss-notice', id })
  }
}

export function artifactUsesPlayer(artifact: GeneratedArtifact): boolean {
  if (artifact.mimeType === 'application/x-subrip' || artifact.mimeType === 'text/vtt') return false
  return artifact.mediaKind === 'video' || artifact.mediaKind === 'audio' || artifact.mediaKind === 'image'
}

export function classifyError(
  error: unknown,
  fallback: string,
  interactionGuidance = 'Complete the protected desktop interaction and retry.',
  preferFallback = false,
  fallbackKey?: MessageKey,
  fallbackValues?: Readonly<Record<string, string | number>>
): Omit<EditorNotice, 'id'> {
  const api = error instanceof ExtensionApiError ? error : undefined
  const code = api?.code ?? (isRecord(error) && typeof error.code === 'string' ? error.code : '')
  const rawMessage = error instanceof Error && error.message ? error.message.slice(0, 1_000) : ''
  const usesFallback = preferFallback || !rawMessage
  const message = usesFallback ? fallback : rawMessage
  const interactionRequired = /INTERACTION_REQUIRED|interaction.required/iu.test(code) || /interaction required/iu.test(rawMessage)
  return {
    severity: interactionRequired ? 'warning' : 'error',
    message: interactionRequired ? `${message} ${interactionGuidance}` : message,
    ...(usesFallback && fallbackKey ? {
      messageKey: fallbackKey,
      ...(fallbackValues ? { messageValues: fallbackValues } : {})
    } : {}),
    interactionRequired,
    retryable: api?.retryable ?? true
  }
}

function generationCatalogFrom(value: unknown): GenerationCatalog | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 ||
    typeof value.revision !== 'string' || value.revision.length < 1 || value.revision.length > 128 ||
    typeof value.generatedAt !== 'string' || !Number.isFinite(Date.parse(value.generatedAt)) ||
    !Array.isArray(value.providers) || value.providers.length > 32 ||
    containsGenerationSecretOrLocator(value)
  ) return undefined
  const providers = value.providers
    .map(generationProviderFrom)
    .filter((provider): provider is GenerationProviderDescriptor => provider !== undefined)
  if (providers.length !== value.providers.length || new Set(providers.map(({ id }) => id)).size !== providers.length) {
    return undefined
  }
  return {
    schemaVersion: 1,
    revision: value.revision,
    generatedAt: value.generatedAt,
    providers
  }
}

function generationProviderFrom(value: unknown): GenerationProviderDescriptor | undefined {
  if (
    !isRecord(value) || !generationProviderId(value.id) ||
    typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 128 ||
    typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 128 ||
    !['local', 'byok', 'remote'].includes(String(value.kind)) ||
    !['available', 'unavailable'].includes(String(value.status)) ||
    !Array.isArray(value.models) || value.models.length > 256
  ) return undefined
  const models = value.models
    .map(generationModelFrom)
    .filter((model): model is GenerationModelDescriptor => model !== undefined)
  if (models.length !== value.models.length || new Set(models.map(({ id }) => id)).size !== models.length) return undefined
  return {
    id: value.id,
    displayName: value.displayName,
    version: value.version,
    kind: value.kind as GenerationProviderDescriptor['kind'],
    status: value.status as GenerationProviderDescriptor['status'],
    ...(typeof value.unavailableReason === 'string'
      ? { unavailableReason: value.unavailableReason.slice(0, 512) }
      : {}),
    models
  }
}

function generationModelFrom(value: unknown): GenerationModelDescriptor | undefined {
  if (
    !isRecord(value) || !generationProviderId(value.id) ||
    typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 128 ||
    typeof value.version !== 'string' || value.version.length < 1 || value.version.length > 128 ||
    !generationEnumArray(value.tasks, ['image', 'video', 'audio', 'upscale'], 4) ||
    !generationEnumArray(value.outputKinds, ['image', 'video', 'audio'], 3) ||
    !generationEnumArray(value.referenceKinds, ['image', 'video', 'audio'], 3, 0) ||
    !isRecord(value.limits) || !isRecord(value.permissions) || !isRecord(value.privacy) || !isRecord(value.cost)
  ) return undefined
  const limits = value.limits
  const permissions = value.permissions
  const privacy = value.privacy
  const cost = value.cost
  const integerFields = ['maxPromptCharacters', 'minReferences', 'maxReferences', 'maxVariants'] as const
  if (
    integerFields.some((field) => safeInteger(limits[field]) === undefined) ||
    Number(limits.maxPromptCharacters) < 1 || Number(limits.maxPromptCharacters) > 8_000 ||
    Number(limits.minReferences) < 0 || Number(limits.maxReferences) > 8 ||
    Number(limits.minReferences) > Number(limits.maxReferences) ||
    Number(limits.maxVariants) < 1 || Number(limits.maxVariants) > 8 ||
    !Array.isArray(permissions.permissionIds) || permissions.permissionIds.length > 16 ||
    !permissions.permissionIds.every((entry) => typeof entry === 'string' && entry.length >= 1 && entry.length <= 256) ||
    !['none', 'host-account'].includes(String(permissions.credential)) ||
    !['never', 'explicit'].includes(String(permissions.mediaUpload)) ||
    !['device', 'provider'].includes(String(privacy.processing)) ||
    !['none', 'provider-policy'].includes(String(privacy.promptRetention)) ||
    !['none', 'provider-policy'].includes(String(privacy.mediaRetention)) ||
    typeof cost.currency !== 'string' || !/^[A-Z]{3}$/u.test(cost.currency) ||
    safeInteger(cost.minimumMinor) === undefined || safeInteger(cost.maximumMinor) === undefined ||
    Number(cost.minimumMinor) < 0 || Number(cost.maximumMinor) < Number(cost.minimumMinor) ||
    typeof cost.estimateOnly !== 'boolean'
  ) return undefined
  const optionalLimit = (field: 'maxWidth' | 'maxHeight' | 'maxDurationUs'): number | undefined => {
    if (limits[field] === undefined) return undefined
    const parsed = safeInteger(limits[field])
    return parsed !== undefined && parsed >= 1 ? parsed : Number.NaN
  }
  const maxWidth = optionalLimit('maxWidth')
  const maxHeight = optionalLimit('maxHeight')
  const maxDurationUs = optionalLimit('maxDurationUs')
  if ([maxWidth, maxHeight, maxDurationUs].some((entry) => Number.isNaN(entry))) return undefined
  return {
    id: value.id,
    displayName: value.displayName,
    version: value.version,
    tasks: value.tasks as GenerationModelDescriptor['tasks'],
    outputKinds: value.outputKinds as GenerationModelDescriptor['outputKinds'],
    referenceKinds: value.referenceKinds as GenerationModelDescriptor['referenceKinds'],
    limits: {
      maxPromptCharacters: Number(limits.maxPromptCharacters),
      minReferences: Number(limits.minReferences),
      maxReferences: Number(limits.maxReferences),
      maxVariants: Number(limits.maxVariants),
      ...(maxWidth === undefined ? {} : { maxWidth }),
      ...(maxHeight === undefined ? {} : { maxHeight }),
      ...(maxDurationUs === undefined ? {} : { maxDurationUs })
    },
    permissions: {
      permissionIds: permissions.permissionIds as string[],
      credential: permissions.credential as GenerationModelDescriptor['permissions']['credential'],
      mediaUpload: permissions.mediaUpload as GenerationModelDescriptor['permissions']['mediaUpload']
    },
    privacy: {
      processing: privacy.processing as GenerationModelDescriptor['privacy']['processing'],
      promptRetention: privacy.promptRetention as GenerationModelDescriptor['privacy']['promptRetention'],
      mediaRetention: privacy.mediaRetention as GenerationModelDescriptor['privacy']['mediaRetention']
    },
    cost: {
      currency: cost.currency,
      minimumMinor: Number(cost.minimumMinor),
      maximumMinor: Number(cost.maximumMinor),
      estimateOnly: cost.estimateOnly
    }
  }
}

function generationRecordFrom(value: unknown): GenerationRecordProjection | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 || !generationOpaqueId(value.id) ||
    safeInteger(value.generation) === undefined || !boundedIdentifier(value.projectId) ||
    safeInteger(value.projectRevision) === undefined || !generationProviderId(value.providerId) ||
    !generationProviderId(value.modelId) || !['image', 'video', 'audio', 'upscale'].includes(String(value.task)) ||
    typeof value.promptDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.promptDigest) ||
    !Array.isArray(value.referenceAssetIds) || value.referenceAssetIds.length > 8 ||
    !value.referenceAssetIds.every(boundedIdentifier) || safeInteger(value.variantsRequested) === undefined ||
    !isRecord(value.quote) || !isRecord(value.placeholder) ||
    !['placeholder', 'queued', 'running', 'cancelling', 'ready', 'failed', 'cancelled', 'interrupted'].includes(String(value.state)) ||
    safeInteger(value.attempt) === undefined || !Array.isArray(value.outputs) || value.outputs.length > 8 ||
    typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string' ||
    containsGenerationSecretOrLocator(value)
  ) return undefined
  const quote = value.quote
  const placeholder = value.placeholder
  if (
    !generationOpaqueId(quote.quoteId) || typeof quote.currency !== 'string' || !/^[A-Z]{3}$/u.test(quote.currency) ||
    safeInteger(quote.minimumMinor) === undefined || safeInteger(quote.maximumMinor) === undefined ||
    typeof quote.estimateOnly !== 'boolean' || !boundedIdentifier(placeholder.assetId) ||
    typeof placeholder.displayName !== 'string' || placeholder.displayName.length < 1 || placeholder.displayName.length > 256 ||
    !['image', 'video', 'audio'].includes(String(placeholder.kind)) ||
    !['pending', 'resolved', 'failed', 'cancelled', 'interrupted'].includes(String(placeholder.state))
  ) return undefined
  const outputs = value.outputs.flatMap((entry) => {
    if (
      !isRecord(entry) || !generationOpaqueId(entry.id) || !boundedIdentifier(entry.assetId) ||
      typeof entry.displayName !== 'string' || entry.displayName.length < 1 || entry.displayName.length > 256 ||
      !['image', 'video', 'audio'].includes(String(entry.kind)) ||
      typeof entry.mimeType !== 'string' || entry.mimeType.length < 3 || entry.mimeType.length > 128 ||
      typeof entry.primary !== 'boolean' || typeof entry.createdAt !== 'string'
    ) return []
    const numericFields = ['byteSize', 'width', 'height', 'durationUs', 'sampleRate', 'channels'] as const
    if (numericFields.some((field) => entry[field] !== undefined && safeInteger(entry[field]) === undefined)) return []
    const kind = entry.kind as GenerationRecordProjection['outputs'][number]['kind']
    const width = safeInteger(entry.width)
    const height = safeInteger(entry.height)
    const durationUs = safeInteger(entry.durationUs)
    const sampleRate = safeInteger(entry.sampleRate)
    const channels = safeInteger(entry.channels)
    if ((kind === 'image' || kind === 'video') && (width === undefined || height === undefined)) return []
    if ((kind === 'video' || kind === 'audio') && durationUs === undefined) return []
    if (kind === 'audio' && (sampleRate === undefined || channels === undefined)) return []
    if (kind !== 'audio' && (sampleRate !== undefined || channels !== undefined)) return []
    return [{
      id: entry.id,
      assetId: entry.assetId,
      displayName: entry.displayName,
      kind,
      mimeType: entry.mimeType,
      ...(safeInteger(entry.byteSize) === undefined ? {} : { byteSize: Number(entry.byteSize) }),
      ...(width === undefined ? {} : { width }),
      ...(height === undefined ? {} : { height }),
      ...(durationUs === undefined ? {} : { durationUs }),
      ...(sampleRate === undefined ? {} : { sampleRate }),
      ...(channels === undefined ? {} : { channels }),
      primary: entry.primary,
      createdAt: entry.createdAt.slice(0, 64)
    }]
  })
  if (outputs.length !== value.outputs.length) return undefined
  const progress = value.progress === undefined ? undefined : isRecord(value.progress) &&
    safeInteger(value.progress.completed) !== undefined && safeInteger(value.progress.total) !== undefined &&
    typeof value.progress.unit === 'string'
    ? {
        completed: Number(value.progress.completed),
        total: Number(value.progress.total),
        unit: value.progress.unit.slice(0, 64),
        ...(typeof value.progress.message === 'string' ? { message: value.progress.message.slice(0, 512) } : {})
      }
    : undefined
  if (value.progress !== undefined && !progress) return undefined
  const error = value.error === undefined ? undefined : isRecord(value.error) &&
    typeof value.error.code === 'string' && typeof value.error.message === 'string' && typeof value.error.retryable === 'boolean'
    ? { code: value.error.code.slice(0, 64), message: value.error.message.slice(0, 512), retryable: value.error.retryable }
    : undefined
  if (value.error !== undefined && !error) return undefined
  return {
    schemaVersion: 1,
    id: value.id,
    generation: Number(value.generation),
    projectId: value.projectId,
    projectRevision: Number(value.projectRevision),
    providerId: value.providerId,
    modelId: value.modelId,
    task: value.task as GenerationRecordProjection['task'],
    promptDigest: value.promptDigest,
    referenceAssetIds: value.referenceAssetIds as string[],
    variantsRequested: Number(value.variantsRequested),
    quote: {
      quoteId: quote.quoteId,
      currency: quote.currency,
      minimumMinor: Number(quote.minimumMinor),
      maximumMinor: Number(quote.maximumMinor),
      estimateOnly: quote.estimateOnly
    },
    placeholder: {
      assetId: placeholder.assetId,
      displayName: placeholder.displayName,
      kind: placeholder.kind as GenerationRecordProjection['placeholder']['kind'],
      state: placeholder.state as GenerationRecordProjection['placeholder']['state']
    },
    state: value.state as GenerationRecordProjection['state'],
    attempt: Number(value.attempt),
    ...(progress ? { progress } : {}),
    outputs,
    ...(error ? { error } : {}),
    createdAt: value.createdAt.slice(0, 64),
    updatedAt: value.updatedAt.slice(0, 64)
  }
}

function generationEnumArray(
  value: unknown,
  allowed: readonly string[],
  maximum: number,
  minimum = 1
): value is string[] {
  return Array.isArray(value) && value.length >= minimum && value.length <= maximum &&
    value.every((entry) => typeof entry === 'string' && allowed.includes(entry)) &&
    new Set(value).size === value.length
}

function generationProviderId(value: unknown): value is string {
  return typeof value === 'string' && /^[a-z][a-z0-9._-]{0,63}$/u.test(value)
}

function generationOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 8 && value.length <= 256 && /^[A-Za-z0-9._~-]+$/u.test(value)
}

function containsGenerationSecretOrLocator(value: unknown, key = ''): boolean {
  if (/(?:secret|password|api.?key|access.?token|authorization|credentialvalue|endpoint|outputhandle|mediahandle|completionidentity|prompt(?:excerpt)?$)/iu.test(key)) {
    return true
  }
  if (typeof value === 'string') {
    return /https?:\/\//iu.test(value) || /(?:[A-Za-z]:[\\/]|\/(?:Users|home|var|tmp|private|Volumes)\/)/u.test(value)
  }
  if (Array.isArray(value)) return value.some((entry) => containsGenerationSecretOrLocator(entry, key))
  if (isRecord(value)) return Object.entries(value).some(([childKey, entry]) => containsGenerationSecretOrLocator(entry, childKey))
  return false
}

function audioAnalysisCapabilitiesFrom(value: unknown): AudioAnalysisCapabilitiesProjection | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.probedAt !== 'string' || !Array.isArray(value.analyses)) {
    return undefined
  }
  const analyses = value.analyses.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      !['silence', 'beat-grid', 'sync-features'].includes(String(candidate.analysis)) ||
      typeof candidate.available !== 'boolean' ||
      candidate.local !== true ||
      candidate.networkUsed !== false
    ) return []
    return [{
      analysis: candidate.analysis as AudioAnalysisCapabilitiesProjection['analyses'][number]['analysis'],
      available: candidate.available,
      ...(typeof candidate.algorithm === 'string' ? { algorithm: candidate.algorithm.slice(0, 128) } : {}),
      ...(typeof candidate.algorithmVersion === 'string' ? { algorithmVersion: candidate.algorithmVersion.slice(0, 64) } : {}),
      ...(typeof candidate.code === 'string' ? { code: candidate.code.slice(0, 128) } : {}),
      ...(typeof candidate.remediation === 'string' ? { remediation: candidate.remediation.slice(0, 1_024) } : {}),
      ...(typeof candidate.retryable === 'boolean' ? { retryable: candidate.retryable } : {}),
      local: true as const,
      networkUsed: false as const
    }]
  })
  if (analyses.length !== 3 || new Set(analyses.map(({ analysis }) => analysis)).size !== 3) return undefined
  return { schemaVersion: 1, probedAt: value.probedAt, analyses }
}

function denoiseMetadataCapabilityFrom(value: unknown): DenoiseMetadataCapabilityProjection | undefined {
  if (
    !isRecord(value) ||
    !['ready', 'unavailable'].includes(String(value.outcome)) ||
    value.local !== true ||
    value.networkUsed !== false
  ) return undefined
  if (value.outcome === 'ready') {
    const descriptor = value.descriptor
    if (
      !isRecord(descriptor) ||
      !['adapterId', 'adapterVersion', 'algorithm', 'algorithmVersion']
        .every((key) => typeof descriptor[key] === 'string' && String(descriptor[key]).length > 0) ||
      (descriptor.modelId === undefined) !== (descriptor.modelVersion === undefined) ||
      (descriptor.modelId !== undefined && typeof descriptor.modelId !== 'string') ||
      (descriptor.modelVersion !== undefined && typeof descriptor.modelVersion !== 'string')
    ) return undefined
    return {
      outcome: 'ready',
      descriptor: {
        adapterId: String(descriptor.adapterId).slice(0, 256),
        adapterVersion: String(descriptor.adapterVersion).slice(0, 64),
        algorithm: String(descriptor.algorithm).slice(0, 256),
        algorithmVersion: String(descriptor.algorithmVersion).slice(0, 64),
        ...(typeof descriptor.modelId === 'string' ? {
          modelId: descriptor.modelId.slice(0, 256),
          modelVersion: String(descriptor.modelVersion).slice(0, 64)
        } : {})
      },
      local: true,
      networkUsed: false
    }
  }
  if (
    typeof value.code !== 'string' ||
    typeof value.remediation !== 'string' ||
    typeof value.retryable !== 'boolean'
  ) return undefined
  return {
    outcome: 'unavailable',
    code: value.code.slice(0, 128),
    remediation: value.remediation.slice(0, 1_024),
    retryable: value.retryable,
    local: true,
    networkUsed: false
  }
}

function speakerAdaptersFrom(value: unknown): SpeakerAdapterProjection[] {
  if (!Array.isArray(value) || value.length > 16) return []
  const adapters = value.flatMap((candidate) => {
    if (
      !isRecord(candidate) || !isRecord(candidate.descriptor) ||
      !['ready', 'unavailable'].includes(String(candidate.outcome)) ||
      candidate.local !== true || candidate.networkUsed !== false
    ) return []
    const descriptor = candidate.descriptor
    if (
      typeof descriptor.id !== 'string' || descriptor.id.length < 1 || descriptor.id.length > 256 ||
      typeof descriptor.version !== 'string' || descriptor.version.length < 1 || descriptor.version.length > 64 ||
      !['local-model', 'import'].includes(String(descriptor.execution)) ||
      (descriptor.format !== undefined && descriptor.format !== 'kun-speaker-json-v1') ||
      (descriptor.modelId !== undefined && typeof descriptor.modelId !== 'string') ||
      (descriptor.modelVersion !== undefined && typeof descriptor.modelVersion !== 'string')
    ) return []
    return [{
      descriptor: {
        id: descriptor.id,
        version: descriptor.version,
        execution: descriptor.execution as SpeakerAdapterProjection['descriptor']['execution'],
        ...(descriptor.format === 'kun-speaker-json-v1' ? { format: 'kun-speaker-json-v1' as const } : {}),
        ...(typeof descriptor.modelId === 'string' ? { modelId: descriptor.modelId.slice(0, 256) } : {}),
        ...(typeof descriptor.modelVersion === 'string' ? { modelVersion: descriptor.modelVersion.slice(0, 64) } : {})
      },
      outcome: candidate.outcome as SpeakerAdapterProjection['outcome'],
      ...(typeof candidate.code === 'string' ? { code: candidate.code.slice(0, 128) } : {}),
      ...(typeof candidate.remediation === 'string' ? { remediation: candidate.remediation.slice(0, 1_024) } : {}),
      local: true as const,
      networkUsed: false as const
    }]
  })
  if (adapters.length !== value.length || new Set(adapters.map(({ descriptor }) => descriptor.id)).size !== adapters.length) {
    return []
  }
  return adapters
}

function speakerIdentitiesFrom(value: unknown): SpeakerIdentityProjection[] {
  if (!Array.isArray(value) || value.length > 256) return []
  const identities = value.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      typeof candidate.id !== 'string' || candidate.id.length < 1 || candidate.id.length > 128 ||
      typeof candidate.label !== 'string' || candidate.label.length < 1 || candidate.label.length > 160 ||
      !Array.isArray(candidate.aliases) || candidate.aliases.length > 32 ||
      !candidate.aliases.every((alias) => typeof alias === 'string' && alias.length >= 1 && alias.length <= 160) ||
      !Array.isArray(candidate.sourceEvidenceIds) || candidate.sourceEvidenceIds.length > 256 ||
      !candidate.sourceEvidenceIds.every((id) => typeof id === 'string' && id.length >= 1 && id.length <= 128) ||
      typeof candidate.createdAt !== 'string' || typeof candidate.updatedAt !== 'string'
    ) return []
    return [{
      id: candidate.id,
      label: candidate.label,
      aliases: candidate.aliases as string[],
      sourceEvidenceIds: candidate.sourceEvidenceIds as string[],
      createdAt: candidate.createdAt.slice(0, 64),
      updatedAt: candidate.updatedAt.slice(0, 64)
    }]
  })
  if (identities.length !== value.length || new Set(identities.map(({ id }) => id)).size !== identities.length) return []
  return identities
}

function speakerAttributionPlanFrom(value: unknown): SpeakerAttributionPlanProjection | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 ||
    typeof value.analysisId !== 'string' || value.analysisId.length < 1 || value.analysisId.length > 512 ||
    safeInteger(value.transcriptSegmentCount) === undefined ||
    safeInteger(value.captionCount) === undefined ||
    safeInteger(value.identifiedCount) === undefined ||
    safeInteger(value.uncertainCount) === undefined ||
    !Array.isArray(value.warnings) || value.warnings.length > 100 ||
    !value.warnings.every((warning) => typeof warning === 'string')
  ) return undefined
  const transcriptSegmentCount = safeInteger(value.transcriptSegmentCount)!
  const captionCount = safeInteger(value.captionCount)!
  const identifiedCount = safeInteger(value.identifiedCount)!
  const uncertainCount = safeInteger(value.uncertainCount)!
  if (identifiedCount + uncertainCount !== transcriptSegmentCount + captionCount) return undefined
  return {
    analysisId: value.analysisId,
    transcriptSegmentCount,
    captionCount,
    identifiedCount,
    uncertainCount,
    warnings: value.warnings.map((warning) => String(warning).slice(0, 512))
  }
}

function visualProvisioningFrom(value: unknown): VisualProvisioningProjection | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 || typeof value.optIn !== 'boolean' ||
    !['disabled', 'broker-unavailable', 'missing', 'downloading', 'unverified', 'inference-unavailable', 'ready', 'failed']
      .includes(String(value.state)) ||
    typeof value.code !== 'string' || typeof value.installSupported !== 'boolean' ||
    !isRecord(value.verification) ||
    value.local !== true || value.networkUsedForInference !== false ||
    value.rawPathsExposed !== false || value.urlsAccepted !== false ||
    typeof value.remediation !== 'string' || typeof value.checkedAt !== 'string'
  ) return undefined
  const verification = value.verification
  const verificationErrors = verification.errors
  if (
    typeof verification.brokerAttested !== 'boolean' ||
    typeof verification.downloadVerified !== 'boolean' ||
    typeof verification.sourceVerified !== 'boolean' ||
    typeof verification.installVerified !== 'boolean' ||
    typeof verification.signatureVerified !== 'boolean' ||
    typeof verification.manifestVerified !== 'boolean' ||
    !Array.isArray(verificationErrors) ||
    !verificationErrors.every((error: unknown) => typeof error === 'string')
  ) return undefined
  const model = isRecord(value.model) &&
    typeof value.model.adapterId === 'string' && typeof value.model.adapterVersion === 'string' &&
    typeof value.model.packageId === 'string' && typeof value.model.modelId === 'string' &&
    typeof value.model.modelVersion === 'string' && typeof value.model.manifestSha256 === 'string' &&
    safeInteger(value.model.embeddingDimensions) !== undefined
    ? {
        adapterId: value.model.adapterId.slice(0, 256),
        adapterVersion: value.model.adapterVersion.slice(0, 64),
        packageId: value.model.packageId.slice(0, 256),
        modelId: value.model.modelId.slice(0, 256),
        modelVersion: value.model.modelVersion.slice(0, 64),
        embeddingDimensions: safeInteger(value.model.embeddingDimensions)!,
        manifestSha256: value.model.manifestSha256.slice(0, 64)
      }
    : undefined
  return {
    schemaVersion: 1,
    optIn: value.optIn,
    state: value.state as VisualProvisioningProjection['state'],
    code: value.code.slice(0, 128),
    installSupported: value.installSupported,
    ...(['bundled', 'downloaded'].includes(String(value.packageSource))
      ? { packageSource: value.packageSource as 'bundled' | 'downloaded' }
      : {}),
    ...(model ? { model } : {}),
    verification: {
      brokerAttested: verification.brokerAttested,
      downloadVerified: verification.downloadVerified,
      sourceVerified: verification.sourceVerified,
      installVerified: verification.installVerified,
      signatureVerified: verification.signatureVerified,
      manifestVerified: verification.manifestVerified,
      errors: verificationErrors.slice(0, 32).map((error: unknown) => String(error).slice(0, 512))
    },
    local: true,
    networkUsedForInference: false,
    rawPathsExposed: false,
    urlsAccepted: false,
    remediation: value.remediation.slice(0, 1_024),
    checkedAt: value.checkedAt.slice(0, 64)
  }
}

function visualMomentPageFrom(value: unknown, indexId: string): VisualMomentPageProjection | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 || !Array.isArray(value.results) ||
    safeInteger(value.offset) === undefined || safeInteger(value.totalMatches) === undefined ||
    !['complete', 'partial'].includes(String(value.completeness)) ||
    !isRecord(value.ranking) || value.ranking.semantics !== 'uncalibrated-cosine' ||
    value.ranking.calibratedConfidence !== false || value.ranking.local !== true ||
    value.ranking.networkUsed !== false
  ) return undefined
  const ranking = value.ranking
  if (!['adapterId', 'adapterVersion', 'modelId', 'modelVersion', 'packageId', 'manifestSha256']
    .every((key) => typeof ranking[key] === 'string')) return undefined
  const results = value.results.slice(0, 100).flatMap((candidate) => {
    if (
      !isRecord(candidate) || typeof candidate.id !== 'string' || typeof candidate.assetId !== 'string' ||
      typeof candidate.sampleId !== 'string' || typeof candidate.score !== 'number' ||
      !Number.isFinite(candidate.score) || candidate.score < -1 || candidate.score > 1 ||
      !isRecord(candidate.sourceRange) || candidate.sourceRange.assetId !== candidate.assetId ||
      safeInteger(candidate.sourceRange.startUs) === undefined || safeInteger(candidate.sourceRange.endUs) === undefined ||
      !isRecord(candidate.evidence) || safeInteger(candidate.evidence.representativeUs) === undefined
    ) return []
    const modelConfidence = typeof candidate.evidence.modelConfidence === 'number' &&
      Number.isFinite(candidate.evidence.modelConfidence) && candidate.evidence.modelConfidence >= 0 &&
      candidate.evidence.modelConfidence <= 1
      ? candidate.evidence.modelConfidence
      : undefined
    return [{
      id: candidate.id.slice(0, 512),
      assetId: candidate.assetId.slice(0, 128),
      sourceRange: {
        assetId: candidate.assetId.slice(0, 128),
        startUs: safeInteger(candidate.sourceRange.startUs)!,
        endUs: safeInteger(candidate.sourceRange.endUs)!
      },
      score: candidate.score,
      sampleId: candidate.sampleId.slice(0, 512),
      representativeUs: safeInteger(candidate.evidence.representativeUs)!,
      ...(modelConfidence === undefined ? {} : { modelConfidence })
    }]
  })
  if (results.length !== value.results.length) return undefined
  return {
    schemaVersion: 1,
    indexId: indexId.slice(0, 512),
    offset: safeInteger(value.offset)!,
    results,
    ...(safeInteger(value.nextOffset) === undefined ? {} : { nextOffset: safeInteger(value.nextOffset)! }),
    totalMatches: safeInteger(value.totalMatches)!,
    completeness: value.completeness as VisualMomentPageProjection['completeness'],
    ranking: {
      semantics: 'uncalibrated-cosine',
      calibratedConfidence: false,
      local: true,
      networkUsed: false,
      adapterId: String(ranking.adapterId).slice(0, 256),
      adapterVersion: String(ranking.adapterVersion).slice(0, 64),
      modelId: String(ranking.modelId).slice(0, 256),
      modelVersion: String(ranking.modelVersion).slice(0, 64),
      packageId: String(ranking.packageId).slice(0, 256),
      manifestSha256: String(ranking.manifestSha256).slice(0, 64)
    }
  }
}

function audioAnalysisRecordFrom(value: unknown): AudioAnalysisRecordProjection | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !['vad', 'beat-grid', 'denoise-metadata', 'audio-sync', 'speaker-diarization', 'visual-index'].includes(String(value.kind)) ||
    value.immutable !== true
  ) return undefined
  const snapTargets = audioSnapTargetsFrom(value.snapTargets)
  if (value.snapTargets !== undefined && snapTargets === undefined) return undefined
  const denoise = value.kind === 'denoise-metadata' ? denoiseMetadataRecordSummaryFrom(value) : undefined
  if (value.kind === 'denoise-metadata' && !denoise) return undefined
  return {
    schemaVersion: 1,
    id: value.id.slice(0, 512),
    kind: value.kind as AudioAnalysisRecordProjection['kind'],
    ...(typeof value.assetId === 'string' ? { assetId: value.assetId.slice(0, 128) } : {}),
    ...(typeof value.referenceAssetId === 'string' ? { referenceAssetId: value.referenceAssetId.slice(0, 128) } : {}),
    ...(typeof value.targetAssetId === 'string' ? { targetAssetId: value.targetAssetId.slice(0, 128) } : {}),
    ...(['complete', 'partial'].includes(String(value.completeness))
      ? { completeness: value.completeness as 'complete' | 'partial' }
      : {}),
    ...numericProjection(value, [
      'silenceCount', 'safeSuggestionCount', 'suggestionConfidenceThreshold', 'markerCount', 'tempoBpm',
      'turnCount', 'identifiedTurnCount', 'uncertainTurnCount',
      'indexedSampleCount', 'plannedSampleCount', 'omittedSampleCount', 'intervalUs', 'maxFrames',
      'seed', 'proposedTargetDeltaUs', 'confidence', 'confidenceThreshold', 'separation', 'threshold', 'minimumSeparation'
    ]),
    ...(denoise ?? {}),
    ...(snapTargets === undefined ? {} : { snapTargets }),
    ...(typeof value.adapterId === 'string' ? { adapterId: value.adapterId.slice(0, 256) } : {}),
    ...(typeof value.adapterVersion === 'string' ? { adapterVersion: value.adapterVersion.slice(0, 64) } : {}),
    ...(typeof value.modelId === 'string' ? { modelId: value.modelId.slice(0, 256) } : {}),
    ...(typeof value.modelVersion === 'string' ? { modelVersion: value.modelVersion.slice(0, 64) } : {}),
    ...(typeof value.packageId === 'string' ? { packageId: value.packageId.slice(0, 256) } : {}),
    ...(typeof value.manifestSha256 === 'string' ? { manifestSha256: value.manifestSha256.slice(0, 64) } : {}),
    ...(value.samplingStrategy === 'uniform-interval-v1' ? { samplingStrategy: 'uniform-interval-v1' as const } : {}),
    ...(['ready', 'uncertain'].includes(String(value.outcome))
      ? { outcome: value.outcome as 'ready' | 'uncertain' }
      : {}),
    ...(typeof value.refusalReason === 'string' ? { refusalReason: value.refusalReason.slice(0, 128) } : {}),
    ...(typeof value.currentGrant === 'boolean' ? { currentGrant: value.currentGrant } : {}),
    immutable: true
  }
}

function denoiseMetadataRecordSummaryFrom(
  value: Record<string, unknown>
): Pick<AudioAnalysisRecordProjection, 'status' | 'noiseProfile' | 'recommendation' | 'metadataOnly'> | undefined {
  const profile = value.noiseProfile
  const recommendation = value.recommendation
  if (!isRecord(profile) || !isRecord(recommendation)) return undefined
  const levels = profile.levels
  const spectralBands = profile.spectralBands
  if (!isRecord(levels) || !Array.isArray(spectralBands)) return undefined
  if (
    !['ready', 'low-confidence'].includes(String(value.status)) ||
    value.metadataOnly !== true ||
    spectralBands.length > 32 ||
    recommendation.autoApplyAllowed !== false ||
    recommendation.audioMutation !== 'none' ||
    !['preview-suggested', 'review-required'].includes(String(recommendation.disposition))
  ) return undefined
  const requiredProfileNumbers = [
    profile.analyzedDurationUs,
    profile.sampleWindowCount,
    levels.noiseFloorDbfs,
    levels.averageRmsDbfs,
    levels.peakDbfs,
    levels.estimatedSnrDb,
    recommendation.reductionDb,
    recommendation.confidence
  ]
  if (requiredProfileNumbers.some((entry) => typeof entry !== 'number' || !Number.isFinite(entry))) {
    return undefined
  }
  if (
    !Number.isSafeInteger(profile.analyzedDurationUs) || Number(profile.analyzedDurationUs) < 1 ||
    !Number.isSafeInteger(profile.sampleWindowCount) || Number(profile.sampleWindowCount) < 1 ||
    Number(recommendation.reductionDb) < 0 || Number(recommendation.reductionDb) > 36 ||
    Number(recommendation.confidence) < 0 || Number(recommendation.confidence) > 1
  ) return undefined
  return {
    status: value.status as 'ready' | 'low-confidence',
    noiseProfile: {
      analyzedDurationUs: Number(profile.analyzedDurationUs),
      sampleWindowCount: Number(profile.sampleWindowCount),
      levels: {
        noiseFloorDbfs: Number(levels.noiseFloorDbfs),
        averageRmsDbfs: Number(levels.averageRmsDbfs),
        peakDbfs: Number(levels.peakDbfs),
        estimatedSnrDb: Number(levels.estimatedSnrDb)
      },
      spectralBandCount: spectralBands.length
    },
    recommendation: {
      reductionDb: Number(recommendation.reductionDb),
      confidence: Number(recommendation.confidence),
      disposition: recommendation.disposition as 'preview-suggested' | 'review-required',
      autoApplyAllowed: false,
      audioMutation: 'none'
    },
    metadataOnly: true
  }
}

function audioSnapTargetsFrom(
  value: unknown
): AudioAnalysisRecordProjection['snapTargets'] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value)) return undefined
  const candidates = value.slice(0, 4_096)
  const targets = candidates.flatMap((candidate) => {
    if (
      !isRecord(candidate) ||
      !stableProjectionId(candidate.id) ||
      safeInteger(candidate.frame) === undefined ||
      !['beat', 'downbeat'].includes(String(candidate.kind)) ||
      typeof candidate.confidence !== 'number' ||
      !Number.isFinite(candidate.confidence) ||
      candidate.confidence < 0 ||
      candidate.confidence > 1
    ) return []
    return [{
      id: candidate.id,
      frame: safeInteger(candidate.frame)!,
      kind: candidate.kind as 'beat' | 'downbeat',
      confidence: candidate.confidence
    }]
  })
  return targets.length === candidates.length ? targets : undefined
}

function mediaIntelligenceEvidenceFrom(value: unknown): MediaIntelligenceEvidenceProjection | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.recordId !== 'string' ||
    !['visual-index', 'vad', 'speaker-diarization', 'beat-grid', 'denoise-metadata', 'audio-sync'].includes(String(value.kind)) ||
    !['complete', 'partial', 'not-applicable'].includes(String(value.completeness)) ||
    safeInteger(value.offset) === undefined ||
    safeInteger(value.returned) === undefined ||
    safeInteger(value.total) === undefined ||
    !Array.isArray(value.evidence)
  ) return undefined
  const evidence = value.evidence
    .filter(isRecord)
    .slice(0, 500)
    .map((entry) => structuredClone(entry) as Record<string, string | number | boolean | string[]>)
  if (evidence.length !== value.evidence.length) return undefined
  return {
    schemaVersion: 1,
    recordId: value.recordId.slice(0, 512),
    kind: value.kind as MediaIntelligenceEvidenceProjection['kind'],
    offset: safeInteger(value.offset)!,
    returned: safeInteger(value.returned)!,
    total: safeInteger(value.total)!,
    ...(safeInteger(value.nextOffset) === undefined ? {} : { nextOffset: safeInteger(value.nextOffset)! }),
    completeness: value.completeness as MediaIntelligenceEvidenceProjection['completeness'],
    evidence
  }
}

function mediaIntelligenceProgressFrom(value: unknown): MediaIntelligenceProgressProjection | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.operationId !== 'string' ||
    typeof value.projectId !== 'string' ||
    safeInteger(value.projectRevision) === undefined ||
    !['visual-index', 'vad', 'speaker', 'beats', 'denoise-metadata', 'audio-sync'].includes(String(value.kind)) ||
    !['queued', 'running', 'cancelled', 'ready', 'failed'].includes(String(value.status)) ||
    safeInteger(value.generation) === undefined ||
    safeInteger(value.completed) === undefined ||
    safeInteger(value.total) === undefined ||
    Number(value.total) < 1
  ) return undefined
  const error = isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string' &&
    typeof value.error.retryable === 'boolean'
    ? {
        code: value.error.code.slice(0, 128),
        message: value.error.message.slice(0, 1_024),
        retryable: value.error.retryable
      }
    : undefined
  return {
    schemaVersion: 1,
    operationId: value.operationId.slice(0, 512),
    projectId: value.projectId.slice(0, 128),
    projectRevision: safeInteger(value.projectRevision)!,
    kind: value.kind as MediaIntelligenceProgressProjection['kind'],
    generation: safeInteger(value.generation)!,
    status: value.status as MediaIntelligenceProgressProjection['status'],
    completed: safeInteger(value.completed)!,
    total: safeInteger(value.total)!,
    ...(typeof value.message === 'string' ? { message: value.message.slice(0, 512) } : {}),
    ...(error ? { error } : {})
  }
}

function audioSyncPreviewFrom(value: unknown): AudioSyncPreviewProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.analysisId !== 'string' ||
    typeof value.referenceItemId !== 'string' ||
    typeof value.targetItemId !== 'string' ||
    safeInteger(value.targetFrameBefore) === undefined ||
    signedSafeInteger(value.targetFrameAfter) === undefined ||
    typeof value.deltaFrames !== 'number' ||
    !Number.isSafeInteger(value.deltaFrames) ||
    typeof value.confidence !== 'number' ||
    !Number.isFinite(value.confidence) ||
    !['ready', 'uncertain'].includes(String(value.outcome))
  ) return undefined
  return {
    analysisId: value.analysisId.slice(0, 512),
    referenceItemId: value.referenceItemId.slice(0, 128),
    targetItemId: value.targetItemId.slice(0, 128),
    targetFrameBefore: safeInteger(value.targetFrameBefore)!,
    targetFrameAfter: signedSafeInteger(value.targetFrameAfter)!,
    deltaFrames: value.deltaFrames,
    confidence: Math.max(0, Math.min(1, value.confidence)),
    outcome: value.outcome as 'ready' | 'uncertain',
    ...(typeof value.refusalReason === 'string' ? { refusalReason: value.refusalReason.slice(0, 128) } : {})
  }
}

function numericProjection(
  source: Record<string, unknown>,
  keys: readonly string[]
): Record<string, number> {
  return Object.fromEntries(keys.flatMap((key) => {
    const value = source[key]
    return typeof value === 'number' && Number.isFinite(value) ? [[key, value]] : []
  }))
}

function mediaLibraryPageFrom(
  content: Record<string, unknown>,
  request: Pick<MediaLibraryPageProjection, 'projectId' | 'revision' | 'folderId' | 'query'>,
  invalidMessage: string
): MediaLibraryPageProjection {
  const page = isRecord(content.page) ? content.page : undefined
  const revision = safeInteger(content.revision)
  const offset = page && safeInteger(page.offset)
  const limit = page && safeInteger(page.limit)
  const total = page && safeInteger(page.total)
  const hiddenBefore = page && safeInteger(page.hiddenBefore)
  const hiddenAfter = page && safeInteger(page.hiddenAfter)
  const assets = page && Array.isArray(page.assets)
    ? page.assets.map(assetProjectionFrom).filter((value): value is AssetProjection => value !== undefined)
    : []
  if (
    content.outcome !== 'media-library' ||
    content.projectId !== request.projectId ||
    revision !== request.revision ||
    !page ||
    offset === undefined ||
    limit === undefined ||
    limit < 1 ||
    limit > 100 ||
    total === undefined ||
    hiddenBefore === undefined ||
    hiddenAfter === undefined ||
    !Array.isArray(page.assets) ||
    assets.length !== page.assets.length ||
    assets.length > limit ||
    hiddenBefore + assets.length + hiddenAfter !== total
  ) throw new Error(invalidMessage)
  assertNoRawMediaLocation(content, invalidMessage)
  return {
    projectId: request.projectId,
    revision,
    ...(request.folderId ? { folderId: request.folderId } : {}),
    query: request.query,
    offset,
    limit,
    total,
    hiddenBefore,
    hiddenAfter,
    assets
  }
}

function assetProjectionFrom(value: unknown): AssetProjection | undefined {
  if (
    !isRecord(value) ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !['video', 'audio', 'image', 'animation'].includes(String(value.kind)) ||
    safeInteger(value.durationUs) === undefined ||
    typeof value.container !== 'string' ||
    !Array.isArray(value.transcriptIds) ||
    !value.transcriptIds.every((id) => typeof id === 'string')
  ) return undefined
  return {
    id: value.id,
    name: value.name,
    kind: value.kind as AssetProjection['kind'],
    ...(typeof value.mediaHandleId === 'string' ? { mediaHandleId: value.mediaHandleId } : {}),
    durationUs: Number(value.durationUs),
    container: value.container,
    ...(isRecord(value.video) ? { video: value.video as AssetProjection['video'] } : {}),
    ...(isRecord(value.audio) ? { audio: value.audio as AssetProjection['audio'] } : {}),
    ...(isRecord(value.still) ? { still: value.still as AssetProjection['still'] } : {}),
    ...(typeof value.folderId === 'string' ? { folderId: value.folderId } : {}),
    ...(isRecord(value.generatedLineage)
      ? { generatedLineage: value.generatedLineage as AssetProjection['generatedLineage'] }
      : {}),
    ...(['online', 'offline', 'revoked', 'changed'].includes(String(value.availability))
      ? { availability: value.availability as AssetProjection['availability'] }
      : {}),
    transcriptIds: value.transcriptIds as string[]
  }
}

function projectFrom(content: Record<string, unknown>, invalidMessage: string): ProjectProjection {
  const value = isRecord(content.project) ? content.project : content
  if (
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    typeof value.name !== 'string' ||
    !isRecord(value.fps) ||
    !isRecord(value.canvas) ||
    !Number.isSafeInteger(value.currentRevision)
  ) throw new Error(invalidMessage)
  assertNoRawMediaLocation(value, invalidMessage)
  const multicamGroups = Array.isArray(value.multicamGroups)
    ? value.multicamGroups.slice(0, VIEW_LIMITS.multicamGroups)
    : []
  if (!multicamGroups.every(isMulticamGroupProjection)) throw new Error(invalidMessage)
  const projected = value as unknown as ProjectProjection
  return {
    ...projected,
    sequences: Array.isArray(value.sequences)
      ? projected.sequences
      : [{
          id: projected.activeSequenceId,
          name: projected.name,
          durationFrames: projected.durationFrames,
          itemCount: Array.isArray(value.items) ? value.items.length : 0,
          captionCount: Array.isArray(value.captions) ? value.captions.length : 0,
          viewState: { zoom: 1, scrollFrame: 0, open: true }
        }],
    mediaFolders: Array.isArray(value.mediaFolders) ? projected.mediaFolders : [],
    linkGroups: Array.isArray(value.linkGroups) ? projected.linkGroups : [],
    multicamGroups: multicamGroups as MulticamGroupProjection[]
  }
}

function isMulticamGroupProjection(value: unknown): value is MulticamGroupProjection {
  if (
    !isRecord(value) || value.schemaVersion !== 1 ||
    typeof value.id !== 'string' || typeof value.sequenceId !== 'string' ||
    typeof value.name !== 'string' || !isRecord(value.fps) ||
    !positiveSafeInteger(value.fps.numerator) || !positiveSafeInteger(value.fps.denominator) ||
    !positiveSafeInteger(value.durationFrames) || typeof value.referenceMemberId !== 'string' ||
    !Array.isArray(value.members) || !Array.isArray(value.layouts) ||
    !Array.isArray(value.programFragments)
  ) return false
  const membersValid = value.members.every((member) => {
    if (
      !isRecord(member) || typeof member.id !== 'string' || typeof member.assetId !== 'string' ||
      typeof member.memberLabel !== 'string' || typeof member.angleLabel !== 'string' ||
      !isRecord(member.sourceFps) || !positiveSafeInteger(member.sourceFps.numerator) ||
      !positiveSafeInteger(member.sourceFps.denominator) || !isRecord(member.sync) ||
      !['reference', 'verified', 'uncertain', 'unknown'].includes(String(member.sync.status)) ||
      signedSafeInteger(member.sync.offsetFrames) === undefined ||
      !Array.isArray(member.sync.evidence) || !Array.isArray(member.coverage)
    ) return false
    if (
      member.sync.confidence !== null && member.sync.confidence !== undefined &&
      (typeof member.sync.confidence !== 'number' || !Number.isFinite(member.sync.confidence) ||
        member.sync.confidence < 0 || member.sync.confidence > 1)
    ) return false
    return member.sync.evidence.every((evidence) =>
      isRecord(evidence) && typeof evidence.id === 'string' && typeof evidence.analysisId === 'string' &&
      ['audio-correlation', 'timecode', 'manual-confirmation'].includes(String(evidence.kind)) &&
      typeof evidence.referenceMemberId === 'string' && typeof evidence.targetMemberId === 'string' &&
      typeof evidence.confidence === 'number' && Number.isFinite(evidence.confidence) &&
      typeof evidence.algorithmId === 'string' && typeof evidence.algorithmVersion === 'string'
    ) && member.coverage.every((segment) =>
      isRecord(segment) && typeof segment.id === 'string' &&
      safeInteger(segment.startFrame) !== undefined && positiveSafeInteger(segment.endFrame) &&
      safeInteger(segment.sourceStartFrame) !== undefined && positiveSafeInteger(segment.sourceEndFrame)
    )
  })
  const layoutsValid = value.layouts.every((layout) =>
    isRecord(layout) && typeof layout.id === 'string' && typeof layout.label === 'string' &&
    Array.isArray(layout.slots) && layout.slots.every((slot) =>
      isRecord(slot) && typeof slot.memberId === 'string' &&
      ['x', 'y', 'width', 'height', 'opacity'].every((key) =>
        typeof slot[key] === 'number' && Number.isFinite(slot[key])
      ) && safeInteger(slot.zIndex) !== undefined && typeof slot.audioEnabled === 'boolean'
    )
  )
  const fragmentsValid = value.programFragments.every((fragment) =>
    isRecord(fragment) && typeof fragment.id === 'string' &&
    safeInteger(fragment.startFrame) !== undefined && positiveSafeInteger(fragment.endFrame) &&
    isRecord(fragment.selection) && (
      (fragment.selection.kind === 'angle' && typeof fragment.selection.memberId === 'string') ||
      (fragment.selection.kind === 'layout' && typeof fragment.selection.layoutId === 'string')
    )
  )
  return membersValid && layoutsValid && fragmentsValid
}

function positiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0
}

function assertNoRawMediaLocation(value: unknown, invalidMessage: string): void {
  const visit = (candidate: unknown, depth: number): void => {
    if (depth > 16) throw new Error(invalidMessage)
    if (Array.isArray(candidate)) {
      candidate.slice(0, 4_000).forEach((item) => visit(item, depth + 1))
      return
    }
    if (!isRecord(candidate)) return
    for (const [key, child] of Object.entries(candidate)) {
      if (/^(?:path|filePath|absolutePath|workspaceRelativePath|sourcePath|cachePath)$/iu.test(key)) {
        throw new Error(invalidMessage)
      }
      visit(child, depth + 1)
    }
  }
  visit(value, 0)
}

function localSelectionProjection(
  state: EditorState,
  project: ProjectProjection
): ProjectProjection['selection'] {
  return {
    sequenceId: project.activeSequenceId,
    revision: project.currentRevision,
    generation: project.selection.generation,
    playheadFrame: state.playheadFrame,
    selectedAssetIds: state.selectedAssetId ? [state.selectedAssetId] : [],
    selectedItemIds: state.selectedItemId ? [state.selectedItemId] : [],
    selectedCaptionIds: state.selectedCaptionId ? [state.selectedCaptionId] : [],
    selectedWordIds: [...project.selection.selectedWordIds],
    ...(project.selection.range ? { range: { ...project.selection.range } } : {})
  }
}

function selectionFingerprint(selection: ProjectProjection['selection']): string {
  return JSON.stringify({
    sequenceId: selection.sequenceId,
    revision: selection.revision,
    playheadFrame: selection.playheadFrame,
    selectedAssetIds: selection.selectedAssetIds,
    selectedItemIds: selection.selectedItemIds,
    selectedCaptionIds: selection.selectedCaptionIds,
    selectedWordIds: selection.selectedWordIds,
    range: selection.range ?? null
  })
}

function selectionUpdateFrom(value: unknown): {
  projectId: string
  revision: number
  generation: number
  eventGeneration: number
  selection: ProjectProjection['selection']
} | undefined {
  if (
    !isRecord(value) ||
    typeof value.projectId !== 'string' ||
    safeInteger(value.revision) === undefined ||
    safeInteger(value.generation) === undefined ||
    safeInteger(value.eventGeneration) === undefined ||
    !isRecord(value.selection)
  ) return undefined
  const selection = value.selection
  const sequenceId = typeof selection.sequenceId === 'string' ? selection.sequenceId : undefined
  const revision = safeInteger(selection.revision)
  const generation = safeInteger(selection.generation)
  const playheadFrame = safeInteger(selection.playheadFrame)
  if (!sequenceId || revision === undefined || generation === undefined || playheadFrame === undefined) {
    return undefined
  }
  const ids = (candidate: unknown): string[] | undefined => Array.isArray(candidate) &&
    candidate.length <= 200 && candidate.every((item) => typeof item === 'string')
    ? candidate as string[]
    : undefined
  const selectedAssetIds = ids(selection.selectedAssetIds)
  const selectedItemIds = ids(selection.selectedItemIds)
  const selectedCaptionIds = ids(selection.selectedCaptionIds)
  const selectedWordIds = ids(selection.selectedWordIds)
  if (!selectedAssetIds || !selectedItemIds || !selectedCaptionIds || !selectedWordIds) return undefined
  let range: ProjectProjection['selection']['range']
  if (selection.range !== undefined) {
    if (!isRecord(selection.range)) return undefined
    const startFrame = safeInteger(selection.range.startFrame)
    const endFrame = safeInteger(selection.range.endFrame)
    if (startFrame === undefined || endFrame === undefined || endFrame <= startFrame) return undefined
    range = { startFrame, endFrame }
  }
  return {
    projectId: value.projectId,
    revision: Number(value.revision),
    generation: Number(value.generation),
    eventGeneration: Number(value.eventGeneration),
    selection: {
      sequenceId,
      revision,
      generation,
      playheadFrame,
      selectedAssetIds,
      selectedItemIds,
      selectedCaptionIds,
      selectedWordIds,
      ...(range ? { range } : {})
    }
  }
}

function persistedState(value: JsonValue | undefined): PersistedEditorState | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1) return undefined
  return {
    schemaVersion: 1,
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    ...(typeof value.selectedItemId === 'string' ? { selectedItemId: value.selectedItemId } : {}),
    playheadFrame: safeInteger(value.playheadFrame) ?? 0,
    ...(typeof value.activeRunId === 'string' ? { activeRunId: value.activeRunId } : {}),
    activeWorkspace: isEditorWorkspace(value.activeWorkspace) ? value.activeWorkspace : 'script',
    renderTickets: Array.isArray(value.renderTickets)
      ? value.renderTickets.filter(isRenderTicket).slice(-VIEW_LIMITS.jobs)
      : [],
    projectPackageTickets: Array.isArray(value.projectPackageTickets)
      ? value.projectPackageTickets.filter(isProjectPackageTicket).slice(-VIEW_LIMITS.jobs)
      : [],
    otioExportTickets: Array.isArray(value.otioExportTickets)
      ? value.otioExportTickets.filter(isOtioExportTicket).slice(-VIEW_LIMITS.jobs)
      : [],
    transcriptWindowStart: safeInteger(value.transcriptWindowStart) ?? 0
  }
}

function projectChange(value: JsonValue, fallbackReason: string): ProjectChange | undefined {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.projectId !== 'string') return undefined
  return {
    schemaVersion: 1,
    projectId: value.projectId,
    revision: safeInteger(value.revision) ?? 0,
    ...(safeInteger(value.generation) === undefined ? {} : { generation: Number(value.generation) }),
    ...(typeof value.sequenceId === 'string' ? { sequenceId: value.sequenceId } : {}),
    ...(safeInteger(value.selectionGeneration) === undefined
      ? {}
      : { selectionGeneration: Number(value.selectionGeneration) }),
    reason: typeof value.reason === 'string' ? value.reason.slice(0, 256) : fallbackReason,
    changedIds: Array.isArray(value.changedIds)
      ? value.changedIds.filter((item): item is string => typeof item === 'string').slice(0, 2_000)
      : [],
    ...(isRecord(value.receipt) ? { receipt: value.receipt } : {}),
    ...(typeof value.proofInvalidated === 'boolean' ? { proofInvalidated: value.proofInvalidated } : {})
  }
}

function requiredProject(state: EditorState, missingMessage: string): ProjectProjection {
  if (!state.project) throw new Error(missingMessage)
  return state.project
}

function requiredProjectPackageTicket(
  state: EditorState,
  jobId: string,
  missingMessage: string
): ProjectPackageTicket {
  const project = requiredProject(state, missingMessage)
  const ticket = state.projectPackageTickets.find((candidate) =>
    candidate.jobId === jobId && candidate.projectId === project.id
  )
  if (!ticket) throw new Error(missingMessage)
  return ticket
}

function requiredOtioExportTicket(
  state: EditorState,
  jobId: string,
  missingMessage: string
): OtioExportTicket {
  const project = requiredProject(state, missingMessage)
  const ticket = state.otioExportTickets.find((candidate) =>
    candidate.jobId === jobId && candidate.projectId === project.id
  )
  if (!ticket) throw new Error(missingMessage)
  return ticket
}

function assetFromState(state: EditorState, assetId: string | undefined): AssetProjection | undefined {
  if (!assetId) return undefined
  return state.project?.assets.find(({ id }) => id === assetId) ??
    state.mediaLibrary?.assets.find(({ id }) => id === assetId)
}

function asRecord(value: unknown, invalidMessage: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(invalidMessage)
  return value
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function safeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && Number(value) >= 0 ? Number(value) : undefined
}

function signedSafeInteger(value: unknown): number | undefined {
  return Number.isSafeInteger(value) ? Number(value) : undefined
}

function isProjectSummary(value: unknown): value is ProjectSummary {
  return isRecord(value) && typeof value.id === 'string' && typeof value.name === 'string' &&
    Number.isSafeInteger(value.currentRevision) && typeof value.updatedAt === 'string' &&
    Number.isSafeInteger(value.durationFrames)
}

function isRenderKind(value: unknown): value is RenderTicket['renderKind'] {
  return ['proof-frame', 'preview', 'h264-mp4', 'audio-aac', 'subtitles'].includes(String(value))
}

function isRenderTicket(value: unknown): value is RenderTicket {
  return isRecord(value) && typeof value.jobId === 'string' && typeof value.projectId === 'string' &&
    Number.isSafeInteger(value.pinnedRevision) && isRenderKind(value.renderKind) && typeof value.createdAt === 'string'
}

function isEditorWorkspace(value: unknown): value is EditorWorkspace {
  return ['script', 'clips', 'timeline', 'properties', 'output'].includes(String(value))
}

function interchangeLossManifestFrom(
  value: unknown,
  invalidMessage: string
): InterchangeLossManifestProjection {
  if (!isRecord(value) || value.adapterId !== 'kun.otio-json' || value.adapterVersion !== '1.0.0' ||
    typeof value.portableLossless !== 'boolean' || typeof value.kunRoundTripLossless !== 'boolean' ||
    safeInteger(value.truncated) === undefined || !Array.isArray(value.entries) || value.entries.length > 128) {
    throw new Error(invalidMessage)
  }
  const entries = value.entries.map((entry): InterchangeLossManifestProjection['entries'][number] => {
    if (!isRecord(entry) ||
      typeof entry.code !== 'string' || entry.code.length < 1 || entry.code.length > 128 ||
      (entry.severity !== 'info' && entry.severity !== 'warning') ||
      typeof entry.feature !== 'string' || entry.feature.length < 1 || entry.feature.length > 128 ||
      !stableProjectionId(entry.nodeId) ||
      (entry.preservation !== 'otio-standard' && entry.preservation !== 'kun-metadata') ||
      typeof entry.message !== 'string' || entry.message.length < 1 || entry.message.length > 1_024) {
      throw new Error(invalidMessage)
    }
    return {
      code: entry.code,
      severity: entry.severity,
      feature: entry.feature,
      nodeId: entry.nodeId,
      preservation: entry.preservation,
      message: entry.message
    }
  })
  return {
    adapterId: 'kun.otio-json',
    adapterVersion: '1.0.0',
    portableLossless: value.portableLossless,
    kunRoundTripLossless: value.kunRoundTripLossless,
    entries,
    truncated: Number(value.truncated)
  }
}

type OtioExportJobProjection = {
  jobId: string
  kind: 'media.ffmpeg'
  projectId: string
  sequenceId: string
  pinnedRevision: number
  adapterId: 'kun.otio-json'
  adapterVersion: '1.0.0'
  documentDigest: string
  projectDigest: string
  documentBytes: number
  lossManifest: InterchangeLossManifestProjection
}

function otioExportJobProjectionFrom(
  value: unknown,
  invalidMessage: string
): OtioExportJobProjection {
  if (!isRecord(value)) throw new Error(invalidMessage)
  const documentBytes = safeInteger(value.documentBytes)
  if (
    value.kind !== 'media.ffmpeg' ||
    typeof value.jobId !== 'string' || !/^[A-Za-z0-9._~-]{8,256}$/u.test(value.jobId) ||
    !stableProjectionId(value.projectId) || !stableProjectionId(value.sequenceId) ||
    safeInteger(value.pinnedRevision) === undefined ||
    value.adapterId !== 'kun.otio-json' || value.adapterVersion !== '1.0.0' ||
    typeof value.documentDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.documentDigest) ||
    typeof value.projectDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.projectDigest) ||
    documentBytes === undefined || documentBytes < 1 || documentBytes > 2 * 1024 * 1024
  ) throw new Error(invalidMessage)
  return {
    jobId: value.jobId,
    kind: 'media.ffmpeg',
    projectId: value.projectId,
    sequenceId: value.sequenceId,
    pinnedRevision: Number(value.pinnedRevision),
    adapterId: 'kun.otio-json',
    adapterVersion: '1.0.0',
    documentDigest: value.documentDigest,
    projectDigest: value.projectDigest,
    documentBytes,
    lossManifest: interchangeLossManifestFrom(value.lossManifest, invalidMessage)
  }
}

function otioExportTicketFrom(
  value: unknown,
  project: ProjectProjection,
  invalidMessage: string
): OtioExportTicket {
  const projection = otioExportJobProjectionFrom(value, invalidMessage)
  if (
    projection.projectId !== project.id ||
    projection.sequenceId !== project.activeSequenceId ||
    projection.pinnedRevision !== project.currentRevision
  ) throw new Error(invalidMessage)
  const { kind: _kind, ...ticket } = projection
  return { schemaVersion: 1, ...ticket, createdAt: new Date().toISOString() }
}

function isOtioExportTicket(value: unknown): value is OtioExportTicket {
  if (!isRecord(value) || value.schemaVersion !== 1 || typeof value.createdAt !== 'string' ||
    !Number.isFinite(Date.parse(value.createdAt))) return false
  try {
    otioExportJobProjectionFrom({ ...value, kind: 'media.ffmpeg' }, 'invalid')
    return true
  } catch {
    return false
  }
}

function assertOtioExportProjection(
  value: unknown,
  ticket: OtioExportTicket,
  invalidMessage: string
): void {
  const projection = otioExportJobProjectionFrom(value, invalidMessage)
  if (
    projection.jobId !== ticket.jobId ||
    projection.projectId !== ticket.projectId ||
    projection.sequenceId !== ticket.sequenceId ||
    projection.pinnedRevision !== ticket.pinnedRevision ||
    projection.documentDigest !== ticket.documentDigest ||
    projection.projectDigest !== ticket.projectDigest ||
    projection.documentBytes !== ticket.documentBytes ||
    JSON.stringify(projection.lossManifest) !== JSON.stringify(ticket.lossManifest)
  ) throw new Error(invalidMessage)
}

function assertOtioExportSnapshot(
  snapshot: JobSnapshot,
  ticket: OtioExportTicket,
  invalidMessage: string
): void {
  if (
    snapshot.id !== ticket.jobId ||
    snapshot.kind !== 'media.ffmpeg' ||
    snapshot.initiatingOperation !== 'media.startFfmpegJob'
  ) throw new Error(invalidMessage)
}

function otioImportPreviewFrom(value: unknown, invalidMessage: string): OtioImportPreview {
  if (!isRecord(value) || value.outcome !== 'interchange-import-preview' ||
    value.adapterId !== 'kun.otio-json' || value.adapterVersion !== '1.0.0' ||
    value.persisted !== false || value.confirmationRequired !== true ||
    typeof value.inputHandleId !== 'string' || !/^[A-Za-z0-9_-]{16,512}$/u.test(value.inputHandleId) ||
    typeof value.displayName !== 'string' || value.displayName.length < 1 || value.displayName.length > 256 ||
    (value.displayName.includes('/') || value.displayName.includes('\\') ||
      containsAsciiControlCharacters(value.displayName)) ||
    typeof value.sourceDocumentDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(value.sourceDocumentDigest) ||
    !stableProjectionId(value.sourceProjectId) || safeInteger(value.sourceProjectRevision) === undefined ||
    !stableProjectionId(value.suggestedProjectId) ||
    (value.fidelity !== 'kun-metadata' && value.fidelity !== 'portable-otio') ||
    !isRecord(value.project)) throw new Error(invalidMessage)
  const project = value.project
  if (
    project.id !== value.sourceProjectId ||
    typeof project.name !== 'string' || project.name.length < 1 || project.name.length > 160 ||
    safeInteger(project.revision) !== Number(value.sourceProjectRevision) ||
    !stableProjectionId(project.activeSequenceId) || !isRecord(project.counts)
  ) throw new Error(invalidMessage)
  const projectCounts = project.counts
  if (!isRecord(projectCounts)) throw new Error(invalidMessage)
  const countNames = ['assets', 'sequences', 'tracks', 'items', 'captions', 'transcripts'] as const
  const counts = Object.fromEntries(countNames.map((name) => {
    const count = safeInteger(projectCounts[name])
    if (count === undefined) throw new Error(invalidMessage)
    return [name, count]
  })) as OtioImportPreview['project']['counts']
  if (!Array.isArray(value.mediaRelinkRequired) || value.mediaRelinkRequired.length > VIEW_LIMITS.assets ||
    !value.mediaRelinkRequired.every(stableProjectionId) || !Array.isArray(value.timecodeMappings) ||
    value.timecodeMappings.length > 256 || safeInteger(value.timecodeMappingsTruncated) === undefined) {
    throw new Error(invalidMessage)
  }
  const timecodeMappings = value.timecodeMappings.map((mapping): OtioTimecodeMappingProjection => {
    if (!isRecord(mapping) || !stableProjectionId(mapping.id) || !stableProjectionId(mapping.sequenceId) ||
      safeInteger(mapping.startFrame) === undefined || safeInteger(mapping.endFrame) === undefined ||
      Number(mapping.endFrame) < Number(mapping.startFrame) ||
      typeof mapping.startTimecode !== 'string' || !/^\d{2,}:\d{2}:\d{2}:\d{2}$/u.test(mapping.startTimecode) ||
      typeof mapping.endTimecode !== 'string' || !/^\d{2,}:\d{2}:\d{2}:\d{2}$/u.test(mapping.endTimecode) ||
      !isRecord(mapping.frameRate) || safeInteger(mapping.frameRate.numerator) === undefined ||
      safeInteger(mapping.frameRate.denominator) === undefined || Number(mapping.frameRate.numerator) < 1 ||
      Number(mapping.frameRate.denominator) < 1) throw new Error(invalidMessage)
    return {
      id: mapping.id,
      sequenceId: mapping.sequenceId,
      startFrame: Number(mapping.startFrame),
      endFrame: Number(mapping.endFrame),
      startTimecode: mapping.startTimecode,
      endTimecode: mapping.endTimecode,
      frameRate: {
        numerator: Number(mapping.frameRate.numerator),
        denominator: Number(mapping.frameRate.denominator)
      }
    }
  })
  return {
    inputHandleId: value.inputHandleId,
    displayName: value.displayName,
    sourceDocumentDigest: value.sourceDocumentDigest,
    sourceProjectId: value.sourceProjectId,
    sourceProjectRevision: Number(value.sourceProjectRevision),
    suggestedProjectId: value.suggestedProjectId,
    fidelity: value.fidelity,
    project: {
      id: value.sourceProjectId,
      name: project.name,
      revision: Number(project.revision),
      activeSequenceId: project.activeSequenceId,
      counts
    },
    mediaRelinkRequired: [...value.mediaRelinkRequired],
    timecodeMappings,
    timecodeMappingsTruncated: Number(value.timecodeMappingsTruncated),
    lossManifest: interchangeLossManifestFrom(value.lossManifest, invalidMessage)
  }
}

function isProjectPackageTicket(value: unknown): value is ProjectPackageTicket {
  return isRecord(value) &&
    value.schemaVersion === 1 &&
    typeof value.jobId === 'string' && /^[A-Za-z0-9._~-]{8,256}$/u.test(value.jobId) &&
    stableProjectionId(value.projectId) &&
    stableProjectionId(value.sequenceId) &&
    safeInteger(value.pinnedRevision) !== undefined &&
    typeof value.packageId === 'string' && /^pkg-[a-f0-9]{32}$/u.test(value.packageId) &&
    typeof value.manifestDigest === 'string' && /^[a-f0-9]{64}$/u.test(value.manifestDigest) &&
    typeof value.complete === 'boolean' &&
    safeInteger(value.selectedAssetCount) !== undefined &&
    safeInteger(value.embeddedAssetCount) !== undefined &&
    safeInteger(value.uniqueMediaCount) !== undefined &&
    safeInteger(value.deduplicatedAssetCount) !== undefined &&
    Array.isArray(value.missingAssetIds) &&
    value.missingAssetIds.length <= VIEW_LIMITS.assets &&
    value.missingAssetIds.every(stableProjectionId) &&
    (value.missingMediaPolicy === 'fail' || value.missingMediaPolicy === 'omit') &&
    (value.mediaScope === 'all' || value.mediaScope === 'selected') &&
    typeof value.receiptsRequested === 'boolean' &&
    typeof value.agentProvenanceRequested === 'boolean' &&
    typeof value.createdAt === 'string'
}

type ProjectPackageJobProjection = {
  jobId: string
  kind: 'media.archive'
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
  missingMediaPolicy: ProjectPackageMissingMediaPolicy
}

function projectPackageJobProjectionFrom(
  value: unknown,
  invalidMessage: string
): ProjectPackageJobProjection {
  if (!isRecord(value)) throw new Error(invalidMessage)
  const projection: ProjectPackageJobProjection = {
    jobId: typeof value.jobId === 'string' ? value.jobId : '',
    kind: value.kind === 'media.archive' ? value.kind : 'media.archive',
    projectId: typeof value.projectId === 'string' ? value.projectId : '',
    sequenceId: typeof value.sequenceId === 'string' ? value.sequenceId : '',
    pinnedRevision: safeInteger(value.pinnedRevision) ?? -1,
    packageId: typeof value.packageId === 'string' ? value.packageId : '',
    manifestDigest: typeof value.manifestDigest === 'string' ? value.manifestDigest : '',
    complete: typeof value.complete === 'boolean' ? value.complete : false,
    selectedAssetCount: safeInteger(value.selectedAssetCount) ?? -1,
    embeddedAssetCount: safeInteger(value.embeddedAssetCount) ?? -1,
    uniqueMediaCount: safeInteger(value.uniqueMediaCount) ?? -1,
    deduplicatedAssetCount: safeInteger(value.deduplicatedAssetCount) ?? -1,
    missingAssetIds: Array.isArray(value.missingAssetIds)
      ? value.missingAssetIds.filter((assetId): assetId is string => typeof assetId === 'string')
      : [],
    missingMediaPolicy: value.missingMediaPolicy === 'omit' ? 'omit' : 'fail'
  }
  if (
    value.kind !== 'media.archive' ||
    !/^[A-Za-z0-9._~-]{8,256}$/u.test(projection.jobId) ||
    !stableProjectionId(projection.projectId) || !stableProjectionId(projection.sequenceId) ||
    projection.pinnedRevision < 0 ||
    !/^pkg-[a-f0-9]{32}$/u.test(projection.packageId) ||
    !/^[a-f0-9]{64}$/u.test(projection.manifestDigest) ||
    typeof value.complete !== 'boolean' ||
    projection.selectedAssetCount < 0 || projection.embeddedAssetCount < 0 ||
    projection.uniqueMediaCount < 0 || projection.deduplicatedAssetCount < 0 ||
    !Array.isArray(value.missingAssetIds) ||
    projection.missingAssetIds.length !== value.missingAssetIds.length ||
    projection.missingAssetIds.length > VIEW_LIMITS.assets ||
    !projection.missingAssetIds.every(stableProjectionId) ||
    (value.missingMediaPolicy !== 'fail' && value.missingMediaPolicy !== 'omit')
  ) throw new Error(invalidMessage)
  return projection
}

function projectPackageTicketFrom(
  value: unknown,
  project: ProjectProjection,
  options: ProjectPackageExportOptions,
  invalidMessage: string
): ProjectPackageTicket {
  const projection = projectPackageJobProjectionFrom(value, invalidMessage)
  if (
    projection.projectId !== project.id ||
    projection.sequenceId !== project.activeSequenceId ||
    projection.pinnedRevision !== project.currentRevision ||
    projection.missingMediaPolicy !== options.missingMediaPolicy
  ) throw new Error(invalidMessage)
  const { kind: _kind, ...ticketProjection } = projection
  return {
    schemaVersion: 1,
    ...ticketProjection,
    mediaScope: options.mediaScope,
    receiptsRequested: options.includeReceipts,
    agentProvenanceRequested: options.includeAgentProvenance,
    createdAt: new Date().toISOString()
  }
}

function assertProjectPackageProjection(
  value: unknown,
  ticket: ProjectPackageTicket,
  invalidMessage: string
): void {
  const projection = projectPackageJobProjectionFrom(value, invalidMessage)
  const staticFieldsMatch = projection.jobId === ticket.jobId &&
    projection.projectId === ticket.projectId &&
    projection.sequenceId === ticket.sequenceId &&
    projection.pinnedRevision === ticket.pinnedRevision &&
    projection.packageId === ticket.packageId &&
    projection.manifestDigest === ticket.manifestDigest &&
    projection.complete === ticket.complete &&
    projection.selectedAssetCount === ticket.selectedAssetCount &&
    projection.embeddedAssetCount === ticket.embeddedAssetCount &&
    projection.uniqueMediaCount === ticket.uniqueMediaCount &&
    projection.deduplicatedAssetCount === ticket.deduplicatedAssetCount &&
    projection.missingMediaPolicy === ticket.missingMediaPolicy &&
    projection.missingAssetIds.length === ticket.missingAssetIds.length &&
    projection.missingAssetIds.every((id, index) => id === ticket.missingAssetIds[index])
  if (!staticFieldsMatch) throw new Error(invalidMessage)
}

function assertProjectPackageSnapshot(
  snapshot: JobSnapshot,
  ticket: ProjectPackageTicket,
  invalidMessage: string
): void {
  if (
    snapshot.id !== ticket.jobId ||
    snapshot.kind !== 'media.archive' ||
    snapshot.initiatingOperation !== 'media.startArchiveJob'
  ) throw new Error(invalidMessage)
}

function stableProjectionId(value: unknown): value is string {
  return typeof value === 'string' &&
    /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value) &&
    value !== '.' && value !== '..'
}

function derivedRecordFrom(value: unknown): DerivedMediaRecordProjection | undefined {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    typeof value.id !== 'string' ||
    !Number.isSafeInteger(value.generation) ||
    Number(value.generation) < 1 ||
    !Number.isSafeInteger(value.statusGeneration) ||
    Number(value.statusGeneration) < 1 ||
    Number(value.statusGeneration) > Number(value.generation) ||
    !isDerivedKind(value.kind) ||
    !isDerivedStatus(value.status) ||
    !['background', 'user', 'interactive', 'export'].includes(String(value.priority)) ||
    !Number.isSafeInteger(value.bytes) ||
    Number(value.bytes) < 0 ||
    typeof value.pinned !== 'boolean' ||
    !Number.isSafeInteger(value.attempt) ||
    Number(value.attempt) < 1 ||
    typeof value.createdAt !== 'string' ||
    typeof value.updatedAt !== 'string'
  ) return undefined
  const progress = isRecord(value.progress) &&
    typeof value.progress.completed === 'number' &&
    Number.isFinite(value.progress.completed) &&
    typeof value.progress.total === 'number' &&
    Number.isFinite(value.progress.total) &&
    value.progress.total > 0 &&
    typeof value.progress.unit === 'string'
    ? {
        completed: value.progress.completed,
        total: value.progress.total,
        unit: value.progress.unit.slice(0, 64),
        ...(typeof value.progress.message === 'string' ? { message: value.progress.message.slice(0, 512) } : {})
      }
    : undefined
  const error = isRecord(value.error) &&
    typeof value.error.code === 'string' &&
    typeof value.error.message === 'string' &&
    typeof value.error.retryable === 'boolean'
    ? {
        code: value.error.code.slice(0, 128),
        message: value.error.message.slice(0, 1_024),
        retryable: value.error.retryable
      }
    : undefined
  return {
    schemaVersion: 1,
    id: value.id,
    generation: Number(value.generation),
    statusGeneration: Number(value.statusGeneration),
    kind: value.kind,
    ...(typeof value.projectId === 'string' ? { projectId: value.projectId } : {}),
    ...(typeof value.assetId === 'string' ? { assetId: value.assetId } : {}),
    status: value.status,
    priority: value.priority as DerivedMediaRecordProjection['priority'],
    bytes: Number(value.bytes),
    pinned: value.pinned,
    attempt: Number(value.attempt),
    ...(typeof value.jobId === 'string' ? { jobId: value.jobId } : {}),
    ...(progress ? { progress } : {}),
    ...(error ? { error } : {}),
    ...(typeof value.retryAfter === 'string' ? { retryAfter: value.retryAfter } : {}),
    ...(isOpaqueHandleId(value.artifactHandleId) ? { artifactHandleId: value.artifactHandleId } : {}),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt
  }
}

function previewHistoryFrom(value: unknown): PreviewHistoryProjection | undefined {
  if (
    !isRecord(value) || value.schemaVersion !== 1 || safeInteger(value.generation) === undefined ||
    !Array.isArray(value.entries) || value.entries.length > VIEW_LIMITS.previewHistory
  ) return undefined
  const entries = value.entries
    .map(previewEntryFrom)
    .filter((entry): entry is PreviewHistoryEntryProjection => entry !== undefined)
  if (entries.length !== value.entries.length) return undefined
  const ids = new Set(entries.map(({ id }) => id))
  const activeEntryId = typeof value.activeEntryId === 'string' && ids.has(value.activeEntryId)
    ? value.activeEntryId
    : undefined
  return {
    schemaVersion: 1,
    generation: Number(value.generation),
    ...(activeEntryId ? { activeEntryId } : {}),
    entries
  }
}

function previewEntryFrom(value: unknown): PreviewHistoryEntryProjection | undefined {
  if (
    !isRecord(value) || !boundedIdentifier(value.id) || !boundedIdentifier(value.projectId) ||
    typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 160 ||
    typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt)) ||
    !isRecord(value.source)
  ) return undefined
  const source = previewSourceFrom(value.source)
  if (!source) return undefined
  return {
    id: value.id,
    projectId: value.projectId,
    createdAt: value.createdAt,
    label: value.label,
    source
  }
}

function previewSourceFrom(value: Record<string, unknown>): PreviewSourceProjection | undefined {
  if (value.kind === 'asset') {
    const startUs = safeInteger(value.startUs)
    const endUs = safeInteger(value.endUs)
    return boundedIdentifier(value.assetId) && startUs !== undefined && endUs !== undefined && endUs > startUs
      ? { kind: 'asset', assetId: value.assetId, startUs, endUs }
      : undefined
  }
  if (value.kind === 'timeline') {
    const revision = safeInteger(value.revision)
    const startFrame = safeInteger(value.startFrame)
    const endFrame = safeInteger(value.endFrame)
    if (
      !boundedIdentifier(value.sequenceId) || revision === undefined || startFrame === undefined ||
      endFrame === undefined || endFrame <= startFrame ||
      (value.artifactId !== undefined && !boundedIdentifier(value.artifactId))
    ) return undefined
    return {
      kind: 'timeline',
      sequenceId: value.sequenceId,
      revision,
      startFrame,
      endFrame,
      ...(typeof value.artifactId === 'string' ? { artifactId: value.artifactId } : {})
    }
  }
  if (value.kind === 'generated') {
    const variantIndex = safeInteger(value.variantIndex)
    return boundedIdentifier(value.assetId) && boundedIdentifier(value.jobId) && variantIndex !== undefined
      ? { kind: 'generated', assetId: value.assetId, jobId: value.jobId, variantIndex }
      : undefined
  }
  return undefined
}

function previewComparisonFrom(value: unknown): PreviewComparisonProjection | undefined {
  if (!isRecord(value) || !['wipe', 'side-by-side'].includes(String(value.mode))) return undefined
  const leftEntryId = typeof value.leftEntryId === 'string'
    ? value.leftEntryId
    : isRecord(value.left) && typeof value.left.id === 'string' ? value.left.id : undefined
  const rightEntryId = typeof value.rightEntryId === 'string'
    ? value.rightEntryId
    : isRecord(value.right) && typeof value.right.id === 'string' ? value.right.id : undefined
  if (!boundedIdentifier(leftEntryId) || !boundedIdentifier(rightEntryId) || leftEntryId === rightEntryId) return undefined
  return {
    leftEntryId,
    rightEntryId,
    mode: value.mode as PreviewComparisonProjection['mode'],
    sameRevision: value.sameRevision === true
  }
}

function dispatchPreviewResult(
  projectId: string,
  content: Record<string, unknown>,
  dispatch: (action: EditorAction) => void
): void {
  const history = previewHistoryFrom(content.history)
  if (history) dispatch({ type: 'preview-history', projectId, value: history })
  const comparison = previewComparisonFrom(content.comparison)
  if (comparison) dispatch({ type: 'preview-comparison', projectId, value: comparison })
}

function boundedIdentifier(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._~-]{0,191}$/u.test(value)
}

function boundedName(value: string, missingMessage: string): string {
  const normalized = replaceNullOrLineBreaks(value.trim(), ' ').slice(0, 160)
  if (!normalized) throw new Error(missingMessage)
  return normalized
}

function localId(prefix: string, label: string): string {
  const slug = label.toLocaleLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9._~-]+/gu, '-')
    .replace(/^-+|-+$/gu, '')
    .slice(0, 72) || 'item'
  return `${prefix}-${slug}-${Date.now().toString(36)}`.slice(0, 128)
}

function derivedUsageFrom(value: unknown): DerivedStorageUsageProjection | undefined {
  if (!isRecord(value)) return undefined
  const fields = [
    'quotaBytes', 'usedBytes', 'readyBytes', 'recordCount', 'pinnedCount', 'evictableCount'
  ] as const
  if (fields.some((field) => !Number.isSafeInteger(value[field]) || Number(value[field]) < 0)) return undefined
  return Object.fromEntries(fields.map((field) => [field, Number(value[field])])) as DerivedStorageUsageProjection
}

function isDerivedKind(value: unknown): value is DerivedMediaKind {
  return ['waveform', 'thumbnail', 'filmstrip', 'transcript', 'analysis', 'embedding', 'proxy', 'proof', 'preview']
    .includes(String(value))
}

function isDerivedStatus(value: unknown): value is DerivedMediaRecordProjection['status'] {
  return ['queued', 'running', 'partial', 'ready', 'failed', 'cancelled', 'interrupted', 'invalid']
    .includes(String(value))
}

function isOpaqueHandleId(value: unknown): value is string {
  return typeof value === 'string' && value.length >= 16 && value.length <= 512 && /^[A-Za-z0-9_-]+$/u.test(value)
}

function derivedTarget(
  kind: 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy',
  projectId: string,
  assetId: string,
  copy: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
): { suggestedName: string; filterName: string; extension: string; mimeType: string } {
  const image = kind !== 'proxy'
  return {
    suggestedName: `${projectId}-${assetId}-${kind}.${image ? 'png' : 'mp4'}`.slice(0, 256),
    filterName: image ? copy('chooseDerivedImage') : copy('chooseDerivedVideo'),
    extension: image ? 'png' : 'mp4',
    mimeType: image ? 'image/png' : 'video/mp4'
  }
}

function derivedParameters(
  kind: 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy',
  durationUs: number
): JsonObject {
  if (kind === 'waveform') return { width: 1_200, height: 240 }
  if (kind === 'thumbnail') return { width: 960, height: 540, seekUs: 0 }
  if (kind === 'filmstrip') return {
    width: 240,
    height: 135,
    filmstripIntervalUs: Math.max(1_000_000, Math.floor(durationUs / 10)),
    filmstripColumns: 5,
    filmstripRows: 2
  }
  return { width: 960, height: 540, durationUs: Math.max(1, durationUs) }
}

function isRevisionConflict(error: unknown): boolean {
  const code = error instanceof ExtensionApiError ? error.code : isRecord(error) ? error.code : undefined
  const message = error instanceof Error ? error.message : ''
  const engineCode = error instanceof ExtensionApiError ? error.details?.engineCode : undefined
  return (
    code === 'CONFLICT' && (engineCode === 'revision_conflict' || engineCode === 'script_stale')
  ) || /REVISION_CONFLICT|revision.conflict/iu.test(String(code)) || /revision (?:conflict|has changed)/iu.test(message)
}

function revisionFromError(error: unknown): number | undefined {
  if (!(error instanceof ExtensionApiError) || !error.details) return undefined
  return safeInteger(error.details.currentRevision)
}

function isRevokedMediaError(error: unknown): boolean {
  const code = error instanceof ExtensionApiError ? error.code : isRecord(error) ? error.code : undefined
  const message = error instanceof Error ? error.message : ''
  return /MEDIA_(?:HANDLE_)?REVOKED|MEDIA_NOT_FOUND/iu.test(String(code)) || /media (?:handle )?(?:was )?(?:revoked|replaced|not found)/iu.test(message)
}

function isOpaqueHostError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : ''
  return /error invoking remote method|extension operation failed/iu.test(message)
}

function agentEventChangesProject(event: AgentRunEvent): boolean {
  if (event.type !== 'message' && event.type !== 'progress') return false
  return JSON.stringify(event).includes('currentRevision') || JSON.stringify(event).includes('project-changed')
}

function transcriptFormat(
  displayName: string,
  mimeType: string,
  unsupportedMessage: string
): 'srt' | 'vtt' | 'json' {
  const normalized = displayName.toLowerCase()
  if (normalized.endsWith('.srt') || mimeType === 'application/x-subrip') return 'srt'
  if (normalized.endsWith('.vtt') || mimeType === 'text/vtt') return 'vtt'
  if (normalized.endsWith('.json') || mimeType === 'application/json') return 'json'
  throw new Error(unsupportedMessage)
}

function visualAssetKind(
  displayName: string,
  mediaKind: MediaMetadata['kind']
): 'image' | 'animation' | undefined {
  if (mediaKind !== 'image') return undefined
  const extension = displayName.toLocaleLowerCase().split('.').at(-1)
  return extension === 'gif' || extension === 'apng' ? 'animation' : 'image'
}

function transcriptSegmentCount(content: Record<string, unknown>): number {
  const details = isRecord(content.details) ? content.details : undefined
  return details && Number.isSafeInteger(details.segmentCount)
    ? Number(details.segmentCount)
    : Array.isArray(details?.segments)
      ? details.segments.length
      : 0
}

function assertRenderCapabilities(
  state: EditorState,
  kind: RenderTicket['renderKind'],
  captionMode: 'none' | 'burned' | 'sidecar' | 'both',
  copy: (key: MessageKey, values?: Readonly<Record<string, string | number>>) => string
): void {
  const capabilities = state.mediaCapabilities
  if ((kind === 'subtitles' || captionMode !== 'none') && !state.project?.captions.length) {
    throw new Error(copy('captionsRequiredForExport'))
  }
  if (!capabilities?.ffprobe.available) throw new Error(copy('ffprobeUnavailable'))
  if (kind !== 'subtitles' && !capabilities.ffmpeg.available) throw new Error(copy('ffmpegUnavailable'))
  const features = new Set(capabilities.ffmpeg.features)
  if ((kind === 'preview' || kind === 'h264-mp4') && !features.has('libx264-encoder')) {
    throw new Error(copy('h264EncoderUnavailable'))
  }
  if ((kind === 'audio-aac' || kind === 'h264-mp4') && !features.has('aac-encoder')) {
    throw new Error(copy('aacEncoderUnavailable'))
  }
  if ((captionMode === 'burned' || captionMode === 'both') && !features.has('drawtext-filter')) {
    throw new Error(copy('burnedCaptionsUnavailable'))
  }
}

function renderCapabilityMessageKey(code: unknown): MessageKey {
  switch (code) {
    case 'FFPROBE_UNAVAILABLE': return 'ffprobeUnavailable'
    case 'FFMPEG_UNAVAILABLE': return 'ffmpegUnavailable'
    case 'LIBX264_ENCODER_UNAVAILABLE': return 'h264EncoderUnavailable'
    case 'AAC_ENCODER_UNAVAILABLE': return 'aacEncoderUnavailable'
    case 'DRAWTEXT_FILTER_UNAVAILABLE': return 'burnedCaptionsUnavailable'
    default: return 'mediaCapabilitiesUnavailable'
  }
}

export function artifactsForJobs(jobs: readonly JobSnapshot[]): GeneratedArtifact[] {
  const byId = new Map<string, GeneratedArtifact>()
  for (const job of jobs) for (const artifact of generatedArtifacts(job)) byId.set(artifact.artifactId, artifact)
  return [...byId.values()].slice(-64)
}
