/**
 * `write.paperMode` settings slice (§5.1 of the work-paper-mode plan).
 * `enabled` persists the Work surface toggle; `libraries`/`activeLibrary`
 * hold the paper-mode root list, kept separate from `write.workspaces` so
 * the same folder can be both a docs workspace and a paper library.
 */
export type WritePaperModeTranslateSettingsV1 = {
  targetLanguage: 'zh' | 'en'
  /** Follow the Work assistant model unless a dedicated model is picked. */
  inheritModel: boolean
  providerId: string
  model: string
  autoTranslateSelection: boolean
}

export type WritePaperModeFeedV1 = {
  id: string
  url: string
  title: string
}

export type WritePaperModeDiscoverSettingsV1 = {
  arxivCategories: string[]
  feeds: WritePaperModeFeedV1[]
  rankMode: 'lexical' | 'embedding' | 'off'
  embedding: {
    baseUrl: string
    apiKey: string
    model: string
  }
}

export type WritePaperModeScholarSettingsV1 = {
  semanticScholarApiKey: string
  crossrefMailto: string
  onlineReferences: boolean
}

export type WritePaperModeReaderSettingsV1 = {
  paperTone: 'white' | 'sepia' | 'green' | 'dark'
}

export type WritePaperModeSettingsV1 = {
  enabled: boolean
  libraries: string[]
  /** '' means unconfigured — the onboarding page shows. */
  activeLibrary: string
  /** First open of an unread paper marks it as reading. */
  autoMarkReading: boolean
  translate: WritePaperModeTranslateSettingsV1
  discover: WritePaperModeDiscoverSettingsV1
  scholar: WritePaperModeScholarSettingsV1
  reader: WritePaperModeReaderSettingsV1
}

export type WritePaperModeSettingsPatchV1 = Partial<
  Omit<WritePaperModeSettingsV1, 'translate' | 'discover' | 'scholar' | 'reader'>
> & {
  translate?: Partial<WritePaperModeTranslateSettingsV1>
  discover?: Partial<Omit<WritePaperModeDiscoverSettingsV1, 'feeds' | 'embedding'>> & {
    /** Replaced wholesale when present. */
    feeds?: Array<Partial<WritePaperModeFeedV1>>
    embedding?: Partial<WritePaperModeDiscoverSettingsV1['embedding']>
  }
  scholar?: Partial<WritePaperModeScholarSettingsV1>
  reader?: Partial<WritePaperModeReaderSettingsV1>
}
