// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import {
  forgetPendingResearchSession,
  readPendingResearchSessions,
  rememberPendingResearchSession
} from './mobile-paper-research-pending'

afterEach(() => window.sessionStorage.clear())

describe('mobile unsent research sessions', () => {
  it('restores multiple drafts after remount without mixing libraries', () => {
    rememberPendingResearchSession('/library/A', 'rs-one-1234')
    rememberPendingResearchSession('/library/A', 'rs-two-1234')
    rememberPendingResearchSession('/library/B', 'rs-three-1234')
    expect(readPendingResearchSessions('/library/A')).toEqual(['rs-two-1234', 'rs-one-1234'])
    expect(readPendingResearchSessions('/library/B')).toEqual(['rs-three-1234'])
    forgetPendingResearchSession('/library/A', 'rs-two-1234')
    expect(readPendingResearchSessions('/library/A')).toEqual(['rs-one-1234'])
  })
})
