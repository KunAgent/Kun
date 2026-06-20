import { memo, useCallback, useEffect, useRef } from 'react'
import { Send, Loader2, MessageSquare, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  useDesignAssistantStore,
  type DesignMessageBlock
} from '../../design/design-assistant-store'
import { useDesignWorkspaceStore } from '../../design/design-workspace-store'
import { buildDesignTurnPrompt } from '../../design/design-turn-prompt'
import { useChatStore } from '../../store/chat-store'
import { FloatingComposerModelPicker } from '../chat/FloatingComposerModelPicker'

type Props = {
  onOpenSettings?: (section?: string) => void
}

function DesignAIRailInner({ onOpenSettings }: Props) {
  const { t } = useTranslation('common')
  const blocks = useDesignAssistantStore((s) => s.designBlocks)
  const input = useDesignAssistantStore((s) => s.designInput)
  const busy = useDesignAssistantStore((s) => s.designBusy)
  const target = useDesignAssistantStore((s) => s.designTarget)
  const setInput = useDesignAssistantStore((s) => s.setDesignInput)
  const sendMessage = useDesignAssistantStore((s) => s.sendDesignMessage)
  const clearConversation = useDesignAssistantStore((s) => s.clearDesignConversation)

  const workspaceRoot = useDesignWorkspaceStore((s) => s.workspaceRoot)
  const assistantModel = useDesignWorkspaceStore((s) => s.assistantModel)
  const assistantProviderId = useDesignWorkspaceStore((s) => s.assistantProviderId)
  const setAssistantModel = useDesignWorkspaceStore((s) => s.setAssistantModel)

  const composerPickList = useChatStore((s) => s.composerPickList)
  const composerModelGroups = useChatStore((s) => s.composerModelGroups)
  const runtimeReady = useChatStore((s) => s.runtimeConnection === 'ready')

  const timelineRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = timelineRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [blocks.length])

  const handleSend = useCallback(() => {
    const text = input.trim()
    if (!text || busy || !workspaceRoot) return

    const store = useDesignWorkspaceStore.getState()
    const active = store.artifacts.find((a) => a.id === store.activeArtifactId) ?? null

    const prompt = buildDesignTurnPrompt({
      target: active?.kind === 'canvas' ? 'canvas' : 'html',
      mode: 'text',
      text,
      artifactRelativePath: active?.relativePath ?? '',
      workspaceRoot,
      customPrompt: store.generationPrompt || undefined,
      designContext: store.designContext
    })

    void sendMessage(text, prompt, workspaceRoot)
  }, [input, busy, workspaceRoot, sendMessage])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSend()
      }
    },
    [handleSend]
  )

  const targetLabel =
    target.type === 'new'
      ? t('designRailTargetNew')
      : target.type === 'html'
        ? `${t('designRailTargetIterate')}${target.title}`
        : t('designRailTargetCanvas')

  const canSend = input.trim().length > 0 && !busy && runtimeReady && Boolean(workspaceRoot)

  return (
    <div className="ds-no-drag flex h-full w-[380px] shrink-0 flex-col border-l border-[var(--ds-sidebar-row-ring)] bg-white dark:bg-[#1f242c]">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2 shadow-[inset_0_-1px_0_var(--ds-sidebar-row-ring)]">
        <div className="flex min-w-0 items-center gap-2">
          <MessageSquare className="h-4 w-4 shrink-0 text-[#3b82d8]" strokeWidth={1.9} />
          <div className="min-w-0">
            <div className="text-[13px] font-medium text-[#1f2733] dark:text-white/90">
              {t('designRailTitle')}
            </div>
            <div className="truncate text-[11px] text-[#8b95a3] dark:text-white/45">
              {targetLabel}
            </div>
          </div>
        </div>
        <button
          type="button"
          onClick={clearConversation}
          className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#8b95a3] transition-colors hover:bg-black/[0.04] hover:text-[#1f2733] dark:text-white/45 dark:hover:bg-white/10 dark:hover:text-white/85"
          title={t('designRailClear')}
          aria-label={t('designRailClear')}
        >
          <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
        </button>
      </div>

      {/* Timeline */}
      <div ref={timelineRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto px-3 py-3">
        {blocks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-center">
            <div className="max-w-[240px]">
              <MessageSquare
                className="mx-auto h-8 w-8 text-[#c8d0d8] dark:text-white/20"
                strokeWidth={1.2}
              />
              <p className="mt-2 text-[13px] leading-5 text-[#8b95a3] dark:text-white/40">
                {t('designRailEmpty')}
              </p>
            </div>
          </div>
        ) : (
          blocks.map((block) => <MessageBubble key={block.id} block={block} />)
        )}
        {busy && (
          <div className="flex items-center gap-2 text-[12px] text-[#8b95a3] dark:text-white/45">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            {t('designRailThinking')}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 px-3 pb-3 pt-2">
        <div className="rounded-2xl border border-[var(--ds-sidebar-row-ring)] bg-white p-2 shadow-[0_4px_18px_rgba(20,47,95,0.08)] dark:bg-[#1f242c] dark:shadow-[0_4px_18px_rgba(0,0,0,0.3)]">
          <textarea
            data-design-rail-textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('designRailPlaceholder')}
            rows={2}
            disabled={busy}
            className="min-h-[44px] w-full resize-none rounded-md bg-transparent px-1 py-1 text-[13.5px] leading-snug text-[#1f2733] outline-none placeholder:text-[#9aa4b2] disabled:opacity-60 dark:text-white/90 dark:placeholder:text-white/30"
          />
          <div className="mt-1 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <FloatingComposerModelPicker
                compact
                mode="select"
                composerModel={assistantModel}
                composerProviderId={assistantProviderId}
                composerPickList={composerPickList}
                composerModelGroups={composerModelGroups}
                canChangeModel={composerPickList.length > 0}
                stretch={false}
                onComposerModelChange={(modelId, providerId) =>
                  setAssistantModel(modelId, providerId)
                }
                onConfigureProviders={() => onOpenSettings?.('providers')}
              />
            </div>
            <button
              type="button"
              onClick={handleSend}
              disabled={!canSend}
              aria-label={t('designRailSend') ?? 'Send'}
              title={t('designRailSend') ?? 'Send'}
              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-[#3b82d8] text-white transition-colors hover:bg-[#3577c4] disabled:cursor-not-allowed disabled:opacity-50"
            >
              <Send className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

const MessageBubble = memo(function MessageBubble({ block }: { block: DesignMessageBlock }) {
  const isUser = block.kind === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-3 py-2 text-[13px] leading-relaxed shadow-sm ${
          isUser
            ? 'bg-[#3b82d8] text-white'
            : 'bg-black/[0.04] text-[#1f2733] dark:bg-white/[0.06] dark:text-white/85'
        }`}
      >
        <div className="whitespace-pre-wrap break-words">{block.text}</div>
      </div>
    </div>
  )
})

export const DesignAIRail = memo(DesignAIRailInner)
