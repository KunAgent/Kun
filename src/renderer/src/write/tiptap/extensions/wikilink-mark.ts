import { InputRule, Mark, mergeAttributes } from '@tiptap/core'

/**
 * Schema-level identity for `[[wikilinks]]` in the rich editor.
 *
 * `@tiptap/markdown` backslash-escapes every `[` it serializes as plain text,
 * so without a schema type a `[[wikilink]]` would reach disk as
 * `\[\[wikilink\]\]` — a form the knowledge indexer never matches. The first
 * fix was a global regex un-escaping every `\[\[...\]\]` on the way out, but
 * that also rewrote brackets the author escaped deliberately, silently turning
 * literal text into an active link.
 *
 * This mark keeps the distinction where it belongs, in the document model:
 *
 * - Parsing: a marked tokenizer matches *bare* `[[target]]` (the same shape
 *   the knowledge indexer extracts, `[[target]]` / `[[target|label]]`) and
 *   marks it. A source-escaped `\[\[...\]\]` never reaches the tokenizer —
 *   marked's escape rule consumes each `\[` first — so it stays plain text.
 * - Serializing: the mark declares `code: true`, which the markdown manager
 *   already honours by writing the covered text verbatim — brackets survive
 *   unescaped. Plain text keeps the default escaping, so deliberate
 *   `\[\[...\]\]` round-trips escaped, exactly as written.
 *
 * The covered text keeps its brackets (`[[target]]`), so nothing changes
 * visually and plain-text extraction is unaffected.
 */

/** Matches at a position already known to start with `[[`. */
const WIKILINK_TOKEN_PATTERN = /^\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/

/** Fires as the closing `]]` is typed, so hand-typed links get the mark too. */
const WIKILINK_INPUT_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]$/

export const WriteWikilink = Mark.create({
  name: 'wikilink',

  // Typing right after the closing `]]` must not extend the link.
  inclusive: false,

  // The markdown serializer writes `code` content verbatim: no backslash
  // escaping, no entity encoding. That is the whole mechanism that lets the
  // brackets reach disk bare while unmarked brackets stay escaped.
  code: true,

  parseHTML() {
    return [{ tag: 'span[data-write-wikilink]' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { 'data-write-wikilink': 'true' }), 0]
  },

  markdownTokenName: 'wikilink',

  markdownTokenizer: {
    name: 'wikilink',
    level: 'inline',
    // `\[\[` in source never contains consecutive brackets, so an escaped
    // sequence cannot even produce a start index here.
    start: (src: string) => src.indexOf('[['),
    tokenize: (src: string) => {
      const match = WIKILINK_TOKEN_PATTERN.exec(src)
      if (!match) return undefined
      return { type: 'wikilink', raw: match[0], text: match[0] }
    }
  },

  parseMarkdown(token, helpers) {
    return helpers.applyMark('wikilink', [{ type: 'text', text: String(token.raw ?? '') }])
  },

  renderMarkdown(node, helpers) {
    // No delimiters of its own: the covered text already carries its brackets,
    // and `code: true` above keeps them from being escaped.
    return helpers.renderChildren(node)
  },

  addInputRules() {
    return [
      new InputRule({
        find: WIKILINK_INPUT_PATTERN,
        handler: ({ state, range, match }) => {
          // The handler owns the insertion of the typed character (ProseMirror
          // suppresses the raw one once a rule handles it), so write the full
          // matched text back — character-identical — and mark it whole. The
          // brackets stay in the document: the editor shows what disk holds.
          const full = match[0] ?? ''
          if (!full) return
          state.tr
            .insertText(full, range.from, range.to)
            .addMark(range.from, range.from + full.length, this.type.create())
            .removeStoredMark(this.type)
        }
      })
    ]
  }
})
