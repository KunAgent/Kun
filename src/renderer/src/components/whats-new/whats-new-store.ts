import { create } from 'zustand'
import i18n from '../../i18n'
import { loadWhatsNewContent, releaseNotesLanguage, type WhatsNewContent } from './whats-new-content'

type WhatsNewState = {
  content: WhatsNewContent | null
  open: boolean
  /** The one-time "you can reopen this in Settings" hint after closing. */
  hint: boolean
  show: (content: WhatsNewContent) => void
  close: () => void
  dismissHint: () => void
}

export const useWhatsNewStore = create<WhatsNewState>((set, get) => ({
  content: null,
  open: false,
  hint: false,
  show: (content) => set({ content, open: true, hint: false }),
  close: () => {
    if (!get().open) return
    set({ open: false, hint: true })
  },
  dismissHint: () => set({ hint: false })
}))

/** Reopens the running version's notes on demand (Settings › Updates, the hint). */
export async function openCurrentWhatsNew(): Promise<boolean> {
  const existing = useWhatsNewStore.getState().content
  if (existing) {
    useWhatsNewStore.getState().show(existing)
    return true
  }
  const notice = await window.kunGui?.getReleaseNotice?.({ current: true }).catch(() => null)
  if (!notice) return false
  const content = await loadWhatsNewContent(notice, releaseNotesLanguage(i18n.language))
  useWhatsNewStore.getState().show(content)
  return true
}
