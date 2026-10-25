import { ArrowUp, Check, CornerDownRight, MessageSquareText, Type, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'

export type ElementPickBarRect = {
  left: number
  top: number
  width: number
  height: number
}

export type ElementPickTextEditor = {
  value: string
  tagName: string
  statusKind: 'idle' | 'saving' | 'saved' | 'error'
  statusMessage?: string
  changed: boolean
  onChange: (value: string) => void
  onReset: () => void
  onSave: () => void
}

type HtmlFrameElementPickBarProps = {
  label: string
  path: string[]
  rect: ElementPickBarRect
  zoom: number
  screenWidth: number
  screenHeight: number
  canSelectParent: boolean
  canDrillToHit: boolean
  canEditText: boolean
  textEditorOpen: boolean
  editor: ElementPickTextEditor
  onAskKun: () => void
  onSelectParent: () => void
  onSelectHit: () => void
  onToggleTextEditor: () => void
  onClear: () => void
}

const BAR_WIDTH = 268
const BAR_HEIGHT = 74
const EDGE = 8

export function htmlFrameElementPickBarPosition({
  rect,
  zoom,
  screenWidth,
  screenHeight
}: {
  rect: ElementPickBarRect
  zoom: number
  screenWidth: number
  screenHeight: number
}): { left: number; top: number } {
  const left = Math.min(
    Math.max(EDGE, rect.left * zoom),
    Math.max(EDGE, screenWidth - BAR_WIDTH - EDGE)
  )
  const below = (rect.top + rect.height) * zoom + EDGE
  const above = rect.top * zoom - BAR_HEIGHT - EDGE
  const top = below + BAR_HEIGHT <= screenHeight - EDGE
    ? below
    : Math.max(EDGE, Math.min(above, screenHeight - BAR_HEIGHT - EDGE))
  return { left, top }
}

/**
 * Floating actions for a picked component. It deliberately exposes only the
 * actions the product actually supports: hand the reference to Kun, walk up the
 * DOM path, drill into the clicked node, or edit plain text in place.
 */
export function HtmlFrameElementPickBar({
  label,
  path,
  rect,
  zoom,
  screenWidth,
  screenHeight,
  canSelectParent,
  canDrillToHit,
  canEditText,
  textEditorOpen,
  editor,
  onAskKun,
  onSelectParent,
  onSelectHit,
  onToggleTextEditor,
  onClear
}: HtmlFrameElementPickBarProps): React.JSX.Element {
  const { t } = useTranslation('common')
  const position = htmlFrameElementPickBarPosition({ rect, zoom, screenWidth, screenHeight })
  const buttonClass =
    'pointer-events-auto inline-flex h-6 items-center gap-1 rounded-[5px] px-1.5 text-[11px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40'
  const stop = (event: React.SyntheticEvent): void => {
    event.stopPropagation()
  }
  return (
    <div
      className="absolute z-20 rounded-[8px] border border-ds-border bg-white/97 p-1.5 shadow-[0_14px_34px_rgba(15,23,42,0.18)] backdrop-blur dark:bg-[#171b22]/97"
      style={{ left: position.left, top: position.top, width: BAR_WIDTH }}
      role="toolbar"
      aria-label={t('canvasElementPickToolbar')}
      onPointerDown={stop}
      onPointerMove={stop}
      onDoubleClick={stop}
      data-canvas-element-pick-bar="true"
    >
      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[11px] font-semibold leading-4 text-ds-ink">{label}</div>
          {path.length > 0 ? (
            <div className="truncate text-[10px] leading-3.5 text-ds-faint">{path.join(' / ')}</div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClear}
          title={t('canvasElementClear')}
          aria-label={t('canvasElementClear')}
          className="pointer-events-auto -mr-0.5 -mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink"
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      </div>
      <div className="mt-1 flex flex-wrap items-center gap-1">
        <button
          type="button"
          onClick={onAskKun}
          className="pointer-events-auto inline-flex h-6 items-center gap-1 rounded-[5px] bg-accent px-2 text-[11px] font-semibold text-white transition hover:opacity-90"
        >
          <MessageSquareText className="h-3 w-3" strokeWidth={2} />
          {t('canvasElementAskKun')}
        </button>
        <button
          type="button"
          onClick={onSelectParent}
          disabled={!canSelectParent}
          className={buttonClass}
        >
          <ArrowUp className="h-3 w-3" strokeWidth={2} />
          {t('canvasElementSelectParent')}
        </button>
        {canDrillToHit ? (
          <button type="button" onClick={onSelectHit} className={buttonClass}>
            <CornerDownRight className="h-3 w-3" strokeWidth={2} />
            {t('canvasElementSelectChild')}
          </button>
        ) : null}
        {canEditText ? (
          <button
            type="button"
            onClick={onToggleTextEditor}
            aria-pressed={textEditorOpen}
            className={`${buttonClass} ${textEditorOpen ? 'bg-accent-soft text-accent hover:bg-accent-soft hover:text-accent' : ''}`}
          >
            <Type className="h-3 w-3" strokeWidth={2} />
            {t('canvasElementEditText')}
          </button>
        ) : null}
      </div>
      {textEditorOpen ? (
        <div
          className="pointer-events-auto mt-2 border-t border-ds-border pt-2"
          onPointerDown={stop}
          onDoubleClick={stop}
          data-canvas-element-text-editor="true"
        >
          <textarea
            value={editor.value}
            onChange={(event) => editor.onChange(event.target.value)}
            className="h-16 w-full resize-none rounded-[6px] border border-ds-border bg-ds-hover/20 px-2 py-1.5 text-[11.5px] leading-4 text-ds-ink outline-none transition focus:border-accent/50 focus:bg-white dark:bg-white/5 dark:focus:bg-white/10"
            aria-label={t('canvasElementEditText')}
            spellCheck
          />
          <div className="mt-1.5 flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1 truncate text-[10.5px] text-ds-faint">
              {editor.statusKind === 'error'
                ? editor.statusMessage
                : editor.statusKind === 'saved'
                  ? t('canvasElementTextSaved')
                  : editor.tagName.toLowerCase()}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <button
                type="button"
                title={t('canvasElementTextReset')}
                aria-label={t('canvasElementTextReset')}
                onClick={editor.onReset}
                disabled={editor.statusKind === 'saving' || !editor.changed}
                className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-40"
              >
                <X className="h-3.5 w-3.5" strokeWidth={1.8} />
              </button>
              <button
                type="button"
                title={t('canvasElementTextSave')}
                aria-label={t('canvasElementTextSave')}
                onClick={editor.onSave}
                disabled={editor.statusKind === 'saving' || !editor.changed}
                className="pointer-events-auto flex h-6 w-6 items-center justify-center rounded-[6px] bg-accent text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Check className="h-3.5 w-3.5" strokeWidth={2} />
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}
