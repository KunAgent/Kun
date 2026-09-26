import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import type { LucideIcon } from 'lucide-react'
import {
  ArrowRightLeft,
  BellRing,
  Bot,
  BookOpen,
  Brain,
  FolderOpen,
  ListTodo,
  MessageSquareQuote,
  Minimize2,
  PencilLine,
  Search,
  Sparkles,
  Terminal,
  Users,
  Wrench
} from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { openWorkspacePathInEditor } from '../../lib/open-workspace-path'
import { previewWorkspaceFile } from '../../lib/workspace-file-preview'
import {
  blockHasPendingRuntimeWork,
  isBackgroundShellNoticeBlock,
  isBackgroundSubagentNoticeBlock,
  isWorkerUpdateNoticeBlock
} from './message-timeline-turns'
import { formatDuration, isBackgroundShellCommandBlock } from './message-timeline-tools'
import {
  processSectionHasActiveWork,
  type ProcessSection
} from './message-timeline-process-grouping'
import {
  describeProcessBlock,
  summarizeToolBlock,
  toolFilePath,
  toolNameForBlock
} from './message-timeline-process-detail'

export function ProcessGlyph({
  Icon,
  className = 'mt-0.5'
}: {
  Icon: LucideIcon
  className?: string
}): ReactElement {
  return <Icon className={`${className} h-3.5 w-3.5 shrink-0 opacity-75`} strokeWidth={1.9} />
}

export function describeProcessSection(
  section: ProcessSection,
  t: (key: string, opts?: Record<string, unknown>) => string,
  opts: {
    processing: boolean
    reasoningDurationMs?: number
    singleReasoningSection: boolean
  }
): string {
  if (section.kind === 'reasoning') {
    if (opts.processing && processSectionHasActiveWork(section, true)) {
      return t('thinkingNow')
    }
    if (
      opts.singleReasoningSection &&
      typeof opts.reasoningDurationMs === 'number' &&
      opts.reasoningDurationMs >= 1000
    ) {
      return t('thoughtFor', { duration: formatDuration(opts.reasoningDurationMs) })
    }
    return section.blocks.length > 1
      ? t('thoughtSteps', { count: section.blocks.length })
      : t('thinkingLabel')
  }

  if (section.kind === 'output') {
    return t('processTextLabel')
  }

  if (opts.processing && processSectionHasActiveWork(section, true)) {
    const activeBlock = [...section.blocks].reverse().find(
      (block) =>
        block.id === 'live-reasoning' ||
        block.id === 'live-assistant' ||
        blockHasPendingRuntimeWork(block)
    )
    const phase = activeBlock
      ? activeBlock.kind === 'reasoning'
        ? t('thinkingNow')
        : activeBlock.kind === 'tool'
          ? t('workingToolAction', { action: summarizeToolBlock(activeBlock, t) })
          : describeProcessBlock(activeBlock, t)
      : t('processing')
    const workSummary = summarizeProcessWork(section.blocks, t)
    return workSummary ? `${phase} · ${workSummary}` : phase
  }

  if (section.blocks.length === 1) {
    return describeProcessBlock(section.blocks[0], t)
  }

  return summarizeProcessWork(section.blocks, t) || t('processSteps', { count: section.blocks.length })
}

/** A compact, activity-based recap for a collapsed process phase. */
export function summarizeProcessWork(
  blocks: ChatBlock[],
  t: (key: string, opts?: Record<string, unknown>) => string
): string {
  let readCount = 0
  let searchCount = 0
  let fileCount = 0
  let commandCount = 0
  let backgroundCommandCount = 0
  let toolCount = 0
  let approvalCount = 0

  for (const block of blocks) {
    if (block.kind === 'approval' || block.kind === 'approval_review') {
      approvalCount += 1
      continue
    }
    if (block.kind !== 'tool') continue
    if (block.toolKind === 'file_change') {
      fileCount += 1
    } else if (block.toolKind === 'command_execution') {
      if (isBackgroundShellCommandBlock(block)) {
        backgroundCommandCount += 1
      } else {
        commandCount += 1
      }
    } else if (isReadToolBlock(block)) {
      readCount += 1
    } else if (isSearchToolBlock(block)) {
      searchCount += 1
    } else {
      toolCount += 1
    }
  }

  const parts: string[] = []
  if (readCount > 0) {
    parts.push(readCount === 1 ? t('groupReadFile') : t('groupReadFiles', { count: readCount }))
  }
  if (searchCount > 0) {
    parts.push(searchCount === 1 ? t('groupSearchedOnce') : t('groupSearched', { count: searchCount }))
  }
  if (fileCount > 0) {
    parts.push(
      fileCount === 1 ? t('groupEditedFile') : t('groupEditedFiles', { count: fileCount })
    )
  }
  if (backgroundCommandCount > 0) {
    parts.push(
      backgroundCommandCount === 1
        ? t('groupRanBackgroundCommand')
        : t('groupRanBackgroundCommands', { count: backgroundCommandCount })
    )
  }
  if (commandCount > 0) {
    parts.push(
      commandCount === 1
        ? t('groupRanCommand')
        : t('groupRanCommands', { count: commandCount })
    )
  }
  if (toolCount > 0) {
    parts.push(toolCount === 1 ? t('groupUsedTool') : t('groupUsedTools', { count: toolCount }))
  }
  if (approvalCount > 0) {
    parts.push(
      approvalCount === 1 ? t('groupApproval') : t('groupApprovals', { count: approvalCount })
    )
  }

  return parts.join(' · ')
}

