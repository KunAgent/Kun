// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../../i18n'
import type { ThreadGoal } from '../../../agent/types'
import { useChatStore } from '../../../store/chat-store'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { clipGoalObjective, useGoalTrayKind } from './goal-tray-kind'
import type { TrayKind } from './tray-kind'

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }

function goal(overrides: Partial<ThreadGoal> = {}): ThreadGoal {
  return {
    threadId: 'thr_1',
    objective: 'Refactor the login module and get every test in src/auth passing',
    status: 'active',
    tokenBudget: null,
    tokensUsed: 142_300,
    timeUsedSeconds: 18 * 60 + 12,
    createdAt: '2026-10-24T08:00:00.000Z',
    updatedAt: '2026-10-24T08:18:00.000Z',
    ...overrides
  }
}

function context(overrides: Record<string, unknown> = {}): FloatingComposerRenderContext {
  return {
    activeThreadGoal: goal(),
    showGoalFloater: true,
    busy: false,
    pendingUserInputBlock: null,
    setGoalPanelOpen: vi.fn(),
    setActiveThreadGoalStatus: vi.fn(async () => undefined),
    clearActiveThreadGoal: vi.fn(async () => undefined),
    draft: { focusComposer: vi.fn() },
    ...overrides
  }
}

const captured: { kind: TrayKind | null } = { kind: null }

function Harness({ ctx, compact = false }: { ctx: FloatingComposerRenderContext; compact?: boolean }): ReactElement {
  const kind = useGoalTrayKind(ctx)
  captured.kind = kind
  return createElement(ComposerActivityTray, { kinds: [kind], compact })
}

