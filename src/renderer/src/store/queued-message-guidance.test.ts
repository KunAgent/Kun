import { describe, expect, it } from 'vitest'
import {
  canGuideQueuedMessage,
  queuedMessageGuidancePayload,
  queuedMessageMatchesRunningTurn
} from './queued-message-guidance'

describe('canGuideQueuedMessage', () => {
  it('requires queued and admitted turn surfaces to match in both directions', () => {
    expect(queuedMessageMatchesRunningTurn(
      { id: 'q-design', text: 'design', agentSurface: 'design' },
      { agentSurface: 'code' }
    )).toBe(false)
    expect(queuedMessageMatchesRunningTurn(
      { id: 'q-code', text: 'code', agentSurface: 'code' },
      { agentSurface: 'design' }
    )).toBe(false)
  })

  it('allows Design guidance only for the same frozen profile and target', () => {
    const target = { documentId: 'doc_a', boardArtifactId: 'board_a' }
    const profile = {
      version: 1 as const, documentTarget: target, outputMedium: 'html' as const,
      target: 'web' as const, preset: 'none' as const, context: { tone: [] }
    }
    const queued = {
      id: 'q-design-same', text: 'refine', agentSurface: 'design' as const,
      designProfile: profile, designDocumentTarget: target
    }
    expect(queuedMessageMatchesRunningTurn(queued, {
      agentSurface: 'design', designProfile: profile, designDocumentTarget: target
    })).toBe(true)
    expect(queuedMessageMatchesRunningTurn(queued, {
      agentSurface: 'design', designProfile: profile,
      designDocumentTarget: { ...target, documentId: 'doc_b' }
    })).toBe(false)
  })

  it('allows plain text queued during a plan-mode turn', () => {
    expect(canGuideQueuedMessage({
      id: 'q-plan-text',
      text: 'Also follow the hasconfig rules',
      mode: 'plan'
    })).toBe(true)
  })

  it('allows a GUI plan image payload only for a running Plan turn', () => {
    const guiPlan = {
      operation: 'refine' as const,
      workspaceRoot: '/workspace',
      relativePath: '.kunsdd/plan/auth.md',
      planId: '/workspace:.kunsdd/plan/auth.md'
    }
    const message = {
      id: 'q-plan-context',
      text: 'Use this image in the saved plan',
      displayText: 'Use this image in the saved plan',
      mode: 'plan',
      guiPlan,
      attachmentIds: ['att_image'],
      attachments: [{ id: 'att_image', kind: 'image' as const }]
    }

    expect(queuedMessageGuidancePayload(message)).toEqual({
      text: 'Use this image in the saved plan',
      displayText: 'Use this image in the saved plan',
      attachmentIds: ['att_image']
    })
    expect(queuedMessageMatchesRunningTurn(message, {
      agentSurface: 'code', mode: 'plan'
    })).toBe(true)
    expect(queuedMessageMatchesRunningTurn(message, {
      agentSurface: 'code', mode: 'agent'
    })).toBe(false)
    expect(queuedMessageMatchesRunningTurn(message, {
      agentSurface: 'code'
    })).toBe(false)
    expect(queuedMessageMatchesRunningTurn({
      id: 'q-agent', text: 'Implement after planning', mode: 'agent'
    }, {
      agentSurface: 'code', mode: 'plan'
    })).toBe(false)
    expect(queuedMessageMatchesRunningTurn({
      id: 'q-legacy', text: 'Unknown queued mode'
    }, {
      agentSurface: 'code', mode: 'plan'
    })).toBe(false)
  })

  it('uses visible Design canvas text instead of the expanded queued prompt for guidance', () => {
    const message = {
      id: 'q-design-text',
      text: 'Internal Design prompt with canvas snapshots and generation instructions',
      displayText: 'Make the title smaller',
      guiDesignCanvas: true,
      guiDesignMode: true,
      agentSurface: 'design' as const
    }

    expect(canGuideQueuedMessage(message)).toBe(true)
    expect(queuedMessageGuidancePayload(message)).toEqual({
      text: 'Make the title smaller',
      displayText: 'Make the title smaller'
    })
  })

  it('allows image attachments while rejecting documents and unbound metadata', () => {
    expect(queuedMessageGuidancePayload({
      text: 'Use this reference',
      attachmentIds: ['att_image'],
      attachments: [{ id: 'att_image', kind: 'image' }]
    })).toEqual({
      text: 'Use this reference',
      attachmentIds: ['att_image']
    })
    expect(queuedMessageGuidancePayload({
      text: 'Read this document',
      attachmentIds: ['att_document'],
      attachments: [{ id: 'att_document', kind: 'document' }]
    })).toBeNull()
    expect(queuedMessageGuidancePayload({
      text: 'Missing attachment id',
      attachments: [{ id: 'att_image', kind: 'image' }]
    })).toBeNull()
  })

  it('keeps targeted Design artifacts and canvas prompts without visible text queued', () => {
    expect(canGuideQueuedMessage({
      id: 'q-design-svg',
      text: 'Internal SVG prompt',
      displayText: 'Animate the logo',
      guiDesignMode: true,
      guiDesignArtifact: {
        kind: 'svg',
        artifactId: 'logo',
        relativePath: '.kun-design/logo/v1.svg'
      }
    })).toBe(false)
    expect(canGuideQueuedMessage({
      id: 'q-design-internal-only',
      text: 'Internal canvas prompt',
      guiDesignCanvas: true,
      guiDesignMode: true
    })).toBe(false)
  })
})
