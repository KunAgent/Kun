/**
 * Lazy Shiki parser for `prosemirror-highlight` (implementation §7.3).
 * Shares the language normalization of `lib/code-highlighting` and the
 * same theme pair. The highlighter instance is created on first use; a
 * parser call made while it (or a requested language) is still loading
 * returns a promise that resolves once decorations can be produced, and
 * the highlight plugin repaints then.
 */
import type { Parser, ParserOptions } from 'prosemirror-highlight'
import type { createParser as createShikiParser } from 'prosemirror-highlight/shiki'
import type { HighlighterGeneric } from 'shiki'
import { normalizeCodeLanguage } from '../../lib/code-highlighting'

// Above this many lines a code block is rendered without highlighting.
const MAX_HIGHLIGHT_LINES = 2000

// Languages preloaded with the highlighter; anything else is loaded on
// demand and repaints once ready.
const PRELOAD_LANGUAGES = [
  'bash', 'c', 'cpp', 'css', 'diff', 'go', 'html', 'ini', 'java',
  'javascript', 'js', 'json', 'jsonc', 'jsx', 'kotlin', 'lua',
  'markdown', 'php', 'python', 'rust', 'scss', 'shell', 'sql',
  'swift', 'toml', 'ts', 'tsx', 'typescript', 'vue', 'xml', 'yaml'
] as const

const SHIKI_THEMES = { light: 'github-light', dark: 'github-dark' } as const

type ShikiParser = ReturnType<typeof createShikiParser>

let highlighterPromise: Promise<HighlighterGeneric<string, string>> | null = null
let parser: ShikiParser | null = null
const loadedLanguages = new Set<string>()
const languageLoads = new Map<string, Promise<void>>()

async function ensureHighlighter(): Promise<HighlighterGeneric<string, string>> {
  highlighterPromise ??= (async () => {
    const [shiki, shikiHighlight] = await Promise.all([
      import('shiki'),
      import('prosemirror-highlight/shiki')
    ])
    const highlighter = await shiki.createHighlighter({
      themes: [SHIKI_THEMES.light, SHIKI_THEMES.dark],
      langs: [...PRELOAD_LANGUAGES]
    }) as HighlighterGeneric<string, string>
    for (const lang of PRELOAD_LANGUAGES) loadedLanguages.add(lang)
    parser = shikiHighlight.createParser(highlighter, {
      themes: SHIKI_THEMES,
      defaultColor: false
    })
    return highlighter
  })()
  return highlighterPromise
}

function ensureLanguage(language: string): Promise<void> | null {
  if (loadedLanguages.has(language)) return null
  const pending = languageLoads.get(language)
  if (pending) return pending
  const task = ensureHighlighter()
    .then(async (highlighter) => {
      await highlighter.loadLanguage(language as never)
      loadedLanguages.add(language)
    })
    .catch(() => undefined)
    .finally(() => {
      languageLoads.delete(language)
    })
  languageLoads.set(language, task)
  return task
}

/**
 * Parser handed to `createHighlightPlugin`. Synchronous once the
 * highlighter and the requested language are warm; otherwise kicks off
 * the load and returns a promise (the plugin re-runs on resolution).
 */
export const codeHighlightParser: Parser = (options: ParserOptions) => {
  const language = normalizeCodeLanguage(options.language ?? '')
  if (!language || language === 'mermaid') return []
  const lineCount = options.content.split('\n').length
  if (lineCount > MAX_HIGHLIGHT_LINES) return []
  if (!parser) {
    return ensureHighlighter().then(() => undefined)
  }
  const loading = ensureLanguage(language)
  if (loading) return loading
  try {
    return parser(options)
  } catch {
    return []
  }
}
