import { structuredPatch } from 'diff'
import type { ToolPresentation, ToolPresentationDiff } from '@shared/tool-presentation'
import type { ChatBlock } from '../../agent/types'
import type { CoreApprovalActionJson } from '../../agent/kun-contract-approval'
import type { ApprovalEmail } from './ApprovalEmailPreview'
import { approvalKind, approvalQuestion } from './approval-kind'
import type { ApprovalOptionFamily } from './approval-card-options'
import { approvalToolPresentation } from './approval-tool-presentation'

type Translate = (key: string, options?: Record<string, unknown>) => string
type ApprovalBlock = Extract<ChatBlock, { kind: 'approval' }>

/*
 * What the approval card shows for one pending request: the family (badge,
 * question, option copy), the tool preview data and the optional reason line.
 * Pure data so the layout can stay in FloatingComposerApprovalPanel and the
 * preview components.
 */

export type ApprovalDiffRow = {
  type: 'context' | 'add' | 'remove' | 'gap'
  text: string
  /** File line number, only when it is known (whole-file writes, located snippets). */
  line?: number
}

export type ApprovalDiffFile = {
  path: string
  displayPath: string
  added: number
  removed: number
  rows: ApprovalDiffRow[]
  /** Rows were capped at APPROVAL_DIFF_MAX_ROWS. */
  clipped: boolean
}

export type ApprovalCardContent =
  | { kind: 'command'; command: string; cwd?: string }
  | { kind: 'edit'; files: ApprovalDiffFile[]; added: number; removed: number }
  | { kind: 'email'; email: ApprovalEmail }
  | { kind: 'other'; toolName?: string; summary: string; presentation: ToolPresentation | null }

/** One argument the command or diff preview does not show (`timeout`, `replace_all`, ...). */
export type ApprovalExtraInput = { key: string; value: string }

export type ApprovalCardModel = {
  content: ApprovalCardContent
  family: ApprovalOptionFamily
  question: string
  badge: string
  /** Why / what for, when the request carries a human-readable one. */
  description: string | null
  /** The runtime shortened the arguments; the preview is partial. */
  truncated: boolean
  /** Command / edit arguments beyond what the preview box shows. */
  extraInput: ApprovalExtraInput[]
}

/** Rows kept per file; the rest is summarized by the +a -r counts. */
export const APPROVAL_DIFF_MAX_ROWS = 400
/** Diff rows shown before "Show all". */
export const APPROVAL_DIFF_COLLAPSED_ROWS = 12

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const text = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() ? value.trim() : undefined

/** `/Users/me/code/kun` -> `~/code/kun` (macOS, Linux and Windows home folders). */
export function abbreviateHomePath(path: string): string {
  return path
    .replace(/^\/(?:Users|home)\/[^/]+(?=\/|$)/, '~')
    .replace(/^[A-Za-z]:[\\/]Users[\\/][^\\/]+(?=[\\/]|$)/i, '~')
}

