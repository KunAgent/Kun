import { ChevronRight, FileImage } from 'lucide-react'
import type { ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import styles from './TrajectoryRawBlocks.module.css'

type RawBlock = {
  type: string
  content?: unknown
  itemId?: string
  attachmentId?: string
  callId?: string
  toolName?: string
}

const TEXT_KINDS = new Set([
  'text', 'thinking', 'reasoning', 'context', 'summary', 'compacted', 'error',
  'user_message', 'assistant_text', 'assistant_reasoning',
  'goal_context', 'model_context', 'runtime_context_source', 'interruption_note'
])
const TOOL_KINDS = new Set(['tool-call', 'tool_call', 'tool-result', 'tool_result'])
const ATTACHMENT_KINDS = new Set(['attachment', 'image'])
const SENSITIVE_KEY = /authorization|(?:^|[-_])auth(?:entication)?(?:$|[-_])|api[-_]?key|access[-_]?key(?:[-_]?id)?|cookie|credential|password|secret|token|signature|providerMetadata|aws[-_]?(?:session[-_]?token|access[-_]?key)/i
const BASE64_VALUE = /^(?:data:[^;,]+;base64,)?[a-z0-9+/]{160,}={0,2}$/i

export function TrajectoryRawBlocks({
  content,
  threadId,
  onSelectToolCall
}: {
  content: unknown
  threadId: string
  onSelectToolCall?: (callId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  void threadId
  const blocks = normalizeBlocks(content)
  if (!blocks.length) {
    return <div className={styles.empty}>{t('trajectoryRawEmpty')}</div>
  }
  return (
    <div className={styles.root} data-testid="trajectory-raw-blocks">
      {blocks.map((block, index) => (
        <RawBlockView
          key={`${block.itemId ?? block.callId ?? block.attachmentId ?? block.type}:${index}`}
          block={block}
          index={index}
          onSelectToolCall={onSelectToolCall}
        />
      ))}
    </div>
  )
}

function RawBlockView({
  block,
  index,
  onSelectToolCall
}: {
  block: RawBlock
  index: number
  onSelectToolCall?: (callId: string) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const type = displayType(block.type)
  if (ATTACHMENT_KINDS.has(block.type)) {
    return (
      <section className={styles.block} data-block-type={block.type} data-trajectory-raw-block="">
        <BlockHeader label={t('trajectoryRawBlockLabel', { index: index + 1, type })} />
        <div className={styles.attachment}><FileImage aria-hidden="true" /><code>{block.attachmentId}</code></div>
      </section>
    )
  }
  if (TOOL_KINDS.has(block.type)) {
    const open = block.callId && onSelectToolCall
      ? () => onSelectToolCall(block.callId!)
      : undefined
    return (
      <section className={styles.block} data-block-type={block.type} data-trajectory-raw-block="">
        <BlockHeader
          label={t('trajectoryRawBlockLabel', { index: index + 1, type })}
          onOpen={open}
          title={block.toolName ?? t('trajectoryRawToolCall')}
        />
        <pre className={styles.structured}>{safeJson(block.content)}</pre>
      </section>
    )
  }
  return (
    <section className={styles.block} data-block-type={block.type} data-trajectory-raw-block="">
      <BlockHeader label={t('trajectoryRawBlockLabel', { index: index + 1, type })} />
      <pre className={block.type === 'reasoning' || block.type === 'thinking' ? `${styles.text} ${styles.reasoning}` : styles.text}>
        {typeof block.content === 'string' ? block.content : safeJson(block.content)}
      </pre>
    </section>
  )
}

function BlockHeader({
  label,
  onOpen,
  title
}: {
  label: string
  onOpen?: () => void
  title?: string
}): ReactElement {
  const content = <><span>{label}</span>{onOpen ? <ChevronRight aria-hidden="true" /> : null}</>
  return onOpen
    ? <button type="button" className={styles.blockJump} onClick={onOpen} title={title}>{content}</button>
    : <div className={styles.blockHeader} title={title}>{content}</div>
}

function normalizeBlocks(value: unknown): RawBlock[] {
  if (isRecord(value) && Array.isArray(value.blocks)) {
    return value.blocks.flatMap(normalizeWireBlock)
  }
  if (Array.isArray(value)) return value.flatMap(normalizeLegacyItem)
  return normalizeLegacyItem(value)
}

function normalizeWireBlock(value: unknown): RawBlock[] {
  if (!isRecord(value) || typeof value.type !== 'string') return []
  const type = normalizeType(value.type)
  if (!TEXT_KINDS.has(type) && !TOOL_KINDS.has(type) && !ATTACHMENT_KINDS.has(type)) return []
  if (ATTACHMENT_KINDS.has(type)) {
    const attachmentId = stringField(value, 'attachmentId')
    return attachmentId ? [{ type, attachmentId, itemId: stringField(value, 'itemId') }] : []
  }
  return [{
    type,
    content: textContent(type, value.content),
    itemId: stringField(value, 'itemId'),
    callId: stringField(value, 'callId'),
    toolName: stringField(value, 'toolName')
  }]
}

function normalizeLegacyItem(value: unknown): RawBlock[] {
  if (!isRecord(value) || typeof value.kind !== 'string') return []
  const itemId = stringField(value, 'id')
  const kind = normalizeType(value.kind)
  const blocks: RawBlock[] = []
  if (kind === 'user_message') pushText(blocks, 'text', value.text, itemId)
  else if (kind === 'assistant_text') pushText(blocks, 'text', value.text, itemId)
  else if (kind === 'assistant_reasoning') pushText(blocks, 'reasoning', value.text, itemId)
  else if (kind === 'model_context') pushText(blocks, 'context', value.text, itemId)
  else if (kind === 'runtime_context_source') pushText(blocks, 'context', value.content, itemId)
  else if (kind === 'goal_context' || kind === 'interruption_note') pushText(blocks, 'context', value.text, itemId)
  else if (kind === 'compaction') pushText(blocks, 'compacted', value.summary, itemId)
  else if (kind === 'error') pushText(blocks, 'error', value.message, itemId)
  else if (kind === 'tool_call') blocks.push({ type: 'tool-call', content: value.arguments, itemId, callId: stringField(value, 'callId'), toolName: stringField(value, 'toolName') })
  else if (kind === 'tool_result') blocks.push({ type: 'tool-result', content: value.output, itemId, callId: stringField(value, 'callId'), toolName: stringField(value, 'toolName') })
  if (kind === 'user_message' && Array.isArray(value.attachmentIds)) {
    for (const attachmentId of value.attachmentIds) {
      if (typeof attachmentId === 'string' && attachmentId) blocks.push({ type: 'attachment', attachmentId, itemId })
    }
  }
  return blocks
}

function pushText(blocks: RawBlock[], type: string, content: unknown, itemId?: string): void {
  if (typeof content === 'string') blocks.push({ type, content: sanitizeText(content), itemId })
}

function textContent(type: string, content: unknown): unknown {
  return TEXT_KINDS.has(type) ? (typeof content === 'string' ? sanitizeText(content) : '') : content
}

function safeJson(value: unknown): string {
  const seen = new WeakSet<object>()
  const safe = JSON.stringify(value ?? null, (key, entry: unknown) => {
    if (SENSITIVE_KEY.test(key)) return '[redacted]'
    if (typeof entry === 'string' && BASE64_VALUE.test(entry.replace(/\s/g, ''))) return '[binary omitted]'
    if (typeof entry === 'string') return sanitizeText(entry)
    if (entry && typeof entry === 'object') {
      if (seen.has(entry)) return '[circular]'
      seen.add(entry)
    }
    return entry
  }, 2)
  return safe ?? 'null'
}

function sanitizeText(value: string): string {
  return value
    .replace(/data:[^;,\s]+;base64,[a-z0-9+/=_-]+/gi, '[binary omitted]')
    .replace(/[A-Za-z0-9+/]{160,}={0,2}/g, '[binary omitted]')
    .replace(/\b(cookie|set-cookie|authorization|proxy-authorization)\s*:\s*[^\r\n]*/gi, '$1: [redacted]')
    .replace(/\b(aws[_-]?(?:access[_-]?key[_-]?id|secret[_-]?access[_-]?key|session[_-]?token)|api[-_]?key|access[-_]?key(?:[-_]?id)?|access[-_]?token|refresh[-_]?token|client[-_]?secret|password|auth)\b\s*[:=]\s*["']?[^"'\s,;}]+["']?/gi, '$1=[redacted]')
    .replace(/\bAKIA[0-9A-Z]{16}\b/g, '[redacted]')
}

function normalizeType(value: string): string { return value.trim().toLowerCase().replace(/\s+/g, '-') }
function displayType(value: string): string { return value.replace(/_/g, '-').replace(/\b\w/g, (letter) => letter.toUpperCase()) }
function stringField(value: Record<string, unknown>, key: string): string | undefined { return typeof value[key] === 'string' && value[key] ? value[key] : undefined }
function isRecord(value: unknown): value is Record<string, unknown> { return Boolean(value) && typeof value === 'object' && !Array.isArray(value) }
