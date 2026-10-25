import { ChevronDown, SquareTerminal, TextSelect, X } from 'lucide-react'
import { useEffect, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { TerminalOutputDisplay } from '../../lib/terminal-output-attachment'

/** Composer chip for terminal output sent from the dock; expands to a preview. */
export function TerminalOutputChip({
  id,
  label,
  output,
  onRemove
}: {
  id: string
  label: string
  output: TerminalOutputDisplay
  onRemove?: (id: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const failed = typeof output.exitCode === 'number' && output.exitCode !== 0

  useEffect(() => {
    if (!expanded) return
    const close = (event: PointerEvent): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      setExpanded(false)
    }
    const closeWithKeyboard = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setExpanded(false)
    }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', closeWithKeyboard)
    return () => {
      document.removeEventListener('pointerdown', close)
      document.removeEventListener('keydown', closeWithKeyboard)
    }
  }, [expanded])

  const Icon = output.source === 'selection' ? TextSelect : SquareTerminal
  return (
    <div
      ref={rootRef}
      data-terminal-output-chip
      className={`ds-no-drag relative inline-flex max-w-full items-center rounded-lg border border-ds-border bg-ds-card text-[12px] shadow-sm ${expanded ? 'h-auto w-full flex-wrap' : 'h-8'}`}
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-l-lg pl-2 pr-1 text-left hover:bg-ds-hover"
        onClick={() => setExpanded((current) => !current)}
        title={t('termDockChipExpand')}
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.9} />
        <span className={`max-w-56 truncate text-ds-ink ${output.command ? 'font-mono text-[11.5px]' : 'font-medium'}`}>
          {output.command ?? label}
        </span>
        {typeof output.exitCode === 'number' ? (
          <span className={`shrink-0 ${failed ? 'text-[var(--ds-danger)]' : 'text-ds-muted'}`}>
            {t('termDockExitCode', { code: output.exitCode })}
          </span>
        ) : null}
        <span className="shrink-0 text-ds-muted">· {t('termDockLineCount', { lines: output.lineCount })}</span>
        <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-ds-muted transition ${expanded ? 'rotate-180' : ''}`} />
      </button>
      {onRemove ? (
        <button
          type="button"
          className="mr-1 rounded-md p-1 text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
          aria-label={t('composerRemoveContext')}
          title={t('composerRemoveContext')}
          onClick={() => onRemove(id)}
        >
          <X className="h-3 w-3" strokeWidth={2} />
        </button>
      ) : null}
      {expanded ? (
        <div role="dialog" aria-label={t('termDockChipPreview')} className="w-full basis-full border-t border-ds-border-muted text-left">
          <pre className="max-h-56 overflow-auto whitespace-pre px-3 py-2.5 font-mono text-[11.5px] leading-[18px] text-ds-ink">
            {output.preview.join('\n')}
          </pre>
          <p className="border-t border-ds-border-muted px-3 py-1.5 text-[11.5px] text-ds-muted">{t('termDockChipNote')}</p>
        </div>
      ) : null}
    </div>
  )
}
