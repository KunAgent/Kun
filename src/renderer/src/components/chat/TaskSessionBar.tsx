import { useTranslation } from 'react-i18next'
import { ArrowLeft, GitBranch, Split, Unlink } from 'lucide-react'
import { rendererRuntimeClient } from '../../agent/runtime-client'
import { kunThreadPath } from '@shared/kun-endpoints'
import { useChatStore } from '../../store/chat-store'
import type { NormalizedThread } from '../../agent/types'
import { useTaskSuggestion } from './use-task-suggestion'

/** Turns a task session into an ordinary conversation; it leaves its parent's group. */
async function detachTaskSession(threadId: string): Promise<void> {
  const response = await rendererRuntimeClient.runtimeRequest(kunThreadPath(threadId), 'PATCH', JSON.stringify({ relation: 'primary' }))
  if (response.ok) await useChatStore.getState().refreshThreads()
}

/**
 * Shown inside a task session: which card task it runs, where it came from,
 * and the way back. Task sessions keep their own composer, unlike side threads.
 */
export function TaskSessionBar() {
  const thread = useChatStore((state) => state.threads.find((entry) => entry.id === state.activeThreadId))
  if (!thread || thread.relation !== 'task' || !thread.parentThreadId || !thread.taskOrigin) return null
  return <TaskSessionBarContent thread={thread as NormalizedThread & { parentThreadId: string; taskOrigin: NonNullable<NormalizedThread['taskOrigin']> }} />
}

function TaskSessionBarContent({ thread }: {
  thread: NormalizedThread & { parentThreadId: string; taskOrigin: NonNullable<NormalizedThread['taskOrigin']> }
}) {
  const { t } = useTranslation('common')
  const parentId = thread.parentThreadId
  const parent = useChatStore((state) => state.threads.find((entry) => entry.id === parentId))
  const { card } = useTaskSuggestion(thread.taskOrigin.intentId)
  const branch = card?.tasks.find((task) => task.id === thread.taskOrigin.taskId)?.branch
  return <div className="ds-no-drag mx-auto mt-2 flex w-full max-w-[760px] min-w-0 items-center gap-2.5 px-4" data-task-session-bar>
    <div role="status" className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-ds-border bg-ds-card px-3 py-2 text-[12.5px] text-ds-muted shadow-sm">
      <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg bg-accent-tint/10 text-accent"><Split size={13} aria-hidden /></span>
      <span className="min-w-0 flex-1 truncate">
        <strong className="font-semibold text-ds-ink">{t('taskSuggestion.session.title', { index: thread.taskOrigin.index, total: thread.taskOrigin.total })}</strong>
        {parent?.title ? <> · {t('taskSuggestion.session.from', { title: parent.title })}</> : null}
      </span>
      {branch ? <span className="hidden shrink-0 items-center gap-1 rounded-full bg-ds-subtle px-2 py-0.5 text-[11.5px] sm:inline-flex">
        <GitBranch size={11} aria-hidden />{t('taskSuggestion.session.branch', { branch })}
      </span> : null}
      <button type="button" title={t('taskSuggestion.session.detach')} aria-label={t('taskSuggestion.session.detach')}
        onClick={() => void detachTaskSession(thread.id)}
        className="hidden shrink-0 rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink sm:inline-flex"><Unlink size={13} aria-hidden /></button>
      <button type="button" onClick={() => void useChatStore.getState().selectThread(parentId)}
        className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium text-accent hover:bg-ds-hover">
        <ArrowLeft size={13} aria-hidden />{t('taskSuggestion.session.back')}
      </button>
    </div>
  </div>
}
