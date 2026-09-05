import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import type { DesignTaskProfile } from '../../agent/design-task-profile'
import type { NormalizedThread } from '../../agent/types'
import { ThreadRow } from './SidebarProjectRows'

vi.mock('react-i18next', () => ({
  initReactI18next: { type: '3rdParty', init: vi.fn() },
  useTranslation: () => ({ t: (key: string) => key })
}))

const designProfile: DesignTaskProfile = {
  version: 1,
  documentTarget: { documentId: 'doc-design', boardArtifactId: 'board-design' },
  outputMedium: 'html',
  target: 'web',
  preset: 'none',
  context: { tone: [] },
  lockedAtTurnId: 'turn-design'
}

function renderThread(overrides: Partial<NormalizedThread>): string {
  const thread: NormalizedThread = {
    id: 'thread-1',
    title: 'Design task',
    updatedAt: '2026-08-13T00:00:00.000Z',
    model: 'test-model',
    mode: 'agent',
    workspace: '/workspace',
    ...overrides
  }
  return renderToStaticMarkup(createElement(ThreadRow, {
    thread,
    active: false,
    deleting: false,
    locale: 'en-US',
    showRunning: false,
    showUnread: false,
    onSelect: () => undefined,
    onContextMenu: () => undefined,
    onPreviewOpen: () => undefined,
    onPreviewClose: () => undefined,
    onPin: () => undefined,
    onRename: () => undefined,
    onArchive: () => undefined,
    onDelete: () => undefined,
    onRestore: () => undefined
  }))
}

describe('ThreadRow mode-neutral presentation', () => {
  it.each([
    ['legacy Design ownership', { agentSurface: 'design' }],
    ['mixed Code and Design turns', { agentSurface: 'code', designProfile }],
    ['a stale locked task surface', { agentSurface: 'code', lockedTaskSurface: 'design' }],
    ['Code ownership', { agentSurface: 'code', lockedTaskSurface: 'code' }]
  ] satisfies Array<[string, Partial<NormalizedThread>]>)('does not render a mode logo for %s', (_label, overrides) => {
    const html = renderThread(overrides)

    expect(html).not.toContain('data-thread-task-surface')
    expect(html).not.toContain('lucide-code-2')
    expect(html).not.toContain('lucide-palette')
    expect(html).not.toContain('taskTypeCode')
    expect(html).not.toContain('taskTypeDesign')
  })
})
