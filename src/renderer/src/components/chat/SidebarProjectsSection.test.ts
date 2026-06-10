import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { NormalizedThread } from '../../agent/types'
import { buildSidebarWorkspaceGroups, SddDraftHistoryRows, ThreadRenameDialog } from './SidebarProjectsSection'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id' | 'workspace'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'reasonix',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace,
    ...(overrides.preview ? { preview: overrides.preview } : {}),
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {})
  }
}

describe('SidebarProjectsSection groups', () => {
  it('keeps remembered code workspaces visible even when the runtime lists only one workspace', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/project-b',
        '/Users/zxy/project-c'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/project-b',
      '/Users/zxy/project-c'
    ])
    expect(groups[1]?.[1]).toEqual([])
    expect(groups[2]?.[1]).toEqual([])
  })

  it('does not show registry-only empty workspaces while searching or viewing archives', () => {
    const base = {
      threads: [thread({ id: 'reasonix-current', workspace: '/Users/zxy/project-a' })],
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: ['/Users/zxy/project-b']
    }

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: 'project',
        showArchived: false
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])

    expect(
      buildSidebarWorkspaceGroups({
        ...base,
        searchQuery: '',
        showArchived: true
      }).map(([workspace]) => workspace)
    ).toEqual(['/Users/zxy/project-a'])
  })

  it('shows the default workspace while filtering write workspaces from code project groups', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'code-current', workspace: '/Users/zxy/project-a' }),
        thread({ id: 'default-code', workspace: '/Users/zxy/.deepseekgui/default_workspace' }),
        thread({ id: 'write-assistant', workspace: '~/.deepseekgui/write_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: '/Users/zxy/project-a',
      workspaceRoots: [
        '/Users/zxy/project-a',
        '/Users/zxy/.deepseekgui/default_workspace',
        '~/.deepseekgui/write_workspace'
      ]
    })

    expect(groups.map(([workspace]) => workspace)).toEqual([
      '/Users/zxy/project-a',
      '/Users/zxy/.deepseekgui/default_workspace'
    ])
    expect(groups[1]?.[1].map((item) => item.id)).toEqual(['default-code'])
  })

  it('merges default workspace aliases into one sidebar group', () => {
    const groups = buildSidebarWorkspaceGroups({
      threads: [
        thread({ id: 'default-short', workspace: '~/.deepseekgui/default_workspace' }),
        thread({ id: 'default-absolute', workspace: 'C:\\Users\\zxy\\.deepseekgui\\default_workspace' })
      ],
      searchQuery: '',
      showArchived: false,
      workspaceRoot: 'C:\\Users\\zxy\\.deepseekgui\\default_workspace',
      workspaceRoots: [
        '~/.deepseekgui/default_workspace',
        'C:\\Users\\zxy\\.deepseekgui\\default_workspace'
      ]
    })

    expect(groups).toHaveLength(1)
    expect(groups[0]?.[0]).toBe('C:\\Users\\zxy\\.deepseekgui\\default_workspace')
    expect(groups[0]?.[1].map((item) => item.id)).toEqual(['default-short', 'default-absolute'])
  })
})

describe('ThreadRenameDialog', () => {
  it('renders an in-app rename form with the current thread title prefilled', () => {
    const html = renderToStaticMarkup(
      createElement(ThreadRenameDialog, {
        state: {
          thread: thread({
            id: 'thr_rename',
            title: 'Build rename dialog',
            workspace: '/Users/zxy/project-a'
          }),
          value: 'Build rename dialog',
          submitting: false
        },
        onClose: vi.fn(),
        onValueChange: vi.fn(),
        onSubmit: vi.fn(),
        t: (key: string) => key
      })
    )

    expect(html).toContain('role="dialog"')
    expect(html).toContain('sidebarThreadRename')
    expect(html).toContain('value="Build rename dialog"')
    expect(html).toContain('type="submit" disabled=""')
  })
})

describe('SddDraftHistoryRows', () => {
  it('renders requirement draft history rows', () => {
    const html = renderToStaticMarkup(
      createElement(SddDraftHistoryRows, {
        items: [{
          id: '/tmp/app:.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
          workspaceRoot: '/tmp/app',
          relativePath: '.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md',
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-02T00:00:00.000Z',
          title: 'Export requirement',
          source: 'remembered'
        }],
        activeDraftId: '',
        onOpen: vi.fn(),
        t: (key: string, opts?: Record<string, unknown>) =>
          key === 'sddDraftHistoryOpen' ? `Open ${String(opts?.title)}` : key
      })
    )

    expect(html).toContain('sddDraftHistoryTitle')
    expect(html).toContain('Export requirement')
    expect(html).toContain('.kunsdd/draft/123e4567-e89b-12d3-a456-426614174000/requirement.md')
    expect(html).toContain('Open Export requirement')
  })
})
