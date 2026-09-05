import type { UsageSnapshot } from '../../contracts/usage.js'
import type { ModelStreamChunk } from '../../ports/model-client.js'
import {
  ModelStreamResourceBudget,
  type PendingToolCall
} from './model-stream-resource-budget.js'
import { resolvePendingToolCall } from './tool-call-stream-identity.js'

type MaterializedResponses = {
  chunks: ModelStreamChunk[]
  finishReason: 'stop' | 'tool_calls' | 'length' | 'error'
  usage: UsageSnapshot | null
}

/**
 * Tracks output/content identities across delta, output-item completion, and
 * response.completed fallback forms. Deltas are streamed incrementally, so
 * they only suppress a later full-item copy; they never suppress later delta
 * fragments for the same content block.
 */
export type ResponsesContentTracker = {
  completedIdentities: Set<string>
  /** Text already emitted for each content block, used to stream only a done-item suffix. */
  deltaTextByIdentity: Map<string, string>
}

export function createResponsesContentTracker(): ResponsesContentTracker {
  return {
    completedIdentities: new Set(),
    deltaTextByIdentity: new Map()
  }
}

export function decodeResponsesStreamPayload(input: {
  payload: Record<string, unknown>
  pendingArguments: Map<string, PendingToolCall>
  pendingByIndex: Map<number, string>
  completedToolCalls: Set<string>
  sawTextDelta: boolean
  contentTracker: ResponsesContentTracker
  budget: ModelStreamResourceBudget
  parseToolArguments: (raw: string) => Record<string, unknown>
  normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
}): {
  chunks: ModelStreamChunk[]
  sawTextDelta: boolean
  finishReason: string | null
  usage: UsageSnapshot | null
} {
  const chunks: ModelStreamChunk[] = []
  let sawText = input.sawTextDelta
  let finishReason: string | null = null
  let usage: UsageSnapshot | null = null
  const type = recordString(input.payload, 'type')
  const outputIndex = numericIndex(input.payload.output_index)
  const item = recordValue(input.payload, 'item') ?? recordValue(input.payload, 'output_item')
  if (item) {
    const itemType = recordString(item, 'type')
    if (itemType === 'image_generation_call' && type === 'response.output_item.done') {
      const result = recordString(item, 'result')
      if (result) chunks.push({ kind: 'image_generation_complete', imageBase64: result, mimeType: 'image/png' })
    } else if (itemType === 'function_call' || itemType === 'custom_tool_call') {
      const { callId, pending } = resolvePendingToolCall({
        explicitId: recordString(item, 'call_id') || recordString(item, 'id') || undefined,
        ...(outputIndex !== undefined ? { index: outputIndex } : {}),
        pending: input.pendingArguments,
        pendingByIndex: input.pendingByIndex,
        budget: input.budget
      })
      const name = recordString(item, 'name')
      if (name) pending.name = name
      const initialArguments = recordString(item, 'arguments') || recordString(item, 'input')
      if (initialArguments && (type === 'response.output_item.done' || pending.argumentBytes === 0)) {
        input.budget.replaceArguments(pending, initialArguments)
      }
      if (type === 'response.output_item.done' && pending.name) {
        const raw = input.budget.pendingArguments(pending)
        input.budget.completeToolCall(raw)
        chunks.push({
          kind: 'tool_call_complete', callId, toolName: pending.name,
          arguments: input.parseToolArguments(raw || '{}')
        })
        input.completedToolCalls.add(callId)
        input.budget.removePendingCall(input.pendingArguments, callId)
        if (pending.index !== undefined) input.pendingByIndex.delete(pending.index)
      }
    } else if (type === 'response.output_item.done') {
      const contentChunks = materializeResponsesItemContent({
        item,
        outputIndex,
        tracker: input.contentTracker,
        source: 'done'
      })
      if (contentChunks.some((chunk) => chunk.kind === 'assistant_text_delta')) sawText = true
      chunks.push(...contentChunks)
    }
  }
  if (type === 'response.output_text.delta') {
    const delta = recordString(input.payload, 'delta')
    if (delta) {
      sawText = true
      appendResponsesDelta(input.contentTracker, responseContentIdentityAliases(input.payload, 'text'), delta)
      chunks.push({ kind: 'assistant_text_delta', text: delta })
    }
  } else if (
    type === 'response.reasoning_text.delta' ||
    type === 'response.reasoning_summary_text.delta' ||
    type === 'response.reasoning.delta'
  ) {
    const delta = recordString(input.payload, 'delta')
    if (delta) {
      appendResponsesDelta(input.contentTracker, responseContentIdentityAliases(input.payload, 'reasoning'), delta)
      chunks.push({ kind: 'assistant_reasoning_delta', text: delta })
    }
  } else if (type === 'response.function_call_arguments.delta') {
    const { callId, pending } = resolvePendingToolCall({
      explicitId: recordString(input.payload, 'call_id') || recordString(input.payload, 'item_id') || undefined,
      ...(outputIndex !== undefined ? { index: outputIndex } : {}),
      pending: input.pendingArguments,
      pendingByIndex: input.pendingByIndex,
      budget: input.budget
    })
    const delta = recordString(input.payload, 'delta')
    if (outputIndex !== undefined) input.budget.bindPendingIndex(input.pendingByIndex, outputIndex, callId)
    if (delta) {
      input.budget.appendArguments(pending, delta)
      chunks.push({ kind: 'tool_call_delta', callId, toolName: pending.name, argumentsDelta: delta })
    }
  } else if (type === 'response.function_call_arguments.done') {
    const { pending } = resolvePendingToolCall({
      explicitId: recordString(input.payload, 'call_id') || recordString(input.payload, 'item_id') || undefined,
      ...(outputIndex !== undefined ? { index: outputIndex } : {}),
      pending: input.pendingArguments,
      pendingByIndex: input.pendingByIndex,
      budget: input.budget
    })
    const args = recordString(input.payload, 'arguments')
    if (args) input.budget.replaceArguments(pending, args)
  } else if (type === 'response.completed') {
    const response = recordValue(input.payload, 'response') ?? input.payload
    const materialized = materializeResponsesOutput(response, {
      skipText: sawText,
      contentTracker: input.contentTracker,
      pendingArguments: input.pendingArguments,
      completedToolCalls: input.completedToolCalls,
      budget: input.budget,
      parseToolArguments: input.parseToolArguments,
      normalizeUsage: input.normalizeUsage
    })
    chunks.push(...materialized.chunks)
    if (materialized.chunks.some((chunk) => chunk.kind === 'assistant_text_delta')) sawText = true
    usage = materialized.usage
    finishReason = materialized.finishReason
  } else if (type === 'response.failed' || type === 'error') {
    const providerError = responseError(input.payload)
    chunks.push({
      kind: 'error',
      message: providerError.message,
      code: providerError.code,
      failure: {
        category: /overload|capacity|unavailable/i.test(`${providerError.code} ${providerError.message}`)
          ? 'unavailable'
          : 'unknown',
        responseReceived: true,
        ...(providerError.providerCode ? { providerCode: providerError.providerCode } : {}),
        failoverAllowed: false
      }
    })
    finishReason = 'error'
  }
  return { chunks, sawTextDelta: sawText, finishReason, usage }
}

