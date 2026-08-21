import { describe, expect, it, vi } from 'vitest'
import { createEmptyDocument } from './canvas/canvas-types'
import { submitDesignTurn } from './design-turn-submit'
import type { DesignArtifact } from './design-types'
import type { DesignWorkspaceState } from './design-workspace-store-types'
import type { DesignTurnPromptPayload } from './design-turn-prompt/payload'
import type { PrepareDesignTurnFilesResult } from './design-turn-prompt/setup'
import type { ResolvedDesignTurnTarget } from './design-turn-prompt/target'

const now = '2026-08-17T00:00:00.000Z'
const boardArtifact: DesignArtifact & { kind: 'canvas' } = {
  id: 'board_locked',
  kind: 'canvas',
  title: 'Locked board',
  relativePath: '.kun-design/doc_locked/board_locked/canvas.json',
  createdAt: now,
  updatedAt: now,
  versions: [{
    id: 'board-v1',
    relativePath: '.kun-design/doc_locked/board_locked/canvas.json',
    createdAt: now,
    summary: ''
  }]
}

function designState(): DesignWorkspaceState {
  const state = {
    workspaceRoot: '/workspace',
    artifacts: [boardArtifact],
    activeArtifactId: boardArtifact.id,
    assistantModel: 'deepseek-chat',
    assistantProviderId: '',
    designContext: { designTarget: 'web' },
    generationPrompt: '',
    documents: [],
    activeDocumentId: 'doc_locked',
    setActiveArtifact: vi.fn(),
    setDesignIntentMode: vi.fn(),
    setFileError: vi.fn()
  } as unknown as DesignWorkspaceState
  return state
}

function resolvedTarget(): ResolvedDesignTurnTarget {
  return {
    target: 'canvas',
    artifactRelativePath: boardArtifact.relativePath,
    visibleTargets: [],
    targetAutoRepairKey: 'artifact:board_locked',
    nextIntentMode: 'modify'
  }
}

describe('submitDesignTurn locked follow-up', () => {
  it('omits profile fields so admission can reuse the lock', async () => {
    const sendMessage = vi.fn(async () => true)
    const result = await submitDesignTurn({
      promptText: 'Revise the locked board',
      displayText: 'Revise the locked board',
      workspaceRoot: '/workspace',
      source: 'user',
      sendMessage,
      resolveProviderId: () => '',
      expectedThreadId: 'thr_locked',
      boardArtifactId: 'board_locked',
      omitDesignProfileWhenUnavailable: true,
      designTaskProfileForTarget: () => undefined as never,
      getDesignState: () => designState(),
      getCanvasShapeState: () => ({ document: createEmptyDocument() }) as never,
      getCanvasSelectionState: () => ({ selectedIds: new Set<string>() }) as never,
      getCanvasViewportState: () => ({ vbox: { x: 0, y: 0, width: 1200, height: 800 } }) as never,
      resolveTarget: vi.fn(async () => resolvedTarget()),
      prepareTurnFiles: vi.fn(async (): Promise<PrepareDesignTurnFilesResult> => ({
        ok: true,
        notesWritten: false
      })),
      buildPromptPayload: vi.fn(async (): Promise<DesignTurnPromptPayload> => ({
        prompt: 'LOCKED FOLLOW-UP',
        promptState: designState()
      }))
    })

    expect(result).toEqual({ status: 'sent', target: 'canvas', clearAttachments: false })
    expect(sendMessage).toHaveBeenCalledWith(
      'LOCKED FOLLOW-UP',
      'agent',
      expect.not.objectContaining({
        designProfile: expect.anything(),
        designDocumentTarget: expect.anything()
      })
    )
  })
})
