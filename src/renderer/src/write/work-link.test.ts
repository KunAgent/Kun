import { describe, expect, it } from 'vitest'
import {
  resolveWikiLinkFilePath,
  resolveWorkLinkTarget,
  workHeadingSlug
} from './work-link'

const FILE = '/work/notes/a.md'
const ROOT = '/work'

describe('workHeadingSlug', () => {
  it('matches GitHub slug rules', () => {
    expect(workHeadingSlug('Hello World!')).toBe('hello-world')
    expect(workHeadingSlug('  多 语言 Test  ')).toBe('多-语言-test')
    expect(workHeadingSlug('a.b_c-d e')).toBe('ab_c-d-e')
  })
})

describe('resolveWorkLinkTarget', () => {
  it('classifies external links', () => {
    expect(resolveWorkLinkTarget('https://example.com', FILE, ROOT)).toEqual({
      kind: 'external',
      url: 'https://example.com'
    })
    expect(resolveWorkLinkTarget('mailto:a@b.c', FILE, ROOT).kind).toBe('external')
  })

  it('rejects file: URLs', () => {
    expect(resolveWorkLinkTarget('file:///etc/passwd', FILE, ROOT)).toEqual({
      kind: 'invalid',
      reason: 'file-url'
    })
  })

  it('resolves anchors', () => {
    expect(resolveWorkLinkTarget('#Some Heading!', FILE, ROOT)).toEqual({
      kind: 'anchor',
      slug: 'some-heading'
    })
  })

  it('resolves workspace-relative paths', () => {
    expect(resolveWorkLinkTarget('./b.md', FILE, ROOT)).toEqual({
      kind: 'workspace-file',
      path: '/work/notes/b.md',
      slug: undefined,
      line: undefined
    })
    expect(resolveWorkLinkTarget('../c.md#Intro', FILE, ROOT)).toEqual({
      kind: 'workspace-file',
      path: '/work/c.md',
      slug: 'intro',
      line: undefined
    })
    expect(resolveWorkLinkTarget('x.md#L12', FILE, ROOT)).toEqual({
      kind: 'workspace-file',
      path: '/work/notes/x.md',
      slug: undefined,
      line: 12
    })
  })

  it('rejects escapes outside the workspace', () => {
    expect(resolveWorkLinkTarget('../../etc/passwd', FILE, ROOT)).toEqual({
      kind: 'invalid',
      reason: 'outside-workspace'
    })
  })

  it('rejects workspace links without context', () => {
    expect(resolveWorkLinkTarget('b.md', null, ROOT).kind).toBe('invalid')
    expect(resolveWorkLinkTarget('b.md', FILE, null).kind).toBe('invalid')
  })
})

describe('resolveWikiLinkFilePath', () => {
  it('resolves bare note names to .md next to the file', () => {
    expect(resolveWikiLinkFilePath('note', FILE, ROOT)).toEqual({
      path: '/work/notes/note.md',
      bareName: true
    })
  })

  it('resolves explicit paths', () => {
    expect(resolveWikiLinkFilePath('dir/x.md', FILE, ROOT)).toEqual({
      path: '/work/notes/dir/x.md',
      bareName: false
    })
  })

  it('rejects escaping paths', () => {
    expect(resolveWikiLinkFilePath('../../out.md', FILE, ROOT)).toBeNull()
  })
})
