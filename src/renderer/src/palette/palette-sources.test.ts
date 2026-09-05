import { describe, expect, it } from 'vitest'
import type { TFunction } from 'i18next'
import { resolveKeyboardShortcutBindings } from '@shared/keyboard-shortcuts'
import { ExtensionContributionsSchema } from '@kun/extension-api'
import {
  ContributionRegistry,
  ExtensionWorkbenchSnapshotSchema,
  type ExtensionRightRailViewEntry
} from '../extensions/contribution-registry'
import type { AppRoute, SettingsRouteSection } from '../store/chat-store-types'
import type { PaletteThreadLike, PaletteSourcesInput } from './palette-sources'
import {
  collectPaletteSources,
  excludeDuplicateThreadMatches,
  threadContentMatchEntries,
  THREAD_SOURCE_SCAN_CAP
} from './palette-sources'

const t = ((key: string): string => key) as TFunction
const tSettings = (key: string): string => key

function baseInput(overrides: Partial<PaletteSourcesInput> = {}): PaletteSourcesInput {
  return {
    t,
    tSettings,
    route: 'chat',
    workspaceRoot: '/Users/demo/project',
    threads: [],
    codeWorkspaceRoots: [],
    runtimeReady: true,
    busy: false,
    activeThreadId: null,
    activeThreadArchived: false,
    canOpenGoalPanel: true,
    canCreateNewThread: true,
    hasPlanCommand: true,
    hasBtwCommand: true,
    hideBtwCommand: false,
    hasReviewCommand: true,
    skillCommands: [],
    disabledSkillIds: [],
    extensionRightRailItems: [],
    shortcutBindings: resolveKeyboardShortcutBindings(null, 'darwin'),
    hasComposerDraft: false,
    composerModel: 'deepseek-v4-flash',
    composerModelGroups: [
      { providerId: 'deepseek', label: 'DeepSeek', modelIds: ['deepseek-v4-flash', 'deepseek-v4'] },
      { providerId: 'anthropic', label: 'Anthropic', modelIds: ['claude-sonnet-5'] }
    ],
    activeThreadPinned: false,
    ...overrides
  }
}

function rightRailEntries(trusted: boolean): ExtensionRightRailViewEntry[] {
  const registry = new ContributionRegistry()
  registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
    schemaVersion: 1,
    revision: 1,
    extensions: [{
      id: 'acme.issues',
      version: '1.0.0',
      workspaceTrusted: trusted,
      grantedPermissions: ['ui.views', 'webview'],
      // Untrusted workspaces surface only bounded discovery launchers, whose
      // ids must not collide with any contributes declaration.
      contributes: ExtensionContributionsSchema.parse(trusted
        ? {
            'views.rightSidebar': [{
              id: 'issues',
              title: 'Issues',
              entry: 'dist/index.html',
              icon: 'assets/issues.svg',
              showInRightRail: true,
              order: 10
            }]
          }
        : {}),
      rightRailDiscovery: trusted
        ? {}
        : {
            views: [{
              id: 'issues',
              title: 'Issues',
              icon: 'assets/issues.svg',
              showInRightRail: true,
              order: 10
            }]
          }
    }]
  }))
  return registry.listRightRailViewEntries({ workspaceOpen: true })
}

function thread(id: string, title: string, updatedAt: string, extra: Partial<PaletteThreadLike> = {}): PaletteThreadLike {
  return { id, title, updatedAt, archived: false, ...extra }
}

