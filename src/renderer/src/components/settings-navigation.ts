import {
  Archive,
  AudioLines,
  Bell,
  Bot,
  BrainCircuit,
  Cable,
  CircleFadingArrowUp,
  CodeXml,
  FlaskConical,
  FolderCog,
  FolderSync,
  GraduationCap,
  HardDrive,
  Keyboard,
  Mic,
  Palette,
  PenLine,
  Plug,
  Puzzle,
  Route,
  Server,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  SquareTerminal,
  Stethoscope,
  SunMoon,
  Trash2,
  UsersRound,
  WandSparkles,
  Workflow,
  Wrench,
  type LucideIcon
} from 'lucide-react'
import type { SettingsRouteSection } from '../store/settings-route-sections'

export type SettingsCategory =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'shortcuts'
  | 'easterEgg'
  | 'providers'
  | 'gateway'
  | 'speechToText'
  | 'mediaGeneration'
  | 'agents'
  | 'permissions'
  | 'skills'
  | 'mcp'
  | 'memory'
  | 'subagents'
  | 'projects'
  | 'harnesses'
  | 'collaboration'
  | 'claw'
  | 'extensions'
  | 'code'
  | 'terminal'
  | 'write'
  | 'paper'
  | 'design'
  | 'archives'
  | 'dataMigration'
  | 'storage'
  | 'laboratory'
  | 'agentRuntime'
  | 'debug'
  | 'updates'
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
  /** Translation keys of the settings a page holds, so search finds "port" → Advanced runtime. */
  searchKeys?: readonly string[]
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

/**
 * One destination per topic. Pages keep at most four tabs and never nest tab
 * rows; settings that are only a switch or two live in cards, not tabs.
 */
