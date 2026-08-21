import type { AnnotationOp } from './image-annotation-model'

export type AnnotationHistory = {
  past: AnnotationOp[][]
  present: AnnotationOp[]
  future: AnnotationOp[][]
}

export function createAnnotationHistory(initial: AnnotationOp[] = []): AnnotationHistory {
  return { past: [], present: initial, future: [] }
}

export function commitAnnotationHistory(
  history: AnnotationHistory,
  next: AnnotationOp[]
): AnnotationHistory {
  if (next === history.present) return history
  return {
    past: [...history.past, history.present],
    present: next,
    future: []
  }
}

export function undoAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  const previous = history.past.at(-1)
  if (!previous) return history
  return {
    past: history.past.slice(0, -1),
    present: previous,
    future: [history.present, ...history.future]
  }
}

export function clearAnnotationHistory(history: AnnotationHistory): AnnotationHistory {
  if (history.present.length === 0) return history
  return commitAnnotationHistory(history, [])
}
