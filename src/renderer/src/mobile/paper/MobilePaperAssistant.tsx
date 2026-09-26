import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { activeWriteThreadForWorkspace } from '../../write/write-thread-registry'
import { paperContextReferencePaths } from '../../paper/paper-conversation-scope'
import { researchResourcePath } from '../../paper/paper-research-sessions'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { workbenchWriteSourceReference } from '../../components/workbench/workbench-write-source-reference'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import { MobileComposer } from '../chat/MobileComposer'
import { MobilePendingActions } from '../chat/MobilePendingActions'
import { mergeRestoredDraft } from '../chat/mobile-draft-restore'
import { readMobilePage } from '../navigation/mobile-page'
import { paperResourceKey } from './paper-resource-key'
import '../work/mobile-work-assistant.css'

type Quote = { text: string; page: number }

export function MobilePaperAssistant({ root, unitDir, page, quote, researchSessionId, onSettings, onClearQuote }: {
  root: string; unitDir: string; page: number; quote: Quote | null; researchSessionId?: string
  onSettings: () => void; onClearQuote: () => void
}) {
  const { t } = useTranslation('common')
  const unitPath = researchSessionId ? researchResourcePath(root, researchSessionId) : writeJoinPath(root, unitDir)
  const [input, setInput] = useState('')
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  useEffect(() => {
    generation.current += 1
    return () => { generation.current += 1 }
  }, [root, unitPath])
  const chat = useChatStore(useShallow((value) => ({
    threads: value.threads, blocks: value.blocks, activeThreadId: value.activeThreadId,
    runtimeConnection: value.runtimeConnection, runtimeError: value.runtimeErrorDetail ?? value.error,
    liveReasoning: value.liveReasoning, liveAssistant: value.liveAssistant,
    busy: value.busy, probeRuntime: value.probeRuntime, interrupt: value.interrupt,
    resolveApproval: value.resolveApproval, resolveUserInput: value.resolveUserInput,
    ensureThread: value.ensureWriteThreadForWorkspace, selectThread: value.selectWriteThread,
    sendMessage: value.sendMessage, composerModel: value.composerModel
  })))
  const workModel = useWriteWorkspaceStore(useShallow((value) => ({
    model: value.assistantModel, providerId: value.assistantProviderId
  })))
  const expected = activeWriteThreadForWorkspace(root, chat.threads, undefined, unitPath)?.id ?? null
  const ready = expected !== null && chat.activeThreadId === expected
  const selectThread = chat.selectThread
  useEffect(() => {
    if (expected && !ready) void selectThread(expected, root, unitPath)
  }, [expected, ready, selectThread, root, unitPath])
  const pendingInput = ready && selectLivePendingUserInput(chat.blocks)
  const send = (): void => {
    const text = input.trim()
    if (!text || pendingInput || sending || chat.runtimeConnection !== 'ready') return
    setInput(''); setSending(true); setError('')
    const started = generation.current
    const stillCurrent = (): boolean => {
      if (generation.current !== started) return false
      const route = readMobilePage(new URL(window.location.href))
      return researchSessionId ? route.kind === 'discover'
        : route.kind === 'paper' && route.paperKey === paperResourceKey(root, unitDir)
    }
    void (async () => {
      try {
        const threadId = await chat.ensureThread(root, unitPath)
        if (!threadId) throw new Error('未能建立论文会话')
        if (!stillCurrent()) return
        if (useChatStore.getState().activeThreadId !== threadId) await chat.selectThread(threadId, root, unitPath)
        if (!stillCurrent() || useChatStore.getState().activeThreadId !== threadId) return
        const references = unitDir ? (await Promise.all(paperContextReferencePaths(unitDir)
          .map(async (relative) => {
            const path = writeJoinPath(root, relative)
            const available = await window.kunGui.readWorkspaceFile({ workspaceRoot: root, path })
              .catch(() => null)
            return available?.ok ? workbenchWriteSourceReference(root, path) : undefined
          }))).filter((reference): reference is NonNullable<typeof reference> => reference !== undefined) : []
        if (!stillCurrent() || useChatStore.getState().activeThreadId !== threadId) return
        const prompt = quote
          ? `${text}\n\n引用（${unitDir}，第 ${quote.page} 页）：\n> ${quote.text}` : text
        const sent = await chat.sendMessage(prompt, 'agent', {
          expectedThreadId: threadId, agentSurface: 'write',
          ...(workModel.model ? { model: workModel.model } : {}),
          ...(workModel.providerId ? { providerId: workModel.providerId } : {}),
          ...(references.length ? { fileReferences: references } : {})
        })
        if (!sent) throw new Error('发送失败')
        onClearQuote()
      } catch (cause) { setError(String(cause)); setInput((value) => mergeRestoredDraft(text, value)) }
      finally { setSending(false) }
    })()
  }
  return <section className="kun-mobile-work-assistant">
    <div className="kun-mobile-work-assistant-timeline">{ready ? <LazyMessageTimeline blocks={chat.blocks}
      liveReasoning={chat.liveReasoning} live={chat.liveAssistant} activeThreadId={chat.activeThreadId}
      runtimeConnection={chat.runtimeConnection} runtimeError={chat.runtimeError}
      onRetryConnection={chat.probeRuntime} onOpenSettings={onSettings} compactCards /> : null}</div>
    {quote ? <div className="kun-mobile-work-selection">已引用第 {quote.page} 页：{quote.text.slice(0, 120)}
      <button type="button" onClick={onClearQuote}>移除引用</button></div> : <p className="kun-mobile-work-selection">
      {researchSessionId ? '研究会话已绑定到当前文献库。' : `提问将绑定到当前论文会话（第 ${page} 页）。`}</p>}
    <MobileComposer value={input} onChange={setInput} onSend={send}
      onStop={() => void chat.interrupt()} onAttachments={null} onOptions={null}
      running={ready && chat.busy} disabled={chat.runtimeConnection !== 'ready'} sending={sending}
      canSend={!pendingInput && Boolean(input.trim())} error={error}
      pendingActions={ready ? <MobilePendingActions blocks={chat.blocks} resolveApproval={chat.resolveApproval}
        resolveUserInput={chat.resolveUserInput} /> : null}
      labels={{ placeholder: t(pendingInput ? 'mobileInputComposerHint' : 'mobileComposerPlaceholder'),
        send: t('send'), stop: t('interrupt'), attachments: t('toolAttachments'),
        options: chat.composerModel || t('autoLabel') }} />
  </section>
}
