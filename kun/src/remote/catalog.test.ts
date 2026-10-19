import { describe, expect, it, vi } from 'vitest'
import { remoteFixture } from './testing/runtime.test-support.js'
import { CATALOG_SCAN_TTL_MS } from './catalog.js'

describe('remote catalog scans', () => {
  it('shares one project and model scan across catalog reads in a short window, then rescans', async () => {
    const f = await remoteFixture()
    try {
      await f.code()
      const pages = vi.spyOn(f.h.threads, 'listPage'), lists = vi.spyOn(f.h.threads, 'list')
      const [first, second] = await Promise.all([f.call('catalog.get', {}), f.call('catalog.get', {})])
      await f.call('catalog.get', {})
      expect(second.projects).toEqual(first.projects)
      expect(pages).toHaveBeenCalledTimes(1)
      expect(lists.mock.calls.filter(([options]) => (options as { limit?: number })?.limit === 1000)).toHaveLength(1)
      const now = Date.now()
      vi.spyOn(Date, 'now').mockReturnValue(now + CATALOG_SCAN_TTL_MS + 1)
      await f.call('catalog.get', {})
      expect(pages).toHaveBeenCalledTimes(2)
    } finally { vi.restoreAllMocks(); await f.close() }
  })
})
