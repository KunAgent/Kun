import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { NormalizedThread } from '../agent/types'
import { SettingsSidebar } from './SettingsSidebar'
import {
  ArchivedThreadsSettingsSection,
  archivedThreadDisplayTitle,
  filterArchivedThreads
} from './settings-section-archives'

function thread(overrides: Partial<NormalizedThread> & Pick<NormalizedThread, 'id'>): NormalizedThread {
  return {
    id: overrides.id,
    title: overrides.title ?? overrides.id,
    updatedAt: overrides.updatedAt ?? '2026-06-01T00:00:00.000Z',
    model: overrides.model ?? 'deepseek-chat',
    mode: overrides.mode ?? 'agent',
    workspace: overrides.workspace ?? '/Users/zxy/project-a',
    ...(overrides.archived !== undefined ? { archived: overrides.archived } : {}),
    ...(overrides.preview ? { preview: overrides.preview } : {})
  }
}

const labels: Record<string, string> = {
  title: 'Settings',
  back: 'Back',
  settingsGroupCore: 'Basics',
  settingsGroupWorkbench: 'Workbench',
  settingsGroupIntelligence: 'Intelligence',
  settingsGroupData: 'Data',
  settingsGroupSystem: 'System',
  general: 'General',
  providers: 'Providers',
  write: 'Work',
  agents: 'AI assistant',
  subagents: 'Subagents',
  archives: 'Archived chats',
  keyboardShortcuts: 'Keyboard shortcuts',
  claw: 'Connect phone',
  settingsFooter: 'Settings',
  archivesTitle: 'Archived chats',
  archivesOverview: 'Archived chat history',
  archivesOverviewDesc: 'Review archived chats.',
  archivesSearchPlaceholder: 'Search archived chats',
  archivesCount: '{{count}} archived',
  archivesWorkspaceCount: '{{count}} chats',
  archivesEmpty: 'No archived chats yet.',
  archivesSearchEmpty: 'No archived chats match your search.',
  archivesOffline: 'Connect the local runtime to refresh archived chats.',
  archivesUntitled: 'Untitled chat',
  archivesRestore: 'Restore',
  archivesDelete: 'Delete archived chat',
  sidebarThreadRestore: 'Restore thread',
  sidebarThreadDelete: 'Delete thread'
}

function t(key: string, options?: Record<string, unknown>): string {
  const template = labels[key] ?? key
  return template.replace(/\{\{(\w+)\}\}/g, (_, name: string) => String(options?.[name] ?? ''))
}

describe('ArchivedThreadsSettingsSection', () => {
  it('maps the stable Write Assistant title to the Work product label', () => {
    const archivedWriteThread = {
      ...thread({ id: 'write-thread', archived: true }),
      agentSurface: 'write',
      title: 'Write Assistant'
    } satisfies NormalizedThread

    expect(archivedThreadDisplayTitle(archivedWriteThread, 'Work assistant')).toBe('Work assistant')
    expect(filterArchivedThreads([archivedWriteThread], 'Work assistant', 'Work assistant'))
      .toEqual([archivedWriteThread])
  })

  it('filters archived threads by title, preview, workspace, and model', () => {
    const archived = thread({
      id: 'archived',
      title: 'Plan launch',
      preview: 'Contains release checklist',
      archived: true,
      model: 'deepseek-v4-pro'
    })
    const active = thread({
      id: 'active',
      title: 'Plan launch',
      archived: false
    })

    expect(filterArchivedThreads([archived, active], 'release').map((item) => item.id)).toEqual(['archived'])
    expect(filterArchivedThreads([archived, active], 'deepseek-v4').map((item) => item.id)).toEqual(['archived'])
    expect(filterArchivedThreads([archived, active], 'Plan').map((item) => item.id)).toEqual(['archived'])
  })

  it('renders archived chats with restore and delete actions', () => {
    const html = renderToStaticMarkup(createElement(ArchivedThreadsSettingsSection, {
      ctx: {
        t,
        tCommon: t,
        threads: [
          thread({
            id: 'archived-a',
            title: 'Archived feature work',
            archived: true,
            preview: 'Move archived conversations into settings'
          })
        ],
        runtimeReady: true,
        locale: 'en-US',
        refreshThreads: async () => undefined,
        openCode: async () => undefined,
        selectThread: async () => undefined,
        archiveThread: async () => undefined,
        deleteThread: async () => undefined
      }
    }))

    expect(html).toContain('Archived chats')
    expect(html).toContain('Archived feature work')
    expect(html).toContain('Move archived conversations into settings')
    expect(html).toContain('Restore')
    expect(html).toContain('Delete archived chat')
  })

  it('keeps subagents between the AI assistant and archived chats without a standalone permissions tab', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'archives',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    const agentsIndex = html.indexOf('AI assistant')
    const subagentsIndex = html.indexOf('Subagents')
    const archivesIndex = html.indexOf('Archived chats')
    const migrationIndex = html.indexOf('dataMigration')
    const permissionsIndex = html.indexOf('permissions')
    expect(agentsIndex).toBeGreaterThanOrEqual(0)
    expect(subagentsIndex).toBeGreaterThan(agentsIndex)
    expect(permissionsIndex).toBe(-1)
    expect(archivesIndex).toBeGreaterThan(subagentsIndex)
    expect(migrationIndex).toBeGreaterThan(archivesIndex)
    // The local speech provider lives under Media, not in its own entry. The
    // sidebar renders each item's labelKey, and the stub echoes unknown keys.
    expect(html.indexOf('speechToText')).toBeGreaterThanOrEqual(0)
    expect(html).not.toContain('speakTitle')
    expect(html).not.toContain('settingsNavSpeak')
    expect(html.match(/data-cursor-spotlight-target/g)?.length).toBe(21)
  })

  it('groups compact settings navigation without pushing the footer away', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'shortcuts',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    expect(html).toContain('flex h-full min-h-0 w-[260px]')
    expect(html).toContain('min-h-0 flex-1 overflow-y-auto overscroll-contain')
    expect(html).toContain('ds-no-drag shrink-0 border-t border-ds-border px-5 py-3.5')
    expect(html).toContain('group flex h-9 w-full')
    expect(html).toContain('aria-current="page"')
    expect(html.indexOf('Basics')).toBeLessThan(html.indexOf('Workbench'))
    expect(html.indexOf('Workbench')).toBeLessThan(html.indexOf('Intelligence'))
    expect(html.indexOf('Intelligence')).toBeLessThan(html.indexOf('Data'))
    expect(html.indexOf('Data')).toBeLessThan(html.indexOf('System'))
    expect(html).toContain('Kun')
    expect(html).toContain('Settings')
  })
})
