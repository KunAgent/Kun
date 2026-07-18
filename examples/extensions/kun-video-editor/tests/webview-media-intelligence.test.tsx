import { readFileSync } from 'node:fs'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { EditorController } from '../src/webview/controller.js'
import { messagesFor } from '../src/webview/i18n.js'
import { MediaIntelligencePanel } from '../src/webview/media-intelligence.js'
import { INITIAL_EDITOR_STATE, editorReducer, type EditorState } from '../src/webview/model.js'
import { makeViewProject } from './webview-fixtures.js'

describe('media intelligence Webview panel', () => {
  it('keeps search and optional local analysis usable in a bounded sidebar layout', () => {
    const state = projectState()
    const english = renderToStaticMarkup(
      <MediaIntelligencePanel controller={stubController(state)} messages={messagesFor()} />
    )
    const chinese = renderToStaticMarkup(
      <MediaIntelligencePanel
        controller={stubController({
          ...state,
          locale: { language: 'zh-CN', direction: 'ltr', messages: {} }
        })}
        messages={messagesFor({ language: 'zh-CN', direction: 'ltr', messages: {} })}
      />
    )

    expect(english).toContain('Search and local analysis')
    expect(english).toContain('Optional local intelligence')
    expect(english).toContain('opaque media grants locally')
    expect(english).toContain('Local beat/downbeat analysis requires verified FFmpeg/ffprobe PCM support')
    expect(english).toContain('low-confidence audio yields no markers')
    expect(english).toContain('No denoise values were fabricated and no audio was changed')
    expect(chinese).toContain('搜索与本地分析')
    expect(chinese).toContain('可选本地智能分析')
    expect(chinese).toContain('视觉模型状态')
    expect(chinese).toContain('选择启用经验证的本地视觉索引')
    expect(chinese).toContain('本地节拍/重拍分析需要已验证的 FFmpeg/ffprobe PCM 能力')
    expect(chinese).toContain('低置信度音频不会生成标记')
    expect(chinese).toContain('不会伪造降噪数值，也没有修改音频')
    expect(chinese).not.toContain('Optional local intelligence')
    expect(chinese).not.toContain('Visual model status')

    const css = readFileSync(new URL('../src/webview/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.media-intelligence-panel\s*\{[^}]*display:\s*grid;/su)
    expect(css).toMatch(/\.media-search-results ol\s*\{[^}]*max-height:\s*320px;[^}]*overflow:\s*auto;/su)
    expect(css).toMatch(/@media \(max-width: 540px\)[\s\S]*\.media-search-form\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u)
    expect(css).toMatch(/@media \(max-width: 540px\)[\s\S]*\.audio-sync-grid\s*\{\s*grid-template-columns:\s*minmax\(0, 1fr\);/u)
  })

  it('previews and inserts the exact timed transcript range using standard editor operations', async () => {
    const state = projectState()
    const controller = stubController(state)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(
          <MediaIntelligencePanel controller={controller} messages={messagesFor()} />
        )
      })
      const search = renderer!.root.findByProps({ type: 'search' })
      const form = renderer!.root.findByProps({ role: 'search' })
      await act(async () => {
        search.props.onChange({ target: { value: 'world' } })
      })
      await act(async () => {
        form.props.onSubmit({ preventDefault: vi.fn() })
      })

      expect(JSON.stringify(renderer!.toJSON())).toContain('Spoken transcript')
      expect(JSON.stringify(renderer!.toJSON())).toContain('0:02.00')
      expect(JSON.stringify(renderer!.toJSON())).toContain('0:03.00')

      const preview = button(renderer!, 'Preview range')
      await act(async () => preview.props.onClick())
      expect(controller.openAsset).toHaveBeenCalledWith('asset-1')
      expect(controller.seek).toHaveBeenCalledWith(60)

      const insert = button(renderer!, 'Insert at playhead')
      await act(async () => insert.props.onClick())
      expect(controller.applyOperations).toHaveBeenCalledTimes(1)
      expect(controller.applyOperations).toHaveBeenCalledWith([
        {
          type: 'add-item',
          item: expect.objectContaining({
            assetId: 'asset-1',
            trackId: 'video-1',
            timelineStartFrame: 0,
            durationFrames: 30,
            sourceStartUs: 2_000_000,
            sourceEndUs: 3_000_000
          })
        }
      ], 'Inserted search result from Interview.mp4')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('labels partial evidence and never implies an unavailable visual model was run', async () => {
    const state = projectState()
    state.project!.transcripts[0]!.truncated = true
    state.visualProvisioning = {
      schemaVersion: 1,
      optIn: true,
      state: 'broker-unavailable',
      code: 'visual_model_broker_unavailable',
      installSupported: false,
      verification: {
        brokerAttested: false,
        downloadVerified: false,
        sourceVerified: false,
        installVerified: false,
        signatureVerified: false,
        manifestVerified: false,
        errors: []
      },
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false,
      remediation: 'No verified visual-model and inference Broker is connected. No model was downloaded or run.',
      checkedAt: '2026-07-14T00:00:00.000Z'
    }
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(
          <MediaIntelligencePanel controller={stubController(state)} messages={messagesFor()} />
        )
      })
      const search = renderer!.root.findByProps({ type: 'search' })
      const form = renderer!.root.findByProps({ role: 'search' })
      await act(async () => {
        search.props.onChange({ target: { value: 'world' } })
      })
      await act(async () => {
        form.props.onSubmit({ preventDefault: vi.fn() })
      })
      expect(JSON.stringify(renderer!.toJSON())).toContain('Transcript index partial')

      const output = JSON.stringify(renderer!.toJSON())
      expect(output).toContain('No verified visual-model and inference Broker is connected')
      expect(output).toContain('No model was downloaded or run')
      expect(output).not.toContain('Install verified visual model')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('uses verified visual index evidence for bounded search, preview, insert, and opt-in actions', async () => {
    const state = projectState()
    state.visualProvisioning = {
      schemaVersion: 1,
      optIn: true,
      state: 'ready',
      code: 'visual_model_ready',
      installSupported: true,
      packageSource: 'bundled',
      model: {
        adapterId: 'kun.visual-embedding',
        adapterVersion: '1.0.0',
        packageId: 'kun-visual-model-v1',
        modelId: 'clip-compatible',
        modelVersion: '1.0.0',
        embeddingDimensions: 3,
        manifestSha256: 'a'.repeat(64)
      },
      verification: {
        brokerAttested: true,
        downloadVerified: false,
        sourceVerified: true,
        installVerified: true,
        signatureVerified: true,
        manifestVerified: true,
        errors: []
      },
      local: true,
      networkUsedForInference: false,
      rawPathsExposed: false,
      urlsAccepted: false,
      remediation: '',
      checkedAt: '2026-07-14T00:00:00.000Z'
    }
    state.audioAnalysisRecords = [{
      schemaVersion: 1,
      id: 'visual-index:fixture',
      kind: 'visual-index',
      assetId: 'asset-1',
      completeness: 'partial',
      indexedSampleCount: 3,
      plannedSampleCount: 3,
      omittedSampleCount: 2,
      adapterId: 'kun.visual-embedding',
      adapterVersion: '1.0.0',
      modelId: 'clip-compatible',
      modelVersion: '1.0.0',
      packageId: 'kun-visual-model-v1',
      manifestSha256: 'a'.repeat(64),
      intervalUs: 2_000_000,
      maxFrames: 3,
      samplingStrategy: 'uniform-interval-v1',
      currentGrant: true,
      immutable: true
    }]
    state.visualMomentPage = {
      schemaVersion: 1,
      indexId: 'visual-index:fixture',
      offset: 0,
      results: [{
        id: 'visual-moment:fixture',
        assetId: 'asset-1',
        sourceRange: { assetId: 'asset-1', startUs: 2_000_000, endUs: 4_000_000 },
        score: 0.91,
        sampleId: 'visual-sample:fixture',
        representativeUs: 3_000_000,
        modelConfidence: 0.77
      }],
      totalMatches: 1,
      completeness: 'partial',
      ranking: {
        semantics: 'uncalibrated-cosine',
        calibratedConfidence: false,
        local: true,
        networkUsed: false,
        adapterId: 'kun.visual-embedding',
        adapterVersion: '1.0.0',
        modelId: 'clip-compatible',
        modelVersion: '1.0.0',
        packageId: 'kun-visual-model-v1',
        manifestSha256: 'a'.repeat(64)
      }
    }
    const controller = stubController(state)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<MediaIntelligencePanel controller={controller} messages={messagesFor()} />)
      })
      const output = JSON.stringify(renderer!.toJSON())
      expect(output).toContain('clip-compatible')
      expect(output).toContain('3/3 sampled frames indexed · 2 intervals omitted')
      expect(output).toContain('Similarity 91% (uncalibrated)')
      expect(output).toContain('not confidence or human visual review')
      expect(output).toContain('Verified bundled package; no download occurred')

      const optIn = renderer!.root.findByProps({ type: 'checkbox' })
      await act(async () => optIn.props.onChange({ target: { checked: false } }))
      expect(controller.setVisualOptIn).toHaveBeenCalledWith(false)
      await act(async () => button(renderer!, 'Index sampled frames').props.onClick())
      expect(controller.indexVisual).toHaveBeenCalledWith('asset-1')

      const preview = button(renderer!, 'Preview range')
      await act(async () => preview.props.onClick())
      expect(controller.openAsset).toHaveBeenCalledWith('asset-1')
      expect(controller.seek).toHaveBeenCalledWith(60)

      const insert = button(renderer!, 'Insert at playhead')
      await act(async () => insert.props.onClick())
      expect(controller.applyOperations).toHaveBeenCalledWith([
        {
          type: 'add-item',
          item: expect.objectContaining({
            assetId: 'asset-1',
            sourceStartUs: 2_000_000,
            sourceEndUs: 4_000_000
          })
        }
      ], 'Inserted search result from Interview.mp4')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('shows real local capability, progress, immutable VAD evidence, and confidence-gated actions', async () => {
    const state = projectState()
    state.audioAnalysisCapabilities = {
      schemaVersion: 1,
      probedAt: '2026-07-14T00:00:00.000Z',
      analyses: [
        {
          analysis: 'silence', available: true,
          algorithm: 'ffmpeg.silencedetect', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        },
        {
          analysis: 'beat-grid', available: false,
          code: 'AUDIO_ANALYSIS_ALGORITHM_UNAVAILABLE', remediation: 'No verified analyzer.',
          retryable: false, local: true, networkUsed: false
        },
        {
          analysis: 'sync-features', available: true,
          algorithm: 'kun.pcm-energy-envelope', algorithmVersion: '1.0.0',
          local: true, networkUsed: false
        }
      ]
    }
    state.denoiseMetadataCapability = {
      outcome: 'ready',
      descriptor: {
        adapterId: 'kun.fixture.denoise', adapterVersion: '1.0.0',
        algorithm: 'noise-profile', algorithmVersion: '1.0.0'
      },
      local: true,
      networkUsed: false
    }
    state.audioAnalysisRecords = [{
      schemaVersion: 1,
      id: 'analysis:vad:fixture',
      kind: 'vad',
      assetId: 'asset-1',
      completeness: 'complete',
      silenceCount: 2,
      safeSuggestionCount: 1,
      suggestionConfidenceThreshold: 0.82,
      immutable: true
    }, {
      schemaVersion: 1,
      id: 'analysis:denoise:fixture',
      kind: 'denoise-metadata',
      assetId: 'asset-1',
      completeness: 'complete',
      confidence: 0.86,
      confidenceThreshold: 0.7,
      status: 'ready',
      noiseProfile: {
        analyzedDurationUs: 2_000_000,
        sampleWindowCount: 20,
        levels: {
          noiseFloorDbfs: -54.5, averageRmsDbfs: -31, peakDbfs: -4,
          estimatedSnrDb: 23.5
        },
        spectralBandCount: 2
      },
      recommendation: {
        reductionDb: 8.5, confidence: 0.86, disposition: 'preview-suggested',
        autoApplyAllowed: false, audioMutation: 'none'
      },
      metadataOnly: true,
      immutable: true
    }]
    state.mediaIntelligenceEvidence = {
      schemaVersion: 1,
      recordId: 'analysis:vad:fixture',
      kind: 'vad',
      offset: 0,
      returned: 2,
      total: 2,
      completeness: 'complete',
      evidence: [
        {
          suggestionId: 'safe', startUs: 200_000, endUs: 600_000,
          confidence: 0.95, disposition: 'safe-to-suggest'
        },
        {
          suggestionId: 'review', startUs: 1_000_000, endUs: 1_400_000,
          confidence: 0.6, disposition: 'review-required'
        }
      ]
    }
    state.mediaIntelligenceOperations = [{
      schemaVersion: 1,
      operationId: 'media-analysis-fixture',
      projectId: state.project!.id,
      projectRevision: state.project!.currentRevision,
      kind: 'vad',
      generation: 3,
      status: 'running',
      completed: 25,
      total: 100
    }]
    state.audioSyncPreview = {
      analysisId: 'analysis:sync:fixture',
      referenceItemId: 'item-1',
      targetItemId: 'item-2',
      targetFrameBefore: 60,
      targetFrameAfter: 54,
      deltaFrames: -6,
      confidence: 0.94,
      outcome: 'ready'
    }
    const controller = stubController(state)
    controller.analyzeVad = vi.fn(async () => undefined)
    controller.analyzeDenoiseMetadata = vi.fn(async () => undefined)
    controller.applyVadAnalysis = vi.fn(async () => undefined)
    controller.applyAudioSync = vi.fn(async () => undefined)
    controller.cancelMediaIntelligence = vi.fn(async () => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<MediaIntelligencePanel controller={controller} messages={messagesFor()} />)
      })
      const output = JSON.stringify(renderer!.toJSON())
      expect(output).toContain('ffmpeg.silencedetect')
      expect(output).toContain('1 of 2 silence suggestions meet the 82% threshold')
      expect(output).toContain('Proposed move: -6 frames')
      expect(output).toContain('25%')
      expect(output).toContain('Noise floor -54.5 dBFS')
      expect(output).toContain('suggested reduction 8.5 dB')
      expect(output).toContain('Kun did not modify the source or timeline')
      const chinese = renderToStaticMarkup(
        <MediaIntelligencePanel
          controller={stubController({
            ...state,
            locale: { language: 'zh-CN', direction: 'ltr', messages: {} }
          })}
          messages={messagesFor({ language: 'zh-CN', direction: 'ltr', messages: {} })}
        />
      )
      expect(chinese).toContain('运行中')
      expect(chinese).not.toContain('running')

      await act(async () => button(renderer!, 'Analyze silence').props.onClick())
      await act(async () => button(renderer!, 'Analyze noise profile').props.onClick())
      await act(async () => button(renderer!, 'Apply safe silence edits').props.onClick())
      await act(async () => button(renderer!, 'Apply sync transaction').props.onClick())
      await act(async () => button(renderer!, 'Cancel analysis').props.onClick())
      expect(controller.analyzeVad).toHaveBeenCalledWith('asset-1')
      expect(controller.analyzeDenoiseMetadata).toHaveBeenCalledWith('asset-1')
      expect(controller.applyVadAnalysis).toHaveBeenCalledWith('analysis:vad:fixture')
      expect(controller.applyAudioSync).toHaveBeenCalledWith('analysis:sync:fixture', 'item-1', 'item-2')
      expect(controller.cancelMediaIntelligence).toHaveBeenCalledWith('media-analysis-fixture')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('keeps uncertain synchronization as preview-only and disables transactional apply', () => {
    const state = projectState()
    state.audioSyncPreview = {
      analysisId: 'analysis:sync:uncertain',
      referenceItemId: 'item-1',
      targetItemId: 'item-2',
      targetFrameBefore: 60,
      targetFrameAfter: 60,
      deltaFrames: 0,
      confidence: 0.5,
      outcome: 'uncertain',
      refusalReason: 'ambiguous-correlation'
    }
    const html = renderToStaticMarkup(
      <MediaIntelligencePanel controller={stubController(state)} messages={messagesFor()} />
    )
    expect(html).toContain('uncertain — review only')
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Apply sync transaction<\/button>/u)
  })
})