export const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'general',
    labelKey: 'settingsIaGroupGeneral',
    items: [
      {
        category: 'general', labelKey: 'general', icon: Settings, tone: 'slate',
        searchKeys: ['language', 'composerSendKey', 'chatWelcomeMessage', 'desktopBehavior', 'desktopOpenAtLogin', 'desktopKeepAwake', 'onboardingPreview']
      },
      {
        category: 'appearance', labelKey: 'settingsIaAppearance', icon: SunMoon, tone: 'violet',
        searchKeys: ['theme', 'fontScale', 'chatContentMaxWidth', 'cursorSpotlight', 'colorPaletteTitle', 'darkUiColorsTitle']
      },
      {
        category: 'notifications', labelKey: 'settingsIaNotifications', icon: Bell, tone: 'amber',
        searchKeys: ['turnCompleteNotification', 'subagentTurnCompleteNotification', 'quotaReminderNotification']
      },
      { category: 'shortcuts', labelKey: 'keyboardShortcuts', navigationLabelKey: 'settingsNavShortcuts', icon: Keyboard, tone: 'slate' },
      { category: 'easterEgg', labelKey: 'easterEgg', navigationLabelKey: 'settingsIaAvatar', icon: Sparkles, tone: 'pink' }
    ]
  },
  {
    id: 'models',
    labelKey: 'settingsIaGroupModels',
    items: [
      {
        category: 'providers', labelKey: 'settingsIaProviders', icon: Server, tone: 'blue',
        searchKeys: ['modelProviderGlobalNetwork']
      },
      {
        category: 'gateway', labelKey: 'settingsIaGateway', icon: Route, tone: 'teal',
        searchKeys: ['modelProviderModeRoutes']
      },
      { category: 'speechToText', labelKey: 'speechToText', navigationLabelKey: 'settingsIaSpeechInput', icon: Mic, tone: 'teal' },
      {
        category: 'mediaGeneration', labelKey: 'mediaGeneration', icon: AudioLines, tone: 'red',
        searchKeys: ['imageGen', 'textToSpeech', 'musicGeneration', 'videoGeneration']
      }
    ]
  },
  {
    id: 'assistant',
    labelKey: 'settingsIaGroupAssistant',
    items: [
      {
        category: 'agents', labelKey: 'settingsIaAssistant', icon: Bot, tone: 'blue',
        searchKeys: ['kunProvider', 'kunModel', 'codePromptPrefix', 'kunPromptOptimization', 'autoStart']
      },
      {
        category: 'permissions', labelKey: 'settingsIaPermissions', icon: ShieldCheck, tone: 'green',
        searchKeys: ['toolPermissionMode', 'approvalReviewModelTitle', 'designQualityTitle']
      },
      { category: 'skills', labelKey: 'settingsIaSkills', icon: WandSparkles, tone: 'violet', searchKeys: ['skillsDetectedDirs', 'skillsScanDirs', 'labPptTitle', 'labPptImageAssets'] },
      { category: 'mcp', labelKey: 'settingsIaMcp', icon: Wrench, tone: 'orange', searchKeys: ['mcpSearchEnabled', 'mcpEditor'] },
      { category: 'memory', labelKey: 'memory', icon: BrainCircuit, tone: 'pink' },
      { category: 'subagents', labelKey: 'subagents', icon: UsersRound, tone: 'violet' },
      { category: 'projects', labelKey: 'settingsIaProjects', icon: FolderCog, tone: 'slate', searchKeys: ['projectConfigTitle'] }
    ]
  },
  {
    id: 'connect',
    labelKey: 'settingsIaGroupConnect',
    items: [
      { category: 'harnesses', labelKey: 'settingsIaHarnesses', icon: Cable, tone: 'blue' },
      { category: 'collaboration', labelKey: 'settingsIaCollaboration', icon: Workflow, tone: 'green' },
      { category: 'claw', labelKey: 'claw', navigationLabelKey: 'settingsNavPhone', icon: Smartphone, tone: 'green' },
      { category: 'extensions', labelKey: 'extensions', icon: Puzzle, tone: 'violet', extensionOnly: true }
    ]
  },
  {
    id: 'workspaces',
    labelKey: 'settingsIaGroupWorkspaces',
    items: [
      {
        category: 'code', labelKey: 'settingsIaCode', icon: CodeXml, tone: 'orange',
        searchKeys: ['workspaceRoot', 'conversationWorkspaceRoot', 'worktree', 'gitCheckpointTitle']
      },
      { category: 'terminal', labelKey: 'terminal', icon: SquareTerminal, tone: 'slate', searchKeys: ['terminalColorMode'] },
      {
        category: 'write', labelKey: 'write', icon: PenLine, tone: 'amber',
        searchKeys: ['writeTypography', 'writeInlineCompletion', 'writeSelectionAssistTitle', 'writeAgentPresets']
      },
      { category: 'paper', labelKey: 'settingsIaPaper', icon: GraduationCap, tone: 'blue' },
      { category: 'design', labelKey: 'design', icon: Palette, tone: 'pink' }
    ]
  },
  {
    id: 'data',
    labelKey: 'settingsGroupData',
    items: [
      { category: 'archives', labelKey: 'archives', navigationLabelKey: 'settingsNavArchives', icon: Archive, tone: 'amber' },
      {
        category: 'dataMigration', labelKey: 'dataMigration', navigationLabelKey: 'settingsNavMigration',
        icon: FolderSync, tone: 'teal', searchKeys: ['legacyImportTitle']
      },
      { category: 'storage', labelKey: 'storageRelocation', icon: HardDrive, tone: 'slate', windowsOnly: true }
    ]
  },
  {
    id: 'system',
    labelKey: 'settingsGroupSystem',
    items: [
      {
        category: 'laboratory', labelKey: 'settingsIaLabs', icon: FlaskConical, tone: 'green',
        searchKeys: ['computerUseTitle', 'browserUseSettingsTitle', 'graphSettingsTitle', 'labProjectBoardTitle', 'labContextCompressionTitle', 'labAutoPlanBuildTitle']
      },
      {
        category: 'agentRuntime', labelKey: 'settingsIaRuntime', icon: SlidersHorizontal, tone: 'slate',
        searchKeys: ['port', 'kunBinary', 'kunDataDir', 'runtimeToken', 'kunTokenEconomy', 'kunInstructions', 'kunStorageBackend', 'kunMaxConcurrentTurns', 'kunToolOutputLimits', 'kunDiagnostics']
      },
      {
        category: 'debug', labelKey: 'settingsIaDiagnostics', icon: Stethoscope, tone: 'orange',
        searchKeys: ['logTitle', 'logDir', 'llmDebugRecords']
      },
      { category: 'updates', labelKey: 'updates', navigationLabelKey: 'settingsNavUpdates', icon: CircleFadingArrowUp, tone: 'blue' },
      { category: 'uninstall', labelKey: 'uninstall', icon: Trash2, tone: 'red' }
    ]
  }
]

