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

  it('leads each row with the file name, keeps the folder secondary, and shows a diff bar', async () => {
    let renderer: ReactTestRenderer

    await act(async () => {
      renderer = create(
        createElement(TurnChangeSummary, {
          changes: [change(1)],
          viewportRef: createRef<HTMLDivElement>()
        })
      )
    })

    const row = renderer!.root.findByProps({ 'data-turn-change-file': true })
    const rowButton = row.findByType('button')
    expect(rowButton.props.title).toBe('src/file-1.ts')
    const texts = rowButton.findAllByType('span').map((span) => nodeText(span.props.children))
    expect(texts).toContain('file-1.ts')
    expect(texts).toContain('src')
    expect(renderer!.root.findAllByProps({ 'data-turn-change-diff-bar': true })).toHaveLength(1)

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

  it('starts a direct build from the card and Graph from its menu', async () => {
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
    expect(card.props.className).toContain('rounded-[22px]')
    expect(card.props.className).toContain('flex-col')
    expect(actions.props.className).toContain('flex-wrap')

    expect(start.props.disabled).toBe(false)
    expect(JSON.stringify(renderer!.toJSON())).toContain('Plan ready')
    expect(JSON.stringify(renderer!.toJSON())).toContain('Start build')

    await act(async () => {
      renderer!.root.findByProps({ 'data-plan-build-menu-toggle': true }).props.onClick()
    })
    await act(async () => {
      renderer!.root.findByProps({ 'data-plan-build-menu-graph': true }).props.onClick()
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

    const selects = () => renderer!.root.findAllByProps({ 'data-plan-worktree-select': true })
      .filter((item) => item.type === 'select')
    expect(selects().map((item) => item.props.value)).toEqual(['worktree', 'worktree'])
    await act(async () => selects()[1]!.props.onChange({ target: { value: 'workspace' } }))
    expect(selects().map((item) => item.props.value)).toEqual(['workspace', 'workspace'])
    await act(async () => selects()[0]!.props.onChange({ target: { value: 'worktree' } }))
    expect(selects().map((item) => item.props.value)).toEqual(['worktree', 'worktree'])

    act(() => renderer!.unmount())
  })
})
