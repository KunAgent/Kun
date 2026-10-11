import { AgentDispatchGroup, isAgentDispatchBlock } from './AgentDispatchCard'
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactElement, RefObject } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronDown,
  ChevronRight,
} from 'lucide-react'
import type { ChatBlock, ToolBlock } from '../../agent/types'
import { useDeferredRender } from '../../hooks/use-deferred-render'
import { DiffView } from '../DiffView'
import { AssistantMarkdown } from './AssistantMarkdown'
import { GeneratedFilesPanel } from './message-timeline-bubbles'
import {
  isBackgroundSubagentNoticeBlock
} from './message-timeline-turns'
import { TimelineVirtualList } from './TimelineVirtualList'
import { ToolStateMeta } from './ToolStateMeta'
import { useTimelineRowState } from './timeline-row-state'
import { BackgroundSubagentRowSummary, ToolCancelButton, processBlockIsActive, processBlockIsAutoOpenPending } from './message-timeline-process-controls'
import { SubagentGroup, type OpenChildThreadHandler } from './SubagentCallCard'
import {
  getReasoningSectionText,
  keepInteractiveProcessBlock,
  isPendingApproval,
  isRequestUserInputTool,
  processBlockErrorTone,
  processBlockHasGeneratedMedia,
  processErrorDotClass,
  processErrorTextClass,
  processSectionErrorTone,
  processSectionHasActiveWork,
  sectionHasDetails,
  sectionHasPendingApproval,
  sectionHasRequestUserInput,
  type ProcessSection
} from './message-timeline-process-grouping'
import {
  ProcessEntryDetail,
  RuntimeMetaBadges,
  describeProcessBlock,
  getProcessDetail,
  splitVerb,
  summarizeToolBlock
} from './message-timeline-process-detail'
import {
  ProcessGlyph,
  ProcessSummaryText,
  describeProcessSection,
  processBlockIcon,
  processSectionIcon
} from './message-timeline-process-summary'
import { CompactionTimelineEntry } from './message-timeline-compaction-entry'
export { CompactionTimelineEntry } from './message-timeline-compaction-entry'
export { summarizeToolBlock } from './message-timeline-process-detail'
export {
  describeProcessSection,
  summarizeProcessWork
} from './message-timeline-process-summary'

export {
  groupProcessSections,
  isSubagentBlock,
  processSectionHasActiveWork
} from './message-timeline-process-grouping'
export type { ProcessSection } from './message-timeline-process-grouping'

