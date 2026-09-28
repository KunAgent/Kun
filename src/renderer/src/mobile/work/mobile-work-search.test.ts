import { describe, expect, it, vi } from 'vitest'
import type { WorkspaceDirectoryListResult } from '@shared/workspace-file'
import { searchMobileWorkEntries } from './mobile-work-search'

const result = (root: string, entries: { path: string; name: string; type: 'file' | 'directory' }[]): WorkspaceDirectoryListResult => ({
  ok: true, root, entries: entries.map((entry) => ({ ...entry, ext: entry.type === 'file' ? '.md' : '', size: 0, mtimeMs: 0 }))
})

describe('bounded mobile work search', () => {
  it('finds files in unopened nested directories without traversing build artifacts', async () => {
    const list = vi.fn(async (path: string): Promise<WorkspaceDirectoryListResult> => {
      if (path === '/w') return result('/w', [
        { name: 'draft', path: '/w/draft', type: 'directory' },
        { name: 'node_modules', path: '/w/node_modules', type: 'directory' }
      ])
      if (path === '/w/draft') return result('/w', [{ name: 'notes.md', path: '/w/draft/notes.md', type: 'file' }])
      throw new Error('unexpected directory')
    })
    const found = await searchMobileWorkEntries('/w', 'notes', list, () => false)
    expect(found.entries.map((entry) => entry.path)).toEqual(['/w/draft/notes.md'])
    expect(list).toHaveBeenCalledTimes(2)
    expect(found.truncated).toBe(false)
  })
  it('does not return a stale response after cancellation', async () => {
    let aborted = false
    const found = await searchMobileWorkEntries('/w', 'notes', async () => {
      aborted = true
      return result('/w', [{ name: 'notes.md', path: '/w/notes.md', type: 'file' }])
    }, () => aborted)
    expect(found.entries).toEqual([])
  })
})