/** Workspace-relative path when the file is inside the workspace, else home-abbreviated. */
export function approvalDisplayPath(path: string, workspace?: string): string {
  const normalized = path.replace(/\\/g, '/')
  const root = workspace?.replace(/\\/g, '/').replace(/\/+$/, '')
  if (root && normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  return abbreviateHomePath(normalized)
}

function splitLines(value: string): string[] {
  const lines = value.replace(/\r\n?/g, '\n').split('\n')
  if (lines.length > 1 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/** First line of `path` the runtime located (ACP tool-call locations), if any. */
function locatedLine(action: CoreApprovalActionJson | undefined, path: string): number | undefined {
  const locations = record(action?.arguments).locations
  if (!Array.isArray(locations)) return undefined
  for (const location of locations) {
    const entry = record(location)
    if (entry.path === path && typeof entry.line === 'number' && entry.line > 0) return Math.floor(entry.line)
  }
  return undefined
}

/**
 * Unified rows for one change. Whole-file writes number every line. Edits are
 * usually snippets of the file, so their context rows are numbered only when
 * the runtime told us where the snippet starts; +/- rows show the sign.
 */
export function approvalDiffFile(
  diff: ToolPresentationDiff,
  options: { workspace?: string; startLine?: number } = {}
): ApprovalDiffFile {
  const rows: ApprovalDiffRow[] = []
  let added = 0
  let removed = 0
  if (diff.oldText == null) {
    splitLines(diff.newText).forEach((line, index) => rows.push({ type: 'add', text: line, line: index + 1 }))
    added = rows.length
  } else {
    const patch = structuredPatch(diff.path, diff.path, diff.oldText, diff.newText, '', '', { context: 3 })
    const offset = options.startLine != null ? options.startLine - 1 : null
    patch.hunks.forEach((hunk, index) => {
      if (index > 0) rows.push({ type: 'gap', text: '' })
      let newLine = hunk.newStart
      for (const line of hunk.lines) {
        const sign = line[0]
        const body = line.slice(1)
        if (sign === '+') {
          rows.push({ type: 'add', text: body })
          added += 1
          newLine += 1
        } else if (sign === '-') {
          rows.push({ type: 'remove', text: body })
          removed += 1
        } else if (sign === ' ') {
          rows.push({ type: 'context', text: body, ...(offset != null ? { line: newLine + offset } : {}) })
          newLine += 1
        }
      }
    })
  }
  return {
    path: diff.path,
    displayPath: approvalDisplayPath(diff.path, options.workspace),
    added,
    removed,
    rows: rows.slice(0, APPROVAL_DIFF_MAX_ROWS),
    clipped: rows.length > APPROVAL_DIFF_MAX_ROWS
  }
}

/** One section per file: several replacements in the same file become hunks of one section. */
export function approvalDiffFiles(
  diffs: readonly ToolPresentationDiff[],
  options: { workspace?: string; startLine?: (path: string) => number | undefined } = {}
): ApprovalDiffFile[] {
  const files = new Map<string, ApprovalDiffFile>()
  for (const diff of diffs) {
    const next = approvalDiffFile(diff, { workspace: options.workspace, startLine: options.startLine?.(diff.path) })
    const previous = files.get(diff.path)
    if (!previous) {
      files.set(diff.path, next)
      continue
    }
    const rows = [...previous.rows, { type: 'gap' as const, text: '' }, ...next.rows]
    files.set(diff.path, {
      ...previous,
      added: previous.added + next.added,
      removed: previous.removed + next.removed,
      rows: rows.slice(0, APPROVAL_DIFF_MAX_ROWS),
      clipped: previous.clipped || next.clipped || rows.length > APPROVAL_DIFF_MAX_ROWS
    })
  }
  return [...files.values()]
}

const basename = (path: string): string => path.split('/').filter(Boolean).pop() ?? path

/** Squash quotes, backticks and spacing so "`npm test`" and "npm test" compare equal. */
const comparable = (value: string): string => value.replace(/[`"'\u201C\u201D]/g, '').replace(/\s+/g, ' ').trim().toLowerCase()

function repeats(line: string, target: string | undefined): boolean {
  if (!target) return false
  const a = comparable(line)
  const b = comparable(target)
  return Boolean(b) && (a === b || (a.includes(b) && a.length - b.length <= 16))
}

/**
 * Human-readable reason, when the request has one: the tool's own
 * `description` argument (what the command is for), or the ACP tool-call
 * title. Runtime policy reasons ("runtime tool policy requires approval") are
 * not shown; titles that only repeat the command or path add nothing.
 */
export function approvalDescription(action: CoreApprovalActionJson | undefined, content: ApprovalCardContent): string | null {
  if (content.kind === 'email') return null
  const args = record(action?.arguments)
  const raw = record(args.rawInput ?? args)
  const fromArguments = text(raw.description) ?? text(args.description)
  const fromTitle = action?.toolName?.startsWith('acp:') ? text(action.reason) ?? text(args.title) : undefined
  const line = fromArguments ?? fromTitle
  if (!line || /^ACP agent requested permission for /.test(line)) return null
  if (content.kind === 'command' && repeats(line, content.command)) return null
  if (content.kind === 'edit' && content.files.some((file) => repeats(line, file.path) || repeats(line, file.displayPath))) {
    return null
  }
  return line
}

/*
 * Arguments a command or diff preview already shows, or that only restate it:
 * the ACP envelope (title, kind, locations), the reason line and the
 * truncation flag. Anything else may matter for the decision (`timeout`,
 * `run_in_background`, `with_escalated_permissions`, an edit's `replace_all`).
 */
const SHOWN_ENVELOPE_KEYS = ['title', 'kind', 'locations', 'rawInput', 'changes', 'diffs', 'edits', 'description', '__truncated__']
const SHOWN_COMMAND_KEYS = ['command', 'cmd']
const SHOWN_EDIT_KEYS = ['path', 'filePath', 'file_path', 'oldText', 'newText', 'oldString', 'newString', 'old_string', 'new_string', 'content', 'type']
const EXTRA_INPUT_CHARS = 160

/** Empty values and `false` flags (the usual default, e.g. `replace_all: false`) are not worth a row. */
const blankInput = (value: unknown): boolean => value == null || value === false ||
  (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && value.length === 0)

function extraInputValue(value: unknown): string {
  const raw = typeof value === 'string' ? value : JSON.stringify(value) ?? String(value)
  const flat = raw.replace(/\s+/g, ' ').trim()
  return flat.length > EXTRA_INPUT_CHARS ? `${flat.slice(0, EXTRA_INPUT_CHARS - 1).trimEnd()}\u2026` : flat
}

/**
 * Command and edit arguments the preview box does not show, in argument
 * order. Nested edit entries are named by their position (`edits[1].replace_all`).
 * Other tools and mail show their whole input already.
 */
export function approvalExtraInput(action: CoreApprovalActionJson | undefined, content: ApprovalCardContent): ApprovalExtraInput[] {
  if (content.kind !== 'command' && content.kind !== 'edit') return []
  const shown = new Set([...SHOWN_ENVELOPE_KEYS, ...(content.kind === 'command' ? SHOWN_COMMAND_KEYS : SHOWN_EDIT_KEYS)])
  const extra: ApprovalExtraInput[] = []
  const collect = (source: Record<string, unknown>, prefix = ''): void => {
    for (const [key, value] of Object.entries(source)) {
      if (shown.has(key) || blankInput(value)) continue
      // The preview header already shows the working directory.
      if (content.kind === 'command' && (key === 'cwd' || key === 'workdir') && value === content.cwd) continue
      extra.push({ key: prefix + key, value: extraInputValue(value) })
    }
  }
  const args = record(action?.arguments)
  collect(args)
  const rawInput = args.rawInput
  if (rawInput !== undefined && (typeof rawInput !== 'object' || Array.isArray(rawInput))) {
    if (!blankInput(rawInput)) extra.push({ key: 'rawInput', value: extraInputValue(rawInput) })
  }
  const raw = record(rawInput ?? args)
  if (raw !== args) collect(raw)
  if (content.kind === 'edit') {
    for (const [listKey, list] of [['changes', args.changes], ['diffs', raw.diffs], ['edits', raw.edits]] as const) {
      if (Array.isArray(list)) list.forEach((entry, index) => collect(record(entry), `${listKey}[${index}].`))
    }
  }
  return extra
}

const displayToolName = (toolName: string | undefined): string | undefined => toolName?.replace(/^acp:/, '') || undefined

export function approvalCardModel(block: ApprovalBlock, t: Translate): ApprovalCardModel {
  const action = block.action
  const base = approvalKind(action)
  const presentation = base.kind === 'email' ? null : approvalToolPresentation(action)
  const workspace = action?.workspace
  let content: ApprovalCardContent
  if (base.kind === 'email') content = { kind: 'email', email: base.email }
  else if (base.kind === 'command') content = { kind: 'command', command: base.command, cwd: base.cwd }
  else if (presentation?.diffs?.length) {
    const files = approvalDiffFiles(presentation.diffs, { workspace, startLine: (path) => locatedLine(action, path) })
    content = {
      kind: 'edit',
      files,
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0)
    }
  } else {
    content = { kind: 'other', toolName: block.toolName ?? action?.toolName, summary: block.summary, presentation }
  }

  const toolName = displayToolName(block.toolName ?? action?.toolName)
  const question = content.kind === 'edit'
    ? content.files.length === 1
      ? t('composerApproval.question.edit', { file: basename(content.files[0].displayPath) })
      : t('composerApproval.question.editFiles', { count: content.files.length })
    : approvalQuestion(base, block.toolName, t)
  const badge = content.kind === 'command' ? t('composerApproval.kind.command')
    : content.kind === 'edit' ? t('composerApproval.kind.edit')
      : content.kind === 'email' ? t('composerApproval.kind.email')
        : toolName ? t('composerApproval.kind.tool', { name: toolName }) : t('composerApproval.kind.toolUnnamed')
  return {
    content,
    family: content.kind,
    question,
    badge,
    description: approvalDescription(action, content),
    truncated: record(action?.arguments).__truncated__ === true,
    extraInput: approvalExtraInput(action, content)
  }
}

/** Long command / mail bodies start clamped behind "Show all". */
export function approvalTextNeedsClamp(value: string, maxLines: number, maxChars: number): boolean {
  return value.length > maxChars || splitLines(value).length > maxLines
}
