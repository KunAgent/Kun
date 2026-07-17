import type { ModelStreamChunk } from '../../ports/model-client.js'

export type PendingToolCall = {
  index?: number
  name?: string
  /** Completed fixed-size blocks; never rejoined until the call completes. */
  argumentBlocks?: string[]
  /** Current block of provider deltas. */
  argumentParts: string[]
  argumentBytes: number
  argumentFragments: number
}

export const TOOL_ARGUMENT_PART_COMPACTION_WINDOW = 256
const TOOL_DIAGNOSTIC_NAME_MAX_CODE_POINTS = 96

export type ModelStreamLimits = {
  maxBufferBytes: number
  maxFrameBytes: number
  maxTotalBytes: number
  maxFrames: number
  maxOutputBytes: number
  maxPendingToolCalls: number
  maxPendingToolArgumentBytes: number
  maxTotalPendingToolArgumentBytes: number
  maxCompletedToolCalls: number
  maxCompletedToolArgumentBytes: number
}

export const DEFAULT_MODEL_STREAM_LIMITS: ModelStreamLimits = {
  maxBufferBytes: 20 * 1024 * 1024,
  maxFrameBytes: 16 * 1024 * 1024,
  maxTotalBytes: 32 * 1024 * 1024,
  maxFrames: 65_536,
  maxOutputBytes: 8 * 1024 * 1024,
  maxPendingToolCalls: 32,
  maxPendingToolArgumentBytes: 1 * 1024 * 1024,
  maxTotalPendingToolArgumentBytes: 4 * 1024 * 1024,
  maxCompletedToolCalls: 32,
  maxCompletedToolArgumentBytes: 4 * 1024 * 1024
}

export class ModelStreamResourceLimitError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ModelStreamResourceLimitError'
  }
}

export class ModelStreamResourceBudget {
  private totalBytes = 0
  private frames = 0
  private outputBytes = 0
  private pendingArgumentBytes = 0
  private pendingArgumentFragments = 0
  private pendingToolCalls = 0
  private completedToolCalls = 0
  private completedToolArgumentBytes = 0

  constructor(readonly limits: ModelStreamLimits) {}

  addInboundBytes(bytes: number): void {
    this.totalBytes += bytes
    if (this.totalBytes > this.limits.maxTotalBytes) {
      throw this.exceeded(`${this.limits.maxTotalBytes} total response bytes`)
    }
  }

  addFrame(bytes: number): void {
    this.frames += 1
    if (this.frames > this.limits.maxFrames) throw this.exceeded(`${this.limits.maxFrames} SSE frames`)
    if (bytes > this.limits.maxFrameBytes) throw this.exceeded(`${this.limits.maxFrameBytes} SSE frame bytes`)
  }

  pendingCall(
    pending: Map<string, PendingToolCall>,
    callId: string,
    index: number | undefined
  ): PendingToolCall {
    const existing = pending.get(callId)
    if (existing) {
      if (index !== undefined) existing.index = index
      return existing
    }
    if (pending.size >= this.limits.maxPendingToolCalls) {
      throw this.exceeded(`${this.limits.maxPendingToolCalls} pending tool calls`)
    }
    const created: PendingToolCall = {
      ...(index !== undefined ? { index } : {}),
      argumentBlocks: [],
      argumentParts: [],
      argumentBytes: 0,
      argumentFragments: 0
    }
    pending.set(callId, created)
    this.pendingToolCalls += 1
    return created
  }

  bindPendingIndex(pendingByIndex: Map<number, string>, index: number, callId: string): void {
    if (!pendingByIndex.has(index) && pendingByIndex.size >= this.limits.maxPendingToolCalls) {
      throw this.exceeded(`${this.limits.maxPendingToolCalls} pending tool-call indexes`)
    }
    pendingByIndex.set(index, callId)
  }

  appendArguments(pending: PendingToolCall, value: string): void {
    if (!value) return
    const bytes = Buffer.byteLength(value, 'utf8')
    this.assertPendingCapacity(pending, bytes)
    pending.argumentParts.push(value)
    pending.argumentBytes += bytes
    pending.argumentFragments += 1
    this.pendingArgumentBytes += bytes
    this.pendingArgumentFragments += 1
    if (pending.argumentParts.length >= TOOL_ARGUMENT_PART_COMPACTION_WINDOW) {
      const blocks = pending.argumentBlocks ?? (pending.argumentBlocks = [])
      blocks.push(pending.argumentParts.join(''))
      pending.argumentParts = []
    }
  }

  replaceArguments(pending: PendingToolCall, value: string): void {
    const bytes = value ? Buffer.byteLength(value, 'utf8') : 0
    const fragments = value ? 1 : 0
    this.assertPendingCapacity(
      pending,
      bytes - pending.argumentBytes,
      bytes,
      fragments
    )
    this.pendingArgumentBytes += bytes - pending.argumentBytes
    this.pendingArgumentFragments += fragments - pending.argumentFragments
    pending.argumentBlocks = []
    pending.argumentParts = value ? [value] : []
    pending.argumentBytes = bytes
    pending.argumentFragments = fragments
  }

