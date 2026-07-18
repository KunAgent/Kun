import { readFileSync } from 'node:fs'
import type { JobSnapshot } from '@kun/extension-api'
import { useState } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  canImportMedia,
  PreviewComparisonViewer,
  syncDocumentPresentation,
  themeStyle,
  VideoEditorWorkbench
} from '../src/webview/app.js'
import type { EditorController } from '../src/webview/controller.js'
import { INITIAL_EDITOR_STATE, VIEW_LIMITS, editorReducer, type EditorState } from '../src/webview/model.js'
import { makeArtifact, makeJob, makeSubtitleArtifact, makeViewProject } from './webview-fixtures.js'

describe('video editor docked workbench', () => {
  it('renders structured affected-node guidance from a Host render refusal', () => {
    const project = makeViewProject()
    const state: EditorState = {
      ...editorReducer(
        editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
        { type: 'project', value: project }
      ),
      notices: [{
        id: 'render-capability-unavailable',
        severity: 'warning',
        message: 'Render unavailable',
        messageKey: 'mediaCapabilitiesUnavailable',
        capabilityDetails: [{
          nodeId: 'item-interview:effect-blur',
          nodeType: 'effect',
          capability: 'filter:boxblur',
          guidance: 'Install an FFmpeg build with boxblur or disable this effect.'
        }]
      }]
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)

    expect(html).toContain('1 affected render node(s)')
    expect(html).toContain('item-interview:effect-blur')
    expect(html).toContain('filter:boxblur')
    expect(html).toContain('Install an FFmpeg build with boxblur or disable this effect.')
  })

  it('renders one bounded sidebar workspace instead of stacking every editor surface', () => {
    const project = makeViewProject()
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    const tags = openingTags(html)
    const workbench = tags.find((tag) => attribute(tag, 'data-layout') === 'responsive-sidebar')
    const tabs = tags.filter((tag) => attribute(tag, 'role') === 'tab' && attribute(tag, 'data-section') !== undefined)
    const panes = tags.filter((tag) => attribute(tag, 'role') === 'tabpanel')
    const sections = ['script', 'clips', 'timeline', 'properties', 'output'] as const
    const expectedLabels = ['Script', 'Clips', 'Timeline', 'Properties', 'Output']

    expect(workbench).toBeDefined()
    expect(attribute(workbench!, 'data-workspace')).toBe('script')
    expect(tags.some((tag) => attribute(tag, 'role') === 'tablist')).toBe(true)
    expect(tabs).toHaveLength(sections.length)
    expect(panes).toHaveLength(sections.length)
    expect(tabs.filter((tag) => attribute(tag, 'aria-selected') === 'true')).toHaveLength(1)
    expect(panes.filter((tag) => attribute(tag, 'data-sidebar-active') === 'true')).toHaveLength(1)
    expect(panes.filter((tag) => !hasAttribute(tag, 'hidden'))).toHaveLength(1)
    expect(tags.some((tag) => hasClass(tag, 'preview-drawer'))).toBe(true)
    expect(tags.find((tag) => hasClass(tag, 'preview-drawer')) && attribute(tags.find((tag) => hasClass(tag, 'preview-drawer'))!, 'role')).toBeUndefined()
    expect(tags.some((tag) => hasClass(tag, 'project-health'))).toBe(true)
    expect(tags.some((tag) => hasClass(tag, 'project-action-buttons'))).toBe(true)
    expect((html.match(/class="workbench-icon"/gu) ?? []).length).toBeGreaterThanOrEqual(5)
    expect(html).toContain('class="selection-quick-summary"')
    for (const disclosure of ['Background processing', 'Local intelligence', 'Caption editing', 'Multicam', 'Proof and preview', 'Revision history', 'Generated variants', 'Professional interchange', 'Project package']) {
      expect(html).toContain(`<strong>${disclosure}</strong>`)
    }
    expect(tabs.map((tag) => textForOpeningTag(html, tag))).toEqual(expectedLabels)

    for (const section of sections) {
      const tabId = `video-editor-tab-${section}`
      const paneId = `video-editor-pane-${section}`
      const tab = tabs.find((tag) => attribute(tag, 'id') === tabId)
      const pane = panes.find((tag) => attribute(tag, 'id') === paneId)
      expect(tab, `${section} tab`).toBeDefined()
      expect(attribute(tab!, 'data-section')).toBe(section)
      expect(attribute(tab!, 'aria-controls')).toBe(paneId)
      expect(pane, `${section} panel`).toBeDefined()
      expect(attribute(pane!, 'aria-labelledby')).toBe(tabId)
      expect(hasAttribute(pane!, 'hidden')).toBe(attribute(tab!, 'aria-selected') !== 'true')
    }
  })

  it('renders the persisted Output workspace and a completed atomic project package without sensitive references', () => {
    const project = makeViewProject()
    const ticket = {
      schemaVersion: 1 as const,
      jobId: 'job_project_package_component_1',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      pinnedRevision: project.currentRevision,
      packageId: `pkg-${'a'.repeat(32)}`,
      manifestDigest: 'b'.repeat(64),
      complete: false,
      selectedAssetCount: 2,
      embeddedAssetCount: 1,
      uniqueMediaCount: 1,
      deduplicatedAssetCount: 0,
      missingAssetIds: ['asset-offline'],
      missingMediaPolicy: 'omit' as const,
      mediaScope: 'selected' as const,
      receiptsRequested: true,
      agentProvenanceRequested: true,
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    const archiveJob: JobSnapshot = {
      ...makeJob('completed'),
      id: ticket.jobId,
      kind: 'media.archive',
      initiatingOperation: 'media.startArchiveJob',
      progress: { percentage: 100, phase: 'finalizing', message: 'Complete', updatedAt: '2026-07-14T00:00:01.000Z' },
      result: {
        schemaVersion: 1 as const,
        generatedArtifacts: [],
        data: {
          schemaVersion: 1,
          format: 'zip',
          entryCount: 7,
          inputBytes: 1024,
          archiveBytes: 768,
          sha256: 'c'.repeat(64),
          generatedMedia: {
            handleId: 'media_secret_archive_handle_1',
            mode: 'export',
            kind: 'data',
            displayName: '/Users/zxy/private/interview.kun-video.zip',
            mimeType: 'application/zip',
            byteSize: 768,
            completionIdentity: 'secret-completion-identity',
            workspaceRelativeDisplayLocation: 'private/output/interview.kun-video.zip',
            revoked: false
          }
        }
      }
    }
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = {
      ...reduced,
      activeWorkspace: 'output',
      projectPackageTickets: [ticket],
      jobs: [archiveJob]
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    const outputTab = openingTags(html).find((tag) => attribute(tag, 'data-section') === 'output')

    expect(attribute(outputTab!, 'aria-selected')).toBe('true')
    expect(html).toContain('Self-contained project package')
    expect(html).toContain('Generate and upscale')
    expect(html).toContain('Generation unavailable')
    expect(html).toContain('Manual editing, transcript workflows, proof, and export remain available')
    expect(html).toContain('Explicitly incomplete media snapshot')
    expect(html).toContain('Missing media IDs: asset-offline')
    expect(html).toContain('interview.kun-video.zip')
    expect(html).toContain('SHA-256')
    expect(html).not.toContain('media_secret_archive_handle_1')
    expect(html).not.toContain('secret-completion-identity')
    expect(html).not.toContain('private/output')
    expect(html).not.toContain('/Users/')
    expect(html).not.toContain('chatText')
  })

  it('renders localized OTIO export and explicit two-step import without exposing the picker grant', () => {
    const project = makeViewProject()
    const manifest = {
      adapterId: 'kun.otio-json' as const,
      adapterVersion: '1.0.0' as const,
      portableLossless: false,
      kunRoundTripLossless: true,
      entries: [{
        code: 'effects-custom-metadata', severity: 'warning' as const, feature: 'effects',
        nodeId: 'item-interview', preservation: 'kun-metadata' as const,
        message: 'Effect parameters use Kun metadata.'
      }],
      truncated: 2
    }
    const ticket = {
      schemaVersion: 1 as const,
      jobId: 'job_otio_component_123456',
      projectId: project.id,
      sequenceId: project.activeSequenceId,
      pinnedRevision: project.currentRevision,
      adapterId: 'kun.otio-json' as const,
      adapterVersion: '1.0.0' as const,
      documentDigest: 'a'.repeat(64),
      projectDigest: 'b'.repeat(64),
      documentBytes: 4096,
      lossManifest: manifest,
      createdAt: '2026-07-14T00:00:00.000Z'
    }
    const state: EditorState = {
      ...editorReducer(
        editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
        { type: 'project', value: project }
      ),
      locale: { language: 'zh-CN', direction: 'ltr', messages: {} },
      activeWorkspace: 'output',
      otioExportTickets: [ticket],
      otioImportPreview: {
        inputHandleId: 'opaque_secret_otio_handle_1',
        displayName: 'external-cut.otio',
        sourceDocumentDigest: 'c'.repeat(64),
        sourceProjectId: 'external-cut',
        sourceProjectRevision: 4,
        suggestedProjectId: 'external-cut-import',
        fidelity: 'portable-otio',
        project: {
          id: 'external-cut', name: 'External cut', revision: 4, activeSequenceId: 'sequence-main',
          counts: { assets: 1, sequences: 1, tracks: 3, items: 2, captions: 0, transcripts: 0 }
        },
        mediaRelinkRequired: ['external-asset'],
        timecodeMappings: [{
          id: 'external-item', sequenceId: 'sequence-main', startFrame: 0, endFrame: 30,
          startTimecode: '00:00:00:00', endTimecode: '00:00:01:00',
          frameRate: { numerator: 30, denominator: 1 }
        }],
        timecodeMappingsTruncated: 0,
        lossManifest: manifest
      },
      jobs: [{ ...makeJob('running'), id: ticket.jobId }]
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)

    expect(html).toContain('OpenTimelineIO 交换')
    expect(html).toContain('选择 .otio 目标并导出')
    expect(html).toContain('导入预览')
    expect(html).toContain('标准 OTIO 子集')
    expect(html).toContain('创建新项目')
    expect(html).toContain('受限报告还省略了 2 条损失记录')
    expect(html).toContain('00:00:00:00–00:00:01:00')
    expect(html).not.toContain('opaque_secret_otio_handle_1')
    expect(html).not.toContain('/Users/')
  })

  it('maps the project-package controls to selected-media and omit policy options', async () => {
    const project = makeViewProject()
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = { ...reduced, activeWorkspace: 'output' }
    const startProjectPackage = vi.fn(async () => undefined)
    const controller = { ...stubController(state), startProjectPackage }
    const mediaQuery = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(), confirm: vi.fn(() => false),
      matchMedia: vi.fn(() => mediaQuery)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={controller} />)
        await Promise.resolve()
      })
      const submit = renderer!.root.findAllByType('form').find(({ props }) =>
        String(props.className).includes('project-package-form')
      )
      const selects = submit!.findAllByType('select')
      const mediaScope = selects.find(({ props }) => props.value === 'all')
      const missingPolicy = selects.find(({ props }) => props.value === 'fail')
      const provenance = submit!.findAllByType('input').find(({ props }) =>
        props.type === 'checkbox' && props.checked === false
      )
      expect(mediaScope).toBeDefined()
      expect(missingPolicy).toBeDefined()
      expect(provenance).toBeDefined()
      await act(async () => {
        mediaScope!.props.onChange({ target: { value: 'selected' } })
        missingPolicy!.props.onChange({ target: { value: 'omit' } })
        provenance!.props.onChange({ target: { checked: true } })
        await Promise.resolve()
      })
      await act(async () => submit!.props.onSubmit({ preventDefault: vi.fn() }))
      expect(startProjectPackage).toHaveBeenCalledWith({
        missingMediaPolicy: 'omit',
        includeReceipts: true,
        includeAgentProvenance: true,
        mediaScope: 'selected',
        assetIds: [project.assets[0]!.id]
      })
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('keeps the narrow Chinese transcript heading and readiness status separate from edit actions', () => {
    const project = makeViewProject()
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = {
      ...reduced,
      locale: { language: 'zh-CN', direction: 'ltr', messages: {} },
      activeWorkspace: 'script'
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)

    expect(html).toMatch(/<header class="panel-header"><h2>智能脚本<\/h2><div class="panel-actions"><span class="local-ready-status">/u)
    expect(html).toContain('class="transcript-toolbar"')
    expect(html).toContain('本地转写就绪')
    expect(html).toContain('导入逐字稿')
  })

  it('keeps a 280px long transcript locally scrollable and its edit actions reachable', async () => {
    const project = makeViewProject()
    project.currentRevision = 1
    project.selection = { ...project.selection, revision: 1 }
    project.playback = { ...project.playback, revision: 1 }
    project.revisions.push({
      revision: 1,
      parentRevision: 0,
      author: 'manual',
      sourceOperation: 'test.transcript-edit',
      timestamp: '2026-01-01T00:01:00.000Z',
      summary: 'Edited transcript'
    })
    project.transcripts[0] = {
      ...project.transcripts[0]!,
      segmentCount: 181,
      segments: Array.from({ length: 181 }, (_, index) => ({
        id: `segment-${index + 1}`,
        startUs: index * 1_000_000,
        endUs: (index + 1) * 1_000_000,
        text: index === 0
          ? `A-long-editable-transcript-token-${'x'.repeat(160)}`
          : `Transcript segment ${index + 1}`,
        ...(index === 0 ? { tags: ['filler'] as const } : {})
      }))
    }
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const proofJob: JobSnapshot = {
      ...makeJob('completed'),
      result: {
        schemaVersion: 1,
        generatedArtifacts: [makeArtifact('job_12345678')]
      }
    }
    const state: EditorState = {
      ...reduced,
      activeWorkspace: 'script',
      playheadFrame: 42,
      jobs: [proofJob],
      renderTickets: [{
        jobId: proofJob.id,
        projectId: project.id,
        pinnedRevision: 0,
        renderKind: 'proof-frame',
        createdAt: proofJob.createdAt
      }]
    }
    const seek = vi.fn()
    const applyScript = vi.fn(async () => undefined)
    const setTranscriptWindow = vi.fn()
    const mediaQuery = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      innerWidth: 280,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      confirm: vi.fn(() => false), matchMedia: vi.fn(() => mediaQuery)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={{
          ...stubController(state), seek, applyScript, setTranscriptWindow
        }} />)
        await Promise.resolve()
      })
      const preview = renderer!.root.find((node) => node.type === 'details' && node.props.className === 'preview-drawer')
      expect(preview.props.open).toBe(false)
      const status = renderer!.root.find((node) => node.props.role === 'status' && node.props.className === 'project-status-strip')
      expect(status.props['aria-label']).toBe('Project, playhead, and proof freshness')
      expect(status.props['data-proof-state']).toBe('stale')
      expect(textContent(status.find((node) => node.props['data-status-kind'] === 'project'))).toContain('Demo Project · r1')
      expect(textContent(status.find((node) => node.props['data-status-kind'] === 'playhead'))).toContain('42f · 00:01')
      expect(textContent(status.find((node) => node.props['data-status-kind'] === 'proof'))).toContain('Stale · r0')

      await act(async () => preview.props.onToggle({ currentTarget: { open: true } }))
      expect(renderer!.root.find((node) => node.type === 'details' && node.props.className === 'preview-drawer').props.open).toBe(true)
      await act(async () => renderer!.root.find((node) => node.type === 'details' && node.props.className === 'preview-drawer')
        .props.onToggle({ currentTarget: { open: false } }))
      expect(renderer!.root.find((node) => node.type === 'details' && node.props.className === 'preview-drawer').props.open).toBe(false)
      expect(textContent(renderer!.root.find((node) => node.props['data-status-kind'] === 'proof'))).toContain('Stale · r0')

      const list = renderer!.root.find((node) => node.props['data-scroll-region'] === 'transcript')
      expect(list.props['data-total']).toBe(181)
      expect(list.props.tabIndex).toBe(0)
      expect(list.findAllByType('li')).toHaveLength(VIEW_LIMITS.virtualWindow)

      const segmentButton = list.findAllByType('button').find(({ props }) =>
        String(props.className).includes('transcript-segment')
      )
      const cutButton = list.findAllByType('button').find(({ props }) =>
        String(props.className).includes('transcript-cut')
      )
      await act(async () => segmentButton!.props.onClick())
      expect(seek).toHaveBeenCalledWith(0)
      await act(async () => cutButton!.props.onClick())
      expect(applyScript).toHaveBeenCalledWith([{
        assetId: project.transcripts[0]!.assetId,
        startUs: 0,
        endUs: 1_000_000,
        reason: 'filler'
      }])

      const next = renderer!.root.findAllByType('button').find(({ props }) => props.children === 'Next')
      expect(next).toBeDefined()
      await act(async () => next!.props.onClick())
      expect(setTranscriptWindow).toHaveBeenCalledWith(VIEW_LIMITS.virtualWindow)
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('renders the sequence, rich-media, animation, effects, and preview-history P0 workbench without raw paths', () => {
    const project = makeViewProject()
    const nestedSequenceId = 'sequence-broll'
    project.sequences.push({
      id: nestedSequenceId,
      name: 'B-roll selects',
      durationFrames: 90,
      itemCount: 2,
      captionCount: 0,
      nestedByCount: 1,
      viewState: { zoom: 1, scrollFrame: 0, open: false }
    })
    project.mediaFolders.push({ id: 'folder-generated', name: 'Generated takes' })
    project.assets.push({
      id: 'asset-generated-still',
      name: 'Generated skyline.png',
      kind: 'image',
      mediaHandleId: 'media_generated_still',
      durationUs: 2_000_000,
      container: 'png',
      still: { width: 1920, height: 1080, format: 'png', animated: false },
      folderId: 'folder-generated',
      generatedLineage: {
        providerId: 'local-fixture',
        modelId: 'fixture-image',
        jobId: 'job-generated-still',
        referenceAssetIds: [project.assets[0]!.id]
      },
      availability: 'online',
      transcriptIds: []
    })
    project.items[0] = {
      ...project.items[0]!,
      nestedSequenceId,
      crop: { left: 0.05, top: 0, right: 0.05, bottom: 0 },
      blendMode: 'screen',
      effects: [{ id: 'effect-color', type: 'color.basic', enabled: true, parameters: { brightness: 0.1 } }],
      keyframes: [{ id: 'opacity-track', property: 'opacity', interpolation: 'ease', points: [{ id: 'opacity-0', frame: 0, value: 0 }] }]
    }
    project.captions[0] = {
      ...project.captions[0]!,
      animation: { kind: 'word-highlight', durationFrames: 4 }
    }
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = {
      ...reduced,
      selectedItemId: project.items[0]!.id,
      selectedAssetId: 'asset-generated-still',
      previewHistory: {
        schemaVersion: 1,
        generation: 2,
        activeEntryId: 'preview-generated',
        entries: [{
          id: 'preview-source', projectId: project.id, createdAt: '2026-01-01T00:00:00.000Z',
          label: 'Source interview', source: { kind: 'asset', assetId: project.assets[0]!.id, startUs: 0, endUs: 1_000_000 }
        }, {
          id: 'preview-generated', projectId: project.id, createdAt: '2026-01-01T00:01:00.000Z',
          label: 'Generated skyline', source: { kind: 'generated', assetId: 'asset-generated-still', jobId: 'job-generated-still', variantIndex: 0 }
        }]
      },
      previewComparison: { leftEntryId: 'preview-source', rightEntryId: 'preview-generated', mode: 'side-by-side', sameRevision: true }
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)

    for (const label of [
      'Manage sequences', 'B-roll selects', 'Generated takes', 'Generated skyline.png',
      'Nested sequence', 'Decompose to clips', 'Basic color', 'Keyframes',
      'Text animation', 'Word highlight', 'Preview history', 'Generated skyline',
      'Replace selected clip', 'Attach selection to Agent', 'Side by side'
    ]) expect(html).toContain(label)
    expect(html).not.toContain('/Users/')
    expect(html).not.toContain('workspaceRelativePath')
    expect(html).not.toContain('file://')
  })

  it('renders a Host-backed media page that is absent from the bounded project projection', () => {
    const project = makeViewProject()
    project.mediaFolders = [{ id: 'folder-generated', name: 'Generated takes' }]
    project.assets = Array.from({ length: 100 }, (_, index) => ({
      ...project.assets[0]!,
      id: `asset-${String(index).padStart(4, '0')}`,
      name: `asset-${String(index).padStart(4, '0')}.mp4`
    }))
    project.truncated = true
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state = editorReducer(reduced, {
      type: 'media-library',
      value: {
        projectId: project.id,
        revision: project.currentRevision,
        query: '',
        offset: 0,
        limit: VIEW_LIMITS.virtualWindow,
        total: 101,
        hiddenBefore: 0,
        hiddenAfter: 100,
        assets: [{
          ...project.assets[0]!,
          id: 'asset-0100',
          name: 'Generated page 101.mp4',
          mediaHandleId: 'media_page_0100_000000',
          folderId: 'folder-generated',
          generatedLineage: {
            providerId: 'fixture-provider', modelId: 'fixture-model', jobId: 'job-page-101',
            referenceAssetIds: ['asset-0000']
          }
        }]
      }
    })
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)

    expect(html).toContain('Generated page 101.mp4')
    expect(html).toContain('Generated takes')
    expect(html).toContain('Generated')
    expect(html).not.toContain('/Users/')
    expect(html).not.toContain('workspaceRelativePath')
  })

  it('requests the next media window from Host instead of slicing the bounded project locally', async () => {
    const project = makeViewProject()
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state = editorReducer(reduced, {
      type: 'media-library',
      value: {
        projectId: project.id,
        revision: project.currentRevision,
        query: '',
        offset: 0,
        limit: VIEW_LIMITS.virtualWindow,
        total: 101,
        hiddenBefore: 0,
        hiddenAfter: 100,
        assets: [project.assets[0]!]
      }
    })
    const loadMediaLibraryPage = vi.fn(async () => undefined)
    const controller = { ...stubController(state), loadMediaLibraryPage }
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(), removeEventListener: vi.fn()
    }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      confirm: vi.fn(() => false), matchMedia: vi.fn(() => mediaQuery)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={controller} />)
        await Promise.resolve()
      })
      expect(loadMediaLibraryPage).toHaveBeenCalledWith({ offset: 0, limit: VIEW_LIMITS.virtualWindow })
      const next = renderer!.root.findAllByType('button').find(({ props }) => props.children === 'Next')
      expect(next).toBeDefined()
      await act(async () => {
        next!.props.onClick()
        await Promise.resolve()
      })
      expect(loadMediaLibraryPage).toHaveBeenCalledWith({ offset: 80, limit: VIEW_LIMITS.virtualWindow })
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('renders two protected resources for real side-by-side and wipe preview comparison', () => {
    const messages = {
      compareLeft: 'Left',
      compareRight: 'Right'
    } as Parameters<typeof PreviewComparisonViewer>[0]['messages']
    const left = {
      entryId: 'preview-left',
      title: 'Source take',
      url: 'kun-media://lease/preview-left',
      mediaKind: 'video' as const
    }
    const right = {
      entryId: 'preview-right',
      title: 'Generated take',
      url: 'kun-media://lease/preview-right',
      mediaKind: 'image' as const
    }
    for (const mode of ['side-by-side', 'wipe'] as const) {
      const html = renderToStaticMarkup(
        <PreviewComparisonViewer left={left} right={right} mode={mode} messages={messages} />
      )
      expect(html).toContain(`mode-${mode}`)
      expect(html).toContain(left.url)
      expect(html).toContain(right.url)
      expect(html).toContain('Source take')
      expect(html).toContain('Generated take')
      expect(html).not.toMatch(/(?:file:\/\/|\/Users\/|workspaceRelativePath)/u)
    }
  })

  it('keeps the no-project state focused on a primary first-screen action', () => {
    const state = editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' })
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    const tags = openingTags(html)
    const main = tags.find((tag) => attribute(tag, 'id') === 'video-editor-main')
    const primaryAction = tags.find((tag) => hasClass(tag, 'empty-project-primary'))

    expect(main).toBeDefined()
    expect(hasClass(main!, 'empty-project')).toBe(true)
    expect(primaryAction).toBeDefined()
    expect(tags.some((tag) => hasClass(tag, 'workbench-tabs'))).toBe(false)
    expect(tags.some((tag) => hasClass(tag, 'onboarding-project-card'))).toBe(true)
    expect(html).toContain('Start your first story')
    expect(html).toContain('Canvas ratio')
    expect(html).toContain('Three-step editing workflow')
    expect(html).toContain('Create or open a project')
  })

  it('renders localized initialization recovery guidance and retries through the controller', async () => {
    const state: EditorState = {
      ...editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      connection: 'offline',
      locale: { language: 'zh-CN', direction: 'ltr', messages: {} },
      notices: [{
        id: 'initialization-failed',
        severity: 'error',
        message: 'The editor could not initialize.',
        messageKey: 'editorInitializeFailed'
      }]
    }
    const retryInitialization = vi.fn(async () => undefined)
    const mediaQuery = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      innerWidth: 280,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      confirm: vi.fn(() => false), matchMedia: vi.fn(() => mediaQuery)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={{
          ...stubController(state), retryInitialization
        }} />)
        await Promise.resolve()
      })
      const rendered = JSON.stringify(renderer!.toJSON())
      expect(rendered).toContain('视频编辑器初始化失败。')
      expect(rendered).toContain('请检查工作区信任与扩展权限，然后重试初始化')
      expect(rendered).toContain('现有项目和媒体不会被修改')
      expect(rendered).not.toContain('创建或打开项目')

      const retry = renderer!.root.findAllByType('button').find(({ props }) =>
        props.children === '重试初始化'
      )
      expect(retry).toBeDefined()
      await act(async () => {
        retry!.props.onClick()
        await Promise.resolve()
      })
      expect(retryInitialization).toHaveBeenCalledOnce()

      await act(async () => {
        renderer!.update(<VideoEditorWorkbench controller={{
          ...stubController({ ...state, notices: [] }), retryInitialization
        }} />)
        await Promise.resolve()
      })
      expect(JSON.stringify(renderer!.toJSON())).toContain('重试初始化')
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('keeps one roving tab selection across keyboard navigation and sidebar resize', async () => {
    const project = makeViewProject()
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    let compact = true
    let mediaListener: (() => void) | undefined
    const mediaQuery = {
      get matches() { return compact },
      media: '(max-width: 1180px)',
      onchange: null,
      addEventListener: vi.fn((_type: string, listener: () => void) => { mediaListener = listener }),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(() => true)
    }
    const documentElement = {
      dataset: {},
      dir: 'ltr',
      lang: '',
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }
    }
    vi.stubGlobal('document', { documentElement, title: '' })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => false),
      matchMedia: vi.fn(() => mediaQuery)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<StatefulWorkbench state={state} />)
        await Promise.resolve()
      })
      expect(selectedTab(renderer!)).toBe('script')

      await pressTabKey(renderer!, 'ArrowRight')
      expect(selectedTab(renderer!)).toBe('clips')
      await pressTabKey(renderer!, 'End')
      expect(selectedTab(renderer!)).toBe('output')
      await pressTabKey(renderer!, 'Home')
      expect(selectedTab(renderer!)).toBe('script')

      const timeline = renderer!.root.findAll((node) => node.props.role === 'tab')
        .find((node) => node.props['data-section'] === 'timeline')
      await act(async () => timeline?.props.onClick())
      expect(selectedTab(renderer!)).toBe('timeline')

      compact = false
      await act(async () => mediaListener?.())
      compact = true
      await act(async () => mediaListener?.())
      expect(selectedTab(renderer!)).toBe('timeline')
      expect(renderer!.root.findAll((node) => node.props.role === 'tab' && node.props['data-section'] && node.props.tabIndex === 0)).toHaveLength(1)
      expect(renderer!.root.findAll((node) => node.props.role === 'tabpanel' && node.props.hidden !== true)).toHaveLength(1)
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('supports keyboard-only project, playback, timeline edit, and job-control traversal with visible focus semantics', async () => {
    const project = makeViewProject()
    const base = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const importMedia = vi.fn(async () => undefined)
    const togglePlaying = vi.fn()
    const setActiveWorkspace = vi.fn()
    const selectItem = vi.fn()
    const seek = vi.fn()
    const applyOperations = vi.fn(async () => undefined)
    const cancelJob = vi.fn(async () => undefined)
    const mediaQuery = { matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn() }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      innerWidth: 280,
      addEventListener: vi.fn(), removeEventListener: vi.fn(),
      confirm: vi.fn(() => true), matchMedia: vi.fn(() => mediaQuery)
    })
    const controllerFor = (state: EditorState): EditorController => ({
      ...stubController(state),
      importMedia,
      togglePlaying,
      setActiveWorkspace,
      selectItem,
      seek,
      applyOperations,
      cancelJob
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={controllerFor(base)} />)
        await Promise.resolve()
      })

      const tablist = renderer!.root.find((node) => node.props.role === 'tablist' && node.props.className === 'workbench-tabs')
      const tabs = tablist.findAll((node) => node.props.role === 'tab')
      expect(tablist.props['aria-label']).toBe('Editing workspaces')
      expect(tabs).toHaveLength(5)
      expect(tabs.filter(({ props }) => props['aria-selected'] === true && props.tabIndex === 0)).toHaveLength(1)
      await pressTabKey(renderer!, 'ArrowRight')
      expect(setActiveWorkspace).toHaveBeenCalledWith('clips')

      const importButton = renderer!.root.findAllByType('button').find(({ props }) => props.children === 'Import media')
      expect(importButton?.props).toMatchObject({ type: 'button', disabled: false })
      await act(async () => importButton!.props.onClick())
      expect(importMedia).toHaveBeenCalledOnce()

      const playButton = renderer!.root.findAllByType('button').find(({ props }) => props['aria-label'] === 'Play')
      expect(playButton?.props).toMatchObject({ type: 'button', 'aria-pressed': false })
      await act(async () => playButton!.props.onClick())
      expect(togglePlaying).toHaveBeenCalledOnce()

      const timelineState: EditorState = { ...base, activeWorkspace: 'timeline' }
      await act(async () => {
        renderer!.update(<VideoEditorWorkbench controller={controllerFor(timelineState)} />)
        await Promise.resolve()
      })
      let timelineClip = renderer!.root.findAll((node) => node.type === 'button' && node.props.className === 'timeline-clip-body')
        .find(({ props }) => String(props['aria-label']).includes('0–90 frames'))!
      expect(timelineClip.props.type).toBe('button')
      expect(timelineClip.props['aria-label']).toBe('Interview.mp4, 0–90 frames')
      expect(timelineClip.props['aria-pressed']).toBe(false)
      await act(async () => timelineClip.props.onClick())
      expect(selectItem).toHaveBeenCalledWith(project.items[0]!.id)
      expect(seek).toHaveBeenCalledWith(project.items[0]!.timelineStartFrame)

      const selectedTimelineState: EditorState = {
        ...timelineState,
        selectedItemId: project.items[0]!.id,
        playheadFrame: 15
      }
      await act(async () => {
        renderer!.update(<VideoEditorWorkbench controller={controllerFor(selectedTimelineState)} />)
        await Promise.resolve()
      })
      timelineClip = renderer!.root.findAll((node) => node.type === 'button' && node.props.className === 'timeline-clip-body')
        .find(({ props }) => String(props['aria-label']).includes('0–90 frames'))!
      expect(timelineClip.props['aria-pressed']).toBe(true)
      const preventDefault = vi.fn()
      await act(async () => timelineClip.props.onKeyDown({ key: 'ArrowRight', shiftKey: false, preventDefault }))
      expect(preventDefault).toHaveBeenCalledOnce()
      expect(applyOperations).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'move-item', itemId: project.items[0]!.id })]),
        expect.any(String)
      )

      applyOperations.mockClear()
      const splitButton = renderer!.root.findAllByType('button').find(({ props }) => props['aria-label'] === 'Split at playhead')
      expect(splitButton?.props).toMatchObject({ type: 'button', disabled: false })
      await act(async () => splitButton!.props.onClick())
      expect(applyOperations).toHaveBeenCalledWith(
        expect.arrayContaining([expect.objectContaining({ type: 'split-item', itemId: project.items[0]!.id })]),
        expect.any(String)
      )

      const runningJob = makeJob('running')
      const outputState: EditorState = {
        ...base,
        activeWorkspace: 'output',
        jobs: [runningJob],
        renderTickets: [{
          jobId: runningJob.id,
          projectId: project.id,
          pinnedRevision: project.currentRevision,
          renderKind: 'preview',
          createdAt: runningJob.createdAt
        }]
      }
      await act(async () => {
        renderer!.update(<VideoEditorWorkbench controller={controllerFor(outputState)} />)
        await Promise.resolve()
      })
      const cancelButton = renderer!.root.findAllByType('button').find(({ props }) => props.children === 'Cancel job')
      expect(cancelButton?.props.type).toBe('button')
      expect(cancelButton?.props.disabled).toBe(false)
      await act(async () => cancelButton!.props.onClick())
      expect(cancelJob).toHaveBeenCalledWith(runningJob.id)

      const css = readFileSync(new URL('../src/webview/styles.css', import.meta.url), 'utf8')
      expect(css).toMatch(/button:focus-visible[\s\S]{0,360}outline: 3px solid var\(--focus\)/u)
      expect(css).toContain('[tabindex]:focus-visible')
      expect(css).toContain('.timeline-trim-handle:focus-visible { opacity: 0.72; }')
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('disables both media import entry points when ffprobe is explicitly unavailable', () => {
    const project = makeViewProject()
    const state: EditorState = {
      ...editorReducer(
        editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
        { type: 'project', value: project }
      ),
      mediaCapabilities: {
        probedAt: '2026-01-01T00:00:00.000Z',
        ffmpeg: { name: 'ffmpeg', available: true, features: ['libx264-encoder', 'aac-encoder'] },
        ffprobe: { name: 'ffprobe', available: false, features: [] }
      }
    }

    expect(canImportMedia(state)).toBe(false)
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    expect(html.match(/<button[^>]*disabled=""[^>]*>Import media<\/button>/gu)).toHaveLength(2)
  })

  it('renders every editing region with accessible landmarks and supported boundaries', () => {
    const project = makeViewProject()
    const job = {
      ...makeJob('completed'),
      result: {
        schemaVersion: 1 as const,
        generatedArtifacts: [makeArtifact('job_12345678'), makeSubtitleArtifact('job_12345678')]
      }
    }
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController({
      ...state,
      jobs: [job],
      renderTickets: [{
        jobId: job.id,
        projectId: project.id,
        pinnedRevision: project.currentRevision,
        renderKind: 'proof-frame',
        createdAt: job.createdAt
      }]
    })} />)
    for (const label of ['Media library', 'Player', 'Transcript', 'Timeline', 'Inspector', 'Captions', 'Revisions', 'Preview and proof', 'Agent sync', 'Export jobs']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('href="#video-editor-main"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('aria-label="Ordered timeline tracks"')
    for (const manualControl of ['Split at playhead', 'Apply trim', 'Move to track', 'Reorder', 'Add caption', 'Canvas and fit']) {
      expect(html).toContain(manualControl)
    }
    expect(html).toContain('does not perform arbitrary visual-scene understanding')
    expect(html).toContain('Technically validated by FFmpeg/ffprobe; not visually reviewed.')
    expect(html).toContain('Preview')
    expect(html).toContain('Open with system app')
    expect(html).toContain('Show in folder')
    expect(html).toContain('local path stays hidden from the extension View')
    expect(html).toContain('Edit with the main Kun Agent')
    expect(html).toContain('video-project · active')
    expect(html).not.toContain('Creative brief and review checkpoint')
  })

  it('renders local derived-media controls, progress, storage, and recovery state inside Clips', () => {
    const project = makeViewProject()
    const base = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = {
      ...base,
      mediaCapabilities: {
        probedAt: '2026-01-01T00:00:00.000Z',
        ffmpeg: { name: 'ffmpeg', available: true, features: [] },
        ffprobe: { name: 'ffprobe', available: true, features: [] }
      },
      derivedUsage: {
        quotaBytes: 2_000,
        usedBytes: 400,
        readyBytes: 0,
        recordCount: 1,
        pinnedCount: 0,
        evictableCount: 0
      },
      derivedRecoveryDiagnostics: ['Recovered bounded metadata'],
      derivedRecords: [{
        schemaVersion: 1,
        id: 'derived-waveform',
        generation: 4,
        statusGeneration: 3,
        kind: 'waveform',
        projectId: project.id,
        assetId: project.assets[0]!.id,
        status: 'running',
        priority: 'interactive',
        bytes: 400,
        pinned: false,
        attempt: 1,
        progress: { completed: 2, total: 4, unit: 'phase', message: 'Deriving waveform' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:01.000Z'
      }]
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    for (const label of [
      'Derived media', 'Waveform', 'Thumbnail', 'Filmstrip', 'Proxy',
      'Running', 'Cancel', 'Clean failed', 'Clear unpinned cache'
    ]) expect(html).toContain(label)
    expect(html).toContain('<progress')
    expect(html).toContain('400 B of 2.0 KB used')
    expect(html).toContain('Some derived metadata was unreadable')
    expect(html).toContain('no local path is exposed')
  })

  it('keeps partial filmstrip progress visible during export without blocking timeline edits', async () => {
    const project = makeViewProject()
    const selectedItem = project.items[0]!
    const exportJob = { ...makeJob('running'), id: 'job_export_with_partial_filmstrip' }
    const reduced = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const state: EditorState = {
      ...reduced,
      activeWorkspace: 'clips',
      selectedItemId: selectedItem.id,
      jobs: [exportJob],
      renderTickets: [{
        jobId: exportJob.id,
        projectId: project.id,
        pinnedRevision: project.currentRevision,
        renderKind: 'h264-mp4',
        createdAt: exportJob.createdAt
      }],
      derivedRecords: [{
        schemaVersion: 1,
        id: 'derived-filmstrip-partial-during-export',
        generation: 2,
        statusGeneration: 2,
        kind: 'filmstrip',
        projectId: project.id,
        assetId: selectedItem.assetId,
        status: 'partial',
        priority: 'background',
        bytes: 1_024,
        pinned: false,
        attempt: 1,
        progress: { completed: 2, total: 8, unit: 'frame', message: 'Partial filmstrip ready' },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z'
      }]
    }
    const applyOperations = vi.fn(async () => undefined)
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    }
    vi.stubGlobal('document', {
      documentElement: {
        dataset: {}, dir: 'ltr', lang: '',
        style: { setProperty: vi.fn(), removeProperty: vi.fn() }
      },
      title: ''
    })
    vi.stubGlobal('window', {
      innerWidth: 280,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => false),
      matchMedia: vi.fn(() => mediaQuery)
    })

    function ProgressiveVisualsScenario(): React.JSX.Element {
      const [activeWorkspace, setActiveWorkspace] = useState(state.activeWorkspace)
      return <VideoEditorWorkbench controller={{
        ...stubController({ ...state, activeWorkspace }),
        setActiveWorkspace,
        applyOperations
      }} />
    }

    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<ProgressiveVisualsScenario />)
        await Promise.resolve()
      })

      const clipsPane = renderer!.root.find((node) => node.props.id === 'video-editor-pane-clips')
      expect(clipsPane.props.hidden).not.toBe(true)
      const partialFilmstrip = clipsPane.find((node) => node.props['data-status'] === 'partial')
      expect(textContent(partialFilmstrip)).toContain('Filmstrip')
      expect(textContent(partialFilmstrip)).toContain('Partial')
      expect(partialFilmstrip.findByType('progress').props).toMatchObject({ max: 8, value: 2 })

      await act(async () => {
        renderer!.root.find((node) => node.props.role === 'tab' && node.props['data-section'] === 'output').props.onClick()
      })
      const outputPane = renderer!.root.find((node) => node.props.id === 'video-editor-pane-output')
      expect(outputPane.props.hidden).not.toBe(true)
      expect(outputPane.find((node) => node.props.className === 'job job-running')).toBeDefined()
      expect(textContent(outputPane)).toContain('Encoding')

      await act(async () => {
        renderer!.root.find((node) => node.props.role === 'tab' && node.props['data-section'] === 'timeline').props.onClick()
      })
      const timelinePane = renderer!.root.find((node) => node.props.id === 'video-editor-pane-timeline')
      expect(timelinePane.props.hidden).not.toBe(true)
      const reorder = timelinePane.findAllByType('button').find(({ props }) => props.children === 'Reorder')
      expect(reorder?.props.disabled).toBe(false)
      await act(async () => reorder!.props.onClick())
      expect(applyOperations).toHaveBeenCalledWith(
        [{ type: 'reorder-item', itemId: selectedItem.id }],
        expect.any(String)
      )
      expect(renderer!.root.find((node) => node.props.className === 'job job-running')).toBeDefined()
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('renders explicit empty, interaction-required, reconnect and legacy-run states', () => {
    let state: EditorState = editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' })
    state = {
      ...state,
      connection: 'reconnecting',
      notices: [{ id: 'picker', severity: 'warning', message: 'Select a file', interactionRequired: true }]
    }
    const emptyHtml = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    expect(emptyHtml).toContain('Create or open a project')
    expect(emptyHtml).toContain('A protected Kun desktop interaction is required.')

    const project = makeViewProject()
    const waitingState: EditorState = {
      ...editorReducer(state, { type: 'project', value: project }),
      jobs: [makeJob('running')],
      renderTickets: [{
        jobId: 'job_12345678',
        projectId: project.id,
        pinnedRevision: project.currentRevision,
        renderKind: 'preview',
        createdAt: '2026-01-01T00:00:00.000Z'
      }],
      agentRun: {
        id: 'run-1',
        threadId: 'thread-1',
        ownerExtensionId: 'kun-examples.kun-video-editor',
        ownerExtensionVersion: '0.1.0',
        extensionVisibility: 'private',
        extensionBudget: {},
        toolCatalogEpoch: 'epoch-1',
        state: 'waiting-approval',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:01:00.000Z'
      }
    }
    const waitingHtml = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(waitingState)} />)
    expect(waitingHtml).toContain('Existing private run')
    expect(waitingHtml).toContain('Waiting for approval')
    expect(waitingHtml).toContain('Ready for main-Agent edits')
    expect(waitingHtml).toContain('Cancel job')
  })

  it('renders the workbench in Simplified Chinese and follows the Kun theme', () => {
    const project = makeViewProject()
    project.revisions[0] = {
      ...project.revisions[0]!,
      sourceOperation: 'project.create',
      summary: 'Created project'
    }
    project.transcripts[0]!.segments[1]!.tags = ['filler']
    project.transcripts[0]!.segments[2]!.tags = ['silence']
    const initialized = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const job = makeJob('running')
    const state: EditorState = {
      ...initialized,
      theme: { kind: 'light', tokens: {}, zoomFactor: 1, reducedMotion: false },
      locale: { language: 'zh-CN', direction: 'ltr', messages: {} },
      jobs: [job],
      renderTickets: [{
        jobId: job.id,
        projectId: project.id,
        pinnedRevision: project.currentRevision,
        renderKind: 'preview',
        createdAt: job.createdAt
      }],
      lastProjectChange: {
        schemaVersion: 1,
        projectId: project.id,
        revision: project.currentRevision,
        reason: 'active-project-changed',
        changedIds: []
      },
      notices: [{
        id: 'initialization-failed',
        severity: 'error',
        message: 'The editor could not initialize.',
        messageKey: 'editorInitializeFailed'
      }]
    }
    const html = renderToStaticMarkup(<VideoEditorWorkbench controller={stubController(state)} />)
    const localizedTabs = openingTags(html).filter((tag) => attribute(tag, 'role') === 'tab' && attribute(tag, 'data-section') !== undefined)

    expect(html).toContain('data-theme="light"')
    expect(html).toContain('lang="zh-CN"')
    expect(localizedTabs.map((tag) => textForOpeningTag(html, tag))).toEqual(['脚本', '素材', '时间线', '属性', '输出'])
    expect(html).toContain('展开预览')
    expect(html).toContain('aria-label="项目、播放头与校样时效"')
    expect(html).toContain('校样时效')
    expect(html).toContain('暂无已完成校样')
    for (const label of ['Kun 视频剪辑', '媒体库', '播放器', '逐字稿', '时间线', '检查器', '字幕', '版本', '预览与校样', 'Agent 协作', '导出任务']) {
      expect(html).toContain(label)
    }
    expect(html).toContain('生成与超分')
    expect(html).toContain('生成能力不可用')
    expect(html).toContain('手动剪辑、逐字稿、校验和导出仍可正常使用')
    for (const persistedProjectLabel of ['视频 1', '视频 2', '音频 1', '已创建项目']) {
      expect(html).toContain(persistedProjectLabel)
    }
    for (const control of ['在播放头处拆分', '应用裁剪', '移动到轨道', '重新排序', '添加字幕', '画布与适配']) {
      expect(html).toContain(control)
    }
    for (const localizedStatus of ['video-project · 当前项目', '已切换当前项目', '填充词', '静音', '正在编码媒体…']) {
      expect(html).toContain(localizedStatus)
    }
    expect(html).not.toContain('Transcript-first workbench')
    expect(html).not.toContain('Select a project')
    expect(html).not.toContain('video-project · active')
    expect(html).not.toContain('active-project-changed')
    expect(html).not.toContain('Encoding')
    expect(html).not.toContain('>filler<')
    expect(html).not.toContain('>Video 1<')
    expect(html).not.toContain('>Audio 1<')
    expect(html).not.toContain('>Created project<')
    expect(html).toContain('视频编辑器初始化失败。')
    expect(html).not.toContain('The editor could not initialize.')
  })

  it('propagates presentation state to the document root and keeps light colors theme-driven', () => {
    const setProperty = vi.fn()
    const removeProperty = vi.fn()
    const documentRoot = {
      dataset: {},
      dir: '',
      lang: '',
      style: { setProperty, removeProperty }
    } as unknown as Pick<HTMLElement, 'dataset' | 'dir' | 'lang' | 'style'>
    const theme = {
      kind: 'light' as const,
      tokens: {
        background: '#fafbff',
        surface: '#ffffff',
        foreground: '#233659',
        accent: '#3b82d8'
      },
      zoomFactor: 1.25,
      reducedMotion: true
    }
    syncDocumentPresentation(
      documentRoot,
      theme,
      { language: 'zh-CN', direction: 'ltr', messages: {} }
    )

    expect(documentRoot.dataset.theme).toBe('light')
    expect(documentRoot.dataset.reducedMotion).toBe('true')
    expect(documentRoot.dataset.zoomFactor).toBe('1.25')
    expect(documentRoot.lang).toBe('zh-CN')
    expect(documentRoot.dir).toBe('ltr')
    expect(setProperty).toHaveBeenCalledWith('--bg', '#fafbff')
    expect(setProperty).toHaveBeenCalledWith('--surface', '#ffffff')
    expect(setProperty).toHaveBeenCalledWith('--text', '#233659')
    expect(setProperty).toHaveBeenCalledWith('--accent', '#3b82d8')
    expect(setProperty).toHaveBeenCalledWith('font-size', '20px')
    expect(setProperty).toHaveBeenCalledWith('color-scheme', 'light')
    expect(themeStyle(theme)).toMatchObject({
      '--bg': '#fafbff',
      '--surface': '#ffffff',
      '--text': '#233659',
      '--accent': '#3b82d8',
      colorScheme: 'light'
    })

    const css = readFileSync(new URL('../src/webview/styles.css', import.meta.url), 'utf8')
    expect(css).toMatch(/:root\[data-theme="light"\],\s*\.editor-app\[data-theme="light"\]/u)
    expect(css).toMatch(/\.editor-app\s*\{[^}]*color: var\(--text\);[^}]*var\(--app-glow\)/su)
    expect(css).toContain('body { min-height: 100vh; overflow-x: hidden; background: var(--bg); color: var(--text); }')
    expect(css).not.toContain('#222b3c 0')
    expect(css).not.toContain('background: #0b0f16')
  })

  it('opens timeline media only once while the first lease request is still pending', async () => {
    const project = makeViewProject()
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const openAsset = vi.fn(() => new Promise<void>(() => undefined))
    const documentElement = {
      dataset: {},
      dir: '',
      lang: '',
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }
    }
    vi.stubGlobal('document', { documentElement, title: '' })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => false)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={{ ...stubController(state), openAsset }} />)
        await Promise.resolve()
      })
      expect(openAsset).toHaveBeenCalledTimes(1)
      expect(openAsset).toHaveBeenCalledWith(project.assets[0]!.id)

      await act(async () => {
        renderer?.update(
          <VideoEditorWorkbench controller={{
            ...stubController({ ...state, busy: true }),
            openAsset
          }} />
        )
        await Promise.resolve()
      })
      expect(openAsset).toHaveBeenCalledTimes(1)
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })

  it('refuses inaccurate direct-source playback when the compiler requires a composed preview', async () => {
    const project = makeViewProject()
    project.playback = {
      mode: 'composed-proof',
      projectId: project.id,
      sequenceId: 'sequence-main',
      revision: project.currentRevision,
      irDigest: 'a'.repeat(64),
      reasons: ['visual-layer-count']
    }
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const controller = stubController(state)
    const openAsset = vi.fn(async () => undefined)
    const documentElement = {
      dataset: {},
      dir: '',
      lang: '',
      style: { setProperty: vi.fn(), removeProperty: vi.fn() }
    }
    vi.stubGlobal('document', { documentElement, title: '' })
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      confirm: vi.fn(() => false)
    })
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(<VideoEditorWorkbench controller={{ ...controller, openAsset }} />)
        await Promise.resolve()
      })
      expect(openAsset).not.toHaveBeenCalled()
      expect(JSON.stringify(renderer?.toJSON())).toContain('revision-bound composed preview')
      const renderButton = renderer?.root.findAllByType('button').find(({ props }) =>
        props.children === 'Render composed preview'
      )
      expect(renderButton).toBeDefined()
      await act(async () => renderButton?.props.onClick())
      expect(controller.startRender).toHaveBeenCalledWith('preview', 'none')
    } finally {
      await act(async () => renderer?.unmount())
      vi.unstubAllGlobals()
    }
  })
})

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
    applyOperations: asynchronous,
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

