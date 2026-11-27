import { useEffect } from 'react'
import {
  DAILY_NOTE_QUADRANT_NUMERALS, formatKunDispatchUrl, formatKunRoomUrl, formatKunThreadUrl, parseKunTaskUrl
} from '../../../../../kun/src/contracts/daily-notes-markdown'
import type {
  DailyNoteLinkSummary, DailyNoteSendItem, DailyNoteSendRequest, DailyNoteSendResult,
  DailyNoteStartThreadRequest, DailyNoteStartThreadResult, DailyNoteTargetsSnapshot
} from '@shared/daily-notes'
import type { WorkbenchLinkEntry } from '@shared/rooms-api'
import {
  openDockedDailyNotes,
  publishDockedDailyNoteSummaries,
  registerDailyNotesInProcessHandlers
} from '../../daily-notes/dock-state'
import i18n from '../../i18n'
import { useChatStore } from '../../store/chat-store'
import { openAgentConversationRoom } from './agent-chat-navigation'
import { roomRequestId, roomsClient } from './rooms-client'
import { subscribeRoomEvents } from './useRoomEvents'
import { appendRoomDraft, resolveBotRoomId } from './workbench-bridge-actions'
import { showWorkbenchFlash } from './workbench-flash'
import { workbenchClient } from './workbench-client'
import { openWorkbenchLinkTarget, workbenchOpenTarget } from './workbench-navigation'

const tr = (key: string, options?: Record<string, unknown>): string => i18n.t(key, { ns: 'common', ...options })

type PendingHandoff = {
  url: string
  day: string
  taskText: string
  roomId: string
  messageId: string
  agentLabel: string
  createdAt: number
}

const basename = (path?: string): string => path?.split(/[\\/]/).filter(Boolean).at(-1) ?? ''

function quadrantName(quadrant: 1 | 2 | 3 | 4 | null): string {
  if (!quadrant) return ''
  return `${DAILY_NOTE_QUADRANT_NUMERALS[quadrant]} · ${tr(`dailyNotes.q${quadrant}`)}`
}

function buildKunPrompt(items: readonly DailyNoteSendItem[]): string {
  const zh = (i18n.resolvedLanguage ?? i18n.language ?? 'zh').startsWith('zh')
  if (items.length === 1) {
    const item = items[0]
    const priority = quadrantName(item.quadrant)
    const lines = zh
      ? [
          `请帮我处理这项每日待办（日期：${item.day}${priority ? `，象限：${priority}` : ''}）：`,
          `- 待办：${item.text}`,
          ...item.notes.map(note => `  ${note}`),
          `如需派发到 Code 或 Work 会话，请在调用 create_code_task / create_work_task 时附带 dailyNote: { day: ${JSON.stringify(item.day)}, taskText: ${JSON.stringify(item.text)} }。`
        ]
      : [
          `Please help handle this daily to-do (date: ${item.day}${priority ? `, quadrant: ${priority}` : ''}):`,
          `- To-do: ${item.text}`,
          ...item.notes.map(note => `  ${note}`),
          `When dispatching with create_code_task or create_work_task, include dailyNote: { day: ${JSON.stringify(item.day)}, taskText: ${JSON.stringify(item.text)} }.`
        ]
    return lines.join('\n')
  }

  const header = zh
    ? '请帮我统筹安排以下每日待办，识别各自对应的项目或文档空间并派发执行：'
    : 'Please review and dispatch the following daily to-dos to the appropriate projects or workspaces:'
  const body = items.map((item, index) => {
    const priority = quadrantName(item.quadrant)
    const tag = [item.day, priority].filter(Boolean).join(' · ')
    const sub = item.notes.length ? '\n' + item.notes.map(n => `   ${n}`).join('\n') : ''
    return `${index + 1}. [${tag}] ${item.text}${sub}`
  }).join('\n')
  const footer = zh
    ? '派发每项任务调用 create_code_task / create_work_task 时，请对应传入 dailyNote: { day, taskText } 以便回流状态。'
    : 'Include dailyNote: { day, taskText } on each create_code_task / create_work_task call so the note tracks status.'
  return `${header}\n${body}\n${footer}`
}

