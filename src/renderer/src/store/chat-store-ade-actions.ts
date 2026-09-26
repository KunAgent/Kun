import type { ChatState, ChatStoreGet, ChatStoreSet } from './chat-store-types'
import { getProvider } from '../agent/registry'
import { normalizeWorkspaceRoot } from '../lib/workspace-path'

type StoreActionContext = {
  set: ChatStoreSet
  get: ChatStoreGet
}

// ADE 线程清单与 Code 完全隔离:独立分页/刷新,避免侧栏互相污染。
export function createAdeActions(
  context: StoreActionContext
): Pick<ChatState, 'refreshAdeThreads'> {
  const { set, get } = context
  let inFlight = false
  let queued = false

  return {
    refreshAdeThreads: async () => {
      if (get().runtimeConnection !== 'ready') return
      if (inFlight) {
        queued = true
        return
      }
      inFlight = true
      try {
        const provider = getProvider()
        const fetched = await provider.listThreads({
          workspaceMode: 'ade',
          includeArchived: true,
          includeSide: true
        })
        const normalized = fetched
          .filter((thread) => thread.relation !== 'side')
          .map((thread) => ({ ...thread, workspace: normalizeWorkspaceRoot(thread.workspace) }))
        // 新建线程可能尚未出现在列表响应中,保留当前激活线程避免闪烁。
        const state = get()
        const activeId = state.activeThreadId
        const activeThread = activeId
          ? normalized.find((thread) => thread.id === activeId) ??
            (state.adeThreads ?? []).find((thread) => thread.id === activeId && thread.archived !== true) ??
            null
          : null
        const merged = activeThread && !normalized.some((thread) => thread.id === activeThread.id)
          ? [activeThread, ...normalized]
          : normalized
        // 记忆条目失效(归档/删除)时清空,openAde 再回退到最新 ADE 线程。
        const rememberedId = state.lastAdeThreadId?.trim()
        const memoryStale = rememberedId != null && rememberedId.length > 0 &&
          rememberedId !== state.activeThreadId &&
          !merged.some((thread) => thread.id === rememberedId && thread.archived !== true)
        set({
          adeThreads: merged,
          ...(memoryStale ? { lastAdeThreadId: null } : {})
        })
      } catch {
        // ADE 清单为辅助数据:失败时保留上一份列表。
      } finally {
        inFlight = false
        if (queued) {
          queued = false
          queueMicrotask(() => void get().refreshAdeThreads())
        }
      }
    }
  }
}