describe('goal tray kind', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    captured.kind = null
    useChatStore.setState({ currentTurnStartedAtMs: null, currentTurnUserId: null, turnStartedAtByUserId: {} })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    ;(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (ctx: FloatingComposerRenderContext, compact = false): Promise<void> => {
    await act(async () => root.render(createElement(Harness, { ctx, compact })))
  }
  const segment = (): HTMLButtonElement | null => host.querySelector('[data-tray-kind="goal"]')
  const action = (name: string): HTMLButtonElement => host.querySelector<HTMLButtonElement>(`[data-goal-action="${name}"]`)!
  const openSheet = async (): Promise<void> => {
    await act(async () => segment()!.click())
  }

  it('follows the goal floater visibility, but not a pending ask-user request', async () => {
    await render(context({ showGoalFloater: false }))
    expect(captured.kind).toBeNull()
    expect(host.innerHTML).toBe('')

    await render(context({ activeThreadGoal: null }))
    expect(captured.kind).toBeNull()

    await render(context({ pendingUserInputBlock: { kind: 'user_input', id: 'ui_1' } }))
    expect(captured.kind).not.toBeNull()
    expect(host.querySelector('[data-composer-stack-item="goal"]')).not.toBeNull()
  })

  it('is a trailing segment labelled with the status and objective', async () => {
    await render(context())
    expect(captured.kind).toMatchObject({ id: 'goal', align: 'end', tone: 'running' })
    const button = segment()!
    expect(button.getAttribute('aria-label')).toBe(
      'Goal (Active): Refactor the login module and get every test in src/auth passing'
    )
    expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
    expect(button.getAttribute('aria-expanded')).toBe('false')
    expect(button.textContent).toBe('Goal18 min')
  })

  it.each([
    ['paused', 'default', 'Paused'],
    ['blocked', 'waiting', 'Blocked'],
    ['usageLimited', 'waiting', 'Limited'],
    ['budgetLimited', 'waiting', 'Budget'],
    ['complete', 'done', 'Done']
  ] as const)('shows a %s goal with its status word instead of the clock', async (status, tone, word) => {
    await render(context({ activeThreadGoal: goal({ status }) }))
    expect(captured.kind?.tone).toBe(tone)
    expect(segment()!.textContent).toBe(`Goal${word}`)
    expect(host.querySelector(`[data-goal-status="${status}"]`)).not.toBeNull()
  })

  it('shows only the icon and a short clock in compact bars', async () => {
    await render(context(), true)
    const button = segment()!
    expect(button.textContent).toBe('18m')
    expect(button.getAttribute('title')).toBe(button.getAttribute('aria-label'))
  })

  it('ticks every second while a turn runs on an active goal', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-10-24T09:00:00.000Z'))
    useChatStore.setState({ currentTurnStartedAtMs: Date.now() - 42_000 })
    await render(context({ busy: true, activeThreadGoal: goal({ timeUsedSeconds: 0 }) }))
    expect(segment()!.textContent).toBe('Goal42s')
    await act(async () => {
      vi.advanceTimersByTime(1000)
    })
    expect(segment()!.textContent).toBe('Goal43s')
  })

  it('does not tick for a paused goal or an idle composer', async () => {
    useChatStore.setState({ currentTurnStartedAtMs: Date.now() - 600_000 })
    await render(context({ busy: false, activeThreadGoal: goal({ timeUsedSeconds: 30 }) }))
    await openSheet()
    expect(host.querySelector('[data-goal-meter]')!.textContent).toContain('30s')
  })

  it('opens a sheet with the objective, actions and the goal counters', async () => {
    await render(context())
    await openSheet()
    const sheet = host.querySelector('[data-tray-sheet="goal"]')!
    expect(sheet).not.toBeNull()
    expect(segment()!.getAttribute('aria-expanded')).toBe('true')
    expect(sheet.querySelector('[data-goal-objective]')!.textContent).toBe(goal().objective)
    expect(sheet.textContent).toContain('Active')
    expect(action('edit').textContent).toBe('Edit')
    expect(action('edit').getAttribute('title')).toBe('Edit goal')
    expect(action('pause').textContent).toBe('Pause')
    expect(action('clear').textContent).toBe('Clear')
    const meter = sheet.querySelector('[data-goal-meter]')!
    expect(meter.textContent).toBe('Elapsed18 mintokens142k')
  })

  it('shows tokens against the budget and hides an empty token counter', async () => {
    await render(context({ activeThreadGoal: goal({ status: 'budgetLimited', tokensUsed: 201_000, tokenBudget: 200_000 }) }))
    await openSheet()
    expect(host.querySelector('[data-goal-meter]')!.textContent).toContain('tokens / budget201k / 200k')

    await render(context({ activeThreadGoal: goal({ tokensUsed: 0 }) }))
    expect(host.querySelector('[data-goal-meter]')!.textContent).toBe('Elapsed18 min')
  })

  it('edit opens the goal panel and focuses the composer', async () => {
    const ctx = context()
    await render(ctx)
    await openSheet()
    await act(async () => action('edit').click())
    expect(ctx.setGoalPanelOpen).toHaveBeenCalledWith(true)
    expect(ctx.draft.focusComposer).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()
  })

  it.each([
    ['an ask-user card', { kind: 'user-input', controller: {} }],
    ['an approval card', { kind: 'approval', approvals: [] }]
  ])('leaves out edit while %s holds the input slot', async (_name, composerInterrupt) => {
    const ctx = context({ composerInterrupt, pendingUserInputBlock: { kind: 'user_input', id: 'ui_1' } })
    await render(ctx)
    await openSheet()
    expect(host.querySelector('[data-tray-sheet="goal"]')).not.toBeNull()
    expect(host.querySelector('[data-goal-action="edit"]')).toBeNull()
    expect(action('pause').textContent).toBe('Pause')
    expect(action('clear').textContent).toBe('Clear')
    await act(async () => action('pause').click())
    expect(ctx.setActiveThreadGoalStatus).toHaveBeenCalledWith('paused')
    expect(ctx.setGoalPanelOpen).not.toHaveBeenCalled()
    expect(ctx.draft.focusComposer).not.toHaveBeenCalled()
    expect(segment()).not.toBeNull()
  })

  it('pauses an active goal and resumes any other status', async () => {
    const active = context()
    await render(active)
    await openSheet()
    await act(async () => action('pause').click())
    expect(active.setActiveThreadGoalStatus).toHaveBeenCalledWith('paused')
    expect(host.querySelector('[data-tray-sheet="goal"]')).not.toBeNull()

    const blocked = context({ activeThreadGoal: goal({ status: 'blocked' }) })
    await render(blocked)
    expect(action('resume').textContent).toBe('Resume')
    await act(async () => action('resume').click())
    expect(blocked.setActiveThreadGoalStatus).toHaveBeenCalledWith('active')
  })

  it('clears the goal and closes the sheet', async () => {
    const ctx = context()
    await render(ctx)
    await openSheet()
    await act(async () => action('clear').click())
    expect(ctx.clearActiveThreadGoal).toHaveBeenCalledTimes(1)
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()
  })

  it('collapses from the header chevron', async () => {
    await render(context())
    await openSheet()
    await act(async () => host.querySelector<HTMLButtonElement>('[data-tray-sheet] button[aria-label="Collapse"]')!.click())
    expect(host.querySelector('[data-tray-sheet]')).toBeNull()
  })

  it('uses the zh copy', async () => {
    await i18n.loadLanguages('zh')
    await i18n.changeLanguage('zh')
    await render(context({ activeThreadGoal: goal({ status: 'paused' }) }))
    expect(segment()!.textContent).toBe('目标已暂停')
    expect(segment()!.getAttribute('aria-label')).toContain('目标（已暂停）：')
    await openSheet()
    expect(action('edit').textContent).toBe('编辑')
    expect(action('resume').textContent).toBe('继续')
    expect(host.querySelector('[data-goal-meter]')!.textContent).toBe('已进行18 分钟tokens142k')
  })
})

describe('clipGoalObjective', () => {
  it('flattens whitespace and clips long objectives', () => {
    expect(clipGoalObjective('  ship\n\nthe   thing ')).toBe('ship the thing')
    const clipped = clipGoalObjective('x'.repeat(400))
    expect(Array.from(clipped)).toHaveLength(160)
    expect(clipped.endsWith('…')).toBe(true)
  })
})
