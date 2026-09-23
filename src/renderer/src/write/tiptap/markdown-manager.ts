import {
  textblockTypeInputRule,
  type AnyExtension,
  type JSONContent,
  type MarkdownTokenizer
} from '@tiptap/core'
import { MarkdownManager } from '@tiptap/markdown'
import { StarterKit } from '@tiptap/starter-kit'
import { TableKit } from '@tiptap/extension-table'
import { OrderedList, TaskItem, TaskList } from '@tiptap/extension-list'
import { CodeBlock, tildeInputRegex } from '@tiptap/extension-code-block'
import { Plugin, TextSelection, type EditorState, type Transaction } from '@tiptap/pm/state'
import { WriteLocalImage } from './local-image'
import { findUnsupportedConstructs } from './markdown-construct-gate'
import { buildWorkConstructExtensions } from './nodes'

export type WriteRichFidelity =
  | { eligible: true; normalized: string }
  | { eligible: false; reason: 'parse-error' | 'unstable' | 'text-loss' | 'unsupported-construct'; detail?: string }

// Rich mode refuses documents above this size; CodeMirror handles them better
// and the open-time fidelity audit below would get expensive.
export const WRITE_RICH_MAX_CHARS = 300_000
export const WRITE_BACKTICK_FENCE_INPUT_REGEX = /^(`{3,})([A-Za-z0-9_+#.-]+)?[\s\n]$/

export function closeWriteRichCodeFence(
  state: EditorState,
  from: number,
  to: number,
  text: string
): Transaction | null {
  if (text !== '`' || from !== to) return null
  const $from = state.doc.resolve(from)
  if ($from.parent.type.name !== 'codeBlock') return null
  const fenceLength = Math.max(3, Math.floor(Number($from.parent.attrs.writeFenceLength) || 3))
  const before = $from.parent.textBetween(0, $from.parentOffset, '\n', '\n')
  const lineStartOffset = before.lastIndexOf('\n') + 1
  const linePrefix = before.slice(lineStartOffset)
  if (linePrefix !== '`'.repeat(fenceLength - 1)) return null

  let deleteFrom = from - linePrefix.length
  if (lineStartOffset > 0) deleteFrom -= 1
  const paragraph = state.schema.nodes.paragraph
  if (!paragraph) return null
  const afterCodeBlock = $from.after($from.depth)
  const tr = state.tr.delete(deleteFrom, to)
  const insertAt = tr.mapping.map(afterCodeBlock)
  tr.insert(insertAt, paragraph.create())
  tr.setSelection(TextSelection.create(tr.doc, insertAt + 1))
  return tr.scrollIntoView()
}

