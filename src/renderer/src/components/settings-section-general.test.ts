import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettingsSection } from './settings-section-general'
import { AppearanceSettingsSection } from './settings-section-appearance'
import { CodeSettingsSection } from './settings-section-code'
import { LocalLogSettingsCard } from './settings-section-general-desktop'
import { NotificationsSettingsSection } from './settings-section-notifications'
import { APP_LOCALE_OPTIONS } from '@shared/app-locales'

const labels: Record<string, string> = {
  sectionGeneral: 'General',
  workspaceRoot: 'Default workspace',
  workspaceRootDesc: 'Default workspace description',
  workspaceRootPlaceholder: '~/.kun/default_workspace',
  restoreWorkspaceDefault: 'Restore default',
  restoreConversationWorkspaceDefault: 'Restore conversation default',
  browse: 'Browse',
  turnCompleteNotification: 'Reply completion notifications',
  mainAgentTurnCompleteNotification: 'Main agent completions',
  subagentTurnCompleteNotification: 'Subagent completions',
  desktopUseSystemTitleBar: 'Use system title bar',
  desktopUseSystemTitleBarDesc: 'Let Linux draw the title bar. Restart Kun to apply.',
  desktopKeepAwake: 'Keep computer awake',
  desktopKeepAwakeDesc: 'Prevent sleep while Kun is running.'
}

function t(key: string, values?: Record<string, unknown>): string {
  if (!values) return labels[key] ?? key
  return labels[key] ?? key
}

function baseCtx(): Record<string, unknown> {
  const noop = () => undefined
  return {
    t,
    tCommon: t,
    form: {
      locale: 'zh',
      theme: 'dark',
      uiFontScale: 0.88,
      chatContentMaxWidthPx: 896,
      composerSendKey: 'enter',
      workspaceRoot: '~/data/code/python/Kook-Voices',
      cursorSpotlight: true,
      cursorSpotlightColor: '#3b82f6',
      darkUiColors: { background: '#101010', border: '#202020', panel: '#303030' },
      appBehavior: {
        openAtLogin: false,
        startMinimized: false,
        keepAwake: true,
        useSystemTitleBar: false,
        closeToTray: false,
        closeAction: 'quit'
      },
      notifications: {
        turnComplete: false,
        mainAgentTurnComplete: true,
        subagentTurnComplete: false
      },
      checkpointCleanup: { createEnabled: false, enabled: false, intervalDays: 3 },
      log: {
        enabled: false,
        retentionDays: 3
      }
    },
    kun: {},
    update: noop,
    updateKun: noop,
    showRuntimeToken: false,
    setShowRuntimeToken: noop,
    portError: '',
    selectControlClass: 'select',
    openOnboardingPreview: noop,
    pickWorkspace: async () => undefined,
    resetWorkspaceToDefault: noop,
    workspacePickerError: '',
    pickConversationWorkspace: async () => undefined,
    resetConversationWorkspaceToDefault: noop,
    conversationWorkspacePickerError: '',
    logPath: '',
    logDirOpenError: '',
    setLogDirOpenError: noop,
    compactHomePath: (path: string) => path,
    expandHomePath: (path: string) => path,
    pickWriteWorkspace: async () => undefined,
    resetWriteWorkspaceToDefault: noop,
    writeWorkspacePickerError: '',
    writeInlineBaseUrlInherited: false,
    effectiveWriteInlineBaseUrl: '',
    writeInlineModelInherited: false,
    effectiveWriteInlineModel: '',
    setWriteDebugModalOpen: noop,
    loadWriteDebugEntries: async () => undefined,
    scrollToAgentSection: noop,
    agentsSectionRef: { current: null },
    skillSectionRef: { current: null },
    mcpSectionRef: { current: null },
    permissionsSectionRef: { current: null },
    selectedSkillRoot: null,
    skillRootOptions: [],
    skillRootId: '',
    setSkillRootId: noop,
    skillNotice: null,
    openSkillRoot: async () => undefined,
    openPlugins: noop,
    mcpConfigPath: '',
    mcpConfigExists: false,
    mcpConfigText: '',
    setMcpConfigText: noop,
    mcpLoading: false,
    mcpBusy: false,
    mcpNotice: null,
    saveMcpConfig: async () => undefined,
    loadMcpConfig: async () => undefined,
    openMcpConfigDir: async () => undefined,
    pickClawWorkspace: async () => undefined,
    resetClawWorkspaceToDefault: noop,
    clawWorkspacePickerError: '',
    splitSettingsList: (value: string) => value.split('\n').filter(Boolean),
    listSettingsText: (values: string[]) => values.join('\n')
  }
}

