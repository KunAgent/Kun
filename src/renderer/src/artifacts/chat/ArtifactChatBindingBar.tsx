import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Check, ChevronDown, ExternalLink } from 'lucide-react'
import { AgentIcon } from '../../components/agent-icon'
import { useChatStore } from '../../store/chat-store'
import { workAssistantHarnessId } from '../../write/work-assistant-agent'
import type { ArtifactChatBinding } from './artifact-chat-binding'

/** Which conversation the panel talks to, and the menu to switch it. */
export function ArtifactChatBindingBar({ binding, disabled, onUseSource, onStartFresh, onOpenInCode }: {
  binding: ArtifactChatBinding
  disabled: boolean
  onUseSource: () => void
  onStartFresh: () => void
  onOpenInCode: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  // Who answers: Kun, or the third-party Agent picked in the composer.
  const harnessId = useChatStore(workAssistantHarnessId)

  useEffect(() => {
    if (!open) return
    const close = (event: PointerEvent): void => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const escape = (event: KeyboardEvent): void => { if (event.key === 'Escape') setOpen(false) }
    window.addEventListener('pointerdown', close, true)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('pointerdown', close, true)
      window.removeEventListener('keydown', escape)
    }
  }, [open])

  const title = binding.thread?.title?.trim() || t('artifactChatBindingDraft')
  const caption = binding.kind === 'source' ? t('artifactChatBindingSource')
    : binding.kind === 'bound' ? t('artifactChatBindingBound') : t('artifactChatBindingFreshHint')
  const pick = (action: () => void): void => {
    setOpen(false)
    action()
  }
  return (
    <div ref={rootRef} className="relative mx-3.5 mt-2.5 shrink-0" data-artifact-chat-binding={binding.kind} data-artifact-chat-agent={harnessId}>
      <button type="button" onClick={() => setOpen((value) => !value)} disabled={disabled}
        aria-haspopup="menu" aria-expanded={open} aria-label={t('artifactChatBindingMenu')}
        className="flex h-[34px] w-full min-w-0 items-center gap-2 rounded-[10px] border border-ds-border-muted bg-ds-subtle px-2.5 text-left disabled:opacity-60">
        <AgentIcon harnessId={harnessId} size={16} />
        <span className="min-w-0 truncate text-[13px] font-semibold text-ds-ink">{title}</span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ds-muted">{caption}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-ds-muted" aria-hidden />
      </button>
      {open ? (
        <div role="menu" className="absolute left-0 right-0 top-[38px] z-30 flex flex-col gap-0.5 rounded-xl border border-ds-border bg-ds-card p-1.5 shadow-[0_12px_32px_rgba(24,24,27,0.16)]">
          {binding.source ? (
            <button type="button" role="menuitemradio" aria-checked={binding.kind === 'source'} onClick={() => pick(onUseSource)}
              className="flex gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-ds-hover">
              <span className="mt-0.5 w-3.5 shrink-0 text-accent">{binding.kind === 'source' ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}</span>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate text-[13px] font-semibold text-ds-ink">{binding.source.title}</span>
                <span className="text-[12px] text-ds-muted">{t('artifactChatBindingSourceHint')}</span>
              </span>
            </button>
          ) : null}
          <button type="button" role="menuitemradio" aria-checked={binding.kind !== 'source'} onClick={() => pick(onStartFresh)}
            className="flex gap-2.5 rounded-lg px-2.5 py-2 text-left hover:bg-ds-hover">
            <span className="mt-0.5 w-3.5 shrink-0 text-accent">{binding.kind !== 'source' ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}</span>
            <span className="flex min-w-0 flex-col gap-0.5">
              <span className="text-[13px] font-semibold text-ds-ink">{t('artifactChatBindingFreshTitle')}</span>
              <span className="text-[12px] text-ds-muted">{t('artifactChatBindingFreshHint')}</span>
            </span>
          </button>
          {binding.thread ? (
            <>
              <span aria-hidden className="mx-2 my-1 h-px bg-ds-border-muted" />
              <button type="button" role="menuitem" onClick={() => pick(onOpenInCode)}
                className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                <span className="w-3.5 shrink-0" />
                {t('artifactChatOpenInCode')}
                <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              </button>
            </>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
