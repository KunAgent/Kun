import type { TurnItem } from '../../contracts/items.js'
import type { ModelRequest } from '../../ports/model-client.js'
import { isToolResultBridgeItem, repairModelHistoryItems } from '../../domain/model-history-repair.js'
import { extractToolResultImages, toolResultTextWithoutImages } from '../../loop/tool-result-image.js'
import { wrapUntrustedContent } from '../../security/untrusted-content.js'
import type { CompatChatMessage, CompatChatMessageContentPart } from './compat-request-codecs.js'
import { userMessageTextWithComposerContexts } from '../../domain/composer-context.js'

export type CompatMessageProjectionOptions = {
  historyLimit?: number
  thinkingMode: boolean
  supportsImages: boolean
}

/**
 * Pure projection from persisted turn items and per-turn attachments to the
 * provider-neutral chat message representation consumed by endpoint codecs.
 */
export function projectCompatMessages(
  request: ModelRequest,
  options: CompatMessageProjectionOptions
): CompatChatMessage[] {
  return new CompatMessageProjector(options).project(request)
}

class CompatMessageProjector {
  constructor(private readonly options: CompatMessageProjectionOptions) {}

  project(request: ModelRequest): CompatChatMessage[] {
    const out: CompatChatMessage[] = []
    if (request.systemPrompt) out.push({ role: 'system', content: request.systemPrompt })
    if (request.modeInstruction) out.push({ role: 'system', content: request.modeInstruction })
    const history = this.options.historyLimit
      ? limitHistoryPreservingCompaction(request.history, this.options.historyLimit)
      : request.history
    out.push(...this.itemsToMessages(
      repairModelHistoryItems([...request.prefix, ...history]),
      this.options.thinkingMode,
      this.options.supportsImages
    ))
    for (const instruction of request.contextInstructions ?? []) {
      if (instruction.trim()) out.push({ role: 'system', content: instruction })
    }
    if (request.attachments?.length) attachImagesToLatestUserMessage(out, request.attachments)
    if (request.attachmentTextFallbacks?.length) {
      attachTextFallbacksToLatestUserMessage(out, request.attachmentTextFallbacks)
    }
    if (request.attachmentDocuments?.length) {
      attachDocumentsToLatestUserMessage(out, request.attachmentDocuments)
    }
    return normalizeThinkingAssistantMessages(healToolMessagePairs(out), this.options.thinkingMode)
  }

