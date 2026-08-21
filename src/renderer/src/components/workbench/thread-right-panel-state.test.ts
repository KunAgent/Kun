import { describe, expect, it } from 'vitest'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  emptyThreadRightPanelExpansionRegistry,
  rememberThreadRightPanelExpansion
} from '../../lib/thread-right-panel-expansion'
import {
  emptyCodeRightTabsState,
  openCodeRightTab
} from './code-right-tabs-state'
import {
  advancePreviewAutoOpenTracker,
  applyThreadRightPanelExpansion,
  createPreviewAutoOpenTracker,
  transitionCodeRightTabsForThread
} from './thread-right-panel-state'

describe('thread right-panel state', () => {
  it('restores independent expansion preferences while retaining workspace tabs', () => {
    let registry = rememberThreadRightPanelExpansion(
      'thread-a',
      false,
      emptyThreadRightPanelExpansionRegistry()
    )
    registry = rememberThreadRightPanelExpansion('thread-b', true, registry)
    const tabs = openCodeRightTab(
      openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.files),
      BUILTIN_RIGHT_PANEL_IDS.changes
    )

    const threadA = applyThreadRightPanelExpansion(tabs, 'thread-a', registry)
    const threadB = applyThreadRightPanelExpansion(threadA, 'thread-b', registry)
    const threadAAgain = applyThreadRightPanelExpansion(threadB, 'thread-a', registry)

    expect(threadA.expanded).toBe(false)
    expect(threadB.expanded).toBe(true)
    expect(threadAAgain.expanded).toBe(false)
    expect(threadAAgain.tabs).toEqual(tabs.tabs)
    expect(threadAAgain.activeId).toBe(tabs.activeId)
  })

  it('defaults an unseen or null thread to collapsed', () => {
    const open = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.files)
    const registry = emptyThreadRightPanelExpansionRegistry()

    expect(applyThreadRightPanelExpansion(open, 'thread-new', registry).expanded).toBe(false)
    expect(applyThreadRightPanelExpansion(open, null, registry).expanded).toBe(false)
  })

  it('closes thread-specific tabs before restoring the destination preference', () => {
    let tabs = openCodeRightTab(emptyCodeRightTabsState(), BUILTIN_RIGHT_PANEL_IDS.files)
    tabs = openCodeRightTab(tabs, BUILTIN_RIGHT_PANEL_IDS.browser)
    tabs = openCodeRightTab(tabs, BUILTIN_RIGHT_PANEL_IDS.plan)
    tabs = openCodeRightTab(tabs, BUILTIN_RIGHT_PANEL_IDS.sideConversations)
    const registry = rememberThreadRightPanelExpansion(
      'thread-b',
      true,
      emptyThreadRightPanelExpansionRegistry()
    )

    const next = transitionCodeRightTabsForThread(tabs, 'thread-b', registry)

    expect(next.tabs).toEqual([BUILTIN_RIGHT_PANEL_IDS.files])
    expect(next.activeId).toBe(BUILTIN_RIGHT_PANEL_IDS.files)
    expect(next.expanded).toBe(true)
  })

  it('supports a remembered expanded destination with no remaining tabs', () => {
    const browserOnly = openCodeRightTab(
      emptyCodeRightTabsState(),
      BUILTIN_RIGHT_PANEL_IDS.browser
    )
    const registry = rememberThreadRightPanelExpansion(
      'thread-b',
      true,
      emptyThreadRightPanelExpansionRegistry()
    )

    expect(transitionCodeRightTabsForThread(browserOnly, 'thread-b', registry)).toEqual({
      version: 1,
      tabs: [],
      activeId: null,
      expanded: true
    })
  })
})

describe('preview auto-open tracker', () => {
  const signal = (turnId: string, url = 'http://localhost:5173/') => ({ turnId, url })

  it('uses a cached thread signal as a handled navigation baseline', () => {
    const tracker = createPreviewAutoOpenTracker({
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-old')
    })

    expect(advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-old')
    }).shouldOpen).toBe(false)
  })

  it('waits for async hydration and treats the loaded signal as historical', () => {
    let tracker = createPreviewAutoOpenTracker({
      threadId: 'thread-a',
      threadLoadingId: 'thread-a',
      signal: null
    })
    let transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: 'thread-a',
      signal: null
    })
    expect(transition.shouldOpen).toBe(false)

    tracker = transition.tracker
    transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-historical')
    })
    expect(transition.shouldOpen).toBe(false)
    expect(transition.tracker.awaitingHydration).toBe(false)
  })

  it('opens a new active-thread signal once and leaves it handled after collapse', () => {
    let tracker = createPreviewAutoOpenTracker({
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: null
    })
    let transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-new')
    })
    expect(transition.shouldOpen).toBe(true)

    tracker = transition.tracker
    transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-new')
    })
    expect(transition.shouldOpen).toBe(false)
  })

  it('opens the same URL again when a later user turn reports it', () => {
    let tracker = createPreviewAutoOpenTracker({
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-one')
    })
    const transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-two')
    })

    expect(transition.shouldOpen).toBe(true)
  })

  it('baselines historical signals on thread switches and same-thread refreshes', () => {
    let tracker = createPreviewAutoOpenTracker({
      threadId: 'thread-a',
      threadLoadingId: null,
      signal: signal('turn-a')
    })
    let transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-b',
      threadLoadingId: null,
      signal: signal('turn-b')
    })
    expect(transition.shouldOpen).toBe(false)

    tracker = transition.tracker
    transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-b',
      threadLoadingId: 'thread-b',
      signal: null
    })
    expect(transition.tracker.awaitingHydration).toBe(true)

    tracker = transition.tracker
    transition = advancePreviewAutoOpenTracker(tracker, {
      threadId: 'thread-b',
      threadLoadingId: null,
      signal: signal('turn-b-refreshed')
    })
    expect(transition.shouldOpen).toBe(false)
  })
})