function StatefulWorkbench({ state }: { state: EditorState }): React.JSX.Element {
  const [activeWorkspace, setActiveWorkspace] = useState(state.activeWorkspace)
  return <VideoEditorWorkbench controller={{
    ...stubController({ ...state, activeWorkspace }),
    setActiveWorkspace
  }} />
}

function openingTags(html: string): string[] {
  return html.match(/<[a-z][^>]*>/gu) ?? []
}

function attribute(tag: string, name: string): string | undefined {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return tag.match(new RegExp(`\\s${escaped}="([^"]*)"`, 'u'))?.[1]
}

function hasAttribute(tag: string, name: string): boolean {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')
  return new RegExp(`\\s${escaped}(?:="[^"]*")?(?=\\s|>)`, 'u').test(tag)
}

function hasClass(tag: string, className: string): boolean {
  return attribute(tag, 'class')?.split(/\s+/u).includes(className) ?? false
}

function textForOpeningTag(html: string, tag: string): string {
  const start = html.indexOf(tag)
  const elementName = tag.match(/^<([a-z]+)/u)?.[1]
  if (start < 0 || !elementName) return ''
  const end = html.indexOf(`</${elementName}>`, start + tag.length)
  if (end < 0) return ''
  return textFromStaticMarkup(html.slice(start + tag.length, end)).trim()
}