const SETTINGS_CATEGORY_DESCRIPTION_KEYS: Record<SettingsCategory, string> = {
  general: 'settingsIaGeneralDesc',
  appearance: 'settingsIaAppearanceDesc',
  notifications: 'settingsIaNotificationsDesc',
  shortcuts: 'shortcutsDesc',
  easterEgg: 'uiModeWorkshopDesc',
  providers: 'providersDesc',
  gateway: 'settingsIaGatewayDesc',
  speechToText: 'speechToTextEnabledDesc',
  mediaGeneration: 'mediaGenerationDesc',
  agents: 'settingsIaAssistantDesc',
  permissions: 'settingsIaPermissionsDesc',
  skills: 'settingsIaSkillsDesc',
  mcp: 'settingsIaMcpDesc',
  memory: 'memoryOverviewDesc',
  subagents: 'subagentsSettingsIntro',
  projects: 'settingsIaProjectsDesc',
  harnesses: 'settingsIaHarnessesDesc',
  collaboration: 'settingsIaCollaborationDesc',
  claw: 'clawEnabledDesc',
  extensions: 'extensionsDesc',
  code: 'settingsIaCodeDesc',
  terminal: 'settingsIaTerminalDesc',
  write: 'writeDesc',
  paper: 'settingsIaPaperDesc',
  design: 'designDesc',
  archives: 'archivesOverviewDesc',
  dataMigration: 'dataMigrationSubtitle',
  storage: 'storageRelocationSubtitle',
  laboratory: 'settingsIaLabsDesc',
  agentRuntime: 'settingsIaRuntimeDesc',
  debug: 'settingsIaDiagnosticsDesc',
  updates: 'guiUpdateDesc',
  uninstall: 'uninstallSubtitle'
}

/** Settings pages the Kun Agents section renders, one panel each. */
export const AGENT_SETTINGS_PANELS = {
  agents: 'assistant',
  permissions: 'permissions',
  skills: 'skills',
  mcp: 'tools',
  projects: 'project',
  agentRuntime: 'runtime',
  harnesses: 'harnesses',
  collaboration: 'collaboration'
} as const satisfies Partial<Record<SettingsCategory, string>>

export type AgentSettingsCategory = keyof typeof AGENT_SETTINGS_PANELS
export type AgentSettingsPanel = (typeof AGENT_SETTINGS_PANELS)[AgentSettingsCategory]

export function isAgentSettingsCategory(category: SettingsCategory): category is AgentSettingsCategory {
  return Object.prototype.hasOwnProperty.call(AGENT_SETTINGS_PANELS, category)
}

/**
 * Deep links predate this layout: several used to name a tab inside another
 * page. Each still resolves to the page that now owns that content.
 */
const ROUTE_SECTION_CATEGORIES: Record<SettingsRouteSection, SettingsCategory> = {
  general: 'general',
  appearance: 'appearance',
  notifications: 'notifications',
  providers: 'providers',
  gateway: 'gateway',
  extensions: 'extensions',
  write: 'write',
  paper: 'paper',
  design: 'design',
  imageGeneration: 'mediaGeneration',
  mediaGeneration: 'mediaGeneration',
  speak: 'mediaGeneration',
  speechToText: 'speechToText',
  agents: 'agents',
  agentsHarnesses: 'harnesses',
  agentsCollaboration: 'collaboration',
  projects: 'projects',
  agentRuntime: 'agentRuntime',
  laboratory: 'laboratory',
  subagents: 'subagents',
  archives: 'archives',
  code: 'code',
  worktree: 'code',
  memory: 'memory',
  permissions: 'permissions',
  skill: 'skills',
  mcp: 'mcp',
  shortcuts: 'shortcuts',
  easterEgg: 'easterEgg',
  claw: 'claw',
  updates: 'updates',
  terminal: 'terminal',
  debug: 'debug',
  storage: 'storage',
  dataMigration: 'dataMigration'
}

export function settingsCategoryForRouteSection(section: SettingsRouteSection | null | undefined): SettingsCategory {
  return (section && ROUTE_SECTION_CATEGORIES[section]) || 'agents'
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

/** Untranslated keys fall back to themselves; never let a raw key become searchable text. */
function translatedOrEmpty(key: string, t: (key: string) => string): string {
  const value = t(key)
  return value === key ? '' : value
}

/**
 * Case- and width-insensitive match against everything a person may remember
 * about a page: its short and full names, its group, its description and the
 * names of the settings it holds.
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
        t(settingsCategoryDescriptionKey(item.category)),
        ...(item.searchKeys ?? []).map((key) => translatedOrEmpty(key, t))
      ].join(' '))
      return terms.every((term) => haystack.includes(term))
    })
  })).filter((group) => group.items.length > 0)
}
