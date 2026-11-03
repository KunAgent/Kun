import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ExternalLink, Loader2, X } from 'lucide-react'
import { FloatingComposer } from '../../components/chat/FloatingComposer'
import { LazyMessageTimeline } from '../../components/chat/LazyMessageTimeline'
import { useChatStore } from '../../store/chat-store'
import { writeJoinPath } from '../../write/write-workspace-store-helpers'
import { ArtifactDetails } from '../ArtifactDetails'
import type { LibraryArtifact } from '../artifact-types'
import { useArtifactChatBinding, type ArtifactChatBinding } from './artifact-chat-binding'
import { artifactContextChips } from './artifact-chat-context'
import { sendArtifactChatTurn } from './artifact-chat-send'
import {
  addArtifactReference,
  consumeArtifactReferences,
  dismissArtifactChange,
  dismissArtifactNotice,
  openArtifactCompare,
  pickArtifactReferences,
  removeArtifactReference,
  restoreArtifactVersion,
  useArtifactChatSession
} from './artifact-chat-session'
import { ArtifactChangeCard, ArtifactChatNoticeLine } from './ArtifactChangeCard'
import { ArtifactChatBindingBar } from './ArtifactChatBindingBar'
import { ArtifactChatEmptyState } from './ArtifactChatEmptyState'
import { ArtifactVersionsList } from './ArtifactVersionsList'
import type { ArtifactChatHost, ArtifactOfficeSession } from './use-artifact-office-session'

type Tab = 'chat' | 'info' | 'versions'
const EMPTY_REFERENCES: never[] = []
const EMPTY_VERSIONS: never[] = []

/**
 * The right side of an Office artifact: a conversation with Kun about this
 * file. It runs in the artifact's conversation (made active, as Work does),
 * sends the slide or selection on screen as context, and shows what each turn
 * changed with compare and undo.
 */
