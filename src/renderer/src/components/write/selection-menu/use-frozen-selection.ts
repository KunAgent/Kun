import { useCallback, useState } from 'react'
import type { WriteEditorSelectionState } from '../write-markdown-editor-types'
export function selectionSignature(selection: WriteEditorSelectionState): string {
  return JSON.stringify([selection.ranges.map(({ from, to }) => [from, to]), selection.text, selection.selectedImage?.src])
}
export function useFrozenSelection(selection: WriteEditorSelectionState, documentKey: string) {
  const [frozen, setFrozen] = useState<{ key: string; selection: WriteEditorSelectionState } | null>(null)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const effective = frozen?.key === documentKey ? frozen.selection : selection
  const signature = `${documentKey}:${selectionSignature(effective)}`
  return {
    selection: effective,
    dismissed: dismissed === signature,
    freeze: () => { if (selection.charCount > 0) setFrozen({ key: documentKey, selection }) },
    release: useCallback(() => setFrozen(null), []),
    dismiss: () => { setDismissed(signature); setFrozen(null) }
  }
}
