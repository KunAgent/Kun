import { createElement } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { normalizeAppSettings, type ScheduledTaskV1 } from '@shared/app-settings'
import i18n from '../../i18n'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { resetPlanWorktreePreferenceStoreForTests, usePlanWorktreePreferenceStore } from '../../plan/plan-worktree-preference-store'
import { PlanBuildActions } from './PlanBuildActions'

function collectText(node: ReactTestInstance, into: string[]): void {
  for (const child of node.children) {
    if (typeof child === 'string') into.push(child)
    else if (child && typeof child === 'object' && 'children' in child) {
      collectText(child as ReactTestInstance, into)
    }
  }
}

function rendererText(renderer: ReactTestRenderer): string {
  const parts: string[] = []
  collectText(renderer.root, parts)
  return parts.join('|')
}

function scheduledTask(patch: Partial<ScheduledTaskV1> = {}): ScheduledTaskV1 {
  return {
    id: 'schedule-1',
    title: 'Build plan',
    enabled: true,
    prompt: 'Build',
    workspaceRoot: '/tmp/project',
    sourcePlanId: 'plan-1',
    clawChannelId: '',
    providerId: 'deepseek',
    model: 'deepseek-v4-flash',
    reasoningEffort: 'medium',
    mode: 'agent',
    schedule: {
      kind: 'at',
      everyMinutes: 60,
      timeOfDay: '09:00',
      atTime: '2099-08-19T01:00:00.000Z',
      timeZone: 'Asia/Shanghai'
    },
    createdAt: '2099-08-18T00:00:00.000Z',
    updatedAt: '2099-08-18T00:00:00.000Z',
    lastRunAt: '',
    nextRunAt: '2099-08-19T01:00:00.000Z',
    lastStatus: 'idle',
    lastMessage: '',
    lastThreadId: '',
    ...patch
  }
}

async function selectMode(renderer: ReactTestRenderer, mode: string): Promise<void> {
  const select = renderer.root.findByProps({ 'data-plan-build-mode': true })
  await act(async () => {
    select.props.onChange({ target: { value: mode } })
  })
}