function projectState(): EditorState {
  return editorReducer(
    editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
    { type: 'project', value: makeViewProject() }
  )
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(({ props }) => props.children === label)!
}

function stubController(state: EditorState): EditorController {
  const asynchronous = vi.fn(async () => undefined)
  const synchronous = vi.fn()
  return {
    state,
    refreshAll: asynchronous,
    retryInitialization: asynchronous,
    setActiveWorkspace: synchronous,
    createProject: asynchronous,
    openProject: asynchronous,
    importMedia: asynchronous,
    loadMediaLibraryPage: asynchronous,
    importTranscript: asynchronous,
    checkLocalTranscriber: asynchronous,
    generateCaptions: asynchronous,
    openAsset: vi.fn(async () => undefined),
    refreshActiveLease: asynchronous,
    recoverMedia: asynchronous,
    refreshDerived: asynchronous,
    startDerived: asynchronous,
    retryDerived: asynchronous,
    cancelDerived: asynchronous,
    cleanupDerived: asynchronous,
    refreshMediaIntelligence: asynchronous,
    setVisualOptIn: asynchronous,
    requestVisualModelInstall: asynchronous,
    indexVisual: asynchronous,
    searchVisualMoments: asynchronous,
    analyzeVad: asynchronous,
    applyVadAnalysis: asynchronous,
    importSpeakerEvidence: asynchronous,
    previewSpeakerAttribution: asynchronous,
    applySpeakerAttribution: asynchronous,
    analyzeBeats: asynchronous,
    analyzeDenoiseMetadata: asynchronous,
    previewAudioSync: asynchronous,
    applyAudioSync: asynchronous,
    cancelMediaIntelligence: asynchronous,
    refreshGeneration: asynchronous,
    requestGeneration: asynchronous,
    retryGeneration: asynchronous,
    cancelGeneration: asynchronous,
    insertGeneratedVariant: asynchronous,
    createMulticam: asynchronous,
    renameMulticamLabels: asynchronous,
    confirmMulticamSync: asynchronous,
    switchMulticam: asynchronous,
    mergeMulticam: asynchronous,
    applyMulticamLayout: asynchronous,
    previewMulticam: asynchronous,
    applyOperations: vi.fn(async () => undefined),
    createSequence: asynchronous,
    duplicateSequence: asynchronous,
    renameSequence: asynchronous,
    selectSequence: asynchronous,
    closeSequence: asynchronous,
    deleteSequence: asynchronous,
    setSequenceView: asynchronous,
    decomposeNested: asynchronous,
    createMediaFolder: asynchronous,
    updateMediaFolder: asynchronous,
    deleteMediaFolder: asynchronous,
    organizeMedia: asynchronous,
    refreshPreviewHistory: asynchronous,
    addPreview: asynchronous,
    selectPreview: asynchronous,
    openPreviewResource: vi.fn(async () => undefined),
    comparePreviews: asynchronous,
    replaceSelectedFromPreview: asynchronous,
    attachSelection: asynchronous,
    undo: asynchronous,
    redo: asynchronous,
    readScript: asynchronous,
    editScript: synchronous,
    applyScript: asynchronous,
    seek: synchronous,
    togglePlaying: synchronous,
    selectItem: synchronous,
    selectCaption: synchronous,
    setTranscriptWindow: synchronous,
    setTimelineWindow: synchronous,
    startAgent: asynchronous,
    steerAgent: asynchronous,
    cancelAgent: asynchronous,
    startRender: asynchronous,
    cancelJob: asynchronous,
    startProjectPackage: asynchronous,
    refreshProjectPackage: asynchronous,
    cancelProjectPackage: asynchronous,
    startOtioExport: asynchronous,
    refreshOtioExport: asynchronous,
    cancelOtioExport: asynchronous,
    previewOtioImport: asynchronous,
    confirmOtioImport: asynchronous,
    cancelOtioImportPreview: asynchronous,
    openArtifact: asynchronous,
    revealArtifact: asynchronous,
    dismissNotice: synchronous
  }
}
