import { normalizeWritePath } from './write-path-normalization'

export type WriteDocumentContext = {
  workspaceRoot: string
  filePath: string
  documentEpoch: number
}

type WriteDocumentContextState = {
  workspaceRoot: string
  activeFilePath: string | null
  documentEpoch: number
}

function normalizeContextPath(value: string): string {
  return normalizeWritePath(value.trim())
}

export function captureWriteDocumentContext(
  state: WriteDocumentContextState
): WriteDocumentContext | null {
  const workspaceRoot = normalizeContextPath(state.workspaceRoot)
  const filePath = normalizeContextPath(state.activeFilePath ?? '')
  if (!workspaceRoot || !filePath) return null
  return { workspaceRoot, filePath, documentEpoch: state.documentEpoch }
}

export function writeDocumentContextMatches(
  state: WriteDocumentContextState,
  context: WriteDocumentContext
): boolean {
  return (
    normalizeContextPath(state.workspaceRoot) === normalizeContextPath(context.workspaceRoot) &&
    normalizeContextPath(state.activeFilePath ?? '') === normalizeContextPath(context.filePath) &&
    state.documentEpoch === context.documentEpoch
  )
}

export function nextWriteDocumentEpoch(current: number): number {
  return Number.isSafeInteger(current) && current >= 0 ? current + 1 : 1
}
