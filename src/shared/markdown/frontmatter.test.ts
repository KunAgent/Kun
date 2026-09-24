import { describe, expect, it } from 'vitest'
import {
  convertPropertyKind,
  createEmptyProperty,
  frontmatterInterior,
  joinFrontmatter,
  parseFrontmatterProperties,
  patchFrontmatterInterior,
  serializeFrontmatterProperties,
  splitFrontmatter,
  wrapFrontmatter
} from './frontmatter'

describe('splitFrontmatter', () => {
  it('returns body only when no frontmatter', () => {
    expect(splitFrontmatter('hello\n')).toEqual({ frontmatter: '', body: 'hello\n' })
  })

  it('splits a leading block verbatim', () => {
    const md = '---\ntitle: x\n---\n\nbody\n'
    const { frontmatter, body } = splitFrontmatter(md)
    expect(frontmatter).toBe('---\ntitle: x\n---\n')
    expect(body).toBe('\nbody\n')
    expect(joinFrontmatter(frontmatter, body)).toBe(md)
  })

  it('handles CRLF', () => {
    const md = '---\r\na: 1\r\n---\r\nbody\r\n'
    const { frontmatter, body } = splitFrontmatter(md)
    expect(joinFrontmatter(frontmatter, body)).toBe(md)
  })

  it('a `---` mid-document is not frontmatter', () => {
    const md = 'text\n\n---\na: 1\n---\n'
    expect(splitFrontmatter(md).frontmatter).toBe('')
  })

  it('unclosed fence is not frontmatter', () => {
    expect(splitFrontmatter('---\nkey: v\n').frontmatter).toBe('')
  })
})

describe('frontmatterInterior / wrapFrontmatter', () => {
  it('strips fences', () => {
    expect(frontmatterInterior('---\na: 1\n---\n')).toBe('a: 1')
  })

  it('wrap produces a fenced block with trailing newline', () => {
    expect(wrapFrontmatter('a: 1')).toBe('---\na: 1\n---\n')
    expect(wrapFrontmatter('   \n  ')).toBe('')
  })
})

describe('parseFrontmatterProperties', () => {
  it('parses scalars, block lists, inline lists, checkboxes, dates', () => {
    const result = parseFrontmatterProperties([
      'title: Hello World',
      'done: true',
      'due: 2024-01-15',
      'tags:',
      '  - alpha',
      '  - beta',
      'aliases: [x, "y z"]',
      'empty:',
      'quoted: "has # hash"'
    ].join('\n'))
    expect(result.ok).toBe(true)
    if (!result.ok) return
    const byKey = Object.fromEntries(result.properties.map((p) => [p.key, p]))
    expect(byKey.title).toMatchObject({ kind: 'scalar', value: 'Hello World' })
    expect(byKey.done).toMatchObject({ kind: 'checkbox', value: 'true' })
    expect(byKey.due).toMatchObject({ kind: 'date', value: '2024-01-15' })
    expect(byKey.tags.items).toEqual(['alpha', 'beta'])
    expect(byKey.aliases.items).toEqual(['x', 'y z'])
    expect(byKey.empty).toMatchObject({ kind: 'scalar', value: '' })
    expect(byKey.quoted.value).toBe('has # hash')
  })

  it('rejects nested maps', () => {
    expect(parseFrontmatterProperties('a:\n  b: 1').ok).toBe(false)
  })

  it('rejects multiline scalars', () => {
    expect(parseFrontmatterProperties('a: |\n  line').ok).toBe(false)
    expect(parseFrontmatterProperties('a: >\n  line').ok).toBe(false)
  })

  it('rejects flow maps', () => {
    expect(parseFrontmatterProperties('a: {b: 1}').ok).toBe(false)
  })

  it('known keys default to list kind when empty', () => {
    const result = parseFrontmatterProperties('tags:')
    expect(result.ok && result.properties[0].kind === 'list').toBe(true)
  })

  it('round-trips through serialize', () => {
    const interior = 'title: Hi\ntags:\n  - a\n  - b\ndone: false\ndue: 2024-02-29\n'
    const parsed = parseFrontmatterProperties(interior)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const serialized = serializeFrontmatterProperties(parsed.properties)
    const reparsed = parseFrontmatterProperties(serialized)
    expect(reparsed).toEqual(parsed)
  })
})

