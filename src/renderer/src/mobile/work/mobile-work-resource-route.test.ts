// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest'
import { readMobileWorkRoute, rememberMobileWorkRoute } from './mobile-work-resource-route'
import { workFileResourceKey, workWhiteboardResourceKey } from './work-resource-key'

afterEach(() => window.sessionStorage.clear())

describe('mobile Work opaque resource mapping', () => {
  it('reopens a nested A file after B became the phone preference', () => {
    const route = { key: workFileResourceKey('/A', '/A/sub/nested.md'), root: '/A',
      path: '/A/sub/nested.md', kind: 'document' as const }
    rememberMobileWorkRoute(route)
    expect(readMobileWorkRoute(route.key, ['/A', '/B'])).toEqual(route)
    expect(readMobileWorkRoute(route.key, ['/B'])).toBeNull()
  })
  it('validates opaque keys and remembers whiteboard ownership', () => {
    window.sessionStorage.setItem('kun.mobile.work.resource-routes', '{invalid json')
    rememberMobileWorkRoute({ key: 'fabricated', root: '/A', path: '/A/file.md', kind: 'document' })
    expect(readMobileWorkRoute('fabricated', ['/A'])).toBeNull()
    const board = { key: workWhiteboardResourceKey('board-1'), root: '/A', path: 'board-1', kind: 'whiteboard' as const }
    rememberMobileWorkRoute(board)
    expect(readMobileWorkRoute(board.key, ['/A'])).toEqual(board)
  })
})
