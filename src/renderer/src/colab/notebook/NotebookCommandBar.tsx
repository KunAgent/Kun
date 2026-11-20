import { useCallback, useRef, useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { Eraser, Keyboard, Loader2, Play, Plus, RotateCcw, Save, Square } from 'lucide-react'
import { useColabDismiss } from '../use-colab-dismiss'

const ghostButton =
  'inline-flex h-7 items-center gap-1.5 rounded-[8px] px-2.5 text-[12.5px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

const iconButton =
  'flex h-7 w-7 items-center justify-center rounded-[7px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

export function NotebookCommandBar({
  cellCount,
  hasCodeCells,
  hasRuntime,
  busy,
  kunBusy,
  dirty,
  saving,
  runningCellNumber,
  queueLength,
  onAddCode,
  onAddText,
  onRunAll,
  onInterrupt,
  onRestart,
  onClearOutputs,
  onSave
}: {
  cellCount: number
  hasCodeCells: boolean
  hasRuntime: boolean
  busy: boolean
  kunBusy: boolean
  dirty: boolean
  saving: boolean
  runningCellNumber: number | null
  queueLength: number
  onAddCode: () => void
  onAddText: () => void
  onRunAll: () => void
  onInterrupt: () => void
  onRestart: () => void
  onClearOutputs: () => void
  onSave: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const [shortcutsOpen, setShortcutsOpen] = useState(false)
  const shortcutsRef = useRef<HTMLDivElement>(null)
  const closeShortcuts = useCallback(() => setShortcutsOpen(false), [])
  useColabDismiss(shortcutsOpen, closeShortcuts, shortcutsRef)

  const shortcuts = [
    { keys: '⌘↵', label: t('colabNb.shortcutRunStay') },
    { keys: '⇧↵', label: t('colabNb.shortcutRunNext') },
    { keys: '⌘S', label: t('colabNb.shortcutSave') },
    { keys: '⌘J', label: t('colabNb.shortcutPanel') },
    { keys: 'Esc', label: t('colabNb.shortcutExitEdit') }
  ]

  return (
    <div
      data-colab-command-bar
      onMouseDown={(event) => event.stopPropagation()}
      className="pointer-events-none sticky top-0 z-10 pb-2.5 pt-3"
      style={{
        background:
          'linear-gradient(to bottom, color-mix(in srgb, var(--ds-surface-subtle) 35%, var(--ds-bg-main)) 72%, transparent)'
      }}
    >
      <div className="pointer-events-auto ml-[52px] flex flex-wrap items-center gap-0.5 rounded-[12px] border border-ds-border bg-ds-card p-1 shadow-[0_1px_2px_rgba(16,18,27,0.04),0_4px_14px_rgba(16,18,27,0.04)]">
        <button type="button" className={ghostButton} disabled={kunBusy} onClick={onAddCode}>
          <Plus className="h-3.5 w-3.5 text-ds-muted" aria-hidden="true" />
          <span>{t('colabNb.addCode')}</span>
        </button>
        <button type="button" className={ghostButton} disabled={kunBusy} onClick={onAddText}>
          <Plus className="h-3.5 w-3.5 text-ds-muted" aria-hidden="true" />
          <span>{t('colabNb.addText')}</span>
        </button>

        <span className="mx-1 h-4 w-px bg-ds-border" aria-hidden="true" />

        {busy ? (
          <button
            type="button"
            data-colab-cmd-interrupt
            title={t('colabNb.interruptHint')}
            onClick={onInterrupt}
            className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-red-500/10 px-2.5 text-[12.5px] font-medium text-red-600 transition hover:bg-red-500/15 dark:text-red-400"
          >
            <Square className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>{t('colabNb.interrupt')}</span>
          </button>
        ) : (
          <button
            type="button"
            data-colab-cmd-run-all
            disabled={kunBusy || !hasCodeCells}
            title={hasRuntime ? t('colabNb.runAll') : t('colabNb.needRuntime')}
            onClick={onRunAll}
            className="inline-flex h-7 items-center gap-1.5 rounded-[8px] bg-accent-tint/10 px-2.5 text-[12.5px] font-medium text-accent transition hover:bg-accent-tint/15 disabled:opacity-40"
          >
            <Play className="h-3 w-3 fill-current" aria-hidden="true" />
            <span>{t('colabNb.runAll')}</span>
          </button>
        )}

        <button
          type="button"
          className={iconButton}
          disabled={!hasRuntime}
          title={t('colabNb.restart')}
          aria-label={t('colabNb.restart')}
          onClick={onRestart}
        >
          <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        <button
          type="button"
          className={iconButton}
          disabled={kunBusy}
          title={t('colabNb.clearOutputs')}
          aria-label={t('colabNb.clearOutputs')}
          onClick={onClearOutputs}
        >
          <Eraser className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
        {dirty ? (
          <button
            type="button"
            className={iconButton}
            disabled={saving}
            title={t('colabNb.save')}
            aria-label={t('colabNb.save')}
            onClick={onSave}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
            ) : (
              <Save className="h-3.5 w-3.5" aria-hidden="true" />
            )}
          </button>
        ) : null}

        <div className="ml-auto flex items-center gap-2 pr-1 text-[11.5px] text-ds-faint">
          {busy ? (
            <span className="font-medium text-accent">
              {runningCellNumber != null
                ? t('colabNb.runningCellStatus', { num: runningCellNumber })
                : t('colabNb.statusKernelBusy')}
              {queueLength > 0 ? ` · ${t('colabNb.queuedCount', { count: queueLength })}` : ''}
            </span>
          ) : (
            <>
              <span>{t('colabNb.cellsCount', { count: cellCount })}</span>
              <kbd className="hidden rounded border border-ds-border bg-ds-surface-subtle px-1.5 py-[1px] font-mono text-[10.5px] text-ds-muted sm:inline-block">
                ⌘↵
              </kbd>
            </>
          )}

          <div ref={shortcutsRef} className="relative">
            <button
              type="button"
              data-colab-shortcuts-trigger
              aria-expanded={shortcutsOpen}
              aria-haspopup="dialog"
              aria-label={t('colabNb.shortcutsTitle')}
              title={t('colabNb.shortcutsTitle')}
              onClick={() => setShortcutsOpen((open) => !open)}
              className={`flex h-6 w-6 items-center justify-center rounded-[6px] transition ${
                shortcutsOpen
                  ? 'bg-accent-tint/10 text-accent'
                  : 'text-ds-faint hover:bg-ds-hover hover:text-ds-ink'
              }`}
            >
              <Keyboard className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
            {shortcutsOpen ? (
              <div
                role="dialog"
                data-colab-shortcuts-popover
                aria-label={t('colabNb.shortcutsTitle')}
                className="absolute right-0 top-full z-30 mt-2 w-60 rounded-[12px] border border-ds-border bg-ds-card p-3 text-[12px] shadow-xl"
              >
                <div className="mb-2 text-[11.5px] font-semibold text-ds-ink">
                  {t('colabNb.shortcutsTitle')}
                </div>
                <div className="space-y-1.5">
                  {shortcuts.map((item) => (
                    <div key={item.keys} className="flex items-center justify-between gap-3">
                      <span className="text-ds-muted">{item.label}</span>
                      <kbd className="shrink-0 rounded border border-ds-border bg-ds-surface-subtle px-1.5 py-0.5 font-mono text-[10.5px] text-ds-ink">
                        {item.keys}
                      </kbd>
                    </div>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  )
}
