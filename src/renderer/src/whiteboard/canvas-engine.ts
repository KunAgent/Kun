export const CANVAS_ENGINES = ['kun', 'excalidraw'] as const
export type CanvasEngine = (typeof CANVAS_ENGINES)[number]
export const DEFAULT_CANVAS_ENGINE: CanvasEngine = 'kun'

export function normalizeCanvasEngine(value: unknown): CanvasEngine {
  return value === 'excalidraw' ? 'excalidraw' : DEFAULT_CANVAS_ENGINE
}

/** Persist only the non-default engine so legacy records stay unchanged. */
export function canvasEnginePersistField(
  engine: CanvasEngine | undefined
): { engine?: CanvasEngine } {
  return normalizeCanvasEngine(engine) === 'excalidraw' ? { engine: 'excalidraw' } : {}
}

export function isKunCanvasDocumentEmpty(
  document: { rootId: string; objects: Record<string, { children?: string[] }> } | null | undefined
): boolean {
  if (!document) return true
  const root = document.objects[document.rootId]
  return !Array.isArray(root?.children) || root.children.length === 0
}
