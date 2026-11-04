import { useRef, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { BrowserUseViewState } from '@shared/browser-use'
import { AgentBrowserPreviewControls, type AgentBrowserPreviewActions } from './AgentBrowserPreviewControls'
import { BROWSER_PREVIEW_CHROME, BROWSER_PREVIEW_RADIUS, type BrowserPreviewFrame, type BrowserPreviewResizeDirection } from './agent-browser-preview-layout'
import { browserUsePreviewNeedsAttention } from './agent-browser-preview-state'
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

export function AgentBrowserPreviewShell({ state, children, ...actions }: AgentBrowserPreviewActions & {
  state: BrowserUseViewState
  children: (frame: BrowserPreviewFrame) => ReactNode
}) {
  const { t } = useTranslation('common')
  const canvas = useRef<HTMLDivElement | null>(null)
  const gestures = useAgentBrowserPreviewFrame(canvas, state, true)
  const { frame, ready } = gestures
  const attention = browserUsePreviewNeedsAttention(state, state.threadId ?? null)
  return <div ref={canvas} className="pointer-events-none absolute inset-0 z-[80]" data-browser-preview-canvas>
    {ready ? <section aria-label={t('browserUseFloatingTitle')} data-browser-preview-frame
      className="ds-no-drag pointer-events-none absolute select-none"
      style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height, borderRadius: BROWSER_PREVIEW_RADIUS }}>
      <div className={`absolute inset-0 rounded-xl border bg-ds-card shadow-[0_20px_55px_rgba(0,0,0,0.25)] ${
        attention ? 'border-amber-400/70' : 'border-ds-border'
      }`} />
      <div className="pointer-events-auto absolute inset-x-0 bottom-0" style={{ top: BROWSER_PREVIEW_CHROME }}>
        {children(frame)}
      </div>
      <div className="pointer-events-auto">
        <AgentBrowserPreviewControls state={state} attention={attention} gestures={gestures} {...actions} />
      </div>
      {handles.map(([direction, className]) => <div key={direction} role="presentation"
        title={t('browserUseResizePreview')} data-browser-preview-resize={direction}
        className={`pointer-events-auto absolute z-[90] touch-none ${className}`}
        onPointerDown={(event) => gestures.begin(event, direction)} {...gestures.pointerEvents} />)}
    </section> : null}
  </div>
}
