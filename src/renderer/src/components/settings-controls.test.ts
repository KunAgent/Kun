import { createElement, Fragment, useState, type ReactElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import {
  act,
  create,
  type ReactTestInstance,
  type ReactTestRenderer
} from 'react-test-renderer'
import { Folder, MessageSquare, Monitor } from 'lucide-react'
import { describe, expect, it, vi } from 'vitest'
import {
  SettingsCard,
  SettingsSubTabs,
  SettingsTabPanel,
  SettingsTabs,
  type SettingsTabItem
} from './settings-controls'

type TabId = 'appearance' | 'input' | 'files'

const ITEMS = [
  { id: 'appearance', label: 'Appearance', icon: Monitor },
  { id: 'input', label: 'Conversation and input', icon: MessageSquare },
  { id: 'files', label: 'Directories and files', icon: Folder }
] as const satisfies readonly SettingsTabItem<TabId>[]

function textContent(node: ReactTestInstance): string {
  return node.children
    .map((child) => typeof child === 'string' ? child : textContent(child))
    .join('')
}

function TabsHarness({
  onChange
}: {
  onChange: (value: TabId) => void
}): ReactElement {
  const [value, setValue] = useState<TabId>('appearance')
  const change = (next: TabId): void => {
    setValue(next)
    onChange(next)
  }
  return createElement(
    Fragment,
    null,
    createElement(SettingsTabs<TabId>, {
      items: ITEMS,
      value,
      onChange: change,
      baseId: 'general-settings',
      ariaLabel: 'General settings sections'
    }),
    ...ITEMS.map((item) =>
      createElement(
        SettingsTabPanel<TabId>,
        {
          key: item.id,
          tabId: item.id,
          active: value === item.id,
          baseId: 'general-settings',
          children: `${item.label} panel`
        }
      )
    )
  )
}

function SubTabsHarness({
  onChange
}: {
  onChange: (value: TabId) => void
}): ReactElement {
  const [value, setValue] = useState<TabId>('appearance')
  const change = (next: TabId): void => {
    setValue(next)
    onChange(next)
  }
  return createElement(
    Fragment,
    null,
    createElement(SettingsSubTabs<TabId>, {
      items: ITEMS,
      value,
      onChange: change,
      baseId: 'display-settings',
      ariaLabel: 'Display settings sections'
    }),
    ...ITEMS.map((item) =>
      createElement(
        SettingsTabPanel<TabId>,
        {
          key: item.id,
          tabId: item.id,
          active: value === item.id,
          baseId: 'display-settings',
          children: `${item.label} panel`
        }
      )
    )
  )
}

function tabs(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAllByProps({ role: 'tab' })
}

function panels(renderer: ReactTestRenderer): ReactTestInstance[] {
  return renderer.root.findAllByProps({ role: 'tabpanel' })
}

describe('SettingsTabs', () => {
  it('links an equal-width icon tablist to its panels with accessible state', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(TabsHarness, { onChange: () => undefined }))
    })

    const tablist = renderer.root.findByProps({ role: 'tablist' })
    expect(tablist.props['aria-label']).toBe('General settings sections')
    expect(tablist.props['aria-orientation']).toBe('horizontal')
    expect(tablist.props.className).toContain('rounded-full')
    expect(tablist.props.className).toContain('auto-cols-[minmax(8rem,1fr)]')

    const renderedTabs = tabs(renderer)
    expect(renderedTabs.map(textContent)).toEqual([
      'Appearance',
      'Conversation and input',
      'Directories and files'
    ])
    expect(renderedTabs.map((tab) => tab.props['aria-selected'])).toEqual([true, false, false])
    expect(renderedTabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1])
    expect(renderedTabs.map((tab) => tab.props.id)).toEqual([
      'general-settings-tab-appearance',
      'general-settings-tab-input',
      'general-settings-tab-files'
    ])
    expect(renderedTabs.map((tab) => tab.props['aria-controls'])).toEqual([
      'general-settings-panel-appearance',
      'general-settings-panel-input',
      'general-settings-panel-files'
    ])
    expect(renderedTabs[0]?.props.className).toContain('bg-ds-card')
    expect(renderedTabs[1]?.props.className).toContain('hover:bg-ds-hover')
    expect(renderedTabs.every((tab) => tab.findAllByType('svg').length === 1)).toBe(true)

    const renderedPanels = panels(renderer)
    expect(renderedPanels.map((panel) => panel.props.id)).toEqual([
      'general-settings-panel-appearance',
      'general-settings-panel-input',
      'general-settings-panel-files'
    ])
    expect(renderedPanels.map((panel) => panel.props['aria-labelledby'])).toEqual([
      'general-settings-tab-appearance',
      'general-settings-tab-input',
      'general-settings-tab-files'
    ])
    expect(renderedPanels.map((panel) => panel.props.hidden)).toEqual([false, true, true])
    expect(renderedPanels[0]?.props.className).not.toContain('hidden')
    expect(renderedPanels[1]?.props.className).toContain('hidden')
  })

  it('sizes laboratory tabs to readable labels and wraps instead of clipping', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SettingsTabs<TabId>, {
        items: ITEMS,
        value: 'appearance',
        onChange: () => undefined,
        baseId: 'readable-settings',
        ariaLabel: 'Readable settings sections',
        contentSized: true
      }))
    })

    const tablist = renderer.root.findByProps({ role: 'tablist' })
    expect(tablist.props.className).toContain('grid-cols-[repeat(auto-fit,minmax(9.5rem,max-content))]')
    expect(tablist.props.className).not.toContain('overflow-x-auto')
    expect(tabs(renderer).every((tab) => tab.props.className.includes('min-w-max'))).toBe(true)
    expect(tabs(renderer).flatMap((tab) => tab.findAllByType('span'))
      .every((label) => !label.props.className.includes('truncate'))).toBe(true)
  })

  it('switches by click and Arrow, Home, and End keys while moving focus', () => {
    const onChange = vi.fn()
    const focusTargets = new Map<string, { focus: ReturnType<typeof vi.fn> }>()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(TabsHarness, { onChange }), {
        createNodeMock: (element) => {
          const props = element.props as { id?: unknown }
          if (element.type !== 'button' || typeof props.id !== 'string') return {}
          const existing = focusTargets.get(props.id)
          if (existing) return existing
          const target = { focus: vi.fn() }
          focusTargets.set(props.id, target)
          return target
        }
      })
    })

    act(() => {
      tabs(renderer)[1]?.props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith('input')
    expect(tabs(renderer).map((tab) => tab.props.tabIndex)).toEqual([-1, 0, -1])
    expect(panels(renderer).map((panel) => panel.props.hidden)).toEqual([true, false, true])

    const endPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[1]?.props.onKeyDown({ key: 'End', preventDefault: endPreventDefault })
    })
    expect(endPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('files')
    expect(focusTargets.get('general-settings-tab-files')?.focus).toHaveBeenCalledOnce()

    const homePreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[2]?.props.onKeyDown({ key: 'Home', preventDefault: homePreventDefault })
    })
    expect(homePreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('appearance')
    expect(focusTargets.get('general-settings-tab-appearance')?.focus).toHaveBeenCalledOnce()

    const leftPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[0]?.props.onKeyDown({ key: 'ArrowLeft', preventDefault: leftPreventDefault })
    })
    expect(leftPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('files')
    expect(focusTargets.get('general-settings-tab-files')?.focus).toHaveBeenCalledTimes(2)

    const rightPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[2]?.props.onKeyDown({ key: 'ArrowRight', preventDefault: rightPreventDefault })
    })
    expect(rightPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('appearance')
    expect(focusTargets.get('general-settings-tab-appearance')?.focus).toHaveBeenCalledTimes(2)

    const ignoredPreventDefault = vi.fn()
    const callCount = onChange.mock.calls.length
    act(() => {
      tabs(renderer)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: ignoredPreventDefault })
    })
    expect(ignoredPreventDefault).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(callCount)
  })
})

