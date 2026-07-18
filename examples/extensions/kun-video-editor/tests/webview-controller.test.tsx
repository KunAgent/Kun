import type { ExtensionHostClient, HostMessage, JobEvent, JobSnapshot, JsonValue, Locale, Theme } from '@kun/extension-api'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { artifactUsesPlayer, useEditorController, type EditorController } from '../src/webview/controller.js'
import { formatMessage, messagesFor } from '../src/webview/i18n.js'
import { VIEW_LIMITS, type EditorNotice } from '../src/webview/model.js'
import { makeArtifact, makeJob, makeSubtitleArtifact, makeViewProject } from './webview-fixtures.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

let renderer: ReactTestRenderer | undefined

afterEach(async () => {
  if (renderer) await act(async () => renderer?.unmount())
  renderer = undefined
  vi.useRealTimers()
})

describe('video editor artifact controller integration', () => {
  it('loads bounded generation state and keeps retry authority free of persisted prompts and handles', async () => {
    const project = makeViewProject()
    const catalog = generationCatalogProjection()
    const record = generationRecordProjection(project.id, project.currentRevision)
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id,
        name: project.name,
        currentRevision: project.currentRevision,
        updatedAt: project.updatedAt,
        durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'generation.catalog') return { content: { outcome: 'available', catalog } }
      if (action === 'generation.list') return { content: { records: [record], recoveryDiagnostics: [] } }
      if (action === 'generation.request' || action === 'generation.retry') {
        return { content: { outcome: 'queued', record } }
      }
      if (action === 'generation.insert') return { content: { outcome: 'inserted', currentRevision: project.currentRevision + 1 } }
      if (action === 'render.list' || action === 'derived.list') return { content: { records: [] } }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
      await flushAsync()
    })

    expect(controller?.state.generation).toMatchObject({
      outcome: 'available',
      records: [{ id: record.id, promptDigest: record.promptDigest, state: 'failed' }]
    })
    expect(JSON.stringify(controller?.state.generation)).not.toMatch(/raw persisted prompt|generation_output_handle|authorization_/u)

    const consent = {
      providerPermissionApproved: true,
      mediaUploadApproved: true,
      costApproved: true,
      approvedMaximumMinor: 25,
      currency: 'USD',
      confirmedAt: '2026-07-14T01:00:00.000Z'
    }
    await act(async () => {
      await controller!.retryGeneration(record.id, consent)
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'generation.retry',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        recordId: record.id,
        consent
      }
    })
    const retryCall = executeCommand.mock.calls.find(([, args]) =>
      isRecord(args) && args.action === 'generation.retry'
    )
    expect(JSON.stringify(retryCall)).not.toMatch(/prompt|mediaHandle|outputHandle|authorization_/u)

    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.generation-progress',
        payload: { record: { ...record, prompt: 'raw persisted prompt' } }
      })
      await flushAsync()
    })
    expect(controller?.state.generation.records[0]?.generation).toBe(record.generation)
  })

  it('opens a derived waveform with an opaque Host lease and reuses the unexpired lease', async () => {
    const project = makeViewProject()
    const handleId = 'media_waveform_ready_0001'
    const openViewResource = vi.fn(async () => ({
      leaseId: 'lease_waveform_ready_0001',
      handleId,
      url: 'kun-media://lease/waveform-ready',
      mimeType: 'image/png',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id,
        name: project.name,
        currentRevision: project.currentRevision,
        updatedAt: project.updatedAt,
        durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'derived.list') return { content: {
        records: [{
          schemaVersion: 1,
          id: 'waveform-record-1',
          generation: 1,
          statusGeneration: 1,
          kind: 'waveform',
          projectId: project.id,
          assetId: project.assets[0]!.id,
          status: 'ready',
          priority: 'interactive',
          bytes: 512,
          pinned: false,
          attempt: 1,
          artifactHandleId: handleId,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:01.000Z'
        }]
      } }
      if (action === 'render.list') return { content: { records: [] } }
      return { content: {} }
    })
    const { client } = fakeClient({ executeCommand, openViewResource })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      await flushAsync()
      await flushAsync()
    })

    expect(controller?.state.derivedRecords[0]?.artifactHandleId).toBe(handleId)
    let firstUrl: string | undefined
    let secondUrl: string | undefined
    await act(async () => {
      firstUrl = await controller!.openDerivedResource!('waveform-record-1')
      secondUrl = await controller!.openDerivedResource!('waveform-record-1')
      await flushAsync()
    })
    expect(firstUrl).toBe('kun-media://lease/waveform-ready')
    expect(secondUrl).toBe('kun-media://lease/waveform-ready')
    expect(openViewResource).toHaveBeenCalledTimes(1)
    expect(openViewResource).toHaveBeenCalledWith({ handleId })
  })

  it('keeps player media on leases and routes subtitle open/reveal through the trusted Host action', async () => {
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: `lease_${handleId}`,
      handleId,
      url: `kun-media://lease/${handleId}`,
      mimeType: 'image/png',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const performArtifactAction = vi.fn(async () => ({ performed: true as const }))
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [] } }
      return { content: {} }
    })
    const { client } = fakeClient({ openViewResource, performArtifactAction, executeCommand })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await Promise.resolve()
      await Promise.resolve()
    })

    const proof = makeArtifact('job_12345678')
    const subtitle = makeSubtitleArtifact('job_12345678')
    expect(artifactUsesPlayer(proof)).toBe(true)
    expect(artifactUsesPlayer(subtitle)).toBe(false)

    await act(async () => controller!.openArtifact(proof))
    expect(openViewResource).toHaveBeenCalledWith({
      handleId: proof.mediaHandleId
    })
    expect(performArtifactAction).not.toHaveBeenCalled()

    await act(async () => controller!.openArtifact(subtitle))
    await act(async () => controller!.revealArtifact(subtitle))
    expect(performArtifactAction).toHaveBeenNthCalledWith(1, {
      artifactId: subtitle.artifactId,
      action: 'open'
    })
    expect(performArtifactAction).toHaveBeenNthCalledWith(2, {
      artifactId: subtitle.artifactId,
      action: 'reveal'
    })
    expect(openViewResource).toHaveBeenCalledTimes(1)
    expect(executeCommand).not.toHaveBeenCalledWith('reveal-artifact', expect.anything())
  })

  it('keeps Kun theme and locale when initialization fails and retries the full controller bootstrap', async () => {
    let resolveLocale!: (value: Locale) => void
    let recoveryEnabled = false
    const project = makeViewProject()
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') {
        if (!recoveryEnabled) {
          await Promise.resolve()
          throw new Error('Extension operation failed')
        }
        return { content: { projects: [{
          id: project.id,
          name: project.name,
          currentRevision: project.currentRevision,
          updatedAt: project.updatedAt,
          durationFrames: project.durationFrames
        }] } }
      }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      return { content: {} }
    })
    const getViewState = vi.fn(async () => undefined)
    const { client } = fakeClient({
      executeCommand,
      getViewState,
      getTheme: async () => lightTheme(),
      getLocale: () => new Promise<Locale>((resolve) => { resolveLocale = resolve })
    })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    expect(controller?.state.initialized).toBe(true)
    expect(controller?.state.connection).toBe('offline')
    expect(controller?.state.theme?.kind).toBe('light')
    expect(controller?.state.locale).toBeUndefined()
    expect(controller?.state.notices.at(-1)?.messageKey).toBe('editorInitializeFailed')

    await act(async () => {
      resolveLocale(zhLocale())
      await flushAsync()
    })

    expect(controller?.state.locale?.language).toBe('zh-CN')
    expect(localizedNotice(controller!.state.notices.at(-1)!, controller!.state.locale)).toBe('视频编辑器初始化失败。')

    recoveryEnabled = true
    await act(async () => {
      await controller!.retryInitialization()
      await flushAsync()
    })

    expect(getViewState).toHaveBeenCalledTimes(2)
    expect(controller?.state.connection).toBe('online')
    expect(controller?.state.project?.id).toBe(project.id)
    expect(controller?.state.notices.some(({ messageKey }) => messageKey === 'editorInitializeFailed')).toBe(false)
  })

  it('applies live Kun theme and language changes', async () => {
    const { client, emitTheme, emitLocale, emitMessage } = fakeClient()
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    expect(controller?.state.theme?.kind).toBe('dark')
    expect(controller?.state.locale?.language).toBe('en')

    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.command-progress',
        payload: { schemaVersion: 1, message: 'Submitting durable media job' }
      })
      await flushAsync()
    })

    expect(controller?.state.notices.at(-1)?.message).toBe('Submitting the media job…')

    await act(async () => {
      emitTheme(lightTheme())
      emitLocale(zhLocale())
      await flushAsync()
    })

    expect(controller?.state.theme?.kind).toBe('light')
    expect(controller?.state.locale?.language).toBe('zh-CN')
    expect(localizedNotice(controller!.state.notices.at(-1)!, controller!.state.locale)).toBe('正在提交媒体任务…')
  })

  it('persists the active workspace across a View reopen and rejects invalid persisted values', async () => {
    vi.useFakeTimers()
    let saved: JsonValue = {
      schemaVersion: 1,
      playheadFrame: 0,
      activeWorkspace: 'not-a-workspace',
      renderTickets: [],
      projectPackageTickets: [],
      transcriptWindowStart: 0
    }
    const getViewState = vi.fn(async () => saved)
    const setViewState = vi.fn(async (value: JsonValue) => { saved = value })
    const { client } = fakeClient({ getViewState, setViewState })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    expect(controller?.state.activeWorkspace).toBe('script')

    await act(async () => {
      controller!.setActiveWorkspace('output')
      await flushAsync()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200)
      await flushAsync()
    })
    expect(saved).toMatchObject({ schemaVersion: 1, activeWorkspace: 'output' })

    await act(async () => renderer?.unmount())
    renderer = undefined
    controller = undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    expect((controller as EditorController | undefined)?.state.activeWorkspace).toBe('output')
  })

  it('starts, persists, restores, refreshes, and cancels a revision-fenced project package without View-side handles', async () => {
    const project = makeViewProject()
    const packageProjection = {
      jobId: 'job_project_package_12345678',
      kind: 'media.archive',
      state: 'running',
      cursor: 'cursor_package_1',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      pinnedRevision: project.currentRevision,
      packageId: `pkg-${'a'.repeat(32)}`,
      manifestDigest: 'b'.repeat(64),
      complete: true,
      selectedAssetCount: 1,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      deduplicatedAssetCount: 0,
      missingAssetIds: [],
      missingMediaPolicy: 'fail'
    }
    let cancelled = false
    const runningJob = makeArchiveJob(packageProjection.jobId, 'running')
    const cancelledJob = { ...runningJob, state: 'cancelled' as const, latestCursor: 'cursor_package_2' }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list' || action === 'derived.list') return { content: { records: [] } }
      if (action === 'project-package.export') return { content: {
        outcome: 'queued', job: packageProjection
      } }
      if (action === 'project-package.status') return { content: {
        outcome: 'status', job: { ...packageProjection, state: cancelled ? 'cancelled' : 'running' }
      } }
      if (action === 'project-package.cancel') {
        cancelled = true
        return { content: {
          outcome: 'cancellation-requested', accepted: true,
          job: { ...packageProjection, state: 'cancelled', cursor: 'cursor_package_2' }
        } }
      }
      return { content: {} }
    })
    let saved: JsonValue | undefined
    const getViewState = vi.fn(async () => saved)
    const setViewState = vi.fn(async (value: JsonValue) => { saved = value })
    const getJob = vi.fn(async () => cancelled ? cancelledJob : runningJob)
    const pickSaveTarget = vi.fn()
    const subscribeJob = vi.fn(async () => ({
      snapshot: runningJob,
      replayGap: false,
      cursor: runningJob.latestCursor,
      complete: false,
      onEvent: () => ({ dispose: () => undefined }),
      dispose: () => undefined
    }))
    const { client } = fakeClient({
      executeCommand, getViewState, setViewState, getJob, subscribeJob, pickSaveTarget
    })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      await controller!.startProjectPackage({
        missingMediaPolicy: 'fail',
        includeReceipts: true,
        includeAgentProvenance: true,
        mediaScope: 'selected',
        assetIds: [project.assets[0]!.id]
      })
      await flushAsync()
    })

    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'project-package.export',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetIds: [project.assets[0]!.id],
        missingMediaPolicy: 'fail',
        includeReceipts: true,
        includeChatProvenance: true
      }
    })
    expect(pickSaveTarget).not.toHaveBeenCalled()
    expect(controller?.state.projectPackageTickets).toEqual([
      expect.objectContaining({
        jobId: packageProjection.jobId,
        projectId: project.id,
        pinnedRevision: project.currentRevision,
        mediaScope: 'selected',
        receiptsRequested: true,
        agentProvenanceRequested: true
      })
    ])
    expect(saved).toMatchObject({
      schemaVersion: 1,
      projectPackageTickets: [expect.objectContaining({
        jobId: packageProjection.jobId,
        manifestDigest: packageProjection.manifestDigest
      })]
    })
    expect(JSON.stringify(saved)).not.toMatch(/(?:outputHandleId|mediaHandleId|file:\/\/|\/Users\/|prompt|chatText)/u)

    await act(async () => {
      await controller!.refreshProjectPackage(packageProjection.jobId)
      await controller!.cancelProjectPackage(packageProjection.jobId)
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'project-package.status',
      payload: { projectId: project.id, jobId: packageProjection.jobId }
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'project-package.cancel',
      payload: { projectId: project.id, jobId: packageProjection.jobId }
    })
    expect(controller?.state.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: packageProjection.jobId, state: 'cancelled' })
    ]))

    await act(async () => renderer?.unmount())
    renderer = undefined
    controller = undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    expect((controller as EditorController | undefined)?.state.projectPackageTickets).toHaveLength(1)
    expect((controller as EditorController | undefined)?.state.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: packageProjection.jobId, state: 'cancelled' })
    ]))
    expect(executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'project-package.status'
    ).length).toBeGreaterThanOrEqual(2)
  })

  it('rejects a project-package response that is not pinned to the requested revision', async () => {
    const project = makeViewProject()
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'project-package.export') return { content: {
        outcome: 'queued',
        job: {
          jobId: 'job_wrong_revision_12345678', kind: 'media.archive', state: 'queued',
          projectId: project.id, sequenceId: project.activeSequenceId,
          pinnedRevision: project.currentRevision + 1,
          packageId: `pkg-${'c'.repeat(32)}`, manifestDigest: 'd'.repeat(64), complete: true,
          selectedAssetCount: 1, embeddedAssetCount: 1, uniqueMediaCount: 1,
          deduplicatedAssetCount: 0, missingAssetIds: [], missingMediaPolicy: 'fail'
        }
      } }
      return { content: {} }
    })
    const { client } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      await controller!.startProjectPackage({
        missingMediaPolicy: 'fail', includeReceipts: false,
        includeAgentProvenance: false, mediaScope: 'all'
      })
      await flushAsync()
    })
    expect(controller?.state.projectPackageTickets).toEqual([])
    expect(controller?.state.notices.at(-1)).toMatchObject({ severity: 'error' })
  })

  it('does not let delayed initial values overwrite newer Kun events', async () => {
    let resolveTheme!: (value: Theme) => void
    let resolveLocale!: (value: Locale) => void
    const { client, emitTheme, emitLocale } = fakeClient({
      getTheme: () => new Promise<Theme>((resolve) => { resolveTheme = resolve }),
      getLocale: () => new Promise<Locale>((resolve) => { resolveLocale = resolve })
    })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client,
        capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      emitTheme(lightTheme())
      emitLocale(zhLocale())
      resolveTheme(darkTheme())
      resolveLocale(enLocale())
      await flushAsync()
    })

    expect(controller?.state.theme?.kind).toBe('light')
    expect(controller?.state.locale?.language).toBe('zh-CN')
  })

  it('loads revision-fenced audio capabilities and folds bounded Host progress into the mounted sidebar state', async () => {
    const project = makeViewProject()
    const snapTargets = [
      ...Array.from({ length: 4_096 }, (_, index) => ({
        id: `beat-${index}`,
        frame: index * 12,
        kind: index % 4 === 0 ? 'downbeat' : 'beat',
        confidence: 0.9
      })),
      { id: 'ignored-after-bound', frame: -1, kind: 'bar', confidence: 2 }
    ]
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list' || action === 'derived.list') return { content: { records: [] } }
      if (action === 'preview.list') return { content: { history: { schemaVersion: 1, generation: 0, entries: [] } } }
      if (action === 'analysis.capabilities') return { content: {
        outcome: 'capabilities', projectId: project.id, currentRevision: project.currentRevision,
        capabilities: {
          schemaVersion: 1, probedAt: '2026-07-14T00:00:00.000Z',
          analyses: [
            { analysis: 'silence', available: true, algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0', local: true, networkUsed: false },
            { analysis: 'beat-grid', available: false, code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE', remediation: 'Unavailable.', retryable: false, local: true, networkUsed: false },
            { analysis: 'sync-features', available: true, algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0', local: true, networkUsed: false }
          ]
        },
        denoiseMetadata: {
          outcome: 'ready', local: true, networkUsed: false,
          descriptor: {
            adapterId: 'kun.fixture.denoise', adapterVersion: '1.0.0',
            algorithm: 'noise-profile', algorithmVersion: '1.0.0'
          }
        }
      } }
      if (action === 'analysis.list') return { content: {
        outcome: 'listed', projectId: project.id, currentRevision: project.currentRevision,
        records: [{
          schemaVersion: 1, id: 'analysis:vad:fixture', kind: 'vad', assetId: 'asset-1',
          completeness: 'complete', silenceCount: 1, safeSuggestionCount: 1,
          suggestionConfidenceThreshold: 0.82, currentGrant: true, immutable: true
        }, {
          schemaVersion: 1, id: 'analysis:beat-grid:fixture', kind: 'beat-grid', assetId: 'asset-1',
          completeness: 'complete', markerCount: 4_097, tempoBpm: 120,
          snapTargets, currentGrant: true, immutable: true
        }, {
          schemaVersion: 1, id: 'analysis:beat-grid:invalid', kind: 'beat-grid', assetId: 'asset-1',
          completeness: 'complete', markerCount: 1, tempoBpm: 120,
          snapTargets: [{ id: 'invalid-target', frame: 12, kind: 'beat', confidence: 1.1 }],
          currentGrant: true, immutable: true
        }, {
          schemaVersion: 1, id: 'analysis:denoise:fixture', kind: 'denoise-metadata', assetId: 'asset-1',
          completeness: 'complete', status: 'ready', confidence: 0.86, confidenceThreshold: 0.7,
          noiseProfile: {
            analyzedDurationUs: 2_000_000, sampleWindowCount: 20,
            levels: { noiseFloorDbfs: -54.5, averageRmsDbfs: -31, peakDbfs: -4, estimatedSnrDb: 23.5 },
            spectralBands: [{ id: 'speech', lowerFrequencyHz: 250, upperFrequencyHz: 4_000, noiseLevelDbfs: -57, confidence: 0.88 }]
          },
          recommendation: {
            reductionDb: 8.5, confidence: 0.86, disposition: 'preview-suggested',
            autoApplyAllowed: false, audioMutation: 'none'
          },
          metadataOnly: true, currentGrant: true, immutable: true
        }],
        operations: []
      } }
      if (action === 'analysis.evidence') return { content: {
        outcome: 'evidence', projectId: project.id, currentRevision: project.currentRevision,
        evidence: {
          schemaVersion: 1, recordId: 'analysis:vad:fixture', kind: 'vad',
          offset: 0, returned: 1, total: 1, completeness: 'complete',
          evidence: [{
            suggestionId: 'silence-cache', startUs: 100_000, endUs: 500_000,
            confidence: 1, disposition: 'safe-to-suggest'
          }]
        }
      } }
      if (action === 'analysis.vad') return { content: {
        outcome: 'ready', projectId: project.id, currentRevision: project.currentRevision,
        record: { id: 'analysis:vad:fixture' },
        evidence: {
          schemaVersion: 1, recordId: 'analysis:vad:fixture', kind: 'vad',
          offset: 0, returned: 1, total: 1, completeness: 'complete',
          evidence: [{ suggestionId: 'silence-1', startUs: 100_000, endUs: 500_000, confidence: 1, disposition: 'safe-to-suggest' }]
        }
      } }
      if (action === 'analysis.denoise-metadata') return { content: {
        outcome: 'ready', projectId: project.id, currentRevision: project.currentRevision,
        record: { id: 'analysis:denoise:fixture' },
        evidence: {
          schemaVersion: 1, recordId: 'analysis:denoise:fixture', kind: 'denoise-metadata',
          offset: 0, returned: 1, total: 1, completeness: 'complete',
          evidence: [{
            evidenceKind: 'noise-profile', noiseFloorDbfs: -54.5,
            recommendedReductionDb: 8.5, metadataOnly: true, audioMutation: 'none'
          }]
        }
      } }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => { await flushAsync() })

    expect(controller?.state.audioAnalysisCapabilities?.analyses).toEqual(expect.arrayContaining([
      expect.objectContaining({ analysis: 'silence', available: true, algorithm: 'ffmpeg.silencedetect' }),
      expect.objectContaining({ analysis: 'beat-grid', available: false })
    ]))
    expect(controller?.state.denoiseMetadataCapability).toMatchObject({
      outcome: 'ready', descriptor: { algorithm: 'noise-profile' }, local: true, networkUsed: false
    })
    expect(controller?.state.audioAnalysisRecords).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'analysis:vad:fixture', safeSuggestionCount: 1, currentGrant: true
      }),
      expect.objectContaining({
        id: 'analysis:beat-grid:fixture', markerCount: 4_097, tempoBpm: 120
      }),
      expect.objectContaining({
        id: 'analysis:denoise:fixture', status: 'ready', metadataOnly: true,
        noiseProfile: expect.objectContaining({ spectralBandCount: 1 }),
        recommendation: expect.objectContaining({ reductionDb: 8.5, audioMutation: 'none' })
      })
    ]))
    expect(controller?.state.audioAnalysisRecords).toHaveLength(3)
    expect(controller?.state.audioAnalysisRecords[1]?.snapTargets).toHaveLength(4_096)
    expect(controller?.state.audioAnalysisRecords[1]?.snapTargets?.[0]).toEqual({
      id: 'beat-0', frame: 0, kind: 'downbeat', confidence: 0.9
    })
    expect(controller?.state.audioAnalysisRecords[1]?.snapTargets?.at(-1)).toEqual({
      id: 'beat-4095', frame: 49_140, kind: 'beat', confidence: 0.9
    })
    expect(controller?.state.mediaIntelligenceEvidence).toMatchObject({
      recordId: 'analysis:vad:fixture',
      evidence: [expect.objectContaining({ suggestionId: 'silence-cache' })]
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'analysis.evidence',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        analysisId: 'analysis:vad:fixture',
        offset: 0,
        limit: 200
      }
    })

    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.media-intelligence-progress',
        payload: {
          schemaVersion: 1,
          operationId: 'media-analysis-fixture',
          projectId: project.id,
          projectRevision: project.currentRevision,
          kind: 'vad', generation: 3, status: 'running', completed: 50, total: 100
        }
      })
      await flushAsync()
    })
    expect(controller?.state.mediaIntelligenceOperations).toEqual([
      expect.objectContaining({ operationId: 'media-analysis-fixture', completed: 50, total: 100 })
    ])

    await act(async () => {
      await controller!.analyzeVad('asset-1')
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'analysis.vad',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId: 'asset-1'
      }
    })
    expect(controller?.state.mediaIntelligenceEvidence).toMatchObject({
      recordId: 'analysis:vad:fixture', evidence: [{ disposition: 'safe-to-suggest' }]
    })

    await act(async () => {
      await controller!.analyzeDenoiseMetadata('asset-1')
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'analysis.denoise-metadata',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId: 'asset-1',
        confidenceThreshold: 0.7
      }
    })
  })

  it('imports reviewed speaker evidence and keeps preview/apply as separate revision-bound actions', async () => {
    const project = makeViewProject()
    let imported = false
    const identity = {
      id: 'speaker-alice', label: 'Alice', aliases: ['Host'],
      sourceEvidenceIds: Array.from({ length: 65 }, (_, index) => `review-alice-${index}`),
      createdAt: '2026-07-14T00:00:00.000Z', updatedAt: '2026-07-14T00:00:00.000Z'
    }
    const record = {
      schemaVersion: 1, id: 'speaker:controller-fixture', kind: 'speaker-diarization',
      assetId: 'asset-1', completeness: 'complete', turnCount: 2, identifiedTurnCount: 1,
      uncertainTurnCount: 1, currentGrant: true, immutable: true
    }
    const evidence = {
      schemaVersion: 1, recordId: record.id, kind: 'speaker-diarization', offset: 0,
      returned: 2, total: 2, completeness: 'complete', evidence: [{
        id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified',
        speakerId: identity.id, speakerLabel: identity.label, confidence: 0.98, uncertain: false
      }, {
        id: 'turn-unknown', startUs: 1_000_000, endUs: 2_000_000, status: 'unknown',
        confidence: 0.4, uncertain: true, reason: 'unknown-speaker'
      }]
    }
    const plan = {
      schemaVersion: 1, analysisId: record.id, transcriptSegmentCount: 2, captionCount: 1,
      identifiedCount: 1, uncertainCount: 2, warnings: ['Unknown stays unlabelled.']
    }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list' || action === 'derived.list') return { content: { records: [] } }
      if (action === 'preview.list') return { content: { history: { schemaVersion: 1, generation: 0, entries: [] } } }
      if (action === 'analysis.capabilities') return { content: {
        outcome: 'capabilities', projectId: project.id, currentRevision: project.currentRevision,
        capabilities: {
          schemaVersion: 1, probedAt: '2026-07-14T00:00:00.000Z', analyses: [
            { analysis: 'silence', available: false, local: true, networkUsed: false },
            { analysis: 'beat-grid', available: false, local: true, networkUsed: false },
            { analysis: 'sync-features', available: false, local: true, networkUsed: false }
          ]
        },
        speakerAdapters: [{
          descriptor: { id: 'kun.imported-speaker-labels', version: '1.0.0', execution: 'import', format: 'kun-speaker-json-v1' },
          outcome: 'ready', local: true, networkUsed: false
        }, {
          descriptor: { id: 'kun.host.local-speaker', version: '1.0.0', execution: 'local-model', modelId: 'speaker-diarization', modelVersion: 'unavailable' },
          outcome: 'unavailable', code: 'speaker_inference_broker_unavailable', remediation: 'No verified broker.',
          local: true, networkUsed: false
        }],
        speakerIdentities: imported ? [identity] : []
      } }
      if (action === 'analysis.list') return { content: {
        outcome: 'listed', projectId: project.id, currentRevision: project.currentRevision,
        records: imported ? [record] : [], operations: []
      } }
      if (action === 'analysis.evidence') return { content: {
        outcome: 'evidence', projectId: project.id, currentRevision: project.currentRevision, evidence
      } }
      if (action === 'analysis.speaker-import') {
        imported = true
        return { content: {
          outcome: 'ready', projectId: project.id, currentRevision: project.currentRevision,
          operationId: 'speaker-import-op', deduplicated: false, record, evidence, identities: [identity]
        } }
      }
      if (action === 'analysis.speaker-preview') return { content: {
        outcome: 'preview', projectId: project.id, currentRevision: project.currentRevision, plan
      } }
      if (action === 'analysis.speaker-apply') return { content: {
        outcome: 'applied', projectId: project.id, previousRevision: 0, currentRevision: 1, plan
      } }
      return { content: {} }
    })
    const { client } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => { await flushAsync() })
    expect(controller?.state.speakerAdapters).toEqual(expect.arrayContaining([
      expect.objectContaining({ descriptor: expect.objectContaining({ execution: 'import' }), outcome: 'ready' }),
      expect.objectContaining({ descriptor: expect.objectContaining({ execution: 'local-model' }), outcome: 'unavailable' })
    ]))

    const reviewedDocument = JSON.stringify({
      schemaVersion: 1, adapterId: 'kun.imported-speaker-labels', identities: [identity],
      turns: [{ id: 'turn-alice', startUs: 0, endUs: 1_000_000, status: 'identified', speakerId: identity.id, confidence: 0.98 }]
    })
    await act(async () => {
      await controller!.importSpeakerEvidence('asset-1', reviewedDocument)
      await flushAsync()
    })
    expect(controller?.state.speakerIdentities).toEqual([expect.objectContaining({ id: identity.id, label: 'Alice' })])
    expect(controller?.state.mediaIntelligenceEvidence).toMatchObject({ recordId: record.id, kind: 'speaker-diarization' })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'analysis.speaker-import',
      payload: expect.objectContaining({
        projectId: project.id, expectedRevision: 0, assetId: 'asset-1',
        document: expect.objectContaining({ adapterId: 'kun.imported-speaker-labels' })
      })
    })

    await act(async () => controller!.previewSpeakerAttribution(record.id))
    expect(controller?.state.speakerAttributionPlan).toMatchObject({ analysisId: record.id, uncertainCount: 2 })
    await act(async () => {
      await controller!.applySpeakerAttribution(record.id)
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'analysis.speaker-apply',
      payload: { projectId: project.id, expectedRevision: 0, analysisId: record.id }
    })
    expect(controller?.state.notices).toEqual(expect.arrayContaining([
      expect.objectContaining({ messageKey: 'speakerAttributionApplied' })
    ]))
    expect(JSON.stringify(executeCommand.mock.calls)).not.toMatch(/\/Users\/|file:\/\//u)
  })

  it('imports a protected transcript as bounded UTF-8 and releases its source handle', async () => {
    const project = makeViewProject()
    const transcriptHandle = 'media_transcript_1234567890'
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'transcript.import') return { content: { outcome: 'transcribed', currentRevision: 1, details: { segmentCount: 1 } } }
      return { content: {} }
    })
    const pickFiles = vi.fn(async () => ({
      outcome: 'selected' as const,
      files: [{
        handleId: transcriptHandle, mode: 'read' as const, kind: 'subtitle' as const,
        displayName: 'interview.srt', mimeType: 'application/x-subrip', byteSize: 48
      }]
    }))
    const readText = vi.fn(async () => ({
      handleId: transcriptHandle,
      displayName: 'interview.srt',
      mimeType: 'application/x-subrip',
      content: '1\n00:00:00,000 --> 00:00:01,000\nHello\n',
      byteSize: 44
    }))
    const release = vi.fn(async () => ({ released: true }))
    const { client } = fakeClient({ executeCommand, pickFiles, readText, release })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      await controller!.importTranscript()
      await flushAsync()
    })

    expect(readText).toHaveBeenCalledWith({ handleId: transcriptHandle, maxBytes: 512 * 1024 })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'transcript.import',
      payload: expect.objectContaining({
        projectId: project.id,
        assetId: project.assets[0]!.id,
        format: 'srt',
        source: expect.stringContaining('Hello')
      })
    })
    expect(release).toHaveBeenCalledWith({ resource: 'handle', handleId: transcriptHandle })
  })

  it('keeps the revision unchanged and releases selected handles when media import is unavailable', async () => {
    const project = makeViewProject()
    const mediaHandle = 'media_unavailable_1234567890'
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'media.import-batch') {
        return { content: {
          outcome: 'unavailable',
          code: 'FFPROBE_UNAVAILABLE',
          currentRevision: project.currentRevision,
          changedIds: []
        } }
      }
      return { content: {} }
    })
    const pickFiles = vi.fn(async () => ({
      outcome: 'selected' as const,
      files: [{
        handleId: mediaHandle, mode: 'read' as const, kind: 'video' as const,
        displayName: 'interview.mp4', mimeType: 'video/mp4', byteSize: 1_024
      }]
    }))
    const release = vi.fn(async () => ({ released: true }))
    const { client } = fakeClient({ executeCommand, pickFiles, release })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    const projectReadsBeforeImport = executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'project.get'
    ).length

    await act(async () => {
      await controller!.importMedia()
      await flushAsync()
    })

    expect(release).toHaveBeenCalledWith({ resource: 'handle', handleId: mediaHandle })
    expect(controller?.state.project?.currentRevision).toBe(project.currentRevision)
    expect(controller?.state.notices.at(-1)).toMatchObject({
      severity: 'warning',
      messageKey: 'ffprobeUnavailable'
    })
    expect(executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'project.get'
    )).toHaveLength(projectReadsBeforeImport + 1)
  })

  it('keeps a failed multi-file import atomic and releases every unbound picker handle', async () => {
    const project = makeViewProject()
    const firstHandle = 'media_batch_first_1234567890'
    const secondHandle = 'media_batch_second_123456789'
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'media.import-batch') throw new Error('The second media file could not be probed')
      return { content: {} }
    })
    const pickFiles = vi.fn(async () => ({
      outcome: 'selected' as const,
      files: [firstHandle, secondHandle].map((handleId, index) => ({
        handleId, mode: 'read' as const, kind: 'video' as const,
        displayName: `${index + 1}.mp4`, mimeType: 'video/mp4', byteSize: 1_024
      }))
    }))
    const release = vi.fn(async () => ({ released: true }))
    const { client } = fakeClient({ executeCommand, pickFiles, release })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.importMedia()
      await flushAsync()
    })

    expect(controller?.state.project?.currentRevision).toBe(0)
    expect(executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'media.import-batch'
    )).toHaveLength(1)
    expect(executeCommand.mock.calls.find(([, args]) =>
      isRecord(args) && args.action === 'media.import-batch'
    )?.[1]).toMatchObject({
      payload: {
        projectId: project.id,
        expectedRevision: 0,
        items: [{ mediaHandleId: firstHandle }, { mediaHandleId: secondHandle }]
      }
    })
    expect(release).toHaveBeenCalledWith({ resource: 'handle', handleId: firstHandle })
    expect(release).toHaveBeenCalledWith({ resource: 'handle', handleId: secondHandle })
    expect(controller?.state.notices).not.toContainEqual(expect.objectContaining({
      messageKey: 'mediaImportPartial'
    }))
  })

  it('tracks durable OTIO export and enforces picker-preview-confirm import without persisting grants', async () => {
    const project = makeViewProject()
    const importedProject = { ...makeViewProject(), id: 'imported-cut', name: 'Imported cut', currentRevision: 2 }
    const lossManifest = {
      adapterId: 'kun.otio-json', adapterVersion: '1.0.0',
      portableLossless: false, kunRoundTripLossless: true,
      entries: [{
        code: 'effects-custom-metadata', severity: 'warning', feature: 'effects',
        nodeId: 'item-interview', preservation: 'kun-metadata',
        message: 'Effect parameters use Kun metadata.'
      }],
      truncated: 0
    }
    const projection = {
      jobId: 'job_otio_export_12345678',
      kind: 'media.ffmpeg',
      state: 'running',
      cursor: 'cursor_otio_1',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      pinnedRevision: project.currentRevision,
      currentRevision: project.currentRevision,
      stale: false,
      adapterId: 'kun.otio-json',
      adapterVersion: '1.0.0',
      documentDigest: 'a'.repeat(64),
      projectDigest: 'b'.repeat(64),
      documentBytes: 4096,
      lossManifest
    }
    const runningJob = { ...makeJob('running'), id: projection.jobId }
    const cancelledJob = {
      ...runningJob,
      state: 'cancelled' as const,
      latestCursor: 'cursor_otio_2',
      terminalAt: '2026-01-01T00:02:00.000Z'
    }
    let cancelled = false
    let imported = false
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      const payload = isRecord(request.payload) ? request.payload : {}
      if (action === 'project.list') {
        const projects = [project, ...(imported ? [importedProject] : [])]
        return { content: { projects: projects.map((entry) => ({
          id: entry.id, name: entry.name, currentRevision: entry.currentRevision,
          updatedAt: entry.updatedAt, durationFrames: entry.durationFrames
        })) } }
      }
      if (action === 'project.active') return { content: { project } }
      if (action === 'project.get') {
        return { content: { project: payload.projectId === importedProject.id ? importedProject : project } }
      }
      if (action === 'render.list' || action === 'derived.list') return { content: { records: [] } }
      if (action === 'interchange.export') return { content: { outcome: 'queued', job: projection } }
      if (action === 'interchange.status') return { content: {
        outcome: cancelled ? 'cancelled' : 'running',
        technicallyValidated: false,
        job: { ...projection, state: cancelled ? 'cancelled' : 'running' }
      } }
      if (action === 'interchange.cancel') {
        cancelled = true
        return { content: { outcome: 'cancelled', technicallyValidated: false, job: {
          ...projection, state: 'cancelled', cursor: 'cursor_otio_2'
        } } }
      }
      if (action === 'interchange.import-preview') return { content: {
        outcome: 'interchange-import-preview',
        inputHandleId: payload.inputHandleId,
        displayName: 'external-cut.otio',
        adapterId: 'kun.otio-json', adapterVersion: '1.0.0',
        sourceDocumentDigest: 'c'.repeat(64),
        sourceProjectId: 'external-cut', sourceProjectRevision: 1,
        suggestedProjectId: importedProject.id,
        fidelity: 'portable-otio',
        project: {
          id: 'external-cut', name: 'External cut', schemaVersion: 2, revision: 1,
          activeSequenceId: 'sequence-main', fps: { numerator: 30, denominator: 1 },
          canvas: project.canvas,
          counts: { assets: 1, sequences: 1, tracks: 3, items: 1, captions: 0, transcripts: 0 }
        },
        mediaRelinkRequired: ['external-asset'],
        timecodeMappings: [{
          id: 'external-item', sequenceId: 'sequence-main', startFrame: 0, endFrame: 30,
          startTimecode: '00:00:00:00', endTimecode: '00:00:01:00',
          frameRate: { numerator: 30, denominator: 1 }
        }],
        timecodeMappingsTruncated: 0,
        lossManifest: { ...lossManifest, kunRoundTripLossless: false },
        persisted: false, confirmationRequired: true
      } }
      if (action === 'interchange.import') {
        imported = true
        return { content: {
          outcome: 'interchange-imported', persisted: true, overwritten: false,
          project: importedProject
        } }
      }
      return { content: {} }
    })
    let saved: JsonValue | undefined
    const setViewState = vi.fn(async (value: JsonValue) => { saved = value })
    const getJob = vi.fn(async () => cancelled ? cancelledJob : runningJob)
    const pickFiles = vi.fn(async () => ({
      outcome: 'selected' as const,
      files: [{
        handleId: 'opaque_otio_input_000001', mode: 'read' as const, kind: 'data' as const,
        displayName: 'external-cut.otio', mimeType: 'application/x-otio+json', byteSize: 2048
      }]
    }))
    const release = vi.fn(async () => ({ released: true }))
    const subscribeJob = vi.fn(async () => ({
      snapshot: cancelled ? cancelledJob : runningJob,
      replayGap: false,
      cursor: runningJob.latestCursor,
      complete: cancelled,
      onEvent: () => ({ dispose: () => undefined }),
      dispose: () => undefined
    }))
    const { client } = fakeClient({
      executeCommand, setViewState, getJob, pickFiles, release, subscribeJob
    })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.startOtioExport()
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'interchange.export',
      payload: { projectId: project.id, expectedRevision: project.currentRevision }
    })
    expect(controller?.state.otioExportTickets).toEqual([
      expect.objectContaining({ jobId: projection.jobId, documentDigest: projection.documentDigest })
    ])
    expect(saved).toMatchObject({
      otioExportTickets: [expect.objectContaining({ jobId: projection.jobId })]
    })
    expect(JSON.stringify(saved)).not.toMatch(/(?:inputHandleId|outputHandleId|file:\/\/|\/Users\/)/u)

    await act(async () => {
      await controller!.refreshOtioExport(projection.jobId)
      await controller!.cancelOtioExport(projection.jobId)
      await flushAsync()
    })
    expect(controller?.state.jobs).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: projection.jobId, state: 'cancelled' })
    ]))

    await act(async () => {
      await controller!.previewOtioImport()
      await flushAsync()
    })
    expect(controller?.state.otioImportPreview).toMatchObject({
      inputHandleId: 'opaque_otio_input_000001',
      suggestedProjectId: importedProject.id,
      fidelity: 'portable-otio',
      lossManifest: { kunRoundTripLossless: false }
    })
    expect(JSON.stringify(saved)).not.toContain('opaque_otio_input_000001')
    expect(release).not.toHaveBeenCalledWith({
      resource: 'handle', handleId: 'opaque_otio_input_000001'
    })

    await act(async () => {
      await controller!.confirmOtioImport(importedProject.id)
      await flushAsync()
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'interchange.import',
      payload: {
        inputHandleId: 'opaque_otio_input_000001',
        expectedDocumentDigest: 'c'.repeat(64),
        expectedSourceProjectId: 'external-cut',
        expectedSourceRevision: 1,
        targetProjectId: importedProject.id
      }
    })
    expect(controller?.state.otioImportPreview).toBeUndefined()
    expect(controller?.state.project?.id).toBe(importedProject.id)
    expect(release).toHaveBeenCalledWith({
      resource: 'handle', handleId: 'opaque_otio_input_000001'
    })

    release.mockClear()
    await act(async () => {
      await controller!.previewOtioImport()
      await controller!.cancelOtioImportPreview()
      await flushAsync()
    })
    expect(controller?.state.otioImportPreview).toBeUndefined()
    expect(release).toHaveBeenCalledWith({
      resource: 'handle', handleId: 'opaque_otio_input_000001'
    })
  })

  it('loads a revision-bound Host media page beyond asset 100 and opens its opaque resource', async () => {
    const project = makeViewProject()
    project.mediaFolders = [{ id: 'folder-archive', name: 'Archive' }]
    project.assets = Array.from({ length: 100 }, (_, index) => ({
      ...project.assets[0]!,
      id: `asset-${String(index).padStart(4, '0')}`,
      name: `asset-${String(index).padStart(4, '0')}.mp4`,
      mediaHandleId: `media_page_${String(index).padStart(4, '0')}_000000`,
      folderId: 'folder-archive'
    }))
    project.truncated = true
    const pageAssets = Array.from({ length: 21 }, (_, pageIndex) => {
      const index = pageIndex + 80
      return {
        ...project.assets[0]!,
        id: `asset-${String(index).padStart(4, '0')}`,
        name: `asset-${String(index).padStart(4, '0')}.mp4`,
        mediaHandleId: `media_page_${String(index).padStart(4, '0')}_000000`,
        folderId: 'folder-archive',
        ...(index === 100 ? {
          generatedLineage: {
            providerId: 'fixture-provider', modelId: 'fixture-model', jobId: 'job-0100',
            referenceAssetIds: ['asset-0000']
          }
        } : {})
      }
    })
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      if (request.action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (request.action === 'project.active' || request.action === 'project.get') {
        return { content: { project } }
      }
      if (request.action === 'media.list') return { content: {
        outcome: 'media-library', projectId: project.id, revision: project.currentRevision,
        page: {
          assets: pageAssets, offset: 80, limit: 80, total: 101,
          hiddenBefore: 80, hiddenAfter: 0
        }
      } }
      if (request.action === 'render.list') return { content: { records: [] } }
      return { content: {} }
    })
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: 'lease_media_page_0100_0000', handleId,
      url: 'kun-media://lease/media-page-0100', mimeType: 'video/mp4',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const { client } = fakeClient({ executeCommand, openViewResource })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.loadMediaLibraryPage({
        folderId: 'folder-archive', query: 'asset', offset: 80, limit: 80
      })
      await flushAsync()
    })
    expect(controller?.state.mediaLibrary).toMatchObject({
      projectId: project.id, revision: project.currentRevision,
      folderId: 'folder-archive', query: 'asset', offset: 80, limit: 80,
      total: 101, hiddenBefore: 80, hiddenAfter: 0
    })
    expect(controller?.state.mediaLibrary?.assets).toHaveLength(21)
    expect(controller?.state.mediaLibrary?.assets.at(-1)).toMatchObject({
      id: 'asset-0100', folderId: 'folder-archive',
      generatedLineage: { jobId: 'job-0100', referenceAssetIds: ['asset-0000'] }
    })
    expect(executeCommand).toHaveBeenCalledWith('editor-request', {
      action: 'media.list',
      payload: {
        projectId: project.id, expectedRevision: project.currentRevision,
        folderId: 'folder-archive', query: 'asset', offset: 80, limit: 80
      }
    })

    await act(async () => {
      await controller!.openAsset('asset-0100')
      await flushAsync()
    })
    expect(openViewResource).toHaveBeenCalledWith({ handleId: 'media_page_0100_000000' })
    expect(controller?.state.selectedAssetId).toBe('asset-0100')
  })

  it('silently drops stale media-library success and failure across project, revision, and request generations', async () => {
    const projectA = makeViewProject()
    const projectB = {
      ...structuredClone(projectA),
      id: 'video-project-b',
      name: 'Project B',
      playback: { ...projectA.playback, projectId: 'video-project-b' }
    }
    let currentProject = projectA
    const mediaRequests: Array<{
      resolve(value: unknown): void
      reject(error: unknown): void
    }> = []
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      if (request.action === 'project.list') return { content: { projects: [{
        id: projectA.id,
        name: projectA.name,
        currentRevision: projectA.currentRevision,
        updatedAt: projectA.updatedAt,
        durationFrames: projectA.durationFrames
      }] } }
      if (request.action === 'project.active' || request.action === 'project.get') {
        return { content: { project: currentProject } }
      }
      if (request.action === 'media.list') {
        return await new Promise((resolve, reject) => mediaRequests.push({ resolve, reject }))
      }
      if (request.action === 'render.list') return { content: { records: [] } }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    const response = (project: typeof projectA, name: string) => ({ content: {
      outcome: 'media-library',
      projectId: project.id,
      revision: project.currentRevision,
      page: {
        assets: [{ ...project.assets[0]!, name }],
        offset: 0,
        limit: VIEW_LIMITS.virtualWindow,
        total: 1,
        hiddenBefore: 0,
        hiddenAfter: 0
      }
    } })
    const startMediaRequest = (): Promise<void> => controller!.loadMediaLibraryPage({
      offset: 0,
      limit: VIEW_LIMITS.virtualWindow
    })

    const oldProjectRequest = startMediaRequest()
    expect(mediaRequests).toHaveLength(1)
    currentProject = projectB
    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.project-changed',
        payload: {
          schemaVersion: 1,
          projectId: projectB.id,
          revision: projectB.currentRevision,
          reason: 'active-project-changed',
          changedIds: []
        }
      })
      await flushAsync()
    })
    expect(controller?.state.project?.id).toBe(projectB.id)
    await act(async () => {
      mediaRequests[0]!.resolve(response(projectA, 'stale-project.mp4'))
      await oldProjectRequest
      await flushAsync()
    })
    expect(controller?.state.mediaLibrary).toBeUndefined()

    const oldRevisionRequest = startMediaRequest()
    expect(mediaRequests).toHaveLength(2)
    currentProject = {
      ...currentProject,
      currentRevision: currentProject.currentRevision + 1,
      eventGeneration: currentProject.eventGeneration + 1,
      selection: {
        ...currentProject.selection,
        revision: currentProject.currentRevision + 1
      },
      playback: {
        ...currentProject.playback,
        revision: currentProject.currentRevision + 1
      }
    }
    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.project-changed',
        payload: {
          schemaVersion: 1,
          projectId: currentProject.id,
          revision: currentProject.currentRevision,
          reason: 'timeline-updated',
          changedIds: []
        }
      })
      await flushAsync()
    })
    expect(controller?.state.project?.currentRevision).toBe(currentProject.currentRevision)
    await act(async () => {
      mediaRequests[1]!.reject(new Error('stale revision failed'))
      await oldRevisionRequest
      await flushAsync()
    })
    expect(controller?.state.notices.some(({ id }) => id === 'media-library-load-failed')).toBe(false)

    const oldGenerationRequest = startMediaRequest()
    const currentGenerationRequest = startMediaRequest()
    expect(mediaRequests).toHaveLength(4)
    await act(async () => {
      mediaRequests[2]!.reject(new Error('stale generation failed'))
      await oldGenerationRequest
      mediaRequests[3]!.resolve(response(currentProject, 'authoritative-page.mp4'))
      await currentGenerationRequest
      await flushAsync()
    })
    expect(controller?.state.notices.some(({ id }) => id === 'media-library-load-failed')).toBe(false)
    expect(controller?.state.mediaLibrary?.assets[0]?.name).toBe('authoritative-page.mp4')

    const currentFailure = startMediaRequest()
    expect(mediaRequests).toHaveLength(5)
    await act(async () => {
      mediaRequests[4]!.reject(new Error('current request failed'))
      await currentFailure
      await flushAsync()
    })
    expect(controller?.state.notices.at(-1)).toMatchObject({
      id: 'media-library-load-failed',
      message: 'current request failed',
      severity: 'error'
    })
  })

  it('refreshes timeline markdown against the committed revision after applying a range', async () => {
    let project = makeViewProject()
    const scriptReadRevisions: number[] = []
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      const payload = isRecord(request.payload) ? request.payload : {}
      if (action === 'project.list') {
        return { content: { projects: [{
          id: project.id,
          name: project.name,
          currentRevision: project.currentRevision,
          updatedAt: project.updatedAt,
          durationFrames: project.durationFrames
        }] } }
      }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'script.read') {
        const expectedRevision = Number(payload.expectedRevision)
        scriptReadRevisions.push(expectedRevision)
        if (expectedRevision !== project.currentRevision) throw new Error('REVISION_CONFLICT')
        return {
          content: {
            currentRevision: project.currentRevision,
            digest: `digest-r${project.currentRevision}`,
            timelineMarkdown: `# Timeline r${project.currentRevision}`
          }
        }
      }
      if (action === 'script.apply') {
        expect(payload.expectedRevision).toBe(project.currentRevision)
        project = { ...project, currentRevision: project.currentRevision + 1 }
        return { content: { currentRevision: project.currentRevision } }
      }
      return { content: {} }
    })
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: `lease_${handleId}`,
      handleId,
      url: `kun-media://lease/${handleId}`,
      mimeType: 'video/mp4',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const { client } = fakeClient({ executeCommand, openViewResource })
    let controller: EditorController | undefined

    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    const segment = project.transcripts[0]!.segments[1]!
    await act(async () => {
      await controller!.applyScript([{
        assetId: project.assets[0]!.id,
        startUs: segment.startUs,
        endUs: segment.endUs,
        reason: 'filler'
      }])
      await flushAsync()
    })

    expect(scriptReadRevisions).toEqual([0, 1])
    expect(controller?.state.project?.currentRevision).toBe(1)
    expect(controller?.state.script).toMatchObject({
      revision: 1,
      digest: 'digest-r1',
      markdown: '# Timeline r1'
    })
    expect(controller?.state.notices.filter(({ severity }) => severity === 'error')).toEqual([])
  })

  it('releases selected export handles when the Host reports a normal capability failure', async () => {
    const project = makeViewProject()
    const outputHandle = 'media_export_unavailable_1234'
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'render.start') {
        return { content: {
          outcome: 'unavailable',
          code: 'ADVANCED_EFFECT_UNSUPPORTED',
          currentRevision: project.currentRevision,
          changedIds: [],
          unsupportedNodes: [{
            nodeId: 'item-interview:effect-blur',
            nodeType: 'effect',
            capability: 'filter:boxblur',
            message: 'Blur is unavailable on the selected backend.',
            guidance: 'Install an FFmpeg build with boxblur or disable this effect.'
          }]
        } }
      }
      return { content: {} }
    })
    const pickSaveTarget = vi.fn(async () => ({
      outcome: 'selected' as const,
      target: {
        handleId: outputHandle, mode: 'write' as const, kind: 'video' as const,
        displayName: 'output.mp4', mimeType: 'video/mp4', byteSize: 0
      }
    }))
    const release = vi.fn(async () => ({ released: true }))
    const { client } = fakeClient({ executeCommand, pickSaveTarget, release })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.startRender('h264-mp4', 'none')
      await flushAsync()
    })

    expect(release).toHaveBeenCalledWith({ resource: 'handle', handleId: outputHandle })
    expect(controller?.state.renderTickets).toEqual([])
    expect(controller?.state.notices.at(-1)).toMatchObject({
      severity: 'warning',
      messageKey: 'mediaCapabilitiesUnavailable',
      capabilityDetails: [{
        nodeId: 'item-interview:effect-blur',
        nodeType: 'effect',
        capability: 'filter:boxblur',
        message: 'Blur is unavailable on the selected backend.',
        guidance: 'Install an FFmpeg build with boxblur or disable this effect.'
      }]
    })
  })

  it('reconciles a completed durable job when its live terminal event is missed', async () => {
    const project = makeViewProject()
    const runningJob = makeJob('running')
    const completedJob = {
      ...makeJob('completed'),
      updatedAt: '2026-01-01T00:02:00.000Z',
      terminalAt: '2026-01-01T00:02:00.000Z',
      latestCursor: 'cursor_2',
      result: { schemaVersion: 1 as const, generatedArtifacts: [] }
    }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'render.start') {
        return { content: {
          outcome: 'queued',
          jobId: runningJob.id,
          pinnedRevision: project.currentRevision,
          renderKind: 'h264-mp4'
        } }
      }
      return { content: {} }
    })
    const getJob = vi.fn()
      .mockResolvedValueOnce(runningJob)
      .mockResolvedValue(completedJob)
    const subscribeJob = vi.fn(async () => ({
      snapshot: runningJob,
      replayGap: false,
      cursor: runningJob.latestCursor,
      complete: false,
      onEvent: () => ({ dispose: () => undefined }),
      dispose: () => undefined
    }))
    const pickSaveTarget = vi.fn(async () => ({
      outcome: 'selected' as const,
      target: {
        handleId: 'media_export_reconcile_1234', mode: 'write' as const, kind: 'video' as const,
        displayName: 'output.mp4', mimeType: 'video/mp4', byteSize: 0
      }
    }))
    const { client } = fakeClient({ executeCommand, getJob, subscribeJob, pickSaveTarget })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    vi.useFakeTimers()
    await act(async () => {
      await controller!.startRender('h264-mp4', 'none')
      await flushAsync()
    })
    expect(controller?.state.jobs).toMatchObject([{ id: runningJob.id, state: 'running' }])

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
      await flushAsync()
    })

    expect(subscribeJob).toHaveBeenCalledWith({
      jobId: runningJob.id,
      afterCursor: runningJob.latestCursor
    })
    expect(getJob).toHaveBeenCalledTimes(2)
    expect(controller?.state.jobs).toMatchObject([{ id: completedJob.id, state: 'completed' }])
  })

  it('registers replay delivery before reading the subscription snapshot', async () => {
    const project = makeViewProject()
    const runningJob = makeJob('running')
    const completedJob = {
      ...makeJob('completed'),
      updatedAt: '2026-01-01T00:02:00.000Z',
      terminalAt: '2026-01-01T00:02:00.000Z',
      latestCursor: 'cursor_2',
      result: { schemaVersion: 1 as const, generatedArtifacts: [] }
    }
    const terminalEvent: JobEvent = {
      schemaVersion: 1,
      jobId: runningJob.id,
      kind: runningJob.kind,
      type: 'completed',
      state: 'completed',
      timestamp: completedJob.updatedAt,
      executionAttempt: completedJob.executionAttempt,
      sequence: 2,
      cursor: completedJob.latestCursor,
      result: completedJob.result
    }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'render.start') {
        return { content: {
          outcome: 'queued', jobId: runningJob.id,
          pinnedRevision: project.currentRevision, renderKind: 'h264-mp4'
        } }
      }
      return { content: {} }
    })
    const accessOrder: string[] = []
    let replaySnapshot = runningJob
    const subscribeJob = vi.fn(async () => ({
      get snapshot() {
        accessOrder.push('snapshot')
        return replaySnapshot
      },
      replayGap: false,
      cursor: runningJob.latestCursor,
      complete: false,
      onEvent: (listener: (event: JobEvent) => void) => {
        accessOrder.push('onEvent')
        replaySnapshot = completedJob
        listener(terminalEvent)
        return { dispose: () => undefined }
      },
      dispose: () => undefined
    }))
    const pickSaveTarget = vi.fn(async () => ({
      outcome: 'selected' as const,
      target: {
        handleId: 'media_export_replay_123456', mode: 'write' as const, kind: 'video' as const,
        displayName: 'output.mp4', mimeType: 'video/mp4', byteSize: 0
      }
    }))
    const { client } = fakeClient({
      executeCommand,
      getJob: vi.fn(async () => runningJob),
      subscribeJob,
      pickSaveTarget
    })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.startRender('h264-mp4', 'none')
      await flushAsync()
    })

    expect(accessOrder.slice(0, 2)).toEqual(['onEvent', 'snapshot'])
    expect(controller?.state.jobs).toMatchObject([{ id: completedJob.id, state: 'completed' }])
  })

  it('does not let a late status read regress a live terminal job event', async () => {
    const project = makeViewProject()
    const runningJob = makeJob('running')
    const staleRunningJob = {
      ...runningJob,
      updatedAt: '2026-01-01T00:03:00.000Z',
      latestCursor: 'cursor_stale'
    }
    const completedJob = {
      ...makeJob('completed'),
      updatedAt: '2026-01-01T00:02:00.000Z',
      terminalAt: '2026-01-01T00:02:00.000Z',
      latestCursor: 'cursor_terminal',
      result: { schemaVersion: 1 as const, generatedArtifacts: [] }
    }
    const terminalEvent: JobEvent = {
      schemaVersion: 1,
      jobId: runningJob.id,
      kind: runningJob.kind,
      type: 'completed',
      state: 'completed',
      timestamp: completedJob.updatedAt,
      executionAttempt: completedJob.executionAttempt,
      sequence: 2,
      cursor: completedJob.latestCursor,
      result: completedJob.result
    }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id, name: project.name, currentRevision: project.currentRevision,
        updatedAt: project.updatedAt, durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'render.start') {
        return { content: {
          outcome: 'queued', jobId: runningJob.id,
          pinnedRevision: project.currentRevision, renderKind: 'h264-mp4'
        } }
      }
      return { content: {} }
    })
    let resolveLateRead!: (snapshot: typeof staleRunningJob) => void
    const lateRead = new Promise<typeof staleRunningJob>((resolve) => { resolveLateRead = resolve })
    const getJob = vi.fn()
      .mockResolvedValueOnce(runningJob)
      .mockImplementationOnce(async () => await lateRead)
      .mockResolvedValue(completedJob)
    let deliverJobEvent: ((event: JobEvent) => void) | undefined
    const subscribeJob = vi.fn(async () => ({
      snapshot: runningJob,
      replayGap: false,
      cursor: runningJob.latestCursor,
      complete: false,
      onEvent: (listener: (event: JobEvent) => void) => {
        deliverJobEvent = listener
        return { dispose: () => undefined }
      },
      dispose: () => undefined
    }))
    const pickSaveTarget = vi.fn(async () => ({
      outcome: 'selected' as const,
      target: {
        handleId: 'media_export_interleave_1234', mode: 'write' as const, kind: 'video' as const,
        displayName: 'output.mp4', mimeType: 'video/mp4', byteSize: 0
      }
    }))
    const { client } = fakeClient({ executeCommand, getJob, subscribeJob, pickSaveTarget })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    vi.useFakeTimers()
    await act(async () => {
      await controller!.startRender('h264-mp4', 'none')
      await flushAsync()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_000)
      await flushAsync()
    })
    expect(getJob).toHaveBeenCalledTimes(2)
    expect(deliverJobEvent).toBeTypeOf('function')

    await act(async () => {
      deliverJobEvent!(terminalEvent)
      resolveLateRead(staleRunningJob)
      await flushAsync()
    })

    expect(controller?.state.jobs).toMatchObject([{ id: completedJob.id, state: 'completed' }])
  })

  it('opens result-preview media from the Host message without loading the full project editor', async () => {
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: `lease_${handleId}`,
      handleId,
      url: `kun-media://lease/${handleId}`,
      mimeType: 'video/mp4',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const { client, emitMessage } = fakeClient({ openViewResource })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      emitMessage({
        channel: 'kun.resultPreview.open',
        payload: {
          schemaVersion: 1, threadId: 'thread-1', turnId: 'turn-1',
          result: {
            sourceId: 'artifact-source', mimeType: 'video/mp4',
            mediaHandleId: 'media_preview_1234567890', availability: 'available'
          }
        }
      })
      await flushAsync()
    })
    expect(controller?.state.resultPreview?.result.sourceId).toBe('artifact-source')
    expect(openViewResource).toHaveBeenCalledWith({ handleId: 'media_preview_1234567890' })
    expect(controller?.state.activeMediaUrl).toContain('kun-media://lease/')
  })

  it('delegates rich caption generation to one revision-bound Host transaction', async () => {
    const project = makeViewProject()
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const action = isRecord(args) ? args.action : undefined
      if (action === 'project.list') return { content: { projects: [{
        id: project.id,
        name: project.name,
        currentRevision: project.currentRevision,
        updatedAt: project.updatedAt,
        durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'caption.generate') return { content: {
        outcome: 'generated',
        currentRevision: project.currentRevision + 1,
        generatedCount: 3
      } }
      return { content: {} }
    })
    const { client } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      await controller!.generateCaptions()
      await flushAsync()
    })

    const request = executeCommand.mock.calls.find(([, args]) =>
      isRecord(args) && args.action === 'caption.generate'
    )?.[1]
    expect(request).toMatchObject({
      action: 'caption.generate',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        assetId: project.assets[0]!.id,
        trackId: 'captions-1',
        placement: 'bottom',
        style: { fontSize: 42, maxWidthRatio: 0.84 },
        animation: { kind: 'none' }
      }
    })
    expect(executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'project.update'
    )).toHaveLength(0)
    expect(controller?.state.notices.at(-1)).toMatchObject({
      severity: 'info',
      messageKey: 'generatedCaptions',
      messageValues: { count: 3 }
    })
  })

  it('debounces bounded selection context updates and ignores an older selection event', async () => {
    vi.useFakeTimers()
    const project = makeViewProject()
    let selectionGeneration = project.selection.generation
    let eventGeneration = project.eventGeneration
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      const payload = isRecord(request.payload) ? request.payload : {}
      if (action === 'project.list') {
        return { content: { projects: [{
          id: project.id,
          name: project.name,
          currentRevision: project.currentRevision,
          updatedAt: project.updatedAt,
          durationFrames: project.durationFrames
        }] } }
      }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'context.update') {
        selectionGeneration += 1
        eventGeneration += 1
        const range = isRecord(payload.range)
          ? { startFrame: Number(payload.range.startFrame), endFrame: Number(payload.range.endFrame) }
          : undefined
        const selection = {
          sequenceId: String(payload.sequenceId),
          revision: project.currentRevision,
          generation: selectionGeneration,
          playheadFrame: Number(payload.playheadFrame),
          selectedAssetIds: payload.selectedAssetIds as string[],
          selectedItemIds: payload.selectedItemIds as string[],
          selectedCaptionIds: payload.selectedCaptionIds as string[],
          selectedWordIds: payload.selectedWordIds as string[],
          ...(range ? { range } : {})
        }
        return { content: {
          outcome: 'context-updated',
          projectId: project.id,
          revision: project.currentRevision,
          generation: selectionGeneration,
          eventGeneration,
          selection
        } }
      }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      await vi.runOnlyPendingTimersAsync()
      await flushAsync()
    })
    const initialGeneration = controller!.state.project!.selection.generation

    const selectedItemId = project.items[1]!.id
    await act(async () => {
      controller!.selectItem(selectedItemId)
      await flushAsync()
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(121)
      await flushAsync()
    })
    const contextCalls = executeCommand.mock.calls.filter(([, args]) =>
      isRecord(args) && args.action === 'context.update'
    )
    expect(contextCalls.length).toBeGreaterThanOrEqual(1)
    expect(contextCalls.at(-1)).toEqual(['editor-request', {
      action: 'context.update',
      payload: {
        projectId: project.id,
        expectedRevision: project.currentRevision,
        expectedGeneration: initialGeneration,
        sequenceId: project.activeSequenceId,
        playheadFrame: 0,
        selectedAssetIds: [project.assets[0]!.id],
        selectedItemIds: [selectedItemId],
        selectedCaptionIds: [],
        selectedWordIds: [],
        range: null
      }
    }])
    const latest = structuredClone(controller!.state.project!.selection)
    expect(latest).toMatchObject({
      generation: initialGeneration + 1,
      selectedItemIds: [selectedItemId]
    })

    await act(async () => {
      emitMessage({
        channel: 'kun-video-editor.selection-changed',
        payload: {
          schemaVersion: 1,
          projectId: project.id,
          revision: project.currentRevision,
          generation: latest.generation - 1,
          eventGeneration: controller!.state.project!.eventGeneration + 1,
          selection: {
            ...latest,
            generation: latest.generation - 1,
            selectedItemIds: []
          }
        }
      })
      await flushAsync()
    })
    expect(controller!.state.project!.selection).toEqual(latest)
  })

  it('keeps the newest active project when an older project load resolves late', async () => {
    const first = { ...makeViewProject(), id: 'project-first', name: 'First' }
    const second = { ...makeViewProject(), id: 'project-second', name: 'Second' }
    let resolveFirst!: (value: { content: { project: typeof first } }) => void
    const firstLoad = new Promise<{ content: { project: typeof first } }>((resolve) => {
      resolveFirst = resolve
    })
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      const payload = isRecord(request.payload) ? request.payload : {}
      if (action === 'project.get' && payload.projectId === first.id) return await firstLoad
      if (action === 'project.get' && payload.projectId === second.id) return { content: { project: second } }
      if (action === 'project.list') return { content: { projects: [] } }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => {
      emitMessage(projectChangedMessage(first.id))
      await Promise.resolve()
      emitMessage(projectChangedMessage(second.id))
      await flushAsync()
    })
    expect(controller?.state.project?.id).toBe(second.id)
    await act(async () => {
      resolveFirst({ content: { project: first } })
      await flushAsync()
    })
    expect(controller?.state.project?.id).toBe(second.id)
  })

  it('does not let a delayed startup active-project query overwrite a newer active-project event', async () => {
    const startupProject = { ...makeViewProject(), id: 'project-startup', name: 'Startup project' }
    const eventProject = { ...makeViewProject(), id: 'project-event', name: 'Event project' }
    let resolveActive!: (value: { content: { project: typeof startupProject } }) => void
    const activeRequest = new Promise<{ content: { project: typeof startupProject } }>((resolve) => {
      resolveActive = resolve
    })
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      const payload = isRecord(request.payload) ? request.payload : {}
      if (action === 'project.list') return { content: { projects: [] } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'project.active') return await activeRequest
      if (action === 'project.get' && payload.projectId === eventProject.id) {
        return { content: { project: eventProject } }
      }
      if (action === 'project.get' && payload.projectId === startupProject.id) {
        return { content: { project: startupProject } }
      }
      return { content: {} }
    })
    const { client, emitMessage } = fakeClient({ executeCommand })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })

    await act(async () => {
      emitMessage(projectChangedMessage(eventProject.id))
      await flushAsync()
    })
    expect(controller?.state.project?.id).toBe(eventProject.id)

    await act(async () => {
      resolveActive({ content: { project: startupProject } })
      await flushAsync()
    })
    expect(controller?.state.project?.id).toBe(eventProject.id)
    expect(executeCommand).not.toHaveBeenCalledWith('editor-request', {
      action: 'project.get',
      payload: { projectId: startupProject.id }
    })
  })

  it('routes sequence, media-folder, preview, and Agent-context commands through bounded revision-safe payloads', async () => {
    const project = makeViewProject()
    const previewHistory = {
      schemaVersion: 1 as const,
      generation: 1,
      activeEntryId: 'preview-a',
      entries: [{
        id: 'preview-a',
        projectId: project.id,
        createdAt: '2026-01-01T00:00:00.000Z',
        label: 'Timeline A',
        source: {
          kind: 'timeline' as const,
          sequenceId: project.activeSequenceId,
          revision: project.currentRevision,
          startFrame: 0,
          endFrame: 90
        }
      }, {
        id: 'preview-b',
        projectId: project.id,
        createdAt: '2026-01-01T00:01:00.000Z',
        label: 'Source B',
        source: { kind: 'asset' as const, assetId: project.assets[0]!.id, startUs: 0, endUs: 1_000_000 }
      }]
    }
    const executeCommand = vi.fn(async (_id: string, args?: JsonValue) => {
      const request = isRecord(args) ? args : {}
      const action = request.action
      if (action === 'project.list') return { content: { projects: [{
        id: project.id,
        name: project.name,
        currentRevision: project.currentRevision,
        updatedAt: project.updatedAt,
        durationFrames: project.durationFrames
      }] } }
      if (action === 'project.active' || action === 'project.get') return { content: { project } }
      if (action === 'render.list') return { content: { records: [] } }
      if (action === 'derived.list') return { content: { records: [] } }
      if (action === 'preview.list') return { content: { history: previewHistory } }
      if (action === 'preview.add' || action === 'preview.select') return { content: { history: previewHistory, entry: previewHistory.entries[0] } }
      if (action === 'preview.compare') return { content: {
        history: previewHistory,
        comparison: { leftEntryId: 'preview-a', rightEntryId: 'preview-b', mode: 'wipe', sameRevision: true }
      } }
      if (action === 'context.attach-selection') return { content: {
        attachment: {
          schemaVersion: 1,
          projectId: project.id,
          sequenceId: project.activeSequenceId,
          revision: project.currentRevision,
          selectionGeneration: project.selection.generation,
          playheadFrame: project.selection.playheadFrame,
          selectedAssetIds: project.selection.selectedAssetIds,
          selectedItemIds: project.selection.selectedItemIds,
          selectedCaptionIds: project.selection.selectedCaptionIds,
          selectedWordIds: project.selection.selectedWordIds,
          previewEntryIds: ['preview-a', 'preview-b']
        }
      } }
      return { content: {} }
    })
    const openViewResource = vi.fn(async ({ handleId }: { handleId: string }) => ({
      leaseId: `lease_${handleId}`,
      handleId,
      url: `kun-media://lease/${handleId}`,
      mimeType: 'video/mp4',
      expiresAt: '2099-01-01T00:00:00.000Z'
    }))
    const attachComposerContext = vi.fn(async (request) => ({
      ...request,
      attachmentId: `extension-context:${'a'.repeat(64)}`,
      provenance: {
        extensionId: 'kun-examples.kun-video-editor',
        extensionVersion: '0.1.0',
        viewContributionId: 'extension:kun-examples.kun-video-editor/video-editor',
        workspaceId: 'b'.repeat(64)
      }
    }))
    const { client } = fakeClient({ executeCommand, openViewResource, attachComposerContext })
    let controller: EditorController | undefined
    await act(async () => {
      renderer = create(createElement(CaptureController, {
        client, capture: (value: EditorController) => { controller = value }
      }))
      await flushAsync()
    })
    await act(async () => { await flushAsync() })

    await act(async () => controller!.createSequence('Social cut', true))
    await act(async () => controller!.decomposeNested(project.items[0]!.id))
    await act(async () => controller!.createMediaFolder('Generated takes'))
    await act(async () => controller!.organizeMedia([project.assets[0]!.id, project.assets[0]!.id], 'folder-generated'))
    await act(async () => controller!.addPreview({
      kind: 'timeline',
      sequenceId: project.activeSequenceId,
      revision: project.currentRevision,
      startFrame: 0,
      endFrame: 90
    }, 'Timeline A'))
    await act(async () => controller!.selectPreview('preview-a'))
    await act(async () => controller!.comparePreviews('preview-a', 'preview-b', 'wipe'))
    let previewResource: Awaited<ReturnType<EditorController['openPreviewResource']>> = undefined
    await act(async () => {
      previewResource = await controller!.openPreviewResource('preview-b')
      await flushAsync()
    })
    await act(async () => controller!.attachSelection(['preview-a', 'preview-a', 'preview-b']))

    expect(previewResource).toMatchObject({
      entryId: 'preview-b',
      title: 'Source B',
      mediaKind: 'video',
      url: `kun-media://lease/${project.assets[0]!.mediaHandleId}`
    })
    expect(openViewResource).toHaveBeenCalledWith({ handleId: project.assets[0]!.mediaHandleId })

    const requests = executeCommand.mock.calls.map(([, args]) => isRecord(args) ? args : {})
    const request = (action: string): Record<string, unknown> | undefined =>
      requests.find((candidate) => candidate.action === action)
    expect(request('project.update')?.payload).toMatchObject({
      projectId: project.id,
      expectedRevision: project.currentRevision,
      operations: [{ type: 'create-sequence', name: 'Social cut', activate: true }]
    })
    expect(request('sequence.decompose')?.payload).toMatchObject({
      projectId: project.id, expectedRevision: project.currentRevision, itemId: project.items[0]!.id
    })
    expect(request('media.folder.create')?.payload).toMatchObject({
      projectId: project.id, expectedRevision: project.currentRevision, name: 'Generated takes'
    })
    expect(request('media.organize')?.payload).toMatchObject({
      projectId: project.id, expectedRevision: project.currentRevision,
      assetIds: [project.assets[0]!.id], folderId: 'folder-generated'
    })
    expect(request('preview.add')?.payload).toMatchObject({
      projectId: project.id, expectedRevision: project.currentRevision, label: 'Timeline A',
      source: { kind: 'timeline', sequenceId: project.activeSequenceId, revision: project.currentRevision, startFrame: 0, endFrame: 90 }
    })
    expect(request('preview.select')?.payload).toEqual({
      projectId: project.id,
      expectedRevision: project.currentRevision,
      entryId: 'preview-a'
    })
    expect(request('preview.compare')?.payload).toEqual({
      projectId: project.id,
      expectedRevision: project.currentRevision,
      leftEntryId: 'preview-a',
      rightEntryId: 'preview-b',
      mode: 'wipe'
    })
    expect(request('context.attach-selection')?.payload).toEqual({
      projectId: project.id,
      expectedRevision: project.currentRevision,
      previewEntryIds: ['preview-a', 'preview-b']
    })
    expect(attachComposerContext).toHaveBeenCalledWith({
      schemaVersion: 1,
      id: 'video-selection',
      title: `${project.name} selection`,
      summary: `Revision ${project.currentRevision} · ${project.selection.selectedItemIds.length} selected clips · 2 preview sources`,
      reference: expect.objectContaining({
        projectId: project.id,
        revision: project.currentRevision,
        previewEntryIds: ['preview-a', 'preview-b']
      }),
      revision: project.currentRevision,
      generation: project.selection.generation
    })
    const serialized = JSON.stringify(requests.filter(({ action }) => [
      'project.update', 'sequence.decompose', 'media.folder.create', 'media.organize',
      'preview.add', 'preview.select', 'preview.compare', 'context.attach-selection'
    ].includes(String(action))))
    expect(serialized).not.toMatch(/(?:file:\/\/|\/Users\/|workspaceRelativePath|mediaHandleId)/u)
  })
})

