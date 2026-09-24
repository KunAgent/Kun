import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'

export const WRITE_AI_PROPERTIES_MAX_DOCUMENT_CHARS = 24_000
export const WRITE_AI_PROPERTIES_MAX_YAML_CHARS = 10_000

export type WriteAiPropertiesRequest = {
  /** Markdown body (frontmatter already stripped) the model should describe. */
  documentText: string
  /**
   * Current frontmatter interior (no `---` fences) so the model can keep its
   * keys consistent; the renderer still merges defensively.
   */
  existingYaml?: string
  /** Optional model override; falls back to the inline-completion model. */
  model?: string
}

export type WriteAiPropertiesResult =
  | {
      ok: true
      /** Generated frontmatter interior (no fences), normalized YAML. */
      yaml: string
      model: string
    }
  | { ok: false; message: string }

/** Bridge surface slice for AI-assisted frontmatter generation. */
export type KunGuiWriteAiApi = {
  requestWriteAiProperties: (
    payload: WriteAiPropertiesRequest
  ) => Promise<WriteAiPropertiesResult>
}

const AI_PROPERTIES_SYSTEM_PROMPT = [
  'You write YAML frontmatter properties for a Markdown document.',
  'Output ONLY a YAML mapping: no code fences, no comments, no explanations.',
  'Useful keys: title (short document title), description (1-2 sentence summary),',
  'tags (list of 2-6 short tags), date (YYYY-MM-DD only when the document states one),',
  'plus at most 2 other clearly useful keys. Flat scalar/list values only, never nested maps.',
  'Write values in the same language as the document.'
].join('\n')

/** Chat messages for the AI-properties request (system + user). */
export function buildWriteAiPropertiesMessages(
  request: Pick<WriteAiPropertiesRequest, 'documentText' | 'existingYaml'>
): Array<{ role: 'system' | 'user'; content: string }> {
  const sections: string[] = []
  const existing = request.existingYaml?.trim()
  if (existing) {
    sections.push(
      'Existing frontmatter (do not repeat these keys; only output NEW properties):\n' + existing
    )
  }
  sections.push('Document:\n' + request.documentText.slice(0, WRITE_AI_PROPERTIES_MAX_DOCUMENT_CHARS))
  return [
    { role: 'system', content: AI_PROPERTIES_SYSTEM_PROMPT },
    { role: 'user', content: sections.join('\n\n') }
  ]
}

function isPlainMapping(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function isYamlScalar(value: unknown): value is string | number | boolean {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
}

const MAX_AI_PROPERTY_KEYS = 8
const MAX_AI_KEY_CHARS = 64
const MAX_AI_VALUE_CHARS = 400
const MAX_AI_LIST_ITEMS = 12

/**
 * Turn raw model output into normalized frontmatter interior. Strips code
 * fences, keeps only flat scalar/list entries the form editor can represent,
 * and returns null when nothing usable remains.
 */
export function normalizeAiPropertiesYaml(raw: string): string | null {
  const stripped = raw
    .trim()
    .replace(/^```(?:yaml|yml)?\s*\r?\n?/i, '')
    .replace(/\r?\n?```\s*$/i, '')
    .trim()
  if (!stripped) return null
  let doc: unknown
  try {
    doc = parseYaml(stripped)
  } catch {
    return null
  }
  if (!isPlainMapping(doc)) return null
  const out: Record<string, unknown> = {}
  for (const [rawKey, value] of Object.entries(doc)) {
    if (Object.keys(out).length >= MAX_AI_PROPERTY_KEYS) break
    const key = rawKey.trim()
    if (!key || key.length > MAX_AI_KEY_CHARS || key.includes('\n')) continue
    if (isYamlScalar(value)) {
      const text = String(value)
      out[key] = text.length > MAX_AI_VALUE_CHARS ? text.slice(0, MAX_AI_VALUE_CHARS) : value
    } else if (Array.isArray(value)) {
      const items = value.filter(isYamlScalar).slice(0, MAX_AI_LIST_ITEMS)
      if (items.length) out[key] = items
    } else if (value instanceof Date) {
      out[key] = value.toISOString().slice(0, 10)
    }
  }
  return Object.keys(out).length ? stringifyYaml(out).trim() : null
}

/**
 * Append generated frontmatter YAML to an existing interior without touching
 * what's already there: existing top-level keys win, only new keys are
 * appended. Returns null when either side is not a flat-friendly YAML mapping
 * (caller should fall back to the source editor instead of overwriting).
 */
export function mergeFrontmatterYamlAddition(interior: string, addition: string): string | null {
  let additionDoc: unknown
  try {
    additionDoc = parseYaml(addition)
  } catch {
    return null
  }
  if (!isPlainMapping(additionDoc)) return null
  const base = interior.replace(/\s+$/, '')
  if (!base.trim()) return stringifyYaml(additionDoc).trim()
  let existingDoc: unknown
  try {
    existingDoc = parseYaml(interior)
  } catch {
    return null
  }
  if (!isPlainMapping(existingDoc)) return null
  const existingKeys = new Set(Object.keys(existingDoc))
  const additions = Object.fromEntries(
    Object.entries(additionDoc).filter(([key]) => !existingKeys.has(key))
  )
  const fragment = Object.keys(additions).length ? stringifyYaml(additions).trim() : ''
  return fragment ? `${base}\n${fragment}` : base
}
