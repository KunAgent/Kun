import { isAlias, isMap, isScalar, isSeq, parseAllDocuments, parseDocument, visit, type Document, type Node } from 'yaml'

/**
 * Comment-keeping YAML editing for agent configs (Goose, Continue, Aider).
 *
 * Edits go through the `yaml` document model so comments, key order and
 * untouched scalars stay as the user wrote them. The engine still restores
 * an untouched file from its byte-exact backup; this editor is only used for
 * files the user changed after Kun wrote them. Anchors, aliases, tags and
 * multi-document files are refused rather than rewritten.
 */
const OPTIONS = { lineWidth: 0, minContentWidth: 0 } as const

function load(text: string): Document {
  if (!text.trim()) return parseDocument('{}\n')
  if (parseAllDocuments(text).length > 1) throw new Error('YAML files with several documents are not supported')
  const doc = parseDocument(text, { keepSourceTokens: false })
  if (doc.errors.length) throw new Error(`YAML parse error: ${doc.errors[0]!.message}`)
  let unsupported = false
  visit(doc, { Node(_key, node) { if (isAlias(node) || ('anchor' in node && node.anchor)) unsupported = true } })
  if (unsupported) throw new Error('YAML anchors and aliases are not supported; edit this file by hand')
  if (doc.contents !== null && !isMap(doc.contents)) throw new Error('The YAML document is not a mapping')
  return doc
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Updates an existing node to hold `value`, keeping the node (and the
 * comments attached to it and its children) wherever the shape matches.
 * Returns false when the node has to be replaced instead.
 */
function assign(doc: Document, node: Node, value: unknown): boolean {
  if (isScalar(node) && (value === null || ['string', 'number', 'boolean'].includes(typeof value))) {
    if (node.value !== value) node.value = value
    return true
  }
  if (isMap(node) && isPlainObject(value)) {
    for (const pair of [...node.items]) {
      const key = isScalar(pair.key) ? String(pair.key.value) : String(pair.key)
      if (!(key in value)) node.delete(pair.key)
    }
    for (const [key, entry] of Object.entries(value)) {
      if (entry === undefined) { node.delete(key); continue }
      const current = node.get(key, true) as Node | undefined
      if (!current || !assign(doc, current, entry)) node.set(key, doc.createNode(entry))
    }
    return true
  }
  if (isSeq(node) && Array.isArray(value)) {
    value.forEach((entry, index) => {
      const current = node.items[index] as Node | undefined
      if (!current) node.items.push(doc.createNode(entry))
      else if (!assign(doc, current, entry)) node.items[index] = doc.createNode(entry)
    })
    node.items.splice(value.length)
    return true
  }
  return false
}

export function getYamlValue(text: string, path: string[]): unknown {
  if (!text.trim()) return undefined
  const value = load(text).getIn(path, false) as unknown
  if (value === undefined || value === null) return value === null ? null : undefined
  return typeof value === 'object' && 'toJSON' in (value as object) ? (value as { toJSON(): unknown }).toJSON() : value
}

/** Sets (or, with undefined, deletes) the value at `path`; parents are created as mappings. */
export function setYamlValue(text: string, path: string[], value: unknown): string {
  if (!path.length) throw new Error('A YAML edit needs a key path')
  const doc = load(text)
  if (value === undefined) {
    if (!doc.hasIn(path)) return text
    doc.deleteIn(path)
  } else {
    if (doc.contents === null) doc.contents = doc.createNode({}) as never
    const current = doc.getIn(path, true) as Node | undefined
    if (!current || !assign(doc, current, value)) doc.setIn(path, doc.createNode(value))
  }
  const out = doc.toString(OPTIONS)
  return out.trim() === '{}' ? '' : out
}
