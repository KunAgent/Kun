import {
  Archive,
  AudioLines,
  Bot,
  BrainCircuit,
  Bug,
  CircleFadingArrowUp,
  FlaskConical,
  FolderSync,
  GitBranch,
  HardDrive,
  Keyboard,
  Mic,
  Palette,
  PenLine,
  Plug,
  Puzzle,
  Server,
  Settings,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Trash2,
  UsersRound,
  type LucideIcon
} from 'lucide-react'

export type SettingsCategory =
  | 'general'
  | 'providers'
  | 'integrations'
  | 'write'
  | 'design'
  | 'mediaGeneration'
  | 'speechToText'
  | 'agents'
  | 'laboratory'
  | 'subagents'
  | 'archives'
  | 'worktree'
  | 'memory'
  | 'shortcuts'
  | 'easterEgg'
  | 'claw'
  | 'updates'
  | 'debug'
  | 'terminal'
  | 'extensions'
  | 'storage'
  | 'dataMigration'
  | 'uninstall'

/** Decorative icon-tile hues. Each one resolves to a theme token in settings-chrome.css. */
export type SettingsIconTone =
  | 'slate'
  | 'blue'
  | 'teal'
  | 'green'
  | 'amber'
  | 'orange'
  | 'red'
  | 'pink'
  | 'violet'

export type SettingsNavigationItem = {
  category: SettingsCategory
  labelKey: string
  navigationLabelKey?: string
  icon: LucideIcon
  tone: SettingsIconTone
  extensionOnly?: boolean
  windowsOnly?: boolean
}

export type SettingsNavigationGroup = {
  id: string
  labelKey: string
  items: SettingsNavigationItem[]
}

export const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'core',
    labelKey: 'settingsGroupCore',
    items: [
      { category: 'general', labelKey: 'general', icon: Settings, tone: 'slate' },
      { category: 'providers', labelKey: 'providers', icon: Server, tone: 'blue' },
      { category: 'integrations', labelKey: 'integrations', icon: Plug, tone: 'green' },
      { category: 'extensions', labelKey: 'extensions', icon: Puzzle, tone: 'violet', extensionOnly: true }
    ]
  },
  {
    id: 'workbench',
    labelKey: 'settingsGroupWorkbench',
    items: [
      { category: 'write', labelKey: 'write', icon: PenLine, tone: 'amber' },
      { category: 'design', labelKey: 'design', icon: Palette, tone: 'pink' },
      {
        category: 'mediaGeneration',
        labelKey: 'mediaGeneration',
        navigationLabelKey: 'settingsNavMedia',
        icon: AudioLines,
        tone: 'red'
      },
      {
        category: 'speechToText',
        labelKey: 'speechToText',
        navigationLabelKey: 'settingsNavSpeech',
        icon: Mic,
        tone: 'teal'
      }
    ]
  },
  {
    id: 'intelligence',
    labelKey: 'settingsGroupIntelligence',
    items: [
      { category: 'agents', labelKey: 'agents', navigationLabelKey: 'settingsNavAssistant', icon: Bot, tone: 'blue' },
      { category: 'laboratory', labelKey: 'agentsQuickLaboratory', icon: FlaskConical, tone: 'green' },
      { category: 'subagents', labelKey: 'subagents', icon: UsersRound, tone: 'violet' },
      { category: 'memory', labelKey: 'memory', icon: BrainCircuit, tone: 'pink' }
    ]
  },
  {
    id: 'data',
    labelKey: 'settingsGroupData',
    items: [
      { category: 'archives', labelKey: 'archives', navigationLabelKey: 'settingsNavArchives', icon: Archive, tone: 'amber' },
      { category: 'storage', labelKey: 'storageRelocation', icon: HardDrive, tone: 'slate', windowsOnly: true },
      {
        category: 'dataMigration',
        labelKey: 'dataMigration',
        navigationLabelKey: 'settingsNavMigration',
        icon: FolderSync,
        tone: 'teal'
      },
      { category: 'worktree', labelKey: 'worktree', icon: GitBranch, tone: 'orange' }
    ]
  },
  {
    id: 'system',
    labelKey: 'settingsGroupSystem',
    items: [
      {
        category: 'shortcuts',
        labelKey: 'keyboardShortcuts',
        navigationLabelKey: 'settingsNavShortcuts',
        icon: Keyboard,
        tone: 'slate'
      },
      {
        category: 'easterEgg',
        labelKey: 'easterEgg',
        navigationLabelKey: 'settingsNavAppearance',
        icon: Sparkles,
        tone: 'violet'
      },
      {
        category: 'updates',
        labelKey: 'updates',
        navigationLabelKey: 'settingsNavUpdates',
        icon: CircleFadingArrowUp,
        tone: 'blue'
      },
      { category: 'claw', labelKey: 'claw', navigationLabelKey: 'settingsNavPhone', icon: Smartphone, tone: 'green' },
      { category: 'terminal', labelKey: 'terminal', icon: SquareTerminal, tone: 'slate' },
      { category: 'debug', labelKey: 'debug', icon: Bug, tone: 'orange' },
      { category: 'uninstall', labelKey: 'uninstall', icon: Trash2, tone: 'red' }
    ]
  }
]

