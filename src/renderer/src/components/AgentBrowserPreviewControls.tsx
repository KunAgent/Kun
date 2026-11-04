import { useId, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, ArrowRight, Bot, Hand, MoreHorizontal, PanelRight, RefreshCw, Square, Trash2, X } from 'lucide-react'
import type { BrowserUseViewState } from '@shared/browser-use'
import type { useAgentBrowserPreviewFrame } from './use-agent-browser-preview-frame'

export type AgentBrowserPreviewActions = {
  onClose: () => void
  onDock?: () => void
  onToggleControl: () => void
  onNavigate: (command: 'back' | 'forward' | 'reload') => void
  onStop: () => void
  onClear: () => void
}

function Action({ label, children, ...props }: ComponentProps<'button'> & { label: string }) {
  return <button type="button" aria-label={label} title={label}
    className="grid size-6 shrink-0 place-items-center rounded-md text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-30"
    {...props}>{children}</button>
}

export function AgentBrowserPreviewControls({ state, attention, gestures, ...actions }: AgentBrowserPreviewActions & {
  state: BrowserUseViewState
  attention: boolean
  gestures: ReturnType<typeof useAgentBrowserPreviewFrame>
}) {
  const { t } = useTranslation('common')
  const hint = useId()
  const handle = useRef<HTMLButtonElement | null>(null)
  const [open, setOpen] = useState(false)
  const [more, setMore] = useState(false)
  const tab = state.tabs.find((item) => item.id === state.activeTabId) ?? state.tabs[0]
  const closeTools = () => { setOpen(false); setMore(false) }
  return <div className="group absolute right-2 top-0 z-[90]"
    onPointerEnter={() => setOpen(true)}
    onPointerLeave={(event) => {
      if (typeof document === 'undefined' || !event.currentTarget.contains(document.activeElement)) closeTools()
    }}
    onBlur={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) closeTools() }}
    onKeyDown={(event) => {
      if (event.key === 'Escape') { event.preventDefault(); handle.current?.focus(); closeTools() }
    }}>
    <button ref={handle} type="button" aria-label={t('browserUseMovePreview')} aria-describedby={hint}
      aria-expanded={open} title={t('browserUseMovePreviewHint')}
      className="grid size-6 touch-none cursor-grab place-items-center rounded-full active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
      onFocus={() => setOpen(true)}
      onPointerDown={(event) => gestures.begin(event)} {...gestures.pointerEvents}
      onKeyDown={gestures.keyDown}
      onClick={() => {
        if (gestures.suppressClick.current) { gestures.suppressClick.current = false; return }
        setOpen(true)
      }}>
      <span aria-hidden="true" className={`size-2 rounded-full ring-1 ring-white/60 ${
        attention || state.controlOwner === 'manual' ? 'bg-amber-500' : 'bg-black/25 dark:bg-white/35'
      }`} />
    </button>
    <span id={hint} className="sr-only">{t('browserUseMovePreviewHint')}</span>
    {open ? <div className="absolute bottom-full right-0 flex flex-col items-end gap-1 pb-1" data-browser-preview-tools>
      {more ? <div className="flex items-center gap-0.5 rounded-lg border border-ds-border bg-ds-card/95 p-0.5 shadow-lg backdrop-blur-xl">
        <Action label={t('browserBack')} disabled={!tab?.canGoBack} onClick={() => actions.onNavigate('back')}><ArrowLeft size={14} /></Action>
        <Action label={t('browserForward')} disabled={!tab?.canGoForward} onClick={() => actions.onNavigate('forward')}><ArrowRight size={14} /></Action>
        <Action label={t('browserReload')} disabled={!tab} onClick={() => actions.onNavigate('reload')}><RefreshCw size={14} /></Action>
        <span aria-hidden="true" className="mx-0.5 h-3 w-px bg-ds-border" />
        <Action label={t('browserUseStop')} onClick={actions.onStop}><Square size={13} /></Action>
        <Action label={t('browserUseClear')} onClick={actions.onClear}><Trash2 size={14} /></Action>
      </div> : null}
      <div className="flex items-center gap-0.5 rounded-lg border border-ds-border bg-ds-card/95 p-0.5 shadow-lg backdrop-blur-xl">
        {actions.onDock ? <Action label={t('browserUseDockPreview')} disabled={attention} onClick={actions.onDock}><PanelRight size={14} /></Action> : null}
        <Action label={t(state.controlOwner === 'manual' ? 'browserUseReturnControl' : 'browserUseTakeControl')}
          onClick={actions.onToggleControl}>{state.controlOwner === 'manual' ? <Bot size={14} /> : <Hand size={14} />}</Action>
        <Action label={t('browserUseMoreActions')} aria-expanded={more} onClick={() => setMore(!more)}><MoreHorizontal size={15} /></Action>
        <Action label={t('browserUseClosePreview')} onClick={actions.onClose}><X size={14} /></Action>
      </div>
    </div> : null}
  </div>
}
