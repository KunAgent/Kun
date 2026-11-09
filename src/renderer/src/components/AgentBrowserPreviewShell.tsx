import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { Maximize2, PanelRight, ShieldCheck } from 'lucide-react'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserPreviewControls, type AgentBrowserPreviewActions } from './AgentBrowserPreviewControls'
import {
  BROWSER_PREVIEW_CHROME, BROWSER_PREVIEW_FOOTER, BROWSER_PREVIEW_MIN_WIDTH, BROWSER_PREVIEW_RADIUS,
  BROWSER_PREVIEW_TITLEBAR, BROWSER_PREVIEW_NAVBAR, type BrowserPreviewFrame, type BrowserPreviewResizeDirection
} from './agent-browser-preview-layout'
import { browserUsePreviewNeedsAttention } from './agent-browser-preview-state'
import { browserPreviewStatusKey } from './agent-browser-preview-status'
import { useAgentBrowserPreviewFrame } from './use-agent-browser-preview-frame'

const handles: Array<[BrowserPreviewResizeDirection, string]> = [
  ['n', '-top-2 left-3 right-3 h-2 cursor-ns-resize'],
  ['s', '-bottom-2 left-3 right-3 h-2 cursor-ns-resize'],
  ['e', '-right-2 bottom-3 top-3 w-2 cursor-ew-resize'],
  ['w', '-left-2 bottom-3 top-3 w-2 cursor-ew-resize'],
  ['ne', '-right-2 -top-2 size-3 cursor-nesw-resize'],
  ['nw', '-left-2 -top-2 size-3 cursor-nwse-resize'],
  ['se', '-bottom-2 -right-2 size-3 cursor-nwse-resize'],
  ['sw', '-bottom-2 -left-2 size-3 cursor-nesw-resize']
]

export function AgentBrowserPreviewShell({ state, children, collapsed = false, occluded = false, overlay, ...actions }: AgentBrowserPreviewActions & {
  state: BrowserUseViewState
  collapsed?: boolean
  occluded?: boolean
  overlay?: ReactNode
  children: (frame: BrowserPreviewFrame, visible: boolean) => ReactNode
}) {
  const { t } = useTranslation('common')
  const canvas = useRef<HTMLDivElement | null>(null)
  const [expanded, setExpanded] = useState(false)
  const gestures = useAgentBrowserPreviewFrame(canvas, state, true, expanded)
  const { frame, ready } = gestures
  const usable = frame.width >= BROWSER_PREVIEW_MIN_WIDTH && frame.height >= BROWSER_PREVIEW_CHROME + 300
  const attention = browserUsePreviewNeedsAttention(state, state.threadId ?? null)
  const consent = Boolean(state.pendingOriginConsent || state.pendingActionConsent)
  const cramped = frame.width < 360 || frame.height < 240
  useEffect(() => { if (ready && consent && !usable) setExpanded(true) }, [ready, consent, usable])
  const content = <div ref={canvas} className={`pointer-events-none inset-0 z-[80] ${expanded ? 'fixed' : 'absolute'}`} data-browser-preview-canvas>
    {ready ? <section aria-label={collapsed ? undefined : t('browserUseFloatingTitle')} aria-hidden={collapsed || occluded}
      data-browser-preview-frame data-browser-preview-expanded={expanded}
      className="ds-no-drag pointer-events-none absolute select-none rounded-xl border bg-ds-card shadow-[0_20px_55px_rgba(0,0,0,0.25)] border-ds-border-strong"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height,
        borderRadius: BROWSER_PREVIEW_RADIUS, visibility: collapsed || occluded ? 'hidden' : 'visible' }}>
      <div className="pointer-events-auto absolute inset-x-0"
        style={{ top: cramped && !consent ? 0 : BROWSER_PREVIEW_TITLEBAR + BROWSER_PREVIEW_NAVBAR, bottom: cramped && !consent ? 0 : BROWSER_PREVIEW_FOOTER, minHeight: 1 }}>
        {children(frame, !collapsed && !occluded && (usable || consent) && !overlay)}
        {!usable && !collapsed && !consent ? <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 overflow-auto bg-ds-card p-4 text-center">
          {!cramped ? <p className="max-w-xs text-xs leading-5 text-ds-muted">{t('browserUsePreviewTooSmall')}</p> : null}
          <div className="flex flex-wrap justify-center gap-2">
            <button type="button" onClick={() => setExpanded(!expanded)}
              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-ds-border-strong px-3 text-xs text-ds-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <Maximize2 size={14} />{t(expanded ? 'browserUseRestorePreview' : 'browserUseExpandPreview')}
            </button>
            {cramped ? <button type="button" onClick={actions.onStop} disabled={state.lifecycle === 'stopped' || actions.pendingOperation === 'stop'}
              className="min-h-8 rounded-md border border-ds-border px-3 text-xs text-ds-ink disabled:opacity-35">{t('browserUseStop')}</button> : null}
            {actions.onDock ? <button type="button" disabled={Boolean(state.pendingOriginConsent || state.pendingActionConsent)} onClick={actions.onDock}
              className="inline-flex min-h-8 items-center gap-2 rounded-md border border-ds-border-strong px-3 text-xs text-ds-ink disabled:opacity-35 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
              <PanelRight size={14} />{t('browserUseDockPreview')}
            </button> : null}
          </div>
        </div> : null}
        {overlay}
      </div>
      {!cramped || consent ? <div className="pointer-events-auto">
        <AgentBrowserPreviewControls state={state} attention={attention} gestures={gestures} expanded={expanded}
          onToggleExpanded={() => setExpanded(!expanded)} {...actions} />
      </div> : null}
      {!cramped ? <footer className="absolute inset-x-0 bottom-0 flex h-8 items-center gap-1.5 rounded-b-xl border-t border-ds-border-muted px-3 text-[10px] text-ds-muted">
        <ShieldCheck size={12} className="shrink-0" />
        <span className="min-w-0 flex-1 truncate" title={actions.operationError || state.reason} aria-live="polite">
          {t(browserPreviewStatusKey(state, actions.operationError))}
        </span>
        {usable ? <span className="shrink-0 tabular-nums">{frame.width - 2} × {frame.height - BROWSER_PREVIEW_CHROME} · 16:10</span> : null}
      </footer> : null}
      {!expanded && !collapsed ? handles.map(([direction, className]) => <div key={direction} role="presentation"
        title={t('browserUseResizePreview')} data-browser-preview-resize={direction}
        className={`pointer-events-auto absolute z-[90] touch-none ${className}`}
        onPointerDown={(event) => gestures.begin(event, direction)} {...gestures.pointerEvents} />) : null}
    </section> : null}
  </div>
  return expanded && typeof document !== 'undefined' ? createPortal(content, document.body) : content
}
