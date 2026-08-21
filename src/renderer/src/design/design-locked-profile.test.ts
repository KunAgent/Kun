import { describe, expect, it, vi } from 'vitest'
import type { DesignTaskProfile } from '../agent/design-task-profile'
import type { NormalizedThread } from '../agent/types'
import {
  mergeThreadDesignProfile,
  preserveListedDesignProfiles,
  resolveAuthoritativeDesignProfile,
  waitForCanvasDocumentKey
} from './design-locked-profile'

function lockedProfile(documentId = 'doc_locked'): DesignTaskProfile {
  return {
    version: 1,
    documentTarget: { documentId, boardArtifactId: 'board_locked' },
    outputMedium: 'html',
    target: 'web',
    preset: 'none',
    context: { tone: [] },
    lockedAtTurnId: 'turn_design_1'
  }
}

function thread(id: string, profile?: DesignTaskProfile): NormalizedThread {
  return {
    id,
    title: id,
    updatedAt: '2026-08-17T00:00:00.000Z',
    model: 'deepseek-v4-pro',
    mode: 'agent',
    workspace: '/workspace',
    ...(profile ? { designProfile: profile } : {})
  }
}

describe('design locked profile helpers', () => {
  it('merges an authoritative lock onto the matching thread only', () => {
    const profile = lockedProfile()
    const next = mergeThreadDesignProfile(
      [thread('thr_other'), thread('thr_locked')],
      'thr_locked',
      profile
    )

    expect(next[0]).not.toHaveProperty('designProfile')
    expect(next[1]?.designProfile).toEqual(profile)
    next[1]!.designProfile!.documentTarget.documentId = 'mutated'
    expect(profile.documentTarget.documentId).toBe('doc_locked')
  })

  it('keeps a local lock when a lean list item omits designProfile', () => {
    const local = new Map([
      ['thr_locked', { designProfile: lockedProfile() }],
      ['thr_plain', {}]
    ])
    const listed = preserveListedDesignProfiles(
      [thread('thr_locked'), thread('thr_plain'), thread('thr_fresh', lockedProfile('doc_fresh'))],
      local
    )

    expect(listed[0]?.designProfile?.documentTarget.documentId).toBe('doc_locked')
    expect(listed[1]).not.toHaveProperty('designProfile')
    expect(listed[2]?.designProfile?.documentTarget.documentId).toBe('doc_fresh')
  })

  it('fetches the runtime lock when the local store snapshot is empty', async () => {
    const fetched = lockedProfile()
    const applyProfile = vi.fn()
    const fetchThreadDetail = vi.fn(async () => ({ designProfile: fetched }))

    const profile = await resolveAuthoritativeDesignProfile({
      threadId: 'thr_locked',
      localProfile: null,
      fetchThreadDetail,
      applyProfile
    })

    expect(profile).toEqual(fetched)
    expect(fetchThreadDetail).toHaveBeenCalledWith('thr_locked')
    expect(applyProfile).toHaveBeenCalledWith('thr_locked', fetched)
  })

  it('does not fetch when a local lock is already available', async () => {
    const fetchThreadDetail = vi.fn(async () => ({ designProfile: lockedProfile('doc_remote') }))
    const profile = await resolveAuthoritativeDesignProfile({
      threadId: 'thr_locked',
      localProfile: lockedProfile(),
      fetchThreadDetail
    })

    expect(profile?.documentTarget.documentId).toBe('doc_locked')
    expect(fetchThreadDetail).not.toHaveBeenCalled()
  })

  it('waits until the canvas store owns the expected document key', async () => {
    let key = 'stale'
    let listener = (): void => undefined
    const clearTimer = vi.fn()
    const waiting = waitForCanvasDocumentKey('expected', 5000, {
      getDocumentKey: () => key,
      subscribe: (next) => {
        listener = next
        return vi.fn()
      },
      setTimer: () => 1 as unknown as ReturnType<typeof setTimeout>,
      clearTimer
    })

    key = 'expected'
    listener()
    await expect(waiting).resolves.toBe(true)
    expect(clearTimer).toHaveBeenCalled()
  })

  it('reports false when the expected canvas document never becomes ready', async () => {
    let timeout = (): void => undefined
    const waiting = waitForCanvasDocumentKey('expected', 50, {
      getDocumentKey: () => 'stale',
      subscribe: () => vi.fn(),
      setTimer: (callback) => {
        timeout = callback
        return 1 as unknown as ReturnType<typeof setTimeout>
      },
      clearTimer: vi.fn()
    })

    timeout()
    await expect(waiting).resolves.toBe(false)
  })
})
