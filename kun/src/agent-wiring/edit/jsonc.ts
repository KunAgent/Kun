/**
 * Byte-preserving JSONC editing for other agents' config files.
 *
 * Only the value at the edited path changes: comments, key order, spacing and
 * line endings elsewhere stay exactly as the user wrote them. The parser
 * accepts JSON with `//` and block comments and trailing commas (VS Code,
 * OpenCode and Claude Code all tolerate these).
 */
export type JsonPath = readonly string[]

type Node =
  | { kind: 'object'; start: number; end: number; props: Prop[] }
  | { kind: 'array'; start: number; end: number; items: Node[] }
  | { kind: 'scalar'; start: number; end: number; value: unknown }

type Prop = { key: string; keyStart: number; value: Node; /** offset just past the value or its trailing comma */ after: number; comma: number | null }

export class JsoncSyntaxError extends Error {
  constructor(message: string, readonly offset: number) {
    super(`${message} at offset ${offset}`)
    this.name = 'JsoncSyntaxError'
  }
}

class Parser {
  private pos = 0
  constructor(private readonly text: string) {}

  parseDocument(): Node {
    this.skip()
    const node = this.value()
    this.skip()
    if (this.pos !== this.text.length) throw new JsoncSyntaxError('Unexpected trailing content', this.pos)
    return node
  }

  private skip(): void {
    const text = this.text
    while (this.pos < text.length) {
      const char = text[this.pos]!
      if (char === ' ' || char === '\t' || char === '\n' || char === '\r' || char === '﻿') { this.pos += 1; continue }
      if (char === '/' && text[this.pos + 1] === '/') {
        const end = text.indexOf('\n', this.pos)
        this.pos = end < 0 ? text.length : end
        continue
      }
      if (char === '/' && text[this.pos + 1] === '*') {
        const end = text.indexOf('*/', this.pos + 2)
        if (end < 0) throw new JsoncSyntaxError('Unterminated comment', this.pos)
        this.pos = end + 2
        continue
      }
      return
    }
  }

  private value(): Node {
    const char = this.text[this.pos]
    if (char === '{') return this.object()
    if (char === '[') return this.array()
    if (char === '"') {
      const start = this.pos
      const value = this.string()
      return { kind: 'scalar', start, end: this.pos, value }
    }
    const match = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(this.text.slice(this.pos, this.pos + 64))
    if (!match) throw new JsoncSyntaxError('Unexpected token', this.pos)
    const start = this.pos
    this.pos += match[0].length
    return { kind: 'scalar', start, end: this.pos, value: JSON.parse(match[0]) }
  }

  private string(): string {
    const start = this.pos
    this.pos += 1
    while (this.pos < this.text.length) {
      const char = this.text[this.pos]
      if (char === '\\') { this.pos += 2; continue }
      if (char === '"') {
        this.pos += 1
        return JSON.parse(this.text.slice(start, this.pos)) as string
      }
      if (char === '\n') break
      this.pos += 1
    }
    throw new JsoncSyntaxError('Unterminated string', start)
  }

  private object(): Node {
    const start = this.pos
    this.pos += 1
    const props: Prop[] = []
    for (;;) {
      this.skip()
      if (this.text[this.pos] === '}') { this.pos += 1; return { kind: 'object', start, end: this.pos, props } }
      if (this.text[this.pos] !== '"') throw new JsoncSyntaxError('Expected property name', this.pos)
      const keyStart = this.pos
      const key = this.string()
      this.skip()
      if (this.text[this.pos] !== ':') throw new JsoncSyntaxError('Expected colon', this.pos)
      this.pos += 1
      this.skip()
      const value = this.value()
      const valueEnd = this.pos
      this.skip()
      let comma: number | null = null
      if (this.text[this.pos] === ',') { comma = this.pos; this.pos += 1 }
      else if (this.text[this.pos] !== '}') throw new JsoncSyntaxError('Expected comma or closing brace', this.pos)
      props.push({ key, keyStart, value, after: comma === null ? valueEnd : comma + 1, comma })
    }
  }

  private array(): Node {
    const start = this.pos
    this.pos += 1
    const items: Node[] = []
    for (;;) {
      this.skip()
      if (this.text[this.pos] === ']') { this.pos += 1; return { kind: 'array', start, end: this.pos, items } }
      items.push(this.value())
      this.skip()
      if (this.text[this.pos] === ',') { this.pos += 1; continue }
      if (this.text[this.pos] !== ']') throw new JsoncSyntaxError('Expected comma or closing bracket', this.pos)
    }
  }
}

function toValue(node: Node): unknown {
  if (node.kind === 'scalar') return node.value
  if (node.kind === 'array') return node.items.map(toValue)
  const out: Record<string, unknown> = {}
  for (const prop of node.props) out[prop.key] = toValue(prop.value)
  return out
}

export function parseJsonc(text: string): unknown {
  if (!text.trim()) return {}
  return toValue(new Parser(text).parseDocument())
}

