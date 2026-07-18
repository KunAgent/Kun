import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import type { EditorController } from '../src/webview/controller.js'
import { messagesFor } from '../src/webview/i18n.js'
import { INITIAL_EDITOR_STATE, editorReducer, type EditorState, type TimelineOperation } from '../src/webview/model.js'
import { SpatialTimeline, linkedMoveOperations, linkedTrimOperations } from '../src/webview/spatial-timeline.js'
import { makeViewProject } from './webview-fixtures.js'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean })
  .IS_REACT_ACT_ENVIRONMENT = true

const messages = messagesFor({ language: 'en', direction: 'ltr', messages: {} })

describe('spatial timeline workbench', () => {
  it('renders proportional clip/caption lanes, trim handles, playhead, and localized controls', () => {
    const state = projectState()
    const html = renderToStaticMarkup(<SpatialTimeline controller={controller(state)} messages={messages} />)

    expect(html).toContain('class="spatial-timeline"')
    expect(html).toContain('class="timeline-spatial-lane track-video"')
    expect(html).toContain('class="timeline-trim-handle trim-start"')
    expect(html).toContain('class="timeline-trim-handle trim-end"')
    expect(html).toContain('class="timeline-caption"')
    expect(html).toContain('Timeline zoom')
    expect(html).toContain('Snapping on')
    expect(html).toContain('style="left:0;width:320px"')
    expect(html).toContain('style="left:320px;width:320px"')

    const chinese = renderToStaticMarkup(<SpatialTimeline
      controller={controller(state)}
      messages={messagesFor({ language: 'zh-CN', direction: 'ltr', messages: {} })}
    />)
    expect(chinese).toContain('时间线缩放')
    expect(chinese).toContain('吸附已开启')
  })

  it('commits pointer placement and trim through one bounded structured operation batch', async () => {
    const state = projectState()
    const applyOperations = vi.fn(async (_operations: TimelineOperation[], _summary: string) => undefined)
    const editor = controller(state, applyOperations)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<SpatialTimeline controller={editor} messages={messages} />)
      })
      const clip = renderer!.root.find((node) => node.props['data-item-id'] === 'item-2')
      const body = clip.find((node) => node.props.className === 'timeline-clip-body')
      await act(async () => {
        body.props.onPointerDown(pointer(100))
        body.props.onPointerMove(pointer(125))
      })
      await act(async () => body.props.onPointerUp(pointer(125)))
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'move-item', itemId: 'item-2', trackId: 'video-1', timelineStartFrame: 97 }],
        'Moved item-2'
      )

      const trimEnd = clip.find((node) => node.props.className === 'timeline-trim-handle trim-end')
      await act(async () => {
        trimEnd.props.onPointerDown(pointer(200))
        trimEnd.props.onPointerMove(pointer(165))
      })
      await act(async () => trimEnd.props.onPointerUp(pointer(165)))
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'trim-item', itemId: 'item-2', startFrame: 90, endFrame: 170 }],
        'Trimmed item-2'
      )

      await act(async () => body.props.onKeyDown({
        key: 'ArrowRight',
        shiftKey: true,
        preventDefault: vi.fn()
      }))
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'move-item', itemId: 'item-2', trackId: 'video-1', timelineStartFrame: 100 }],
        'Moved item-2'
      )
      await act(async () => body.props.onKeyDown({
        key: '[',
        shiftKey: false,
        preventDefault: vi.fn()
      }))
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'trim-item', itemId: 'item-2', startFrame: 91, endFrame: 180 }],
        'Trimmed item-2'
      )
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('renders current beat evidence and snaps timeline edits to its projected frame', async () => {
    const state: EditorState = {
      ...projectState(),
      audioAnalysisRecords: [{
        schemaVersion: 1,
        id: 'analysis-beat-grid-1',
        kind: 'beat-grid',
        assetId: 'asset-1',
        completeness: 'complete',
        markerCount: 1,
        snapTargets: [{
          id: 'beat-target-1',
          frame: 100,
          kind: 'downbeat',
          confidence: 0.91
        }],
        currentGrant: true,
        immutable: true
      }]
    }
    const applyOperations = vi.fn(async (_operations: TimelineOperation[], _summary: string) => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<SpatialTimeline
          controller={controller(state, applyOperations)}
          messages={messages}
        />)
      })
      const marker = renderer!.root.find((node) => node.props['data-beat-frame'] === 100)
      expect(marker.props.className).toBe('timeline-beat-marker downbeat')

      const clip = renderer!.root.find((node) => node.props['data-item-id'] === 'item-2')
      const body = clip.find((node) => node.props.className === 'timeline-clip-body')
      await act(async () => {
        body.props.onPointerDown(pointer(100))
        body.props.onPointerMove(pointer(134))
      })
      await act(async () => body.props.onPointerUp(pointer(134)))
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'move-item', itemId: 'item-2', trackId: 'video-1', timelineStartFrame: 100 }],
        'Moved item-2'
      )
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('does not infer a link between ungrouped audio and video from their shared asset', () => {
    const project = makeViewProject()
    const video = { ...project.items[0]!, id: 'video-source', trackId: 'video-1', timelineStartFrame: 30 }
    const audio = { ...project.items[0]!, id: 'audio-source', trackId: 'audio-1', timelineStartFrame: 30 }
    project.items = [video, audio]
    project.linkGroups = []

    expect(linkedMoveOperations(project, video, 45)).toEqual([
      { type: 'move-item', itemId: 'video-source', trackId: 'video-1', timelineStartFrame: 45 }
    ])
    expect(linkedTrimOperations(project, video, 45, 105)).toEqual([
      { type: 'trim-item', itemId: 'video-source', startFrame: 45, endFrame: 105 }
    ])
  })

  it('follows only the Host-projected transitive link groups and rejects locked members or tracks atomically', () => {
    const project = makeViewProject()
    project.tracks.push({ id: 'audio-2', name: 'Mic', kind: 'audio', order: 4, overlap: 'mix' })
    const video = { ...project.items[0]!, id: 'video-linked', trackId: 'video-1', timelineStartFrame: 30 }
    const audio = { ...project.items[0]!, id: 'audio-linked', trackId: 'audio-1', timelineStartFrame: 30 }
    const mic = { ...project.items[0]!, id: 'mic-linked', trackId: 'audio-2', timelineStartFrame: 30 }
    project.items = [video, audio, mic]
    project.linkGroups = [
      { id: 'av-real', kind: 'av', itemIds: [video.id, audio.id], locked: true },
      { id: 'sync-real', kind: 'sync', itemIds: [audio.id, mic.id], locked: true }
    ]

    expect(linkedMoveOperations(project, video, 45)).toEqual(expect.arrayContaining([
      { type: 'move-item', itemId: 'video-linked', trackId: 'video-1', timelineStartFrame: 45 },
      { type: 'move-item', itemId: 'audio-linked', trackId: 'audio-1', timelineStartFrame: 45 },
      { type: 'move-item', itemId: 'mic-linked', trackId: 'audio-2', timelineStartFrame: 45 }
    ]))
    expect(linkedTrimOperations(project, video, 45, 105)).toEqual(expect.arrayContaining([
      { type: 'trim-item', itemId: 'video-linked', startFrame: 45, endFrame: 105 },
      { type: 'trim-item', itemId: 'audio-linked', startFrame: 45, endFrame: 105 },
      { type: 'trim-item', itemId: 'mic-linked', startFrame: 45, endFrame: 105 }
    ]))

    project.items[2] = { ...mic, locked: true }
    expect(() => linkedMoveOperations(project, video, 45)).toThrow(/locked/iu)
    project.items[2] = mic
    project.tracks = project.tracks.map((track) => track.id === 'audio-2' ? { ...track, locked: true } : track)
    expect(() => linkedTrimOperations(project, video, 45, 105)).toThrow(/locked/iu)
  })

  it('hydrates and debounces the active sequence zoom and scroll view state', async () => {
    vi.useFakeTimers()
    const project = makeViewProject()
    project.sequences[0] = {
      ...project.sequences[0]!,
      viewState: { zoom: 2, scrollFrame: 10, open: true }
    }
    const editor = controller(projectState(project))
    editor.setSequenceView = vi.fn(async () => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => { renderer = create(<SpatialTimeline controller={editor} messages={messages} />) })
      const zoom = renderer!.root.find((node) => node.type === 'input' && node.props['aria-label'] === 'Timeline zoom')
      const scroll = renderer!.root.find((node) => node.type === 'input' && node.parent?.props.className === 'timeline-scroll-control')
      expect(Number(zoom.props.value)).toBeGreaterThan(7)
      expect(scroll.props.value).toBe(10)
      await act(async () => {
        zoom.props.onChange({ target: { value: '8' } })
        scroll.props.onChange({ target: { value: '20' } })
      })
      await act(async () => { await vi.advanceTimersByTimeAsync(401) })
      expect(editor.setSequenceView).toHaveBeenCalledTimes(1)
      const [sequenceId, persistedZoom, persistedScroll] = vi.mocked(editor.setSequenceView).mock.calls[0]!
      expect(sequenceId).toBe(project.activeSequenceId)
      expect(persistedZoom).toBeCloseTo(2.25, 2)
      expect(persistedScroll).toBe(20)
    } finally {
      await act(async () => renderer?.unmount())
      vi.useRealTimers()
    }
  })

  it('bounds a ten-thousand-clip project to the visible spatial window', () => {
    const project = makeViewProject()
    project.durationFrames = 300_000
    project.captions = []
    project.items = Array.from({ length: 10_000 }, (_, index) => ({
      ...project.items[0]!,
      id: `long-${index}`,
      timelineStartFrame: index * 30,
      durationFrames: 20,
      sourceStartUs: 0,
      sourceEndUs: 666_667
    }))
    const state: EditorState = { ...projectState(), project }
    const html = renderToStaticMarkup(<SpatialTimeline controller={controller(state)} messages={messages} />)
    const renderedClips = html.match(/data-item-id="long-/gu)?.length ?? 0

    expect(renderedClips).toBeGreaterThan(0)
    expect(renderedClips).toBeLessThan(400)
    expect(html).toContain('virtualized')
  })

  it('shows only an opaque derived waveform state and never a cache path', () => {
    const project = makeViewProject()
    project.assets[0] = { ...project.assets[0]!, kind: 'audio', video: undefined }
    project.items[0] = { ...project.items[0]!, trackId: 'audio-1' }
    project.items = project.items.slice(0, 1)
    const state: EditorState = {
      ...projectState(project),
      derivedRecords: [{
        schemaVersion: 1,
        id: 'waveform-1',
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
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }]
    }
    const html = renderToStaticMarkup(<SpatialTimeline controller={controller(state)} messages={messages} />)
    expect(html).toContain('class="timeline-waveform" data-state="ready"')
    expect(html).toContain('aria-label="Waveform ready"')
    expect(html).not.toContain('/tmp/')
  })

  it('opens a ready waveform through the Host lease and renders the protected resource', async () => {
    const project = makeViewProject()
    project.assets[0] = { ...project.assets[0]!, kind: 'audio', video: undefined }
    project.items[0] = { ...project.items[0]!, trackId: 'audio-1' }
    project.items = project.items.slice(0, 1)
    const state: EditorState = {
      ...projectState(project),
      derivedRecords: [{
        schemaVersion: 1,
        id: 'waveform-lease-1',
        generation: 2,
        statusGeneration: 2,
        kind: 'waveform',
        projectId: project.id,
        assetId: project.assets[0]!.id,
        status: 'ready',
        priority: 'interactive',
        bytes: 512,
        pinned: false,
        attempt: 1,
        artifactHandleId: 'media_waveform_ready_0001',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }]
    }
    const editor = controller(state)
    const openDerivedResource = vi.fn(async () => 'kun-media://lease/waveform-ready')
    editor.openDerivedResource = openDerivedResource
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<SpatialTimeline controller={editor} messages={messages} />)
        await Promise.resolve()
        await Promise.resolve()
      })
      expect(openDerivedResource).toHaveBeenCalledWith('waveform-lease-1')
      const waveform = renderer!.root.find((node) => node.props.className === 'timeline-waveform')
      const image = waveform.find((node) => node.type === 'img')
      expect(image.props.src).toBe('kun-media://lease/waveform-ready')
      expect(JSON.stringify(renderer!.toJSON())).not.toContain('/tmp/')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('emits real track and clip property commands instead of keeping fake local state', async () => {
    const state: EditorState = { ...projectState(), selectedItemId: 'item-1' }
    const applyOperations = vi.fn(async (_operations: TimelineOperation[], _summary: string) => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<SpatialTimeline controller={controller(state, applyOperations)} messages={messages} />)
      })
      const muteTrack = renderer!.root.findAll((node) => node.props['aria-label'] === 'Mute track')[0]!
      await act(async () => muteTrack.props.onClick())
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'update-track-state', trackId: 'video-1', muted: true }],
        'Updated track state for video-1'
      )

      const muteClip = renderer!.root.find((node) => node.type === 'button' && node.props.children === 'Mute clip')
      await act(async () => muteClip.props.onClick())
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{ type: 'update-item-properties', itemId: 'item-1', muted: true }],
        'Updated clip properties for item-1'
      )

      const properties = renderer!.root.find((node) => node.props.className === 'timeline-clip-properties')
      const inputs = properties.findAll((node) => node.type === 'input' && node.props.type === 'number')
      await act(async () => {
        inputs[0]!.props.onChange({ target: { value: '0.7' } })
        inputs[1]!.props.onChange({ target: { value: '8' } })
        inputs[2]!.props.onChange({ target: { value: '9' } })
      })
      const apply = properties.find((node) => node.type === 'button' && node.props.children === 'Apply volume and fades')
      await act(async () => apply.props.onClick())
      expect(applyOperations).toHaveBeenLastCalledWith(
        [{
          type: 'update-item-properties',
          itemId: 'item-1',
          volume: 0.7,
          fadeInFrames: 8,
          fadeOutFrames: 9
        }],
        'Updated clip properties for item-1'
      )
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('previews a bounded ripple delete across sync-locked tracks before one commit', async () => {
    const project = makeViewProject()
    project.tracks = project.tracks.map((track) => ({
      ...track,
      syncLocked: track.id === 'video-1' || track.id === 'audio-1'
    }))
    project.items.push({
      ...project.items[1]!,
      id: 'audio-tail',
      trackId: 'audio-1'
    })
    const applyOperations = vi.fn(async (_operations: TimelineOperation[], _summary: string) => undefined)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<SpatialTimeline
          controller={controller(projectState(project), applyOperations)}
          messages={messages}
        />)
      })
      const lane = renderer!.root.find((node) => node.props['data-timeline-track-id'] === 'video-1')
      await act(async () => {
        lane.props.onPointerDown(rangePointer(105, 'video-1'))
        lane.props.onPointerMove(rangePointer(210, 'video-1'))
        lane.props.onPointerUp(rangePointer(210, 'video-1'))
      })
      const preview = renderer!.root.find((node) =>
        node.type === 'button' && node.props.children === 'Preview ripple delete'
      )
      await act(async () => preview.props.onClick())

      expect(renderer!.root.findAll((node) =>
        node.props.className === 'timeline-ripple-preview-clip'
      ).length).toBeGreaterThan(0)
      expect(renderer!.root.find((node) =>
        node.props.className === 'timeline-ripple-preview-actions'
      ).props['data-state']).toBe('preview')
      const apply = renderer!.root.find((node) =>
        node.type === 'button' && node.props.children === 'Apply ripple delete'
      )
      await act(async () => apply.props.onClick())

      expect(applyOperations).toHaveBeenCalledTimes(1)
      const [operations, summary] = applyOperations.mock.calls[0]!
      expect(operations.length).toBeGreaterThan(0)
      expect(operations.length).toBeLessThanOrEqual(200)
      expect(operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: 'move-item', itemId: 'audio-tail' })
      ]))
      expect(summary).toMatch(/^Ripple deleted frames \d+–\d+$/u)
    } finally {
      await act(async () => renderer?.unmount())
    }
  })
})

