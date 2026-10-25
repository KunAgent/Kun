import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  SETTINGS_NAVIGATION_GROUPS,
  filterSettingsNavigationGroups,
  settingsCategoryDescriptionKey,
  settingsCategoryForRouteSection,
  settingsNavigationItem,
  visibleSettingsNavigationGroups
} from './settings-navigation'
import { SettingsPageHeader, SettingsSaveStatusPill, settingsSaveStatusTone } from './settings-page-header'
import { SettingsSidebar } from './SettingsSidebar'

const labels: Record<string, string> = {
  general: 'General',
  providers: 'Providers',
  settingsIaGroupGeneral: 'Basics',
  port: 'Local service port',
  settingsGroupSystem: 'System',
  keyboardShortcuts: 'Keyboard shortcuts',
  settingsNavShortcuts: 'Shortcuts',
  shortcutsDesc: 'Review and customize global keyboard shortcuts.',
  providersDesc: 'Connect model APIs with keys and base URLs.',
  labPptTitle: 'PPT skill'
}
const t = (key: string): string => labels[key] ?? key

function categories(groups: ReturnType<typeof visibleSettingsNavigationGroups>): string[] {
  return groups.flatMap((group) => group.items.map((item) => item.category))
}

describe('settings navigation model', () => {
  it('gives every destination a decorative tone and a description', () => {
    for (const group of SETTINGS_NAVIGATION_GROUPS) {
      for (const item of group.items) {
        expect(item.tone).toBeTruthy()
        expect(settingsCategoryDescriptionKey(item.category)).toBeTruthy()
        expect(settingsNavigationItem(item.category)).toBe(item)
      }
    }
  })

  it('applies the extension and Windows-only guards', () => {
    const mac = categories(visibleSettingsNavigationGroups({ extensionSettingsAvailable: false, platform: 'darwin' }))
    const windows = categories(visibleSettingsNavigationGroups({ extensionSettingsAvailable: true, platform: 'win32' }))
    expect(mac).not.toContain('storage')
    expect(mac).not.toContain('extensions')
    expect(windows).toContain('storage')
    expect(windows).toContain('extensions')
    expect(windows).toHaveLength(33)
    expect(mac).toHaveLength(31)
    expect(mac).not.toContain('integrations')
  })

  it('matches short names, full names, groups and descriptions case-insensitively', () => {
    const groups = visibleSettingsNavigationGroups({ extensionSettingsAvailable: false, platform: 'darwin' })
    expect(categories(filterSettingsNavigationGroups(groups, '  ', t))).toEqual(categories(groups))
    expect(categories(filterSettingsNavigationGroups(groups, 'SHORTCUT', t))).toEqual(['shortcuts'])
    expect(categories(filterSettingsNavigationGroups(groups, 'base urls', t))).toEqual(['providers'])
    expect(categories(filterSettingsNavigationGroups(groups, 'basics general', t))).toEqual(['general'])
    expect(filterSettingsNavigationGroups(groups, 'no such page', t)).toEqual([])
  })

  it('finds a page by the settings it holds, ignoring untranslated keys', () => {
    const groups = visibleSettingsNavigationGroups({ extensionSettingsAvailable: false, platform: 'darwin' })
    expect(categories(filterSettingsNavigationGroups(groups, 'service port', t))).toEqual(['agentRuntime'])
    // Search keys without copy fall back to the raw key; that must never match.
    expect(categories(filterSettingsNavigationGroups(groups, 'kunMaxConcurrentTurns', t))).toEqual([])
  })

  it('routes PPT search to Skills, not Laboratory', () => {
    const groups = visibleSettingsNavigationGroups({ extensionSettingsAvailable: false, platform: 'darwin' })
    expect(categories(filterSettingsNavigationGroups(groups, 'PPT', t))).toEqual(['skills'])
  })

  it('keeps every page to one topic, with no more than seven per group', () => {
    for (const group of SETTINGS_NAVIGATION_GROUPS) {
      expect(group.items.length).toBeLessThanOrEqual(7)
    }
    const all = SETTINGS_NAVIGATION_GROUPS.flatMap((group) => group.items.map((item) => item.category))
    expect(new Set(all).size).toBe(all.length)
  })

  it('maps old deep links to the page that now owns their content', () => {
    expect(settingsCategoryForRouteSection('agentsHarnesses')).toBe('harnesses')
    expect(settingsCategoryForRouteSection('agentsCollaboration')).toBe('collaboration')
    expect(settingsCategoryForRouteSection('skill')).toBe('skills')
    expect(settingsCategoryForRouteSection('mcp')).toBe('mcp')
    expect(settingsCategoryForRouteSection('permissions')).toBe('permissions')
    expect(settingsCategoryForRouteSection('worktree')).toBe('code')
    expect(settingsCategoryForRouteSection('imageGeneration')).toBe('mediaGeneration')
    expect(settingsCategoryForRouteSection('speak')).toBe('mediaGeneration')
    expect(settingsCategoryForRouteSection(null)).toBe('agents')
  })
})

