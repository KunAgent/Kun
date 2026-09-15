import { isPublicTurnItem, type TurnItem } from '../contracts/items.js'
import type { ItemHistoryPage, ItemHistoryPageOptions } from '../ports/session-store.js'

const TIMELINE_ITEM_PREVIEW_CHARS = 64 * 1024
const TIMELINE_ARRAY_PREVIEW_ITEMS = 32

/** Build a renderer-safe newest history window without changing durable data. */
export function buildPublicItemHistoryPage(
  items: readonly TurnItem[],
  options: ItemHistoryPageOptions
): ItemHistoryPage {
  const publicItems = items.filter(isPublicTurnItem)
  const maxItems = Math.max(1, Math.floor(options.maxItems))
  const maxBytes = Math.max(1, Math.floor(options.maxBytes))
  const cursorIndex = options.before
    ? publicItems.findIndex((item) => item.id === options.before)
    : publicItems.length
  const endExclusive = cursorIndex >= 0 ? cursorIndex : publicItems.length
  const selected: TurnItem[] = []
  let itemBytes = 0
  let windowStartIndex = endExclusive

  for (let index = endExclusive - 1; index >= 0 && selected.length < maxItems; index -= 1) {
    const item = timelineSafeItem(publicItems[index]!, maxBytes)
    const bytes = serializedBytes(item)
    if (selected.length > 0 && itemBytes + bytes > maxBytes) break
    selected.push(item)
    itemBytes += bytes
    windowStartIndex = index
  }

  selected.reverse()

  // A running turn can emit more process items than the page budget. Without
  // an anchor its opening user message would land on an older page while the
  // renderer refuses to page back during a busy turn, hiding the active
  // request. Keep the first real user_message of the anchor turn pinned in
  // front and trim the continuous window from the oldest side so the page
  // still honors the item/byte budget.
  let anchorIndex = -1
  if (!options.before && options.anchorTurnId) {
    anchorIndex = publicItems.findIndex(
      (item) => item.turnId === options.anchorTurnId && item.kind === 'user_message'
    )
    if (anchorIndex >= 0 && anchorIndex < windowStartIndex) {
      const anchorItem = timelineSafeItem(publicItems[anchorIndex]!, maxBytes)
      const anchorBytes = serializedBytes(anchorItem)
      while (
        selected.length > 0 &&
        (selected.length + 1 > maxItems || itemBytes + anchorBytes > maxBytes)
      ) {
        const dropped = selected.shift()!
        itemBytes -= serializedBytes(dropped)
        windowStartIndex += 1
      }
      selected.unshift(anchorItem)
      itemBytes += anchorBytes
    } else {
      anchorIndex = -1
    }
  }

  // The cursor is the boundary item of the retained continuous window (the
  // anchor's own position only when the window was fully trimmed), so the
  // next older page covers the anchor and any items between it and the
  // window. The renderer deduplicates by item id, so the anchor is never
  // duplicated in the merged transcript.
  const anchored = anchorIndex >= 0
  const cursorItem = anchored && selected.length > 1 ? selected[1] : selected[0]
  const boundaryIndex = anchored && selected.length > 1
    ? windowStartIndex
    : (anchored ? anchorIndex : windowStartIndex)
  const hasMore = boundaryIndex > 0
  return {
    items: selected,
    ...(hasMore && cursorItem ? { nextCursor: cursorItem.id } : {}),
    hasMore,
    itemBytes
  }
}

/**
 * Tool payloads can legally be much larger than a timeline page. Preserve the
 * stable lifecycle envelope while replacing only display-heavy content with a
 * bounded preview. Canonical history remains untouched.
 */
export function timelineSafeItem(item: TurnItem, maxBytes: number): TurnItem {
  if (serializedBytes(item) <= maxBytes) return item
  const preview = timelinePreviewItem(item, maxBytes)
  return serializedBytes(preview) <= maxBytes
    ? preview
    : minimalTimelineItem(item)
}

