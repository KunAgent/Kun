import { createPortal } from 'react-dom'
import type { ReactElement, ReactNode } from 'react'
import { create } from 'zustand'

/**
 * The right tool rail lives on the window ground, beside the work card rather
 * than inside it. The workbench shell hosts the slot; the conversation stage
 * portals its rail into it and falls back to rendering inline until it exists.
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
