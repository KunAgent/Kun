import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  compareChatFileTreeEntriesByModified,
  formatChatFileTreeUnsupportedMessage,
  isChatFileTreeIgnoredDirectory,
  isChatFileTreePreviewableEntry,
  sortChatFileTreeEntries
} from './ChatFileTreePanel'

function entry(overrides: Partial<WorkspaceEntry> & Pick<WorkspaceEntry, 'name' | 'type'>): WorkspaceEntry {
  return {
    name: overrides.name,
    type: overrides.type,
    path: overrides.path ?? `/tmp/project/${overrides.name}`,
    ext: overrides.ext ?? '',
    ...(overrides.mtimeMs === undefined ? {} : { mtimeMs: overrides.mtimeMs }),
    ...(overrides.size === undefined ? {} : { size: overrides.size })
  }
}

describe('ChatFileTreePanel helpers', () => {
  it('ignores heavyweight dependency and VCS directories', () => {
    expect(isChatFileTreeIgnoredDirectory('.git')).toBe(true)
    expect(isChatFileTreeIgnoredDirectory('node_modules')).toBe(true)
    expect(isChatFileTreeIgnoredDirectory('src')).toBe(false)
  })

  it('marks only text files as previewable', () => {
    expect(isChatFileTreePreviewableEntry(entry({ name: 'main.ts', type: 'file' }))).toBe(true)
    expect(isChatFileTreePreviewableEntry(entry({ name: 'logo.png', type: 'file' }))).toBe(false)
    expect(isChatFileTreePreviewableEntry(entry({ name: 'src', type: 'directory' }))).toBe(false)
  })

  it('formats unsupported preview titles without leaking UI state', () => {
    expect(formatChatFileTreeUnsupportedMessage('logo.png')).toContain('logo.png')
  })

  it('sorts files by newest mtime before falling back to name', () => {
    expect([
      entry({ name: 'old.md', type: 'file', mtimeMs: 100 }),
      entry({ name: 'new.md', type: 'file', mtimeMs: 300 }),
      entry({ name: 'same-b.md', type: 'file', mtimeMs: 200 }),
      entry({ name: 'same-a.md', type: 'file', mtimeMs: 200 })
    ].sort(compareChatFileTreeEntriesByModified).map((item) => item.name)).toEqual([
      'new.md',
      'same-a.md',
      'same-b.md',
      'old.md'
    ])
  })

  it('keeps directories before files in modified sort mode', () => {
    expect(sortChatFileTreeEntries([
      entry({ name: 'new.md', type: 'file', mtimeMs: 300 }),
      entry({ name: 'docs', type: 'directory', mtimeMs: 100 }),
      entry({ name: 'old.md', type: 'file', mtimeMs: 50 })
    ], 'modified').map((item) => item.name)).toEqual(['docs', 'new.md', 'old.md'])
  })
})
