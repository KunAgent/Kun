import { SourceHistoryReadDetail } from '../../history-reference/SourceHistoryReadDetail'
import type { ReactElement } from 'react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { extractUnifiedDiffText } from '../../lib/diff-stats'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { MessageBubble } from './message-timeline-bubbles'
import {
  isBackgroundShellNoticeBlock,
  isBackgroundSubagentNoticeBlock,
  splitThink
} from './message-timeline-turns'
import {
  formatToolTitle,
  isBackgroundShellCommandBlock,
  parseToolBlockPayload,
  summarizeBackgroundShellToolBlock
} from './message-timeline-tools'
import { InjectedMemoryMetaChip } from './injected-memory-meta-chip'
import { KnowledgeEvidenceDetail, parseKnowledgeEvidence } from './KnowledgeEvidenceDetail'

export function toolNameForBlock(block: ToolBlock): string {
  const rawSummary = block.summary?.trim() ?? ''
  return (extractToolName(rawSummary) || readMetaString(block.meta, 'toolName') || '').toLowerCase()
}

export function splitVerb(summary: string): { verb: string; rest: string } {
  const trimmed = summary.trim()
  if (!trimmed) return { verb: '', rest: '' }
  const space = trimmed.search(/\s/)
  if (space < 0) return { verb: trimmed, rest: '' }
  return { verb: trimmed.slice(0, space), rest: trimmed.slice(space + 1).trim() }
}

export function toolFilePath(block: ToolBlock): string | undefined {
  const sourceText = [block.summary, block.detail ?? ''].filter(Boolean).join('\n')
  return (
    block.filePath ||
    extractQuotedField(sourceText, 'path') ||
    extractQuotedField(sourceText, 'file_path') ||
    extractQuotedField(sourceText, 'file')
  )
}


export type ProcessDetail =
  | { kind: 'none' }
  | { kind: 'reasoning'; text: string }
  | { kind: 'assistant'; text: string }
  | { kind: 'tool'; text: string; isPatch: boolean; isError: boolean; filePath?: string }
  | { kind: 'approval' }
  | { kind: 'approval_review' }
  | { kind: 'user_input' }
  | { kind: 'background_shell' }
  | { kind: 'background_subagent' }
  | { kind: 'text'; text: string }

export function summarizeProcessText(text: string, max = 96): string {
  const oneLine = text.replace(/\s+/g, ' ').trim()
  if (!oneLine) return ''
  if (oneLine.length <= max) return oneLine
  return `${oneLine.slice(0, max - 1).trimEnd()}…`
}

export function humanizeToolName(name: string): string {
  const trimmed = name.trim().replace(/[_-]+/g, ' ')
  if (!trimmed) return ''
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1)
}

export function builtInToolLabel(
  toolName: string,
  t: (key: string, opts?: Record<string, unknown>) => string
): string | undefined {
  switch (toolName) {
    case 'read_source_history':
      return t('codexHistoryReadTool')
    case 'read':
    case 'read_file':
      return t('toolBuiltinRead')
    case 'write':
    case 'write_file':
      return t('toolBuiltinWrite')
    case 'edit':
    case 'edit_file':
      return t('toolBuiltinEdit')
    case 'grep':
    case 'grep_files':
    case 'search_files':
      return t('toolBuiltinGrep')
    case 'find':
      return t('toolBuiltinFind')
    case 'ls':
      return t('toolBuiltinLs')
    case 'bash':
    case 'shell':
      return t('toolBuiltinBash')
    case 'background_shell':
      return t('toolBuiltinBackgroundShell', { defaultValue: 'Background shell' })
    case 'delegate_task':
    case 'generate_subagent':
      // Routed to SubagentCallCard before the generic row; labeled here as a
      // defensive fallback so an ungrouped delegate block never reads as raw JSON.
      return t('toolBuiltinDelegate')
    case 'design_component':
      return t('toolBuiltinDesignComponent')
    default:
      return undefined
  }
}

