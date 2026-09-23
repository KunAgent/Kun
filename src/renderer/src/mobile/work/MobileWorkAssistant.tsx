import { useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { selectLivePendingUserInput } from '../../components/chat/user-input-panel-logic'
import { MobileComposer } from '../chat/MobileComposer'
import { MobilePendingActions } from '../chat/MobilePendingActions'
import { useMobileWorkAssistantSend } from './use-mobile-work-assistant-send'
import './mobile-work-assistant.css'

export function mobileWorkAssistantThreadReady(expectedThreadId: string | null, activeThreadId: string | null): boolean {
  return Boolean(expectedThreadId && activeThreadId === expectedThreadId)
}

export function MobileWorkAssistant({ expectedThreadId, onSettings }: {
  expectedThreadId: string | null
  onSettings: () => void
}) {
  const { t } = useTranslation('common')
  const [input, setInput] = useState('')
  const state = useChatStore(useShallow((value) => ({
    blocks: value.blocks, liveReasoning: value.liveReasoning, liveAssistant: value.liveAssistant,
    activeThreadId: value.activeThreadId, runtimeConnection: value.runtimeConnection,
    runtimeError: value.runtimeErrorDetail ?? value.error, busy: value.busy,
    probeRuntime: value.probeRuntime, interrupt: value.interrupt,
    resolveApproval: value.resolveApproval, resolveUserInput: value.resolveUserInput,
    composerModel: value.composerModel
  })))
  const threadReady = mobileWorkAssistantThreadReady(expectedThreadId, state.activeThreadId)
  const write = useWriteWorkspaceStore(useShallow((value) => ({
    workspaceRoot: value.workspaceRoot,
    selection: value.selection,
    quotedSelections: value.quotedSelections,
    quoteCurrentSelection: value.quoteCurrentSelection
  })))
  const hasSelection = write.selection.ranges.some((range) => range.text.trim().length > 0)
  const assistant = useMobileWorkAssistantSend()
  const pendingInput = threadReady && selectLivePendingUserInput(state.blocks)
  const send = async (): Promise<void> => {
    if (pendingInput) return
    if (await assistant.send(input)) setInput('')
  }
  return <section className="kun-mobile-work-assistant">
    <div className="kun-mobile-work-assistant-timeline">{threadReady ? <LazyMessageTimeline blocks={state.blocks}
      liveReasoning={state.liveReasoning} live={state.liveAssistant} activeThreadId={state.activeThreadId}
      runtimeConnection={state.runtimeConnection} runtimeError={state.runtimeError}
      onRetryConnection={state.probeRuntime} onOpenSettings={onSettings} compactCards /> : null}</div>
    {hasSelection || write.quotedSelections.length ? <div className="kun-mobile-work-selection">
      {hasSelection ? <button type="button" onClick={() => write.quoteCurrentSelection(write.workspaceRoot)}>
        {t('writeSelectionQuote')}</button> : null}
      {write.quotedSelections.length ? <span>{t('writeSelectionLabel')} · {write.quotedSelections.length}</span> : null}
    </div> : null}
    <MobileComposer value={input} onChange={setInput} onSend={() => void send()}
      onStop={() => void state.interrupt()} onAttachments={null} onOptions={null}
      running={threadReady && state.busy} disabled={state.runtimeConnection !== 'ready'} sending={assistant.sending}
      canSend={!pendingInput && Boolean(input.trim())} error={assistant.error}
      pendingActions={threadReady ? <MobilePendingActions blocks={state.blocks} resolveApproval={state.resolveApproval}
        resolveUserInput={state.resolveUserInput} /> : null}
      labels={{ placeholder: t(pendingInput ? 'mobileInputComposerHint' : 'composerPlaceholder'), send: t('send'), stop: t('stop'),
        attachments: t('attachments'), options: state.composerModel || t('auto') }} />
  </section>
}