describe('General, Appearance, Notifications and Code settings pages', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('puts the workspace path field before its browse and restore actions on the Code page', () => {
    const html = renderToStaticMarkup(createElement(CodeSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('w-full min-w-0 rounded-xl border border-ds-border')
    expect(html).toContain('flex min-w-0 flex-wrap gap-2')
    expect(html.indexOf('~/data/code/python/Kook-Voices')).toBeLessThan(html.indexOf('Browse'))
    expect(html.indexOf('Browse')).toBeLessThan(html.indexOf('Restore default'))
  })

  it('offers every supported application locale', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    for (const option of APP_LOCALE_OPTIONS) {
      expect(html).toContain(`value="${option.value}"`)
      expect(html).toContain(option.label)
    }
  })

  it('shows editable dark colors, a live preview, and the global reset action', () => {
    const html = renderToStaticMarkup(createElement(AppearanceSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('darkUiColorsTitle')
    expect(html).toContain('value="#101010"')
    expect(html).toContain('value="#202020"')
    expect(html).toContain('value="#303030"')
    expect(html).toContain('background-color:#101010')
    expect(html).toContain('border-color:#202020')
    expect(html).toContain('darkUiColorsReset')
  })

  it('keeps General free of nested tabs and moves folders, checkpoints and logs to their pages', () => {
    const general = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    expect(general).not.toContain('role="tab"')
    expect(general).not.toContain('legacyImportTitle')
    expect(general).not.toContain('gitCheckpointTitle')
    expect(general).not.toContain('logTitle')

    const code = renderToStaticMarkup(createElement(CodeSettingsSection, { ctx: baseCtx() }))
    for (const tab of ['directories', 'worktree', 'checkpoints']) {
      expect(code).toContain(`id="code-settings-tab-${tab}"`)
      expect(code).toContain(`id="code-settings-panel-${tab}"`)
    }
    expect(code).toContain('gitCheckpointTitle')

    expect(renderToStaticMarkup(createElement(LocalLogSettingsCard, { view: baseCtx() }))).toContain('logTitle')
  })

  it('explains main-window quit without exposing legacy background options', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    expect(html).toContain('desktopCloseAction_quit')
    expect(html).not.toContain('desktopCloseAction_ask')
    expect(html).not.toContain('desktopCloseAction_tray')
  })

  it('shows the keep-awake preference in desktop behavior', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    const toggleIndex = html.indexOf('aria-label="Keep computer awake"')
    const toggle = html.slice(toggleIndex, toggleIndex + 500)

    expect(html).toContain('Keep computer awake')
    expect(html).toContain('Prevent sleep while Kun is running.')
    expect(toggleIndex).toBeGreaterThan(-1)
    expect(toggle).toContain('aria-checked="true"')
  })

  it('shows the restart-scoped system title bar switch only on Linux', () => {
    vi.stubGlobal('window', { kunGui: { platform: 'linux' } })
    const linuxHtml = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))

    expect(linuxHtml).toContain('Use system title bar')
    expect(linuxHtml).toContain('Restart Kun to apply')

    vi.stubGlobal('window', { kunGui: { platform: 'win32' } })
    const windowsHtml = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    expect(windowsHtml).not.toContain('Use system title bar')
  })

  it('folds the per-source notification switches away while the master switch is off', () => {
    const html = renderToStaticMarkup(createElement(NotificationsSettingsSection, { ctx: baseCtx() }))
    const revealIndex = html.indexOf('class="ds-settings-reveal"')
    const mainToggleIndex = html.indexOf('aria-label="Main agent completions"')
    const subagentToggleIndex = html.indexOf('aria-label="Subagent completions"')
    const mainToggle = html.slice(mainToggleIndex, mainToggleIndex + 500)
    const subagentToggle = html.slice(subagentToggleIndex, subagentToggleIndex + 500)

    expect(html.slice(revealIndex, revealIndex + 120)).toContain('data-open="false" aria-hidden="true" inert=""')
    expect(mainToggleIndex).toBeGreaterThan(revealIndex)
    expect(subagentToggleIndex).toBeGreaterThan(revealIndex)
    expect(mainToggle).toContain('aria-checked="true"')
    expect(subagentToggle).toContain('aria-checked="false"')
  })
})