export function extractToolName(summary: string): string {
  const match = summary.trim().match(/^([a-z0-9_-]+)\s*:/i)
  return match?.[1] ?? ''
}

export function extractQuotedField(text: string, field: string): string | undefined {
  const escaped = field.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const attr = new RegExp(`${escaped}="([^"]+)"`, 'i').exec(text)
  if (attr?.[1]) return attr[1]
  const json = new RegExp(`"${escaped}"\\s*:\\s*"([^"]+)"`, 'i').exec(text)
  if (json?.[1]) return json[1]
  return undefined
}

export function readMetaString(meta: Record<string, unknown> | undefined, key: string): string | undefined {
  if (!meta) return undefined
  const value = meta[key]
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

export function readMetaStringArray(meta: Record<string, unknown> | undefined, key: string): string[] {
  const value = meta?.[key]
  if (!Array.isArray(value)) return []
  return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
}

export function readMetaInstructionSources(meta: Record<string, unknown> | undefined): Array<{ path: string; scope: string }> {
  const value = meta?.injectedInstructionSources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const path = typeof raw.path === 'string' && raw.path.trim() ? raw.path.trim() : ''
      const scope = typeof raw.scope === 'string' && raw.scope.trim() ? raw.scope.trim() : ''
      return path ? { path, scope } : null
    })
    .filter((entry): entry is { path: string; scope: string } => entry !== null)
}

export function readMetaSources(meta: Record<string, unknown> | undefined): Array<{ title?: string; url?: string }> {
  const value = meta?.sources
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null
      const raw = entry as Record<string, unknown>
      const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : undefined
      const url = typeof raw.url === 'string' && raw.url.trim() ? raw.url.trim() : undefined
      return title || url ? { ...(title ? { title } : {}), ...(url ? { url } : {}) } : null
    })
    .filter((entry): entry is { title?: string; url?: string } => entry !== null)
}

export function RuntimeMetaBadges({
  block,
  t
}: {
  block: ChatBlock
  t: (key: string, opts?: Record<string, unknown>) => string
}): ReactElement | null {
  const meta = block.kind === 'tool' || block.kind === 'approval' || block.kind === 'user' ? block.meta : undefined
  if (!meta) return null
  const showTurnDisclosure = block.kind !== 'tool'
  const sources = readMetaSources(meta)
  const attachmentIds = showTurnDisclosure ? readMetaStringArray(meta, 'attachmentIds') : []
  const activeSkillIds = showTurnDisclosure ? readMetaStringArray(meta, 'activeSkillIds') : []
  const injectedMemoryIds = showTurnDisclosure ? readMetaStringArray(meta, 'injectedMemoryIds') : []
  const injectedInstructionSources = showTurnDisclosure ? readMetaInstructionSources(meta) : []
  const child = meta.child && typeof meta.child === 'object' ? meta.child as Record<string, unknown> : null
  const childLabel =
    typeof child?.childLabel === 'string' && child.childLabel.trim()
      ? child.childLabel.trim()
      : typeof child?.childProfile === 'string' && child.childProfile.trim()
        ? child.childProfile.trim()
        : typeof child?.childId === 'string'
          ? child.childId
          : ''
  if (
    sources.length === 0 &&
    attachmentIds.length === 0 &&
    activeSkillIds.length === 0 &&
    injectedMemoryIds.length === 0 &&
    injectedInstructionSources.length === 0 &&
    !childLabel
  ) {
    return null
  }
  const chipClass = 'inline-flex max-w-full items-center gap-1 rounded-md border border-ds-border-muted bg-ds-card/75 px-1.5 py-0.5 text-[11px] font-medium text-ds-faint'
  return (
    <div className="ml-7 mt-1 flex min-w-0 flex-wrap gap-1.5">
      {childLabel ? (
        <span className={chipClass} title={childLabel}>
          <span>{t('toolChildAgent')}</span>
          <span className="max-w-28 truncate font-mono text-ds-muted">{childLabel}</span>
        </span>
      ) : null}
      {activeSkillIds.length > 0 ? (
        <span className={chipClass} title={activeSkillIds.join(', ')}>
          {t('toolActiveSkills')} {activeSkillIds.length}
        </span>
      ) : null}
      {injectedMemoryIds.length > 0 ? (
        <InjectedMemoryMetaChip meta={meta} memoryIds={injectedMemoryIds} chipClass={chipClass} />
      ) : null}
      {injectedInstructionSources.length > 0 ? (
        <span className={chipClass} title={injectedInstructionSources.map((source) => `${source.scope}: ${source.path}`).join('\n')}>
          {t('toolInjectedInstructions')} {injectedInstructionSources.length}
        </span>
      ) : null}
      {attachmentIds.length > 0 ? (
        <span className={chipClass} title={attachmentIds.join(', ')}>
          {t('toolAttachments')} {attachmentIds.length}
        </span>
      ) : null}
      {sources.slice(0, 4).map((source, index) =>
        source.url ? (
          <a
            key={`${source.url}-${index}`}
            href={source.url}
            target="_blank"
            rel="noreferrer"
            className={chipClass}
            title={source.url}
          >
            {t('toolSources')} {index + 1}
            <span className="max-w-32 truncate text-ds-muted">{source.title || source.url}</span>
          </a>
        ) : (
          <span key={`${source.title}-${index}`} className={chipClass} title={source.title}>
            {t('toolSources')} {index + 1}
          </span>
        )
      )}
    </div>
  )
}

