import { createPortal } from 'react-dom'
import type { ReactElement, ReactNode } from 'react'
import { create } from 'zustand'

/**
 * The right tool rail is the work card's own right column: the workbench shell
 * hosts the slot inside the card; the conversation stage portals its rail into
 * it and falls back to rendering inline until the slot exists.
 */
type RailSlotState = { element: HTMLDivElement | null; setElement: (element: HTMLDivElement | null) => void }

const useRailSlotStore = create<RailSlotState>((set) => ({
  element: null,
  setElement: (element) => set({ element })
}))

export function RailSlot(): ReactElement {
  const setElement = useRailSlotStore((state) => state.setElement)
  return <div ref={setElement} className="kun-rail-slot ds-no-drag" data-rail-slot />
}

export function RailPortal({ children }: { children: ReactNode }): ReactElement {
  const element = useRailSlotStore((state) => state.element)
  return <>{element ? createPortal(children, element) : children}</>
}