describe('settings sidebar search', () => {
  it('filters destinations, selects the first match on Enter and clears on Escape', () => {
    const setCategory = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SettingsSidebar, {
        category: 'general', setCategory, goBack: vi.fn(), platform: 'darwin', t
      }))
    })
    const input = renderer.root.findByProps({ 'aria-controls': 'settings-navigation' })
    act(() => input.props.onChange({ target: { value: 'shortcut' } }))
    const routes = renderer.root.findAllByType('button')
      .flatMap((button) => button.props['data-settings-category'] ? [button.props['data-settings-category']] : [])
    expect(routes).toEqual(['shortcuts'])

    const enter = { key: 'Enter', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    act(() => input.props.onKeyDown(enter))
    expect(setCategory).toHaveBeenCalledWith('shortcuts')
    expect(enter.preventDefault).toHaveBeenCalledOnce()

    const escape = { key: 'Escape', nativeEvent: { isComposing: false }, preventDefault: vi.fn(), stopPropagation: vi.fn() }
    act(() => renderer.root.findByProps({ 'aria-controls': 'settings-navigation' }).props.onKeyDown(escape))
    expect(escape.preventDefault).toHaveBeenCalledOnce()
    expect(renderer.root.findByProps({ 'aria-controls': 'settings-navigation' }).props.value).toBe('')
  })

  it('ignores IME composition keys and an empty Enter', () => {
    const setCategory = vi.fn()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SettingsSidebar, {
        category: 'general', setCategory, goBack: vi.fn(), platform: 'darwin', t
      }))
    })
    const search = (): ReturnType<typeof renderer.root.findByProps> =>
      renderer.root.findByProps({ 'aria-controls': 'settings-navigation' })
    const key = (name: string, isComposing = false) => ({
      key: name, keyCode: isComposing ? 229 : 13, nativeEvent: { isComposing },
      preventDefault: vi.fn(), stopPropagation: vi.fn()
    })

    const emptyEnter = key('Enter')
    act(() => search().props.onKeyDown(emptyEnter))
    expect(setCategory).not.toHaveBeenCalled()
    expect(emptyEnter.preventDefault).not.toHaveBeenCalled()

    act(() => search().props.onChange({ target: { value: 'shortcut' } }))
    const composingEnter = key('Enter', true)
    act(() => search().props.onKeyDown(composingEnter))
    const composingEscape = key('Escape', true)
    act(() => search().props.onKeyDown(composingEscape))
    expect(setCategory).not.toHaveBeenCalled()
    expect(composingEscape.preventDefault).not.toHaveBeenCalled()
    expect(search().props.value).toBe('shortcut')

    act(() => search().props.onKeyDown(key('Enter')))
    expect(setCategory).toHaveBeenCalledWith('shortcuts')
  })

  it('shows an empty state instead of a blank list', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SettingsSidebar, {
        category: 'general', setCategory: vi.fn(), goBack: vi.fn(), platform: 'darwin', t
      }))
    })
    act(() => renderer.root.findByProps({ 'aria-controls': 'settings-navigation' })
      .props.onChange({ target: { value: 'zzz-unmatched' } }))
    expect(renderer.root.findByProps({ role: 'status' }).findByType('span').children).toEqual(['settingsSearchEmpty'])
    // The compact picker always keeps every destination reachable.
    expect(renderer.root.findByType('select').findAllByType('option').length).toBeGreaterThan(20)
  })
})

describe('settings page header', () => {
  it('maps save state to a single status tone with manual and blocked precedence', () => {
    expect(settingsSaveStatusTone({ explicitSavePanel: true, portError: 'bad', saveStatus: 'error' })).toBe('manual')
    expect(settingsSaveStatusTone({ explicitSavePanel: false, portError: 'bad', saveStatus: 'saved' })).toBe('blocked')
    expect(settingsSaveStatusTone({ explicitSavePanel: false, portError: null, saveStatus: 'saving' })).toBe('saving')
    expect(settingsSaveStatusTone({ explicitSavePanel: false, portError: null, saveStatus: 'saved' })).toBe('saved')
    expect(settingsSaveStatusTone({ explicitSavePanel: false, portError: null, saveStatus: 'error' })).toBe('error')
    expect(settingsSaveStatusTone({ explicitSavePanel: false, portError: null, saveStatus: 'idle' })).toBe('idle')
  })

  it('renders the category tile, title, description and a polite live status', () => {
    const html = renderToStaticMarkup(createElement(SettingsPageHeader, {
      category: 'providers',
      title: 'Providers',
      description: 'Connect model APIs.',
      status: createElement(SettingsSaveStatusPill, { tone: 'saved', t })
    }))
    expect(html).toContain('data-tone="blue"')
    expect(html).toContain('Providers')
    expect(html).toContain('Connect model APIs.')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-live="polite"')
    expect(html).toContain('applied')
  })
})
