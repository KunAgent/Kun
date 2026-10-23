// @vitest-environment jsdom
import { act, createElement, type ReactElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest'
import i18n from '../../../i18n'
import { useGraphStore } from '../../../graph/graph-store'
import type { FloatingComposerRenderContext } from '../floating-composer-view-context'
import { ComposerActivityTray } from './ComposerActivityTray'
import { useGraphTrayKind } from './graph-tray-kind'
import {
  graphTestCorrection,
  graphTestRun,
  graphTestRunWithChild
} from './graph-tray-test-fixtures'

const originalStore = useGraphStore.getState()

function context(overrides: Record<string, unknown> = {}): FloatingComposerRenderContext {
  return {
    showGraphProgress: true,
    activeThreadId: 'thread_1',
    onOpenGraph: vi.fn(),
    onOpenGraphChild: vi.fn(),
    ...overrides
  }
}

function GraphTray({ ctx }: { ctx: FloatingComposerRenderContext }): ReactElement {
  return createElement(ComposerActivityTray, { kinds: [useGraphTrayKind(ctx)] })
}

describe('useGraphTrayKind', () => {
  let host: HTMLDivElement
  let root: Root
  let refreshThread: Mock<(threadId: string | null) => Promise<void>>

  const render = async (ctx: FloatingComposerRenderContext): Promise<void> => {
    await act(async () => root.render(createElement(GraphTray, { ctx })))
  }
  const segment = (): HTMLButtonElement | null =>
    host.querySelector<HTMLButtonElement>('[data-composer-stack-item="graph"] button')

  beforeEach(async () => {
    ;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    await i18n.changeLanguage('en')
    refreshThread = vi.fn<(threadId: string | null) => Promise<void>>().mockResolvedValue(undefined)
    useGraphStore.setState({
      threadId: 'thread_1',
      runs: [graphTestRun()],
      drafts: [],
      childRuns: {},
      selectedRunId: 'run_1',
      refreshThread
    })
    host = document.createElement('div')
    document.body.appendChild(host)
    root = createRoot(host)
  })

  afterEach(async () => {
    await act(async () => root.unmount())
    host.remove()
    vi.useRealTimers()
    useGraphStore.setState({
      runs: originalStore.runs,
      drafts: originalStore.drafts,
      childRuns: originalStore.childRuns,
      selectedRunId: originalStore.selectedRunId,
      refreshThread: originalStore.refreshThread,
      resumeDraft: originalStore.resumeDraft,
      cancelDraft: originalStore.cancelDraft
    })
  })

  it('refreshes the thread and shows the running segment with stable markers', async () => {
    await render(context())

    expect(refreshThread).toHaveBeenCalledWith('thread_1')
    const button = segment()
    expect(button?.dataset.graphProgress).toBe('1/3')
    expect(button?.dataset.graphRunning).toBe('1')
    expect(button?.dataset.tone).toBe('running')
    expect(button?.getAttribute('aria-label')).toBe('Graph run: 1 of 3 nodes accepted, 1 running')
    expect(button?.textContent).toContain('Graph · Node implement')
    expect(button?.textContent).toContain('1/3')
    expect(button?.getAttribute('aria-expanded')).toBe('false')
  })

  it('opens the node map on click and folds it when leaving for the full Graph', async () => {
    const ctx = context()
    await render(ctx)

    await act(async () => segment()?.click())
    expect(segment()?.getAttribute('aria-expanded')).toBe('true')
    const sheet = host.querySelector('[data-tray-sheet="graph"]')
    expect(sheet?.textContent).toContain('1 of 3 nodes accepted · 1 running')
    expect(sheet?.querySelectorAll('[data-graph-preview-node]')).toHaveLength(3)

    await act(async () => host.querySelector<HTMLButtonElement>('[data-graph-preview-node="review"]')?.click())
    expect(ctx.onOpenGraph).toHaveBeenCalledWith('run_1', 'review')
    expect(host.querySelector('[data-tray-sheet="graph"]')).toBeNull()

    await act(async () => segment()?.click())
    await act(async () => host.querySelector<HTMLButtonElement>('[data-graph-open-full]')?.click())
    expect(ctx.onOpenGraph).toHaveBeenLastCalledWith('run_1', undefined)
    expect(host.querySelector('[data-tray-sheet="graph"]')).toBeNull()
  })

  it('turns the segment amber once a running child goes quiet', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
    vi.setSystemTime(Date.parse('2026-07-28T00:00:12.000Z'))
    const { run, childRuns } = graphTestRunWithChild('2026-07-28T00:00:02.000Z')
    useGraphStore.setState({ runs: [run], childRuns })
    await render(context())

    expect(segment()?.dataset.tone).toBe('running')
    expect(segment()?.dataset.graphAttention).toBeUndefined()
    await act(async () => {
      vi.advanceTimersByTime(20_100)
    })
    expect(segment()?.dataset.tone).toBe('waiting')
    expect(segment()?.dataset.graphAttention).toBe('true')
    expect(segment()?.getAttribute('aria-label')).toContain('A running node has gone quiet')
    expect(segment()?.querySelector('.ds-composer-tray-segment-label')?.getAttribute('data-tone')).toBe('waiting')

    // New child activity clears the warning without waiting for a timer.
    await act(async () => {
      useGraphStore.setState({
        childRuns: {
          child_implement: { ...childRuns.child_implement!, updatedAt: new Date(Date.now()).toISOString() }
        }
      })
    })
    await act(async () => {
      vi.advanceTimersByTime(100)
    })
    expect(segment()?.dataset.tone).toBe('running')
  })

  it('tells screen readers why the segment needs the user', async () => {
    const { run, childRuns } = graphTestRunWithChild(new Date(Date.now() - 3_000).toISOString())
    const asking = {
      child_implement: {
        ...childRuns.child_implement!,
        activity: {
          phase: 'waiting' as const,
          label: 'Waiting for your answer',
          startedAt: new Date(Date.now() - 10_000).toISOString(),
          updatedAt: new Date(Date.now() - 3_000).toISOString()
        }
      }
    }
    useGraphStore.setState({ runs: [{ ...run, status: 'awaiting_human' }], childRuns: asking })
    await render(context())
    expect(segment()?.dataset.tone).toBe('waiting')
    expect(segment()?.dataset.graphAttentionReason).toBe('asking')
    expect(segment()?.getAttribute('aria-label'))
      .toBe('Graph run: 1 of 3 nodes accepted. A node is waiting for your answer')

    // The run waits for a person while every child is busy and recent.
    await act(async () => useGraphStore.setState({ childRuns }))
    expect(segment()?.dataset.graphAttentionReason).toBe('awaiting_human')
    expect(segment()?.getAttribute('aria-label'))
      .toBe('Graph run: 1 of 3 nodes accepted. The run is waiting for you')
    expect(segment()?.getAttribute('aria-label')).not.toContain('quiet')
  })

  it('moves through the node map with arrows and tabs out to that node', async () => {
    const { run, childRuns } = graphTestRunWithChild(new Date(Date.now() - 3_000).toISOString())
    useGraphStore.setState({ runs: [run], childRuns })
    await render(context())
    await act(async () => segment()?.click())
    const node = (id: string): HTMLButtonElement =>
      host.querySelector<HTMLButtonElement>(`[data-graph-preview-node="${id}"]`)!
    const tabStops = (): string[] => Array.from(host.querySelectorAll<HTMLButtonElement>('[data-graph-preview-node]'))
      .filter((button) => button.tabIndex === 0)
      .map((button) => button.dataset.graphPreviewNode ?? '')
    const press = async (key: string): Promise<void> => {
      await act(async () => {
        document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
      })
    }
    const inspected = (): string | undefined =>
      host.querySelector<HTMLElement>('[data-graph-preview-inspector]')?.dataset.graphPreviewInspector

    expect(tabStops()).toEqual(['implement'])
    await act(async () => node('implement').focus())
    await press('Home')
    expect(document.activeElement).toBe(node('audit'))
    expect(inspected()).toBe('audit')
    expect(tabStops()).toEqual(['audit'])
    expect(host.querySelector('[data-graph-view-live-work]')).toBeNull()

    await press('ArrowRight')
    expect(document.activeElement).toBe(node('implement'))
    expect(inspected()).toBe('implement')
    // The next Tab stop after the map is this node's live-work action.
    const focusable = Array.from(host.querySelectorAll<HTMLElement>('[data-tray-sheet="graph"] button'))
      .filter((button) => button.tabIndex >= 0)
    const liveWork = host.querySelector('[data-graph-view-live-work]')
    expect(focusable.indexOf(node('implement')) + 1).toBe(focusable.indexOf(liveWork as HTMLElement))

    await press('End')
    expect(document.activeElement).toBe(node('review'))
    await press('ArrowDown')
    expect(document.activeElement).toBe(node('review'))
  })

  it('shows the correction segment and its actions while planning waits for the user', async () => {
    const resumeDraft = vi.fn().mockResolvedValue(undefined)
    const cancelDraft = vi.fn().mockResolvedValue(undefined)
    useGraphStore.setState({
      runs: [],
      drafts: [graphTestCorrection()],
      selectedRunId: null,
      resumeDraft,
      cancelDraft
    })
    await render(context())

    expect(segment()?.dataset.graphPlanningCorrection).toBe('true')
    expect(segment()?.dataset.tone).toBe('waiting')
    expect(segment()?.textContent).toContain('The plan needs your guidance')
    expect(segment()?.getAttribute('title')).toBe('plan.tasks.0.title: Expected string, received undefined')

    await act(async () => segment()?.click())
    expect(host.querySelector('[data-graph-planning-correction-sheet]')?.textContent)
      .toContain('Expected string, received undefined')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-graph-planning-resume]')?.click())
    expect(resumeDraft).toHaveBeenCalledWith('draft_correction')
    await act(async () => host.querySelector<HTMLButtonElement>('[data-graph-planning-cancel]')?.click())
    expect(cancelDraft).toHaveBeenCalledWith('draft_correction')
  })

  it('occupies no tray space when only another thread has a Graph run', async () => {
    await render(context({ activeThreadId: 'thread_2' }))

    expect(refreshThread).toHaveBeenCalledWith('thread_2')
    expect(host.querySelector('[data-composer-tray]')).toBeNull()
  })

  it('stays out of the tray and does not refresh while Graph is disabled', async () => {
    await render(context({ showGraphProgress: false }))

    expect(host.querySelector('[data-composer-tray]')).toBeNull()
    expect(refreshThread).not.toHaveBeenCalled()
  })

  it('ignores a terminal run', async () => {
    useGraphStore.setState({ runs: [graphTestRun({ status: 'completed' })] })
    await render(context())

    expect(host.querySelector('[data-composer-tray]')).toBeNull()
  })
})
