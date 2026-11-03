import { describe, expect, it } from 'vitest'
import type { WorkspaceEntry } from '@shared/workspace-file'
import {
  buildChangedFileTreeRows,
  buildChatFileTreeRows,
  rankChatFileTreeSearch,
  type ChatFileTreeDirectoryState
} from './chat-file-tree-rows'
import { createWorkspaceGitStatus } from './use-workspace-git-status'

const ROOT = '/repo'

function dir(path: string): WorkspaceEntry {
  return { name: path.split('/').pop() ?? path, path, type: 'directory', ext: '' }
}

function file(path: string): WorkspaceEntry {
  return { name: path.split('/').pop() ?? path, path, type: 'file', ext: '' }
}

function listed(entries: WorkspaceEntry[]): ChatFileTreeDirectoryState {
  return { entries, loading: false, error: null }
}

function labelsOf(rows: ReturnType<typeof buildChatFileTreeRows>['rows']): string[] {
  return rows.map((row) => (row.kind === 'entry' ? `${row.depth}:${row.labels.join('/')}` : `${row.depth}:${row.kind}`))
}

describe('file tree rows', () => {
  it('asks for the root listing first and shows a loading row', () => {
    const result = buildChatFileTreeRows({ roots: [ROOT], directories: {}, expanded: new Set(), sortMode: 'name' })
    expect(result.missing).toEqual([ROOT])
    expect(labelsOf(result.rows)).toEqual(['0:loading'])
  })

  it('merges single-folder chains into one row and hides VCS folders', () => {
    const directories = {
      [ROOT]: listed([dir('/repo/.git'), dir('/repo/src'), dir('/repo/node_modules'), file('/repo/README.md')]),
      '/repo/src': listed([dir('/repo/src/renderer')]),
      '/repo/src/renderer': listed([dir('/repo/src/renderer/lib')]),
      '/repo/src/renderer/lib': listed([file('/repo/src/renderer/lib/a.ts'), file('/repo/src/renderer/lib/b.ts')])
    }
    const { rows, missing } = buildChatFileTreeRows({ roots: [ROOT], directories, expanded: new Set(['/repo/src']), sortMode: 'name' })
    expect(missing).toEqual([])
    expect(labelsOf(rows)).toEqual(['0:node_modules', '0:src/renderer/lib', '1:a.ts', '1:b.ts', '0:README.md'])
    const chain = rows[1]
    expect(chain.kind === 'entry' && chain.togglePath).toBe('/repo/src')
    expect(chain.kind === 'entry' && chain.contentPath).toBe('/repo/src/renderer/lib')
  })

  it('requests the next folder of a chain that is not listed yet', () => {
    const directories = {
      [ROOT]: listed([dir('/repo/src')]),
      '/repo/src': listed([dir('/repo/src/renderer')])
    }
    const { rows, missing } = buildChatFileTreeRows({ roots: [ROOT], directories, expanded: new Set(['/repo/src']), sortMode: 'name' })
    expect(missing).toEqual(['/repo/src/renderer'])
    expect(labelsOf(rows)).toEqual(['0:src/renderer', '1:loading'])
  })

  it('shows empty folders and read errors in place', () => {
    const directories = {
      [ROOT]: listed([dir('/repo/empty'), dir('/repo/private')]),
      '/repo/empty': listed([]),
      '/repo/private': { entries: [], loading: false, error: 'EACCES' }
    }
    const rows = buildChatFileTreeRows({
      roots: [ROOT], directories, expanded: new Set(['/repo/empty', '/repo/private']), sortMode: 'name'
    }).rows
    expect(labelsOf(rows)).toEqual(['0:empty', '1:empty', '0:private', '1:error'])
  })

  it('builds an expanded tree of changed files without ignored entries', () => {
    const rows = buildChangedFileTreeRows([
      { path: '/repo/src/lib/a.ts', status: 'modified' },
      { path: '/repo/docs/new.md', status: 'untracked' },
      { path: '/repo/dist', status: 'ignored', directory: true },
      { path: '/repo/notes', status: 'untracked', directory: true },
      { path: '/repo/package.json', status: 'modified' }
    ], [ROOT])
    expect(rows.map((row) => (row.kind === 'entry' ? `${row.depth}:${row.entry.name}:${row.entry.type}:${row.open}` : row.kind))).toEqual([
      '0:docs:directory:true', '1:new.md:file:false', '0:notes:directory:false', '0:src:directory:true',
      '1:lib:directory:true', '2:a.ts:file:false', '0:package.json:file:false'
    ])
  })

  it('ranks search hits by name prefix, then substring, then path', () => {
    const hits = rankChatFileTreeSearch([
      { path: '/repo/src/WorkspaceFilePreviewPanel.tsx', name: 'WorkspaceFilePreviewPanel.tsx', relativePath: 'src/WorkspaceFilePreviewPanel.tsx' },
      { path: '/repo/preview/index.ts', name: 'index.ts', relativePath: 'preview/index.ts' },
      { path: '/repo/src/preview.ts', name: 'preview.ts', relativePath: 'src/preview.ts' },
      { path: '/repo/src/other.ts', name: 'other.ts', relativePath: 'src/other.ts' }
    ], 'preview')
    expect(hits.map((hit) => hit.name)).toEqual(['preview.ts', 'WorkspaceFilePreviewPanel.tsx', 'index.ts'])
    expect(hits[1].match).toEqual([13, 20])
    expect(hits[2].match).toBeNull()
    expect(hits[0].relativeDirectory).toBe('src')
  })
})

describe('workspace git status view', () => {
  it('answers per-file status, inherits folder status and marks changed ancestors', () => {
    const status = createWorkspaceGitStatus({
      available: true,
      branch: 'develop',
      entries: [
        { path: '/repo/src/lib/a.ts', status: 'modified' },
        { path: '/repo/notes', status: 'untracked', directory: true },
        { path: '/repo/dist', status: 'ignored', directory: true }
      ]
    })
    expect(status.statusFor('/repo/src/lib/a.ts')).toBe('modified')
    expect(status.statusFor('/repo/notes/todo.md')).toBe('untracked')
    expect(status.statusFor('/repo/dist/bundle.js')).toBe('ignored')
    expect(status.statusFor('/repo/README.md')).toBeNull()
    expect(status.hasChangesUnder('/repo/src')).toBe(true)
    expect(status.hasChangesUnder('/repo/dist')).toBe(false)
    expect(status.changed).toHaveLength(2)
  })
})
