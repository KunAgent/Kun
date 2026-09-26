import { useEffect, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { activeWriteThreadForWorkspace } from '../../write/write-thread-registry'
import { paperContextReferencePaths } from '../../paper/paper-conversation-scope'
import { buildPaperResearchBrief, type PaperResearchRequest } from '../../paper/paper-research-actions'
import { readLastResearchSession, researchResourcePath } from '../../paper/paper-research-sessions'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { workbenchWriteSourceReference } from '../../components/workbench/workbench-write-source-reference'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import { MobileComposer } from '../chat/MobileComposer'
import { MobilePendingActions } from '../chat/MobilePendingActions'
import { mergeRestoredDraft } from '../chat/mobile-draft-restore'
import { readMobilePage } from '../navigation/mobile-page'
import { paperResourceKey } from './paper-resource-key'
import { buildMobilePaperQuestion } from './mobile-paper-turn'
import { forgetPendingResearchSession } from './mobile-paper-research-pending'
import '../work/mobile-work-assistant.css'

type Quote = { text: string; page: number }

function readDraft(key: string): string {
  try { return window.sessionStorage.getItem(key) ?? '' } catch { return '' }
}
function writeDraft(key: string, value: string): void {
  try { if (value) window.sessionStorage.setItem(key, value); else window.sessionStorage.removeItem(key) } catch { /* private mode */ }
}

export function MobilePaperAssistant({ root, unitDir, page, quote, researchSessionId, researchRequest,
  researchBlockedReason, onSettings, onClearQuote, onSessionAdmitted }: {
  root: string; unitDir: string; page: number; quote: Quote | null; researchSessionId?: string
  researchRequest?: Omit<PaperResearchRequest, 'query'>
  researchBlockedReason?: string | null
  onSettings: () => void; onClearQuote: () => void; onSessionAdmitted?: () => void
}) {
  const { t } = useTranslation('common')
  const unitPath = researchSessionId ? researchResourcePath(root, researchSessionId) : writeJoinPath(root, unitDir)
  const draftKey = `kun.mobile.paper.draft.${paperResourceKey(root, unitPath)}`
  const [input, setInput] = useState(() => readDraft(draftKey))
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const generation = useRef(0)
  const latestPage = useRef(page)
  latestPage.current = page
  useEffect(() => { setInput(readDraft(draftKey)) }, [draftKey])
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
    const rawInput = input
    const text = rawInput.trim()
    if (!text || pendingInput || sending || chat.runtimeConnection !== 'ready' || researchBlockedReason) return
    setInput(''); setSending(true); setError('')
    const started = generation.current
    const pageAtSend = page
    const quoteAtSend = quote
    const stillCurrent = (): boolean => {
      if (generation.current !== started || !useWriteWorkspaceStore.getState().paperMode.libraries.includes(root)) return false
      const route = readMobilePage(new URL(window.location.href))
      return researchSessionId ? route.kind === 'discover' && readLastResearchSession(root) === researchSessionId
        : route.kind === 'paper' && route.paperKey === paperResourceKey(root, unitDir) && latestPage.current === pageAtSend
    }
    void (async () => {
      try {
        const threadId = await chat.ensureThread(root, unitPath)
        if (!threadId) throw new Error(t('mobileWorkPaperSessionFailed'))
        if (!stillCurrent()) throw new Error(t('mobileWorkPaperPageMoved'))
        if (useChatStore.getState().activeThreadId !== threadId) await chat.selectThread(threadId, root, unitPath)
        if (!stillCurrent() || useChatStore.getState().activeThreadId !== threadId) {
          throw new Error(t('mobileWorkPaperThreadMoved'))
        }
        const references = unitDir ? (await Promise.all(paperContextReferencePaths(unitDir)
          .map(async (relative) => {
            const path = writeJoinPath(root, relative)
            const available = await window.kunGui.readWorkspaceFile({ workspaceRoot: root, path })
              .catch(() => null)
            return available?.ok ? workbenchWriteSourceReference(root, path) : undefined
          }))).filter((reference): reference is NonNullable<typeof reference> => reference !== undefined) : []
        if (!stillCurrent() || useChatStore.getState().activeThreadId !== threadId) {
          throw new Error(t('mobileWorkPaperPageMoved'))
        }
        const prompt = researchSessionId
          ? useChatStore.getState().blocks.some((block) => block.kind === 'user') ? text
            : buildPaperResearchBrief({ query: text, depth: researchRequest?.depth ?? 'standard',
                sources: researchRequest?.sources ?? [], yearFrom: researchRequest?.yearFrom,
                yearTo: researchRequest?.yearTo })
          : unitDir ? buildMobilePaperQuestion({ text, libraryRoot: root, unitDir,
              page: pageAtSend, quote: quoteAtSend }) : text
        const sent = await chat.sendMessage(prompt, 'agent', {
          expectedThreadId: threadId, agentSurface: 'write',
          ...(workModel.model ? { model: workModel.model } : {}),
          ...(workModel.providerId ? { providerId: workModel.providerId } : {}),
          ...(references.length ? { fileReferences: references } : {})
        })
        if (!sent) throw new Error(t('mobileWorkPaperSendFailed'))
        if (researchSessionId) {
          forgetPendingResearchSession(root, researchSessionId)
          if (stillCurrent()) onSessionAdmitted?.()
        }
        if (readDraft(draftKey) === rawInput) writeDraft(draftKey, '')
        if (stillCurrent()) onClearQuote()
      } catch (cause) {
        if (generation.current === started) {
          setError(String(cause)); setInput((value) => {
            const restored = mergeRestoredDraft(rawInput, value)
            writeDraft(draftKey, restored)
            return restored
          })
        }
      } finally { if (generation.current === started) setSending(false) }
    })()
  }
  return <section className="kun-mobile-work-assistant">
    <div className="kun-mobile-work-assistant-timeline">{ready ? <LazyMessageTimeline blocks={chat.blocks}
      liveReasoning={chat.liveReasoning} live={chat.liveAssistant} activeThreadId={chat.activeThreadId}
      runtimeConnection={chat.runtimeConnection} runtimeError={chat.runtimeError}
      onRetryConnection={chat.probeRuntime} onOpenSettings={onSettings} compactCards /> : null}</div>
    {quote ? <div className="kun-mobile-work-selection">{t('mobileWorkPaperQuotedAt', { page: quote.page, quote: quote.text.slice(0, 120) })}
      <button type="button" onClick={onClearQuote}>{t('mobileWorkPaperRemoveQuote')}</button></div> : <p className="kun-mobile-work-selection">
      {researchSessionId ? t('mobileWorkPaperResearchBound') : t('mobileWorkPaperQuestionBound', { page })}</p>}
    <MobileComposer value={input} onChange={(value) => { setInput(value); writeDraft(draftKey, value) }} onSend={send}
      onStop={() => void chat.interrupt()} onAttachments={null} onOptions={null}
      running={ready && chat.busy} disabled={chat.runtimeConnection !== 'ready'} sending={sending}
      canSend={!pendingInput && !researchBlockedReason && Boolean(input.trim())}
      error={error || researchBlockedReason || null}
      pendingActions={ready ? <MobilePendingActions blocks={chat.blocks} resolveApproval={chat.resolveApproval}
        resolveUserInput={chat.resolveUserInput} /> : null}
      labels={{ placeholder: t(pendingInput ? 'mobileInputComposerHint' : 'mobileComposerPlaceholder'),
        send: t('send'), stop: t('interrupt'), attachments: t('toolAttachments'),
        options: chat.composerModel || t('autoLabel') }} />
  </section>
}
