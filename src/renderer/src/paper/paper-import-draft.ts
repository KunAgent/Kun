import { create } from 'zustand'

/**
 * PDFs dropped on the library (or the space) waiting for the import dialog,
 * which takes them on open and starts right away — so a drop gets the same
 * per-paper status, dedupe report and follow-ups as an import from the dialog.
 */
type ImportDraftState = {
  pdfs: string[]
  queue: (paths: readonly string[]) => void
  take: () => string[]
}

export const usePaperImportDraft = create<ImportDraftState>((set, get) => ({
  pdfs: [],
  queue: (paths) => set((state) => ({ pdfs: [...new Set([...state.pdfs, ...paths])] })),
  take: () => {
    const pdfs = get().pdfs
    if (pdfs.length) set({ pdfs: [] })
    return pdfs
  }
}))