export function summarizeToolBlock(
  block: ToolBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  const rawSummary = block.summary?.trim() ?? ''
  const toolName = toolNameForBlock(block)
  const label = builtInToolLabel(toolName, t) || humanizeToolName(toolName) || formatToolTitle(block, t)
  const sourceText = [rawSummary, block.detail ?? ''].filter(Boolean).join('\n')
  const filePath = toolFilePath(block)
  const pattern =
    extractQuotedField(sourceText, 'pattern') ||
    extractQuotedField(sourceText, 'query') ||
    readMetaString(block.meta, 'pattern')
  const command = readMetaString(block.meta, 'command')

  if (toolName === 'background_shell') {
    return summarizeBackgroundShellToolBlock(block, t)
  }

  if (toolName === 'fast_context' || toolName === 'explore_agent') {
    const payload = parseToolBlockPayload(block)
    const title =
      (typeof payload.title === 'string' && payload.title.trim() ? payload.title.trim() : undefined) ||
      (block.meta?.child && typeof block.meta.child === 'object'
        ? (typeof (block.meta.child as { childLabel?: unknown }).childLabel === 'string'
          ? (block.meta.child as { childLabel: string }).childLabel.trim()
          : undefined)
        : undefined)
    if (title) return `${label} ${summarizeProcessText(title, 72)}`
    return label
  }

  if ((toolName === 'read_file' || toolName === 'read') && filePath) {
    return `${label} ${filePath}`
  }
  if ((toolName === 'write' || toolName === 'edit' || toolName === 'write_file' || toolName === 'edit_file') && filePath) {
    return `${label} ${filePath}`
  }
  if ((toolName === 'grep_files' || toolName === 'search_files' || toolName === 'grep' || toolName === 'find') && pattern) {
    return filePath ? `${label} ${pattern} · ${filePath}` : `${label} ${pattern}`
  }
  if (toolName === 'ls' && filePath) {
    return `${label} ${filePath}`
  }
  if (command && block.toolKind === 'command_execution') {
    const action = isBackgroundShellCommandBlock(block)
      ? t('toolActionBackgroundCommand')
      : formatToolTitle(block, t)
    return `${action} ${summarizeProcessText(command, 72)}`
  }
  if (filePath) {
    return `${label} ${filePath}`
  }
  if (pattern) {
    return `${label} ${pattern}`
  }
  if (rawSummary) {
    const compact = toolName ? rawSummary.replace(/^([a-z0-9_-]+)\s*:\s*/i, '') : rawSummary
    const summary = summarizeProcessText(compact, 72)
    if (summary && normalizeProcessText(summary) === normalizeProcessText(label)) {
      return label
    }
    return summary ? `${label} ${summary}` : label
  }
  return label
}