const SETTINGS_CATEGORY_DESCRIPTION_KEYS: Record<SettingsCategory, string> = {
  general: 'subtitle',
  providers: 'providersDesc',
  integrations: 'integrationsDesc',
  extensions: 'extensionsDesc',
  write: 'writeDesc',
  design: 'designDesc',
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
  dataMigration: 'dataMigrationSubtitle',
  uninstall: 'uninstallSubtitle'
}

export function settingsNavigationItem(category: SettingsCategory): SettingsNavigationItem | null {
  for (const group of SETTINGS_NAVIGATION_GROUPS) {
    const item = group.items.find((candidate) => candidate.category === category)
    if (item) return item
  }
  return null
}

export function settingsCategoryLabelKey(category: SettingsCategory): string {
  return settingsNavigationItem(category)?.labelKey ?? 'title'
}

export function settingsCategoryDescriptionKey(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_DESCRIPTION_KEYS[category]
}

/** Platform and extension guards shared by the full sidebar and the compact picker. */
export function visibleSettingsNavigationGroups({
  extensionSettingsAvailable,
  platform
}: {
  extensionSettingsAvailable: boolean
  platform: string
}): SettingsNavigationGroup[] {
  return SETTINGS_NAVIGATION_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) =>
      (!item.extensionOnly || extensionSettingsAvailable) &&
      (!item.windowsOnly || platform === 'win32')
    )
  })).filter((group) => group.items.length > 0)
}

/** Short sidebar label; falls back to the full title when no short label is translated. */
export function settingsNavigationLabel(item: SettingsNavigationItem, t: (key: string) => string): string {
  const fullLabel = t(item.labelKey)
  const navigationLabelKey = item.navigationLabelKey ?? item.labelKey
  const translated = t(navigationLabelKey)
  return translated === navigationLabelKey ? fullLabel : translated
}

function normalizeSearchText(value: string): string {
  return value.normalize('NFKC').toLowerCase().replace(/\s+/g, ' ').trim()
}

/**
 * Case- and width-insensitive match against everything a person may remember
 * about a page: its short and full names, its group, and its description.
 */
export function filterSettingsNavigationGroups(
  groups: SettingsNavigationGroup[],
  query: string,
  t: (key: string) => string
): SettingsNavigationGroup[] {
  const needle = normalizeSearchText(query)
  if (!needle) return groups
  const terms = needle.split(' ')
  return groups.map((group) => ({
    ...group,
    items: group.items.filter((item) => {
      const haystack = normalizeSearchText([
        item.category,
        t(item.labelKey),
        settingsNavigationLabel(item, t),
        t(group.labelKey),
        t(settingsCategoryDescriptionKey(item.category))
      ].join(' '))
      return terms.every((term) => haystack.includes(term))
    })
  })).filter((group) => group.items.length > 0)
}
