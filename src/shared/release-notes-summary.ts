/**
 * Turns a curated `release/release-v<version>.md` file into the short summary
 * the post-update dialog shows. The files are bilingual: Chinese sections come
 * first, then a `---` rule and a `## English` section.
 */

export type ReleaseNotesLanguage = 'zh' | 'en'

export type ReleaseNoteItem = {
  title: string
  body: string
}

export type ReleaseNotesSummary = {
  version: string
  intro: string
  features: ReleaseNoteItem[]
  fixes: ReleaseNoteItem[]
}

type Category = 'features' | 'fixes' | 'skip'

const ENGLISH_HEADING = /^##\s+english\b/i
const FIX_HEADING = /修复|改进|\bfix(es)?\b|improvement|bug/i
const FEATURE_HEADING = /新功能|亮点|功能|highlight|feature|what'?s new/i
const SKIP_HEADING = /更新方式|升级方式|安装|how to update|upgrad|install|download|compatib|兼容/i
const CATCH_ALL_TITLE = /^(其他|其它|更多|more|misc|others?)$/i

export function compareVersions(a: string, b: string): number {
  const parse = (value: string): number[] => value.trim().replace(/^v/i, '').split(/[-+]/)[0]
    .split('.').map((part) => Number.parseInt(part, 10) || 0)
  const left = parse(a)
  const right = parse(b)
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    const diff = (left[i] ?? 0) - (right[i] ?? 0)
    if (diff !== 0) return diff > 0 ? 1 : -1
  }
  return 0
}

/** Picks the half of a bilingual release file that matches the UI language. */
function languageSection(markdown: string, language: ReleaseNotesLanguage): string {
  const lines = markdown.replace(/\r\n?/g, '\n').split('\n')
  const englishAt = lines.findIndex((line) => ENGLISH_HEADING.test(line.trim()))
  if (englishAt < 0) return lines.join('\n')
  if (language === 'en') return lines.slice(englishAt + 1).join('\n')
  const zh = lines.slice(0, englishAt)
  while (zh.length && /^(\s*|-{3,}|\*{3,})$/.test(zh[zh.length - 1].trim())) zh.pop()
  return zh.join('\n')
}

