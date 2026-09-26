import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import { ContextWindowSettingsPanel } from './settings-section-lab-context-window'

const labels: Record<string, string> = {
  labContextWindowTitle: 'Windowed context (experimental)',
  labContextWindowDescription: 'Experimental windowed context.',
  labContextWindowEnabled: 'Enable windowed context',
  labContextWindowEnabledDesc: 'Uses notes and on-demand history instead of summary compaction.'
}
const t = (key: string): string => labels[key] ?? key

describe('ContextWindowSettingsPanel', () => {
  it('defaults off and describes on-demand history retrieval', () => {
    const markup = renderToStaticMarkup(createElement(ContextWindowSettingsPanel, {
      t,
      windowModeEnabled: false,
      onChange: () => undefined
    }))
    expect(markup).toContain('Windowed context')
    expect(markup).toContain('Uses notes and on-demand history instead of summary compaction.')
    expect(markup).toContain('aria-checked="false"')
  })

  it('toggles the existing contextCompaction window-mode flag', async () => {
    const onChange = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ContextWindowSettingsPanel, {
        t,
        windowModeEnabled: false,
        onChange
      }))
    })
    const toggle = renderer.root.findByProps({ role: 'switch' })
    await act(async () => {
      toggle.props.onClick()
    })
    expect(onChange).toHaveBeenCalledWith(true)
    await act(async () => renderer.unmount())
  })
})
