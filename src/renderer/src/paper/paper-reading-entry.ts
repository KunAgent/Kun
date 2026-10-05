import type { PaperUnitMeta } from '@shared/paper/paper-meta-v2'
import { useWriteWorkspaceStore } from '../write/write-workspace-store'
import { usePaperStore } from '../write/paper/paper-store'
import { usePaperReadingRequest, type PaperReadingRequest } from './paper-reading-request'

let requestSequence = 0

/** Missing library metadata never grants a generic, unscoped agent turn. */
export async function openBoundedPaperReading(input: Omit<PaperReadingRequest, 'meta'> & { meta?: PaperUnitMeta }): Promise<boolean> {
  const sequence = ++requestSequence
  const before = useWriteWorkspaceStore.getState()
  const activePath = before.activeFilePath
  const requestRevision = usePaperReadingRequest.getState().revision
  const stillCurrent = (): boolean => {
    const workspace = useWriteWorkspaceStore.getState()
    return sequence === requestSequence && workspace.workspaceRoot === input.workspaceRoot &&
      workspace.activeFilePath === activePath && usePaperReadingRequest.getState().revision === requestRevision
  }
  if (before.workspaceRoot !== input.workspaceRoot || !input.unitDir) return false
  try {
    let meta = input.meta
    if (!meta) {
      const result = await window.kunGui.paperReadUnit({ workspaceRoot: input.workspaceRoot, unitDir: input.unitDir })
      if (!stillCurrent()) return false
      if (!result.ok) throw new Error(result.message)
      meta = result.meta
    }
    if (!stillCurrent()) return false
    usePaperReadingRequest.getState().open({ ...input, meta })
    return true
  } catch (cause) {
    if (stillCurrent()) usePaperStore.getState().setNotice({ tone: 'error', message: cause instanceof Error ? cause.message : String(cause) })
    return false
  }
}
