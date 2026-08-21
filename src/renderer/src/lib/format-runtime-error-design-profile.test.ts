import { beforeEach, describe, expect, it } from 'vitest'
import i18n from '../i18n'
import { describeRuntimeError } from './format-runtime-error'

describe('format design_profile_locked', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('explains that a locked Design conversation must reuse its original whiteboard', () => {
    const view = describeRuntimeError(new Error(JSON.stringify({
      code: 'design_profile_locked',
      message: 'Design task profile is locked and does not match the submitted profile',
      details: {
        lockedAtTurnId: 'turn_design_1',
        lockedDocumentId: 'doc_locked',
        lockedBoardArtifactId: 'board_locked',
        mismatch: 'profile'
      }
    })))

    expect(view.code).toBe('design_profile_locked')
    expect(view.summary).toBe(i18n.t('common:runtimeDesignProfileLocked'))
    expect(view.summary).toMatch(/original Design whiteboard/)
    expect(view.detail).toContain('lockedDocumentId')
  })
})
