import { memo, useEffect, useMemo, useRef, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp, Code2, Loader2, Play, Trash2, Type } from 'lucide-react'
import type { ColabNotebookOutput } from '@shared/colab/colab-notebook-types'
import { PassiveAssistantMarkdown } from '../../components/chat/PassiveAssistantMarkdown'
import { renderStreamText, type NotebookCell } from './ipynb-format'
import { useColabNotebookStore } from './colab-notebook-store'
import { highlightPythonCode } from './python-highlight'

const toolButton =
  'flex h-6 w-6 items-center justify-center rounded-md text-ds-faint hover:bg-ds-hover hover:text-ds-ink disabled:opacity-40'

function AutoTextarea({
  value,
  placeholder,
  autoFocus,
  onChange,
  onKeyDown,
  onFocus,
  mono
}: {
  value: string
  placeholder: string
  autoFocus?: boolean
  onChange: (value: string) => void
  onKeyDown: (event: KeyboardEvent<HTMLTextAreaElement>) => void
  onFocus: () => void
  mono: boolean
}): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  const highlighted = useMemo(() => (mono && value ? highlightPythonCode(value) : null), [mono, value])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = '0px'
    el.style.height = `${el.scrollHeight}px`
  }, [value])

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
      <div className="grid">
        {highlighted ? (
          <pre
            aria-hidden="true"
            className="pointer-events-none col-start-1 row-start-1 m-0 whitespace-pre-wrap break-words font-mono text-[12.5px] leading-[1.65] text-ds-ink"
          >
            {highlighted}
          </pre>
        ) : null}
        <textarea
          ref={ref}
          value={value}
          spellCheck={false}
          placeholder={placeholder}
          rows={1}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={handleKeyDown}
          onFocus={onFocus}
          className={`col-start-1 row-start-1 block w-full resize-none overflow-hidden whitespace-pre-wrap break-words bg-transparent font-mono text-[12.5px] leading-[1.65] outline-none selection:bg-accent/20 placeholder:text-ds-faint ${
            highlighted ? 'text-transparent caret-ds-ink' : 'text-ds-ink'
          }`}
        />
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
      onChange={(event) => onChange(event.target.value)}
      onKeyDown={handleKeyDown}
      onFocus={onFocus}
      className="block w-full resize-none overflow-hidden bg-transparent text-[13.5px] leading-relaxed text-ds-ink outline-none placeholder:text-ds-faint"
    />
  )
}

