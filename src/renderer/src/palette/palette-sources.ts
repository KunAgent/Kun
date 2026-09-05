import type { TFunction } from 'i18next'
import type { KeyboardShortcutBindingsV1 } from '@shared/keyboard-shortcuts'
import { KEYBOARD_SHORTCUT_COMMANDS } from '@shared/keyboard-shortcuts'
import {
  Archive,
  Clock3,
  Columns3,
  Code2,
  Command,
  Cpu,
  FolderOpen,
  GitFork,
  LayoutGrid,
  ListTodo,
  MessageCircleMore,
  MessageSquare,
  MessageSquarePlus,
  Minimize2,
  Palette,
  PencilLine,
  Pin,
  Plus,
  Puzzle,
  RotateCcw,
  Search,
  SearchCode,
  Settings,
  Smartphone,
  Sparkles,
  Target,
  Workflow,
  type LucideIcon
} from 'lucide-react'
import type { ModelProviderModelGroup } from '@shared/kun-gui-api'
import type { NormalizedThread } from '../agent/types'
import type { AppRoute, SettingsRouteSection } from '../store/chat-store-types'
import {
  CANONICAL_SLASH_COMMAND_TEXT,
  type BuiltinSlashCommandId,
  type SlashCommand
} from '../components/chat/floating-composer-commands'
import {
  buildComposerSlashCommands,
  type ComposerSkillCommand
} from '../components/chat/use-composer-slash-command-menu'
import {
  type ExtensionRightRailViewEntry
} from '../extensions/contribution-registry'
import { boundedPlainText } from '../extensions/safe-text'
import type { PaletteEntry, PaletteIcon } from './palette-model'

export const THREAD_SOURCE_SCAN_CAP = 100

export type PaletteThreadLike = Pick<
  NormalizedThread,
  'id' | 'title' | 'preview' | 'summary' | 'updatedAt' | 'archived'
>

export type PaletteSourcesInput = {
  t: TFunction
  tSettings: (key: string) => string
  route: AppRoute
  workspaceRoot: string
  /** In-scope code conversations, already filtered by the sidebar scope rules. */
  threads: readonly PaletteThreadLike[]
  codeWorkspaceRoots: readonly string[]
  runtimeReady: boolean
  busy: boolean
  activeThreadId: string | null
  activeThreadArchived: boolean
  canOpenGoalPanel: boolean
  canCreateNewThread: boolean
  hasPlanCommand: boolean
  hasBtwCommand: boolean
  hideBtwCommand: boolean
  hasReviewCommand: boolean
  skillCommands: ComposerSkillCommand[]
  disabledSkillIds?: string[]
  extensionRightRailItems: readonly ExtensionRightRailViewEntry[]
  shortcutBindings: Required<KeyboardShortcutBindingsV1>
  /** Blocks the compose fallback so it can never discard a pending draft. */
  hasComposerDraft: boolean
  /** Model id the composer will send with, used to mark the active row. */
  composerModel: string
  /** Configured provider groups; the palette lists every model they expose. */
  composerModelGroups: readonly ModelProviderModelGroup[]
  activeThreadPinned: boolean
  /** Laboratory project board gate; the board route entry is hidden while off. */
  projectBoardEnabled?: boolean
}

/**
 * Route label keys live in the common namespace; the Record type makes a
 * newly added AppRoute fail compilation until it gets localized copy.
 */
const ROUTE_LABEL_KEYS: Record<AppRoute, string> = {
  chat: 'code',
  write: 'write',
  design: 'design',
  settings: 'settings',
  plugins: 'plugins',
  extensions: 'extensions',
  claw: 'claw',
  board: 'projectBoardNav',
  schedule: 'schedule',
  workflow: 'workflowCreate'
}

const ROUTE_ICONS: Record<AppRoute, LucideIcon> = {
  chat: Code2,
  write: PencilLine,
  design: Palette,
  settings: Settings,
  plugins: LayoutGrid,
  extensions: Puzzle,
  claw: Smartphone,
  board: Columns3,
  schedule: Clock3,
  workflow: Workflow
}