export function isReadToolBlock(block: ToolBlock): boolean {
  const toolName = toolNameForBlock(block)
  return toolName === 'read' || toolName === 'read_file'
}

export function isSearchToolBlock(block: ToolBlock): boolean {
  const toolName = toolNameForBlock(block)
  return (
    toolName === 'grep' ||
    toolName === 'grep_files' ||
    toolName === 'search' ||
    toolName === 'search_files' ||
    toolName === 'find'
  )
}

export function processSectionIcon(section: ProcessSection): LucideIcon | null {
  if (section.kind === 'reasoning') return Brain
  if (section.kind === 'output') return MessageSquareQuote

  const toolIcons = section.blocks
    .map(processBlockIcon)
    .filter((icon): icon is LucideIcon => icon !== null)
  if (toolIcons.length === 0) return null
  const [first] = toolIcons
  return toolIcons.every((icon) => icon === first) ? first : Wrench
}

export function processBlockIcon(block: ChatBlock): LucideIcon | null {
  if (block.kind === 'reasoning') return Brain
  if (block.kind === 'assistant') return MessageSquareQuote
  if (block.kind === 'compaction') return Minimize2
  if (block.kind === 'handoff') return ArrowRightLeft
  if (block.kind === 'approval') return Wrench
  if (block.kind === 'approval_review') return Bot
  if (block.kind === 'user_input') return MessageSquareQuote
  if (isBackgroundShellNoticeBlock(block)) return BellRing
  if (isBackgroundSubagentNoticeBlock(block)) return Sparkles
  if (isWorkerUpdateNoticeBlock(block)) return Users
  if (block.kind !== 'tool') return null
  return toolBlockIcon(block)
}

export function toolBlockIcon(block: ToolBlock): LucideIcon {
  const toolName = toolNameForBlock(block)
  switch (toolName) {
    case 'bash':
    case 'shell':
    case 'terminal':
    case 'run_command':
    case 'exec':
      return Terminal
    case 'read':
    case 'read_file':
      return BookOpen
    case 'write':
    case 'write_file':
    case 'edit':
    case 'edit_file':
    case 'apply_patch':
    case 'create_file':
      return PencilLine
    case 'grep':
    case 'grep_files':
    case 'search':
    case 'search_files':
    case 'find':
      return Search
    case 'ls':
    case 'list':
    case 'list_dir':
      return FolderOpen
    case 'create_plan':
    case 'update_plan':
      return ListTodo
    default:
      break
  }

  if (block.toolKind === 'command_execution') return Terminal
  if (block.toolKind === 'file_change') return PencilLine
  return Wrench
}

export function ProcessFileReference({
  path,
  workspaceRoot,
  children
}: {
  path: string
  workspaceRoot: string
  children: string
}): ReactElement {
  const { t } = useTranslation('common')

  const stopRowToggle = (event: ReactMouseEvent<HTMLElement>): void => {
    event.stopPropagation()
  }

  const preview = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    previewWorkspaceFile({ path, workspaceRoot })
  }

  const openInEditor = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.preventDefault()
    event.stopPropagation()
    void openWorkspacePathInEditor({ path }, workspaceRoot).then((result) => {
      if (!result.ok) {
        void window.kunGui?.logError?.('editor-open', 'Failed to open process file reference', {
          message: result.message,
          target: { path, workspaceRoot }
        })?.catch(() => undefined)
      }
    })
  }

  return (
    <button
      type="button"
      className="ds-process-file-reference"
      title={t('processFileReferenceHint')}
      onClick={preview}
      onDoubleClick={openInEditor}
      onMouseDown={stopRowToggle}
    >
      {children}
    </button>
  )
}

export function ProcessSummaryText({
  block,
  summary,
  workspaceRoot
}: {
  block: ChatBlock
  summary: string
  workspaceRoot: string
}): ReactElement {
  if (block.kind !== 'tool') return <>{summary}</>
  const path = toolFilePath(block)
  if (!path) return <>{summary}</>
  const index = summary.indexOf(path)
  if (index < 0) return <>{summary}</>
  const before = summary.slice(0, index)
  const after = summary.slice(index + path.length)
  return (
    <>
      {before}
      <ProcessFileReference path={path} workspaceRoot={workspaceRoot}>{path}</ProcessFileReference>
      {after}
    </>
  )
}