function timelinePreviewItem(item: TurnItem, maxBytes: number): TurnItem {
  const textLimit = Math.max(1_024, Math.min(TIMELINE_ITEM_PREVIEW_CHARS, maxBytes / 2))
  switch (item.kind) {
    case 'user_message':
      return {
        ...item,
        text: truncateText(item.text, textLimit),
        ...(item.displayText ? { displayText: truncateText(item.displayText, textLimit) } : {}),
        attachmentIds: item.attachmentIds?.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS),
        composerContexts: undefined,
        fileReferences: item.fileReferences?.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS)
      }
    case 'assistant_text':
    case 'assistant_reasoning':
      return { ...item, text: truncateText(item.text, textLimit) }
    case 'model_context':
    case 'runtime_context_source':
      return item
    case 'tool_call':
      return {
        ...item,
        arguments: { __timelineTruncated: true },
        providerMetadata: undefined,
        summary: truncateText(item.summary ?? `${item.toolName} call`, textLimit)
      }
    case 'tool_result':
      return {
        ...item,
        output: {
          __timelineTruncated: true,
          preview: truncateText(stringifyPreview(item.output), textLimit)
        }
      }
    case 'approval':
      return {
        ...item,
        summary: truncateText(item.summary, textLimit),
        ...(item.reason ? { reason: truncateText(item.reason, textLimit) } : {})
      }
    case 'user_input':
      return {
        ...item,
        prompt: truncateText(item.prompt, textLimit),
        questions: item.questions.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS).map((question) => ({
          ...question,
          question: truncateText(question.question, textLimit),
          options: question.options.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS).map((option) => ({
            label: truncateText(option.label, 1_024),
            description: truncateText(option.description, 4_096)
          }))
        })),
        answers: item.answers?.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS)
      }
    case 'compaction':
      return {
        ...item,
        summary: truncateText(item.summary, textLimit),
        pinnedConstraints: item.pinnedConstraints
          .slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS)
          .map((value) => truncateText(value, 4_096)),
        sourceItemIds: item.sourceItemIds?.slice(0, TIMELINE_ARRAY_PREVIEW_ITEMS)
      }
    case 'review':
      return {
        ...item,
        reviewText: item.reviewText ? truncateText(item.reviewText, textLimit) : undefined,
        output: undefined
      }
    case 'error':
      return {
        ...item,
        message: truncateText(item.message, textLimit),
        details: { __timelineTruncated: true }
      }
    case 'goal_context':
    case 'interruption_note':
    case 'context_window':
      return item
  }
}

/** Last-resort schema-valid envelope for variants with large nested metadata. */
function minimalTimelineItem(item: TurnItem): TurnItem {
  const marker = '[timeline item truncated]'
  switch (item.kind) {
    case 'user_message':
      return { ...minimalTimelineItemBase(item), kind: item.kind, text: marker }
    case 'assistant_text':
      return { ...minimalTimelineItemBase(item), kind: item.kind, text: marker }
    case 'assistant_reasoning':
      return { ...minimalTimelineItemBase(item), kind: item.kind, text: marker }
    case 'model_context':
    case 'runtime_context_source':
      return item
    case 'tool_call':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        toolName: truncateText(item.toolName, 1_024),
        callId: truncateText(item.callId, 1_024),
        toolKind: item.toolKind,
        arguments: { __timelineTruncated: true },
        summary: marker
      }
    case 'tool_result':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        toolName: truncateText(item.toolName, 1_024),
        callId: truncateText(item.callId, 1_024),
        toolKind: item.toolKind,
        output: { __timelineTruncated: true },
        isError: item.isError
      }
    case 'approval':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        approvalId: truncateText(item.approvalId, 1_024),
        toolName: truncateText(item.toolName, 1_024),
        summary: marker,
        status: item.status
      }
    case 'user_input':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        inputId: truncateText(item.inputId, 1_024),
        prompt: marker,
        questions: [],
        status: item.status
      }
    case 'compaction':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        summary: marker,
        replacedTokens: item.replacedTokens,
        pinnedConstraints: []
      }
    case 'review':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        target: { kind: 'custom', instructions: marker },
        title: truncateText(item.title, 1_024),
        reviewText: marker
      }
    case 'error':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        message: marker,
        ...(item.code ? { code: truncateText(item.code, 1_024) } : {}),
        ...(item.severity ? { severity: item.severity } : {})
      }
    case 'goal_context':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        role: 'system',
        status: 'completed',
        text: marker
      }
    case 'interruption_note':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        role: 'system',
        status: 'completed',
        sourceTurnId: truncateText(item.sourceTurnId, 1_024),
        text: marker
      }
    case 'context_window':
      return {
        ...minimalTimelineItemBase(item),
        kind: item.kind,
        schemaVersion: item.schemaVersion,
        windowId: truncateText(item.windowId, 1_024),
        previousWindowId: item.previousWindowId
          ? truncateText(item.previousWindowId, 1_024)
          : item.previousWindowId,
        reason: item.reason,
        sourceHistoryRevision: item.sourceHistoryRevision,
        splitBefore: item.splitBefore,
        initializationRef: truncateText(item.initializationRef, 1_024),
        operationId: truncateText(item.operationId, 1_024),
        replacedTokens: item.replacedTokens
      }
  }
}

type MinimalTimelineItemBase<T extends TurnItem> = Pick<
  T,
  'id' | 'turnId' | 'threadId' | 'role' | 'status' | 'createdAt' | 'finishedAt'
>

function minimalTimelineItemBase<T extends TurnItem>(item: T): MinimalTimelineItemBase<T> {
  return {
    id: item.id,
    turnId: item.turnId,
    threadId: item.threadId,
    role: item.role,
    status: item.status,
    createdAt: item.createdAt,
    ...(item.finishedAt ? { finishedAt: item.finishedAt } : {})
  } as MinimalTimelineItemBase<T>
}

function truncateText(value: string, maxChars: number): string {
  return value.length <= maxChars
    ? value
    : `${value.slice(0, Math.max(0, maxChars - 24))}\n... [timeline truncated]`
}

function stringifyPreview(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value)
  } catch {
    return String(value)
  }
}

function serializedBytes(value: unknown): number {
  return Buffer.byteLength(JSON.stringify(value), 'utf-8')
}
