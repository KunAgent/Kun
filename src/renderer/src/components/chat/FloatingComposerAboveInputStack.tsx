import type { ReactElement, ReactNode } from 'react'

type Props = {
  /** Activity tray (segments, sheet, queue). Must be last: it tucks behind the input slot. */
  tray?: ReactNode
  /** Larger panels that keep their own normal-flow space above the tray. */
  flowPanels?: ReactNode
}

/**
 * Owns the persistent surfaces directly above the composer input slot.
 *
 * Everything here is in normal flow, so the composer dock grows with it and
 * the timeline above shrinks instead of being covered: no overlay height has
 * to be published for the last message to stay clear of the dock.
 */
export function FloatingComposerAboveInputStack({
  tray,
  flowPanels
}: Props): ReactElement {
  return (
    <>
      <div
        data-composer-flow-panel-stack
        className="mb-2 flex w-full flex-col items-center gap-2 empty:hidden"
      >
        {flowPanels}
      </div>
      {tray}
    </>
  )
}
