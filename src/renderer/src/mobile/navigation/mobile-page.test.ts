import { describe, expect, it } from 'vitest'
import { mobilePageUrl, readMobilePage, sameMobilePage } from './mobile-page'

const base = new URL('https://kun.example/?existing=value#anchor')

describe('mobile page URLs', () => {
  it('defaults unknown and missing routes to home', () => {
    expect(readMobilePage(base)).toEqual({ kind: 'home' })
    expect(readMobilePage(new URL('https://kun.example/?mobile=invalid'))).toEqual({ kind: 'home' })
  })

  it.each(['new', 'settings', 'home'] as const)('round trips %s', (kind) => {
    const url = new URL(mobilePageUrl(base, { kind }), base)
    expect(readMobilePage(url)).toEqual({ kind })
    expect(url.searchParams.get('existing')).toBe('value')
    expect(url.hash).toBe('#anchor')
  })

  it('encodes thread identifiers without treating them as URL syntax', () => {
    const page = { kind: 'conversation' as const, threadId: 'a/b?x=1&other=2' }
    const url = new URL(mobilePageUrl(base, page), base)
    expect(readMobilePage(url)).toEqual(page)
    expect(url.searchParams.has('other')).toBe(false)
  })

  it('clears a stale thread when returning home', () => {
    const url = new URL('https://kun.example/?mobile=conversation&thread=old')
    expect(new URL(mobilePageUrl(url, { kind: 'home' }), base).searchParams.has('thread')).toBe(false)
  })

  it('rejects a missing or oversized conversation identifier', () => {
    expect(readMobilePage(new URL('https://kun.example/?mobile=conversation'))).toEqual({ kind: 'home' })
    const url = new URL('https://kun.example/?mobile=conversation')
    url.searchParams.set('thread', 'x'.repeat(513))
    expect(readMobilePage(url)).toEqual({ kind: 'home' })
  })

  it('compares both page and conversation identity', () => {
    expect(sameMobilePage({ kind: 'home' }, { kind: 'home' })).toBe(true)
    expect(sameMobilePage({ kind: 'home' }, { kind: 'new' })).toBe(false)
    expect(sameMobilePage({ kind: 'conversation', threadId: 'a' }, { kind: 'conversation', threadId: 'b' })).toBe(false)
    expect(sameMobilePage({ kind: 'conversation', threadId: 'a' }, { kind: 'conversation', threadId: 'a' })).toBe(true)
  })
})