export function normalizeProcessText(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase()
}

export function getProcessDetail(block: ChatBlock, summaryText?: string): ProcessDetail {
  if (block.kind === 'reasoning') {
    return block.text.trim() ? { kind: 'reasoning', text: block.text } : { kind: 'none' }
  }
  if (block.kind === 'assistant') {
    const split = splitThink(block.text)
    const text = split.content || split.think
    return text.trim() ? { kind: 'assistant', text } : { kind: 'none' }
  }
  if (block.kind === 'tool') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    const isError = block.status === 'error'
    const patchText =
      block.toolKind === 'file_change' && !isError
        ? extractUnifiedDiffText(detailText)
        : undefined
    return {
      kind: 'tool',
      text: patchText ?? block.detail!,
      isPatch: patchText !== undefined,
      isError,
      filePath: block.filePath
    }
  }
  if (block.kind === 'compaction') {
    const detailText = block.detail?.trim() ?? ''
    if (!detailText) return { kind: 'none' }
    if (summaryText && normalizeProcessText(detailText) === normalizeProcessText(summaryText)) {
      return { kind: 'none' }
    }
    return { kind: 'text', text: detailText }
  }
  if (block.kind === 'approval') return { kind: 'approval' }
  if (block.kind === 'approval_review') return { kind: 'approval_review' }
  if (block.kind === 'user_input') return { kind: 'user_input' }
  if (isBackgroundShellNoticeBlock(block)) return { kind: 'background_shell' }
  if (isBackgroundSubagentNoticeBlock(block)) return { kind: 'background_subagent' }
  if (block.kind === 'system' && block.text.trim()) {
    if (block.detail?.trim()) return { kind: 'text', text: block.detail }
    // Short system messages already fit in the summary line — skip the
    // expand affordance so we don't duplicate the same string.
    if (block.text.length <= 140) return { kind: 'none' }
    return { kind: 'text', text: block.text }
  }
  return { kind: 'none' }
}