  private itemsToMessages(items: TurnItem[], thinkingMode: boolean, supportsImages: boolean): CompatChatMessage[] {
    const out: CompatChatMessage[] = []
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index]
      if (isBridgeItemBeforeToolCall(items, index)) {
        continue
      }
      if (thinkingMode && item?.kind === 'assistant_reasoning') {
        const next = items[index + 1]
        if (next?.kind === 'assistant_text' && next.turnId === item.turnId) {
          out.push({
            role: 'assistant',
            content: next.text,
            reasoning_content: reasoningContentOrSpace(item.text)
          })
          index += 1
        }
        continue
      }
      if (item?.kind === 'tool_call') {
        const block = this.toolCallBlockToMessages(items, index, thinkingMode, supportsImages)
        if (block) {
          out.push(...block.messages)
          index = block.nextIndex - 1
        }
        continue
      }
      if (item?.kind === 'tool_result') continue
      const message = this.itemToMessage(item, thinkingMode, supportsImages)
      if (message) out.push(message)
    }
    return out
  }

  private toolCallBlockToMessages(
    items: TurnItem[],
    startIndex: number,
    thinkingMode: boolean,
    supportsImages: boolean
  ): { messages: CompatChatMessage[]; nextIndex: number } | null {
    const calls: Extract<TurnItem, { kind: 'tool_call' }>[] = []
    let index = startIndex
    while (index < items.length && items[index]?.kind === 'tool_call') {
      calls.push(items[index] as Extract<TurnItem, { kind: 'tool_call' }>)
      index += 1
    }
    if (calls.length === 0) return null

    const turnId = calls[0]?.turnId ?? ''
    const expectedCallIds = new Set(calls.map((call) => call.callId))
    const seenResultIds = new Set<string>()
    const resultMessages: CompatChatMessage[] = []
    const assistantText: string[] = []
    const reasoningText: string[] = []
    let bridgeIndex = startIndex - 1
    while (bridgeIndex >= 0) {
      const item = items[bridgeIndex]
      if (!item || !isPreToolCallBridgeItem(item, turnId)) break
      if (item.kind === 'assistant_text' && item.text.trim()) {
        assistantText.unshift(item.text)
      } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
        reasoningText.unshift(item.text)
      }
      bridgeIndex -= 1
    }
    let sawResult = false
    while (index < items.length) {
      const item = items[index]
      if (!item) break
      if (item.kind === 'tool_result') {
        sawResult = true
        if (expectedCallIds.has(item.callId) && !seenResultIds.has(item.callId)) {
          seenResultIds.add(item.callId)
          resultMessages.push(this.toolResultToMessage(item, supportsImages))
        }
        index += 1
        continue
      }
      if (isToolResultBridgeItem(item, { turnId, sawResult })) {
        if (!sawResult) {
          if (item.kind === 'assistant_text' && item.text.trim()) {
            assistantText.push(item.text)
          } else if (item.kind === 'assistant_reasoning' && item.text.trim()) {
            reasoningText.push(item.text)
          }
        }
        index += 1
        continue
      }
      break
    }

    if (![...expectedCallIds].every((callId) => seenResultIds.has(callId))) {
      return null
    }
    return {
      messages: [
        {
          role: 'assistant',
          content: assistantText.length > 0 ? assistantText.join('\n') : '',
          ...(thinkingMode ? { reasoning_content: reasoningContentOrSpace(reasoningText.join('\n')) } : {}),
          tool_calls: calls.map((call) => this.toolCallToWire(call))
        },
        ...resultMessages
      ],
      nextIndex: index
    }
  }

  private toolCallToWire(item: Extract<TurnItem, { kind: 'tool_call' }>): NonNullable<CompatChatMessage['tool_calls']>[number] {
    return {
      id: item.callId,
      type: 'function',
      function: { name: item.toolName, arguments: JSON.stringify(item.arguments) }
    }
  }

  private toolResultToMessage(
    item: Extract<TurnItem, { kind: 'tool_result' }>,
    supportsImages: boolean
  ): CompatChatMessage {
    const images = extractToolResultImages(item.output)
    if (images.length > 0) {
      const text = toolResultTextWithoutImages(item.output)
      // A non-vision model/provider rejects image parts; send the metadata
      // as text and drop the base64 (it is useless to a text-only model).
      if (!supportsImages) {
        return {
          role: 'tool',
          content: text || '(image omitted: the active model has no image input)',
          tool_call_id: item.callId
        }
      }
      const parts: CompatChatMessageContentPart[] = []
      if (text) parts.push({ type: 'text', text })
      for (const image of images) {
        parts.push({
          type: 'image_url',
          image_url: { url: `data:${image.mimeType};base64,${image.dataBase64}` }
        })
      }
      return { role: 'tool', content: parts, tool_call_id: item.callId }
    }
    return {
      role: 'tool',
      content: toolResultContent(item.output),
      tool_call_id: item.callId
    }
  }

  /**
   * Whether the resolved model accepts image input. Tool-result images are
   * only forwarded as real image parts to vision models; text-only models
   * get a text summary instead. Defaults to true when no capability
   * resolver is configured (the runtime always sets one).
   */
  private itemToMessage(item: TurnItem, thinkingMode: boolean, supportsImages: boolean): CompatChatMessage | null {
    switch (item.kind) {
      case 'user_message':
        return { role: 'user', content: userMessageTextWithComposerContexts(item) }
      case 'assistant_text':
        return {
          role: 'assistant',
          content: item.text,
          ...(thinkingMode ? { reasoning_content: ' ' } : {})
        }
      case 'assistant_reasoning':
        return null
      case 'tool_call':
        return {
          role: 'assistant',
          content: '',
          ...(thinkingMode ? { reasoning_content: ' ' } : {}),
          tool_calls: [this.toolCallToWire(item)]
        }
      case 'tool_result':
        return this.toolResultToMessage(item, supportsImages)
      case 'compaction':
        return item.replacedTokens > 0
          ? { role: 'system', content: `Conversation summary from earlier turns:\n${item.summary}` }
          : null
      case 'review':
        return item.status === 'completed' && item.reviewText?.trim()
          ? { role: 'system', content: `Code review result from an earlier turn:\n${item.reviewText}` }
          : null
      case 'approval':
      case 'user_input':
      case 'error':
        return null
    }
  }
}

function reasoningContentOrSpace(text: string): string {
  return text.trim() ? text : ' '
}

function toolResultContent(output: unknown): string {
  if (typeof output === 'string') return output
  return JSON.stringify(output) ?? ''
}

function isPreToolCallBridgeItem(item: TurnItem, turnId: string): boolean {
  if (item.turnId !== turnId) return false
  return item.kind === 'assistant_reasoning' || item.kind === 'assistant_text'
}

function isBridgeItemBeforeToolCall(items: TurnItem[], index: number): boolean {
  const item = items[index]
  if (!item || (item.kind !== 'assistant_reasoning' && item.kind !== 'assistant_text')) {
    return false
  }
  let cursor = index + 1
  while (cursor < items.length) {
    const next = items[cursor]
    if (!next) return false
    if (next.kind === 'assistant_reasoning' || next.kind === 'assistant_text') {
      if (next.turnId !== item.turnId) return false
      cursor += 1
      continue
    }
    return next.kind === 'tool_call' && next.turnId === item.turnId
  }
  return false
}

