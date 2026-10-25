// @vitest-environment jsdom
import { act, createElement, createRef } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import i18n from '../../i18n'
import type { ThreadGoal } from '../../agent/types'
import type { FloatingComposerRenderContext } from './floating-composer-view-context'
import { FloatingComposerGoalPanel } from './FloatingComposerGoalPanel'

type ActGlobal = typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }

const goal: ThreadGoal = {
  threadId: 'thr_1',
  objective: 'Ship the composer dock',
  status: 'active',
  tokenBudget: null,
  tokensUsed: 0,
  timeUsedSeconds: 0,
  createdAt: '2026-10-24T08:00:00.000Z',
  updatedAt: '2026-10-24T08:00:00.000Z'
}

function context(overrides: Record<string, unknown> = {}): FloatingComposerRenderContext {
  return {
    activeThreadGoal: goal,
    canSetGoalPanelDraft: false,
    clearActiveThreadGoal: vi.fn(async () => undefined),
    goalPanelOpen: true,
    goalPanelRef: createRef<HTMLDivElement>(),
    pendingUserInputBlock: null,
    setActiveThreadGoalStatus: vi.fn(async () => undefined),
    setGoalFromComposerInput: vi.fn(),
    setGoalPanelOpen: vi.fn(),
    showGoalMenuOption: true,
    slashQuery: null,
    t: i18n.getFixedT('en', 'common'),
    ...overrides
  }
}

describe('FloatingComposerGoalPanel', () => {
  let host: HTMLDivElement
  let root: Root

  beforeEach(async () => {
    ;(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    ;(globalThis as ActGlobal).IS_REACT_ACT_ENVIRONMENT = false
  })

  const render = async (ctx: FloatingComposerRenderContext): Promise<void> => {
    await act(async () => root.render(createElement(FloatingComposerGoalPanel, { context: ctx })))
  }
  const panel = (): HTMLElement | null => host.querySelector('[data-goal-panel]')
  const action = (name: string): HTMLButtonElement | null => host.querySelector(`[data-goal-action="${name}"]`)

  it.each([
    ['closed', { goalPanelOpen: false }],
    ['a slash query', { slashQuery: '/go' }],
    ['a pending ask-user request', { pendingUserInputBlock: { id: 'ui_1' } }],
    ['an approval card holds the input slot', { composerInterrupt: { kind: 'approval', approvals: [] } }],
    ['no goal entry on this route', { showGoalMenuOption: false }]
  ])('renders nothing when %s', async (_name, overrides) => {
    await render(context(overrides))
    expect(panel()).toBeNull()
  })

  it('uses the tray look: 16px radius, neutral card, no 26px radius', async () => {
    const ctx = context()
    await render(ctx)
    const root = panel()!
    expect(ctx.goalPanelRef.current).toBe(root)
    expect(root.className).toContain('rounded-[16px]')
    expect(root.className).toContain('ds-card-strong')
    expect(root.className).not.toContain('rounded-[26px]')
    expect(root.getAttribute('aria-label')).toBe('Goal')
  })

  it('shows the empty state with a hint and no actions', async () => {
    await render(context({ activeThreadGoal: null }))
    expect(panel()!.textContent).toContain('No active goal')
    expect(panel()!.textContent).toContain('Type a goal in the composer below')
    expect(host.querySelector('[data-goal-action]')).toBeNull()
  })

  it('sets the draft as the goal', async () => {
    const ctx = context({ activeThreadGoal: null, canSetGoalPanelDraft: true })
    await render(ctx)
    expect(action('set')!.textContent).toBe('Set as goal')
    expect(panel()!.textContent).not.toContain('Type a goal in the composer below')
    await act(async () => action('set')!.click())
    expect(ctx.setGoalFromComposerInput).toHaveBeenCalledTimes(1)
  })

  it('pauses, resumes and clears with text buttons, closing the panel first', async () => {
    const active = context()
    await render(active)
    expect(panel()!.textContent).toContain('Ship the composer dock')
    expect(panel()!.textContent).toContain('Type a new goal in the composer below')
    expect(action('pause')!.textContent).toBe('Pause')
    await act(async () => action('pause')!.click())
    expect(active.setGoalPanelOpen).toHaveBeenCalledWith(false)
    expect(active.setActiveThreadGoalStatus).toHaveBeenCalledWith('paused')

    const paused = context({ activeThreadGoal: { ...goal, status: 'paused' } })
    await render(paused)
    expect(panel()!.textContent).toContain('Paused')
    await act(async () => action('resume')!.click())
    expect(paused.setActiveThreadGoalStatus).toHaveBeenCalledWith('active')

    const clearing = context()
    await render(clearing)
    expect(action('clear')!.textContent).toBe('Clear')
    await act(async () => action('clear')!.click())
    expect(clearing.setGoalPanelOpen).toHaveBeenCalledWith(false)
    expect(clearing.clearActiveThreadGoal).toHaveBeenCalledTimes(1)
  })

  it('closes itself when an interrupt card takes the input slot', async () => {
    const ctx = context()
    await render(ctx)
    expect(panel()).not.toBeNull()
    expect(ctx.setGoalPanelOpen).not.toHaveBeenCalled()
    await render({ ...ctx, composerInterrupt: { kind: 'user-input', controller: {} } })
    expect(panel()).toBeNull()
    expect(ctx.setGoalPanelOpen).toHaveBeenCalledWith(false)
  })

  it('closes from the close button', async () => {
    const ctx = context()
    await render(ctx)
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="Close"]')!.click())
    expect(ctx.setGoalPanelOpen).toHaveBeenCalledWith(false)
  })
})
