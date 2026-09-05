import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettingsSection } from './settings-section-general'
import { APP_LOCALE_OPTIONS } from '@shared/app-locales'

const labels: Record<string, string> = {
  sectionGeneral: 'General',
  workspaceRoot: 'Default workspace',
  workspaceRootDesc: 'Default workspace description',
  workspaceRootPlaceholder: '~/.kun/default_workspace',
  restoreWorkspaceDefault: 'Restore default',
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
        closeAction: 'ask'
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

describe('GeneralSettingsSection workspace layout', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { kunGui: {} })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('keeps the workspace path input full width above the action buttons', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('grid w-full min-w-0 gap-2 md:max-w-xl')
    expect(html).toContain('w-full min-w-0 rounded-xl border border-ds-border')
    expect(html).toContain('flex flex-wrap justify-end gap-2')
    expect(html.indexOf('~/data/code/python/Kook-Voices')).toBeLessThan(html.indexOf('Restore default'))
  })

  it('offers every supported application locale', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    for (const option of APP_LOCALE_OPTIONS) {
      expect(html).toContain(`value="${option.value}"`)
      expect(html).toContain(option.label)
    }
  })

  it('shows editable dark colors, a live preview, and the global reset action', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))

    expect(html).toContain('darkUiColorsTitle')
    expect(html).toContain('value="#101010"')
    expect(html).toContain('value="#202020"')
    expect(html).toContain('value="#303030"')
    expect(html).toContain('background-color:#101010')
    expect(html).toContain('border-color:#202020')
    expect(html).toContain('darkUiColorsReset')
  })

  it('keeps every directory and desktop subtab panel mounted', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))

    for (const tab of ['workspace', 'migration', 'checkpoints']) {
      expect(html).toContain(`id="general-directories-tab-${tab}"`)
      expect(html).toContain(`id="general-directories-panel-${tab}"`)
    }
    for (const tab of ['command', 'behavior', 'logs']) {
      expect(html).toContain(`id="general-desktop-tab-${tab}"`)
      expect(html).toContain(`id="general-desktop-panel-${tab}"`)
    }
    expect(html).toContain('legacyImportTitle')
    expect(html).toContain('gitCheckpointTitle')
    expect(html).toContain('logTitle')
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

  it('shows disabled source controls beneath the disabled master notification switch', () => {
    const html = renderToStaticMarkup(createElement(GeneralSettingsSection, { ctx: baseCtx() }))
    const mainToggleIndex = html.indexOf('aria-label="Main agent completions"')
    const subagentToggleIndex = html.indexOf('aria-label="Subagent completions"')
    const mainToggle = html.slice(mainToggleIndex, mainToggleIndex + 500)
    const subagentToggle = html.slice(subagentToggleIndex, subagentToggleIndex + 500)

    expect(html).toContain('ml-3 divide-y divide-ds-border-muted border-l')
    expect(mainToggleIndex).toBeGreaterThan(-1)
    expect(subagentToggleIndex).toBeGreaterThan(-1)
    expect(mainToggle).toContain('aria-checked="true"')
    expect(mainToggle).toContain('aria-disabled="true"')
    expect(subagentToggle).toContain('aria-checked="false"')
    expect(subagentToggle).toContain('aria-disabled="true"')
  })
})
