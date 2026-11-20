import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Code2,
  Loader2,
  Play,
  Sparkles,
  Square,
  Trash2,
  Type
} from 'lucide-react'
import type { ColabNotebookOutput } from '@shared/colab/colab-notebook-types'
import { PassiveAssistantMarkdown } from '../../components/chat/PassiveAssistantMarkdown'
import { renderStreamText, type NotebookCell } from './ipynb-format'
import { useColabNotebookStore } from './colab-notebook-store'
import { highlightPythonCode } from './python-highlight'

const FOLD_LINE_LIMIT = 16

const headerToolButton =
  'flex h-6 w-6 items-center justify-center rounded-[6px] text-ds-faint transition hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40 disabled:hover:bg-transparent'

function formatDurationShort(ms: number): string {
  if (ms < 1000) return `${Math.max(0.1, Math.round(ms / 100) / 10).toFixed(1)}s`
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`
  const mins = Math.floor(ms / 60_000)
  const secs = Math.round((ms % 60_000) / 1000)
  return `${mins}m ${secs}s`
}

function AutoTextarea({
  value,
  placeholder,
  autoFocus,
  onChange,
  onKeyDown,
  onFocus,
  mono,
  readOnly = false
}: {
  value: string
  placeholder: string
  autoFocus?: boolean
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
  mono: boolean
  readOnly?: boolean
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  const highlighted = useMemo(
    () => (mono && value ? highlightPythonCode(value) : null),
    [mono, value]
  )
  const lineNumbers = useMemo(() => {
    if (!mono) return ''
    const count = value ? value.split('\n').length : 1
    const nums: string[] = []
    for (let i = 1; i <= count; i += 1) nums.push(String(i))
    return nums.join('\n')
  }, [mono, value])

  useEffect(() => {
    if (mono) return
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [mono, value])

  useEffect(() => {
    if (autoFocus) ref.current?.focus()
  }, [autoFocus])

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (mono && event.key === 'Tab' && !event.metaKey && !event.ctrlKey && !event.altKey) {
      event.preventDefault()
      const el = event.currentTarget
      const start = el.selectionStart ?? value.length
      const end = el.selectionEnd ?? value.length
      if (event.shiftKey) {
        const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1
        const leading = /^ {1,4}/.exec(value.slice(lineStart))?.[0].length ?? 0
        if (leading > 0) {
          const next = value.slice(0, lineStart) + value.slice(lineStart + leading)
          onChange(next)
          requestAnimationFrame(() => {
            el.selectionStart = Math.max(lineStart, start - leading)
            el.selectionEnd = Math.max(lineStart, end - leading)
          })
        }
      } else {
        const next = value.slice(0, start) + '    ' + value.slice(end)
        onChange(next)
        requestAnimationFrame(() => {
          el.selectionStart = start + 4
          el.selectionEnd = start + 4
        })
      }
      return
    }
    onKeyDown(event)
  }

  if (mono) {
    return (
      <div className="flex py-2.5 font-mono text-[12.5px] leading-[1.7]">
        <div
          aria-hidden="true"
          data-cell-line-numbers
          className="w-[38px] shrink-0 select-none whitespace-pre pr-3 text-right text-ds-faint opacity-70"
        >
          {lineNumbers}
        </div>
        <div className="min-w-0 flex-1 overflow-x-auto pr-3.5">
          <div className="grid w-max min-w-full">
            <pre
              aria-hidden="true"
              className="pointer-events-none col-start-1 row-start-1 m-0 min-h-[1.7em] whitespace-pre font-mono text-[12.5px] leading-[1.7] text-ds-ink"
            >
              {highlighted ?? '\u200b'}
            </pre>
            <textarea
              ref={ref}
              value={value}
              spellCheck={false}
              placeholder={placeholder}
              rows={1}
              wrap="off"
              readOnly={readOnly}
              onChange={(event) => onChange(event.target.value)}
              onKeyDown={handleKeyDown}
              onFocus={onFocus}
              className={`col-start-1 row-start-1 block h-full w-full resize-none overflow-hidden whitespace-pre bg-transparent font-mono text-[12.5px] leading-[1.7] outline-none selection:bg-accent-tint/20 placeholder:text-ds-faint ${
                highlighted ? 'text-transparent caret-ds-ink' : 'text-ds-ink'
              }`}
            />
          </div>
        </div>
      </div>
    )
  }

  return (
    <textarea
      ref={ref}
      value={value}
      spellCheck={false}
      placeholder={placeholder}
      rows={1}
      readOnly={readOnly}
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={onFocus}
      className="block w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-relaxed text-ds-ink outline-none placeholder:text-ds-faint"
    />
  )
}

function OutputView({ output }: { output: ColabNotebookOutput }): ReactElement {
  if (output.type === 'image') {
    return (
      <img
        alt=""
        src={`data:image/png;base64,${output.data}`}
        className="my-1 max-w-full rounded-lg border border-ds-border bg-white"
      />
    )
  }
  if (output.type === 'error') {
    return (
      <pre className="my-1 whitespace-pre-wrap break-words rounded-lg bg-red-500/[0.06] px-3 py-2 font-mono text-[12px] leading-relaxed text-red-600 dark:text-red-400">
        {output.traceback.trim() || `${output.ename}: ${output.evalue}`}
      </pre>
    )
  }
  return (
    <pre
      className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] ${
        output.name === 'stderr' ? 'text-amber-700 dark:text-amber-400' : 'text-ds-ink'
      }`}
    >
      {renderStreamText(output.text)}
    </pre>
  )
}

