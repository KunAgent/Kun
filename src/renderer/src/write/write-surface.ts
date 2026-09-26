/**
 * Work surfaces: `docs` is the ordinary workspace, `papers` is the paper-mode
 * workbench. Layout and remembered-file storage keys read the module-level
 * current surface (set via `setWriteWorkSurfaceValue` before workspace
 * reinitialization) so the two surfaces keep separate editor state without
 * changing the layout API's call signatures.
 */
export type WriteWorkSurface = 'docs' | 'papers'

let currentSurface: WriteWorkSurface = 'docs'

export function getWriteWorkSurface(): WriteWorkSurface {
  return currentSurface
}

export function setWriteWorkSurfaceValue(next: WriteWorkSurface): void {
  currentSurface = next === 'papers' ? 'papers' : 'docs'
}

/** Storage-key suffix: '' on the docs surface (legacy keys keep working). */
export function writeSurfaceKeySuffix(): string {
  return currentSurface === 'papers' ? '#papers' : ''
}
