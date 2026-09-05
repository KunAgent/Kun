import { createElement, createRef } from 'react'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ToolBlock } from '../../agent/types'
import i18n from '../../i18n'
import { PlanBuildActions } from '../plan/PlanBuildActions'
import { ReviewPlanCard, TurnChangeSummary } from './message-timeline-cards'
import {
  resetPlanWorktreePreferenceStoreForTests,
  usePlanWorktreePreferenceStore
} from '../../plan/plan-worktree-preference-store'

function change(index: number): ToolBlock {
  const path = `src/file-${index}.ts`
  return {
    kind: 'tool',
    id: `change-${index}`,
    summary: `Edit ${path}`,
    status: 'success',
    toolKind: 'file_change',
    filePath: path,
    detail: [
      `diff --git a/${path} b/${path}`,
      `--- a/${path}`,
      `+++ b/${path}`,
      '@@ -1 +1 @@',
      `-old ${index}`,
      `+new ${index}`
    ].join('\n')
  }
}

function nodeText(value: unknown): string {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(nodeText).join('')
  return ''
}

function buttonWithText(renderer: ReactTestRenderer, text: string): ReactTestInstance {
  const button = renderer.root
    .findAllByType('button')
    .find((candidate) => nodeText(candidate.props.children).includes(text))
  if (!button) throw new Error(`Missing button: ${text}`)
  return button
}

describe('TurnChangeSummary', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
  })

  it('previews three files, reveals the rest, and keeps change actions on the turn card', async () => {
    const onOpenChanges = vi.fn()
    const onReviewChanges = vi.fn()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        createElement(TurnChangeSummary, {
          changes: [1, 2, 3, 4, 5].map(change),
          viewportRef: createRef<HTMLDivElement>(),
          onOpenChanges,
          onReviewChanges
        })
      )
    })

    expect(renderer!.root.findAllByProps({ 'data-turn-change-summary': true })).toHaveLength(1)
    expect(renderer!.root.findAllByProps({ 'data-turn-change-file': true })).toHaveLength(3)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Edited 5 files')
    expect(JSON.stringify(renderer!.toJSON())).toContain('src/file-3.ts')
    expect(JSON.stringify(renderer!.toJSON())).not.toContain('src/file-4.ts')

    await act(async () => {
      buttonWithText(renderer!, 'Preview').props.onClick()
      buttonWithText(renderer!, 'Review').props.onClick()
      buttonWithText(renderer!, 'Show 2 more files').props.onClick()
    })

    expect(onOpenChanges).toHaveBeenCalledTimes(1)
    expect(onReviewChanges).toHaveBeenCalledTimes(1)
    expect(renderer!.root.findAllByProps({ 'data-turn-change-file': true })).toHaveLength(5)
    expect(buttonWithText(renderer!, 'Show fewer files')).toBeTruthy()

    act(() => renderer!.unmount())
  })
})

