import { compactStrings } from './app-settings-normalizers'
import type {
  WritePaperModeFeedV1,
  WritePaperModeSettingsPatchV1,
  WritePaperModeSettingsV1
} from './app-settings-types-paper-mode'

export const PAPER_MODE_MAX_LIBRARIES = 64
export const PAPER_MODE_MAX_FEEDS = 64
export const PAPER_MODE_FEED_URL_MAX_CHARS = 2000
export const PAPER_MODE_FEED_TITLE_MAX_CHARS = 120
export const PAPER_MODE_MAX_ARXIV_CATEGORIES = 16
export const PAPER_MODE_DEFAULT_ARXIV_CATEGORIES = ['cs.CL', 'cs.AI', 'cs.LG', 'cs.SE']

export function defaultWritePaperModeSettings(): WritePaperModeSettingsV1 {
  return {
    enabled: false,
    libraries: [],
    activeLibrary: '',
    autoMarkReading: true,
    translate: {
      targetLanguage: 'zh',
      inheritModel: true,
      providerId: '',
      model: '',
      autoTranslateSelection: false
    },
    discover: {
      arxivCategories: [...PAPER_MODE_DEFAULT_ARXIV_CATEGORIES],
      feeds: [],
      rankMode: 'lexical',
      embedding: { baseUrl: '', apiKey: '', model: '' }
    },
    scholar: {
      semanticScholarApiKey: '',
      crossrefMailto: '',
      onlineReferences: true
    },
    reader: { paperTone: 'white' }
  }
}

const PAPER_TONES = new Set(['white', 'sepia', 'green', 'dark'])

function normalizeFeeds(input: unknown): WritePaperModeFeedV1[] {
  if (!Array.isArray(input)) return []
  const feeds: WritePaperModeFeedV1[] = []
  const seenIds = new Set<string>()
  for (const raw of input) {
    if (!raw || typeof raw !== 'object') continue
    const candidate = raw as Partial<WritePaperModeFeedV1>
    const url = typeof candidate.url === 'string'
      ? candidate.url.trim().slice(0, PAPER_MODE_FEED_URL_MAX_CHARS)
      : ''
    if (!url.startsWith('https://')) continue
    const id = typeof candidate.id === 'string' && candidate.id.trim()
      ? candidate.id.trim().slice(0, 64)
      : `feed-${feeds.length + 1}`
    if (seenIds.has(id)) continue
    seenIds.add(id)
    feeds.push({
      id,
      url,
      title: typeof candidate.title === 'string'
        ? candidate.title.trim().slice(0, PAPER_MODE_FEED_TITLE_MAX_CHARS)
        : ''
    })
    if (feeds.length >= PAPER_MODE_MAX_FEEDS) break
  }
  return feeds
}

function normalizeArxivCategories(input: unknown, fallback: string[]): string[] {
  const categories = compactStrings(input)
    .map((value) => value.trim())
    .filter((value) => /^[a-zA-Z][a-zA-Z0-9._-]{0,31}$/.test(value))
    .slice(0, PAPER_MODE_MAX_ARXIV_CATEGORIES)
  return categories.length > 0 ? categories : [...fallback]
}

export function normalizeWritePaperModeSettings(
  input: WritePaperModeSettingsPatchV1 | undefined
): WritePaperModeSettingsV1 {
  const defaults = defaultWritePaperModeSettings()
  const source = input ?? {}
  const libraries = compactStrings(source.libraries).slice(0, PAPER_MODE_MAX_LIBRARIES)
  const activeLibrary = typeof source.activeLibrary === 'string' ? source.activeLibrary.trim() : ''
  const translate = source.translate ?? {}
  const discover = source.discover ?? {}
  const scholar = source.scholar ?? {}
  const reader = source.reader ?? {}
  return {
    enabled: source.enabled === true,
    libraries,
    activeLibrary,
    autoMarkReading: source.autoMarkReading !== false,
    translate: {
      targetLanguage: translate.targetLanguage === 'en' ? 'en' : 'zh',
      inheritModel: translate.inheritModel !== false,
      providerId: typeof translate.providerId === 'string' ? translate.providerId.trim() : '',
      model: typeof translate.model === 'string' ? translate.model.trim() : '',
      autoTranslateSelection: translate.autoTranslateSelection === true
    },
    discover: {
      arxivCategories: normalizeArxivCategories(
        discover.arxivCategories,
        defaults.discover.arxivCategories
      ),
      feeds: normalizeFeeds(discover.feeds),
      rankMode:
        discover.rankMode === 'embedding' || discover.rankMode === 'off'
          ? discover.rankMode
          : 'lexical',
      embedding: {
        baseUrl: typeof discover.embedding?.baseUrl === 'string' ? discover.embedding.baseUrl.trim() : '',
        apiKey: typeof discover.embedding?.apiKey === 'string' ? discover.embedding.apiKey.trim() : '',
        model: typeof discover.embedding?.model === 'string' ? discover.embedding.model.trim() : ''
      }
    },
    scholar: {
      semanticScholarApiKey:
        typeof scholar.semanticScholarApiKey === 'string' ? scholar.semanticScholarApiKey.trim() : '',
      crossrefMailto:
        typeof scholar.crossrefMailto === 'string' ? scholar.crossrefMailto.trim().slice(0, 200) : '',
      onlineReferences: scholar.onlineReferences !== false
    },
    reader: {
      paperTone: PAPER_TONES.has(reader.paperTone ?? '') ? reader.paperTone! : defaults.reader.paperTone
    }
  }
}

/** Nested-merge patch for `write.paperMode`, mirroring mergeWriteSettings. */
export function mergeWritePaperModeSettings(
  current: WritePaperModeSettingsV1,
  patch: WritePaperModeSettingsPatchV1 | undefined
): WritePaperModeSettingsV1 {
  const discoverPatch = patch?.discover ?? {}
  const nextDiscover: WritePaperModeSettingsPatchV1['discover'] = {
    ...current.discover,
    ...discoverPatch,
    embedding: { ...current.discover.embedding, ...(discoverPatch.embedding ?? {}) }
  }
  return normalizeWritePaperModeSettings({
    ...current,
    ...(patch ?? {}),
    translate: { ...current.translate, ...(patch?.translate ?? {}) },
    discover: nextDiscover,
    scholar: { ...current.scholar, ...(patch?.scholar ?? {}) },
    reader: { ...current.reader, ...(patch?.reader ?? {}) }
  })
}

