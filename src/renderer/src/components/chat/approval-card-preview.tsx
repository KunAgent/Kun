import { Fragment, useId, type ReactElement, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, FileText, Globe, Mail, PenLine, SquareTerminal, Wrench } from 'lucide-react'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'
import { ApprovalDetails } from './ApprovalDetails'
import { ApprovalEmailPreview } from './ApprovalEmailPreview'
import {
  APPROVAL_DIFF_COLLAPSED_ROWS,
  abbreviateHomePath,
  approvalTextNeedsClamp,
  type ApprovalCardContent,
  type ApprovalCardModel,
  type ApprovalDiffFile,
  type ApprovalDiffRow,
  type ApprovalExtraInput
} from './approval-card-model'
import type { ApprovalOptionDescription } from './approval-card-options'
import { InterruptPreview } from './interrupt-card/interrupt-card-primitives'

type Translate = (key: string, options?: Record<string, unknown>) => string

/*
 * Tool preview box of the approval card: what exactly is about to run, change
 * or be sent. Long content starts clamped behind "Show all" and, once expanded,
 * scrolls inside a max height so the options stay reachable. A command or an
 * edit with arguments the box does not show ("timeout", "replace_all") gets
 * the toggle too; expanded, it lists those arguments and the full details.
 */

const COMMAND_CLAMP = { lines: 6, chars: 420 }
const EMAIL_CLAMP = { lines: 6, chars: 480 }
const SUMMARY_CLAMP = { lines: 4, chars: 320 }

/** Kind glyph for the header badge and the preview header (12px, currentColor). */
export function ApprovalKindGlyph({ content }: { content: ApprovalCardContent }): ReactElement {
  const className = 'h-3 w-3 shrink-0'
  if (content.kind === 'command') return <SquareTerminal className={className} strokeWidth={2} aria-hidden="true" />
  if (content.kind === 'edit') return <PenLine className={className} strokeWidth={2} aria-hidden="true" />
  if (content.kind === 'email') return <Mail className={className} strokeWidth={2} aria-hidden="true" />
  const kind = content.presentation?.kind
  if (kind === 'fetch') return <Globe className={className} strokeWidth={2} aria-hidden="true" />
  if (kind === 'read') return <FileText className={className} strokeWidth={2} aria-hidden="true" />
  return <Wrench className={className} strokeWidth={2} aria-hidden="true" />
}

const CODE_CHIP = 'rounded-[5px] bg-ds-hover px-[5px] py-px font-mono text-[12px] text-ds-ink'

