import { normalizeWorkspaceRoot } from './workspace-path'

export const ADE_PROJECT_DEFAULTS_REFRESH_EVENT = 'kun:ade-project-defaults-refresh'

export function requestAdeProjectDefaultsRefresh(projectPath: string): void {
  if (typeof window === 'undefined') return
  window.dispatchEvent(new CustomEvent(ADE_PROJECT_DEFAULTS_REFRESH_EVENT, {
    detail: normalizeWorkspaceRoot(projectPath)
  }))
}

export function isAdeProjectDefaultsStaleError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return message.includes('project_defaults_stale') ||
    /project defaults (changed|could not be resolved|have not applied)/i.test(message)
}
