export type ConversationVisualizationTone =
  | 'neutral'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'

export type ConversationVisualizationItem = {
  id: string
  title: string
  description?: string
  tone?: ConversationVisualizationTone
}

export type ConversationVisualizationSection =
  | {
      kind: 'flow'
      title?: string
      direction: 'horizontal' | 'vertical'
      steps: ConversationVisualizationItem[]
    }
  | {
      kind: 'card_grid'
      title?: string
      columns: 1 | 2 | 3
      cards: ConversationVisualizationItem[]
    }
  | {
      kind: 'callout'
      title?: string
      tone: ConversationVisualizationTone
      lines: string[]
    }

export type ConversationVisualizationV1 = {
  version: 1
  title: string
  description?: string
  sections: ConversationVisualizationSection[]
}

const TONES = new Set<ConversationVisualizationTone>([
  'neutral', 'accent', 'success', 'warning', 'danger'
])
const ID = /^[A-Za-z][A-Za-z0-9_-]{0,31}$/
const MAX_BYTES = 12 * 1024

export function parseConversationVisualization(value: unknown): ConversationVisualizationV1 | null {
  if (!record(value) || value.version !== 1) return null
  if (!text(value.title, 120) || (value.description !== undefined && !text(value.description, 400))) return null
  if (!Array.isArray(value.sections) || value.sections.length < 1 || value.sections.length > 6) return null
  if (byteLength(value) > MAX_BYTES) return null
  const sections: ConversationVisualizationSection[] = []
  for (const raw of value.sections) {
    const section = parseSection(raw)
    if (!section) return null
    sections.push(section)
  }
  return {
    version: 1,
    title: value.title.trim(),
    ...(typeof value.description === 'string' ? { description: value.description.trim() } : {}),
    sections
  }
}

export function visualizationFromToolPayload(payload: unknown): ConversationVisualizationV1 | null {
  if (!record(payload)) return parseConversationVisualization(payload)
  return parseConversationVisualization(payload.conversationVisualization ?? payload)
}

export function conversationVisualizationText(value: ConversationVisualizationV1): string {
  const lines = [value.title]
  if (value.description) lines.push(value.description)
  for (const section of value.sections) {
    if (section.title) lines.push('', section.title)
    if (section.kind === 'flow') {
      section.steps.forEach((step, index) => lines.push(
        `${index + 1}. ${step.title}${step.description ? ` — ${step.description}` : ''}`
      ))
    } else if (section.kind === 'card_grid') {
      section.cards.forEach((card) => lines.push(
        `• ${card.title}${card.description ? ` — ${card.description}` : ''}`
      ))
    } else {
      section.lines.forEach((line) => lines.push(`• ${line}`))
    }
  }
  return lines.join('\n').trim()
}

function parseSection(value: unknown): ConversationVisualizationSection | null {
  if (!record(value) || (value.title !== undefined && !text(value.title, 80))) return null
  const title = typeof value.title === 'string' ? value.title.trim() : undefined
  if (value.kind === 'flow') {
    const steps = parseItems(value.steps, 2, 10)
    if (!steps) return null
    const direction = value.direction === undefined ? 'horizontal' : value.direction
    if (direction !== 'horizontal' && direction !== 'vertical') return null
    return { kind: 'flow', ...(title ? { title } : {}), direction, steps }
  }
  if (value.kind === 'card_grid') {
    const cards = parseItems(value.cards, 1, 6)
    if (!cards) return null
    const columns = value.columns === undefined ? 2 : value.columns
    if (columns !== 1 && columns !== 2 && columns !== 3) return null
    return { kind: 'card_grid', ...(title ? { title } : {}), columns, cards }
  }
  if (value.kind === 'callout') {
    if (!Array.isArray(value.lines) || value.lines.length < 1 || value.lines.length > 4) return null
    if (!value.lines.every((line) => text(line, 240))) return null
    const tone = value.tone === undefined ? 'neutral' : value.tone
    if (!isTone(tone)) return null
    return {
      kind: 'callout', ...(title ? { title } : {}), tone,
      lines: value.lines.map((line) => (line as string).trim())
    }
  }
  return null
}

function parseItems(value: unknown, min: number, max: number): ConversationVisualizationItem[] | null {
  if (!Array.isArray(value) || value.length < min || value.length > max) return null
  const ids = new Set<string>()
  const items: ConversationVisualizationItem[] = []
  for (const raw of value) {
    if (!record(raw) || typeof raw.id !== 'string' || !ID.test(raw.id)) return null
    if (ids.has(raw.id) || !text(raw.title, 80)) return null
    if (raw.description !== undefined && !text(raw.description, 180)) return null
    if (raw.tone !== undefined && !isTone(raw.tone)) return null
    ids.add(raw.id)
    items.push({
      id: raw.id,
      title: raw.title.trim(),
      ...(typeof raw.description === 'string' ? { description: raw.description.trim() } : {}),
      ...(isTone(raw.tone) ? { tone: raw.tone } : {})
    })
  }
  return items
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}
function text(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= max
}
function isTone(value: unknown): value is ConversationVisualizationTone {
  return typeof value === 'string' && TONES.has(value as ConversationVisualizationTone)
}
function byteLength(value: unknown): number {
  return new TextEncoder().encode(JSON.stringify(value)).byteLength
}