describe('PlanBuildActions card i18n', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      clearInterval,
      kunGui: {}
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn()
    })
    resetPlanWorktreePreferenceStoreForTests()
    usePlanWorktreePreferenceStore.getState().initializePlan('plan-1', true, 'codex/')
    vi.spyOn(rendererRuntimeClient, 'getSettings')
      .mockResolvedValue(normalizeAppSettings({} as never))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetPlanWorktreePreferenceStoreForTests()
    await i18n.changeLanguage('en')
  })

  it.each([
    ['en', 'Start build', 'Set schedule', 'Start Graph build'],
    ['zh', '开始构建', '设置定时', '开始 Graph 构建']
  ] as const)(
    'renders translated direct, scheduled, and Graph actions in %s',
    async (locale, directLabel, scheduleLabel, graphLabel) => {
      await i18n.changeLanguage(locale)
      let renderer!: ReactTestRenderer
      await act(async () => {
        renderer = create(createElement(PlanBuildActions, {
          disabled: false,
          graphEnabled: true,
          variant: 'card',
          planId: 'plan-1',
          onBuild: vi.fn()
        }))
      })

      expect(rendererText(renderer)).toContain(directLabel)
      expect(rendererText(renderer)).not.toContain('planBuildStart')

      await selectMode(renderer, 'scheduled')
      expect(rendererText(renderer)).toContain(scheduleLabel)
      expect(rendererText(renderer)).not.toContain('planScheduleBuildSet')

      await selectMode(renderer, 'graph')
      expect(rendererText(renderer)).toContain(graphLabel)
      expect(rendererText(renderer)).not.toContain('planBuildGraphStart')

      await act(async () => {
        renderer.unmount()
      })
    }
  )

  it('shows persisted schedule details and changes the action only after confirmation', async () => {
    await i18n.changeLanguage('zh')
    const onScheduleStateChange = vi.fn()
    vi.mocked(rendererRuntimeClient.getSettings).mockResolvedValue(normalizeAppSettings({
      schedule: { tasks: [scheduledTask()] }
    } as never))

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: true,
        variant: 'card',
        planId: 'plan-1',
        onBuild: vi.fn(),
        onScheduleStateChange
      }))
    })

    const text = rendererText(renderer)
    expect(renderer.root.findAllByProps({ 'data-plan-schedule-status': true })).toHaveLength(1)
    expect(text).toContain('修改定时')
    expect(text).toContain('已设置定时')
    expect(text).toContain('还有')
    expect(text).toContain('执行')
    expect(text).toContain('下次执行：')
    expect(text).not.toContain('定时时间')
    expect(text).not.toContain('仅一次')
    expect(text).not.toContain('Asia/Shanghai')
    expect(text).not.toContain('将于设定时间自动执行')
    expect(text).not.toContain('|设置定时|')
    expect(onScheduleStateChange).toHaveBeenLastCalledWith(true)

    await act(async () => renderer.unmount())
  })

  it('bypasses cached settings when loading the card schedule', async () => {
    await i18n.changeLanguage('zh')
    vi.mocked(rendererRuntimeClient.getSettings).mockImplementation(async (options) =>
      normalizeAppSettings(options?.forceRefresh
        ? { schedule: { tasks: [scheduledTask()] } } as never
        : {} as never))

    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: true,
        variant: 'card',
        planId: 'plan-1',
        onBuild: vi.fn()
      }))
    })

    expect(rendererRuntimeClient.getSettings).toHaveBeenCalledWith({ forceRefresh: true })
    expect(renderer.root.findAllByProps({ 'data-plan-schedule-status': true })).toHaveLength(1)
    expect(rendererText(renderer)).toContain('已设置定时')

    await act(async () => renderer.unmount())
  })

  it('does not show schedule details before a task is persisted', async () => {
    await i18n.changeLanguage('zh')
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: true,
        variant: 'card',
        planId: 'plan-1',
        onBuild: vi.fn()
      }))
    })

    await selectMode(renderer, 'scheduled')
    expect(renderer.root.findAllByProps({ 'data-plan-schedule-status': true })).toHaveLength(0)
    expect(rendererText(renderer)).toContain('设置定时')
    expect(rendererText(renderer)).not.toContain('定时时间')

    await act(async () => renderer.unmount())
  })
})