export function cleanInlineMarkdown(text: string): string {
  return text
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\s*[(（](?:#[0-9a-f]+(?:[,，、]\s*)?)+[)）]/gi, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseItem(raw: string): ReleaseNoteItem {
  const bold = /^\*\*(.+?)\*\*\s*[：:—–-]?\s*(.*)$/.exec(raw.trim())
  if (bold) {
    const body = cleanInlineMarkdown(bold[2])
    return { title: cleanInlineMarkdown(bold[1]).replace(/[：:]$/, ''), body: body.charAt(0).toUpperCase() + body.slice(1) }
  }
  return { title: '', body: cleanInlineMarkdown(raw) }
}

function headingCategory(heading: string, inherited: Category): Category {
  if (SKIP_HEADING.test(heading)) return 'skip'
  // "新功能与体验改进" and "Features and improvements" name both kinds: the first one wins.
  const fixAt = heading.search(FIX_HEADING)
  const featureAt = heading.search(FEATURE_HEADING)
  if (fixAt >= 0 && (featureAt < 0 || fixAt < featureAt)) return 'fixes'
  if (featureAt >= 0) return 'features'
  return inherited
}

export function parseReleaseNotes(
  markdown: string,
  version: string,
  language: ReleaseNotesLanguage
): ReleaseNotesSummary | null {
  const summary = parseSection(languageSection(markdown, language), version)
  if (!summary || language !== 'en' || summary.fixes.length) return summary
  // English halves are often one flat list in the Chinese order (features,
  // then fixes). Split it the same way when the counts line up.
  const zh = parseSection(languageSection(markdown, 'zh'), version)
  if (!zh || !zh.fixes.length || zh.features.length + zh.fixes.length !== summary.features.length) return summary
  return {
    ...summary,
    features: summary.features.slice(0, zh.features.length),
    fixes: summary.features.slice(zh.features.length)
  }
}

function parseSection(section: string, version: string): ReleaseNotesSummary | null {
  const lines = section.split('\n')
  const features: ReleaseNoteItem[] = []
  const fixes: ReleaseNoteItem[] = []
  const introLines: string[] = []
  let introDone = false
  let sectionCategory: Category = 'features'
  let category: Category = 'features'
  let group = ''
  let current: string[] | null = null

  const flush = (): void => {
    if (!current) return
    const item = parseItem(current.join(' '))
    current = null
    if (!item.title && !item.body) return
    const list = category === 'fixes' ? fixes : features
    if (!item.title && group) {
      // Older files group untitled bullets under `###` headings: one item per group.
      if (list[list.length - 1]?.title === group) return
      item.title = group
    }
    list.push(item)
  }

  for (const line of lines) {
    const heading = /^(#{1,6})\s+(.*)$/.exec(line.trim())
    if (heading) {
      flush()
      introDone = introDone || heading[1].length > 1
      if (heading[1].length === 1) continue
      group = ''
      if (heading[1].length === 2) {
        sectionCategory = headingCategory(heading[2], 'features')
        category = sectionCategory
      } else {
        category = headingCategory(heading[2], sectionCategory === 'skip' ? 'skip' : sectionCategory)
        if (category === sectionCategory && category !== 'skip') group = cleanInlineMarkdown(heading[2])
      }
      continue
    }
    const bullet = /^[-*+]\s+(.*)$/.exec(line)
    if (bullet) {
      flush()
      introDone = true
      if (category !== 'skip') current = [bullet[1]]
      continue
    }
    if (/^\s+\S/.test(line) && current) {
      // Nested bullets and wrapped lines belong to the item above.
      if (!/^\s+[-*+]\s/.test(line)) current.push(line.trim())
      continue
    }
    flush()
    const text = line.trim()
    if (!text) {
      if (introLines.length) introDone = true
      continue
    }
    if (!introDone && !/^(-{3,}|\*{3,}|\[)/.test(text)) introLines.push(text)
  }
  flush()

  const intro = cleanInlineMarkdown(introLines.join(' '))
  if (!features.length && !fixes.length && !intro) return null
  return { version: version.replace(/^v/i, ''), intro, features, fixes }
}

/** First sentence of a long description, so a row stays one or two lines. */
export function firstSentence(text: string, maxLength = 96): string {
  const sentences = text.match(/[^。！？；!?;]+[。！？；!?;]|[^.]+\.(?=\s|$)|.+$/g) ?? [text]
  let sentence = ''
  for (const part of sentences) {
    sentence += part
    if (sentence.trim().length >= 28) break
  }
  sentence = sentence.trim().replace(/[；;，,、]$/, '')
  if (sentence.length <= maxLength) return sentence
  return `${sentence.slice(0, maxLength - 1).trimEnd()}…`
}

export function isCatchAllItem(item: ReleaseNoteItem): boolean {
  return CATCH_ALL_TITLE.test(item.title.trim())
}

export type ReleaseNotesHighlights = {
  highlights: ReleaseNoteItem[]
  alsoUpdated: string[]
}

export type PickHighlightsOptions = {
  /** Titles another part of the dialog already tells, such as a spotlight card. */
  exclude?: RegExp
  limit?: number
}

/** Up to `limit` (three) highlight rows plus up to four "also updated" chips. */
export function pickHighlights(
  summary: ReleaseNotesSummary,
  { exclude, limit = 3 }: PickHighlightsOptions = {}
): ReleaseNotesHighlights {
  const named = summary.features.filter((item) => item.title && !isCatchAllItem(item) && !exclude?.test(item.title))
  const highlights = named.slice(0, limit).map((item) => ({ title: item.title, body: firstSentence(item.body) }))
  const alsoUpdated = named.slice(limit, limit + 4).map((item) => item.title)
  if (!highlights.length) {
    const untitled = summary.features.filter((item) => !isCatchAllItem(item)).slice(0, limit)
    return { highlights: untitled.map((item) => ({ title: '', body: firstSentence(item.body) })), alsoUpdated }
  }
  return { highlights, alsoUpdated }
}
