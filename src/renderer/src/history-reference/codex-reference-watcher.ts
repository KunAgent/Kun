import type { AppSettingsV1 } from '@shared/app-settings'
import { getKunRuntimeSettings } from '@shared/app-settings-kun-defaults'
import { getProvider } from '../agent/registry'
import { rendererRuntimeClient } from '../agent/runtime-client'
import { useChatStore } from '../store/chat-store'
import { clearThreadSnapshotCache } from '../store/thread-snapshot-cache'
import { threadActionSharedState } from '../store/chat-store-thread-actions-support'
import { useThreadTurnTarget } from '../components/chat/thread-turn-target'
import { SETTINGS_CHANGED_EVENT } from '../lib/keyboard-shortcut-settings'
import { isSourceHistoryTurn } from './history-reference-api'
import { useCodexReferenceState } from './codex-reference-state'

export function codexReferenceEnabled(settings: AppSettingsV1): boolean {
  return getKunRuntimeSettings(settings).lab.codexReferenceBranches?.enabled === true
}

let watching = false
let refreshController: AbortController | undefined

/** Refresh only the history projection: never reselect, reset live state or SSE. */
export async function applyCodexReferenceSettings(settings: AppSettingsV1): Promise<void> {
  const enabled = codexReferenceEnabled(settings)
  const claudeEnabled = getKunRuntimeSettings(settings).lab.claudeCodeReferenceBranches?.enabled === true
  const opencodeEnabled = getKunRuntimeSettings(settings).lab.opencodeReferenceBranches?.enabled === true
  const previous = useCodexReferenceState.getState()
  if (previous.enabled === enabled && previous.claudeEnabled === claudeEnabled && previous.opencodeEnabled === opencodeEnabled) return
  const revision = previous.revision + 1
  useCodexReferenceState.setState({ enabled, claudeEnabled, opencodeEnabled, revision })
  refreshController?.abort()
  clearThreadSnapshotCache()
  const target = useThreadTurnTarget.getState().target
  if (target && isSourceHistoryTurn(target)) useThreadTurnTarget.setState({ target: null })
  const state = useChatStore.getState()
  const threadId = state.activeThreadId
  const referenceId = state.threads.find((thread) => thread.id === threadId)?.historyRefId
  if (!threadId || !referenceId) {
    if (state.threadHistoryLoading) useChatStore.setState({ threadHistoryLoading: false })
    return
  }
  // A switch during refresh must not park a projection with the old mode's
  // cursor (or an empty source prefix) under the new cache generation.
  threadActionSharedState.expandedHistoryThreadIds.add(threadId)
  useChatStore.setState((current) => ({
    blocks: current.blocks.filter((block) => !isSourceHistoryTurn(block)),
    threadHistoryCursor: null,
    threadHasMoreHistory: false,
    threadHistoryLoading: false
  }))
  if (state.runtimeConnection !== 'ready' || state.threadLoadingId === threadId ||
      state.threadRefreshingId === threadId) return
  const controller = new AbortController()
  refreshController = controller
  const current = (): boolean => !controller.signal.aborted &&
    useCodexReferenceState.getState().revision === revision &&
    useChatStore.getState().activeThreadId === threadId &&
    useChatStore.getState().threads.find((thread) => thread.id === threadId)?.historyRefId === referenceId
  try {
    const detail = await getProvider().getThreadDetail(threadId, { signal: controller.signal, priority: 'foreground' })
    if (!current()) return
    useChatStore.setState((latest) => ({
      blocks: [
        ...((enabled || claudeEnabled || opencodeEnabled) ? detail.blocks.filter(isSourceHistoryTurn) : []),
        ...latest.blocks.filter((block) => !isSourceHistoryTurn(block))
      ],
      threadHistoryCursor: detail.historyCursor ?? null,
      threadHasMoreHistory: detail.hasMoreHistory === true
    }))
  } catch (error) {
    if (current()) useChatStore.setState({ error: error instanceof Error ? error.message : String(error) })
  } finally {
    if (refreshController === controller) refreshController = undefined
  }
}

/** One settings subscription for the app, regardless of mounted history rows. */
export function ensureCodexReferenceWatcher(): void {
  if (watching || typeof window === 'undefined') return
  watching = true
  let settingsRevision = 0
  const apply = (settings: AppSettingsV1): void => { void applyCodexReferenceSettings(settings) }
  void rendererRuntimeClient.getSettings().then((settings) => {
    if (settingsRevision === 0) apply(settings)
  }).catch(() => undefined)
  window.addEventListener(SETTINGS_CHANGED_EVENT, (event) => {
    const settings = (event as CustomEvent<AppSettingsV1>).detail
    if (!settings) return
    settingsRevision += 1
    apply(settings)
  })
}
