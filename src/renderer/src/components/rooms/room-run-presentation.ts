import type { CoreTurnItemJson } from '../../agent/kun-contract-runtime'

/**
 * Presentation transform for recorded room-run items.
 *
 * Room runs record the exact model prompt as their `user_message`, which is an
 * internal envelope (bounded history JSON, reply reference, "User message:"
 * section, content references, setup prompt). The inspector renders the shared
 * conversation timeline, so this projects items onto their user-facing form:
 *
 * - `user_message` gains `displayText` carrying only the real message body.
 *   New runs record `displayText` at admission; the extraction keeps older
 *   records readable.
 * - A completed `send_im_message` call becomes an assistant bubble carrying the
 *   delivered text, and its tool_result pair is dropped; failed or in-flight
 *   calls stay visible as ordinary tool cards.
 * - Legacy decision-envelope assistant text (`[{author,status,text}]`) is
 *   unwrapped to the message bodies.
 * - Provider error payloads embedded in error messages are reduced to their
 *   inner message.
 */

const USER_MESSAGE_MARKER = 'User message:\n'
const TRAILING_SECTION_MARKERS = [
  '\n\nThis is the result of your scoped collaboration',
  '\n\nUser supplied content references: ',
  '\n\nYou are helping the user define a new persistent personal Agent'
]
const SEND_IM_MESSAGE_TOOL = 'send_im_message'

export function roomUserDisplayText(text: string): string {
  const index = text.indexOf(USER_MESSAGE_MARKER)
  if (index < 0) return ''
  const body = text.slice(index + USER_MESSAGE_MARKER.length)
  let end = body.length
  for (const marker of TRAILING_SECTION_MARKERS) {
    const at = body.indexOf(marker)
    if (at >= 0 && at < end) end = at
  }
  return body.slice(0, end).trim()
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return undefined
  }
}

function unwrapDecisionEnvelope(text: string | undefined): string {
  const trimmed = text?.trim() ?? ''
  if (!trimmed.startsWith('{') && !trimmed.startsWith('[')) return ''
  try {
    const parsed: unknown = JSON.parse(trimmed)
    const entries = Array.isArray(parsed) ? parsed : [parsed]
    if (
      entries.length === 0 ||
      !entries.every(
        (entry) =>
          !!entry && typeof entry === 'object' && typeof (entry as { text?: unknown }).text === 'string'
      )
    ) {
      return ''
    }
    const texts = entries.map((entry) => (entry as { text: string }).text.trim()).filter(Boolean)
    return texts.length ? texts.join('\n\n') : ''
  } catch {
    return ''
  }
}

function imMessageText(item: CoreTurnItemJson): string {
  const raw = item.arguments
  const args = typeof raw === 'string' ? safeParse(raw) : raw
  if (!args || typeof args !== 'object') return ''
  const record = args as Record<string, unknown>
  const text = typeof record.text === 'string' ? record.text.trim() : ''
  const names = Array.isArray(record.attachments)
    ? record.attachments
        .map((entry) => {
          if (!entry || typeof entry !== 'object') return ''
          const record = entry as { fileName?: unknown; path?: unknown }
          const name = typeof record.fileName === 'string' ? record.fileName.trim() : ''
          if (name) return name
          const path = typeof record.path === 'string' ? record.path.trim() : ''
          return path.split('/').pop() ?? ''
        })
        .filter(Boolean)
    : []
  return [text, ...names.map((name) => `[${name}]`)].filter(Boolean).join('\n')
}

function cleanErrorMessage(message: string | undefined): string | undefined {
  const source = message?.trim()
  if (!source) return message
  const brace = source.indexOf('{')
  if (brace < 0) return message
  try {
    const parsed: unknown = JSON.parse(source.slice(brace))
    if (!parsed || typeof parsed !== 'object') return message
    const record = parsed as { error?: { message?: unknown }; message?: unknown }
    const inner =
      (record.error && typeof record.error === 'object' ? record.error.message : undefined) ??
      record.message
    if (typeof inner !== 'string' || !inner.trim()) return message
    return `${source.slice(0, brace).replace(/[:\s]+$/u, '')}: ${inner.trim()}`
  } catch {
    return message
  }
}

export function presentRoomRunItems(items: CoreTurnItemJson[]): CoreTurnItemJson[] {
  const imResults = new Map<string, CoreTurnItemJson>()
  for (const item of items) {
    if (item.kind === 'tool_result' && item.toolName === SEND_IM_MESSAGE_TOOL && item.callId) {
      imResults.set(item.callId, item)
    }
  }
  const convertedImCalls = new Set<string>()
  const presented: CoreTurnItemJson[] = []
  for (const item of items) {
    if (item.kind === 'user_message' && !item.displayText?.trim()) {
      const display = roomUserDisplayText(item.text ?? '')
      presented.push(display && display !== item.text?.trim() ? { ...item, displayText: display } : item)
      continue
    }
    if (item.kind === 'assistant_text') {
      const unwrapped = unwrapDecisionEnvelope(item.text)
      presented.push(unwrapped ? { ...item, text: unwrapped } : item)
      continue
    }
    if (item.kind === 'tool_call' && item.toolName === SEND_IM_MESSAGE_TOOL && item.callId) {
      const result = imResults.get(item.callId)
      const failed = result ? result.isError === true || result.status === 'failed' : false
      const text = imMessageText(item)
      if (result && !failed && text) {
        convertedImCalls.add(item.callId)
        presented.push({
          ...item,
          kind: 'assistant_text',
          role: 'assistant',
          toolName: undefined,
          callId: undefined,
          arguments: undefined,
          text
        })
        continue
      }
      presented.push(item)
      continue
    }
    if (
      item.kind === 'tool_result' &&
      item.toolName === SEND_IM_MESSAGE_TOOL &&
      item.callId &&
      convertedImCalls.has(item.callId)
    ) {
      continue
    }
    if (item.kind === 'error' && item.message) {
      const cleaned = cleanErrorMessage(item.message)
      presented.push(cleaned && cleaned !== item.message ? { ...item, message: cleaned } : item)
      continue
    }
    presented.push(item)
  }
  return presented
}
