import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { defaultKunRuntimeSettings } from '@shared/app-settings'
import { SettingsSidebar } from './SettingsSidebar'
import { SubagentsSettingsSection } from './settings-section-subagents'

vi.mock('./subagents/SubagentSettingsEditor', () => ({
  SubagentSettingsEditor: (props: {
    kun: { model: string }
    onPatch: unknown
    variant: string
  }) => createElement('div', {
    'data-testid': 'subagent-settings-editor',
    'data-model': props.kun.model,
    'data-on-patch': typeof props.onPatch,
    'data-variant': props.variant
  })
}))

const labels: Record<string, string> = {
  back: 'Back',
  general: 'General',
  providers: 'Providers',
  write: 'Work',
  design: 'Design',
  mediaGeneration: 'Media generation',
  speechToText: 'Speech to text',
  agents: 'AI assistant',
  agentsQuickLaboratory: 'Laboratory',
  subagents: 'Subagents',
  archives: 'Archived chats',
  worktree: 'Worktrees',
  memory: 'Memory',
  keyboardShortcuts: 'Keyboard shortcuts',
  easterEgg: 'Mode workshop',
  updates: 'Version & updates',
  claw: 'Connect phone',
  terminal: 'Terminal',
  debug: 'Troubleshooting',
  settingsFooter: 'Settings'
}

function t(key: string): string {
  return labels[key] ?? key
}

describe('SubagentsSettingsSection', () => {
  it('renders the settings editor with the current Kun settings and settings layout', () => {
    const html = renderToStaticMarkup(createElement(SubagentsSettingsSection, {
      ctx: {
        kun: defaultKunRuntimeSettings(),
        updateKun: () => undefined
      }
    }))

    expect(html).toContain('data-testid="subagent-settings-editor"')
    expect(html).toContain('data-model="deepseek-v4-pro"')
    expect(html).toContain('data-on-patch="function"')
    expect(html).toContain('data-variant="settings"')
  })

  it('keeps Subagents with the other Kun Agent pages', () => {
    const html = renderToStaticMarkup(createElement(SettingsSidebar, {
      category: 'subagents',
      goBack: () => undefined,
      setCategory: () => undefined,
      t
    }))

    const assistantGroup = html.slice(
      html.indexOf('id="settings-nav-group-assistant"'),
      html.indexOf('id="settings-nav-group-connect"')
    )
    const order = [...assistantGroup.matchAll(/data-settings-category="([A-Za-z]+)"/g)].map((match) => match[1])
    expect(order).toEqual(['agents', 'permissions', 'skills', 'mcp', 'memory', 'subagents', 'projects'])
    expect(html).toContain('lucide-users-round')
    expect(html).toMatch(/aria-current="page"[^>]*data-settings-category="subagents"/)
  })
})