/** Text with `backticked` segments (agent titles are often Markdown) as code chips. */
export function ApprovalInlineCode({ text }: { text: string }): ReactElement {
  const parts = text.split(/`([^`\n]+)`/)
  return (
    <>
      {parts.map((part, index) => (index % 2 === 1
        ? <code key={index} className={CODE_CHIP}>{part}</code>
        : part))}
    </>
  )
}

/** Option description with the optional scope rendered as a code chip. */
export function ApprovalOptionDescriptionText({ description }: { description: ApprovalOptionDescription }): ReactElement {
  if ('text' in description) return <>{description.text}</>
  return (
    <>
      {description.before}
      <code className={CODE_CHIP}>{description.code}</code>
      {description.after}
    </>
  )
}

function DiffStats({ added, removed, t }: { added: number; removed: number; t: Translate }): ReactElement {
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1.5 font-mono tabular-nums"
      aria-label={t('composerApproval.preview.diffStats', { added, removed })}
    >
      <span className="text-ds-diff-added" aria-hidden="true">+{added}</span>
      <span className="text-ds-diff-removed" aria-hidden="true">{'\u2212'}{removed}</span>
    </span>
  )
}

function ExpandToggle({ expanded, controls, onToggle, label, t }: {
  expanded: boolean
  controls: string
  onToggle: () => void
  /** Collapsed label; defaults to "Show all". */
  label?: string
  t: Translate
}): ReactElement {
  const Icon = expanded ? ChevronUp : ChevronDown
  return (
    <button
      type="button"
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onToggle}
      className="ds-no-drag flex h-8 w-full items-center gap-1 border-t border-ds-border-muted px-3 text-left text-[12px] text-ds-muted transition-colors hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent-tint/45"
      data-approval-expand
    >
      <Icon className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" />
      {expanded ? t('approvalCollapse') : label ?? t('approvalExpand')}
    </button>
  )
}

/** Arguments the command / diff body does not show, as `key  value` rows. */
function ExtraInputList({ entries }: { entries: ApprovalExtraInput[] }): ReactElement | null {
  if (!entries.length) return null
  return (
    <dl
      className="grid grid-cols-[fit-content(45%)_minmax(0,1fr)] gap-x-3 gap-y-0.5 border-t border-ds-border-muted px-3 py-2 font-mono text-[12px] leading-5"
      data-approval-extra-input
    >
      {entries.map((entry) => (
        <Fragment key={entry.key}>
          <dt className="min-w-0 text-ds-faint [overflow-wrap:anywhere]">{entry.key}</dt>
          <dd className="min-w-0 whitespace-pre-wrap text-ds-ink [overflow-wrap:anywhere]">{entry.value}</dd>
        </Fragment>
      ))}
    </dl>
  )
}

/** Toggle label of a command / edit preview: "Show all", or how many arguments are hidden. */
function expandLabel(clampable: boolean, extra: ApprovalExtraInput[], t: Translate): string | undefined {
  return clampable || !extra.length ? undefined : t('composerApproval.preview.moreInput', { count: extra.length })
}

function diffGutter(row: ApprovalDiffRow): string {
  if (row.line != null) return String(row.line)
  if (row.type === 'add') return '+'
  if (row.type === 'remove') return '\u2212'
  if (row.type === 'gap') return '\u22EF'
  return ''
}

function DiffRows({ rows, gutterDigits }: { rows: ApprovalDiffRow[]; gutterDigits: number }): ReactElement {
  const gutterWidth = `calc(${Math.max(2, gutterDigits)}ch + 10px)`
  return (
    <>
      {rows.map((row, index) => (
        <div
          key={index}
          className={`flex px-3 ${
            row.type === 'add' ? 'bg-ds-diff-added-soft'
              : row.type === 'remove' ? 'bg-ds-diff-removed-soft' : ''
          }`}
          data-diff-row={row.type}
        >
          <span
            aria-hidden="true"
            className="shrink-0 select-none text-ds-faint tabular-nums"
            style={{ width: gutterWidth }}
          >
            {diffGutter(row)}
          </span>
          <span className="min-w-0 flex-1 whitespace-pre-wrap [overflow-wrap:anywhere]">{row.text || ' '}</span>
        </div>
      ))}
    </>
  )
}

function DiffBody({ files, expanded, t }: { files: ApprovalDiffFile[]; expanded: boolean; t: Translate }): ReactElement {
  const multiple = files.length > 1
  const gutterDigits = Math.max(2, ...files.flatMap((file) => file.rows.map((row) => String(row.line ?? '').length)))
  let budget = expanded ? Number.POSITIVE_INFINITY : APPROVAL_DIFF_COLLAPSED_ROWS
  const sections: ReactNode[] = []
  for (const file of files) {
    if (budget <= 0) break
    const rows = file.rows.slice(0, budget)
    budget -= rows.length + (multiple ? 1 : 0)
    sections.push(
      <div key={file.path} data-approval-diff-file={file.displayPath}>
        {multiple ? (
          <div className="flex min-w-0 items-center gap-2 px-3 pb-0.5 pt-1.5 text-[11.5px] text-ds-muted">
            <span className="truncate" title={file.path}>{file.displayPath}</span>
            <DiffStats added={file.added} removed={file.removed} t={t} />
          </div>
        ) : null}
        <DiffRows rows={rows} gutterDigits={gutterDigits} />
        {expanded && file.clipped ? (
          <div className="px-3 py-0.5 text-[11.5px] text-ds-faint">{t('composerApproval.preview.clipped')}</div>
        ) : null}
      </div>
    )
  }
  // Long lines wrap (no sideways scrolling inside a decision card).
  return <div className="py-1 font-mono text-[12px] leading-5 text-ds-ink">{sections}</div>
}

const diffRowCount = (files: ApprovalDiffFile[]): number =>
  files.reduce((sum, file) => sum + file.rows.length + (files.length > 1 ? 1 : 0), 0)

/** Scroll frame of an expanded preview body. */
function bodyFrame(expanded: boolean, compact: boolean): string {
  if (!expanded) return ''
  return `overflow-y-auto overscroll-contain ${compact ? 'max-h-[240px]' : 'max-h-[320px]'}`
}

export function ApprovalCardPreview({
  model,
  action,
  expanded,
  onToggleExpanded,
  compact,
  t
}: {
  model: ApprovalCardModel
  /** The request's action envelope (input payload and file links under the toggle). */
  action: CoreApprovalActionJson | undefined
  expanded: boolean
  onToggleExpanded: () => void
  compact: boolean
  t: Translate
}): ReactElement {
  const bodyId = useId()
  const content = model.content
  const status = t('composerApproval.preview.awaiting')
  const truncatedNote = model.truncated ? (
    <p className="border-t border-ds-border-muted px-3 py-1.5 text-[11.5px] text-ds-faint">
      {t('composerApproval.preview.truncated')}
    </p>
  ) : null

  const extra = model.extraInput

  if (content.kind === 'command') {
    const clampable = approvalTextNeedsClamp(content.command, COMMAND_CLAMP.lines, COMMAND_CLAMP.chars)
    const cwd = content.cwd ? abbreviateHomePath(content.cwd) : null
    return (
      <InterruptPreview
        status={status}
        header={<>
          <ApprovalKindGlyph content={content} />
          <span className="shrink-0">{t('composerApproval.preview.terminal')}</span>
          {cwd ? <span className="min-w-0 truncate font-mono text-[12px] text-ds-faint" title={content.cwd}>{cwd}</span> : null}
        </>}
      >
        <div id={bodyId} className={bodyFrame(expanded, compact)} data-approval-preview="command">
          <div className="px-3 py-[9px]">
            <p className={`whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-ds-ink [overflow-wrap:anywhere] ${
              clampable && !expanded ? 'line-clamp-6' : ''
            }`}>
              {content.command}
            </p>
          </div>
          {expanded ? <>
            <ExtraInputList entries={extra} />
            <ApprovalDetails action={action} embedded previewed="command" />
          </> : null}
        </div>
        {truncatedNote}
        {clampable || extra.length ? (
          <ExpandToggle expanded={expanded} controls={bodyId} onToggle={onToggleExpanded} label={expandLabel(clampable, extra, t)} t={t} />
        ) : null}
      </InterruptPreview>
    )
  }

  if (content.kind === 'edit') {
    const single = content.files.length === 1 ? content.files[0] : null
    const clampable = diffRowCount(content.files) > APPROVAL_DIFF_COLLAPSED_ROWS
    return (
      <InterruptPreview
        status={status}
        header={<>
          {single ? (
            <span className="min-w-0 truncate font-mono text-[12px] text-ds-ink" title={single.path}>{single.displayPath}</span>
          ) : (
            <span className="shrink-0">{t('composerApproval.preview.files', { count: content.files.length })}</span>
          )}
          <DiffStats added={content.added} removed={content.removed} t={t} />
        </>}
      >
        <div id={bodyId} className={bodyFrame(expanded, compact)} data-approval-preview="edit">
          <DiffBody files={content.files} expanded={expanded} t={t} />
          {expanded ? <>
            <ExtraInputList entries={extra} />
            <ApprovalDetails action={action} embedded previewed="diffs" />
          </> : null}
        </div>
        {truncatedNote}
        {clampable || extra.length ? (
          <ExpandToggle expanded={expanded} controls={bodyId} onToggle={onToggleExpanded} label={expandLabel(clampable, extra, t)} t={t} />
        ) : null}
      </InterruptPreview>
    )
  }

  if (content.kind === 'email') {
    const clampable = approvalTextNeedsClamp(content.email.body, EMAIL_CLAMP.lines, EMAIL_CLAMP.chars)
    return (
      <InterruptPreview
        status={status}
        header={<>
          <ApprovalKindGlyph content={content} />
          <span className="shrink-0">{t('composerApproval.preview.email')}</span>
          {content.email.from ? (
            <span className="min-w-0 truncate font-mono text-[12px] text-ds-faint">{content.email.from}</span>
          ) : null}
        </>}
      >
        <div id={bodyId} className={bodyFrame(expanded, compact)} data-approval-preview="email">
          <ApprovalEmailPreview email={content.email} t={t} compact={compact} embedded clamped={clampable && !expanded} />
        </div>
        {clampable ? <ExpandToggle expanded={expanded} controls={bodyId} onToggle={onToggleExpanded} t={t} /> : null}
      </InterruptPreview>
    )
  }

  const summaryLong = approvalTextNeedsClamp(content.summary, SUMMARY_CLAMP.lines, SUMMARY_CLAMP.chars)
  const hasDetails = content.presentation != null
  const toolName = content.toolName?.replace(/^acp:/, '')
  return (
    <InterruptPreview
      status={status}
      header={<>
        <ApprovalKindGlyph content={content} />
        {toolName ? <span className="min-w-0 truncate font-mono text-[12px]">{toolName}</span> : null}
      </>}
    >
      <div id={bodyId} className={bodyFrame(expanded, compact)} data-approval-preview="other">
        <div className="px-3 py-[9px]">
          <p className={`whitespace-pre-wrap break-words font-mono text-[12.5px] leading-5 text-ds-ink [overflow-wrap:anywhere] ${
            summaryLong && !expanded ? 'line-clamp-4' : ''
          }`}>
            {content.summary}
          </p>
        </div>
        {expanded && hasDetails ? <ApprovalDetails action={action} embedded /> : null}
      </div>
      {truncatedNote}
      {summaryLong || hasDetails ? <ExpandToggle expanded={expanded} controls={bodyId} onToggle={onToggleExpanded} t={t} /> : null}
    </InterruptPreview>
  )
}
