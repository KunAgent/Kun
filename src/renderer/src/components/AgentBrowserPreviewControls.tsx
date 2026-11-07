import { useId, useRef, useState, type ComponentProps } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft, ArrowRight, Bot, Globe2, GripVertical, Hand, Maximize2, Minimize2,
  Minus, MoreHorizontal, PanelRight, RefreshCw, Square, Trash2
} from 'lucide-react'
import type { BrowserUseViewState } from '@shared/browser-use'
import type { useAgentBrowserPreviewFrame } from './use-agent-browser-preview-frame'
import { browserPreviewStatusKey } from './agent-browser-preview-status'

export type AgentBrowserPreviewActions = {
  onClose: () => void
  onDock?: () => void
  onToggleControl: () => void
  onNavigate: (command: 'back' | 'forward' | 'reload') => void
  onZoom: (zoomPercent: number) => void
  onStop: () => void
  onClear: () => void
  pendingOperation?: 'action' | 'stop'
  operationError?: string
}

function Action({ label, children, ...props }: ComponentProps<'button'> & { label: string }) {
  return <button type="button" aria-label={label} title={label}
    className="inline-flex h-8 min-w-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-1.5 text-[11px] font-medium text-ds-muted hover:bg-ds-hover hover:text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35"
    {...props}>{children}</button>
}

export function AgentBrowserPreviewControls({ state, attention, gestures, expanded, onToggleExpanded, ...actions }: AgentBrowserPreviewActions & {
  state: BrowserUseViewState
  attention: boolean
  gestures: ReturnType<typeof useAgentBrowserPreviewFrame>
  expanded: boolean
  onToggleExpanded: () => void
}) {
  const { t } = useTranslation('common')
  const hint = useId()
  const moreButton = useRef<HTMLButtonElement | null>(null)
  const [more, setMore] = useState(false)
  const tab = state.tabs.find((item) => item.id === state.activeTabId) ?? state.tabs[0]
  const compact = gestures.frame.width < 600
  const manual = state.controlOwner === 'manual'
  const consent = Boolean(state.pendingOriginConsent || state.pendingActionConsent)
  const busy = Boolean(actions.pendingOperation)
  const stopped = state.lifecycle === 'stopped'
  const disabled = busy || consent || stopped
  const zoom = tab?.zoomPercent ?? 100
  const zoomOptions = [...new Set([50, 67, 80, 90, 100, 110, 125, 150, 175, 200, zoom])].sort((a, b) => a - b)
  const expandLabel = t(expanded ? 'browserUseRestorePreview' : 'browserUseExpandPreview')
  return <div className="absolute inset-x-0 top-0 z-[90] rounded-t-xl bg-ds-card" data-browser-preview-tools
    onKeyDown={(event) => {
      if (event.key === 'Escape' && more) { event.preventDefault(); setMore(false); moreButton.current?.focus() }
    }}>
    <div className="flex h-11 items-center gap-1 border-b border-ds-border-muted px-2">
      <button type="button" aria-label={t('browserUseMovePreview')} aria-describedby={hint}
        title={t('browserUseMovePreviewHint')} disabled={expanded}
        className="flex h-8 min-w-0 flex-1 touch-none items-center gap-1.5 rounded-md text-left text-ds-muted cursor-grab active:cursor-grabbing focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:cursor-default"
        onPointerDown={(event) => gestures.begin(event)} {...gestures.pointerEvents} onKeyDown={gestures.keyDown}>
        <GripVertical size={14} className="shrink-0" /><Globe2 size={16} className="shrink-0" />
        <span className="min-w-0">
          <span className="block truncate text-[11px] font-semibold text-ds-ink">{t('browserUseFloatingTitle')}</span>
          <span className="block truncate text-[10px]">{t(browserPreviewStatusKey(state, actions.operationError))}</span>
        </span>
      </button>
      <span id={hint} className="sr-only">{t('browserUseMovePreviewHint')}</span>
      <Action label={t(manual ? 'browserUseReturnControl' : 'browserUseTakeControl')}
        disabled={disabled} onClick={actions.onToggleControl}>
        {manual ? <Bot size={15} /> : <Hand size={15} />}
        <span>{t(manual ? 'browserUseReturnControl' : 'browserUseTakeControl')}</span>
      </Action>
      <Action label={t('browserUseStop')} disabled={actions.pendingOperation === 'stop' || stopped} onClick={actions.onStop}>
        <Square size={14} /><span className={compact ? 'sr-only' : ''}>{t('browserUseStop')}</span>
      </Action>
      {!compact && actions.onDock ? <Action label={t('browserUseDockPreview')} disabled={attention || busy} onClick={actions.onDock}><PanelRight size={16} /></Action> : null}
      {!compact ? <Action label={expandLabel} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</Action> : null}
      <button ref={moreButton} type="button" aria-label={t('browserUseMoreActions')} title={t('browserUseMoreActions')}
        aria-expanded={more} onClick={() => setMore(!more)}
        className="grid size-8 shrink-0 place-items-center rounded-md text-ds-muted hover:bg-ds-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
        <MoreHorizontal size={17} />
      </button>
      <Action label={t('browserUseClosePreview')} disabled={consent} onClick={actions.onClose}><Minus size={16} /></Action>
    </div>
    <div className="flex h-11 items-center gap-1 border-b border-ds-border-muted px-2">
      <Action label={t('browserBack')} disabled={disabled || !tab?.canGoBack} onClick={() => actions.onNavigate('back')}><ArrowLeft size={16} /></Action>
      <Action label={t('browserForward')} disabled={disabled || !tab?.canGoForward} onClick={() => actions.onNavigate('forward')}><ArrowRight size={16} /></Action>
      <Action label={t('browserReload')} disabled={disabled || !tab} onClick={() => actions.onNavigate('reload')}><RefreshCw size={15} className={tab?.loading ? 'animate-spin motion-reduce:animate-none' : ''} /></Action>
      {more ? <div className="ml-auto flex min-w-0 items-center gap-1" role="group" aria-label={t('browserUseMoreActions')}>
        {compact && actions.onDock ? <Action label={t('browserUseDockPreview')} disabled={attention || busy} onClick={actions.onDock}><PanelRight size={16} /></Action> : null}
        {compact ? <Action label={expandLabel} onClick={onToggleExpanded}>{expanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}</Action> : null}
        <Action label={t('browserUseClear')} disabled={busy || consent} onClick={() => { setMore(false); actions.onClear() }}><Trash2 size={15} /><span>{t('browserUseClear')}</span></Action>
      </div> : <>
        <div className="min-w-0 flex-1 truncate rounded-md bg-ds-surface-subtle px-2 py-1.5 text-[11px] text-ds-muted" title={tab?.sanitizedUrl || tab?.origin}>
          {tab?.origin || t('browserUseTemporaryAnonymous')}
        </div>
        <label className="flex shrink-0 items-center gap-1 text-[10px] text-ds-muted" title={t('browserUsePageZoomHint')}>
          {!compact ? t('browserUsePageZoom') : null}
          <select aria-label={t('browserUsePageZoom')} value={zoom} disabled={disabled || !tab}
            onChange={(event) => actions.onZoom(Number(event.target.value))}
            className="h-8 rounded-md border border-ds-border-muted bg-ds-card px-1 text-[11px] text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent disabled:opacity-35">
            {zoomOptions.map((value) => <option key={value} value={value}>{value}%</option>)}
          </select>
        </label>
      </>}
    </div>
  </div>
}