describe('SettingsSubTabs', () => {
  it('links compact, horizontally scrollable pills to the shared tab panels', () => {
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SubTabsHarness, { onChange: () => undefined }))
    })

    const tablist = renderer.root.findByProps({ role: 'tablist' })
    expect(tablist.props['aria-label']).toBe('Display settings sections')
    expect(tablist.props['aria-orientation']).toBe('horizontal')
    expect(tablist.props.className).toContain('ds-settings-subtabs')
    expect(tablist.props.className).toContain('overflow-x-auto')
    expect(tablist.props.className).toContain('rounded-full')
    expect(tablist.props.className).not.toContain('grid-flow-col')

    const renderedTabs = tabs(renderer)
    expect(renderedTabs.map(textContent)).toEqual([
      'Appearance',
      'Conversation and input',
      'Directories and files'
    ])
    expect(renderedTabs.map((tab) => tab.props['aria-selected'])).toEqual([true, false, false])
    expect(renderedTabs.map((tab) => tab.props.tabIndex)).toEqual([0, -1, -1])
    expect(renderedTabs.map((tab) => tab.props.id)).toEqual([
      'display-settings-tab-appearance',
      'display-settings-tab-input',
      'display-settings-tab-files'
    ])
    expect(renderedTabs.map((tab) => tab.props['aria-controls'])).toEqual([
      'display-settings-panel-appearance',
      'display-settings-panel-input',
      'display-settings-panel-files'
    ])
    expect(renderedTabs.every((tab) => tab.props.className.includes('h-8'))).toBe(true)
    expect(renderedTabs.every((tab) => tab.props.className.includes('shrink-0'))).toBe(true)
    expect(renderedTabs.every((tab) => tab.props.className.includes('rounded-full'))).toBe(true)
    expect(renderedTabs[0]?.props.className).toContain('bg-ds-card')
    expect(renderedTabs[1]?.props.className).toContain('hover:bg-ds-hover')
    expect(renderedTabs.every((tab) => tab.findAllByType('svg').length === 1)).toBe(true)

    const renderedPanels = panels(renderer)
    expect(renderedPanels.map((panel) => panel.props.id)).toEqual([
      'display-settings-panel-appearance',
      'display-settings-panel-input',
      'display-settings-panel-files'
    ])
    expect(renderedPanels.map((panel) => panel.props['aria-labelledby'])).toEqual([
      'display-settings-tab-appearance',
      'display-settings-tab-input',
      'display-settings-tab-files'
    ])
    expect(renderedPanels.map((panel) => panel.props.hidden)).toEqual([false, true, true])
  })

  it('switches by click and all horizontal tab keys while moving focus', () => {
    const onChange = vi.fn()
    const focusTargets = new Map<string, { focus: ReturnType<typeof vi.fn> }>()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = create(createElement(SubTabsHarness, { onChange }), {
        createNodeMock: (element) => {
          const props = element.props as { id?: unknown }
          if (element.type !== 'button' || typeof props.id !== 'string') return {}
          const existing = focusTargets.get(props.id)
          if (existing) return existing
          const target = { focus: vi.fn() }
          focusTargets.set(props.id, target)
          return target
        }
      })
    })

    act(() => {
      tabs(renderer)[1]?.props.onClick()
    })
    expect(onChange).toHaveBeenLastCalledWith('input')
    expect(tabs(renderer).map((tab) => tab.props.tabIndex)).toEqual([-1, 0, -1])
    expect(panels(renderer).map((panel) => panel.props.hidden)).toEqual([true, false, true])

    const rightPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[1]?.props.onKeyDown({ key: 'ArrowRight', preventDefault: rightPreventDefault })
    })
    expect(rightPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('files')
    expect(focusTargets.get('display-settings-tab-files')?.focus).toHaveBeenCalledOnce()

    const leftPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[2]?.props.onKeyDown({ key: 'ArrowLeft', preventDefault: leftPreventDefault })
    })
    expect(leftPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('input')
    expect(focusTargets.get('display-settings-tab-input')?.focus).toHaveBeenCalledOnce()

    const endPreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[1]?.props.onKeyDown({ key: 'End', preventDefault: endPreventDefault })
    })
    expect(endPreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('files')
    expect(focusTargets.get('display-settings-tab-files')?.focus).toHaveBeenCalledTimes(2)

    const homePreventDefault = vi.fn()
    act(() => {
      tabs(renderer)[2]?.props.onKeyDown({ key: 'Home', preventDefault: homePreventDefault })
    })
    expect(homePreventDefault).toHaveBeenCalledOnce()
    expect(onChange).toHaveBeenLastCalledWith('appearance')
    expect(focusTargets.get('display-settings-tab-appearance')?.focus).toHaveBeenCalledOnce()

    const ignoredPreventDefault = vi.fn()
    const callCount = onChange.mock.calls.length
    act(() => {
      tabs(renderer)[0]?.props.onKeyDown({ key: 'Enter', preventDefault: ignoredPreventDefault })
    })
    expect(ignoredPreventDefault).not.toHaveBeenCalled()
    expect(onChange).toHaveBeenCalledTimes(callCount)
  })
})

describe('SettingsCard', () => {
  it('renders a description in a non-collapsible card header', () => {
    const html = renderToStaticMarkup(createElement(
      SettingsCard,
      {
        title: 'Display and reading',
        description: 'Control language, theme, and typography.',
        children: createElement('span', null, 'Settings content')
      }
    ))

    expect(html).toContain('Display and reading')
    expect(html).toContain('Control language, theme, and typography.')
    expect(html.indexOf('Control language, theme, and typography.'))
      .toBeLessThan(html.indexOf('Settings content'))
  })
})
