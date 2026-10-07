import type { ChatBlock } from '../agent/types'
import { assistantExportMarkdown } from './conversation-export-markdown'

export type ConversationExportLabels = {
  exportedAt: string
  user: string
  assistant: string
  attachments: string
  referencedFiles: string
  generatedFiles: string
  sources: string
  attachment: string
}

export type ConversationExportDocument = {
  markdown: string
  defaultFileName: string
  messageCount: number
}

type AnnotatedBlock = {
  block: ChatBlock
  index: number
  turnKey: string
}

type SafeSource = {
  title?: string
  url: string
}

function singleLine(value: unknown): string {
  return typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : ''
}

function markdownHeadingText(value: string): string {
  return singleLine(value).replace(/([\\`*_[\]<>])/g, '\\$1')
}

function inlineCode(value: string): string {
  const normalized = singleLine(value)
  const longestRun = Math.max(0, ...[...normalized.matchAll(/`+/g)].map((match) => match[0].length))
  const fence = '`'.repeat(longestRun + 1)
  return `${fence}${normalized}${fence}`
}

function blockTurnId(block: ChatBlock): string {
  if ('turnId' in block && typeof block.turnId === 'string' && block.turnId.trim()) {
    return block.turnId.trim()
  }
  if ('meta' in block && block.meta && typeof block.meta === 'object') {
    const turnId = (block.meta as Record<string, unknown>).turnId
    return singleLine(turnId)
  }
  return ''
}

function currentTurnStartIndex(
  blocks: ChatBlock[],
  currentTurnId: string | null | undefined,
  currentTurnUserId: string | null | undefined
): number {
  const userId = singleLine(currentTurnUserId)
  if (userId) {
    const userIndex = blocks.findIndex((block) => block.kind === 'user' && block.id === userId)
    if (userIndex >= 0) return userIndex
  }

  const turnId = singleLine(currentTurnId)
  if (turnId) {
    const turnIndex = blocks.findIndex((block) => blockTurnId(block) === turnId)
    if (turnIndex >= 0) return turnIndex
  }

  for (let index = blocks.length - 1; index >= 0; index -= 1) {
    if (blocks[index]?.kind === 'user') return index
  }
  return -1
}

function completedBlocks(options: {
  blocks: ChatBlock[]
  busy: boolean
  currentTurnId?: string | null
  currentTurnUserId?: string | null
}): ChatBlock[] {
  if (!options.busy) return options.blocks
  const startIndex = currentTurnStartIndex(
    options.blocks,
    options.currentTurnId,
    options.currentTurnUserId
  )
  if (startIndex >= 0) return options.blocks.slice(0, startIndex)

  const currentTurnId = singleLine(options.currentTurnId)
  return currentTurnId
    ? options.blocks.filter((block) => blockTurnId(block) !== currentTurnId)
    : options.blocks
}

function annotateBlocks(blocks: ChatBlock[]): AnnotatedBlock[] {
  let currentTurnKey = ''
  return blocks.map((block, index) => {
    const explicitTurnId = blockTurnId(block)
    if (block.kind === 'user') {
      currentTurnKey = explicitTurnId || `user:${block.id}`
    } else if (explicitTurnId) {
      currentTurnKey = explicitTurnId
    }
    const turnKey = explicitTurnId || currentTurnKey || `${block.kind}:${block.id}`
    return { block, index, turnKey }
  })
}

function visibleUserText(block: Extract<ChatBlock, { kind: 'user' }>): string {
  const displayText = singleLine(block.meta?.displayText) ? block.meta?.displayText : undefined
  return (displayText ?? block.text).trim()
}

function formattedTime(value: string | undefined, locale: string): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short'
  }).format(date)
}

function safeRelativePath(value: unknown): string {
  const path = singleLine(value).replaceAll('\\', '/')
  if (!path || path.startsWith('/') || path.startsWith('//') || /^[a-z]:\//i.test(path)) return ''
  if (path.split('/').some((segment) => segment === '..')) return ''
  return path
}

function attachmentLines(block: Extract<ChatBlock, { kind: 'user' }>, labels: ConversationExportLabels): string[] {
  const meta = block.meta
  const rawAttachments = Array.isArray(meta?.attachments) ? meta.attachments : []
  const rawAttachmentIds = Array.isArray(meta?.attachmentIds) ? meta.attachmentIds : []
  const names = rawAttachments.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const name = singleLine((entry as Record<string, unknown>).name)
    return name ? [name] : []
  })
  const attachmentCount = Math.max(rawAttachments.length, rawAttachmentIds.length)
  const lines = names.map((name) => `- ${markdownHeadingText(name)}`)
  for (let index = names.length; index < attachmentCount; index += 1) {
    lines.push(`- ${markdownHeadingText(labels.attachment)} ${index + 1}`)
  }
  return lines
}

function referencedFileLines(block: Extract<ChatBlock, { kind: 'user' }>): string[] {
  const references = Array.isArray(block.meta?.fileReferences) ? block.meta.fileReferences : []
  return references.flatMap((entry) => {
    if (!entry || typeof entry !== 'object') return []
    const record = entry as Record<string, unknown>
    const name = singleLine(record.name)
    const relativePath = safeRelativePath(record.relativePath)
    if (!name && !relativePath) return []
    if (name && relativePath && name !== relativePath) {
      return [`- ${markdownHeadingText(name)} — ${inlineCode(relativePath)}`]
    }
    return [`- ${name ? markdownHeadingText(name) : inlineCode(relativePath)}`]
  })
}

