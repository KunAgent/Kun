/**
 * What the import sheet remembers between uses: new topic folder vs an
 * existing folder, the last existing folder, and the two switches.
 */
const KEY = 'kun.paper.importSheet.v1'

export type ImportSheetPrefs = {
  mode: 'new' | 'existing'
  existing: string
  byGroup: boolean
  owned: 'keep' | 'move'
}

export const DEFAULT_IMPORT_SHEET_PREFS: ImportSheetPrefs = {
  mode: 'new',
  existing: '',
  byGroup: true,
  owned: 'keep'
}

export function readImportSheetPrefs(): ImportSheetPrefs {
  try {
    const raw = JSON.parse(window.localStorage.getItem(KEY) ?? '{}') as Partial<ImportSheetPrefs>
    return {
      mode: raw.mode === 'existing' ? 'existing' : 'new',
      existing: typeof raw.existing === 'string' ? raw.existing : '',
      byGroup: raw.byGroup !== false,
      owned: raw.owned === 'move' ? 'move' : 'keep'
    }
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