function materializeResponsesOutput(
  payload: Record<string, unknown>,
  options: {
    skipText: boolean
    contentTracker: ResponsesContentTracker
    pendingArguments: Map<string, PendingToolCall>
    completedToolCalls: Set<string>
    budget: ModelStreamResourceBudget
    parseToolArguments: (raw: string) => Record<string, unknown>
    normalizeUsage: (usage: Record<string, unknown>) => UsageSnapshot
  }
): MaterializedResponses {
  const chunks: ModelStreamChunk[] = []
  let sawToolCall = options.completedToolCalls.size > 0
  const output = Array.isArray(payload.output) ? payload.output : []
  let materializedText = false
  for (const [outputIndex, value] of output.entries()) {
    const item = value && typeof value === 'object' && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null
    if (!item) continue
    const itemType = recordString(item, 'type')
    const contentChunks = materializeResponsesItemContent({
      item,
      outputIndex,
      tracker: options.contentTracker,
      source: 'completed'
    })
    if (contentChunks.some((chunk) => chunk.kind === 'assistant_text_delta')) materializedText = true
    chunks.push(...contentChunks)
    if (itemType !== 'function_call' && itemType !== 'custom_tool_call') continue
    const callId = recordString(item, 'call_id') || recordString(item, 'id')
    const toolName = recordString(item, 'name')
    if (!callId || !toolName || options.completedToolCalls.has(callId)) continue
    sawToolCall = true
    const argsRaw = recordString(item, 'arguments') || recordString(item, 'input') || '{}'
    options.budget.completeToolCall(argsRaw)
    if (options.pendingArguments.has(callId)) {
      options.budget.removePendingCall(options.pendingArguments, callId)
    }
    options.completedToolCalls.add(callId)
    chunks.push({
      kind: 'tool_call_complete',
      callId,
      toolName,
      arguments: options.parseToolArguments(argsRaw)
    })
  }
  if (!options.skipText && !materializedText) {
    const outputText = recordString(payload, 'output_text')
    const identity = 'text:response:output_text'
    if (outputText && !options.contentTracker.completedIdentities.has(identity)) {
      options.contentTracker.completedIdentities.add(identity)
      chunks.push({ kind: 'assistant_text_delta', text: outputText })
    }
  }
  const usagePayload = recordValue(payload, 'usage')
  const usage = usagePayload ? options.normalizeUsage(usagePayload) : null
  let finishReason: MaterializedResponses['finishReason'] = sawToolCall ? 'tool_calls' : 'stop'
  const status = recordString(payload, 'status')
  if (status === 'incomplete') {
    const incomplete = recordValue(payload, 'incomplete_details')
    finishReason = recordString(incomplete ?? {}, 'reason') === 'max_output_tokens' ? 'length' : 'error'
  } else if (status === 'failed') {
    finishReason = 'error'
  }
  return { chunks, finishReason, usage }
}

