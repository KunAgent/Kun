import { useEffect, useState } from 'react'
import { Globe2, Loader2, RotateCcw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { AgentDirectActivity } from '@shared/rooms-api'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserPanel } from '../AgentBrowserPanel'
import './rooms-agent-browser.css'

type Activity = AgentDirectActivity | null | undefined

/** Browser authority comes only from the runtime's joined execution, never a card or message. */
export function currentPrivateExecution(roomId: string, activity: Activity, error?: string) {
  const execution = activity?.execution
  const request = activity?.active
  return !error && execution?.roomId === roomId && request?.status === 'running' &&
    request.id === execution.requestId && request.runId === execution.runId &&
    request.threadId === execution.threadId && request.turnId === execution.turnId
    ? execution : undefined
}

export function RoomAgentBrowser({ roomId, activity, error, active, selectedRunId, onRefresh, onCurrent }: {
  roomId: string; activity: Activity; error?: string; active: boolean; selectedRunId?: string
  onRefresh: () => void; onCurrent: () => void
}) {
  const { t, i18n } = useTranslation('common')
  const text = (cn: string, en: string) => i18n.language.startsWith('zh') ? cn : en
  const execution = currentPrivateExecution(roomId, activity, error)
  const historical = Boolean(selectedRunId && selectedRunId !== execution?.runId)
  const state = error ? 'unavailable' : historical ? 'historical' : execution ? 'live' : !activity ? 'loading' : 'idle'
  const request = activity?.active ?? activity?.requests[0]
  const status = request?.status
  const idle = status === 'stopping' ? t('directStopping') : status === 'cancelled' ? t('directStopped')
    : status === 'failed' ? t('directFailed') : status === 'recovery_required' ? t('directReconciling')
      : status === 'pending' ? t('directQueued') : text('当前没有可监督的浏览器任务', 'No live browser task in this conversation')
  return <section className="rooms-agent-browser" data-room-agent-browser data-state={state} data-room-id={roomId}
    data-run-id={state === 'live' ? execution?.runId : undefined} data-thread-id={state === 'live' ? execution?.threadId : undefined} data-turn-id={state === 'live' ? execution?.turnId : undefined}>
    <header><Globe2 size={15} /><strong>{text('当前任务的浏览器', 'Current task browser')}</strong></header>
    {state === 'live' && execution ? <div className="rooms-agent-browser-live">
      <AgentBrowserPanel key={`${roomId}:${execution.runId}:${execution.turnId}`} threadId={execution.threadId}
        expectedTurnId={execution.turnId} active={active} />
    </div> : <div className="rooms-agent-browser-empty" role={error ? 'alert' : 'status'}>
      {state === 'loading' ? <Loader2 size={24} className="animate-spin" /> : <Globe2 size={28} />}
      <strong>{error || (historical ? text('历史会话只供查看', 'Historical sessions are read-only') : state === 'loading' ? t('roomsLoading') : idle)}</strong>
      <p>{historical ? text('浏览器只绑定已验证的当前执行，不会从历史会话恢复或重跑任务。', 'The browser follows the verified current execution. Viewing history never resumes or reruns a task.')
        : text('Agent 使用浏览器时，可在这里查看操作、审批或接管。停止和恢复仍使用原任务的控制。', 'When the Agent uses a browser, review its activity, approve actions or take control here. Task stop and recovery stay with the original execution.')}</p>
      {error ? <button type="button" onClick={onRefresh}><RotateCcw size={14} />{t('retry', { defaultValue: 'Retry' })}</button>
        : historical && execution ? <button type="button" onClick={onCurrent}>{text('查看当前浏览器', 'Show current browser')}</button> : null}
    </div>}
  </section>
}

/** Read-only discovery of the existing browser, without mounting it or granting supervision. */
export function RoomAgentBrowserStatus({ roomId, activity, error, onOpen }: {
  roomId: string; activity: Activity; error?: string; onOpen: () => void
}) {
  const { i18n } = useTranslation('common')
  const text = (cn: string, en: string) => i18n.language.startsWith('zh') ? cn : en
  const execution = currentPrivateExecution(roomId, activity, error)
  const threadId = execution?.threadId, turnId = execution?.turnId
  const scope = JSON.stringify([roomId, threadId, turnId])
  const [snapshot, setSnapshot] = useState<{ scope: string; state: BrowserUseViewState }>()
  useEffect(() => {
    if (!threadId || !turnId || !window.kunGui?.getBrowserUseState) return
    let live = true, receivedEvent = false
    const accept = (state: BrowserUseViewState) => {
      if (live && state.threadId === threadId && state.turnId === turnId) setSnapshot({ scope, state })
    }
    const off = window.kunGui.onBrowserUseState((state) => {
      if (!live || state.threadId !== threadId) return
      receivedEvent = true
      if (state.turnId !== turnId) setSnapshot(undefined)
      else accept(state)
    })
    void window.kunGui.getBrowserUseState(threadId, turnId)
      .then((state) => { if (!receivedEvent) accept(state) }).catch(() => undefined)
    return () => { live = false; off() }
  }, [scope, threadId, turnId])
  if (!execution) return null
  const state = snapshot?.scope === scope ? snapshot.state : undefined
  const label = !state?.sessionId ? text('需要时可打开浏览器', 'Browser is ready when needed')
    : state.pendingOriginConsent || state.pendingActionConsent ? text('浏览器操作等待你确认', 'Browser action needs your approval')
      : state.controlOwner === 'manual' ? text('你正在控制浏览器', 'You have browser control')
        : state.lifecycle === 'stopped' ? text('浏览器已停止', 'Browser stopped')
          : state.lifecycle === 'error' || state.capabilityStatus === 'unavailable' ? text('浏览器需要处理', 'Browser needs attention')
            : state.lifecycle === 'loading' ? text('浏览器正在加载', 'Browser loading')
              : text('Agent 正在使用浏览器', 'Agent browser is active')
  return <div className="rooms-agent-browser-status" data-room-browser-status data-run-id={execution.runId} role="status">
    <Globe2 size={14} /><span>{label}</span><button type="button" onClick={onOpen}>{text('打开浏览器', 'Open browser')}</button>
  </div>
}
