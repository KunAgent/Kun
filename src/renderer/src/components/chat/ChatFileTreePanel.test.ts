import { describe, expect, it, vi } from 'vitest'
import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry
} from '@shared/workspace-file'
import {
  compareChatFileTreeEntriesByModified,
  formatChatFileTreeUnsupportedMessage,
  isChatFileTreeIgnoredDirectory,
  isChatFileTreePreviewableEntry,
  scanChatFileTreeRecentFiles,
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

function directory(entries: WorkspaceEntry[]): WorkspaceDirectoryListResult {
  return {
    ok: true,
    root: '/tmp/project',
    entries
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

  it('rescans recent files instead of reusing the previous refresh result', async () => {
    const root = '/tmp/project'
    const snapshots = [
      directory([entry({ name: 'old.md', type: 'file', path: `${root}/old.md`, mtimeMs: 100 })]),
      directory([entry({ name: 'new.md', type: 'file', path: `${root}/new.md`, mtimeMs: 200 })])
    ]
    let snapshotIndex = 0
    const listWorkspaceDirectory = vi.fn(
      async (_target: WorkspaceDirectoryTarget): Promise<WorkspaceDirectoryListResult> => snapshots[snapshotIndex]
    )

    await expect(scanChatFileTreeRecentFiles(root, listWorkspaceDirectory)).resolves.toMatchObject([
      { name: 'old.md' }
    ])
    snapshotIndex = 1
    await expect(scanChatFileTreeRecentFiles(root, listWorkspaceDirectory)).resolves.toMatchObject([
      { name: 'new.md' }
    ])

    expect(listWorkspaceDirectory).toHaveBeenCalledTimes(2)
    expect(listWorkspaceDirectory.mock.calls.map(([target]) => target)).toEqual([
      { workspaceRoot: root, path: root },
      { workspaceRoot: root, path: root }
    ])
  })
})