export function ArtifactChatPanel({ artifact, host, session, binding, onClose, className = '' }: {
  artifact: LibraryArtifact
  host: ArtifactChatHost
  session: ArtifactOfficeSession
  binding: ArtifactChatBinding
  onClose?: () => void
  className?: string
}): ReactElement {
  const { t } = useTranslation('common')
  const [tab, setTab] = useState<Tab>('chat')
  const threadId = binding.thread?.id ?? null
  const showing = Boolean(threadId && host.activeThreadId === threadId)
  const busy = showing && host.busy
  const latest = useArtifactChatSession((state) => state.latest[artifact.id] ?? null)
  const notice = useArtifactChatSession((state) => state.notice[artifact.id] ?? null)
  const versions = useArtifactChatSession((state) => state.versions[artifact.id] ?? EMPTY_VERSIONS)
  const compare = useArtifactChatSession((state) => state.compare[artifact.id] ?? null)
  const restoring = useArtifactChatSession((state) => state.restoring[artifact.id] === true)
  const pending = useArtifactChatSession((state) => Boolean(state.pending[artifact.id]))
  const references = useArtifactChatSession((state) => state.references[artifact.id] ?? EMPTY_REFERENCES)
  const chips = useMemo(() => artifactContextChips(session.view, t), [session.view, t])
  const currentSha = session.officeResult?.ok ? session.officeResult.sourceSha256 : ''
  const filePath = writeJoinPath(artifact.workspaceRoot, artifact.path)

  // Show the bound conversation: select it once per binding, never fight later navigation.
  const attemptedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!threadId || host.runtimeConnection !== 'ready' || host.activeThreadId === threadId) return
    if (attemptedRef.current === threadId) return
    attemptedRef.current = threadId
    void useChatStore.getState().selectThread(threadId)
  }, [host.activeThreadId, host.runtimeConnection, threadId])

  const composer = host.composerProps
  const send = async (): Promise<void> => {
    const request = composer.input.trim()
    if (!request) return
    const sentReferences = references
    composer.setInput('')
    const result = await sendArtifactChatTurn({
      artifact, threadId: binding.kind === 'draft' ? null : threadId, request, view: session.view,
      preview: session.officeResult?.ok ? session.officeResult : null, fileReferences: sentReferences, mode: composer.mode
    })
    if (!result.sent) {
      composer.setInput(request)
      return
    }
    session.clearSentContext()
    consumeArtifactReferences(artifact.id, sentReferences)
  }
  const openInCode = (): void => {
    if (!threadId) return
    const store = useChatStore.getState()
    store.setRoute('chat')
    void store.selectThread(threadId)
  }
  const restore = (versionId: string): void => {
    if (currentSha) void restoreArtifactVersion(artifact, versionId, currentSha)
  }
  const hasTimeline = showing && (host.blocks.length > 0 || host.liveAssistant.trim().length > 0 || host.liveReasoning.trim().length > 0)
  const tabs: Array<{ id: Tab; label: string }> = [
    { id: 'chat', label: t('artifactChatTab') },
    { id: 'info', label: t('artifactsDetails') },
    { id: 'versions', label: t('artifactsVersions') }
  ]

  return (
    <aside aria-label={t('artifactChatToggle')} data-artifact-chat-panel={tab}
      className={`ds-no-drag flex min-h-0 flex-col border-ds-border bg-ds-card lg:border-l ${className}`}>
      <div className="flex h-[52px] shrink-0 items-center gap-2 border-b border-ds-border-muted px-3.5">
        <div role="tablist" className="flex gap-0.5 rounded-[10px] bg-ds-hover p-[3px]">
          {tabs.map((item) => (
            <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
              className={`h-7 rounded-lg px-3 text-[12.5px] ${tab === item.id ? 'bg-ds-card font-semibold text-ds-ink shadow-sm' : 'text-ds-muted'}`}>
              {item.label}
            </button>
          ))}
        </div>
        <span className="flex-1" />
        {threadId ? (
          <button type="button" onClick={openInCode} title={t('artifactChatOpenInCode')} aria-label={t('artifactChatOpenInCode')}
            className="flex h-8 items-center gap-1.5 rounded-lg px-2 text-[12.5px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
            <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          </button>
        ) : null}
        {onClose ? (
          <button type="button" onClick={onClose} title={t('artifactChatClose')} aria-label={t('artifactChatClose')}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-ds-muted hover:bg-ds-hover hover:text-ds-ink lg:hidden">
            <X className="h-4 w-4" aria-hidden />
          </button>
        ) : null}
      </div>

      {tab === 'info' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-5"><ArtifactDetails artifact={artifact} /></div>
      ) : tab === 'versions' ? (
        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          <ArtifactVersionsList entries={versions} comparingId={compare?.versionId ?? null} restoring={restoring}
            onView={(id) => void openArtifactCompare(artifact, id)} onRestore={restore} />
        </div>
      ) : (
        <>
          <ArtifactChatBindingBar binding={binding} disabled={busy}
            onUseSource={() => useArtifactChatBinding.getState().useSource(artifact.id)}
            onStartFresh={() => useArtifactChatBinding.getState().startFresh(artifact.id)}
            onOpenInCode={openInCode} />
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {hasTimeline ? (
              <LazyMessageTimeline
                blocks={host.blocks}
                liveReasoning={host.liveReasoning}
                live={host.liveAssistant}
                activeThreadId={host.activeThreadId}
                runtimeConnection={host.runtimeConnection}
                onRetryConnection={host.onRetryConnection}
                onOpenSettings={host.onOpenSettings}
                onSelectSuggestion={(text) => composer.setInput(text)}
                compactCards
              />
            ) : threadId && !showing ? (
              <div className="flex flex-1 items-center justify-center gap-2 text-[12.5px] text-ds-muted">
                <Loader2 className="h-4 w-4 animate-spin text-accent" aria-hidden />{t('artifactChatLoading')}
              </div>
            ) : (
              <ArtifactChatEmptyState artifact={artifact} sourceTitle={binding.kind === 'source' ? binding.source?.title ?? null : null}
                onPick={(prompt) => composer.setInput(prompt)} />
            )}
          </div>
          <div className="shrink-0 px-3.5 pb-3 pt-2">
            {busy && !pending ? (
              <p className="mb-2 rounded-lg bg-ds-hover px-3 py-2 text-[12px] text-ds-muted" data-artifact-chat-busy-other>
                {t('artifactChatBusyOther', { title: binding.thread?.title ?? '' })}
              </p>
            ) : null}
            <ArtifactChatNoticeLine notice={notice} onDismiss={() => dismissArtifactNotice(artifact.id)} />
            {latest && !busy ? (
              <ArtifactChangeCard change={latest} filePath={filePath} restoring={restoring}
                onCompare={() => void openArtifactCompare(artifact, latest.versionId)}
                onUndo={() => restore(latest.versionId)}
                onDismiss={() => dismissArtifactChange(artifact.id)} />
            ) : null}
            <FloatingComposer
              variant="compact"
              agentSwitcher
              workspaceRootOverride={artifact.workspaceRoot}
              input={composer.input}
              setInput={composer.setInput}
              mode={composer.mode}
              setMode={composer.setMode}
              busy={busy}
              runtimeReady={host.runtimeConnection === 'ready'}
              hasActiveThread={showing}
              composerModel={composer.composerModel}
              composerProviderId={composer.composerProviderId}
              composerPickList={composer.composerPickList}
              composerModelGroups={composer.composerModelGroups}
              composerReasoningEffort={composer.composerReasoningEffort}
              composerFastMode={composer.composerFastMode}
              onComposerModelChange={composer.onComposerModelChange}
              onComposerReasoningEffortChange={composer.onComposerReasoningEffortChange}
              onComposerFastModeChange={composer.onComposerFastModeChange}
              onConfigureProviders={composer.onConfigureProviders}
              modelPickerMode="combobox"
              modelControlVariant="split"
              placeholderOverride={t('artifactChatPlaceholder')}
              executionSettings={composer.executionSettings}
              executionSettingsApplying={composer.executionSettingsApplying}
              onExecutionSettingsChange={composer.onExecutionSettingsChange}
              queuedMessages={showing ? composer.queuedMessages : []}
              onRemoveQueuedMessage={composer.onRemoveQueuedMessage}
              onGuideQueuedMessage={composer.onGuideQueuedMessage}
              contextChips={chips}
              onRemoveContextChip={session.removeChip}
              fileReferenceEnabled
              fileReferences={references}
              onAddFileReference={(reference) => addArtifactReference(artifact.id, reference)}
              onRemoveFileReference={(relativePath) => removeArtifactReference(artifact.id, relativePath)}
              onPickFileReferences={() => void pickArtifactReferences(artifact)}
              onSend={() => void send()}
              onInterrupt={composer.onInterrupt}
            />
            <p className="mb-0 mt-2 px-0.5 text-[12px] text-ds-muted">{t('artifactChatFooter')}</p>
          </div>
        </>
      )}
    </aside>
  )
}
