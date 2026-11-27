import en from '../locales/en/settings/pets.json'
import hi from '../locales/hi/settings/pets.json'
import ja from '../locales/ja/settings/pets.json'
import ko from '../locales/ko/settings/pets.json'
import ru from '../locales/ru/settings/pets.json'
import th from '../locales/th/settings/pets.json'
import zh from '../locales/zh/settings/pets.json'

const PACKS: Record<string, { petsContextSettings: string; petsContextHide: string }> = {
  en, zh, ru, hi, th, ja, ko
}

export function petContextMenuLabels(language: string): {
  settings: string
  hide: string
  ensemble: string
  muteSound: string
  unmuteSound: string
} {
  const code = language.toLowerCase().split('-')[0] ?? ''
  const pack = PACKS[code] ?? en
  const isZh = code === 'zh'
  return {
    settings: pack.petsContextSettings,
    hide: pack.petsContextHide,
    ensemble: isZh ? '叫朋友来玩' : 'Invite friends',
    muteSound: isZh ? '关闭音效' : 'Mute sound',
    unmuteSound: isZh ? '开启音效' : 'Enable sound'
  }
}