  pendingArguments(pending: PendingToolCall): string {
    return [...(pending.argumentBlocks ?? []), ...pending.argumentParts].join('')
  }

  completeToolCall(argumentsRaw: string): void {
    const bytes = Buffer.byteLength(argumentsRaw, 'utf8')
    if (bytes > this.limits.maxPendingToolArgumentBytes) {
      throw this.exceeded(`${this.limits.maxPendingToolArgumentBytes} bytes for one tool argument`)
    }
    if (this.completedToolCalls + 1 > this.limits.maxCompletedToolCalls) {
      throw this.exceeded(`${this.limits.maxCompletedToolCalls} completed tool calls`)
    }
    if (this.completedToolArgumentBytes + bytes > this.limits.maxCompletedToolArgumentBytes) {
      throw this.exceeded(`${this.limits.maxCompletedToolArgumentBytes} completed tool-argument bytes`)
    }
    this.completedToolCalls += 1
    this.completedToolArgumentBytes += bytes
  }

  removePendingCall(
    pending: Map<string, PendingToolCall>,
    callId: string
  ): PendingToolCall | undefined {
    const value = pending.get(callId)
    if (!value) return undefined
    pending.delete(callId)
    this.pendingToolCalls = Math.max(0, this.pendingToolCalls - 1)
    this.pendingArgumentBytes = Math.max(0, this.pendingArgumentBytes - value.argumentBytes)
    this.pendingArgumentFragments = Math.max(0, this.pendingArgumentFragments - value.argumentFragments)
    return value
  }

  clearPendingCalls(pending: Map<string, PendingToolCall>): void {
    for (const callId of pending.keys()) this.removePendingCall(pending, callId)
  }

  addOutput(chunks: readonly ModelStreamChunk[]): void {
    let bytes = 0
    for (const chunk of chunks) {
      if (chunk.kind === 'assistant_text_delta' || chunk.kind === 'assistant_reasoning_delta') {
        bytes += Buffer.byteLength(chunk.text, 'utf8')
      }
    }
    if (this.outputBytes + bytes > this.limits.maxOutputBytes) {
      throw this.exceeded(`${this.limits.maxOutputBytes} response text and reasoning bytes`)
    }
    this.outputBytes += bytes
  }

  private assertPendingCapacity(
    pending: PendingToolCall,
    byteDelta: number,
    replacementBytes?: number,
    replacementFragments?: number
  ): void {
    const nextBytes = replacementBytes ?? pending.argumentBytes + byteDelta
    const nextFragments = replacementFragments ?? pending.argumentFragments + 1
    if (nextBytes > this.limits.maxPendingToolArgumentBytes) {
      throw this.exceeded(`${this.limits.maxPendingToolArgumentBytes} bytes for one tool argument`, pending, {
        nextArgumentBytes: nextBytes,
        nextArgumentFragments: nextFragments
      })
    }
    if (this.pendingArgumentBytes + byteDelta > this.limits.maxTotalPendingToolArgumentBytes) {
      throw this.exceeded(`${this.limits.maxTotalPendingToolArgumentBytes} total pending tool-argument bytes`, pending, {
        nextArgumentBytes: nextBytes,
        nextArgumentFragments: nextFragments
      })
    }
  }

  exceeded(
    detail: string,
    pending?: PendingToolCall,
    next?: { nextArgumentBytes: number; nextArgumentFragments: number }
  ): ModelStreamResourceLimitError {
    const argumentBytes = next?.nextArgumentBytes ?? pending?.argumentBytes ?? 0
    const argumentFragments = next?.nextArgumentFragments ?? pending?.argumentFragments ?? 0
    const pendingArgumentBytes = this.pendingArgumentBytes + (pending ? argumentBytes - pending.argumentBytes : 0)
    const pendingArgumentFragments = this.pendingArgumentFragments +
      (pending ? argumentFragments - pending.argumentFragments : 0)
    const toolContext = pending
      ? `, tool=${safeToolNameForDiagnostic(pending.name)}, argumentBytes=${argumentBytes}, fragments=${argumentFragments}`
      : ''
    return new ModelStreamResourceLimitError(
      `model stream exceeded ${detail} (responseBytes=${this.totalBytes}, frames=${this.frames}, pendingToolCalls=${this.pendingToolCalls}, pendingArgumentBytes=${pendingArgumentBytes}, pendingArgumentFragments=${pendingArgumentFragments}${toolContext})`
    )
  }
}

function safeToolNameForDiagnostic(value: string | undefined): string {
  if (!value) return 'unknown'
  let retained = ''
  let count = 0
  for (const character of value) {
    if (count >= TOOL_DIAGNOSTIC_NAME_MAX_CODE_POINTS) {
      retained += '…'
      break
    }
    const codePoint = character.codePointAt(0) ?? 0
    const unsafe =
      codePoint <= 0x1f ||
      (codePoint >= 0x7f && codePoint <= 0x9f) ||
      codePoint === 0x2028 ||
      codePoint === 0x2029 ||
      character === ',' ||
      character === '=' ||
      character === '(' ||
      character === ')'
    retained += unsafe ? '_' : character
    count += 1
  }
  return retained || 'unknown'
}