function safeBacktickFence(text: string, requestedLength: unknown): string {
  let longestRun = 0
  for (const match of text.matchAll(/`+/g)) {
    longestRun = Math.max(longestRun, match[0].length)
  }
  const requested = Math.max(3, Math.floor(Number(requestedLength) || 3))
  return '`'.repeat(Math.max(requested, longestRun + 1))
}

export const WriteCodeBlock = CodeBlock.extend({
  name: 'codeBlock',

  addAttributes() {
    return {
      ...this.parent?.(),
      writeFenceLength: {
        default: 3,
        rendered: false
      },
      fenceChar: {
        default: '`',
        rendered: false
      },
      meta: {
        default: null,
        rendered: false
      }
    }
  },

  addInputRules() {
    return [
      textblockTypeInputRule({
        find: WRITE_BACKTICK_FENCE_INPUT_REGEX,
        type: this.type,
        getAttributes: (match) => ({
          language: match[2] || null,
          writeFenceLength: match[1]?.length ?? 3
        })
      }),
      textblockTypeInputRule({
        find: tildeInputRegex,
        type: this.type,
        getAttributes: (match) => ({ language: match[1] || null })
      })
    ]
  },

  renderMarkdown(node, h) {
    const language = typeof node.attrs?.language === 'string' ? node.attrs.language : ''
    const code = node.content ? h.renderChildren(node.content) : ''
    const fence = safeBacktickFence(code, node.attrs?.writeFenceLength)
    return [fence + language, code, fence].join('\n')
  },

  addProseMirrorPlugins() {
    return [...(this.parent?.() ?? []), new Plugin({
      props: {
        handleTextInput: (view, from, to, text) => {
          const tr = closeWriteRichCodeFence(view.state, from, to, text)
          if (!tr) return false
          view.dispatch(tr)
          return true
        }
      }
    })]
  }
})

/**
 * marked calls every registered block tokenizer at every block boundary with
 * the whole remaining document; the stock orderedList/taskList tokenizers
 * then `src.split("\n")` the remainder, which is O(n^2) over the document.
 * Both can only produce a token when the first relevant line is a list item,
 * so a cheap guard skips the split entirely (byte-identical output).
 * Note: `collectOrderedListItems` breaks on a non-matching first line, while
 * `parseIndentedBlocks` (taskList) skips leading blank lines first — so the
 * guards differ: strict first line vs. first non-blank line.
 */
function guardFirstLine(
  tokenizer: MarkdownTokenizer,
  itemLine: RegExp,
  skipBlankLines: boolean
): MarkdownTokenizer {
  return {
    ...tokenizer,
    tokenize(src, tokens, lexer) {
      let offset = 0
      let line = ''
      while (true) {
        const newline = src.indexOf('\n', offset)
        line = newline < 0 ? src.slice(offset) : src.slice(offset, newline)
        if (line.trim() !== '' || !skipBlankLines || newline < 0) break
        offset = newline + 1
      }
      // All-blank input delegates to the original so edge behavior is kept.
      if (line.trim() !== '' && !itemLine.test(line)) return undefined
      return tokenizer.tokenize(src, tokens, lexer)
    }
  }
}

export const WriteOrderedList = OrderedList.extend({
  markdownTokenizer: guardFirstLine(
    OrderedList.config.markdownTokenizer!,
    /^(\s*)(\d+)\.\s+/,
    false
  ),

  addAttributes() {
    return {
      ...this.parent?.(),
      tight: { default: true, rendered: false }
    }
  }
})

export const WriteTaskList = TaskList.extend({
  markdownTokenizer: guardFirstLine(
    TaskList.config.markdownTokenizer!,
    /^(\s*)([-+*])\s+\[([ xX])\]\s+/,
    true
  ),

  addAttributes() {
    return {
      ...this.parent?.(),
      tight: { default: true, rendered: false }
    }
  }
})

export type WriteRichRuntimeOptions = {
  /** Configured WriteLocalImage instance (the base schema uses the plain one). */
  image?: AnyExtension
  /** Runtime-only extensions: inline completion, paste image, shortcuts, badges. */
  extra?: AnyExtension[]
}

export function buildWriteRichExtensions(runtime?: WriteRichRuntimeOptions): AnyExtension[] {
  return [
    StarterKit.configure({
      link: false,
      bulletList: false,
      codeBlock: false,
      orderedList: false,
      // The rich editor manages undo depth like the CodeMirror history()
      undoRedo: { depth: 200 }
    }),
    TableKit.configure({
      table: { resizable: false },
      tableHeader: false,
      tableCell: false
    }),
    WriteOrderedList,
    WriteTaskList,
    TaskItem.configure({ nested: true }),
    WriteCodeBlock,
    ...buildWorkConstructExtensions(),
    runtime?.image ?? WriteLocalImage,
    ...(runtime?.extra ?? [])
  ]
}

let sharedManager: MarkdownManager | null = null

export function getWriteMarkdownManager(): MarkdownManager {
  if (!sharedManager) {
    sharedManager = new MarkdownManager({
      markedOptions: { gfm: true },
      extensions: buildWriteRichExtensions()
    })
  }
  return sharedManager
}

export function parseWriteMarkdown(markdown: string): JSONContent {
  return getWriteMarkdownManager().parse(markdown)
}

export function serializeWriteMarkdown(doc: JSONContent): string {
  return getWriteMarkdownManager().serialize(doc)
}

function collectPlainText(node: JSONContent | undefined, acc: string[]): string[] {
  if (!node) return acc
  if (node.type === 'text' && node.text) acc.push(node.text)
  if (Array.isArray(node.content)) {
    for (const child of node.content) collectPlainText(child, acc)
  }
  return acc
}

function normalizedPlainText(doc: JSONContent): string {
  return collectPlainText(doc, []).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * Open-time gate for the rich editor. A document is eligible only when the
 * markdown round-trip is idempotent after one pass and loses no plain text;
 * everything else (hard-wrapped list continuations, raw HTML blocks, syntax
 * the schema cannot represent) stays in the CodeMirror editor so the file on
 * disk is never silently rewritten.
 */
export function auditWriteMarkdownFidelity(markdown: string): WriteRichFidelity {
  if (markdown.length > WRITE_RICH_MAX_CHARS) {
    return { eligible: false, reason: 'text-loss', detail: 'document too large for rich mode' }
  }
  const constructs = findUnsupportedConstructs(markdown)
  if (constructs.length > 0) {
    return {
      eligible: false,
      reason: 'unsupported-construct',
      detail: constructs.join(',')
    }
  }
  const manager = getWriteMarkdownManager()
  let firstDoc: JSONContent
  let firstPass: string
  let secondPass: string
  let secondDoc: JSONContent
  try {
    firstDoc = manager.parse(markdown)
    firstPass = manager.serialize(firstDoc)
    secondDoc = manager.parse(firstPass)
    secondPass = manager.serialize(secondDoc)
  } catch (error) {
    return {
      eligible: false,
      reason: 'parse-error',
      detail: error instanceof Error ? error.message : String(error)
    }
  }
  if (firstPass !== secondPass) {
    return { eligible: false, reason: 'unstable' }
  }
  if (normalizedPlainText(firstDoc) !== normalizedPlainText(secondDoc)) {
    return { eligible: false, reason: 'text-loss' }
  }
  return { eligible: true, normalized: firstPass }
}