function textFromStaticMarkup(markup: string): string {
  let text = ''
  let insideTag = false
  for (const character of markup) {
    if (insideTag) {
      if (character === '>') insideTag = false
    } else if (character === '<') {
      insideTag = true
    } else {
      text += character
    }
  }
  return text
}

function textContent(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : textContent(child)).join('')
}

function selectedTab(renderer: ReactTestRenderer): string | undefined {
  return renderer.root.findAll((node) => node.props.role === 'tab' && node.props['data-section'])
    .find((node) => node.props['aria-selected'] === true)?.props['data-section'] as string | undefined
}

async function pressTabKey(renderer: ReactTestRenderer, key: 'ArrowLeft' | 'ArrowRight' | 'Home' | 'End'): Promise<void> {
  const tabNodes = renderer.root.findAll((node) => node.props.role === 'tab' && node.props['data-section'])
  const selectedIndex = tabNodes.findIndex((node) => node.props['aria-selected'] === true)
  const fakeTabs = tabNodes.map((node) => ({
    focus: vi.fn(),
    click: (): void => node.props.onClick()
  }))
  const preventDefault = vi.fn()
  const tabList = renderer.root.find((node) => node.props.role === 'tablist' && node.props.className === 'workbench-tabs')
  await act(async () => tabList.props.onKeyDown({
    key,
    target: fakeTabs[selectedIndex],
    currentTarget: {
      ownerDocument: { dir: 'ltr' },
      querySelectorAll: () => fakeTabs
    },
    preventDefault
  }))
  expect(preventDefault).toHaveBeenCalledOnce()
}
