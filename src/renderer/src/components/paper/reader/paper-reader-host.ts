import { createContext, useContext } from 'react'
import type { PaperLibraryEntry } from '@shared/paper/paper-library-types'
import type { PaperReaderLayoutPreset } from '../../../paper/paper-reader-layout'
import type { PendingPaperSelection } from './use-paper-selection'

export type PaperReaderHost = {
  entry: PaperLibraryEntry
  onShowInfo: () => void
  layoutPreset: PaperReaderLayoutPreset
  applyLayout: (preset: PaperReaderLayoutPreset) => void
  onBack: () => void
  onSubmitPrompt?: (prompt: string) => void
  onQuoteSelection?: (selection: PendingPaperSelection) => void
  onAskSelection?: (question: string, selection: PendingPaperSelection) => void
  onOpenTranslated?: (outputPath: string) => void
  onAttachImage?: (input: { dataBase64: string; name: string }) => Promise<boolean>
}

export const PaperReaderHostContext = createContext<PaperReaderHost | null>(null)

export function usePaperReaderHost(): PaperReaderHost | null {
  return useContext(PaperReaderHostContext)
}
