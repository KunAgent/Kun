import { createContext } from 'react'

/** Keep portalled pickers inside an owning modal's stacking and focus scope. */
export const ComposerPickerPortalContext = createContext<HTMLElement | null>(null)
