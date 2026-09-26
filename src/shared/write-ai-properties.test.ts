import { describe, expect, it } from 'vitest'
import { parse as parseYaml } from 'yaml'
import {
  buildWriteAiPropertiesMessages,
  mergeFrontmatterYamlAddition,
  normalizeAiPropertiesYaml
} from './write-ai-properties'

describe('normalizeAiPropertiesYaml', () => {
  it('strips code fences and keeps flat scalars and lists', () => {
    const out = normalizeAiPropertiesYaml(
      '```yaml\ntitle: Demo\ndescription: A test doc.\ntags: [a, b]\n```'
    )
    expect(out).not.toBeNull()
    const doc = parseYaml(out!) as Record<string, unknown>
    expect(doc.title).toBe('Demo')
    expect(doc.description).toBe('A test doc.')
    expect(doc.tags).toEqual(['a', 'b'])
  })

  it('drops nested maps and keeps only list scalars', () => {
    const out = normalizeAiPropertiesYaml(
      'title: Demo\nauthor:\n  name: a\n  id: 1\ntags: [x, {bad: true}, 2, null]'
    )
    const doc = parseYaml(out!) as Record<string, unknown>
    expect(doc.author).toBeUndefined()
    expect(doc.tags).toEqual(['x', 2])
  })

  it('returns null for non-mapping or invalid YAML', () => {
    expect(normalizeAiPropertiesYaml('- a\n- b')).toBeNull()
    expect(normalizeAiPropertiesYaml('just a sentence')).toBeNull()
    expect(normalizeAiPropertiesYaml('')).toBeNull()
    expect(normalizeAiPropertiesYaml('foo: [unclosed')).toBeNull()
  })

  it('caps the number of keys', () => {
    const raw = Array.from({ length: 20 }, (_, i) => `k${i}: v`).join('\n')
    const doc = parseYaml(normalizeAiPropertiesYaml(raw)!) as Record<string, unknown>
    expect(Object.keys(doc)).toHaveLength(8)
  })
})

describe('mergeFrontmatterYamlAddition', () => {
  it('returns the addition when the interior is empty', () => {
    expect(mergeFrontmatterYamlAddition('', 'title: Hi\ntags: [x]')).toBe('title: Hi\ntags:\n  - x')
  })

  it('appends only new keys and keeps existing content verbatim', () => {
    const interior = 'title: Old\n# a comment\nnested:\n  deep: 1'
    const out = mergeFrontmatterYamlAddition(interior, 'title: New\ndescription: D')
    expect(out).toBe('title: Old\n# a comment\nnested:\n  deep: 1\ndescription: D')
  })

  it('returns the interior unchanged when nothing is new', () => {
    expect(mergeFrontmatterYamlAddition('title: Old', 'title: New')).toBe('title: Old')
  })

  it('returns null when the existing interior is not a mapping', () => {
    expect(mergeFrontmatterYamlAddition('- just\n- a\n- list', 'title: X')).toBeNull()
    expect(mergeFrontmatterYamlAddition('bad: [unclosed', 'title: X')).toBeNull()
  })

  it('returns null when the addition is not a mapping', () => {
    expect(mergeFrontmatterYamlAddition('title: Old', '- a\n- b')).toBeNull()
  })
})

describe('buildWriteAiPropertiesMessages', () => {
  it('includes the document and warns about existing keys', () => {
    const messages = buildWriteAiPropertiesMessages({
      documentText: '# Hello\n\nBody.',
      existingYaml: 'title: Kept'
    })
    expect(messages[0].role).toBe('system')
    expect(messages[1].role).toBe('user')
    expect(messages[1].content).toContain('title: Kept')
    expect(messages[1].content).toContain('do not repeat')
    expect(messages[1].content).toContain('# Hello')
  })

  it('omits the existing-frontmatter section when empty', () => {
    const messages = buildWriteAiPropertiesMessages({ documentText: 'Body' })
    expect(messages[1].content).not.toContain('Existing frontmatter')
  })
})