function summarizeWorkbenchLink(url: string, link: WorkbenchLinkEntry): DailyNoteLinkSummary {
  const project = basename(link.request.workspaceRoot)
  const suffix = project ? ` · ${project}` : ''
  switch (link.status) {
    case 'awaiting_confirmation':
    case 'scheduled':
      return { url, tone: 'pending', statusText: tr('dailyNotes.statusPendingConfirm'), detail: link.request.title }
    case 'queued':
    case 'running':
    case 'active':
      return { url, tone: 'running', statusText: tr('dailyNotes.statusRunning') + suffix, detail: link.activity?.action || link.request.title }
    case 'needs_attention':
    case 'recovery_required':
      return { url, tone: 'attention', statusText: tr('dailyNotes.statusNeedsAttention'), detail: link.attention?.summary || link.error }
    case 'plan_ready':
      return { url, tone: 'attention', statusText: tr('dailyNotes.statusPlanReady') + suffix, detail: link.request.title }
    case 'completed':
      return { url, tone: 'completed', statusText: tr('dailyNotes.statusCompleted'), detail: link.result?.summary || link.request.title, canMarkDone: true }
    case 'failed':
    case 'missed':
      return { url, tone: 'failed', statusText: tr('dailyNotes.statusFailed'), detail: link.error || link.request.title }
    default:
      return { url, tone: 'idle', statusText: tr('dailyNotes.statusStopped'), detail: link.request.title }
  }
}

export async function addThreadToDailyNotes(thread: { id: string; title: string }): Promise<void> {
  const bridge = window.kunGui?.dailyNotes
  if (!bridge) return
  try {
    await bridge.appendTask({
      text: thread.title.trim() || tr('dailyNotes.task'),
      linkLabel: tr('dailyNotes.threadBadge'),
      linkUrl: formatKunThreadUrl(thread.id)
    })
    showWorkbenchFlash(tr('dailyNotes.addedFromThread'))
  } catch (cause) {
    showWorkbenchFlash(cause instanceof Error ? cause.message : String(cause), 'error')
  }
}

