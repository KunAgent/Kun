import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { GeneralSettingsSection } from './settings-section-general'

const labels: Record<string, string> = {
  sectionGeneral: 'General',
  workspaceRoot: 'Default workspace',
  workspaceRootDesc: 'Default workspace description',
  workspaceRootPlaceholder: '~/.kun/default_workspace',
  restoreWorkspaceDefault: 'Restore default',
  browse: 'Browse'
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
      workspaceRoot: '~/data/code/python/Kook-Voices',
      cursorSpotlight: true,
      cursorSpotlightColor: '#3b82f6',
      appBehavior: {
        openAtLogin: false,
        startMinimized: false,
        closeToTray: false,
        closeAction: 'ask'
      },
      notifications: {
        turnComplete: false
      },
      checkpointCleanup: {
        enabled: false,
        intervalDays: 3
      },
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
})
