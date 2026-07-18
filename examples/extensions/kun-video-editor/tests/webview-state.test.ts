import type { AgentRunEvent, JobEvent, MediaResourceLease } from '@kun/extension-api'
import { describe, expect, it } from 'vitest'
import { classifyError } from '../src/webview/controller.js'
import {
  INITIAL_EDITOR_STATE,
  VIEW_LIMITS,
  activeCaptionAtFrame,
  activeTranscriptSegment,
  editorReducer,
  projectFrameFromSourceTime,
  proofIsStale,
  toPersistedState,
  timelineSourceAtFrame,
  transcriptFrame,
  type OtioExportTicket,
  type ProjectPackageTicket,
  type RenderTicket
} from '../src/webview/model.js'
import { makeArtifact, makeJob, makeViewProject } from './webview-fixtures.js'

describe('video editor bounded View state', () => {
  it('persists active workspace and bounded project-package recovery tickets', () => {
    const ticket: ProjectPackageTicket = {
      schemaVersion: 1,
      jobId: 'job_project_package_state_1',
      projectId: 'demo-project',
      sequenceId: 'sequence-main',
      pinnedRevision: 3,
      packageId: `pkg-${'a'.repeat(32)}`,
      manifestDigest: 'b'.repeat(64),
      complete: false,
      selectedAssetCount: 2,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      deduplicatedAssetCount: 0,
      missingAssetIds: ['asset-offline'],
      missingMediaPolicy: 'omit',
      mediaScope: 'selected',
      receiptsRequested: true,
      agentProvenanceRequested: false,
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'active-workspace', value: 'output' })
    state = editorReducer(state, { type: 'project-package-ticket', value: ticket })
    const persisted = toPersistedState(state)
    expect(persisted).toMatchObject({
      activeWorkspace: 'output',
      projectPackageTickets: [ticket]
    })
    expect(JSON.stringify(persisted)).not.toMatch(/(?:handle|file:\/\/|\/Users\/|prompt|chatText)/u)

    const restored = editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized', persisted })
    expect(restored.activeWorkspace).toBe('output')
    expect(restored.projectPackageTickets).toEqual([ticket])
  })

  it('persists durable OTIO export ownership but never persists an import grant', () => {
    const ticket: OtioExportTicket = {
      schemaVersion: 1,
      jobId: 'job_otio_export_state_001',
      projectId: 'demo-project',
      sequenceId: 'sequence-main',
      pinnedRevision: 0,
      adapterId: 'kun.otio-json',
      adapterVersion: '1.0.0',
      documentDigest: 'a'.repeat(64),
      projectDigest: 'b'.repeat(64),
      documentBytes: 4096,
      lossManifest: {
        adapterId: 'kun.otio-json', adapterVersion: '1.0.0',
        portableLossless: false, kunRoundTripLossless: true,
        entries: [{
          code: 'effects-custom-metadata', severity: 'warning', feature: 'effects',
          nodeId: 'item-1', preservation: 'kun-metadata', message: 'Parameters use Kun metadata.'
        }],
        truncated: 0
      },
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'otio-export-ticket', value: ticket })
    state = editorReducer(state, {
      type: 'otio-import-preview',
      value: {
        inputHandleId: 'opaque_otio_input_000001',
        displayName: 'timeline.otio',
        sourceDocumentDigest: 'c'.repeat(64),
        sourceProjectId: 'source-project',
        sourceProjectRevision: 4,
        suggestedProjectId: 'source-project-import',
        fidelity: 'kun-metadata',
        project: {
          id: 'source-project', name: 'Source', revision: 4, activeSequenceId: 'sequence-main',
          counts: { assets: 1, sequences: 1, tracks: 3, items: 2, captions: 0, transcripts: 0 }
        },
        mediaRelinkRequired: ['asset-1'],
        timecodeMappings: [],
        timecodeMappingsTruncated: 0,
        lossManifest: ticket.lossManifest
      }
    })
    const persisted = toPersistedState(state)
    expect(persisted.otioExportTickets).toEqual([ticket])
    expect(JSON.stringify(persisted)).not.toContain('opaque_otio_input_000001')

    const restored = editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized', persisted })
    expect(restored.otioExportTickets).toEqual([ticket])
    expect(restored.otioImportPreview).toBeUndefined()
  })

  it('bounds projections and retains revision-aware manual selection', () => {
    const project = makeViewProject()
    project.items = Array.from({ length: 620 }, (_, index) => ({
      ...project.items[0]!,
      id: `item-${index}`,
      timelineStartFrame: index * 100
    }))
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: project })
    expect(state.project?.items).toHaveLength(VIEW_LIMITS.items)
    state = editorReducer(state, { type: 'selection', itemId: 'item-42' })
    expect(state.selectedItemId).toBe('item-42')
    state = editorReducer(state, { type: 'seek', frame: -10 })
    expect(state.playheadFrame).toBe(0)
  })

  it('keeps an ordered bounded Agent window and refreshes authoritative revisions', () => {
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: makeViewProject() })
    for (let sequence = 1; sequence <= 300; sequence += 1) {
      const event: AgentRunEvent = {
        runId: 'run-1',
        threadId: 'thread-1',
        sequence,
        timestamp: '2026-01-01T00:00:00.000Z',
        type: 'progress',
        message: `event ${sequence}`
      }
      state = editorReducer(state, { type: 'agent-event', value: event })
    }
    expect(state.agentEvents).toHaveLength(VIEW_LIMITS.agentEvents)
    expect(state.agentEvents[0]?.sequence).toBe(45)
    expect(state.agentEvents.at(-1)?.sequence).toBe(300)

    state = editorReducer(state, { type: 'conflict', expectedRevision: 0, currentRevision: 1 })
    expect(state.conflict).toEqual({ expectedRevision: 0, currentRevision: 1 })
    state = editorReducer(state, { type: 'project', value: { ...makeViewProject(), currentRevision: 1 } })
    expect(state.conflict).toBeUndefined()
    expect(state.project?.currentRevision).toBe(1)
  })

  it('fences stale selection responses by project, revision, selection generation, and event generation', () => {
    const project = makeViewProject()
    project.eventGeneration = 5
    project.selection = {
      ...project.selection,
      generation: 5,
      selectedAssetIds: [project.assets[0]!.id],
      selectedItemIds: [project.items[0]!.id]
    }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: project })
    const currentSelection = structuredClone(state.project!.selection)

    state = editorReducer(state, {
      type: 'selection-synced',
      projectId: project.id,
      revision: project.currentRevision,
      generation: 4,
      eventGeneration: 6,
      selection: { ...currentSelection, generation: 4, selectedItemIds: [] }
    })
    expect(state.project?.selection).toEqual(currentSelection)

    state = editorReducer(state, {
      type: 'selection-synced',
      projectId: project.id,
      revision: project.currentRevision,
      generation: 6,
      eventGeneration: 4,
      selection: { ...currentSelection, generation: 6, selectedItemIds: [] }
    })
    expect(state.project?.selection).toEqual(currentSelection)

    state = editorReducer(state, {
      type: 'selection-synced',
      projectId: 'other-project',
      revision: project.currentRevision,
      generation: 6,
      eventGeneration: 6,
      selection: { ...currentSelection, generation: 6, selectedItemIds: [] }
    })
    expect(state.project?.selection).toEqual(currentSelection)

    state = editorReducer(state, {
      type: 'selection-synced',
      projectId: project.id,
      revision: project.currentRevision,
      generation: 6,
      eventGeneration: 6,
      selection: {
        ...currentSelection,
        generation: 6,
        playheadFrame: 30,
        selectedItemIds: []
      }
    })
    expect(state.project).toMatchObject({
      eventGeneration: 6,
      selection: { generation: 6, playheadFrame: 30, selectedItemIds: [] }
    })
  })

  it('revokes stale media leases without retaining reusable URLs', () => {
    const lease: MediaResourceLease = {
      leaseId: 'lease_1234567890abcdef',
      handleId: 'media_1234567890abcdef',
      url: 'kun-media://session/token1234567890',
      mimeType: 'video/mp4',
      expiresAt: '2026-01-01T00:10:00.000Z'
    }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'lease', value: lease })
    state = editorReducer(state, { type: 'active-media', handleId: lease.handleId, url: lease.url })
    state = editorReducer(state, { type: 'media-revoked', handleId: lease.handleId })
    expect(state.activeMediaUrl).toBeUndefined()
    expect(state.leases[lease.handleId]).toBeUndefined()
    expect(state.revokedHandles).toContain(lease.handleId)
  })

  it('reconciles durable job events and fences proof staleness by revision', () => {
    const snapshot = makeJob('running')
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'jobs', value: [snapshot] })
    const event: JobEvent = {
      schemaVersion: 1,
      jobId: snapshot.id,
      kind: snapshot.kind,
      type: 'completed',
      state: 'completed',
      timestamp: '2026-01-01T00:02:00.000Z',
      executionAttempt: 1,
      sequence: 2,
      cursor: 'cursor_2',
      result: { schemaVersion: 1, generatedArtifacts: [makeArtifact(snapshot.id)] }
    }
    state = editorReducer(state, { type: 'job-event', value: event })
    expect(state.jobs[0]?.state).toBe('completed')
    expect(state.jobs[0]?.result?.generatedArtifacts).toHaveLength(1)

    const ticket: RenderTicket = {
      jobId: snapshot.id,
      projectId: 'demo-project',
      pinnedRevision: 0,
      renderKind: 'proof-frame',
      createdAt: '2026-01-01T00:00:00.000Z'
    }
    expect(proofIsStale(ticket, { ...makeViewProject(), currentRevision: 1 })).toBe(true)
    expect(proofIsStale(ticket, makeViewProject())).toBe(false)
  })

  it('orders derived updates by monotonic generation and removes records only from an authoritative list', () => {
    const project = makeViewProject()
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: project })
    const running = {
      schemaVersion: 1 as const,
      id: 'derived-waveform',
      generation: 5,
      statusGeneration: 5,
      kind: 'waveform' as const,
      projectId: project.id,
      assetId: project.assets[0]!.id,
      status: 'running' as const,
      priority: 'interactive' as const,
      bytes: 0,
      pinned: false,
      attempt: 1,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:01.000Z'
    }
    state = editorReducer(state, {
      type: 'derived',
      projectId: project.id,
      revision: project.currentRevision,
      records: [running],
      usage: {
        quotaBytes: 1000,
        usedBytes: 0,
        readyBytes: 0,
        recordCount: 1,
        pinnedCount: 0,
        evictableCount: 0
      }
    })
    state = editorReducer(state, {
      type: 'derived-record',
      value: { ...running, generation: 4, statusGeneration: 4, status: 'failed' }
    })
    expect(state.derivedRecords[0]).toMatchObject({ generation: 5, status: 'running' })

    const ready = {
      ...running,
      generation: 6,
      statusGeneration: 6,
      status: 'ready' as const,
      bytes: 300,
      updatedAt: '2026-01-01T00:00:02.000Z'
    }
    state = editorReducer(state, { type: 'derived-record', value: ready })
    state = editorReducer(state, {
      type: 'derived',
      projectId: project.id,
      revision: project.currentRevision,
      records: [running]
    })
    expect(state.derivedRecords[0]).toMatchObject({ generation: 6, status: 'ready', bytes: 300 })

    state = editorReducer(state, {
      type: 'derived',
      projectId: project.id,
      revision: project.currentRevision,
      records: []
    })
    expect(state.derivedRecords).toEqual([])
  })

  it('rejects stale derived and media-intelligence projections after a project revision advances', () => {
    const project = { ...makeViewProject(), currentRevision: 4 }
    let state = editorReducer(INITIAL_EDITOR_STATE, {
      type: 'project',
      value: { ...project, currentRevision: 3 }
    })
    state = editorReducer(state, {
      type: 'audio-analysis-state',
      projectId: project.id,
      revision: 3,
      syncPreview: {
        analysisId: 'analysis:sync:stale',
        referenceItemId: 'item-1',
        targetItemId: 'item-2',
        targetFrameBefore: 60,
        targetFrameAfter: 54,
        deltaFrames: -6,
        confidence: 0.95,
        outcome: 'ready'
      }
    })
    state = editorReducer(state, { type: 'project', value: project })
    expect(state.audioSyncPreview).toBeUndefined()
    state = editorReducer(state, {
      type: 'audio-analysis-state',
      projectId: project.id,
      revision: 3,
      records: [{
        schemaVersion: 1,
        id: 'analysis:vad:stale',
        kind: 'vad',
        assetId: project.assets[0]!.id,
        immutable: true
      }]
    })
    state = editorReducer(state, {
      type: 'media-intelligence-progress',
      value: {
        schemaVersion: 1,
        operationId: 'media-analysis-stale',
        projectId: project.id,
        projectRevision: 3,
        kind: 'vad',
        generation: 1,
        status: 'running',
        completed: 1,
        total: 10
      }
    })
    state = editorReducer(state, {
      type: 'derived',
      projectId: project.id,
      revision: 3,
      records: []
    })
    expect(state.audioAnalysisRecords).toEqual([])
    expect(state.mediaIntelligenceOperations).toEqual([])
    expect(state.derivedRecords).toEqual([])
  })

  it('classifies protected interaction and keeps transcript seek frame-native', () => {
    const notice = classifyError(
      { code: 'INTERACTION_REQUIRED', message: 'Desktop interaction required', retryable: true },
      'failed'
    )
    expect(notice.interactionRequired).toBe(true)
    expect(notice.severity).toBe('warning')
    expect(transcriptFrame(makeViewProject(), { startUs: 1_000_000 })).toBe(30)
    const shifted = makeViewProject()
    shifted.items[0] = {
      ...shifted.items[0]!,
      timelineStartFrame: 30,
      sourceStartUs: 1_000_000,
      sourceEndUs: 3_000_000,
      durationFrames: 60
    }
    expect(activeTranscriptSegment(shifted, 'asset-1', 30)?.id).toBe('segment-2')
  })

  it('maps the composed playhead through trims and speed to the source player and captions', () => {
    const project = makeViewProject()
    project.items = [{
      ...project.items[0]!,
      timelineStartFrame: 60,
      durationFrames: 30,
      sourceStartUs: 1_000_000,
      sourceEndUs: 3_000_000,
      speed: { numerator: 2, denominator: 1 }
    }]
    project.captions = [{
      id: 'caption-active',
      trackId: 'captions-1',
      startFrame: 70,
      endFrame: 80,
      text: 'Mapped caption',
      placement: 'bottom'
    }]

    const source = timelineSourceAtFrame(project, 75)
    expect(source).toMatchObject({
      sourceTimeUs: 2_000_000,
      playbackRate: 2,
      item: { timelineStartFrame: 60 }
    })
    expect(projectFrameFromSourceTime(project, source!, 2)).toBe(75)
    expect(activeCaptionAtFrame(project, 75)?.text).toBe('Mapped caption')
    expect(activeCaptionAtFrame(project, 80)).toBeUndefined()
  })

  it('clears media, jobs, selections, script and Agent state when switching projects', () => {
    const first = makeViewProject()
    const second = { ...makeViewProject(), id: 'second-project', name: 'Second' }
    let state = editorReducer(INITIAL_EDITOR_STATE, { type: 'project', value: first })
    state = {
      ...state,
      selectedItemId: first.items[0]?.id,
      selectedAssetId: first.assets[0]?.id,
      activeMediaHandleId: first.assets[0]?.mediaHandleId,
      activeMediaUrl: 'kun-media://lease/first',
      script: { revision: 0, digest: 'digest', markdown: '# first', dirty: false },
      jobs: [makeJob('running')],
      agentRun: {
        id: 'run-1', threadId: 'thread-1', ownerExtensionId: 'kun-examples.kun-video-editor',
        ownerExtensionVersion: '0.1.0', extensionVisibility: 'private', extensionBudget: {},
        toolCatalogEpoch: 'epoch', state: 'running', createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z'
      }
    }
    state = editorReducer(state, { type: 'project', value: second })
    expect(state).toMatchObject({
      project: { id: 'second-project' },
      playheadFrame: 0,
      playing: false,
      media: {},
      leases: {},
      jobs: [],
      agentEvents: []
    })
    expect(state.activeMediaUrl).toBeUndefined()
    expect(state.selectedItemId).toBeUndefined()
    expect(state.script).toBeUndefined()
    expect(state.agentRun).toBeUndefined()
  })
})
