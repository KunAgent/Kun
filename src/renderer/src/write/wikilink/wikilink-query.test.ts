import { describe, expect, it } from 'vitest'
import { findWikilinkQuery } from './wikilink-query'

function at(text: string): { text: string; cursor: number } {
  const cursor = text.indexOf('|')
  return { text: text.slice(0, cursor) + text.slice(cursor + 1), cursor }
}

function query(marked: string): ReturnType<typeof findWikilinkQuery> {
  const { text, cursor } = at(marked)
  return findWikilinkQuery(text, cursor)
}

describe('findWikilinkQuery', () => {
  it('finds an empty query right after the brackets', () => {
    const found = query('see [[|')
    expect(found?.query).toBe('')
    expect(found?.closed).toBe(false)
  })

  it('captures the partial name typed so far', () => {
    const found = query('see [[wel|')
    expect(found?.query).toBe('wel')
    expect(found?.from).toBe(6)
    expect(found?.to).toBe(9)
  })

  it('reports an already-closed reference so accepting does not double the brackets', () => {
    const found = query('see [[wel|]] rest')
    expect(found?.query).toBe('wel')
    expect(found?.closed).toBe(true)
  })

  it('captures a path query with slashes and spaces', () => {
    expect(query('[[notes/my file|')?.query).toBe('notes/my file')
  })

  it('returns nothing with no brackets before the caret', () => {
    expect(query('plain text|')).toBeNull()
  })

  it('returns nothing when the caret is before the brackets close', () => {
    expect(query('[|[')).toBeNull()
  })

  it('does not reopen a completed reference the caret moved back into', () => {
    // The caret sits after `]]`, so the reference is finished.
    expect(query('[[done]]|')).toBeNull()
  })

  it('does not treat a bracket on an earlier line as open', () => {
    expect(query('[[open\nnext line|')).toBeNull()
  })

  it('stops at a nested opening bracket', () => {
    expect(query('[[one[[two|')?.query).toBe('two')
  })

  it('ignores an absurdly long query', () => {
    expect(query(`[[${'x'.repeat(400)}|`)).toBeNull()
  })

  it('handles a caret at the very start of the document', () => {
    expect(findWikilinkQuery('', 0)).toBeNull()
    expect(findWikilinkQuery('[[', 0)).toBeNull()
  })

  it('ignores a cursor past the end of the text', () => {
    expect(findWikilinkQuery('[[a', 99)).toBeNull()
  })
})
