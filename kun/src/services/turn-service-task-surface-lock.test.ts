import { describe, expect, it } from 'vitest'
import type { DesignTaskProfileInput } from '../contracts/design-task-profile.js'
import { createThreadRecord } from '../domain/thread.js'
import { createTurnRecord } from '../domain/turn.js'
import { DesignProfileLockedError, TaskSurfaceLockedError, TurnConflictError } from './turn-service-core.js'
import { legacyThreadCanClaimWrite, resolveDesignTurnAdmission } from './turn-service-design-admission.js'

const profile: DesignTaskProfileInput = {
  version: 1,
  documentTarget: { documentId: 'doc_1', boardArtifactId: 'board_1' },
  outputMedium: 'html',
  target: 'web',
  preset: 'none',
  context: { tone: [] }
}

function codeWorkbench() {
  return createThreadRecord({
    id: 'thr_mode_lock',
    title: 'Code workbench',
    workspace: '/tmp/workspace',
    model: 'test',
    agentSurface: 'code'
  })
}

describe('turn task-surface lock', () => {
  it('allows either mode before the first accepted turn', () => {
    const admission = resolveDesignTurnAdmission({
      thread: codeWorkbench(),
      request: {
        prompt: 'Design the dashboard',
        agentSurface: 'design',
        designProfile: profile,
        designDocumentTarget: profile.documentTarget
      },
      turnId: 'turn_design'
    })

    expect(admission).toMatchObject({
      effectiveSurface: 'design',
      locksProfile: true
    })
  })

  it('allows Design after the first accepted Code turn', () => {
    const thread = codeWorkbench()
    thread.turns.push({
      ...createTurnRecord({
        id: 'turn_code',
        threadId: thread.id,
        prompt: 'Inspect the code',
        model: thread.model,
        agentSurface: 'code'
      }),
      admissionCompletedAt: '2026-08-12T12:00:00.000Z'
    })

    const admission = resolveDesignTurnAdmission({
      thread,
      request: {
        prompt: 'Switch to Design',
        agentSurface: 'design',
        designProfile: profile,
        designDocumentTarget: profile.documentTarget
      },
      turnId: 'turn_design'
    })

    expect(admission).toMatchObject({ effectiveSurface: 'design', locksProfile: true })
  })

  it('allows per-turn Code and Design selection for migrated mixed history', () => {
    const thread = codeWorkbench()
    thread.turns.push({
      ...createTurnRecord({
        id: 'turn_legacy_code',
        threadId: thread.id,
        prompt: 'Legacy Code turn',
        model: thread.model,
        agentSurface: 'code'
      }),
      admissionCompletedAt: '2026-08-12T12:00:00.000Z'
    })
    thread.designProfile = { ...profile, lockedAtTurnId: 'turn_legacy_design' }

    expect(resolveDesignTurnAdmission({
      thread,
      request: { prompt: 'Switch to Code', agentSurface: 'code' },
      turnId: 'turn_code_continue'
    })).toMatchObject({ effectiveSurface: 'code', locksProfile: false })

    expect(resolveDesignTurnAdmission({
      thread,
      request: {
        prompt: 'Continue Design',
        agentSurface: 'design',
        designProfile: profile,
        designDocumentTarget: profile.documentTarget
      },
      turnId: 'turn_design_continue'
    })).toMatchObject({
      effectiveSurface: 'design',
      locksProfile: false,
      effectiveProfile: expect.objectContaining({ documentTarget: profile.documentTarget })
    })
  })

  it('ignores a failed provisional Design profile when choosing the first mode', () => {
    const thread = codeWorkbench()
    thread.turns.push(createTurnRecord({
      id: 'turn_failed_design',
      threadId: thread.id,
      prompt: 'Design admission that never committed',
      model: thread.model,
      agentSurface: 'design',
      admissionPending: true,
      status: 'failed'
    }))
    thread.designProfile = { ...profile, lockedAtTurnId: 'turn_failed_design' }

    expect(resolveDesignTurnAdmission({
      thread,
      request: { prompt: 'Start in Code', agentSurface: 'code' },
      turnId: 'turn_code'
    })).toMatchObject({ effectiveSurface: 'code', locksProfile: false })
  })

  it('rejects a mismatched Design profile with design_profile_locked', () => {
    const thread = codeWorkbench()
    thread.designProfile = { ...profile, lockedAtTurnId: 'turn_design_1' }

    expect(() => resolveDesignTurnAdmission({
      thread,
      request: {
        prompt: 'Continue Design differently',
        agentSurface: 'design',
        designProfile: { ...profile, outputMedium: 'image' },
        designDocumentTarget: profile.documentTarget
      },
      turnId: 'turn_design_2'
    })).toThrow(DesignProfileLockedError)
    try {
      resolveDesignTurnAdmission({
        thread,
        request: {
          prompt: 'Continue Design differently',
          agentSurface: 'design',
          designProfile: { ...profile, outputMedium: 'image' },
          designDocumentTarget: profile.documentTarget
        },
        turnId: 'turn_design_2'
      })
    } catch (error) {
      expect(error).toBeInstanceOf(DesignProfileLockedError)
      expect(error).toMatchObject({
        lockedAtTurnId: 'turn_design_1',
        details: {
          lockedDocumentId: 'doc_1',
          lockedBoardArtifactId: 'board_1',
          mismatch: 'profile'
        }
      })
    }
  })

  it('reuses a locked Design profile when the follow-up omits profile fields', () => {
    const thread = codeWorkbench()
    thread.designProfile = { ...profile, lockedAtTurnId: 'turn_design_1' }

    expect(resolveDesignTurnAdmission({
      thread,
      request: { prompt: 'Continue Design', agentSurface: 'design' },
      turnId: 'turn_design_2'
    })).toMatchObject({
      effectiveSurface: 'design',
      locksProfile: false,
      effectiveProfile: expect.objectContaining({
        lockedAtTurnId: 'turn_design_1',
        documentTarget: profile.documentTarget
      })
    })
  })

  it('rejects a Code turn that carries a Design profile or document target', () => {
    const thread = codeWorkbench()
    thread.turns.push({
      ...createTurnRecord({
        id: 'turn_design',
        threadId: thread.id,
        prompt: 'Design',
        model: thread.model,
        agentSurface: 'design',
        designProfile: { ...profile, lockedAtTurnId: 'turn_design' },
        designDocumentTarget: profile.documentTarget
      }),
      admissionCompletedAt: '2026-08-12T12:00:00.000Z'
    })
    thread.designProfile = { ...profile, lockedAtTurnId: 'turn_design' }

    expect(() => resolveDesignTurnAdmission({
      thread,
      request: {
        prompt: 'Back to code with a profile',
        agentSurface: 'code',
        designProfile: profile,
        designDocumentTarget: profile.documentTarget
      },
      turnId: 'turn_code_with_profile'
    })).toThrow(TurnConflictError)
  })

  it('does not let a title collision or ordinary legacy Code history claim Work', () => {
    const collision = createThreadRecord({
      id: 'thr_title_collision',
      title: 'Write Assistant',
      workspace: '/tmp/workspace',
      model: 'test'
    })
    collision.turns.push(createTurnRecord({
      id: 'turn_code',
      threadId: collision.id,
      prompt: 'Inspect the repository',
      model: collision.model
    }))

    expect(legacyThreadCanClaimWrite(collision)).toBe(false)
    expect(() => resolveDesignTurnAdmission({
      thread: collision,
      request: { prompt: 'try Work', agentSurface: 'write' },
      turnId: 'turn_rejected'
    })).toThrow(TaskSurfaceLockedError)
  })
})
