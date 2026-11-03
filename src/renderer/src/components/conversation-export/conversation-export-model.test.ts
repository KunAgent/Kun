import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { exportGroupFor, filterExportThreads, groupExportThreads } from './conversation-export-model'

const now = new Date(2026, 9, 8, 18, 0).getTime()
const thread = (id: string, patch: Partial<NormalizedThread> = {}): NormalizedThread => ({
  id, title: id, updatedAt: new Date(2026, 9, 8, 9, 0).toISOString(), model: 'm', mode: 'agent',
  workspace: '/work/app', ...patch
})

describe('conversation export model', () => {
  it('buckets by calendar day', () => {
    expect(exportGroupFor(new Date(2026, 9, 8, 1).toISOString(), now)).toBe('today')
    expect(exportGroupFor(new Date(2026, 9, 7, 23).toISOString(), now)).toBe('yesterday')
    expect(exportGroupFor(new Date(2026, 9, 3).toISOString(), now)).toBe('week')
    expect(exportGroupFor(new Date(2026, 8, 1).toISOString(), now)).toBe('earlier')
  })

  it('filters side/archived threads, applies scope and search, sorts newest first', () => {
    const threads = [
      thread('old', { updatedAt: new Date(2026, 8, 1).toISOString() }),
      thread('side', { relation: 'side' }),
      thread('gone', { archived: true }),
      thread('design', { agentSurface: 'design' }),
      thread('other', { workspace: '/work/site' }),
      thread('fresh')
    ]
    const base = { threads, query: '', scope: 'all' as const, activeWorkspace: '/work/app', includeArchived: false, now }
    expect(filterExportThreads(base).map((t) => t.id).sort()).toEqual(['fresh', 'old', 'other'])
    expect(filterExportThreads(base).map((t) => t.id)).not.toContain('side')
    expect(filterExportThreads(base).map((t) => t.id)).not.toContain('gone')
    expect(filterExportThreads(base).map((t) => t.id)).not.toContain('design')
    expect(filterExportThreads({ ...base, includeArchived: true }).map((t) => t.id)).toContain('gone')
    expect(filterExportThreads({ ...base, scope: 'workspace' }).map((t) => t.id)).not.toContain('other')
    expect(filterExportThreads({ ...base, scope: 'week' }).map((t) => t.id)).not.toContain('old')
    expect(filterExportThreads({ ...base, query: 'SITE' }).map((t) => t.id)).toEqual(['other'])
    expect(groupExportThreads(filterExportThreads(base), now).map((g) => g.id)).toEqual(['today', 'earlier'])
  })
})