describe('collectPaletteSources', () => {
  it('aggregates every source kind with stable entry ids', () => {
    const entries = collectPaletteSources(baseInput({
      threads: [thread('t1', 'Fix build', '2026-01-03T00:00:00Z')],
      codeWorkspaceRoots: ['/Users/demo/project'],
      extensionRightRailItems: rightRailEntries(false)
    }))
    const sources = new Set(entries.map((entry) => entry.source))
    expect(sources).toEqual(new Set([
      'shortcut-command', 'slash-command', 'route', 'settings', 'thread', 'workspace',
      'extension-view', 'model'
    ]))
    const ids = new Set(entries.map((entry) => entry.id))
    expect(ids.size).toBe(entries.length)
  })

  it('lists every configured model and marks the active one', () => {
    const entries = collectPaletteSources(baseInput())
    const models = entries.filter((entry) => entry.source === 'model')
    expect(models.map((entry) => entry.title))
      .toEqual(['deepseek-v4-flash', 'deepseek-v4', 'claude-sonnet-5'])
    expect(models[0].badge).toBe('paletteModelActiveBadge')
    expect(models[1].badge).toBeUndefined()
    expect(models[2].subtitle).toBe('Anthropic')
    expect(models[2].activation).toEqual({
      kind: 'select-model', modelId: 'claude-sonnet-5', providerId: 'anthropic'
    })
    // The provider is searchable, so "anthropic" narrows to its models.
    expect(models[2].keywords).toContain('anthropic')
  })

  it('offers reversible actions on the active conversation, but never delete', () => {
    const entries = collectPaletteSources(baseInput({ activeThreadId: 'thr_1' }))
    const actions = entries.filter((entry) => entry.source === 'action')
    expect(actions.map((entry) => entry.id)).toEqual(['action:pin', 'action:archive'])
    expect(actions[0].activation).toEqual({
      kind: 'thread-action', action: 'pin', threadId: 'thr_1'
    })
    // Deleting from a fuzzy-matched row is a trap; the sidebar keeps that
    // behind an explicit confirmation instead.
    expect(entries.some((entry) => JSON.stringify(entry.activation).includes('delete')))
      .toBe(false)
  })

  it('flips the pin action for an already pinned conversation', () => {
    const entries = collectPaletteSources(
      baseInput({ activeThreadId: 'thr_1', activeThreadPinned: true })
    )
    const pin = entries.find((entry) => entry.id === 'action:pin')
    expect(pin?.activation).toEqual({
      kind: 'thread-action', action: 'unpin', threadId: 'thr_1'
    })
  })

  it('offers no conversation actions without an active or unarchived thread', () => {
    expect(collectPaletteSources(baseInput({ activeThreadId: null }))
      .some((entry) => entry.source === 'action')).toBe(false)
    expect(collectPaletteSources(
      baseInput({ activeThreadId: 'thr_1', activeThreadArchived: true })
    ).some((entry) => entry.source === 'action')).toBe(false)
  })

  it('lists every settings destination without a palette registration', () => {
    const entries = collectPaletteSources(baseInput())
    const sections = entries
      .filter((entry) => entry.source === 'settings')
      .map((entry) => entry.activation.kind === 'settings' ? entry.activation.section : null)
      .filter((section): section is SettingsRouteSection => Boolean(section))
    expect(sections).toContain('general')
    expect(sections).toContain('providers')
    expect(sections).toContain('shortcuts')
    expect(sections).toContain('dataMigration')
    for (const entry of entries.filter((candidate) => candidate.source === 'settings')) {
      expect(entry.title).not.toBe('')
    }
  })

  it('lists every top-level route with its localized label key', () => {
    const entries = collectPaletteSources(baseInput({ projectBoardEnabled: true }))
    const routes = entries
      .filter((entry) => entry.source === 'route')
      .map((entry) => entry.activation.kind === 'route' ? entry.activation.route : null)
      .filter((route): route is AppRoute => Boolean(route))
    expect(routes.sort()).toEqual([
      'board', 'chat', 'claw', 'design', 'extensions', 'plugins', 'schedule', 'settings', 'workflow', 'write'
    ])
    expect(entries.find((entry) => entry.id === 'route:workflow')?.title).toBe('workflowCreate')
  })

  it('hides the board route while the Laboratory project board switch is off', () => {
    const entries = collectPaletteSources(baseInput())
    expect(entries.some((entry) => entry.id === 'route:board')).toBe(false)
  })

  it('includes every shortcut command except the palette itself', () => {
    const entries = collectPaletteSources(baseInput())
    const commands = entries.filter((entry) => entry.source === 'shortcut-command')
    expect(commands.some((entry) => entry.id === 'cmd:new-chat')).toBe(true)
    // Opening the palette from inside the palette is not a destination.
    expect(commands.some((entry) => entry.id === 'cmd:command-palette')).toBe(false)
    expect(commands.find((entry) => entry.id === 'cmd:new-chat')?.badge).toBe('Ctrl+N')
  })

  it('lists unbound commands without a binding badge instead of hiding them', () => {
    const entries = collectPaletteSources(baseInput())
    const commands = entries.filter((entry) => entry.source === 'shortcut-command')
    // `minimize` and `toggle-maximize` ship with no default chord, which is
    // exactly when a palette is the only way to reach them.
    for (const id of ['cmd:minimize', 'cmd:toggle-maximize']) {
      const entry = commands.find((candidate) => candidate.id === id)
      expect(entry).toBeDefined()
      expect(entry?.badge).toBeUndefined()
    }
  })

  it('builds slash entries from the shared catalog with insert text and disabled reasons', () => {
    const entries = collectPaletteSources(baseInput({
      skillCommands: [{ id: 'ppt', name: 'PPT Master', description: 'make decks', scope: 'global' }]
    }))
    const newCommand = entries.find((entry) => entry.id === 'slash:new')
    expect(newCommand?.activation.kind === 'slash-command' && newCommand.activation.insertText).toBe('/new')
    expect(newCommand?.badge).toBe('/new')

    const skill = entries.find((entry) => entry.id === 'slash:skill:ppt')
    expect(skill?.activation.kind === 'slash-command' && skill.activation.insertText).toBe('/skill:ppt ')
    expect(skill?.activation.kind === 'slash-command' && skill.activation.commandId).toBe('skill:ppt')

    const research = entries.find((entry) => entry.id === 'slash:research')
    expect(research?.activation.kind === 'slash-command' && research.activation.insertText).toBe('/research ')
    expect(research?.disabledReason).toBeUndefined()

    const disabled = collectPaletteSources(baseInput({ runtimeReady: false }))
      .find((entry) => entry.id === 'slash:research')
    expect(disabled?.disabled).toBe(true)
    expect(disabled?.disabledReason).toBe('paletteDisabledDefault')
  })

  it('scans threads recency-first, skips archived threads, and enforces the scan cap', () => {
    const many = Array.from({ length: THREAD_SOURCE_SCAN_CAP + 20 }, (_, index) =>
      thread('t' + index, 'Thread ' + index, new Date(Date.UTC(2026, 0, 1, 0, 0, index)).toISOString())
    )
    const archived = thread('archived', 'Archived', '2030-01-01T00:00:00Z', { archived: true })
    const entries = collectPaletteSources(baseInput({ threads: [...many, archived] }))
    const threadEntries = entries.filter((entry) => entry.source === 'thread')
    expect(threadEntries).toHaveLength(THREAD_SOURCE_SCAN_CAP)
    expect(threadEntries[0].id).toBe('thread:t' + (THREAD_SOURCE_SCAN_CAP + 19))
    expect(threadEntries.some((entry) => entry.id === 'thread:archived')).toBe(false)
  })

  it('marks unreviewed extension contributions locked with bounded metadata', () => {
    const entries = collectPaletteSources(baseInput({
      extensionRightRailItems: rightRailEntries(false)
    }))
    const locked = entries.find((entry) => entry.source === 'extension-view')
    expect(locked?.id).toBe('ext:extension:acme.issues/issues')
    expect(locked?.activation).toEqual({
      kind: 'extension-view',
      entryId: 'extension:acme.issues/issues',
      locked: true
    })
    expect(locked?.badge).toBe('paletteLockedBadge')
    expect(locked?.subtitle).toBe('paletteLockedReason')
    expect(locked?.icon).toEqual({
      kind: 'extension',
      extensionId: 'acme.issues',
      iconPath: 'assets/issues.svg'
    })
  })

  it('marks trusted extension contributions unlocked', () => {
    const entries = collectPaletteSources(baseInput({
      extensionRightRailItems: rightRailEntries(true)
    }))
    const unlocked = entries.find((entry) => entry.source === 'extension-view')
    expect(unlocked?.activation).toEqual({
      kind: 'extension-view',
      entryId: 'extension:acme.issues/issues',
      locked: false
    })
    expect(unlocked?.badge).toBeUndefined()
  })

  it('omits disabled extension contributions', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      extensions: [{
        id: 'acme.disabled',
        version: '1.0.0',
        workspaceTrusted: false,
        enabled: false,
        grantedPermissions: ['ui.views', 'webview'],
        contributes: ExtensionContributionsSchema.parse({}),
        rightRailDiscovery: {
          views: [{ id: 'panel', title: 'Panel', icon: 'a.svg', showInRightRail: true, order: 1 }]
        }
      }]
    }))
    const entries = collectPaletteSources(baseInput({
      extensionRightRailItems: registry.listRightRailViewEntries({ workspaceOpen: true })
    }))
    expect(entries.some((entry) => entry.source === 'extension-view')).toBe(false)
  })

  it('falls back to a host icon when an extension declares none', () => {
    const registry = new ContributionRegistry()
    registry.replaceExtensions(ExtensionWorkbenchSnapshotSchema.parse({
      schemaVersion: 1,
      revision: 1,
      extensions: [{
        id: 'acme.plain',
        version: '1.0.0',
        workspaceTrusted: false,
        grantedPermissions: ['ui.views', 'webview'],
        contributes: ExtensionContributionsSchema.parse({}),
        rightRailDiscovery: {
          views: [{ id: 'panel', title: 'Panel', showInRightRail: true, order: 1 }]
        }
      }]
    }))
    const entries = collectPaletteSources(baseInput({
      extensionRightRailItems: registry.listRightRailViewEntries({ workspaceOpen: true })
    }))
    const entry = entries.find((candidate) => candidate.source === 'extension-view')
    expect(entry?.icon?.kind).toBe('lucide')
  })

  it('omits a source that cannot resolve and keeps the others', () => {
    const entries = collectPaletteSources(baseInput({ extensionRightRailItems: [] }))
    expect(entries.some((entry) => entry.source === 'extension-view')).toBe(false)
    expect(entries.some((entry) => entry.source === 'route')).toBe(true)
    expect(entries.some((entry) => entry.source === 'settings')).toBe(true)
  })

  it('maps deep-search matches to selectable conversation entries', () => {
    const entries = threadContentMatchEntries([
      {
        threadId: 'thr_1',
        title: ' Payment flow ',
        snippet: ' …checkout must be faster… ',
        workspace: '/Users/demo/mocklyst'
      }
    ])
    expect(entries).toHaveLength(1)
    expect(entries[0].id).toBe('content:thr_1')
    expect(entries[0].title).toBe('Payment flow')
    expect(entries[0].subtitle).toBe('…checkout must be faster…')
    expect(entries[0].activation).toEqual({ kind: 'thread', threadId: 'thr_1' })
  })

  it('badges each match with the project it belongs to', () => {
    // Content search spans every project, so a row from elsewhere must say so
    // rather than looking like a conversation in the current project.
    const entries = threadContentMatchEntries([
      { threadId: 'thr_1', title: 'A', snippet: 's', workspace: '/Users/demo/mocklyst' },
      { threadId: 'thr_2', title: 'B', snippet: 's', workspace: '/Users/demo/kun/' },
      { threadId: 'thr_3', title: 'C', snippet: 's' }
    ])
    expect(entries.map((entry) => entry.badge)).toEqual(['mocklyst', 'kun', undefined])
    // The project name is searchable too, so "mocklyst checkout" narrows down.
    expect(entries[0].keywords).toContain('mocklyst')
  })

  it('drops content matches already surfaced by the regular thread source', () => {
    const ranked = [{
      id: 'thread:thr_1',
      source: 'thread' as const,
      title: 'Payment flow',
      keywords: [],
      activation: { kind: 'thread' as const, threadId: 'thr_1' }
    }]
    const matches = threadContentMatchEntries([
      { threadId: 'thr_1', title: 'Payment flow', snippet: 'checkout' },
      { threadId: 'thr_2', title: 'Other', snippet: 'checkout' }
    ])
    const visible = excludeDuplicateThreadMatches(matches, ranked)
    expect(visible.map((entry) => entry.id)).toEqual(['content:thr_2'])
  })
})