function materializeResponsesItemContent(input: {
  item: Record<string, unknown>
  outputIndex: number | undefined
  tracker: ResponsesContentTracker
  source: 'done' | 'completed'
}): ModelStreamChunk[] {
  const chunks: ModelStreamChunk[] = []
  const itemType = recordString(input.item, 'type')
  const itemIdentity = recordString(input.item, 'id') ||
    recordString(input.item, 'item_id') ||
    `output:${input.outputIndex ?? 'unknown'}`
  const contentGroups: Array<{ kind: 'content' | 'summary'; values: unknown[] }> = []
  if (Array.isArray(input.item.content)) contentGroups.push({ kind: 'content', values: input.item.content })
  if (Array.isArray(input.item.summary)) contentGroups.push({ kind: 'summary', values: input.item.summary })
  if (contentGroups.length === 0 && recordString(input.item, 'text')) {
    contentGroups.push({ kind: 'content', values: [input.item] })
  }
  for (const group of contentGroups) {
    for (const [contentIndex, value] of group.values.entries()) {
      const block = value && typeof value === 'object' && !Array.isArray(value)
        ? value as Record<string, unknown>
        : null
      if (!block) continue
      const text = recordString(block, 'text') || recordString(block, 'summary')
      if (!text) continue
      const blockType = recordString(block, 'type')
      const kind = responseContentKind(itemType, blockType, group.kind)
      if (!kind) continue
      const identities = responseItemContentIdentityAliases({
        kind,
        itemIdentity,
        outputIndex: input.outputIndex,
        group: group.kind,
        contentIndex
      })
      const anonymousIdentity = responseAnonymousContentIdentity(kind, group.kind, contentIndex)
      if (
        identities.some((identity) => input.tracker.completedIdentities.has(identity)) ||
        input.tracker.completedIdentities.has(anonymousIdentity)
      ) continue
      const exactDeltaText = identities
        .map((identity) => input.tracker.deltaTextByIdentity.get(identity))
        .find((value): value is string => value !== undefined)
      const anonymousDeltaText = exactDeltaText === undefined
        ? input.tracker.deltaTextByIdentity.get(anonymousIdentity)
        : undefined
      const deltaText = exactDeltaText ?? anonymousDeltaText
      const textToEmit = deltaText === undefined ? text : text.slice(overlapLength(deltaText, text))
      for (const identity of identities) input.tracker.completedIdentities.add(identity)
      if (anonymousDeltaText !== undefined || identities.includes(anonymousIdentity)) {
        input.tracker.completedIdentities.add(anonymousIdentity)
      }
      if (textToEmit) {
        chunks.push(kind === 'text'
          ? { kind: 'assistant_text_delta', text: textToEmit }
          : { kind: 'assistant_reasoning_delta', text: textToEmit })
      }
    }
  }
  return chunks
}

