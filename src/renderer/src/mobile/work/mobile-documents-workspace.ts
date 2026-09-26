const STORAGE_KEY = 'kun.mobile.work.documents.workspace'

type WorkspaceChoice = {
  workspaces: readonly string[]
  defaultWorkspaceRoot: string
  activeWorkspaceRoot: string
  paperModeEnabled: boolean
}

/** Client-only Work root; the host paper-mode switch never changes this preference. */
export function mobileDocumentsWorkspaceRoot(choice: WorkspaceChoice): string {
  let preferred = ''
  try { preferred = window.sessionStorage.getItem(STORAGE_KEY) ?? '' } catch { /* private mode */ }
  const available = choice.workspaces.filter((root) => Boolean(root.trim()))
  if (preferred && available.includes(preferred)) return preferred
  const initial = choice.paperModeEnabled ? choice.defaultWorkspaceRoot : choice.activeWorkspaceRoot
  if (initial && available.includes(initial)) return initial
  if (choice.defaultWorkspaceRoot && available.includes(choice.defaultWorkspaceRoot)) return choice.defaultWorkspaceRoot
  return available[0] ?? ''
}

export function setMobileDocumentsWorkspaceRoot(root: string, workspaces: readonly string[]): void {
  if (!root.trim() || !workspaces.includes(root)) return
  try { window.sessionStorage.setItem(STORAGE_KEY, root) } catch { /* private mode */ }
}