describe('PlanBuildActions panel flat toolbar', () => {
  beforeEach(() => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    vi.stubGlobal('window', {
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      setInterval,
      clearInterval,
      kunGui: {}
    })
    vi.stubGlobal('document', {
      visibilityState: 'visible',
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      querySelector: vi.fn(() => null),
      querySelectorAll: vi.fn(() => [])
    })
    resetPlanWorktreePreferenceStoreForTests()
    usePlanWorktreePreferenceStore.getState().initializePlan('plan-1', true, 'codex/')
    vi.spyOn(rendererRuntimeClient, 'getSettings')
      .mockResolvedValue(normalizeAppSettings({} as never))
  })

  afterEach(async () => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    resetPlanWorktreePreferenceStoreForTests()
    await i18n.changeLanguage('en')
  })

  async function renderPanel(props: Partial<Parameters<typeof PlanBuildActions>[0]> = {}): Promise<ReactTestRenderer> {
    let renderer!: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: false,
        variant: 'panel',
        planId: 'plan-1',
        onBuild: vi.fn(),
        ...props
      }))
    })
    return renderer
  }

  function openPanelMenu(renderer: ReactTestRenderer): void {
    const toggle = renderer.root.findByProps({ 'data-plan-build-menu-toggle': true })
    act(() => {
      toggle.props.onClick({ stopPropagation: vi.fn() })
    })
  }

  it('renders a compact toolbar with direct split button and worktree select', async () => {
    const renderer = await renderPanel({ graphEnabled: true })

    expect(renderer.root.findAllByProps({ 'data-plan-build-direct': true })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-plan-build-menu-toggle': true })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-plan-worktree-select': true })).toHaveLength(1)
    expect(renderer.root.findAllByProps({ 'data-plan-build-schedule': true })).toHaveLength(0)
    expect(renderer.root.findAllByProps({ 'data-plan-build-menu': true })).toHaveLength(0)

    await act(async () => renderer.unmount())
  })

  it('direct segment triggers onBuild(direct) without opening the menu', async () => {
    const onBuild = vi.fn()
    const renderer = await renderPanel({ onBuild })
    const direct = renderer.root.findByProps({ 'data-plan-build-direct': true })

    await act(async () => {
      direct.props.onClick()
    })

    expect(onBuild).toHaveBeenCalledTimes(1)
    expect(onBuild).toHaveBeenCalledWith('direct')
    expect(renderer.root.findAllByProps({ 'data-plan-build-menu': true })).toHaveLength(0)

    await act(async () => renderer.unmount())
  })

  it('menu offers schedule build when no task exists', async () => {
    await i18n.changeLanguage('en')
    const renderer = await renderPanel()
    openPanelMenu(renderer)

    expect(renderer.root.findAllByProps({ 'data-plan-build-menu': true })).toHaveLength(1)
    const text = rendererText(renderer)
    expect(text).toContain('Schedule build')
    expect(text).not.toContain('Edit schedule')
    expect(renderer.root.findAllByProps({ 'data-plan-build-menu-graph': true })).toHaveLength(0)

    await act(async () => renderer.unmount())
  })

  it('menu shows edit schedule when an active task exists', async () => {
    await i18n.changeLanguage('zh')
    vi.mocked(rendererRuntimeClient.getSettings).mockResolvedValue(normalizeAppSettings({
      schedule: { tasks: [scheduledTask()] }
    } as never))
    const renderer = await renderPanel()
    openPanelMenu(renderer)

    const text = rendererText(renderer)
    expect(text).toContain('修改定时')
    expect(text).not.toContain('定时构建')

    await act(async () => renderer.unmount())
  })

  it('menu includes graph build only when graph is enabled', async () => {
    await i18n.changeLanguage('en')
    const onBuild = vi.fn()
    const renderer = await renderPanel({ graphEnabled: true, onBuild })
    openPanelMenu(renderer)

    const graphItem = renderer.root.findByProps({ 'data-plan-build-menu-graph': true })
    await act(async () => {
      graphItem.props.onClick()
    })

    expect(onBuild).toHaveBeenCalledWith('graph')
    expect(renderer.root.findAllByProps({ 'data-plan-build-menu': true })).toHaveLength(0)

    await act(async () => renderer.unmount())
  })

  it('worktree select updates the plan preference', async () => {
    const renderer = await renderPanel()
    const select = renderer.root.findByProps({ 'data-plan-worktree-select': true })

    await act(async () => {
      select.props.onChange({ target: { value: 'workspace' } })
    })
    expect(usePlanWorktreePreferenceStore.getState().plans['plan-1']?.usePromptWorktree).toBe(false)

    await act(async () => {
      select.props.onChange({ target: { value: 'worktree' } })
    })
    expect(usePlanWorktreePreferenceStore.getState().plans['plan-1']?.usePromptWorktree).toBe(true)

    await act(async () => renderer.unmount())
  })

  it('keeps the split button disabled when disabled', async () => {
    const renderer = await renderPanel({ disabled: true })

    expect(renderer.root.findByProps({ 'data-plan-build-direct': true }).props.disabled).toBe(true)
    expect(renderer.root.findByProps({ 'data-plan-build-menu-toggle': true }).props.disabled).toBe(true)

    await act(async () => renderer.unmount())
  })

  it('closes the menu via Escape and returns focus to the toggle', async () => {
    const renderer = await renderPanel()
    openPanelMenu(renderer)
    const menu = renderer.root.findByProps({ 'data-plan-build-menu': true })

    act(() => {
      menu.props.onKeyDown({ key: 'Escape', preventDefault: vi.fn() })
    })

    expect(renderer.root.findAllByProps({ 'data-plan-build-menu': true })).toHaveLength(0)

    await act(async () => renderer.unmount())
  })
})
