/**
 * Persistence for the doc-level design system (tokens + components). Lives at
 * `<docDir>/design-system.json` — one per DesignDocument, shared by all its
 * artifacts/screens — alongside each artifact's `canvas.json`. Mirrors
 * canvas-persistence (debounced save, lenient load).
 */
import type { DesignSystem } from './design-system-types'

const DESIGN_DIR = '.kun-design'

export function designSystemPath(baseDir: string = DESIGN_DIR): string {
  return `${baseDir}/design-system.json`
}

export function serializeDesignSystem(system: DesignSystem): string {
  return JSON.stringify(system, null, 2)
}

export function parseDesignSystem(raw: string): DesignSystem | null {
  try {
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') return null
    const obj = parsed as { tokens?: unknown; components?: unknown }
    const tokens =
      obj.tokens && typeof obj.tokens === 'object' ? (obj.tokens as DesignSystem['tokens']) : {}
    const components =
      obj.components && typeof obj.components === 'object'
        ? (obj.components as DesignSystem['components'])
        : {}
    return { tokens, components }
  } catch {
    return null
  }
}

let _saveTimer: ReturnType<typeof setTimeout> | null = null

export function persistDesignSystem(
  workspaceRoot: string,
  system: DesignSystem,
  baseDir?: string
): void {
  if (!workspaceRoot || typeof window.kunGui?.writeWorkspaceFile !== 'function') return
  if (_saveTimer) clearTimeout(_saveTimer)
  _saveTimer = setTimeout(() => {
    _saveTimer = null
    void window.kunGui
      .writeWorkspaceFile({
        path: designSystemPath(baseDir),
        workspaceRoot,
        content: serializeDesignSystem(system)
      })
      .catch(() => undefined)
  }, 600)
}

export async function loadDesignSystem(
  workspaceRoot: string,
  baseDir?: string
): Promise<DesignSystem | null> {
  if (!workspaceRoot || typeof window.kunGui?.readWorkspaceFile !== 'function') return null
  try {
    const result = await window.kunGui.readWorkspaceFile({
      path: designSystemPath(baseDir),
      workspaceRoot
    })
    if (!result || !result.ok) return null
    return parseDesignSystem(result.content)
  } catch {
    return null
  }
}
