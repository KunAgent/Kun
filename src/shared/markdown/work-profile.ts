/**
 * Shared Work-document profile: callout type table, HTML allowlist, and the
 * inline-math recognition rule. Used by the renderer editor, the shared
 * remark plugins, and the export render pipeline (implementation §1, §7).
 */

/** Callout type → lucide-style icon name + palette slot. Unknown but legal
 * types render with the `note` style while keeping their original case. */
export type WorkCalloutKind = {
  /** Aliases normalized to this canonical type (lowercase). */
  aliases: string[]
  /** Icon identifier for the NodeView header button. */
  icon: 'note' | 'tip' | 'important' | 'warning' | 'caution' | 'info' | 'todo' |
    'abstract' | 'success' | 'question' | 'failure' | 'danger' | 'bug' | 'example' | 'quote'
  /** Accent color token name used by the stylesheet. */
  tone: 'blue' | 'green' | 'purple' | 'yellow' | 'red' | 'cyan' | 'gray'
}

export const WORK_CALLOUT_TYPES: Record<string, WorkCalloutKind> = {
  note: { aliases: ['note'], icon: 'note', tone: 'blue' },
  tip: { aliases: ['tip', 'hint'], icon: 'tip', tone: 'green' },
  important: { aliases: ['important'], icon: 'important', tone: 'purple' },
  warning: { aliases: ['warning'], icon: 'warning', tone: 'yellow' },
  caution: { aliases: ['caution', 'attention'], icon: 'caution', tone: 'red' },
  info: { aliases: ['info'], icon: 'info', tone: 'blue' },
  todo: { aliases: ['todo'], icon: 'todo', tone: 'blue' },
  abstract: { aliases: ['abstract', 'summary', 'tldr'], icon: 'abstract', tone: 'cyan' },
  success: { aliases: ['success', 'check', 'done'], icon: 'success', tone: 'green' },
  question: { aliases: ['question', 'help', 'faq'], icon: 'question', tone: 'yellow' },
  failure: { aliases: ['failure', 'fail', 'missing'], icon: 'failure', tone: 'red' },
  danger: { aliases: ['danger', 'error'], icon: 'danger', tone: 'red' },
  bug: { aliases: ['bug'], icon: 'bug', tone: 'red' },
  example: { aliases: ['example'], icon: 'example', tone: 'purple' },
  quote: { aliases: ['quote', 'cite'], icon: 'quote', tone: 'gray' }
}

const CALLOUT_ALIAS_INDEX = new Map<string, string>()
for (const [canonical, def] of Object.entries(WORK_CALLOUT_TYPES)) {
  for (const alias of def.aliases) CALLOUT_ALIAS_INDEX.set(alias, canonical)
}

/** Normalize a `> [!TYPE]` marker to its canonical callout type. */
export function resolveWorkCalloutType(typeRaw: string): string {
  return CALLOUT_ALIAS_INDEX.get(typeRaw.toLowerCase()) ?? 'note'
}

/** Legal callout marker type (charset check only, not the alias table). */
export const WORK_CALLOUT_TYPE_RE = /^[A-Za-z0-9_-]+$/

/**
 * HTML allowlist shared by DOMPurify (editor NodeViews) and rehype-sanitize
 * (export pipeline). Everything else — script/style/form/iframe, all `on*`
 * attributes — is stripped.
 */
export const WORK_HTML_ALLOWED_TAGS = [
  'div', 'center', 'p', 'span', 'img', 'br', 'kbd', 'sub', 'sup', 'u', 'mark',
  'details', 'summary', 'b', 'strong', 'i', 'em', 's', 'del', 'ins', 'table',
  'thead', 'tbody', 'tr', 'th', 'td', 'caption', 'hr', 'a', 'font'
] as const

export const WORK_HTML_ALLOWED_ATTRS = [
  'align', 'src', 'alt', 'title', 'width', 'height', 'colspan', 'rowspan',
  'href', 'rel', 'target', 'color', 'face', 'size', 'open'
] as const

/** DOMPurify config used by editor NodeViews (§7.5). */
export const WORK_HTML_PURIFY_CONFIG = {
  ALLOWED_TAGS: [...WORK_HTML_ALLOWED_TAGS],
  ALLOWED_ATTR: [...WORK_HTML_ALLOWED_ATTRS],
  FORBID_TAGS: ['script', 'style', 'form', 'iframe', 'object', 'embed', 'input', 'textarea'],
  FORBID_ATTR: ['srcdoc', 'formaction'],
  ALLOW_DATA_ATTR: false
} as const

/**
 * Pandoc-style inline-math rule (§3.1): an opening `$` must be followed by a
 * non-space character; the closing `$` must be preceded by a non-space
 * character and must not be followed by a digit. `\$` never opens or closes.
 * Applied to mdast `text` nodes by `remarkInlineMathPandoc`.
 */
export const WORK_INLINE_MATH_RE = /(?<![\\$])\$(?!\s)(?:[^\n$]|\\[\s\S])+?(?<!\s)\$(?!\d)/