/**
 * Settings destination labels live in the settings namespace; the Record
 * type makes a newly added SettingsRouteSection fail compilation until it
 * gets localized copy, so new destinations are reachable from the palette
 * without a separate palette registration.
 */
const SETTINGS_SECTION_LABEL_KEYS: Record<SettingsRouteSection, string> = {
  general: 'general',
  providers: 'providers',
  extensions: 'extensions',
  write: 'write',
  design: 'design',
  imageGeneration: 'mediaGeneration',
  mediaGeneration: 'mediaGeneration',
  speechToText: 'settingsNavSpeech',
  agents: 'settingsNavAssistant',
  laboratory: 'agentsQuickLaboratory',
  subagents: 'subagents',
  archives: 'settingsNavArchives',
  worktree: 'worktree',
  memory: 'memory',
  permissions: 'permissions',
  skill: 'skill',
  mcp: 'mcp',
  shortcuts: 'keyboardShortcuts',
  easterEgg: 'settingsNavAppearance',
  claw: 'settingsNavPhone',
  updates: 'settingsNavUpdates',
  terminal: 'terminal',
  debug: 'debug',
  storage: 'storageRelocation',
  dataMigration: 'settingsNavMigration'
}

const SETTINGS_SECTION_DESCRIPTION_KEYS: Partial<Record<SettingsRouteSection, string>> = {
  general: 'subtitle',
  providers: 'providersDesc',
  extensions: 'extensionsDesc',
  write: 'writeDesc',
  design: 'designDesc',
  imageGeneration: 'mediaGenerationDesc',
  mediaGeneration: 'mediaGenerationDesc',
  speechToText: 'speechToTextEnabledDesc',
  agents: 'kunProviderDesc',
  laboratory: 'laboratorySettingsDesc',
  subagents: 'subagentsSettingsIntro',
  archives: 'archivesOverviewDesc',
  worktree: 'worktreeOverviewDesc',
  memory: 'memoryOverviewDesc',
  shortcuts: 'shortcutsDesc',
  easterEgg: 'uiModeWorkshopDesc',
  claw: 'clawEnabledDesc',
  updates: 'guiUpdateDesc',
  debug: 'llmDebugDesc',
  terminal: 'terminalColorModeDesc',
  storage: 'storageRelocationSubtitle',
  dataMigration: 'dataMigrationSubtitle'
}

const BUILTIN_SLASH_ICONS: Record<BuiltinSlashCommandId, LucideIcon> = {
  new: Plus,
  plan: ListTodo,
  goal: Target,
  research: Search,
  review: SearchCode,
  compact: Minimize2,
  fork: GitFork,
  archive: Archive,
  restore: RotateCcw,
  btw: MessageCircleMore
}

const PALETTE_HIDDEN_SHORTCUT_COMMANDS = new Set<string>(['command-palette'])

/**
 * Settings sections that resolve to a destination another section already
 * offers. `imageGeneration` is a legacy alias that opens the same category as
 * `mediaGeneration` (see SettingsView), so listing both would put two rows
 * with different labels in front of one destination. The label Record above
 * still covers every section, so a genuinely new destination keeps failing
 * compilation until it gets copy.
 */
const PALETTE_ALIAS_SETTINGS_SECTIONS = new Set<SettingsRouteSection>(['imageGeneration'])

function slashCommandIcon(command: SlashCommand): LucideIcon {
  if (command.kind === 'skill') return Sparkles
  return BUILTIN_SLASH_ICONS[command.id as BuiltinSlashCommandId] ?? Command
}

function workspaceDisplayName(root: string): string {
  const trimmed = root.trim()
  const segments = trimmed.split('/').filter(Boolean)
  const plain = (segments.at(-1) ?? trimmed).split('\\').filter(Boolean).pop()
  return plain ?? trimmed
}

