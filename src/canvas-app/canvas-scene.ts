import { convertToExcalidrawElements, restoreElements } from '@excalidraw/excalidraw'

export type StoredElement = Record<string, unknown> & { id: string; type: string }

export type StoredBoard = {
  boardId: string
  title: string
  revision: number
  elements: StoredElement[]
  appState?: Record<string, unknown>
  files?: Record<string, unknown>
  pending?: boolean
}

type SceneElement = ReturnType<typeof restoreElements>[number]

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
}

function withoutHostFlags(element: StoredElement): StoredElement {
  const { kunSkeleton: _skeleton, kunDirty: _dirty, ...rest } = element
  return rest as StoredElement
}

/** Translate the compact `{ id }` bindings the model writes into skeleton bindings. */
function skeletonInput(element: StoredElement): Record<string, unknown> {
  const next: Record<string, unknown> = { ...withoutHostFlags(element) }
  for (const key of ['start', 'end'] as const) {
    const binding = record(next[key])
    if (binding && typeof binding.id === 'string' && Object.keys(binding).length === 1) next[key] = { id: binding.id }
  }
  return next
}

/**
 * Turn stored elements into editor elements. Model-authored skeletons go
 * through Excalidraw's converter; edited full elements get their text
 * dimensions refreshed. Returns whether the result should be saved back.
 */
export function prepareScene(board: StoredBoard): { elements: SceneElement[]; normalized: boolean } {
  const skeletons = board.elements.filter((element) => element.kunSkeleton === true)
  const complete = board.elements.filter((element) => element.kunSkeleton !== true)
  const dirty = complete.some((element) => element.kunDirty === true)
  let converted: unknown[] = []
  if (skeletons.length > 0) {
    converted = convertToExcalidrawElements(
      skeletons.map(skeletonInput) as unknown as Parameters<typeof convertToExcalidrawElements>[0],
      { regenerateIds: false }
    )
  }
  const elements = restoreElements(
    [...complete.map(withoutHostFlags), ...converted] as unknown as Parameters<typeof restoreElements>[0],
    null,
    { refreshDimensions: skeletons.length > 0 || dirty, repairBindings: true }
  )
  return { elements, normalized: skeletons.length > 0 || dirty || board.pending === true }
}

/** Version fingerprint used to detect user edits worth saving. */
export function sceneSignature(elements: readonly { id: string; version: number; isDeleted?: boolean }[]): string {
  let sum = 0
  let live = 0
  for (const element of elements) {
    sum += element.version
    if (!element.isDeleted) live += 1
  }
  return `${elements.length}:${live}:${sum}`
}

/** Compact description of elements for chat context. */
export function describeElements(elements: readonly SceneElement[], selected?: ReadonlySet<string>): Array<Record<string, unknown>> {
  const live = elements.filter((element) => !element.isDeleted)
  const byId = new Map(live.map((element) => [element.id, element]))
  const result: Array<Record<string, unknown>> = []
  for (const element of live) {
    const raw = element as unknown as Record<string, unknown>
    if (typeof raw.containerId === 'string' && byId.has(raw.containerId)) continue
    if (selected && !selected.has(element.id)) continue
    const boundText = (Array.isArray(raw.boundElements) ? raw.boundElements : [])
      .map((entry) => record(entry))
      .find((entry) => entry?.type === 'text')
    const label = typeof raw.text === 'string'
      ? raw.text
      : typeof boundText?.id === 'string' ? (byId.get(boundText.id) as unknown as { text?: string } | undefined)?.text : undefined
    result.push({
      id: element.id,
      type: element.type,
      x: Math.round(element.x),
      y: Math.round(element.y),
      width: Math.round(element.width),
      height: Math.round(element.height),
      ...(label ? { text: label.slice(0, 200) } : {})
    })
    if (result.length >= 200) break
  }
  return result
}
