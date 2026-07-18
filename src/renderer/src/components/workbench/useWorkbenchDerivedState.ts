import { useEffect, useMemo } from 'react'
import type { ChatBlock } from '../../agent/types'
import type { ChatState } from '../../store/chat-store-types'
import { isCodeSidebarThread } from '../../store/chat-store-runtime'
import {
  extractLatestTurnAutoOpenDevPreviewUrls,
  extractLatestTurnDevPreviewUrls
} from '../../lib/dev-preview-detection'
import { collectComposerChangeSummary } from '../../lib/composer-change-summary'
import { resolveCodeCanvasWorkspaceRoot } from '../../design/canvas/code-canvas'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { readDesignThreadRegistry } from '../../design/design-thread-registry'

type WorkbenchDerivedStateOptions = Pick<
  ChatState,
  | 'activeClawChannelId'
  | 'activeThreadId'
  | 'blocks'
  | 'clawChannels'
  | 'liveAssistant'
  | 'liveReasoning'
  | 'sideConversations'
  | 'threads'
  | 'workspaceRoot'
>

export function useWorkbenchDerivedState({
  activeClawChannelId,
  activeThreadId,
  blocks,
  clawChannels,
  liveAssistant,
  liveReasoning,
  sideConversations,
  threads,
  workspaceRoot
}: WorkbenchDerivedStateOptions) {
  const timelineBlocks = blocks
  const timelineLiveReasoning = liveReasoning
  const timelineLiveAssistant = liveAssistant
  const devPreviewBlocks = useMemo<ChatBlock[]>(() => {
    const liveText = timelineLiveAssistant.trim()
    if (!liveText) return timelineBlocks
    return [
      ...timelineBlocks,
      {
        kind: 'assistant',
        id: '__live-assistant-dev-preview',
        text: timelineLiveAssistant
      }
    ]
  }, [timelineBlocks, timelineLiveAssistant])
  const detectedDevPreviewUrls = useMemo(
    () => extractLatestTurnDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const autoOpenDevPreviewUrls = useMemo(
    () => extractLatestTurnAutoOpenDevPreviewUrls(devPreviewBlocks),
    [devPreviewBlocks]
  )
  const latestDevPreviewUrl = detectedDevPreviewUrls[0] ?? null
  const latestAutoOpenDevPreviewUrl = autoOpenDevPreviewUrls[0] ?? null
  const activeClawChannel = useMemo(
    () => clawChannels.find((channel) => channel.id === activeClawChannelId) ?? null,
    [activeClawChannelId, clawChannels]
  )
  const activeSkillWorkspace = useMemo(
    () => threads.find((thread) => thread.id === activeThreadId)?.workspace || workspaceRoot || '',
    [activeThreadId, threads, workspaceRoot]
  )
  const activeCodeCanvasWorkspace = useMemo(
    () =>
      resolveCodeCanvasWorkspaceRoot(
        threads.find((thread) => thread.id === activeThreadId)?.workspace,
        workspaceRoot
      ),
    [activeThreadId, threads, workspaceRoot]
  )
  const composerChangeSummary = useMemo(
    () => collectComposerChangeSummary(timelineBlocks, activeSkillWorkspace),
    [activeSkillWorkspace, timelineBlocks]
  )
  const currentSideConversations = useMemo(
    () =>
      Object.values(sideConversations)
        .filter((side) => side.parentThreadId === activeThreadId)
        .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    [activeThreadId, sideConversations]
  )
  const currentSideRunningCount = currentSideConversations.reduce(
    (count, side) => count + (side.busy ? 1 : 0),
    0
  )
  const codeThreads = useMemo(() => {
    const designRegistry = readDesignThreadRegistry()
    return threads.filter((thread) =>
      isCodeSidebarThread(thread, clawChannels, undefined, designRegistry)
    )
  }, [clawChannels, threads])

  useEffect(() => {
    useDesignWorkspaceStore.getState().setDevPreviewUrl(latestDevPreviewUrl ?? '')
  }, [latestDevPreviewUrl])

  return {
    activeClawChannel,
    activeCodeCanvasWorkspace,
    activeSkillWorkspace,
    codeThreads,
    composerChangeSummary,
    currentSideConversations,
    currentSideRunningCount,
    devPreviewBlocks,
    latestAutoOpenDevPreviewUrl,
    latestDevPreviewUrl,
    timelineBlocks,
    timelineLiveAssistant,
    timelineLiveReasoning
  }
}