function canonicalSlashInsert(command: SlashCommand): string {
  if (command.kind === 'skill') {
    return command.skillPrompt ?? '/skill:' + command.id.replace(/^skill:/, '') + ' '
  }
  return CANONICAL_SLASH_COMMAND_TEXT[command.id as BuiltinSlashCommandId]
}

function shortcutCommandEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { tSettings, shortcutBindings } = input
  const entries: PaletteEntry[] = []
  for (const command of KEYBOARD_SHORTCUT_COMMANDS) {
    if (PALETTE_HIDDEN_SHORTCUT_COMMANDS.has(command.id)) continue
    // A command with no chord is exactly the one a palette is most useful
    // for, so it is listed without a binding badge rather than skipped.
    const binding = shortcutBindings[command.id]?.[0]
    entries.push({
      id: 'cmd:' + command.id,
      source: 'shortcut-command',
      title: tSettings(command.labelKey),
      subtitle: tSettings(command.descriptionKey),
      keywords: [command.id],
      ...(binding ? { badge: binding } : {}),
      icon: { kind: 'lucide', icon: Command },
      activation: { kind: 'shortcut-command', commandId: command.id }
    })
  }
  return entries
}

function routeEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { t } = input
  return (Object.keys(ROUTE_LABEL_KEYS) as AppRoute[])
    .filter((route) => route !== 'board' || input.projectBoardEnabled === true)
    .map((route) => {
      const title = t(ROUTE_LABEL_KEYS[route])
      return {
        id: 'route:' + route,
        source: 'route' as const,
        title,
        keywords: [route, title],
        icon: { kind: 'lucide' as const, icon: ROUTE_ICONS[route] },
        activation: { kind: 'route' as const, route }
      }
    })
}

function settingsEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { tSettings } = input
  const entries: PaletteEntry[] = []
  for (const section of Object.keys(SETTINGS_SECTION_LABEL_KEYS) as SettingsRouteSection[]) {
    if (PALETTE_ALIAS_SETTINGS_SECTIONS.has(section)) continue
    const title = tSettings(SETTINGS_SECTION_LABEL_KEYS[section])
    const descriptionKey = SETTINGS_SECTION_DESCRIPTION_KEYS[section]
    const subtitle = descriptionKey ? tSettings(descriptionKey) : undefined
    entries.push({
      id: 'settings:' + section,
      source: 'settings',
      title,
      subtitle: subtitle && subtitle !== title ? subtitle : undefined,
      keywords: [section, title],
      icon: { kind: 'lucide', icon: Settings },
      activation: { kind: 'settings', section }
    })
  }
  return entries
}

function threadEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { t, threads } = input
  const sorted = [...threads]
    .filter((thread) => thread.archived !== true)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, THREAD_SOURCE_SCAN_CAP)
  return sorted.map((thread) => {
    const title = thread.title?.trim() || t('paletteUntitledThread')
    // Bound the preview before it reaches keywords: matching splits every
    // keyword on each keystroke, and thread previews are unbounded.
    const preview = boundedPlainText(
      thread.preview?.trim() || thread.summary?.trim() || '',
      160
    )
    return {
      id: 'thread:' + thread.id,
      source: 'thread' as const,
      title,
      subtitle: preview || undefined,
      keywords: [thread.id, title, preview],
      icon: { kind: 'lucide' as const, icon: MessageSquare },
      activation: { kind: 'thread' as const, threadId: thread.id }
    }
  })
}

function workspaceEntries(input: PaletteSourcesInput): PaletteEntry[] {
  return input.codeWorkspaceRoots.map((root) => ({
    id: 'workspace:' + root,
    source: 'workspace' as const,
    title: workspaceDisplayName(root),
    subtitle: root,
    keywords: [root, workspaceDisplayName(root)],
    icon: { kind: 'lucide' as const, icon: FolderOpen },
    activation: { kind: 'workspace' as const, workspaceRoot: root }
  }))
}

function slashCommandEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const {
    t, route, runtimeReady, busy, activeThreadId, activeThreadArchived,
    canOpenGoalPanel, canCreateNewThread, workspaceRoot, hasPlanCommand,
    hasBtwCommand, hideBtwCommand, hasReviewCommand, skillCommands, disabledSkillIds
  } = input
  const commands = buildComposerSlashCommands({
    t,
    route,
    runtimeReady,
    busy,
    activeThreadId,
    activeThreadArchived,
    canOpenGoalPanel,
    canCreateNewThread,
    workspaceRoot,
    hasPlanCommand,
    hasBtwCommand,
    hideBtwCommand,
    hasReviewCommand,
    skillCommands,
    disabledSkillIds
  })
  return commands.map((command) => {
    const insertText = canonicalSlashInsert(command)
    return {
      id: 'slash:' + command.id,
      source: 'slash-command' as const,
      title: command.title,
      subtitle: command.description,
      keywords: [command.id, ...command.keywords],
      badge: insertText.trim(),
      icon: { kind: 'lucide' as const, icon: slashCommandIcon(command) },
      disabled: command.disabled === true,
      disabledReason: command.disabled === true ? t('paletteDisabledDefault') : undefined,
      activation: { kind: 'slash-command' as const, commandId: command.id, insertText }
    }
  })
}

function extensionEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { t, extensionRightRailItems } = input
  const entries: PaletteEntry[] = []
  for (const item of extensionRightRailItems) {
    if (item.owner.kind !== 'extension') continue
    const payload = item.payload
    const locked = item.workspaceTrusted === false
    let icon: PaletteIcon = { kind: 'lucide', icon: Puzzle }
    if (payload.icon) {
      icon = { kind: 'extension', extensionId: item.owner.extensionId, iconPath: payload.icon }
    }
    entries.push({
      id: 'ext:' + item.id,
      source: 'extension-view',
      title: boundedPlainText(payload.title, 128),
      subtitle: locked ? t('paletteLockedReason') : undefined,
      keywords: [item.id, item.owner.extensionId, payload.id],
      badge: locked ? t('paletteLockedBadge') : undefined,
      icon,
      activation: { kind: 'extension-view', entryId: item.id, locked }
    })
  }
  return entries
}

/**
 * Aggregates palette results from the existing registries and store state.
 * Any source that cannot resolve is simply omitted; nothing here mutates
 * state or executes extension code.
 */
export function collectPaletteSources(input: PaletteSourcesInput): PaletteEntry[] {
  return [
    ...shortcutCommandEntries(input),
    ...slashCommandEntries(input),
    ...routeEntries(input),
    ...settingsEntries(input),
    ...activeThreadActionEntries(input),
    ...threadEntries(input),
    ...modelEntries(input),
    ...workspaceEntries(input),
    ...extensionEntries(input)
  ]
}

/**
 * Every model the user has configured, so switching is one query away instead
 * of a trip to the composer's picker. The active model is listed but marked,
 * since selecting it again is a harmless no-op and hiding it would make the
 * list look wrong.
 */
function modelEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { t, composerModel, composerModelGroups } = input
  const entries: PaletteEntry[] = []
  const seen = new Set<string>()
  for (const group of composerModelGroups) {
    for (const modelId of group.modelIds) {
      const id = 'model:' + group.providerId + ':' + modelId
      if (seen.has(id)) continue
      seen.add(id)
      const active = modelId === composerModel
      entries.push({
        id,
        source: 'model',
        title: modelId,
        subtitle: group.label,
        keywords: [group.providerId, group.label],
        ...(active ? { badge: t('paletteModelActiveBadge') } : {}),
        icon: { kind: 'lucide', icon: Cpu },
        activation: { kind: 'select-model', modelId, providerId: group.providerId }
      })
    }
  }
  return entries
}