describe('plan build actions', () => {
  beforeEach(async () => {
    await i18n.changeLanguage('en')
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
  })

  it('selects a rounded card build mode before starting the requested orchestration', async () => {
    const onBuild = vi.fn()
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(ReviewPlanCard, {
        title: 'Checkout plan',
        relativePath: '.kunsdd/plan/checkout.md',
        busy: false,
        graphEnabled: true,
        onOpen: vi.fn(),
        onBuild
      }))
    })

    const card = renderer!.root.findByProps({ 'data-review-plan-card': true })
    const actions = renderer!.root.findByProps({ 'data-plan-build-actions-variant': 'card' })
    const start = renderer!.root.findByProps({ 'data-plan-build-start': true })
    expect(card.props.className).toContain('rounded-[26px]')
    expect(card.props.className).toContain('flex-col')
    expect(actions.props.className).toContain('flex-wrap')

    const direct = renderer!.root.findByProps({ 'data-plan-build-mode': true })
    expect(direct.props.value).toBe('direct')
    expect(start.props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Plan ready')
    expect(JSON.stringify(renderer!.toJSON())).toContain('Start build')

    await act(async () => {
      direct.props.onChange({ target: { value: 'graph' } })
    })
    expect(renderer!.root.findByProps({ 'data-plan-build-mode': true }).props.value).toBe('graph')

    await act(async () => {
      renderer!.root.findByProps({ 'data-plan-build-start': true }).props.onClick()
      renderer!.root.findByProps({ 'data-plan-build-mode': true }).props.onChange({ target: { value: 'direct' } })
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-plan-build-start': true }).props.onClick()
    })
    expect(onBuild.mock.calls).toEqual([['graph'], ['direct']])

    act(() => renderer!.unmount())
  })

  it('hides Graph when Graph Mode is unavailable', async () => {
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: false,
        variant: 'panel',
        onBuild: vi.fn()
      }))
    })

    const actions = renderer!.root.findByProps({ 'data-plan-build-actions-variant': 'panel' })
    const graphButtons = renderer!.root.findAllByType('button').filter((button) => nodeText(button.props.children).includes('Graph build'))
    expect(actions.props.className).toContain('flex-wrap')
    expect(renderer!.root.findByProps({ 'data-plan-build-direct': true }).props.disabled).toBe(false)
    expect(graphButtons).toHaveLength(0)

    act(() => renderer!.unmount())
  })

  it('hides isolated-worktree controls while the Laboratory experiment is off', async () => {
    usePlanWorktreePreferenceStore.getState().initializePlan('plan-disabled', false, 'codex/')
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(createElement(PlanBuildActions, {
        disabled: false,
        graphEnabled: true,
        variant: 'panel',
        planId: 'plan-disabled',
        onBuild: vi.fn()
      }))
    })

    expect(renderer!.root.findAllByProps({ role: 'switch' })).toHaveLength(0)
    expect(renderer!.root.findByProps({ 'data-plan-build-direct': true }).props.disabled).toBe(false)
    act(() => renderer!.unmount())
  })

  it('shares one isolation override between panel and inline card actions', async () => {
    const store = usePlanWorktreePreferenceStore.getState()
    store.initializePlan('plan-shared', true, 'codex/')
    let renderer: ReactTestRenderer
    await act(async () => {
      renderer = create(createElement('div', null,
        createElement(PlanBuildActions, {
          disabled: false,
          graphEnabled: true,
          variant: 'panel',
          planId: 'plan-shared',
          onBuild: vi.fn()
        }),
        createElement(PlanBuildActions, {
          disabled: false,
          graphEnabled: true,
          variant: 'card',
          planId: 'plan-shared',
          onBuild: vi.fn()
        })
      ))
    })

    const panelSelect = renderer!.root.findByProps({ 'data-plan-worktree-select': true })
    const switches = renderer!.root.findAllByProps({ role: 'switch' })
    expect(panelSelect.props.value).toBe('worktree')
    expect(switches.map((item) => item.props['aria-checked'])).toEqual([true])
    await act(async () => switches[0]!.props.onClick())
    expect(renderer!.root.findByProps({ 'data-plan-worktree-select': true }).props.value).toBe('workspace')
    expect(renderer!.root.findAllByProps({ role: 'switch' })
      .map((item) => item.props['aria-checked'])).toEqual([false])
    expect(renderer!.root.findAllByProps({ 'data-plan-build-mode': true }))
      .toHaveLength(1)

    const cardMode = renderer!.root.findByProps({ 'data-plan-build-mode': true })
    await act(async () => cardMode.props.onChange({ target: { value: 'graph' } }))
    const graphSwitches = renderer!.root.findAllByProps({ role: 'switch' })
    expect(graphSwitches[0]!.props.disabled).toBe(true)
    expect(JSON.stringify(renderer!.toJSON())).toContain(
      'Prompt-managed worktrees are available for Direct builds only'
    )
    await act(async () => renderer!.root.findByProps({
      'data-plan-build-mode': true
    }).props.onChange({ target: { value: 'direct' } }))
    expect(renderer!.root.findAllByProps({ role: 'switch' })[0]!.props.disabled).toBe(false)
    expect(renderer!.root.findAllByProps({ role: 'switch' })
      .map((item) => item.props['aria-checked'])).toEqual([false])

    act(() => renderer!.unmount())
  })
})
