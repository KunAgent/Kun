import { ipcRenderer } from 'electron'
import type { WorkspaceCreationTimeEntry } from '../shared/kun-gui-api'

export function getWorkspaceCreationTimes(
  workspaceRoots: string[]
): Promise<WorkspaceCreationTimeEntry[]> {
  return ipcRenderer.invoke('workspace:creation-times', { workspaceRoots })
}