export function useDailyNotesWorkbenchSync(enabled = true): void {
  useEffect(() => {
    const bridge = enabled ? window.kunGui?.dailyNotes : undefined
    if (!bridge) return

    const windowUrls = new Set<string>()
    const dockedUrls = new Set<string>()
    const allWatchedUrls = (): Set<string> => new Set([...windowUrls, ...dockedUrls])
    const linkCache = new Map<string, WorkbenchLinkEntry>()
    const activeRoomRuns = new Set<string>()
    const pendingHandoffs = new Map<string, PendingHandoff[]>()

    const summarizeUrl = async (url: string): Promise<DailyNoteLinkSummary | null> => {
      const parsed = parseKunTaskUrl('', url)
      if (!parsed) return null
      if (parsed.kind === 'dispatch') {
        const key = formatKunDispatchUrl(parsed.roomId, parsed.linkId)
        let link = linkCache.get(key)
        if (!link) {
          link = await workbenchClient.get(parsed.roomId, parsed.linkId).catch(() => undefined)
          if (link) linkCache.set(key, link)
        }
        return link
          ? summarizeWorkbenchLink(url, link)
          : { url, tone: 'idle', statusText: tr('dailyNotes.kunBadge') }
      }
      if (parsed.kind === 'room') {
        const thinking = activeRoomRuns.has(parsed.roomId)
        return {
          url,
          tone: thinking ? 'running' : 'idle',
          statusText: thinking ? tr('dailyNotes.statusThinking') : tr('dailyNotes.sentToKun')
        }
      }
      const thread = useChatStore.getState().threads.find(item => item.id === parsed.threadId)
      if (!thread) return { url, tone: 'idle', statusText: tr('dailyNotes.threadBadge') }
      const running = thread.status === 'running' || thread.latestTurnStatus === 'running'
      return {
        url,
        tone: running ? 'running' : thread.status === 'error' ? 'failed' : 'idle',
        statusText: running ? tr('dailyNotes.statusRunning') : (thread.title.slice(0, 18) || tr('dailyNotes.threadBadge')),
        detail: thread.title
      }
    }

    const computeSummaries = async (urls: Iterable<string>): Promise<Record<string, DailyNoteLinkSummary>> => {
      const entries = await Promise.all([...urls].map(async url => [url, await summarizeUrl(url)] as const))
      const out: Record<string, DailyNoteLinkSummary> = {}
      for (const [url, summary] of entries) {
        if (summary) out[url] = summary
      }
      return out
    }

    const pushWatchedSummaries = async (): Promise<void> => {
      const combined = allWatchedUrls()
      if (combined.size === 0) return
      const summaries = await computeSummaries(combined)
      bridge.publishLinkSummaries(summaries)
      publishDockedDailyNoteSummaries(summaries)
    }

    const handleListTargets = async (): Promise<DailyNoteTargetsSnapshot> => {
      const state = useChatStore.getState()
      const projectSet = new Set<string>()
      const projects: DailyNoteTargetsSnapshot['projects'] = []
      for (const root of [state.workspaceRoot, ...state.codeWorkspaceRoots]) {
        const trimmed = root?.trim()
        if (!trimmed || projectSet.has(trimmed)) continue
        projectSet.add(trimmed)
        projects.push({ root: trimmed, label: basename(trimmed) || trimmed })
      }
      const threads = state.threads
        .filter(item => !item.archived)
        .slice(0, 30)
        .map(item => ({
          id: item.id,
          title: item.title?.trim() || tr('dailyNotes.threadBadge'),
          workspaceRoot: item.workspace ?? '',
          workspaceLabel: basename(item.workspace),
          status: (item.status === 'running' || item.latestTurnStatus === 'running')
            ? 'running' as const
            : item.status === 'error'
              ? 'error' as const
              : 'idle' as const
        }))
      return {
        activeWorkspaceRoot: state.workspaceRoot?.trim() ?? '',
        projects,
        threads
      }
    }

    const handleStartThread = async (request: DailyNoteStartThreadRequest): Promise<DailyNoteStartThreadResult> => {
      try {
        const prompt = request.prompt?.trim() ?? ''
        if (!prompt) return { ok: false, error: tr('dailyNotes.sendFailed') }
        const state = useChatStore.getState()
        state.setRoute('chat')
        const root = request.workspaceRoot?.trim() || null
        const threadId = await state.createThread(root
          ? { workspaceRoot: root, forceNew: true, agentSurface: 'code' }
          : { conversation: true, forceNew: true })
        if (!threadId) return { ok: false, error: tr('dailyNotes.sendFailed') }
        const sent = await useChatStore.getState().sendMessage(prompt, 'agent', {
          expectedThreadId: threadId,
          ...(root ? { agentSurface: 'code' as const } : {})
        })
        if (!sent) {
          return { ok: false, error: useChatStore.getState().error || tr('dailyNotes.sendFailed') }
        }
        const label = root ? (basename(root) || tr('dailyNotes.threadBadge')) : tr('dailyNotes.threadBadge')
        return { ok: true, threadId, title: label }
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
      }
    }

    const handleSendToKun = async (request: DailyNoteSendRequest): Promise<DailyNoteSendResult> => {
      try {
        const roomId = await resolveBotRoomId()
        if (!roomId) return { ok: false, error: tr('dailyNotes.sendFailed') }
        const roomInfo = await roomsClient.get(roomId).catch(() => null)
        const defaultMember = roomInfo?.room.members.find(m => m.id === roomInfo.room.defaultMemberId)
        const agentLabel = defaultMember?.displayName?.trim() || tr('dailyNotes.kunBadge')
        const body = buildKunPrompt(request.items)

        if (request.mode === 'draft') {
          appendRoomDraft(roomId, { body })
          openAgentConversationRoom(roomId)
          return { ok: true, roomId, agentLabel }
        }

        const sent = await roomsClient.send(roomId, {
          clientRequestId: roomRequestId(),
          body,
          executionIntent: 'auto',
          mentionMemberIds: [],
          attachmentIds: []
        })
        const messageId = sent.message.id
        activeRoomRuns.add(roomId)
        const url = formatKunRoomUrl(roomId, messageId)
        const now = Date.now()
        const list = (pendingHandoffs.get(roomId) ?? []).filter(item => now - item.createdAt < 10 * 60_000)
        for (const item of request.items) {
          list.push({ url, day: item.day, taskText: item.text, roomId, messageId, agentLabel, createdAt: now })
        }
        pendingHandoffs.set(roomId, list)
        openAgentConversationRoom(roomId, { messageId })
        void pushWatchedSummaries()
        return { ok: true, roomId, messageId, agentLabel }
      } catch (cause) {
        return { ok: false, error: cause instanceof Error ? cause.message : String(cause) }
      }
    }

    const handleOpenLink = async (url: string): Promise<boolean> => {
      const parsed = parseKunTaskUrl('', url)
      if (!parsed) return false
      if (parsed.kind === 'dispatch') {
        const link = await workbenchClient.get(parsed.roomId, parsed.linkId).catch(() => undefined)
        if (link) {
          linkCache.set(formatKunDispatchUrl(parsed.roomId, parsed.linkId), link)
          const liveExecution = ['queued', 'running', 'needs_attention', 'recovery_required', 'plan_ready'].includes(link.status)
          if (liveExecution && workbenchOpenTarget(link)) {
            await openWorkbenchLinkTarget(link)
            return true
          }
          openAgentConversationRoom(parsed.roomId, link.messageId ? { messageId: link.messageId } : undefined)
          return true
        }
        openAgentConversationRoom(parsed.roomId)
        return true
      }
      if (parsed.kind === 'room') {
        openAgentConversationRoom(parsed.roomId, parsed.messageId ? { messageId: parsed.messageId } : undefined)
        return true
      }
      await useChatStore.getState().selectThread(parsed.threadId)
      useChatStore.getState().setRoute('chat')
      return true
    }

    const offInProcess = registerDailyNotesInProcessHandlers({
      sendToKun: handleSendToKun,
      startThread: handleStartThread,
      listTargets: handleListTargets,
      openLink: handleOpenLink,
      watchLinks: async urls => {
        dockedUrls.clear()
        for (const url of urls) dockedUrls.add(url)
        return computeSummaries(dockedUrls)
      }
    })

    const offCommand = bridge.onCommand((command, reply) => {
      if (command.kind === 'send-to-kun') {
        void handleSendToKun(command.request).then(reply)
      } else if (command.kind === 'start-thread') {
        void handleStartThread(command.request).then(reply)
      } else if (command.kind === 'list-targets') {
        void handleListTargets().then(reply, () => reply({ activeWorkspaceRoot: '', projects: [], threads: [] }))
      } else if (command.kind === 'dock-in-workbench') {
        openDockedDailyNotes(command.payload)
        reply(true)
      } else if (command.kind === 'open-link') {
        void handleOpenLink(command.url).then(reply, () => reply(false))
      } else if (command.kind === 'watch-links') {
        windowUrls.clear()
        for (const url of command.urls) windowUrls.add(url)
        void computeSummaries(windowUrls).then(reply, () => reply({}))
      }
    })

    const offRoomEvents = subscribeRoomEvents(event => {
      if (event.kind === 'run.started' || event.kind === 'request.created') {
        activeRoomRuns.add(event.roomId)
        void pushWatchedSummaries()
        return
      }
      if (event.kind === 'run.finished' || event.kind === 'request.settled' || event.kind === 'message.created') {
        if (event.kind !== 'message.created') activeRoomRuns.delete(event.roomId)
        void pushWatchedSummaries()
        return
      }
      if (event.kind === 'workbench.link.updated') {
        const linkId = (event.payload as { linkId?: string } | undefined)?.linkId
        if (!linkId) return
        void workbenchClient.get(event.roomId, linkId).then(async link => {
          linkCache.set(formatKunDispatchUrl(event.roomId, link.id), link)
          const dailyNote = link.request.dailyNote
          const candidates = pendingHandoffs.get(event.roomId) ?? []
          const matched = dailyNote
            ? candidates.find(item => item.day === dailyNote.day && item.taskText === dailyNote.taskText)
            : candidates.length === 1 && Date.now() - candidates[0].createdAt < 3 * 60_000
              ? candidates[0]
              : candidates.find(item => item.taskText.toLowerCase() === link.request.title.trim().toLowerCase())
          if (dailyNote || matched) {
            await bridge.bindDispatchLink({
              day: dailyNote?.day ?? matched!.day,
              taskText: dailyNote?.taskText ?? matched?.taskText,
              previousUrl: matched?.url,
              roomId: event.roomId,
              linkId: link.id,
              label: matched?.agentLabel
            }).catch(() => false)
          }
          await pushWatchedSummaries()
        }).catch(() => undefined)
      }
    })

    let lastThreadSig = ''
    const offChat = useChatStore.subscribe(state => {
      const combined = allWatchedUrls()
      if (combined.size === 0) return
      const threadIds = [...combined]
        .map(url => parseKunTaskUrl('', url))
        .filter((item): item is Extract<ReturnType<typeof parseKunTaskUrl>, { kind: 'thread' }> => item?.kind === 'thread')
        .map(item => item.threadId)
      if (threadIds.length === 0) return
      const sig = threadIds.map(id => {
        const t = state.threads.find(item => item.id === id)
        return t ? `${t.id}:${t.status ?? ''}:${t.latestTurnStatus ?? ''}:${t.title}` : id
      }).join('|')
      if (sig !== lastThreadSig) {
        lastThreadSig = sig
        void pushWatchedSummaries()
      }
    })

    return () => {
      offInProcess()
      offCommand()
      offRoomEvents()
      offChat()
    }
  }, [enabled])
}