export function ProcessEntryDetail({
  block,
  detail,
  processing,
  allowThreadActions = true
}: {
  block: ChatBlock
  detail: ProcessDetail
  processing: boolean
  allowThreadActions?: boolean
}): ReactElement | null {
  if (detail.kind === 'reasoning') {
    const streamReason = block.id === 'live-reasoning' && processing
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-muted">
        <AssistantMarkdown text={detail.text} streaming={streamReason} hideHtmlComments />
      </div>
    )
  }
  if (detail.kind === 'assistant') {
    return (
      <div className="ds-markdown text-[13.5px] leading-6 text-ds-ink">
        <AssistantMarkdown
          text={detail.text}
          streaming={processing && block.kind === 'assistant' && block.id === 'live-assistant'}
        />
      </div>
    )
  }
  if (detail.kind === 'tool') {
    if (block.kind === 'tool' && toolNameForBlock(block) === 'read_source_history' && !/^(codex|claude-code|opencode):/u.test(block.turnId ?? '')) {
      return <SourceHistoryReadDetail block={block} />
    }
    if (detail.isPatch) {
      return <DiffView patch={detail.text} filePath={detail.filePath} />
    }
    if (detail.isError) {
      return (
        <div className="overflow-hidden rounded-[10px] border border-orange-200/80 bg-orange-50/80 dark:border-orange-800/40 dark:bg-orange-500/10">
          {detail.filePath ? (
            <div className="border-b border-orange-200/70 bg-orange-100/50 px-3 py-1.5 font-mono text-[12px] text-orange-700 dark:border-orange-800/40 dark:bg-orange-500/15 dark:text-orange-300">
              {detail.filePath}
            </div>
          ) : null}
          <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words px-3 py-2.5 font-mono text-[12px] leading-6 text-orange-900 dark:text-orange-100">
            {detail.text}
          </pre>
        </div>
      )
    }
    if (
      block.kind === 'tool' &&
      toolNameForBlock(block) === 'knowledge_read' &&
      parseKnowledgeEvidence(block).length > 0
    ) {
      return <KnowledgeEvidenceDetail block={block} />
    }
    return (
      <pre className="max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[12px] leading-6 text-ds-ink">
        {detail.text}
      </pre>
    )
  }
  if (detail.kind === 'text') {
    return <p className="whitespace-pre-wrap text-[13.5px] leading-6 text-ds-muted">{detail.text}</p>
  }
  if (detail.kind === 'approval' && block.kind === 'approval') {
    return <MessageBubble block={block} nested allowThreadActions={allowThreadActions} />
  }
  if (detail.kind === 'approval_review' && block.kind === 'approval_review') {
    return <MessageBubble block={block} nested allowThreadActions={false} />
  }
  if (detail.kind === 'user_input' && block.kind === 'user_input') {
    return <MessageBubble block={block} nested allowThreadActions={allowThreadActions} />
  }
  if ((detail.kind === 'background_shell' || detail.kind === 'background_subagent') && block.kind === 'user') {
    return <MessageBubble block={block} nested allowThreadActions={allowThreadActions} />
  }
  return null
}

export function describeProcessBlock(
  block: ChatBlock,
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  if (block.kind === 'reasoning') {
    return t('thinkingLabel')
  }
  if (block.kind === 'assistant') {
    return t('processTextLabel')
  }
  if (block.kind === 'tool') {
    return summarizeToolBlock(block, t)
  }
  if (block.kind === 'user' && isBackgroundShellNoticeBlock(block)) {
    return block.meta?.displayText?.trim() || t('backgroundShellNotice.title', { defaultValue: 'Background shell completed' })
  }
  if (block.kind === 'user' && isBackgroundSubagentNoticeBlock(block)) {
    return block.meta?.displayText?.trim() || t('backgroundSubagentNotice.title', { defaultValue: 'Background subagent completed' })
  }
  if (block.kind === 'compaction') {
    if (block.variant === 'window') return t('contextWindowSwitched')
    if (block.status === 'running') return t('compactionRunning')
    if (block.status === 'error') return block.summary || t('compactionFailed')
    if (typeof block.messagesBefore === 'number' && typeof block.messagesAfter === 'number') {
      return t('compactionCompletedWithCounts', {
        before: block.messagesBefore,
        after: block.messagesAfter
      })
    }
    // `messagesBefore` carries the folded (released) token estimate. When known,
    // show it so a manual compaction reads as a concrete, attributable action.
    const releasedTokens = typeof block.messagesBefore === 'number' ? block.messagesBefore : 0
    if (releasedTokens > 0) {
      const tokens = releasedTokens.toLocaleString()
      return block.auto === true
        ? t('compactionAutoCompletedWithTokens', { tokens })
        : t('compactionManualCompletedWithTokens', { tokens })
    }
    return block.auto === true ? t('compactionAutoCompleted') : t('compactionManualCompleted')
  }
  if (block.kind === 'approval') {
    return block.summary || t('approvalTitle')
  }
  if (block.kind === 'approval_review') {
    if (block.status === 'in-progress') return t('approvalReviewInProgress')
    return block.summary || t('approvalReviewTitle')
  }
  if (block.kind === 'user_input') {
    return t('userInputTitle')
  }
  if (block.kind === 'system') {
    return block.text
  }
  return 'text' in block ? block.text : t('processed')
}