export function getJsoncValue(text: string, path: JsonPath): unknown {
  let value: unknown = parseJsonc(text)
  for (const key of path) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
    value = (value as Record<string, unknown>)[key]
  }
  return value
}

function detectIndent(text: string): string {
  const match = /\n([ \t]+)"/.exec(text)
  return match?.[1] ?? '  '
}

function lineIndentAt(text: string, offset: number): string {
  const lineStart = text.lastIndexOf('\n', offset - 1) + 1
  return /^[ \t]*/.exec(text.slice(lineStart))![0]
}

function serialize(value: unknown, indentUnit: string, baseIndent: string, eol: string): string {
  const json = JSON.stringify(value, null, indentUnit)
  return json.split('\n').map((line, index) => index === 0 ? line : baseIndent + line).join(eol)
}

/**
 * Set (`value !== undefined`) or delete (`value === undefined`) the value at
 * `path`, creating intermediate objects as needed. Returns the new text.
 */
export function setJsoncValue(text: string, path: JsonPath, value: unknown): string {
  if (!path.length) throw new Error('A JSON edit needs a path')
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const unit = detectIndent(text)
  if (!text.trim()) {
    if (value === undefined) return text
    let nested: unknown = value
    for (let index = path.length - 1; index >= 0; index -= 1) nested = { [path[index]!]: nested }
    return serialize(nested, unit, '', eol) + eol
  }
  const root = new Parser(text).parseDocument()
  if (root.kind !== 'object') throw new Error('The config file is not a JSON object')
  let node: Node = root
  for (let depth = 0; depth < path.length; depth += 1) {
    if (node.kind !== 'object') throw new Error(`Cannot edit ${path.join('.')}: ${path.slice(0, depth).join('.')} is not an object`)
    const key = path[depth]!
    const prop: Prop | undefined = [...node.props].reverse().find((entry) => entry.key === key)
    const last = depth === path.length - 1
    if (prop && last) {
      if (value === undefined) return removeProp(text, node, prop)
      const indent = lineIndentAt(text, prop.keyStart)
      return text.slice(0, prop.value.start) + serialize(value, unit, indent, eol) + text.slice(prop.value.end)
    }
    if (prop) { node = prop.value; continue }
    if (value === undefined) return text
    let nested: unknown = value
    for (let index = path.length - 1; index > depth; index -= 1) nested = { [path[index]!]: nested }
    return insertProp(text, node, key, nested, unit, eol)
  }
  return text
}

function insertProp(text: string, object: Extract<Node, { kind: 'object' }>, key: string, value: unknown, unit: string, eol: string): string {
  const closeIndent = lineIndentAt(text, object.end - 1)
  const propIndent = object.props.length ? lineIndentAt(text, object.props[0]!.keyStart) : closeIndent + unit
  const entry = `${JSON.stringify(key)}: ${serialize(value, unit, propIndent, eol)}`
  if (!object.props.length) {
    return text.slice(0, object.start + 1) + eol + propIndent + entry + eol + closeIndent + text.slice(object.end - 1)
  }
  const last = object.props.at(-1)!
  if (last.comma !== null) {
    // Trailing comma already present: insert after it on a new line.
    return text.slice(0, last.after) + eol + propIndent + entry + text.slice(last.after)
  }
  // Keep a same-line comment after the previous value on its line.
  const lineEnd = text.indexOf('\n', last.value.end)
  const tail = text.slice(last.value.end, lineEnd < 0 ? text.length : lineEnd).replace(/\r$/, '')
  const commentOnly = /^\s*(?:\/\*.*?\*\/\s*)*(?:\/\/.*)?$/.test(tail) && tail.trim() !== ''
  if (commentOnly) {
    const insertAt = last.value.end + tail.length
    return text.slice(0, last.value.end) + ',' + text.slice(last.value.end, insertAt) + eol + propIndent + entry + text.slice(insertAt)
  }
  return text.slice(0, last.value.end) + ',' + eol + propIndent + entry + text.slice(last.value.end)
}

function removeProp(text: string, object: Extract<Node, { kind: 'object' }>, prop: Prop): string {
  const index = object.props.indexOf(prop)
  const lineStart = text.lastIndexOf('\n', prop.keyStart - 1) + 1
  const ownLine = /^[ \t]*$/.test(text.slice(lineStart, prop.keyStart))
  const start = ownLine ? lineStart : prop.keyStart
  let end = prop.after
  if (ownLine) {
    const rest = /^[ \t]*(?:\/\/[^\n]*)?\r?\n/.exec(text.slice(end))
    if (rest) end += rest[0].length
  }
  let out = text.slice(0, start) + text.slice(end)
  if (index === object.props.length - 1 && index > 0 && prop.comma === null) {
    // Removing the last property: drop the comma that now trails the previous one.
    const previous = object.props[index - 1]!
    if (previous.comma !== null && previous.comma < start) out = out.slice(0, previous.comma) + out.slice(previous.comma + 1)
  }
  return out
}
