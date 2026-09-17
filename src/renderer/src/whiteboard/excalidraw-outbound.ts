export type ExcalidrawSceneSummaryElement = {
  type: string
  text?: string
}

const MAX_SUMMARY_ELEMENTS = 80
const MAX_TEXT_CHARS = 120

function asObject(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null
}

export function summarizeExcalidrawScene(scene: {
  elements?: unknown[]
} | null | undefined): {
  elementCount: number
  elements: ExcalidrawSceneSummaryElement[]
} {
  const live = (scene?.elements ?? []).flatMap((raw) => {
    const element = asObject(raw)
    if (!element || element.isDeleted === true) return []
    const type = typeof element.type === 'string' && element.type.trim()
      ? element.type.trim().slice(0, 32)
      : 'unknown'
    const text = typeof element.text === 'string' ? element.text.trim() : ''
    return [{
      type,
      ...(text ? { text: text.slice(0, MAX_TEXT_CHARS) } : {})
    }]
  })
  return {
    elementCount: live.length,
    elements: live.slice(0, MAX_SUMMARY_ELEMENTS)
  }
}

export function formatExcalidrawScenePrompt(scene: {
  elements?: unknown[]
} | null | undefined): string {
  const summary = summarizeExcalidrawScene(scene)
  const lines = summary.elements.map((element, index) => {
    const text = element.text ? ` "${element.text.replace(/\s+/g, ' ')}"` : ''
    return `${index + 1}. ${element.type}${text}`
  })
  return [
    'The active whiteboard is an Excalidraw sketch (hand-drawn diagram), not the Kun ShapeOps canvas.',
    'Do not call design_update_shapes, design_create_screen, design_arrange, or any HTML screen pipeline for this board.',
    'Discuss, review, or suggest edits in text. The user draws in Excalidraw.',
    `Live elements: ${summary.elementCount}${summary.elementCount > MAX_SUMMARY_ELEMENTS ? ` (showing first ${MAX_SUMMARY_ELEMENTS})` : ''}.`,
    ...(lines.length > 0 ? ['Current elements:', ...lines] : ['The sketch is currently empty.'])
  ].join('\n')
}
