import type { Dispatch, MutableRefObject, SetStateAction } from 'react'
import type { WorkspaceFileReadResult, WorkspaceFileTarget } from '@shared/workspace-file'
import { targetKey, type CachedTextDraft } from './workspace-file-preview-support'

type Params = {
  target: WorkspaceFileTarget | null
  workspaceRoot: string
  activeTargetKey: string
  result: WorkspaceFileReadResult | null
  setResult: Dispatch<SetStateAction<WorkspaceFileReadResult | null>>
  textDraft: string
  setTextDraft: Dispatch<SetStateAction<string>>
  textDirty: boolean
  savingText: boolean
  setSavingText: Dispatch<SetStateAction<boolean>>
  setTextSaveError: Dispatch<SetStateAction<string | null>>
  setDiskConflict: Dispatch<SetStateAction<boolean>>
  setLoading: Dispatch<SetStateAction<boolean>>
  textDraftsRef: MutableRefObject<Map<string, CachedTextDraft>>
  setDirtyTargetKeys: Dispatch<SetStateAction<Set<string>>>
  pendingCloseTarget: WorkspaceFileTarget | null
  setPendingCloseTarget: Dispatch<SetStateAction<WorkspaceFileTarget | null>>
  onCloseTarget?: (target: WorkspaceFileTarget) => void
  onSelectTarget?: (target: WorkspaceFileTarget) => void
}

/** Save, reload and close-with-draft actions for the text preview's editor. */
export function useWorkspaceFilePreviewTextActions({
  target,
  workspaceRoot,
  activeTargetKey,
  result,
  setResult,
  textDraft,
  setTextDraft,
  textDirty,
  savingText,
  setSavingText,
  setTextSaveError,
  setDiskConflict,
  setLoading,
  textDraftsRef,
  setDirtyTargetKeys,
  pendingCloseTarget,
  setPendingCloseTarget,
  onCloseTarget,
  onSelectTarget
}: Params) {
  const forgetDraft = (key: string): void => {
    textDraftsRef.current.delete(key)
    setDirtyTargetKeys((current) => {
      if (!current.has(key)) return current
      const updated = new Set(current)
      updated.delete(key)
      return updated
    })
  }

  const saveText = async (force = false): Promise<boolean> => {
    if (!target || !result?.ok || !textDirty || savingText) return false
    setSavingText(true)
    setTextSaveError(null)
    setDiskConflict(false)
    try {
      const next = await window.kunGui.writeWorkspaceFile({
        path: result.path,
        workspaceRoot: target.workspaceRoot ?? workspaceRoot,
        content: textDraft,
        expectedMtimeMs: textDraftsRef.current.get(activeTargetKey)?.mtimeMs ?? result.mtimeMs,
        ...(force ? { force: true } : {})
      })
      if (!next.ok) {
        if (next.code === 'modified_on_disk') setDiskConflict(true)
        else setTextSaveError(next.message)
        return false
      }
      setResult({
        ...result,
        content: textDraft,
        size: new TextEncoder().encode(textDraft).byteLength,
        mtimeMs: next.mtimeMs ?? result.mtimeMs
      })
      forgetDraft(activeTargetKey)
      return true
    } catch (error) {
      setTextSaveError(error instanceof Error ? error.message : String(error))
      return false
    } finally {
      setSavingText(false)
    }
  }

  const revertText = (): void => {
    if (!result?.ok) return
    setTextDraft(result.content)
    forgetDraft(activeTargetKey)
    setTextSaveError(null)
    setDiskConflict(false)
  }

  const savePendingCloseTarget = async (): Promise<void> => {
    const item = pendingCloseTarget
    if (!item || !onCloseTarget) return
    const key = targetKey(item)
    if (key === activeTargetKey) {
      if (await saveText()) {
        setPendingCloseTarget(null)
        onCloseTarget(item)
      }
      return
    }
    const draft = textDraftsRef.current.get(key)
    if (!draft) {
      setPendingCloseTarget(null)
      onCloseTarget(item)
      return
    }
    setSavingText(true)
    try {
      const next = await window.kunGui.writeWorkspaceFile({
        path: item.path,
        workspaceRoot: item.workspaceRoot ?? workspaceRoot,
        content: draft.content,
        expectedMtimeMs: draft.mtimeMs
      })
      if (!next.ok) {
        setPendingCloseTarget(null)
        onSelectTarget?.(item)
        setTextSaveError(next.message)
        if (next.code === 'modified_on_disk') setDiskConflict(true)
        return
      }
      forgetDraft(key)
      setPendingCloseTarget(null)
      onCloseTarget(item)
    } finally {
      setSavingText(false)
    }
  }

  const reloadText = async (): Promise<void> => {
    if (!target || !result?.ok) return
    setLoading(true)
    setDiskConflict(false)
    setTextSaveError(null)
    try {
      const next = await window.kunGui.readWorkspaceFile({
        ...target,
        workspaceRoot: target.workspaceRoot ?? workspaceRoot,
        ...(result.encoding && result.encoding !== 'utf-8' ? { encoding: result.encoding } : {})
      })
      setResult(next)
      if (next.ok) {
        setTextDraft(next.content)
        forgetDraft(activeTargetKey)
      }
    } finally {
      setLoading(false)
    }
  }

  return { saveText, revertText, savePendingCloseTarget, reloadText }
}
