import type { ThreadRightPanelExpansionRegistry } from '../../lib/thread-right-panel-expansion'
import { threadRightPanelExpanded } from '../../lib/thread-right-panel-expansion'
import type { DevPreviewAutoOpenSignal } from '../../lib/dev-preview-detection'
import { BUILTIN_RIGHT_PANEL_IDS } from '../../extensions/contribution-ids'
import {
  closeCodeRightTab,
  collapseCodeRightTabs,
  expandCodeRightTabs,
  type CodeRightTabsState
} from './code-right-tabs-state'

export function applyThreadRightPanelExpansion(
  state: CodeRightTabsState,
  threadId: string | null,
  registry: ThreadRightPanelExpansionRegistry
): CodeRightTabsState {
  return threadRightPanelExpanded(threadId, registry)
    ? expandCodeRightTabs(state)
    : collapseCodeRightTabs(state)
}

export function transitionCodeRightTabsForThread(
  state: CodeRightTabsState,
  threadId: string | null,
  registry: ThreadRightPanelExpansionRegistry
): CodeRightTabsState {
  let next = closeCodeRightTab(state, BUILTIN_RIGHT_PANEL_IDS.browser)
  next = closeCodeRightTab(next, BUILTIN_RIGHT_PANEL_IDS.sideConversations)
  next = closeCodeRightTab(next, BUILTIN_RIGHT_PANEL_IDS.plan)
  return applyThreadRightPanelExpansion(next, threadId, registry)
}

export type PreviewAutoOpenTracker = {
  threadId: string | null
  awaitingHydration: boolean
  handledSignalKey: string | null
}

type PreviewAutoOpenInput = {
  threadId: string | null
  threadLoadingId: string | null
  signal: DevPreviewAutoOpenSignal | null
}

function previewAutoOpenSignalKey(signal: DevPreviewAutoOpenSignal | null): string | null {
  return signal ? JSON.stringify([signal.turnId, signal.url]) : null
}

function threadIsHydrating(input: PreviewAutoOpenInput): boolean {
  return Boolean(input.threadId && input.threadLoadingId === input.threadId)
}

export function createPreviewAutoOpenTracker(
  input: PreviewAutoOpenInput
): PreviewAutoOpenTracker {
  const awaitingHydration = threadIsHydrating(input)
  return {
    threadId: input.threadId,
    awaitingHydration,
    handledSignalKey: awaitingHydration ? null : previewAutoOpenSignalKey(input.signal)
  }
}

export function advancePreviewAutoOpenTracker(
  current: PreviewAutoOpenTracker,
  input: PreviewAutoOpenInput
): { tracker: PreviewAutoOpenTracker; shouldOpen: boolean } {
  if (current.threadId !== input.threadId) {
    return { tracker: createPreviewAutoOpenTracker(input), shouldOpen: false }
  }

  if (threadIsHydrating(input)) {
    return {
      tracker: { ...current, awaitingHydration: true },
      shouldOpen: false
    }
  }

  if (current.awaitingHydration) {
    return {
      tracker: {
        threadId: input.threadId,
        awaitingHydration: false,
        handledSignalKey: previewAutoOpenSignalKey(input.signal)
      },
      shouldOpen: false
    }
  }

  const signalKey = previewAutoOpenSignalKey(input.signal)
  if (!signalKey || signalKey === current.handledSignalKey) {
    return { tracker: current, shouldOpen: false }
  }
  return {
    tracker: { ...current, handledSignalKey: signalKey },
    shouldOpen: true
  }
}
