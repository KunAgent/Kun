import { describe, expect, it } from 'vitest'
import { mobilePageUrl, readMobilePage, sameMobilePage, type MobilePage } from './mobile-page'

const base = new URL('https://kun.example/?existing=value#anchor')

function roundTrip(page: MobilePage): URL {
  const url = new URL(mobilePageUrl(base, page), base)
  expect(readMobilePage(url)).toEqual(page)
  expect(url.searchParams.get('existing')).toBeNull()
  expect(url.hash).toBe('')
  return url
}

describe('mobile page URLs', () => {
  it('drops unknown query parameters and fragments from browser history', () => {
    const sensitive = new URL('https://kun.example/remote?token=secret&invite=code#credential')
    const next = new URL(mobilePageUrl(sensitive, { mode: 'rooms', kind: 'home' }), sensitive)
    expect(next.pathname).toBe('/remote')
    expect(next.searchParams.get('token')).toBeNull()
    expect(next.searchParams.get('invite')).toBeNull()
    expect(next.hash).toBe('')
  })
  it('defaults unknown and missing routes to the selected mode home', () => {
    expect(readMobilePage(base)).toEqual({ mode: 'code', kind: 'home' })
    expect(readMobilePage(new URL('https://kun.example/?mode=rooms&mobile=invalid')))
      .toEqual({ mode: 'rooms', kind: 'home' })
  })

  it.each(['code', 'rooms', 'work'] as const)('round trips %s home and settings', (mode) => {
    roundTrip({ mode, kind: 'home' })
    roundTrip({ mode, kind: 'settings' })
  })

  it('round trips Code and Rooms new pages', () => {
    roundTrip({ mode: 'code', kind: 'new' })
    roundTrip({ mode: 'rooms', kind: 'new' })
    const url = roundTrip({ mode: 'code', kind: 'conversation', threadId: 'a/b?x=1&other=2' })
    expect(url.searchParams.has('other')).toBe(false)
  })

  it.each([
    { mode: 'rooms', kind: 'room', roomId: 'room' },
    { mode: 'rooms', kind: 'reply', roomId: 'room', messageId: 'message' },
    { mode: 'rooms', kind: 'run', roomId: 'room', runId: 'run' },
    { mode: 'rooms', kind: 'task', roomId: 'room', taskId: 'task' },
    { mode: 'rooms', kind: 'member', roomId: 'room', memberId: 'member' }
  ] as MobilePage[])('round trips Rooms page $kind', (page) => { roundTrip(page) })

  it.each(['read', 'edit', 'assistant', 'review', 'whiteboard'] as const)(
    'round trips Work resource view %s',
    (view) => { roundTrip({ mode: 'work', kind: 'resource', resourceKey: 'opaque-key', view }) }
  )

  it('clears identifiers owned by the previous mode', () => {
    const url = new URL('https://kun.example/?mode=rooms&mobile=reply&room=r&message=m&thread=old')
    const next = new URL(mobilePageUrl(url, { mode: 'work', kind: 'home' }), base)
    expect(next.searchParams.has('room')).toBe(false)
    expect(next.searchParams.has('message')).toBe(false)
    expect(next.searchParams.has('thread')).toBe(false)
  })

  it('rejects missing, oversized, wrong-mode and unsupported identifiers', () => {
    expect(readMobilePage(new URL('https://kun.example/?mode=rooms&mobile=reply&room=r')))
      .toEqual({ mode: 'rooms', kind: 'home' })
    const url = new URL('https://kun.example/?mode=work&mobile=resource&view=edit')
    url.searchParams.set('resource', 'x'.repeat(513))
    expect(readMobilePage(url)).toEqual({ mode: 'work', kind: 'home' })
    expect(readMobilePage(new URL('https://kun.example/?mode=code&mobile=room&room=r')))
      .toEqual({ mode: 'code', kind: 'home' })
    expect(readMobilePage(new URL('https://kun.example/?mode=work&mobile=resource&resource=r&view=unknown')))
      .toEqual({ mode: 'work', kind: 'home' })
  })

  it('compares complete page identity including mode and nested ids', () => {
    expect(sameMobilePage({ mode: 'code', kind: 'home' }, { mode: 'code', kind: 'home' })).toBe(true)
    expect(sameMobilePage({ mode: 'code', kind: 'home' }, { mode: 'rooms', kind: 'home' })).toBe(false)
    expect(sameMobilePage(
      { mode: 'rooms', kind: 'reply', roomId: 'a', messageId: '1' },
      { mode: 'rooms', kind: 'reply', roomId: 'a', messageId: '2' }
    )).toBe(false)
  })
})