describe('patchFrontmatterInterior', () => {
  const props = (interior: string) => {
    const parsed = parseFrontmatterProperties(interior)
    if (!parsed.ok) throw new Error('unparseable interior in test')
    return parsed.properties
  }

  it('edits one property without rewriting comments or quote styles', () => {
    const interior = '# top comment\ntitle: "Keep Me"\ntags: [a, b] # inline\ndone: false\n'
    const previous = props(interior)
    const next = previous.map((p) =>
      p.key === 'done' ? { ...p, value: 'true' } : p
    )
    const out = patchFrontmatterInterior(interior, previous, next)
    expect(out).toContain('# top comment')
    expect(out).toContain('title: "Keep Me"')
    expect(out).toContain('tags: [a, b] # inline')
    expect(out).toMatch(/done: true/)
  })

  it('renames a key in place and removes a row', () => {
    const interior = 'a: 1\nb: 2\nc: 3\n'
    const previous = props(interior)
    const next = [
      { ...previous[0], key: 'renamed' },
      previous[2]
    ]
    const out = patchFrontmatterInterior(interior, previous, next)
    const reparsed = parseFrontmatterProperties(out)
    expect(reparsed.ok).toBe(true)
    if (!reparsed.ok) return
    expect(reparsed.properties.map((p) => p.key)).toEqual(['renamed', 'c'])
    expect(reparsed.properties[0].value).toBe('1')
  })

  it('appends a new property at the end', () => {
    const interior = 'a: 1\n'
    const previous = props(interior)
    const next = [...previous, { key: 'added', kind: 'scalar' as const, value: 'v', items: [] }]
    const out = patchFrontmatterInterior(interior, previous, next)
    expect(out).toContain('a: 1')
    expect(out).toContain('added: v')
  })

  it('inserts a property before an existing key', () => {
    const interior = 'a: 1\nc: 3\n'
    const previous = props(interior)
    const next = [previous[0], { key: 'b', kind: 'scalar' as const, value: '2', items: [] }, previous[1]]
    expect(patchFrontmatterInterior(interior, previous, next)).toBe('a: 1\nb: 2\nc: 3\n')
  })

  it('dropping a property keeps neighboring comments verbatim', () => {
    const interior = '# about b\na: 1\nb: 2\n# about c\nc: 3\n'
    const previous = props(interior)
    const next = [previous[0], previous[2]]
    expect(patchFrontmatterInterior(interior, previous, next)).toBe('# about b\na: 1\n# about c\nc: 3\n')
  })

  it('falls back to full serialization when pairs disagree', () => {
    const interior = 'a: 1\nb: 2\n'
    const stale = [{ key: 'zzz', kind: 'scalar' as const, value: 'x', items: [] }]
    const out = patchFrontmatterInterior(interior, stale, stale)
    expect(out).toContain('zzz')
    expect(out).not.toContain('a: 1')
  })
})

describe('convertPropertyKind', () => {
  it('scalar → list joins value as one item', () => {
    const p = { key: 'tags', kind: 'scalar' as const, value: 'a,b', items: [] }
    expect(convertPropertyKind(p, 'list').items).toEqual(['a,b'])
  })

  it('list → scalar joins items', () => {
    const p = { key: 'tags', kind: 'list' as const, value: '', items: ['a', 'b'] }
    expect(convertPropertyKind(p, 'scalar').value).toBe('a, b')
  })

  it('checkbox normalization', () => {
    const p = { key: 'x', kind: 'scalar' as const, value: 'yes', items: [] }
    expect(convertPropertyKind(p, 'checkbox').value).toBe('true')
  })

  it('createEmptyProperty uses list for known keys', () => {
    expect(createEmptyProperty('tags').kind).toBe('list')
    expect(createEmptyProperty('foo').kind).toBe('scalar')
  })
})