function normalizeThinkingAssistantMessages(
  messages: CompatChatMessage[],
  thinkingMode: boolean
): CompatChatMessage[] {
  if (!thinkingMode) return messages
  return messages.map((message) => {
    if (message.role !== 'assistant') return message
    const next = { ...message }
    if (next.content == null) next.content = ''
    if (
      !Object.prototype.hasOwnProperty.call(next, 'reasoning_content') ||
      next.reasoning_content == null ||
      !next.reasoning_content.trim()
    ) {
      next.reasoning_content = ' '
    }
    return next
  })
}

function healToolMessagePairs(messages: CompatChatMessage[]): CompatChatMessage[] {
  const healed: CompatChatMessage[] = []
  for (let i = 0; i < messages.length; i += 1) {
    const message = messages[i]
    if (message.role === 'tool') {
      continue
    }
    if (message.role === 'assistant' && message.tool_calls?.length) {
      const expectedIds = new Set(message.tool_calls.map((call) => call.id))
      const toolResults: CompatChatMessage[] = []
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        const toolResult = messages[j]
        if (toolResult.tool_call_id && expectedIds.has(toolResult.tool_call_id)) {
          toolResults.push(toolResult)
        }
        j += 1
      }
      const seenIds = new Set(toolResults.map((toolResult) => toolResult.tool_call_id))
      if ([...expectedIds].every((id) => seenIds.has(id))) {
        healed.push(message, ...toolResults)
      }
      i = j - 1
      continue
    }
    healed.push(message)
  }
  return healed
}

function attachImagesToLatestUserMessage(
  messages: CompatChatMessage[],
  attachments: NonNullable<ModelRequest['attachments']>
): void {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    const parts: CompatChatMessageContentPart[] = []
    if (typeof message.content === 'string' && message.content) {
      parts.push({ type: 'text', text: message.content })
    }
    for (const attachment of attachments) {
      parts.push({
        type: 'image_url',
        image_url: {
          url: `data:${attachment.mimeType};base64,${attachment.dataBase64}`
        }
      })
    }
    message.content = parts
    return
  }
}

function attachTextFallbacksToLatestUserMessage(
  messages: CompatChatMessage[],
  attachments: NonNullable<ModelRequest['attachmentTextFallbacks']>
): void {
  const text = attachments.map(formatAttachmentTextFallback).join('\n\n')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = message.content ? `${message.content}\n\n${text}` : text
      return
    }
    if (Array.isArray(message.content)) {
      message.content.push({ type: 'text', text })
      return
    }
    message.content = text
    return
  }
}

function attachDocumentsToLatestUserMessage(
  messages: CompatChatMessage[],
  documents: NonNullable<ModelRequest['attachmentDocuments']>
): void {
  const text = documents.map(formatAttachmentDocument).join('\n\n')
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.content === 'string') {
      message.content = message.content ? `${message.content}\n\n${text}` : text
      return
    }
    if (Array.isArray(message.content)) {
      message.content.push({ type: 'text', text })
      return
    }
    message.content = text
    return
  }
}

function formatAttachmentDocument(
  document: NonNullable<ModelRequest['attachmentDocuments']>[number]
): string {
  return [
    '[Attached document]',
    `Name: ${document.name}`,
    `FilePath: ${document.localFilePath ?? 'unknown'}`,
    `MIME: ${document.mimeType}`,
    ...(document.pageCount ? [`Pages: ${document.pageCount}`] : []),
    ...(document.truncated ? ['Note: text truncated to fit the context limit'] : []),
    'Content:',
    wrapUntrustedContent({
      content: document.text,
      source: { kind: 'document', label: document.name }
    }),
    '[/Attached document]'
  ].join('\n')
}

function formatAttachmentTextFallback(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  return [
    '[Attached image as base64 text]',
    `Name: ${attachment.name}`,
    `FilePath: ${attachment.localFilePath ?? 'unknown'}`,
    `MIME: ${attachment.mimeType}`,
    `Dimensions: ${formatAttachmentDimensions(attachment)}`,
    `Bytes: ${attachment.byteSize}`,
    'Base64:',
    '```base64',
    attachment.dataBase64,
    '```',
    '[/Attached image]'
  ].join('\n')
}

function formatAttachmentDimensions(
  attachment: NonNullable<ModelRequest['attachmentTextFallbacks']>[number]
): string {
  return attachment.width && attachment.height ? `${attachment.width}x${attachment.height}` : 'unknown'
}

function limitHistoryPreservingCompaction(history: TurnItem[], windowSize: number): TurnItem[] {
  if (history.length <= windowSize) return history
  const windowStart = history.length - windowSize
  const limited = history.slice(windowStart)
  if (limited.some((item) => item.kind === 'compaction' && item.replacedTokens > 0)) {
    return limited
  }
  for (let index = windowStart - 1; index >= 0; index -= 1) {
    const item = history[index]
    if (item.kind !== 'compaction' || item.replacedTokens === 0) continue
    return windowSize <= 1 ? [item] : [item, ...history.slice(-(windowSize - 1))]
  }
  return limited
}
