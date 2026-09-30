import type { Dispatch, ReactElement, SetStateAction } from 'react'
import {
  Archive,
  AudioLines,
  Bot,
  BrainCircuit,
  Bug,
  ChevronLeft,
  FlaskConical,
  GitBranch,
  Globe,
  HardDrive,
  Keyboard,
  Mic,
  PackageOpen,
  Palette,
  PencilLine,
  Puzzle,
  Plug,
  RefreshCw,
  ServerCog,
  Settings,
  ShieldCheck,
  Smartphone,
  Sparkles,
  TerminalSquare,
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

type SettingsNavigationItem = {
  category: SettingsCategory
  labelKey: string
  navigationLabelKey?: string
  icon: LucideIcon
  extensionOnly?: boolean
  windowsOnly?: boolean
}

type SettingsNavigationGroup = {
  id: string
  labelKey: string
  items: SettingsNavigationItem[]
}

const SETTINGS_NAVIGATION_GROUPS: SettingsNavigationGroup[] = [
  {
    id: 'core',
    labelKey: 'settingsGroupCore',
    items: [
      { category: 'general', labelKey: 'general', icon: Globe },
      { category: 'providers', labelKey: 'providers', icon: ServerCog },
      { category: 'integrations', labelKey: 'integrations', icon: Plug },
      { category: 'extensions', labelKey: 'extensions', icon: Puzzle, extensionOnly: true }
    ]
  },
  {
    id: 'workbench',
    labelKey: 'settingsGroupWorkbench',
    items: [
      { category: 'write', labelKey: 'write', icon: PencilLine },
      { category: 'design', labelKey: 'design', icon: Palette },
      {
        category: 'mediaGeneration',
        labelKey: 'mediaGeneration',
        navigationLabelKey: 'settingsNavMedia',
        icon: AudioLines
      },
      {
        category: 'speechToText',
        labelKey: 'speechToText',
        navigationLabelKey: 'settingsNavSpeech',
        icon: Mic
      }
    ]
  },
  {
    id: 'intelligence',
    labelKey: 'settingsGroupIntelligence',
    items: [
      { category: 'agents', labelKey: 'agents', navigationLabelKey: 'settingsNavAssistant', icon: Bot },
      { category: 'laboratory', labelKey: 'agentsQuickLaboratory', icon: FlaskConical },
      { category: 'subagents', labelKey: 'subagents', icon: UsersRound },
      { category: 'memory', labelKey: 'memory', icon: BrainCircuit }
    ]
  },
  {
    id: 'data',
    labelKey: 'settingsGroupData',
    items: [
      { category: 'archives', labelKey: 'archives', navigationLabelKey: 'settingsNavArchives', icon: Archive },
      { category: 'storage', labelKey: 'storageRelocation', icon: HardDrive, windowsOnly: true },
      {
        category: 'dataMigration',
        labelKey: 'dataMigration',
        navigationLabelKey: 'settingsNavMigration',
        icon: PackageOpen
      },
      { category: 'worktree', labelKey: 'worktree', icon: GitBranch }
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
        icon: Keyboard
      },
      {
        category: 'easterEgg',
        labelKey: 'easterEgg',
        navigationLabelKey: 'settingsNavAppearance',
        icon: Sparkles
      },
      { category: 'updates', labelKey: 'updates', navigationLabelKey: 'settingsNavUpdates', icon: RefreshCw },
      { category: 'claw', labelKey: 'claw', navigationLabelKey: 'settingsNavPhone', icon: Smartphone },
      { category: 'terminal', labelKey: 'terminal', icon: TerminalSquare },
      { category: 'debug', labelKey: 'debug', icon: Bug },
      { category: 'uninstall', labelKey: 'uninstall', icon: Trash2 }
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

export function settingsCategoryLabelKey(category: SettingsCategory): string {
  for (const group of SETTINGS_NAVIGATION_GROUPS) {
    const item = group.items.find((candidate) => candidate.category === category)
    if (item) return item.labelKey
  }
  return 'title'
}

export function settingsCategoryDescriptionKey(category: SettingsCategory): string {
  return SETTINGS_CATEGORY_DESCRIPTION_KEYS[category]
}

export function SettingsSidebar({
  category,
  goBack,
  setCategory,
  extensionSettingsAvailable = false,
  platform = 'unknown',
  t
}: {
  category: SettingsCategory
  goBack: () => void
  setCategory: Dispatch<SetStateAction<SettingsCategory>>
  extensionSettingsAvailable?: boolean
  platform?: string
  t: (key: string) => string
}): ReactElement {
  return (
    <aside className="ds-settings-sidebar ds-drag flex h-full min-h-0 w-[260px] shrink-0 flex-col bg-ds-sidebar">
      <div className="shrink-0 px-5 pb-4 pt-5">
        <div aria-hidden className="ds-titlebar-safe-block" />
        <div className="flex items-center gap-2">
          <button
            type="button"
            aria-label={t('back')}
            title={t('back')}
            data-cursor-spotlight-target
            onClick={goBack}
            className="ds-no-drag flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
          >
            <ChevronLeft className="h-5 w-5" strokeWidth={1.8} />
          </button>
          <h1 className="truncate text-[24px] font-medium leading-tight tracking-[-0.02em] text-ds-ink">
            {t('title')}
          </h1>
        </div>
      </div>

      <nav
        aria-label={t('title')}
        className="ds-no-drag min-h-0 flex-1 overflow-y-auto overscroll-contain px-3.5 pb-5"
      >
        {SETTINGS_NAVIGATION_GROUPS.map((group, groupIndex) => {
          const items = group.items.filter((item) =>
            (!item.extensionOnly || extensionSettingsAvailable) &&
            (!item.windowsOnly || platform === 'win32')
          )
          if (items.length === 0) return null
          const headingId = `settings-nav-group-${group.id}`
          return (
            <section
              key={group.id}
              aria-labelledby={headingId}
              className={groupIndex === 0 ? '' : 'mt-3.5'}
            >
              <h2
                id={headingId}
                className="px-3 pb-1.5 text-[11px] font-medium tracking-[0.02em] text-ds-faint"
              >
                {t(group.labelKey)}
              </h2>
              <div className="space-y-1">
                {items.map((item) => {
                  const Icon = item.icon
                  const selected = category === item.category
                  const fullLabel = t(item.labelKey)
                  const navigationLabelKey = item.navigationLabelKey ?? item.labelKey
                  const translatedNavigationLabel = t(navigationLabelKey)
                  const label = translatedNavigationLabel === navigationLabelKey
                    ? fullLabel
                    : translatedNavigationLabel
                  return (
                    <button
                      key={item.category}
                      type="button"
                      aria-label={fullLabel}
                      aria-current={selected ? 'page' : undefined}
                      title={fullLabel}
                      data-settings-category={item.category}
                      data-cursor-spotlight-target
                      className={`group flex h-9 w-full min-w-0 items-center gap-2.5 rounded-full border px-3 text-left text-[13px] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${
                        selected
                          ? 'border-transparent bg-[var(--ds-control)] font-medium text-[var(--ds-control-foreground)]'
                          : 'border-transparent font-normal text-ds-muted hover:bg-ds-hover hover:text-ds-ink'
                      }`}
                      onClick={() => setCategory(item.category)}
                    >
                      <span
                        className={`flex h-5 w-5 shrink-0 items-center justify-center transition ${
                          selected ? 'text-[var(--ds-control-foreground)]' : 'text-ds-faint group-hover:text-ds-ink'
                        }`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={1.75} />
                      </span>
                      <span className="min-w-0 flex-1 truncate">{label}</span>
                    </button>
                  )
                })}
              </div>
            </section>
          )
        })}
      </nav>

      <div className="ds-no-drag shrink-0 border-t border-ds-border px-5 py-3.5">
        <div className="flex items-center gap-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center text-ds-faint">
            <ShieldCheck className="h-3.5 w-3.5" strokeWidth={1.8} />
          </div>
          <div className="min-w-0 text-[11px] leading-4 text-ds-faint">
            <div className="truncate font-medium text-ds-muted">Kun</div>
            <div className="truncate">{t('settingsFooter')}</div>
          </div>
          <Settings aria-hidden className="ml-auto h-3.5 w-3.5 shrink-0 text-ds-faint" strokeWidth={1.75} />
        </div>
      </div>
    </aside>
  )
}
