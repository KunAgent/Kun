import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { describe, expect, it, vi } from 'vitest'
import {
  defaultKunLabSettings,
  normalizeAppSettings
} from '@shared/app-settings'
import { AutoPlanBuildSettingsPanel } from './settings-section-lab-auto-plan-build'

const t = (key: string): string => key

async function renderPanel(mode: 'direct' | 'scheduled' = 'direct') {
  const onChange = vi.fn()
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(AutoPlanBuildSettingsPanel, {
      t,
      settings: normalizeAppSettings({} as never),
      value: {
        ...defaultKunLabSettings(),
        autoPlanBuild: {
          ...defaultKunLabSettings().autoPlanBuild,
          defaultBuildMode: mode
        }
      },
      selectControlClass: 'select',
      onChange
    }))
  })
  return { renderer, onChange }
}

describe('AutoPlanBuildSettingsPanel', () => {
  it('renders disabled safe defaults independently from manual plan execution', async () => {
    const { renderer, onChange } = await renderPanel()
    expect(renderer.root.findByProps({ 'data-auto-plan-build-confirmation': true }).props.value).toBe('always')
    expect(renderer.root.findByProps({ 'data-auto-plan-build-default-mode': true }).props.value).toBe('direct')
    expect(renderer.root.findAllByProps({ title: 'scheduleProvider' })).toHaveLength(0)
    await act(async () => {
      renderer.root.findByProps({ 'data-auto-plan-build-confirmation': true }).props.onChange({ target: { value: 'defaults' } })
    })
    expect(onChange).toHaveBeenCalledWith({ autoPlanBuild: { confirmation: 'defaults' } })
    await act(async () => renderer.unmount())
  })

  it('shows reusable scheduled model and time-zone controls for scheduled defaults', async () => {
    const { renderer } = await renderPanel('scheduled')
    const selects = renderer.root.findAllByType('select')
    expect(selects.length).toBeGreaterThanOrEqual(6)
    expect(selects.some((select) => select.props.value === 'direct')).toBe(false)
    await act(async () => renderer.unmount())
  })
})
