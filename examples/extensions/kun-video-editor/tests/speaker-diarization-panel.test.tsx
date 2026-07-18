import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { VideoEditorWorkbench } from '../src/webview/app.js'
import type { EditorController } from '../src/webview/controller.js'
import { messagesFor } from '../src/webview/i18n.js'
import { INITIAL_EDITOR_STATE, editorReducer, type EditorState } from '../src/webview/model.js'
import { SpeakerDiarizationPanel } from '../src/webview/speaker-diarization-panel.js'
import { makeViewProject } from './webview-fixtures.js'

describe('speaker diarization sidebar panel', () => {
  it('renders honest local capability, reviewed identities, and uncertainty in both locales', () => {
    const state = speakerState()
    const english = renderToStaticMarkup(
      <SpeakerDiarizationPanel
        controller={stubController(state)}
        messages={messagesFor()}
        asset={state.project!.assets[0]}
      />
    )
    const chinese = renderToStaticMarkup(
      <SpeakerDiarizationPanel
        controller={stubController(state)}
        messages={messagesFor({ language: 'zh-CN', direction: 'ltr', messages: {} })}
        asset={state.project!.assets[0]}
      />
    )

    expect(english).toContain('Speaker identity and diarization')
    expect(english).toContain('No verified local speaker model is connected')
    expect(english).toContain('Host Alice')
    expect(english).toContain('Overlapping speakers')
    expect(english).not.toContain('Should never be asserted')
    expect(chinese).toContain('说话人身份与分离')
    expect(chinese).toContain('重叠说话人')
    expect(chinese).not.toContain('Speaker identity and diarization')
    expect(english).not.toMatch(/\/Users\/|file:\/\/|sourcePath|workspaceRelativePath/u)
  })

  it('requires explicit reviewed JSON and separates import, preview, and transactional apply', async () => {
    const state = speakerState()
    const controller = stubController(state)
    let renderer: ReactTestRenderer | undefined
    try {
      await act(async () => {
        renderer = create(
          <SpeakerDiarizationPanel
            controller={controller}
            messages={messagesFor()}
            asset={state.project!.assets[0]}
          />
        )
      })
      const importButton = button(renderer!, 'Import reviewed evidence')
      expect(importButton.props.disabled).toBe(true)
      const textarea = renderer!.root.findByType('textarea')
      const reviewedDocument = JSON.stringify({
        schemaVersion: 1,
        adapterId: 'kun.imported-speaker-labels',
        identities: [],
        turns: []
      })
      await act(async () => textarea.props.onChange({ target: { value: reviewedDocument } }))
      expect(button(renderer!, 'Import reviewed evidence').props.disabled).toBe(false)
      await act(async () => button(renderer!, 'Import reviewed evidence').props.onClick())
      await act(async () => button(renderer!, 'Review attribution').props.onClick())
      await act(async () => button(renderer!, 'Apply attribution').props.onClick())

      expect(controller.importSpeakerEvidence).toHaveBeenCalledWith('asset-1', reviewedDocument)
      expect(controller.previewSpeakerAttribution).toHaveBeenCalledWith('speaker:fixture')
      expect(controller.applySpeakerAttribution).toHaveBeenCalledWith('speaker:fixture')
    } finally {
      await act(async () => renderer?.unmount())
    }
  })

  it('shows identified and uncertainty-safe attribution on transcript and caption content', () => {
    const project = makeViewProject()
    project.transcripts[0]!.segments[0]!.speakerAttribution = {
      analysisId: 'speaker:fixture', speakerId: 'speaker-alice', speakerLabel: 'Host Alice',
      confidence: 0.98, status: 'identified', sourceTurnIds: ['turn-1']
    }
    project.captions[0]!.speakerAttribution = {
      analysisId: 'speaker:fixture', speakerLabel: 'Should not render', confidence: 0.4,
      status: 'overlap', sourceTurnIds: ['turn-2', 'turn-3']
    }
    const state = editorReducer(
      editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
      { type: 'project', value: project }
    )
    const english = renderToStaticMarkup(
      <VideoEditorWorkbench controller={{ state } as unknown as EditorController} />
    )
    const chinese = renderToStaticMarkup(
      <VideoEditorWorkbench controller={{
        state: { ...state, locale: { language: 'zh-CN', direction: 'ltr', messages: {} } }
      } as unknown as EditorController} />
    )

    expect(english).toContain('Host Alice')
    expect(english).toContain('Overlapping speakers')
    expect(english).not.toContain('Should not render')
    expect(chinese).toContain('重叠说话人')
    expect(chinese).not.toContain('Overlapping speakers')
  })
})

function speakerState(): EditorState {
  const state = editorReducer(
    editorReducer(INITIAL_EDITOR_STATE, { type: 'initialized' }),
    { type: 'project', value: makeViewProject() }
  )
  return {
    ...state,
    speakerAdapters: [{
      descriptor: {
        id: 'kun.imported-speaker-labels',
        version: '1.0.0',
        execution: 'import',
        format: 'kun-speaker-json-v1'
      },
      outcome: 'ready',
      local: true,
      networkUsed: false
    }, {
      descriptor: {
        id: 'kun.host.local-speaker',
        version: '1.0.0',
        execution: 'local-model',
        modelId: 'speaker-diarization',
        modelVersion: 'unavailable'
      },
      outcome: 'unavailable',
      code: 'speaker_inference_broker_unavailable',
      remediation: 'No verified runtime.',
      local: true,
      networkUsed: false
    }],
    speakerIdentities: [{
      id: 'speaker-alice',
      label: 'Host Alice',
      aliases: ['Alice'],
      sourceEvidenceIds: ['review-1'],
      createdAt: '2026-07-14T00:00:00.000Z',
      updatedAt: '2026-07-14T00:00:00.000Z'
    }],
    audioAnalysisRecords: [{
      schemaVersion: 1,
      id: 'speaker:fixture',
      kind: 'speaker-diarization',
      assetId: 'asset-1',
      completeness: 'complete',
      turnCount: 2,
      identifiedTurnCount: 1,
      uncertainTurnCount: 1,
      currentGrant: true,
      immutable: true
    }],
    mediaIntelligenceEvidence: {
      schemaVersion: 1,
      recordId: 'speaker:fixture',
      kind: 'speaker-diarization',
      offset: 0,
      returned: 2,
      total: 2,
      completeness: 'complete',
      evidence: [{
        id: 'turn-1', startUs: 0, endUs: 1_000_000, status: 'identified',
        speakerLabel: 'Host Alice', confidence: 0.98
      }, {
        id: 'turn-2', startUs: 1_000_000, endUs: 2_000_000, status: 'overlap',
        speakerLabel: 'Should never be asserted', confidence: 0.42
      }]
    },
    speakerAttributionPlan: {
      analysisId: 'speaker:fixture',
      transcriptSegmentCount: 2,
      captionCount: 1,
      identifiedCount: 1,
      uncertainCount: 2,
      warnings: ['Overlap remains explicitly unlabelled.']
    }
  }
}

function stubController(state: EditorState): EditorController {
  return {
    state,
    importSpeakerEvidence: vi.fn(async () => undefined),
    previewSpeakerAttribution: vi.fn(async () => undefined),
    applySpeakerAttribution: vi.fn(async () => undefined)
  } as unknown as EditorController
}

function button(renderer: ReactTestRenderer, label: string) {
  return renderer.root.findAllByType('button').find(({ props }) => props.children === label)!
}
