import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  LaboratorySettingsSection,
  baseCtx,
  createRenderer,
  defaultKunRuntimeSettings
} from './settings-section-agents.test-support'
import { ContextWindowSettingsPanel } from './settings-section-lab-context-window'

const labels: Record<string, string> = {
  labContextCompressionTitle: 'Context compression',
  labContextCompressionDescription: 'Experimental context compression.',
  labModelInitiatedCompactionEnabled: 'Model-initiated context compression',
  labModelInitiatedCompactionEnabledDesc: 'Gives the model budget notices and a compression tool.',
  labContextWindowEnabled: 'Enable windowed context',
  labContextWindowEnabledDesc: 'Requires model-initiated context compression.'
}
const t = (key: string): string => labels[key] ?? key

describe('ContextWindowSettingsPanel', () => {
  it('defaults off and describes model-initiated compression', () => {
    const markup = renderToStaticMarkup(createElement(ContextWindowSettingsPanel, {
      t,
      modelInitiatedCompactionEnabled: false,
      windowModeEnabled: false,
      onModelInitiatedChange: () => undefined,
      onWindowModeChange: () => undefined
    }))
    expect(markup).toContain('Context compression')
    expect(markup).toContain('Experimental context compression.')
    expect(markup).toContain('Enable windowed context')
    expect(markup).toContain('data-open="false"')
    expect(markup).toContain('aria-checked="false"')
    expect(markup).toContain('aria-disabled="true"')
  })

  it('disables the windowed-context toggle until the parent switch is on', async () => {
    const onWindowModeChange = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ContextWindowSettingsPanel, {
        t,
        modelInitiatedCompactionEnabled: false,
        windowModeEnabled: true,
        onModelInitiatedChange: () => undefined,
        onWindowModeChange
      }))
    })
    const windowToggle = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Enable windowed context'
    })
    expect(windowToggle.props.disabled).toBe(true)
    await act(async () => {
      windowToggle.props.onClick()
    })
    expect(onWindowModeChange).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })

  it('toggles the parent switch independently of windowed context', async () => {
    const onModelInitiatedChange = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ContextWindowSettingsPanel, {
        t,
        modelInitiatedCompactionEnabled: false,
        windowModeEnabled: false,
        onModelInitiatedChange,
        onWindowModeChange: () => undefined
      }))
    })
    const parentToggle = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Model-initiated context compression'
    })
    await act(async () => {
      parentToggle.props.onClick()
    })
    expect(onModelInitiatedChange).toHaveBeenCalledWith(true)
    await act(async () => renderer.unmount())
  })

  it('toggles windowed context after the parent switch is on', async () => {
    const onWindowModeChange = vi.fn()
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(ContextWindowSettingsPanel, {
        t,
        modelInitiatedCompactionEnabled: true,
        windowModeEnabled: false,
        onModelInitiatedChange: () => undefined,
        onWindowModeChange
      }))
    })
    const windowToggle = renderer.root.findByProps({
      role: 'switch',
      'aria-label': 'Enable windowed context'
    })
    expect(windowToggle.props.disabled).toBe(false)
    await act(async () => {
      windowToggle.props.onClick()
    })
    expect(onWindowModeChange).toHaveBeenCalledWith(true)
    await act(async () => renderer.unmount())
  })
})

describe('LaboratorySettingsSection context compression toggles', () => {
  it('turns off windowed context together with the parent switch', () => {
    const updateKun = vi.fn()
    const defaults = defaultKunRuntimeSettings()
    let renderer!: ReactTestRenderer
    act(() => {
      renderer = createRenderer(createElement(LaboratorySettingsSection, {
        ctx: {
          ...baseCtx(),
          kun: {
            ...defaults,
            contextCompaction: {
              ...defaults.contextCompaction,
              modelInitiatedCompactionEnabled: true,
              windowModeEnabled: true
            }
          },
          updateKun
        }
      }))
    })
    const panel = renderer.root
    const parentToggle = panel.findByProps({
      role: 'switch',
      'aria-label': 'Model-initiated context compression'
    })
    const windowToggle = panel.findByProps({
      role: 'switch',
      'aria-label': 'Enable windowed context'
    })
    expect(windowToggle.props.disabled).toBe(false)
    expect(windowToggle.props['aria-checked']).toBe(true)
    act(() => parentToggle.props.onClick())
    expect(updateKun).toHaveBeenCalledWith({
      contextCompaction: expect.objectContaining({
        modelInitiatedCompactionEnabled: false,
        windowModeEnabled: false
      })
    })
  })
})