export function ProcessSectionRow({
  section,
  processing,
  reasoningDurationMs,
  singleReasoningSection,
  workspaceRoot,
  viewportRef,
  onOpenChildThread,
  onCancelToolCall,
  allowThreadActions = true
}: {
  section: ProcessSection
  processing: boolean
  reasoningDurationMs?: number
  singleReasoningSection: boolean
  workspaceRoot: string
  viewportRef: RefObject<HTMLDivElement | null>
  onOpenChildThread?: OpenChildThreadHandler
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
  allowThreadActions?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [userExpanded, setUserExpanded] = useTimelineRowState<boolean | null>('expanded', null)

  const assistantBlocks =
    section.kind === 'output'
      ? section.blocks.filter(
          (block): block is Extract<ChatBlock, { kind: 'assistant' }> => block.kind === 'assistant'
        )
      : []
  const hasDetails = sectionHasDetails(section, t)
  const active = processSectionHasActiveWork(section, processing)
  const errorTone = processSectionErrorTone(section.blocks)
  // Tool failures stay quiet on the batch header: only runtime/system errors
  // expand the group or tint the collapsed title. Inner rows keep their own tone.
  const hasRuntimeError = errorTone === 'error'
  // ConversationTurn owns the single live animation at the visual bottom.
  // Process sections stay quiet so reasoning cannot move that indicator back
  // into the historical timeline.
  const defaultExpanded =
    (processing && hasRuntimeError) ||
    sectionHasPendingApproval(section) ||
    (processing && section.kind === 'execution' && sectionHasRequestUserInput(section))
  const forceExpanded = sectionHasPendingApproval(section)
  const expanded = hasDetails && (forceExpanded || (userExpanded ?? defaultExpanded))
  const title = describeProcessSection(section, t, {
    processing,
    reasoningDurationMs,
    singleReasoningSection
  })
  const SectionIcon = processSectionIcon(section)
  const reasoningText = section.kind === 'reasoning' ? getReasoningSectionText(section) : ''
  const canToggleSection = hasDetails && !forceExpanded
  const showActiveError = active && hasRuntimeError
  const shouldDeferDetails = section.kind !== 'subagent'
  const { ref: deferredDetailRef, shouldRender: shouldRenderDetail } = useDeferredRender<HTMLDivElement>({
    enabled: shouldDeferDetails && expanded,
    immediate: shouldDeferDetails && (active || section.kind === 'execution'),
    root: viewportRef
  })

  if (section.blocks.some(isAgentDispatchBlock)) return <AgentDispatchGroup blocks={section.blocks} readOnly={!allowThreadActions} />

  if (section.kind === 'subagent') {
    return <SubagentGroup blocks={section.blocks} onOpenChildThread={onOpenChildThread} />
  }

  if (
    section.kind === 'execution' &&
    section.blocks.length === 1 &&
    section.blocks[0]?.kind !== 'reasoning'
  ) {
    const [block] = section.blocks
    if (block) {
      if (block.kind === 'compaction') {
        return <CompactionTimelineEntry block={block} processing={processing} />
      }
      return (
        <ProcessEntryRow
          block={block}
          processing={processing}
          workspaceRoot={workspaceRoot}
          onCancelToolCall={onCancelToolCall}
          allowThreadActions={allowThreadActions}
        />
      )
    }
  }

  if (section.kind === 'output') {
    return hasDetails ? (
      <div className="min-w-0">
        <div className="flex flex-col gap-2">
          {assistantBlocks.map((block) => (
            <ProcessEntryDetail
              key={block.id}
              block={block}
              detail={getProcessDetail(block)}
              processing={processing}
              allowThreadActions={allowThreadActions}
            />
          ))}
        </div>
      </div>
    ) : (
      <></>
    )
  }

  return (
    <div className="flex flex-col">
      {canToggleSection ? (
        <button
          type="button"
          onClick={() => setUserExpanded(!(userExpanded ?? defaultExpanded))}
          aria-expanded={expanded}
          className={`group flex w-fit max-w-full items-center gap-1.5 rounded-md py-0.5 text-left text-[14px] font-medium transition hover:opacity-85 ${
            hasRuntimeError ? processErrorTextClass(errorTone) : 'text-ds-muted'
          }`}
        >
          {showActiveError ? (
            <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
              <span className={`h-2 w-2 rounded-full ${processErrorDotClass(errorTone)}`} />
            </span>
          ) : null}
          {SectionIcon ? (
            <ProcessGlyph Icon={SectionIcon} />
          ) : null}
          <span className={active && !hasRuntimeError ? 'ds-shiny-text' : ''}>{title}</span>
          {expanded ? (
            <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-45" strokeWidth={1.8} />
          ) : (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-0 transition group-hover:opacity-55" strokeWidth={1.8} />
          )}
        </button>
      ) : (
        <div
          className={`flex w-fit max-w-full items-center gap-1.5 py-0.5 text-[14px] font-medium ${
            hasRuntimeError ? processErrorTextClass(errorTone) : 'text-ds-muted'
          }`}
        >
          {showActiveError ? (
            <span className="ds-work-logo-slot ds-work-logo-slot-sm mr-0.5">
              <span className={`h-2 w-2 rounded-full ${processErrorDotClass(errorTone)}`} />
            </span>
          ) : null}
          {SectionIcon ? (
            <ProcessGlyph Icon={SectionIcon} />
          ) : null}
          <span className={active && !hasRuntimeError ? 'ds-shiny-text' : ''}>{title}</span>
        </div>
      )}

      {expanded ? (
        <div
          ref={deferredDetailRef}
          className="mt-1"
          style={{ contentVisibility: 'auto', containIntrinsicSize: 'auto 220px' }}
        >
          {shouldRenderDetail ? (
            section.kind === 'reasoning' ? (
            <div className="ds-markdown text-[13.5px] leading-6 text-ds-faint">
              <AssistantMarkdown
                text={reasoningText}
                plainText={section.blocks.some((block) => block.renderMode === 'plain-text')}
                safeMarkdown={section.blocks.some((block) => block.renderMode === 'safe-markdown')}
                streaming={active && processing}
                hideHtmlComments
              />
            </div>
          ) : (
            <ProcessStackRows
              blocks={section.blocks}
              processing={processing}
              workspaceRoot={workspaceRoot}
              viewportRef={viewportRef}
              onCancelToolCall={onCancelToolCall}
              allowThreadActions={allowThreadActions}
            />
          )
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

const processBlockKey = (block: ChatBlock): string => block.id
const containsProcessBlock = (block: ChatBlock, blockId: string): boolean => block.id === blockId

function ProcessStackRows({
  blocks,
  processing,
  workspaceRoot,
  viewportRef,
  onCancelToolCall,
  allowThreadActions = true
}: {
  blocks: ChatBlock[]
  processing: boolean
  workspaceRoot: string
  viewportRef: RefObject<HTMLDivElement | null>
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
  allowThreadActions?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [openBlockId, setOpenBlockId] = useTimelineRowState<string | null>('openBlock', null)
  const [closedBlockIds, setClosedBlockIds] = useTimelineRowState<ReadonlySet<string>>('closedBlocks', new Set())

  return (
    <TimelineVirtualList items={blocks} viewportRef={viewportRef} itemKey={processBlockKey}
      keepMounted={keepInteractiveProcessBlock} containsBlock={containsProcessBlock} className="ds-work-stack">
      {(block) => {
        const summary = describeProcessBlock(block, t)
        const detail = getProcessDetail(block, summary)
        const canExpand = detail.kind !== 'none'
        const autoOpenRequestInput = processing && isRequestUserInputTool(block)
        const autoOpenPending = processBlockIsAutoOpenPending(block, processing) || isPendingApproval(block)
        const errorTone = processBlockErrorTone(block)
        const isError = errorTone !== null
        // Keep failed tool payloads tucked away while the turn continues. The
        // warning-toned row still surfaces the failure and remains expandable.
        const defaultOpen = processing && isError && block.kind !== 'tool'
        const forceOpen = autoOpenPending || autoOpenRequestInput
        const userClosed = closedBlockIds.has(block.id)
        const userOpened = openBlockId === block.id
        const open = canExpand && (forceOpen || userOpened || (defaultOpen && !userClosed))
        const rowActive = processBlockIsActive(block, processing)
        const canToggle = canExpand && !forceOpen
        const RowIcon = processBlockIcon(block)
        const isBackgroundSubagent = isBackgroundSubagentNoticeBlock(block)
        const handleToggle = (): void => {
          if (!canToggle) return
          if (open) {
            setOpenBlockId((id) => (id === block.id ? null : id))
            if (defaultOpen) {
              setClosedBlockIds((ids) => {
                const next = new Set(ids)
                next.add(block.id)
                return next
              })
            }
            return
          }
          setClosedBlockIds((ids) => {
            if (!ids.has(block.id)) return ids
            const next = new Set(ids)
            next.delete(block.id)
            return next
          })
          setOpenBlockId(block.id)
        }
        const handleToggleButton = (event: ReactMouseEvent<HTMLButtonElement>): void => {
          event.stopPropagation()
          handleToggle()
        }
        const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
          if (!canToggle) return
          if (event.key !== 'Enter' && event.key !== ' ') return
          event.preventDefault()
          handleToggle()
        }

        return (
          <div key={block.id} className="min-w-0" data-block-id={block.id}>
            <div
              role={canToggle ? 'button' : undefined}
              tabIndex={canToggle ? 0 : undefined}
              aria-expanded={canToggle ? open : undefined}
              onClick={handleToggle}
              onKeyDown={handleKeyDown}
              className={`group flex w-full min-w-0 items-center text-left text-[13.5px] leading-6 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
                isBackgroundSubagent
                  ? 'gap-2.5 rounded-[12px] border border-ds-border bg-ds-card/55 px-3 py-2.5 shadow-[0_2px_10px_rgba(42,52,72,0.035)]'
                  : 'gap-1.5 rounded-md px-1 py-0.5'
              } ${
                isError
                  ? processErrorTextClass(errorTone)
                  : 'text-ds-faint hover:text-ds-muted'
              } ${canToggle ? `cursor-pointer ${isBackgroundSubagent ? 'hover:border-ds-border-strong hover:bg-ds-card' : 'hover:bg-ds-hover/45'}` : 'cursor-default'}`}
            >
              {RowIcon ? <ProcessGlyph Icon={RowIcon} /> : null}
              {isBackgroundSubagent && block.kind === 'user' ? (
                <BackgroundSubagentRowSummary block={block} />
              ) : (
                <span className={`min-w-0 flex-1 truncate ${rowActive && !isError ? 'ds-shiny-text' : ''}`}>
                  <ProcessSummaryText block={block} summary={summary} workspaceRoot={workspaceRoot} />
                </span>
              )}
              {block.kind === 'tool' ? <ToolStateMeta block={block} /> : null}
              {canExpand ? (
                <button
                  type="button"
                  aria-label={open ? t('processCollapseDetail') : t('processExpandDetail')}
                  aria-expanded={open}
                  disabled={!canToggle}
                  onClick={handleToggleButton}
                  className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
                    canToggle ? 'cursor-pointer hover:bg-ds-hover/70' : 'cursor-default'
                  }`}
                >
                  {open ? (
                    <ChevronDown className="h-3 w-3 opacity-45" strokeWidth={2} />
                  ) : (
                    <ChevronRight className="h-3 w-3 opacity-45" strokeWidth={2} />
                  )}
                </button>
              ) : null}
              <ToolCancelButton block={block} processing={processing} onCancelToolCall={onCancelToolCall} />
            </div>
            {open ? (
              detail.kind === 'assistant' ? (
                <div className="ml-1 mt-1">
                  <ProcessEntryDetail
                    block={block}
                    detail={detail}
                    processing={processing}
                    allowThreadActions={allowThreadActions}
                  />
                </div>
              ) : (
                <div className="ds-work-timeline-detail ml-1">
                  <ProcessEntryDetail
                    block={block}
                    detail={detail}
                    processing={processing}
                    allowThreadActions={allowThreadActions}
                  />
                </div>
              )
            ) : null}
          </div>
        )
      }}
    </TimelineVirtualList>
  )
}

/**
 * A compaction (manual `/compact` or automatic context fold) is a durable
 * timeline event, not a generic tool row: it renders as a full-width divider
 * with its own status icon, trigger source, released-context meta line, and an
 * optional expandable summary so the folded context stays reviewable.
 */
/** One line inside an execution section. */
function ProcessEntryRow({
  block,
  processing,
  workspaceRoot,
  onCancelToolCall,
  allowThreadActions = true
}: {
  block: ChatBlock
  processing: boolean
  workspaceRoot: string
  onCancelToolCall?: (block: ToolBlock) => Promise<boolean>
  allowThreadActions?: boolean
}): ReactElement {
  const { t } = useTranslation('common')
  const [userOpen, setUserOpen] = useTimelineRowState<boolean | null>('expanded', null)
  const summary = describeProcessBlock(block, t)
  const detail = getProcessDetail(block, summary)
  const canExpand = detail.kind !== 'none'
  const isAssistantProcessText = block.kind === 'assistant'
  const isAutoOpenPending = processBlockIsAutoOpenPending(block, processing) || isPendingApproval(block)
  const isStreamingAssistant = processing && block.kind === 'assistant' && block.id === 'live-assistant'
  const errorTone = processBlockErrorTone(block)
  const isError = errorTone !== null
  const forceOpen = isAutoOpenPending || isAssistantProcessText || isStreamingAssistant
  // A tool failure should not interrupt the live process by expanding its
  // often verbose result. Runtime errors still open so they are not hidden.
  const defaultOpen = processing && isError && block.kind !== 'tool'
  const open =
    canExpand &&
    (forceOpen || (userOpen ?? defaultOpen))

  const { verb, rest } = splitVerb(summary)
  const rowActive = isAutoOpenPending || isStreamingAssistant
  const wrapSummary = (block.kind === 'system' && !canExpand) || isAssistantProcessText
  const canToggle = canExpand && !forceOpen
  const RowIcon = processBlockIcon(block)
  const isBackgroundSubagent = isBackgroundSubagentNoticeBlock(block)
  const showInlineGeneratedMedia = processing && processBlockHasGeneratedMedia(block)
  const handleToggle = (): void => {
    if (!canToggle) return
    setUserOpen(!open)
  }
  const handleToggleButton = (event: ReactMouseEvent<HTMLButtonElement>): void => {
    event.stopPropagation()
    handleToggle()
  }
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (!canToggle) return
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    handleToggle()
  }

  return (
    <div className="flex flex-col" data-block-id={block.id}>
      <div
        role={canToggle ? 'button' : undefined}
        tabIndex={canToggle ? 0 : undefined}
        aria-expanded={canToggle ? open : undefined}
        onClick={handleToggle}
        onKeyDown={handleKeyDown}
        className={`group flex w-full text-left text-[13.5px] leading-[1.55] transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/25 ${
          isBackgroundSubagent
            ? 'items-center gap-2.5 rounded-[12px] border border-ds-border bg-ds-card/55 px-3 py-2.5 shadow-[0_2px_10px_rgba(42,52,72,0.035)]'
            : 'items-start gap-2 rounded-md px-2 py-1'
        } ${
          isError
            ? processErrorTextClass(errorTone)
            : 'text-ds-faint hover:text-ds-ink'
        } ${
          canToggle
            ? `cursor-pointer ${isBackgroundSubagent ? 'hover:border-ds-border-strong hover:bg-ds-card' : 'hover:bg-ds-hover/70'}`
            : 'cursor-default'
        }`}
      >
        {RowIcon ? (
          <ProcessGlyph Icon={RowIcon} className="mt-1" />
        ) : null}
        {isBackgroundSubagent && block.kind === 'user' ? (
          <BackgroundSubagentRowSummary block={block} />
        ) : (
          <span
            role={block.kind === 'compaction' && block.status === 'running' ? 'status' : undefined}
            aria-live={block.kind === 'compaction' && block.status === 'running' ? 'polite' : undefined}
            data-compaction-timeline-entry={block.kind === 'compaction' ? 'true' : undefined}
            className={`min-w-0 flex-1 ${wrapSummary ? 'whitespace-pre-wrap break-words' : 'truncate'} ${
              rowActive && !isError ? 'ds-shiny-text' : ''
            }`}
          >
            <span
              className={`font-medium ${isError ? '' : rowActive ? '' : 'text-ds-muted'}`}
            >
              {verb}
            </span>
            {rest ? (
              <span className="ml-1.5 font-mono text-[13px]">
                <ProcessSummaryText block={block} summary={rest} workspaceRoot={workspaceRoot} />
              </span>
            ) : null}
          </span>
        )}
        {block.kind === 'tool' ? <ToolStateMeta block={block} /> : null}
        {canExpand ? (
          <button
            type="button"
            aria-label={open ? t('processCollapseDetail') : t('processExpandDetail')}
            aria-expanded={open}
            disabled={!canToggle}
            onClick={handleToggleButton}
            className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition ${
              canToggle ? 'cursor-pointer hover:bg-ds-hover/70' : 'cursor-default'
            }`}
          >
            {open ? (
              <ChevronDown className="h-3 w-3 opacity-45" strokeWidth={2} />
            ) : (
              <ChevronRight className="h-3 w-3 opacity-45" strokeWidth={2} />
            )}
          </button>
        ) : null}
        <ToolCancelButton block={block} processing={processing} onCancelToolCall={onCancelToolCall} />
      </div>
      <RuntimeMetaBadges block={block} t={t} />
      {canExpand && open ? (
        detail.kind === 'assistant' ? (
          <div className="mt-1">
            <ProcessEntryDetail
              block={block}
              detail={detail}
              processing={processing}
              allowThreadActions={allowThreadActions}
            />
          </div>
        ) : (
          <div className="ds-work-timeline-detail">
            <ProcessEntryDetail
              block={block}
              detail={detail}
              processing={processing}
              allowThreadActions={allowThreadActions}
            />
          </div>
        )
      ) : null}
      {showInlineGeneratedMedia ? (
        <div className="ml-2 mt-2">
          <GeneratedFilesPanel blocks={[block]} placement="timeline" />
        </div>
      ) : null}
    </div>
  )
}