export const ColabNotebookCell = memo(function ColabNotebookCell({
  cell,
  index,
  total,
  selected,
  running,
  queued,
  canRun,
  kunChanged = false,
  onRun
}: {
  cell: NotebookCell
  index: number
  total: number
  selected: boolean
  running: boolean
  queued: boolean
  canRun: boolean
  kunChanged?: boolean
  onRun: (id: string, advance: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const selectCell = useColabNotebookStore((s) => s.selectCell)
  const updateCellSource = useColabNotebookStore((s) => s.updateCellSource)
  const setCellKind = useColabNotebookStore((s) => s.setCellKind)
  const deleteCell = useColabNotebookStore((s) => s.deleteCell)
  const moveCell = useColabNotebookStore((s) => s.moveCell)
  const askKunAboutCell = useColabNotebookStore((s) => s.askKunAboutCell)
  const interrupt = useColabNotebookStore((s) => s.interrupt)
  const setSidePanelTab = useColabNotebookStore((s) => s.setSidePanelTab)
  const kunBusy = useColabNotebookStore((s) => s.kunBusy)
  const runningStartedAt = useColabNotebookStore((s) => s.runningStartedAt)
  const durationMs = useColabNotebookStore((s) => s.cellDurationsMs[cell.id])

  const isCode = cell.kind === 'code'
  const showMarkdownEditor = !isCode && (selected || !cell.source.trim())
  const lineCount = useMemo(
    () => (cell.source ? cell.source.split('\n').length : 1),
    [cell.source]
  )
  const [expanded, setExpanded] = useState(() => !isCode || lineCount <= FOLD_LINE_LIMIT)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!running) return
    setNow(Date.now())
    const timer = setInterval(() => setNow(Date.now()), 200)
    return () => clearInterval(timer)
  }, [running])

  const isFolded = isCode && !expanded && lineCount > FOLD_LINE_LIMIT
  const remainingLines = Math.max(0, lineCount - FOLD_LINE_LIMIT)
  const runningSeconds =
    running && runningStartedAt != null
      ? Math.max(0, (now - runningStartedAt) / 1000).toFixed(1)
      : '0.0'

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.currentTarget.blur()
      selectCell(null)
      return
    }
    if (event.key === 'Enter' && (event.shiftKey || event.metaKey || event.ctrlKey)) {
      event.preventDefault()
      onRun(cell.id, event.shiftKey)
    }
  }

  const counter = running
    ? '[*]'
    : queued
      ? '[…]'
      : cell.executionCount != null
        ? `[${cell.executionCount}]`
        : '[ ]'

  const cellTools = (
    <div
      className={`ml-auto flex items-center gap-0.5 transition-opacity ${
        selected || running ? 'opacity-100' : 'opacity-0 group-hover/cell:opacity-100 focus-within:opacity-100'
      }`}
    >
      {isCode ? (
        running ? (
          <button
            type="button"
            className="flex h-6 w-6 items-center justify-center rounded-[6px] text-red-600 transition hover:bg-red-500/10 dark:text-red-400"
            title={t('colabNb.interrupt')}
            aria-label={t('colabNb.interrupt')}
            onClick={(event) => {
              event.stopPropagation()
              void interrupt()
            }}
          >
            <Square className="h-3 w-3 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            className={headerToolButton}
            disabled={!canRun}
            title={t('colabNb.runCell')}
            aria-label={t('colabNb.runCell')}
            onClick={(event) => {
              event.stopPropagation()
              onRun(cell.id, false)
            }}
          >
            <Play className="h-3 w-3 fill-current" />
          </button>
        )
      ) : null}
      <button
        type="button"
        className={headerToolButton}
        disabled={index === 0 || kunBusy}
        title={t('colabNb.moveUp')}
        aria-label={t('colabNb.moveUp')}
        onClick={(event) => {
          event.stopPropagation()
          moveCell(cell.id, -1)
        }}
      >
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={headerToolButton}
        disabled={index === total - 1 || kunBusy}
        title={t('colabNb.moveDown')}
        aria-label={t('colabNb.moveDown')}
        onClick={(event) => {
          event.stopPropagation()
          moveCell(cell.id, 1)
        }}
      >
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button
        type="button"
        className={headerToolButton}
        disabled={kunBusy}
        title={isCode ? t('colabNb.toMarkdown') : t('colabNb.toCode')}
        aria-label={isCode ? t('colabNb.toMarkdown') : t('colabNb.toCode')}
        onClick={(event) => {
          event.stopPropagation()
          setCellKind(cell.id, isCode ? 'markdown' : 'code')
        }}
      >
        {isCode ? <Type className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
      </button>
      <button
        type="button"
        className="inline-flex h-6 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px] font-medium text-accent transition hover:bg-accent-tint/10"
        title={t('colabNb.sendCellToKun')}
        aria-label={t('colabNb.sendCellToKun')}
        onClick={(event) => {
          event.stopPropagation()
          askKunAboutCell(cell.id)
        }}
      >
        <Sparkles className="h-3 w-3 shrink-0" />
        <span>{t('colabNb.cellAskKunShort')}</span>
      </button>
      <button
        type="button"
        className={headerToolButton}
        disabled={running || kunBusy}
        title={t('colabNb.deleteCell')}
        aria-label={t('colabNb.deleteCell')}
        onClick={(event) => {
          event.stopPropagation()
          deleteCell(cell.id)
        }}
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  )

  return (
    <div
      className="group/cell relative mx-auto flex w-full max-w-[960px] gap-2.5 px-7"
      data-cell-id={cell.id}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!selected) selectCell(cell.id)
      }}
    >
      <div className={`w-[42px] shrink-0 text-right ${isCode ? 'pt-[38px]' : 'pt-2'}`}>
        {isCode ? (
          <button
            type="button"
            disabled={!canRun || running}
            onClick={() => onRun(cell.id, false)}
            title={t('colabNb.runCell')}
            aria-label={t('colabNb.runCell')}
            className="group/run ml-auto flex h-6 items-center justify-end font-mono text-[11.5px] text-ds-faint disabled:cursor-default"
          >
            {running ? (
              <span className="inline-flex items-center gap-1 font-mono text-accent">
                <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                <span>{counter}</span>
              </span>
            ) : (
              <>
                <span
                  className={`${canRun ? 'group-hover/run:hidden' : ''} ${
                    queued ? 'text-accent' : ''
                  }`}
                >
                  {counter}
                </span>
                {canRun ? (
                  <Play className="hidden h-3.5 w-3.5 fill-current text-accent group-hover/run:block" />
                ) : null}
              </>
            )}
          </button>
        ) : null}
      </div>

      <div className="relative min-w-0 flex-1">
        {isCode || showMarkdownEditor ? (
          <div
            className={`relative overflow-hidden rounded-[12px] border bg-ds-card transition ${
              selected
                ? 'border-accent shadow-[0_0_0_3px_color-mix(in_srgb,var(--ds-accent)_12%,transparent)]'
                : kunChanged
                  ? 'border-accent-tint/45'
                  : 'border-ds-border'
            }`}
          >
            {selected ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 left-0 z-10 w-[3px] bg-accent"
              />
            ) : null}

            {running ? (
              <div
                data-cell-running-progress
                className="relative h-[2px] w-full overflow-hidden bg-accent-tint/15"
              >
                <span className="absolute inset-y-0 left-0 w-[42%] animate-pulse rounded-full bg-accent" />
              </div>
            ) : null}

            <div
              data-cell-header
              className="flex h-8 items-center gap-2 border-b border-ds-border-muted bg-ds-surface-subtle/75 pl-3.5 pr-2 text-[11.5px] text-ds-faint"
            >
              <span className="rounded-[5px] border border-ds-border bg-ds-card px-1.5 py-[1px] font-mono text-[10.5px] leading-tight text-ds-muted">
                {isCode ? 'Python' : 'Markdown'}
              </span>

              {isCode ? (
                running ? (
                  <span className="font-medium text-accent">
                    {t('colabNb.cellRunningElapsed', { seconds: runningSeconds })}
                  </span>
                ) : queued ? (
                  <span className="text-ds-muted">{t('colabNb.cellQueuedLabel')}</span>
                ) : durationMs != null ? (
                  <span className="inline-flex items-center gap-1 text-emerald-600 dark:text-emerald-400">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    <span>{formatDurationShort(durationMs)}</span>
                  </span>
                ) : lineCount > 3 ? (
                  <span>{t('colabNb.cellLinesCount', { count: lineCount })}</span>
                ) : null
              ) : null}

              {kunChanged ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSidePanelTab('kun')
                  }}
                  className="inline-flex items-center gap-1 rounded-[6px] border border-accent-tint/25 bg-accent-tint/[0.08] px-1.5 py-[1px] text-[10.5px] font-medium text-accent transition hover:bg-accent-tint/15"
                >
                  <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>{t('colabNb.kunModifiedBadge')}</span>
                </button>
              ) : null}

              {isCode && expanded && lineCount > FOLD_LINE_LIMIT ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setExpanded(false)
                  }}
                  className="inline-flex items-center gap-0.5 rounded-[5px] px-1.5 py-[1px] text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                >
                  <ChevronUp className="h-3 w-3" aria-hidden="true" />
                  <span>{t('colabNb.collapseCode')}</span>
                </button>
              ) : null}

              {cellTools}
            </div>

            <div className={`relative ${isFolded ? 'max-h-[360px] overflow-hidden' : ''}`}>
              <div className={isCode ? 'bg-ds-card' : 'bg-ds-card px-3.5 py-2.5'}>
                <AutoTextarea
                  value={cell.source}
                  mono={isCode}
                  readOnly={kunBusy}
                  autoFocus={selected && !cell.source && !isCode}
                  placeholder={isCode ? t('colabNb.codePlaceholder') : t('colabNb.mdPlaceholder')}
                  onChange={(value) => updateCellSource(cell.id, value)}
                  onKeyDown={onKeyDown}
                  onFocus={() => selectCell(cell.id)}
                />
              </div>

              {isFolded ? (
                <div
                  data-cell-fold-overlay
                  className="pointer-events-none absolute inset-x-0 bottom-0 flex h-16 items-end justify-center pb-2"
                  style={{
                    background:
                      'linear-gradient(to bottom, color-mix(in srgb, var(--ds-surface-card) 0%, transparent), var(--ds-surface-card) 72%)'
                  }}
                >
                  <button
                    type="button"
                    data-cell-expand-btn
                    onClick={(event) => {
                      event.stopPropagation()
                      setExpanded(true)
                    }}
                    className="pointer-events-auto inline-flex items-center gap-1 rounded-full border border-ds-border bg-ds-card px-2.5 py-0.5 text-[11.5px] font-medium text-ds-muted shadow-sm transition hover:border-accent-tint/40 hover:text-ds-ink"
                  >
                    <ChevronDown className="h-3 w-3" aria-hidden="true" />
                    <span>{t('colabNb.expandRemainingLines', { count: remainingLines })}</span>
                  </button>
                </div>
              ) : null}
            </div>

            {isCode && cell.outputs.length > 0 ? (
              <div
                data-cell-output
                className="flex border-t border-ds-border-muted bg-ds-surface-subtle/60 py-2"
              >
                <span
                  aria-hidden="true"
                  className="w-[38px] shrink-0 select-none pr-3 pt-0.5 text-right font-mono text-[10.5px] text-ds-faint opacity-75"
                >
                  Out
                </span>
                <div className="max-h-[560px] min-w-0 flex-1 overflow-auto pr-3.5">
                  {cell.outputs.map((output, i) => (
                    <OutputView key={i} output={output} />
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        ) : (
          <div
            className={`relative rounded-[10px] border px-2 py-1 transition ${
              kunChanged
                ? 'border-accent-tint/40 bg-accent-tint/[0.03]'
                : 'border-transparent hover:border-ds-border-muted'
            }`}
          >
            <div className="absolute right-1.5 top-1 z-10 flex items-center gap-1 rounded-[7px] border border-ds-border-muted bg-ds-card px-1 py-0.5 opacity-0 shadow-sm transition-opacity group-hover/cell:opacity-100 focus-within:opacity-100">
              {kunChanged ? (
                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    setSidePanelTab('kun')
                  }}
                  className="inline-flex items-center gap-1 rounded-[5px] bg-accent-tint/10 px-1.5 py-[1px] text-[10.5px] font-medium text-accent"
                >
                  <Sparkles className="h-2.5 w-2.5" aria-hidden="true" />
                  <span>{t('colabNb.kunModifiedBadge')}</span>
                </button>
              ) : null}
              {cellTools}
            </div>
            <div
              onDoubleClick={() => selectCell(cell.id)}
              title={t('colabNb.mdEmpty')}
              className="cursor-text"
            >
              <PassiveAssistantMarkdown text={cell.source} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
})
