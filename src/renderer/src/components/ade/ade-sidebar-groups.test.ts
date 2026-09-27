import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import type { ActivityRow } from '@shared/activity-row'
import {
  ADE_STATUS_GROUP_ORDER,
  adeStatusGroup,
  groupByProject,
  indexAdeThreads,
  threadDisplayBuckets
} from './ade-sidebar-groups'

function thread(partial: Partial<NormalizedThread>): NormalizedThread {
  return {
    id: 'thr_x', title: 't', workspace: '/repo/proj', createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z', turns: [], ...partial
  } as NormalizedThread
}

function row(partial: Partial<ActivityRow>): ActivityRow {
  return {
    unitId: 'u1', kind: 'worker', threadId: 'w', harnessId: 'kun', title: 'w',
    workspace: { path: '/repo', kind: 'worktree' },
    state: 'done', mainState: 'done', children: { working: 0, waiting: 0, done: 0, failed: 0 },
    stateSince: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
    provenance: 'runtime', restoredUnconfirmed: false, stalled: false,
    visibility: 'active', residency: 'live', pinned: false,
    ...partial
  } as ActivityRow
}

describe('adeStatusGroup', () => {
  it('orders attention > review > running > done > idle', () => {
    const t = thread({})
    const now = Date.parse('2026-01-01T00:10:00Z')
    const doneReviewable = row({ parentThreadId: t.id, stateSince: '2026-01-01T00:09:00Z' })
    expect(adeStatusGroup(t, 'read', threadDisplayBuckets({ u1: doneReviewable }, t.id, now))).toBe('review')
    const waiting = row({ parentThreadId: t.id, state: 'waiting', stateSince: '2026-01-01T00:09:00Z' })
    expect(adeStatusGroup(t, 'read', threadDisplayBuckets({ u1: waiting }, t.id, now))).toBe('attention')
    const working = row({ parentThreadId: t.id, state: 'working' })
    expect(adeStatusGroup(t, 'read', threadDisplayBuckets({ u1: working }, t.id, now))).toBe('running')
    const donePlain = row({ parentThreadId: t.id, kind: 'thread', workspace: { path: '/r', kind: 'local' }, stateSince: '2026-01-01T00:09:00Z' })
    expect(adeStatusGroup(t, 'read', threadDisplayBuckets({ u1: donePlain }, t.id, now))).toBe('done')
    expect(adeStatusGroup(t, 'read', new Set())).toBe('idle')
    expect(adeStatusGroup(t, 'awaiting-input', new Set())).toBe('attention')
    // attention beats review when both buckets exist
    expect(adeStatusGroup(t, 'read', threadDisplayBuckets({ a: waiting, b: doneReviewable }, t.id, now))).toBe('attention')
  })
})

describe('indexAdeThreads', () => {
  it('nests workers under a present parent and keeps orphans as roots', () => {
    const mgr = thread({ id: 'thr_mgr' })
    const w1 = thread({ id: 'thr_w1', parentThreadId: 'thr_mgr' })
    const w2 = thread({ id: 'thr_w2', parentThreadId: 'thr_mgr' })
    const orphan = thread({ id: 'thr_o', parentThreadId: 'thr_gone' })
    const { roots, childrenByParent } = indexAdeThreads([mgr, w1, w2, orphan])
    expect(roots.map((t) => t.id)).toEqual(['thr_mgr', 'thr_o'])
    expect(childrenByParent.get('thr_mgr')?.map((t) => t.id)).toEqual(['thr_w1', 'thr_w2'])
  })
})

describe('groupByProject', () => {
  it('groups by workspace basename, sorted alphabetically', () => {
    const a = thread({ id: 'a', workspace: '/repo/alpha' })
    const b = thread({ id: 'b', workspace: '/repo/beta' })
    const c = thread({ id: 'c', workspace: '/repo/alpha/' })
    const groups = groupByProject([b, a, c])
    expect(groups.map((g) => g.label)).toEqual(['alpha', 'beta'])
    expect(groups[0]!.items.map((t) => t.id)).toEqual(['a', 'c'])
  })
})

describe('ADE_STATUS_GROUP_ORDER', () => {
  it('keeps the doc order: attention, review, running, done, idle', () => {
    expect([...ADE_STATUS_GROUP_ORDER]).toEqual(['attention', 'review', 'running', 'done', 'idle'])
  })
})
