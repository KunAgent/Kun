import { useEffect, type ReactElement } from 'react'
import { BookOpen, PanelRightClose, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { ChatBlock } from '../../agent/types'
import { useChatStore } from '../../store/chat-store'
import { EMPTY_PAPER_ASSISTANT, patchPaperAssistant, usePaperAssistantStore } from '../../paper/paper-space-assistant-state'
import { openPaperSpaceAssistant, selectPaperSpaceAssistant } from '../../paper/paper-space-assistant'
import { paperSpaceItemKey } from '../../paper/paper-space-store'
import { requestKnowledgeSourceNavigation } from '../../lib/knowledge-source-navigation'
import { sharedDefaultModelSelection } from '../../agent/kun-runtime-shared-default'
import { paperAssistantSession } from '../../paper/paper-space-assistant-state'
import { paperAssistantCitationPage } from '../../paper/paper-assistant-citation'
import { TimelineFilePreviewWorkspaceProvider } from '../chat/timeline-file-preview-workspace'
import { LazyMessageTimeline } from '../chat/LazyMessageTimeline'
import { FloatingComposer } from '../chat/FloatingComposer'

const NO_BLOCKS: ChatBlock[] = []

export function PapersAssistantPanel({ workspaceRoot, unitDir, title, onCollapse, expanded, pdfPath }: {
  workspaceRoot: string
  unitDir: string
  title: string
  onCollapse: () => void
  expanded: boolean
  pdfPath?: string | null
}): ReactElement {
  const { t } = useTranslation('common')
  const key = paperSpaceItemKey(workspaceRoot, unitDir)
  const session = usePaperAssistantStore((state) => state.sessions[key] ?? EMPTY_PAPER_ASSISTANT)
  const chat = useChatStore()
  const ownsProjection = Boolean(session.threadId && session.threadId === chat.activeThreadId)
  const loading = ownsProjection && chat.threadLoadingId === session.threadId
  const setInput = (input: string): void => patchPaperAssistant(key, { input })
  useEffect(() => { void selectPaperSpaceAssistant(key) }, [key, session.threadId])
  useEffect(() => {
    if (session.threadId || session.model !== undefined) return
    let current = true
    void sharedDefaultModelSelection().then((selection) => {
      const latest = paperAssistantSession(key)
      if (current && !latest.threadId && latest.model === undefined && selection.model) {
        patchPaperAssistant(key, { model: selection.model, providerId: selection.providerId })
      }
    }).catch(() => undefined)
    return () => { current = false }
  }, [key, session.threadId, session.model])

  return <aside className="papers-reader-assistant" aria-label={t('paperSpaceAssistant')} data-expanded={expanded}>
    <header className="papers-assistant-header">
      <span className="papers-assistant-mark" aria-hidden>K</span>
      <h2>{t('paperSpaceAssistant')}</h2>
      <button type="button" className="papers-icon-button" aria-label={t('paperAssistantCollapse')} title={t('paperAssistantCollapse')} onClick={onCollapse}>
        <PanelRightClose size={16} />
      </button>
    </header>
    <div className="papers-assistant-context" title={title}><BookOpen size={14} aria-hidden /><span>{title}</span></div>
    <div className="papers-assistant-timeline" onClickCapture={(event) => {
      if (!pdfPath || !(event.target instanceof Element)) return
      const href = event.target.closest('a[href]')?.getAttribute('href')
      const page = href ? paperAssistantCitationPage(href, workspaceRoot, pdfPath) : null
      if (!page) return
      event.preventDefault()
      event.stopPropagation()
      requestKnowledgeSourceNavigation({ filePath: pdfPath, location: { kind: 'pdf', pageStart: page, pageEnd: page } })
    }}>
      <TimelineFilePreviewWorkspaceProvider workspaceRoot={workspaceRoot} threadId={ownsProjection ? session.threadId : null}>
      {ownsProjection ? <LazyMessageTimeline
        blocks={chat.blocks} liveReasoning={chat.liveReasoning} live={chat.liveAssistant}
        activeThreadId={session.threadId} runtimeConnection={chat.runtimeConnection}
        onRetryConnection={() => void chat.probeRuntime('user', { restart: true })}
        onOpenSettings={() => chat.setRoute('settings')}
        onSelectSuggestion={setInput} compactCards
      /> : <div className="papers-assistant-empty">
        <BookOpen size={28} strokeWidth={1.5} aria-hidden />
        <h3>{t('paperAssistantReady')}</h3><p>{t('paperAssistantScope')}</p>
      </div>}
      </TimelineFilePreviewWorkspaceProvider>
    </div>
    {session.error || (ownsProjection && chat.error) ? <div className="papers-notes-error" role="alert">{session.error || chat.error}</div> : null}
    <div className="papers-assistant-composer">
      {session.images.length ? <div className="papers-assistant-images">
        {session.images.map((image, index) => <div key={`${image.name}:${index}`}>
          <img src={`data:image/png;base64,${image.dataBase64}`} alt={image.name} />
          <button type="button" className="papers-icon-button" aria-label={t('removeAttachment')} onClick={() => patchPaperAssistant(key, {
            images: session.images.filter((_, i) => i !== index)
          })}><X size={12} /></button>
        </div>)}
      </div> : null}
      <FloatingComposer variant="compact" workspaceRootOverride={workspaceRoot}
        activeThreadIdOverride={ownsProjection ? session.threadId : null}
        userInputBlocksOverride={ownsProjection ? undefined : NO_BLOCKS}
        input={session.input} setInput={setInput} mode="agent" setMode={() => undefined}
        placeholderOverride={t('paperSpaceAskPaper')}
        busy={ownsProjection && chat.busy} disabled={session.sending || loading}
        runtimeReady={chat.runtimeConnection === 'ready'} hasActiveThread={ownsProjection}
        composerModel={ownsProjection ? chat.composerModel : session.model ?? ''} composerProviderId={ownsProjection ? chat.composerProviderId : session.providerId}
        composerPickList={chat.composerPickList} composerModelGroups={chat.composerModelGroups}
        composerReasoningEffort={chat.composerReasoningEffort} composerFastMode={chat.composerFastMode}
        onComposerModelChange={(model, providerId) => {
          patchPaperAssistant(key, { model, providerId })
          if (ownsProjection) void chat.setComposerModel(model, providerId)
        }} onComposerReasoningEffortChange={ownsProjection ? chat.setComposerReasoningEffort : undefined}
        onComposerFastModeChange={ownsProjection ? chat.setComposerFastMode : undefined} modelPickerMode="combobox"
        queuedMessages={ownsProjection ? chat.queuedMessages : []} onRemoveQueuedMessage={chat.removeQueuedMessage}
        onSend={() => { void openPaperSpaceAssistant({ workspaceRoot, unitDir, title,
          prompt: session.input, images: session.images, consumeDraft: true }) }}
        onInterrupt={(options) => { if (ownsProjection) void chat.interrupt(options) }}
      />
      <p className="papers-assistant-hint">{t('paperAssistantDraftHint')}</p>
    </div>
  </aside>
}
