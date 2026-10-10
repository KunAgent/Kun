/**
 * What the import sheet remembers between uses: the folder it opens on,
 * whether to also make a topic subfolder, and the two switches.
 */
const KEY = 'kun.paper.importSheet.v2'
/** v1 stored a `new | existing` mode instead of a parent folder. */
const LEGACY_KEY = 'kun.paper.importSheet.v1'

export type ImportSheetPrefs = {
  /** Folder the sheet opens on ('' = the papers dir). */
  parent: string
  /** Start with a new subfolder named after the search topic. */
  topicFolder: boolean
  byGroup: boolean
  owned: 'keep' | 'move'
}

export const DEFAULT_IMPORT_SHEET_PREFS: ImportSheetPrefs = {
  parent: '',
  topicFolder: true,
  byGroup: true,
  owned: 'keep'
}

type StoredPrefs = Partial<ImportSheetPrefs> & { mode?: unknown; existing?: unknown }

function parsePrefs(raw: StoredPrefs): ImportSheetPrefs {
  const legacyParent = raw.mode === 'existing' && typeof raw.existing === 'string' ? raw.existing : ''
  return {
    parent: typeof raw.parent === 'string' ? raw.parent : legacyParent,
    topicFolder: typeof raw.topicFolder === 'boolean' ? raw.topicFolder : raw.mode !== 'existing',
    byGroup: raw.byGroup !== false,
    owned: raw.owned === 'move' ? 'move' : 'keep'
  }
}

export function readImportSheetPrefs(): ImportSheetPrefs {
  try {
    const stored = window.localStorage.getItem(KEY) ?? window.localStorage.getItem(LEGACY_KEY)
    return parsePrefs(JSON.parse(stored ?? '{}') as StoredPrefs)
  } catch {
    return DEFAULT_IMPORT_SHEET_PREFS
  }
}

export function writeImportSheetPrefs(prefs: ImportSheetPrefs): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(prefs))
  } catch {
    // Remembering the choice is a convenience only.
  }
}