function generationCatalogProjection(): Record<string, unknown> {
  return {
    schemaVersion: 1,
    revision: 'catalog-controller-test',
    generatedAt: '2026-07-14T00:00:00.000Z',
    providers: [{
      id: 'remote-provider',
      displayName: 'Remote provider',
      version: '1.0.0',
      kind: 'remote',
      status: 'available',
      models: [{
        id: 'remote-video',
        displayName: 'Remote video',
        version: '1.0.0',
        tasks: ['video'],
        outputKinds: ['video'],
        referenceKinds: ['video'],
        limits: { maxPromptCharacters: 2_000, minReferences: 1, maxReferences: 2, maxVariants: 2 },
        permissions: {
          permissionIds: ['network:provider.example.test'],
          credential: 'host-account',
          mediaUpload: 'explicit'
        },
        privacy: {
          processing: 'provider',
          promptRetention: 'provider-policy',
          mediaRetention: 'provider-policy'
        },
        cost: { currency: 'USD', minimumMinor: 10, maximumMinor: 25, estimateOnly: true }
      }]
    }]
  }
}

function generationRecordProjection(projectId: string, projectRevision: number) {
  return {
    schemaVersion: 1,
    id: 'generation_controller_test',
    generation: 3,
    projectId,
    projectRevision,
    providerId: 'remote-provider',
    modelId: 'remote-video',
    task: 'video',
    promptDigest: 'a'.repeat(64),
    referenceAssetIds: ['asset-interview'],
    variantsRequested: 1,
    quote: {
      quoteId: 'quote-controller-test',
      currency: 'USD',
      minimumMinor: 10,
      maximumMinor: 25,
      estimateOnly: true
    },
    placeholder: {
      assetId: 'generated-controller-placeholder',
      displayName: 'Generated video',
      kind: 'video',
      state: 'failed'
    },
    state: 'failed',
    attempt: 1,
    outputs: [],
    error: { code: 'provider-failed', message: 'Provider failed safely.', retryable: true },
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:01:00.000Z'
  }
}