function projectState(project = makeViewProject()): EditorState {
  return editorReducer(
    editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
    { type: 'project', value: project }
  )
}

function controller(
  state: EditorState,
  applyOperations: EditorController['applyOperations'] = async () => undefined
): EditorController {
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
    openAsset: asynchronous,
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
    applyOperations,
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

function pointer(clientX: number): {
  button: number
  pointerId: number
  clientX: number
  clientY: number
  currentTarget: { setPointerCapture(): void; releasePointerCapture(): void }
  stopPropagation(): void
} {
  return {
    button: 0,
    pointerId: 1,
    clientX,
    clientY: 0,
    currentTarget: { setPointerCapture: vi.fn(), releasePointerCapture: vi.fn() },
    stopPropagation: vi.fn()
  }
}

function rangePointer(clientX: number, trackId: string): {
  button: number
  pointerId: number
  clientX: number
  currentTarget: {
    dataset: { timelineTrackId: string }
    getBoundingClientRect(): { left: number }
    setPointerCapture(): void
    releasePointerCapture(): void
  }
  target: Record<string, never>
} {
  return {
    button: 0,
    pointerId: 7,
    clientX,
    currentTarget: {
      dataset: { timelineTrackId: trackId },
      getBoundingClientRect: () => ({ left: 0 }),
      setPointerCapture: vi.fn(),
      releasePointerCapture: vi.fn()
    },
    target: {}
  }
}
