import { describe, expect, it, vi } from 'vitest'
import {
  buildCodeCanvasSendOverrides,
  buildDesignTurnSendOverrides,
  type DesignTurnPromptState
} from './design-turn-dispatch'
import type { AttachmentReference } from '../agent/types'

const attachment: AttachmentReference = {
  id: 'att_image',
  kind: 'image',
  name: 'wireframe.png'
}

describe('design turn dispatch', () => {
  it('builds canvas send overrides with model, provider, reasoning, and attachments', () => {
    const promptState: DesignTurnPromptState = {
      assistantModel: ' deepseek-chat ',
      assistantProviderId: '  '
    }
    const resolveProviderId = vi.fn(() => 'deepseek')

    const overrides = buildDesignTurnSendOverrides({
      displayText: 'Create a design',
      promptState,
      resolveProviderId,
      reasoningEffort: 'medium',
      serviceTier: 'priority',
      expectedThreadId: 'thr_design',
      waitForRuntimeAdmission: true,
      target: 'canvas',
      attachmentIds: [attachment.id],
      attachments: [attachment]
    })

    expect(overrides).toEqual({
      displayText: 'Create a design',
      agentSurface: 'design',
      model: 'deepseek-chat',
      providerId: 'deepseek',
      reasoningEffort: 'medium',
      serviceTier: 'priority',
      expectedThreadId: 'thr_design',
      waitForRuntimeAdmission: true,
      guiDesignCanvas: true,
      guiDesignMode: true,
      attachmentIds: [attachment.id],
      attachments: [attachment]
    })
    expect(resolveProviderId).toHaveBeenCalledWith('deepseek-chat')
  })

  it('prefers an explicit provider and leaves html turns out of canvas mode', () => {
    const resolveProviderId = vi.fn(() => 'fallback')

    const overrides = buildDesignTurnSendOverrides({
      displayText: 'Refine home',
      promptState: {
        assistantModel: ' ',
        assistantProviderId: ' openai '
      },
      resolveProviderId,
      target: 'html'
    })

    expect(overrides).toEqual({
      displayText: 'Refine home',
      agentSurface: 'design',
      providerId: 'openai'
    })
    expect(resolveProviderId).not.toHaveBeenCalled()
  })

  it('uses the shared composer selection instead of the legacy Design setting', () => {
    const overrides = buildDesignTurnSendOverrides({
      displayText: 'Refine home',
      promptState: {
        assistantModel: 'legacy-design-model',
        assistantProviderId: 'legacy-provider'
      },
      model: 'shared-composer-model',
      providerId: 'shared-provider',
      resolveProviderId: () => 'fallback',
      target: 'html'
    })

    expect(overrides).toMatchObject({
      model: 'shared-composer-model',
      providerId: 'shared-provider'
    })
  })

  it('scopes a dedicated SVG turn to its reserved artifact without enabling ShapeOps', () => {
    const overrides = buildDesignTurnSendOverrides({
      displayText: 'Animate the logo',
      promptState: { assistantModel: '', assistantProviderId: '' },
      resolveProviderId: () => '',
      target: 'svg',
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'motion',
        relativePath: '.kun-design/doc/motion/v2.svg'
      }
    })

    expect(overrides).toEqual({
      displayText: 'Animate the logo',
      agentSurface: 'design',
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'motion',
        relativePath: '.kun-design/doc/motion/v2.svg'
      }
    })
    expect(overrides.guiDesignCanvas).toBeUndefined()
  })

  it('does not advertise ShapeOps for an Excalidraw Design canvas turn', () => {
    const overrides = buildDesignTurnSendOverrides({
      displayText: 'Explain this sketch',
      promptState: { assistantModel: '', assistantProviderId: '' },
      resolveProviderId: () => '',
      target: 'canvas',
      canvasEngine: 'excalidraw'
    })
    expect(overrides.guiDesignCanvas).toBeUndefined()
    expect(overrides.guiDesignMode).toBeUndefined()
  })

  it('builds the code-canvas overrides as a canvas agent turn', () => {
    expect(buildCodeCanvasSendOverrides({
      displayText: 'Apply markup',
      reasoningEffort: 'high'
    })).toEqual({
      displayText: 'Apply markup',
      agentSurface: 'code',
      guiDesignCanvas: true,
      reasoningEffort: 'high'
    })

    expect(buildCodeCanvasSendOverrides({})).toEqual({
      agentSurface: 'code',
      guiDesignCanvas: true
    })
    expect(buildCodeCanvasSendOverrides({ canvasEngine: 'excalidraw' })).toEqual({
      agentSurface: 'code'
    })
  })
})