function makeArchiveJob(id: string, state: JobSnapshot['state']): JobSnapshot {
  return {
    schemaVersion: 1,
    id,
    kind: 'media.archive',
    kindSchemaVersion: 1,
    ownerExtensionId: 'kun-examples.kun-video-editor',
    ownerExtensionVersion: '0.4.0',
    workspaceId: 'workspace-1',
    initiatingOperation: 'media.startArchiveJob',
    state,
    executionAttempt: 1,
    createdAt: '2026-07-14T00:00:00.000Z',
    updatedAt: '2026-07-14T00:00:01.000Z',
    latestCursor: 'cursor_package_1',
    progress: {
      percentage: 40,
      phase: 'archiving',
      message: 'Archiving',
      updatedAt: '2026-07-14T00:00:01.000Z'
    }
  }
}

function CaptureController(props: {
  client: ExtensionHostClient
  capture(controller: EditorController): void
}): null {
  props.capture(useEditorController(props.client))
  return null
}

function fakeClient(input: {
  openViewResource?: ReturnType<typeof vi.fn>
  performArtifactAction?: ReturnType<typeof vi.fn>
  executeCommand?: ReturnType<typeof vi.fn>
  getTheme?: () => Promise<Theme>
  getLocale?: () => Promise<Locale>
  pickFiles?: ReturnType<typeof vi.fn>
  pickSaveTarget?: ReturnType<typeof vi.fn>
  readText?: ReturnType<typeof vi.fn>
  release?: ReturnType<typeof vi.fn>
  getJob?: ReturnType<typeof vi.fn>
  subscribeJob?: ReturnType<typeof vi.fn>
  attachComposerContext?: ReturnType<typeof vi.fn>
  listJobs?: ReturnType<typeof vi.fn>
  getViewState?: ReturnType<typeof vi.fn>
  setViewState?: ReturnType<typeof vi.fn>
} = {}): {
  client: ExtensionHostClient
  emitTheme(value: Theme): void
  emitLocale(value: Locale): void
  emitMessage(value: HostMessage): void
} {
  const themeListeners = new Set<(value: Theme) => void>()
  const localeListeners = new Set<(value: Locale) => void>()
  const messageListeners = new Set<(value: HostMessage) => void>()
  const event = () => ({ dispose: () => undefined })
  const executeCommand = input.executeCommand ?? vi.fn(async (_id: string, args?: JsonValue) => {
    const action = isRecord(args) ? args.action : undefined
    return action === 'project.list' ? { content: { projects: [] } } : { content: {} }
  })
  const client = {
    commands: { executeCommand },
    media: {
      getCapabilities: vi.fn(async () => ({
        probedAt: '2026-01-01T00:00:00.000Z',
        ffmpeg: {
          name: 'ffmpeg', available: true,
          features: ['libx264-encoder', 'aac-encoder']
        },
        ffprobe: { name: 'ffprobe', available: true, features: [] }
      })),
      pickFiles: input.pickFiles ?? vi.fn(),
      pickSaveTarget: input.pickSaveTarget ?? vi.fn(),
      readText: input.readText ?? vi.fn(),
      openViewResource: input.openViewResource ?? vi.fn(),
      performArtifactAction: input.performArtifactAction ?? vi.fn(),
      release: input.release ?? vi.fn(async () => ({ released: true }))
    },
    jobs: {
      list: input.listJobs ?? vi.fn(async () => ({ items: [] })),
      get: input.getJob ?? vi.fn(),
      subscribe: input.subscribeJob ?? vi.fn()
    },
    agent: {},
    ui: {
      getTheme: vi.fn(input.getTheme ?? (async () => darkTheme())),
      getLocale: vi.fn(input.getLocale ?? (async () => enLocale())),
      getViewState: input.getViewState ?? vi.fn(async () => undefined),
      setViewState: input.setViewState ?? vi.fn(async () => undefined),
      attachComposerContext: input.attachComposerContext ?? vi.fn(),
      onDidChangeTheme: (listener: (value: Theme) => void) => {
        themeListeners.add(listener)
        return { dispose: () => themeListeners.delete(listener) }
      },
      onDidChangeLocale: (listener: (value: Locale) => void) => {
        localeListeners.add(listener)
        return { dispose: () => localeListeners.delete(listener) }
      },
      onDidReceiveMessage: (listener: (value: HostMessage) => void) => {
        messageListeners.add(listener)
        return { dispose: () => messageListeners.delete(listener) }
      }
    },
    onDidError: event
  } as unknown as ExtensionHostClient
  return {
    client,
    emitTheme: (value) => { for (const listener of themeListeners) listener(value) },
    emitLocale: (value) => { for (const listener of localeListeners) listener(value) },
    emitMessage: (value) => { for (const listener of messageListeners) listener(value) }
  }
}

function darkTheme(): Theme {
  return { kind: 'dark', tokens: {}, zoomFactor: 1, reducedMotion: false }
}

function lightTheme(): Theme {
  return { kind: 'light', tokens: {}, zoomFactor: 1, reducedMotion: false }
}

function enLocale(): Locale {
  return { language: 'en', direction: 'ltr', messages: {} }
}

function zhLocale(): Locale {
  return { language: 'zh-CN', direction: 'ltr', messages: {} }
}

function projectChangedMessage(projectId: string): HostMessage {
  return {
    channel: 'kun-video-editor.active-project-changed',
    payload: {
      schemaVersion: 1,
      projectId,
      revision: 0,
      reason: 'active-project-changed',
      changedIds: ['active-project']
    }
  }
}

async function flushAsync(): Promise<void> {
  for (let index = 0; index < 8; index += 1) await Promise.resolve()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function localizedNotice(notice: EditorNotice, locale: Locale | undefined): string {
  return notice.messageKey
    ? formatMessage(messagesFor(locale)[notice.messageKey], notice.messageValues)
    : notice.message
}