function responseContentKind(
  itemType: string,
  blockType: string,
  group: 'content' | 'summary'
): 'text' | 'reasoning' | null {
  if (
    itemType === 'reasoning' ||
    group === 'summary' ||
    blockType === 'reasoning' ||
    blockType === 'reasoning_text' ||
    blockType === 'reasoning_summary' ||
    blockType === 'reasoning_summary_text' ||
    blockType === 'summary_text' ||
    blockType === 'thinking'
  ) return 'reasoning'
  if (blockType === 'output_text' || blockType === 'text' || !blockType) return 'text'
  return null
}

function responseContentIdentityAliases(
  payload: Record<string, unknown>,
  kind: 'text' | 'reasoning'
): string[] {
  const outputIndex = numericIndex(payload.output_index)
  const itemId = recordString(payload, 'item_id') || `output:${outputIndex ?? 'unknown'}`
  const contentIndex = numericIndex(payload.content_index) ?? 0
  const type = recordString(payload, 'type')
  const group = kind === 'reasoning' && type.includes('summary') ? 'summary' : 'content'
  return responseItemContentIdentityAliases({
    kind,
    itemIdentity: itemId,
    outputIndex,
    group,
    contentIndex
  })
}

function appendResponsesDelta(
  tracker: ResponsesContentTracker,
  identities: readonly string[],
  delta: string
): void {
  for (const identity of identities) {
    tracker.deltaTextByIdentity.set(identity, `${tracker.deltaTextByIdentity.get(identity) ?? ''}${delta}`)
  }
}

function responseAnonymousContentIdentity(
  kind: 'text' | 'reasoning',
  group: 'content' | 'summary',
  contentIndex: number
): string {
  return `${kind}:output:unknown:${group}:${contentIndex}`
}

function responseItemContentIdentityAliases(input: {
  kind: 'text' | 'reasoning'
  itemIdentity: string
  outputIndex: number | undefined
  group: 'content' | 'summary'
  contentIndex: number
}): string[] {
  const primary = `${input.kind}:${input.itemIdentity}:${input.group}:${input.contentIndex}`
  if (!input.itemIdentity.startsWith('output:') && input.outputIndex !== undefined) {
    return [primary, `${input.kind}:output:${input.outputIndex}:${input.group}:${input.contentIndex}`]
  }
  return [primary]
}

/** Longest suffix of already-streamed text that is a prefix of the final item. */
function overlapLength(previous: string, finalText: string): number {
  const max = Math.min(previous.length, finalText.length)
  for (let length = max; length > 0; length -= 1) {
    if (previous.slice(-length) === finalText.slice(0, length)) return length
  }
  return 0
}

function responseError(payload: Record<string, unknown>): {
  message: string
  code: string
  providerCode?: string
} {
  const error = recordValue(payload, 'error') ?? recordValue(recordValue(payload, 'response') ?? {}, 'error')
  const providerCode = error ? recordString(error, 'code') : ''
  return {
    message: (error ? recordString(error, 'message') : '') || recordString(payload, 'message') ||
      'model stream reported an error',
    code: providerCode || 'response_stream_error',
    ...(providerCode ? { providerCode } : {})
  }
}

function recordString(record: Record<string, unknown>, key: string): string {
  return typeof record[key] === 'string' ? record[key] : ''
}

function recordValue(record: Record<string, unknown>, key: string): Record<string, unknown> | null {
  const value = record[key]
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

function numericIndex(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : undefined
}
