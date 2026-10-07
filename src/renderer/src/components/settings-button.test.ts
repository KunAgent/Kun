import { readFileSync } from 'node:fs'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { settingsButtonClass } from './settings-button'
import { ModelSelect, SecretInput, SettingRow, Toggle } from './settings-controls'
import { SettingsSidebar } from './SettingsSidebar'

describe('settings action hierarchy', () => {
  it('uses explicit variants and sizes without inline colors', () => {
    for (const variant of ['primary', 'secondary', 'ghost', 'danger', 'danger-ghost', 'link'] as const) {
      for (const size of ['default', 'compact', 'icon', 'inline-icon'] as const) {
        const classes = settingsButtonClass({ variant, size, className: 'ml-auto' })
        expect(classes).toBe(`ds-settings-button ds-settings-button--${variant} ds-settings-button--${size} ml-auto`)
      }
    }
    expect(settingsButtonClass()).toBe('ds-settings-button ds-settings-button--secondary ds-settings-button--default')
    const css = readFileSync(new URL('../styles/settings-buttons.css', import.meta.url), 'utf8')
    expect(css).toMatch(/inline-icon'\]\) \{[^}]*min-inline-size: 2rem;[^}]*min-block-size: 2rem;/)
  })

  it('keeps native button states, attributes, and trusted activation handlers intact', () => {
    const onClick = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement('button', {
        className: settingsButtonClass({ variant: 'danger' }),
        type: 'button', disabled: true, 'aria-busy': true, onClick
      }, 'Delete provider'))
    })
    const button = renderer.root.findByType('button')
    expect(button.props.disabled).toBe(true)
    expect(button.props['aria-busy']).toBe(true)
    expect(button.props.onClick).toBe(onClick)
    expect(button.props.type).toBe('button')
  })
})

describe('settings row naming', () => {
  it('links the native field to its visible label and description', () => {
    const html = renderToStaticMarkup(createElement(SettingRow, {
      title: 'Theme', description: 'Choose the appearance',
      control: createElement('select', { defaultValue: 'light' }, createElement('option', { value: 'light' }, 'Light'))
    }))
    const select = html.match(/<select[^>]+>/)?.[0] ?? ''
    const labelledBy = select.match(/aria-labelledby="([^"]+)"/)?.[1]
    const describedBy = select.match(/aria-describedby="([^"]+)"/)?.[1]
    expect(labelledBy).toBeTruthy()
    expect(describedBy).toBeTruthy()
    expect(html).toContain(`id="${labelledBy}"`)
    expect(html).toContain(`id="${describedBy}"`)
  })

  it('names shared switches and model/secret inputs without overriding explicit names', () => {
    const noop = () => undefined
    const controls = [
      createElement(Toggle, { checked: false, onChange: noop }),
      createElement(ModelSelect, { value: '', options: [], onChange: noop }),
      createElement(SecretInput, { value: '', onChange: noop, visible: false, onToggleVisibility: noop, showLabel: 'Show', hideLabel: 'Hide' })
    ]
    for (const control of controls) {
      const html = renderToStaticMarkup(createElement(SettingRow, { title: 'Named setting', control }))
      expect(html).toContain('aria-label="Named setting"')
    }
    const html = renderToStaticMarkup(createElement(SettingRow, { title: 'Row',
      control: createElement(Toggle, { checked: false, onChange: noop, ariaLabel: 'Explicit control' }) }))
    expect(html).toContain('aria-label="Explicit control"')
  })
})

describe('compact settings navigation', () => {
  it('keeps the same routes, platform guards and category change handler', () => {
    const setCategory = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => {
      renderer = create(createElement(SettingsSidebar, {
        category: 'providers', setCategory, goBack: vi.fn(), platform: 'win32',
        extensionSettingsAvailable: true, t: (key) => key
      }))
    })
    const select = renderer.root.findByType('select')
    expect(select.props.value).toBe('providers')
    expect(select.props['aria-label']).toBe('title')
    const routes = renderer.root.findAllByType('button').flatMap((button) =>
      button.props['data-settings-category'] ? [button.props['data-settings-category']] : [])
    expect(select.findAllByType('option').map((option) => option.props.value)).toEqual(routes)
    expect(routes).toHaveLength(22)
    expect(routes).not.toContain('integrations')
    act(() => select.props.onChange({ target: { value: 'memory' } }))
    expect(setCategory).toHaveBeenCalledWith('memory')
  })
})

describe('settings switch target', () => {
  it('scopes a scale-aware hit area around the original track and thumb', () => {
    const css = readFileSync(new URL('../styles/settings-layout.css', import.meta.url), 'utf8')
    expect(css).toMatch(/\.ds-settings-surface :is\(\.ds-settings-toggle, \[data-settings-switch\]\) \{[^}]*min-block-size: max\(2rem, calc\(25px \/ var\(--ds-ui-scale, 1\)\)\);[^}]*background: transparent;/)
    expect(css).toContain('--settings-switch-track-height: 1.25rem;')
    expect(css).toContain('--settings-switch-track-height: 1.5rem;')
    expect(css).toContain('margin-block-start: calc(-1 * var(--settings-switch-thumb-half));')
  })

  it('keeps checked and disabled activation semantics unchanged', () => {
    const onChange = vi.fn()
    let renderer!: ReturnType<typeof create>
    act(() => { renderer = create(createElement(Toggle, { checked: false, onChange, ariaLabel: 'Setting' })) })
    let button = renderer.root.findByType('button')
    expect(button.props['aria-checked']).toBe(false)
    act(() => button.props.onClick())
    expect(onChange).toHaveBeenLastCalledWith(true)
    act(() => renderer.update(createElement(Toggle, { checked: true, disabled: true, onChange, ariaLabel: 'Setting' })))
    button = renderer.root.findByType('button')
    expect(button.props['aria-checked']).toBe(true)
    expect(button.props.disabled).toBe(true)
    act(() => button.props.onClick())
    expect(onChange).toHaveBeenCalledOnce()
    act(() => renderer.unmount())
  })
})