/**
 * Reversible actions on the conversation you are already in.
 *
 * Deleting a thread is deliberately absent: a destructive action reachable by
 * fuzzy-matching a mistyped query is a trap, and the sidebar already offers it
 * behind an explicit confirmation.
 */
function activeThreadActionEntries(input: PaletteSourcesInput): PaletteEntry[] {
  const { t, activeThreadId, activeThreadArchived, activeThreadPinned } = input
  if (!activeThreadId || activeThreadArchived) return []
  return [
    {
      id: 'action:pin',
      source: 'action' as const,
      title: activeThreadPinned ? t('paletteActionUnpinThread') : t('paletteActionPinThread'),
      subtitle: t('paletteActionThreadScope'),
      keywords: ['pin', 'unpin', 'favorite'],
      icon: { kind: 'lucide' as const, icon: Pin },
      activation: {
        kind: 'thread-action' as const,
        action: activeThreadPinned ? ('unpin' as const) : ('pin' as const),
        threadId: activeThreadId
      }
    },
    {
      id: 'action:archive',
      source: 'action' as const,
      title: t('paletteActionArchiveThread'),
      subtitle: t('paletteActionThreadScope'),
      keywords: ['archive', 'hide'],
      icon: { kind: 'lucide' as const, icon: Archive },
      activation: {
        kind: 'thread-action' as const,
        action: 'archive' as const,
        threadId: activeThreadId
      }
    }
  ]
}

/**
 * Turns an unmatched query into an offer rather than a dead end: the text the
 * user typed is almost always something they wanted to say. Only offered with
 * an empty composer, so this can never discard a pending draft.
 */
export function composeFallbackEntries(input: {
  t: TFunction
  rawQuery: string
  canCreateNewThread: boolean
  hasComposerDraft: boolean
}): PaletteEntry[] {
  const text = input.rawQuery.trim()
  if (!text || !input.canCreateNewThread || input.hasComposerDraft) return []
  return [{
    id: 'compose:new-chat',
    source: 'compose',
    title: input.t('paletteComposeWithQuery', { query: boundedPlainText(text, 80) }),
    subtitle: input.t('paletteComposeWithQueryDesc'),
    keywords: [],
    icon: { kind: 'lucide', icon: MessageSquarePlus },
    activation: { kind: 'compose', text }
  }]
}

export type ThreadContentMatchLike = {
  threadId: string
  title: string
  snippet: string
  workspace?: string
}

/**
 * Maps runtime deep-search matches to conversation palette entries.
 *
 * Content search spans every project, so each row is badged with the project
 * it belongs to; without that a result from another project reads as one from
 * the current one and activating it silently switches context.
 */
export function threadContentMatchEntries(
  matches: readonly ThreadContentMatchLike[]
): PaletteEntry[] {
  return matches.map((match) => {
    const project = match.workspace ? workspaceDisplayName(match.workspace) : ''
    return {
      id: 'content:' + match.threadId,
      source: 'thread' as const,
      title: match.title.trim() || match.threadId,
      subtitle: match.snippet.trim() || undefined,
      keywords: [match.threadId, project],
      ...(project ? { badge: project } : {}),
      icon: { kind: 'lucide' as const, icon: MessageSquare },
      activation: { kind: 'thread' as const, threadId: match.threadId }
    }
  })
}

/**
 * Drops content matches for conversations the regular thread source already
 * surfaced, so a term matching both a title and a message shows once.
 */
export function excludeDuplicateThreadMatches(
  matches: readonly PaletteEntry[],
  ranked: readonly PaletteEntry[]
): PaletteEntry[] {
  const covered = new Set<string>()
  for (const entry of ranked) {
    if (entry.source !== 'thread' || entry.activation.kind !== 'thread') continue
    covered.add(entry.activation.threadId)
  }
  return matches.filter((match) =>
    match.activation.kind === 'thread' && !covered.has(match.activation.threadId)
  )
}