function OutputView({ output }: { output: ColabNotebookOutput }): ReactElement {
  if (output.type === 'image') {
    return <img alt="" src={`data:image/png;base64,${output.data}`} className="my-1 max-w-full rounded-lg border border-ds-border bg-white" />
  }
  if (output.type === 'error') {
    return (
      <pre className="my-1 whitespace-pre-wrap break-words rounded-lg bg-red-500/[0.06] px-3 py-2 font-mono text-[12px] leading-relaxed text-red-600 dark:text-red-400">
        {output.traceback.trim() || `${output.ename}: ${output.evalue}`}
      </pre>
    )
  }
  return (
    <pre className={`whitespace-pre-wrap break-words font-mono text-[12px] leading-[1.6] ${output.name === 'stderr' ? 'text-amber-700 dark:text-amber-400' : 'text-ds-ink'}`}>
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
  onRun
}: {
  cell: NotebookCell
  index: number
  total: number
  selected: boolean
  running: boolean
  queued: boolean
  canRun: boolean
  onRun: (id: string, advance: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const selectCell = useColabNotebookStore((s) => s.selectCell)
  const updateCellSource = useColabNotebookStore((s) => s.updateCellSource)
  const setCellKind = useColabNotebookStore((s) => s.setCellKind)
  const deleteCell = useColabNotebookStore((s) => s.deleteCell)
  const moveCell = useColabNotebookStore((s) => s.moveCell)
  const isCode = cell.kind === 'code'
  const showMarkdownEditor = !isCode && (selected || !cell.source.trim())

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

  const counter = running ? '[*]' : queued ? '[…]' : cell.executionCount != null ? `[${cell.executionCount}]` : '[ ]'

  return (
    <div
      className="group/cell relative mx-auto flex w-full max-w-[960px] gap-2.5 px-7"
      data-cell-id={cell.id}
      onMouseDown={(event) => {
        event.stopPropagation()
        if (!selected) selectCell(cell.id)
      }}
    >
      <div className="w-11 shrink-0 pt-2.5 text-right">
        {isCode ? (
          <button
            type="button"
            disabled={!canRun || running}
            onClick={() => onRun(cell.id, false)}
            title={t('colabNb.runCell')}
            aria-label={t('colabNb.runCell')}
            className="group/run ml-auto flex h-6 items-center justify-end font-mono text-[12px] text-ds-faint disabled:cursor-default"
          >
            {running ? (
              <Loader2 className="h-4 w-4 animate-spin text-accent" />
            ) : (
              <>
                <span className={`${canRun ? 'group-hover/run:hidden' : ''} ${queued ? 'text-accent' : ''}`}>{counter}</span>
                {canRun ? <Play className="hidden h-4 w-4 fill-current text-accent group-hover/run:block" /> : null}
              </>
            )}
          </button>
        ) : null}
      </div>
      <div className="min-w-0 flex-1">
        <div
          className={`rounded-[9px] border transition ${
            isCode ? 'bg-ds-sidebar/60 px-3 py-2.5' : showMarkdownEditor ? 'px-3 py-2.5' : 'px-1 py-1'
          } ${selected ? 'border-accent shadow-[0_0_0_3px_rgba(79,107,237,0.12)]' : isCode || showMarkdownEditor ? 'border-ds-border' : 'border-transparent'}`}
        >
          {isCode || showMarkdownEditor ? (
            <AutoTextarea
              value={cell.source}
              mono={isCode}
              autoFocus={selected && !cell.source && !isCode}
              placeholder={isCode ? t('colabNb.codePlaceholder') : t('colabNb.mdPlaceholder')}
              onChange={(value) => updateCellSource(cell.id, value)}
              onKeyDown={onKeyDown}
              onFocus={() => selectCell(cell.id)}
            />
          ) : (
            <div onDoubleClick={() => selectCell(cell.id)} title={t('colabNb.mdEmpty')} className="cursor-text">
              <PassiveAssistantMarkdown text={cell.source} />
            </div>
          )}
        </div>
        {isCode && cell.outputs.length > 0 ? (
          <div className="max-h-[560px] overflow-auto px-3 pb-1 pt-2">
            {cell.outputs.map((output, i) => <OutputView key={i} output={output} />)}
          </div>
        ) : null}
      </div>
      <div
        className={`absolute right-1 top-1 flex flex-col gap-0.5 rounded-lg border border-ds-border bg-ds-card p-0.5 shadow-sm ${
          selected ? 'flex' : 'hidden group-hover/cell:flex'
        }`}
      >
        <button type="button" className={toolButton} disabled={index === 0} title={t('colabNb.moveUp')} aria-label={t('colabNb.moveUp')}
          onClick={() => moveCell(cell.id, -1)}><ArrowUp className="h-3.5 w-3.5" /></button>
        <button type="button" className={toolButton} disabled={index === total - 1} title={t('colabNb.moveDown')} aria-label={t('colabNb.moveDown')}
          onClick={() => moveCell(cell.id, 1)}><ArrowDown className="h-3.5 w-3.5" /></button>
        <button type="button" className={toolButton} title={isCode ? t('colabNb.toMarkdown') : t('colabNb.toCode')}
          aria-label={isCode ? t('colabNb.toMarkdown') : t('colabNb.toCode')}
          onClick={() => setCellKind(cell.id, isCode ? 'markdown' : 'code')}>
          {isCode ? <Type className="h-3.5 w-3.5" /> : <Code2 className="h-3.5 w-3.5" />}
        </button>
        <button type="button" className={toolButton} disabled={running} title={t('colabNb.deleteCell')} aria-label={t('colabNb.deleteCell')}
          onClick={() => deleteCell(cell.id)}><Trash2 className="h-3.5 w-3.5" /></button>
      </div>
    </div>
  )
})
