import { codeFolding } from '@codemirror/language'
import { markdown, markdownLanguage } from '@codemirror/lang-markdown'
import type { Extension } from '@codemirror/state'

export function cmMarkdownExt(): Extension[] {
  return [markdown({ base: markdownLanguage }), codeFolding()]
}
