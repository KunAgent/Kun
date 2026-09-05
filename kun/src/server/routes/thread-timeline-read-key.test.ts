import { describe, expect, it } from 'vitest'
import {
  parseThreadTimelineQuery,
  threadTimelineReadKey
} from './thread-timeline-read-key.js'

function key(threadId: string, search: string): string {
  return threadTimelineReadKey(
    threadId,
    new URL(`http://kun.local/v1/threads/${threadId}/timeline${search}`)
  )
}

describe('threadTimelineReadKey', () => {
  it('normalizes an explicit default limit to match no query params', () => {
    expect(key('t1', '')).toBe(key('t1', '?limit=300'))
  })

  it('normalizes a blank limit to the default', () => {
    expect(key('t1', '?limit=%20')).toBe(key('t1', ''))
  })

  it('is insensitive to query parameter order', () => {
    expect(key('t1', '?limit=10&before=item_9')).toBe(key('t1', '?before=item_9&limit=10'))
  })

  it('differs across thread ids and query semantics', () => {
    expect(key('t1', '?before=item_9&limit=10')).not.toBe(key('t2', '?before=item_9&limit=10'))
    expect(key('t1', '?before=item_9&limit=10')).not.toBe(key('t1', '?before=item_8&limit=10'))
    expect(key('t1', '?before=item_9&limit=10')).not.toBe(key('t1', '?before=item_9&limit=11'))
  })

  it('falls back to the raw search string for invalid queries', () => {
    // Same raw string coalesces, different raw strings do not, and neither
    // collides with a valid query for the same thread.
    expect(key('t1', '?limit=abc')).toBe(key('t1', '?limit=abc'))
    expect(key('t1', '?limit=abc')).not.toBe(key('t1', '?limit=xyz'))
    expect(key('t1', '?limit=abc')).not.toBe(key('t1', '?limit=10'))
    expect(key('t1', '?limit=0')).toBe(key('t1', '?limit=0'))
    expect(key('t1', '?before=')).toBe(key('t1', '?before='))
    expect(key('t1', '?before=')).not.toBe(key('t1', '?before=item_9'))
  })
})

describe('parseThreadTimelineQuery', () => {
  it('applies the default limit when the parameter is absent or blank', () => {
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x')).success).toBe(true)
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?limit=%20'))).toMatchObject({
      success: true,
      data: { limit: 300 }
    })
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?limit=10'))).toMatchObject({
      success: true,
      data: { limit: 10 }
    })
  })

  it('rejects non-numeric, non-positive, and oversized limits', () => {
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?limit=abc')).success).toBe(false)
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?limit=0')).success).toBe(false)
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?limit=301')).success).toBe(false)
    expect(parseThreadTimelineQuery(new URL('http://kun.local/x?before=')).success).toBe(false)
  })
})
