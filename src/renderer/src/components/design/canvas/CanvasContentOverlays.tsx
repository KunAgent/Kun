import type { ReactElement } from 'react'
import { CanvasKunPresence } from './CanvasKunPresence'
import { CanvasSectionsOverlay } from './CanvasSectionsOverlay'
import { CanvasSelectionToolbar } from './CanvasSelectionToolbar'

/** Layers drawn over the shapes and board portals: sections, Kun's cursor, the selection toolbar. */
export function CanvasContentOverlays({
  readOnly,
  artifactOverlays,
  onAskKun
}: {
  readOnly: boolean
  artifactOverlays: boolean
  onAskKun?: (prompt: string) => void
}): ReactElement {
  return (
    <>
      {artifactOverlays ? <CanvasSectionsOverlay readOnly={readOnly} onAskKun={readOnly ? undefined : onAskKun} /> : null}
      {artifactOverlays ? <CanvasKunPresence /> : null}
      {readOnly ? null : <CanvasSelectionToolbar />}
    </>
  )
}