function safeWebSource(entry: unknown): SafeSource | null {
  if (!entry || typeof entry !== 'object') return null
  const record = entry as Record<string, unknown>
  const rawUrl = singleLine(record.url)
  if (!rawUrl) return null
  try {
    const url = new URL(rawUrl)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    return {
      url: url.href,
      ...(singleLine(record.title) ? { title: singleLine(record.title) } : {})
    }
  } catch {
    return null
  }
}

function generatedFileLabel(entry: unknown): string {
  if (!entry || typeof entry !== 'object') return ''
  const record = entry as Record<string, unknown>
  const name = singleLine(record.name)
  const relativePath = safeRelativePath(record.relativePath)
  if (name && relativePath && name !== relativePath) {
    return `${markdownHeadingText(name)} — ${inlineCode(relativePath)}`
  }
  return name ? markdownHeadingText(name) : relativePath ? inlineCode(relativePath) : ''
}

function turnExtras(annotated: AnnotatedBlock[]): {
  generatedFiles: Map<string, string[]>
  sources: Map<string, SafeSource[]>
} {
  const generatedFiles = new Map<string, string[]>()
  const sources = new Map<string, SafeSource[]>()
  const generatedSeen = new Map<string, Set<string>>()
  const sourceSeen = new Map<string, Set<string>>()

  for (const { block, turnKey } of annotated) {
    if (block.kind !== 'tool' || !block.meta) continue
    const rawGeneratedFiles = Array.isArray(block.meta.generatedFiles) ? block.meta.generatedFiles : []
    for (const entry of rawGeneratedFiles) {
      const label = generatedFileLabel(entry)
      if (!label) continue
      const seen = generatedSeen.get(turnKey) ?? new Set<string>()
      if (seen.has(label)) continue
      seen.add(label)
      generatedSeen.set(turnKey, seen)
      generatedFiles.set(turnKey, [...(generatedFiles.get(turnKey) ?? []), `- ${label}`])
    }

    const rawSources = Array.isArray(block.meta.sources) ? block.meta.sources : []
    for (const entry of rawSources) {
      const source = safeWebSource(entry)
      if (!source) continue
      const seen = sourceSeen.get(turnKey) ?? new Set<string>()
      if (seen.has(source.url)) continue
      seen.add(source.url)
      sourceSeen.set(turnKey, seen)
      sources.set(turnKey, [...(sources.get(turnKey) ?? []), source])
    }
  }

  return { generatedFiles, sources }
}

function localDateToken(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function buildConversationExportDocument(options: {
  title: string
  blocks: ChatBlock[]
  locale: string
  exportedAt: Date
  labels: ConversationExportLabels
  busy: boolean
  currentTurnId?: string | null
  currentTurnUserId?: string | null
}): ConversationExportDocument {
  const eligible = completedBlocks(options)
  const annotated = annotateBlocks(eligible)
  const completedTurnKeys = new Set(
    annotated
      .filter(({ block }) => block.kind === 'assistant' && block.text.trim())
      .map(({ turnKey }) => turnKey)
  )
  const lastAssistantIndex = new Map<string, number>()
  for (const entry of annotated) {
    if (entry.block.kind === 'assistant' && entry.block.text.trim()) {
      lastAssistantIndex.set(entry.turnKey, entry.index)
    }
  }
  const extras = turnExtras(annotated)
  const sections: string[] = []

  for (const entry of annotated) {
    const { block, turnKey } = entry
    if (!completedTurnKeys.has(turnKey)) continue
    if (block.kind !== 'user' && block.kind !== 'assistant') continue
    if (block.kind === 'assistant' && !block.text.trim()) continue
    const text = block.kind === 'user'
      ? visibleUserText(block)
      : assistantExportMarkdown(block.text, block.renderMode).trim()
    if (!text) continue

    const role = block.kind === 'user' ? options.labels.user : options.labels.assistant
    const section = [`## ${markdownHeadingText(role)}`]
    const time = formattedTime(block.createdAt, options.locale)
    if (time) section.push(`_${time}_`)
    section.push(text)

    if (block.kind === 'user') {
      const attachments = attachmentLines(block, options.labels)
      if (attachments.length > 0) section.push(`### ${markdownHeadingText(options.labels.attachments)}\n\n${attachments.join('\n')}`)
      const references = referencedFileLines(block)
      if (references.length > 0) section.push(`### ${markdownHeadingText(options.labels.referencedFiles)}\n\n${references.join('\n')}`)
    } else if (lastAssistantIndex.get(turnKey) === entry.index) {
      const generated = extras.generatedFiles.get(turnKey) ?? []
      if (generated.length > 0) section.push(`### ${markdownHeadingText(options.labels.generatedFiles)}\n\n${generated.join('\n')}`)
      const sources = extras.sources.get(turnKey) ?? []
      if (sources.length > 0) {
        const sourceLines = sources.map((source) =>
          source.title ? `- ${markdownHeadingText(source.title)} — <${source.url}>` : `- <${source.url}>`
        )
        section.push(`### ${markdownHeadingText(options.labels.sources)}\n\n${sourceLines.join('\n')}`)
      }
    }

    sections.push(section.join('\n\n'))
  }

  const safeTitle = markdownHeadingText(options.title) || 'Kun'
  const exportedAt = formattedTime(options.exportedAt.toISOString(), options.locale)
  const header = `# ${safeTitle}\n\n> ${options.labels.exportedAt}: ${exportedAt}`
  const markdown = [header, ...sections].join('\n\n---\n\n') + '\n'
  const fileTitle = singleLine(options.title).slice(0, 150) || 'Kun-conversation'

  return {
    markdown,
    defaultFileName: `${fileTitle}-${localDateToken(options.exportedAt)}`,
    messageCount: sections.length
  }
}
