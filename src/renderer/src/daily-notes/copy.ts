import english from '../locales/en/common/sidebar.json'

export type DailyNotesCopy = typeof english.dailyNotes

const translations = import.meta.glob<DailyNotesCopy>('../locales/*/common/sidebar.json', {
  eager: true, import: 'dailyNotes'
})

export function dailyNotesCopy(locale: string): DailyNotesCopy {
  return translations[`../locales/${locale}/common/sidebar.json`] ?? english.dailyNotes
}
