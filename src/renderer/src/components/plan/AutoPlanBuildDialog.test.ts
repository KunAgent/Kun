import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement } from 'react'
import { act, create, type ReactTestRenderer } from 'react-test-renderer'
import { defaultKunLabSettings, normalizeAppSettings } from '@shared/app-settings'
import { useChatStore } from '../../store/chat-store'
import i18n from '../../i18n'
import { AutoPlanBuildDialog } from './AutoPlanBuildDialog'

const NOW = new Date('2030-06-15T08:00:00.000Z')

async function renderDialog(overrides: Record<string, unknown> = {}) {
  const onClose = vi.fn()
  const onSubmit = vi.fn(async () => undefined)
  let renderer!: ReactTestRenderer
  await act(async () => {
    renderer = create(createElement(AutoPlanBuildDialog, {
      settings: normalizeAppSettings({} as never),
      defaults: defaultKunLabSettings().autoPlanBuild,
      submitting: false,
      error: '',
      onClose,
      onSubmit,
      ...overrides
    }))
  })
  return { renderer, onClose, onSubmit }
}

describe('AutoPlanBuildDialog', () => {
  beforeEach(async () => {
    vi.useFakeTimers()
    vi.setSystemTime(NOW)
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    useChatStore.setState({
      composerModel: 'deepseek-chat',
      composerProviderId: 'deepseek',
      composerReasoningEffort: 'high'
    })
    await i18n.changeLanguage('en')
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  })

  afterEach(async () => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
    Reflect.deleteProperty(globalThis, 'IS_REACT_ACT_ENVIRONMENT')
    await i18n.changeLanguage('en')
  })

  it('defaults to Direct, keeps schedule fields hidden, and submits use-once choices', async () => {
    const { renderer, onSubmit } = await renderDialog()
    expect(renderer.root.findAllByProps({ 'data-auto-plan-build-schedule-fields': true })).toHaveLength(0)
    const worktree = renderer.root.findByProps({ 'data-auto-plan-build-worktree': true })
    expect(worktree.props['aria-checked']).toBe(true)
    await act(async () => worktree.props.onClick())
    await act(async () => renderer.root.findByProps({ 'data-auto-plan-build-use-once': true }).props.onClick())
    expect(onSubmit).toHaveBeenCalledWith({ buildMode: 'direct', useWorktree: false }, false)
    await act(async () => renderer.unmount())
  })

  it('requires a fresh scheduled time and saves reusable choices without changing its payload', async () => {
    const defaults = {
      ...defaultKunLabSettings().autoPlanBuild,
      defaultBuildMode: 'scheduled' as const,
      useWorktreeByDefault: false,
      scheduledDefaults: {
        providerId: 'deepseek',
        model: 'deepseek-chat',
        reasoningEffort: 'high' as const,
        timeZone: 'Africa/Abidjan'
      }
    }
    const { renderer, onSubmit } = await renderDialog({ defaults })
    expect(renderer.root.findAllByProps({ 'data-auto-plan-build-schedule-fields': true })).toHaveLength(1)
    await act(async () => {
      renderer.root.findByProps({ 'data-auto-plan-schedule-date': true }).props.onChange({ target: { value: '2030-06-16' } })
      renderer.root.findByProps({ 'data-auto-plan-schedule-time': true }).props.onChange({ target: { value: '10:00' } })
    })
    await act(async () => renderer.root.findByProps({ 'data-auto-plan-build-save-default': true }).props.onClick())
    expect(onSubmit).toHaveBeenCalledWith(expect.objectContaining({
      buildMode: 'scheduled',
      useWorktree: false,
      scheduled: expect.objectContaining({
        providerId: 'deepseek',
        reasoningEffort: 'high',
        schedule: {
          kind: 'at',
          atTime: '2030-06-16T10:00:00.000Z',
          timeZone: 'Africa/Abidjan'
        }
      })
    }), true)
    await act(async () => renderer.unmount())
  })

  it('disables submission for a past scheduled time', async () => {
    const defaults = {
      ...defaultKunLabSettings().autoPlanBuild,
      defaultBuildMode: 'scheduled' as const
    }
    const { renderer, onSubmit } = await renderDialog({ defaults })
    await act(async () => {
      renderer.root.findByProps({ 'data-auto-plan-schedule-date': true }).props.onChange({ target: { value: '2030-06-14' } })
      renderer.root.findByProps({ 'data-auto-plan-schedule-time': true }).props.onChange({ target: { value: '10:00' } })
    })
    expect(renderer.root.findByProps({ 'data-auto-plan-build-use-once': true }).props.disabled).toBe(true)
    expect(onSubmit).not.toHaveBeenCalled()
    await act(async () => renderer.unmount())
  })
})
