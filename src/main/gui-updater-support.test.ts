import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const files = new Map<string, string>()
vi.mock('electron', () => ({ app: { getPath: () => '/tmp/updater', getVersion: () => '0.3.0', getAppPath: () => '/tmp/app' } }))
vi.mock('electron-updater', () => ({ default: { autoUpdater: {} } }))
vi.mock('node:fs/promises', () => ({
  mkdir: vi.fn(),
  readFile: vi.fn(async (path: string) => {
    const value = files.get(String(path))
    if (value === undefined) throw new Error('not found')
    return value
  }),
  writeFile: vi.fn(async (path: string, value: string) => files.set(String(path), String(value))),
  rename: vi.fn(async (from: string, to: string) => {
    const value = files.get(String(from))
    if (value === undefined) throw new Error('missing temporary cache')
    files.delete(String(from)); files.set(String(to), value)
  }),
  rm: vi.fn(async (path: string) => files.delete(String(path)))
}))

const originalEnv = { ...process.env }
beforeEach(() => {
  files.clear()
  process.env = { ...originalEnv }
  delete process.env.KUN_UPDATE_URL
  delete process.env.R2_PUBLIC_BASE_URL
  vi.restoreAllMocks()
})
afterEach(() => {
  process.env = { ...originalEnv }
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('updater version correctness', () => {
  it('uses SemVer precedence including prereleases', async () => {
    const { isVersionGreater } = await import('./gui-updater-support')
    expect(isVersionGreater('1.0.0', '1.0.0-beta.9')).toBe(true)
    expect(isVersionGreater('1.0.0-beta.10', '1.0.0-beta.2')).toBe(true)
    expect(isVersionGreater('0.0.0-dev-20260825-1201', '0.0.0-dev-20260825-1200')).toBe(true)
    expect(isVersionGreater('1.0.0-beta.1', '1.0.0')).toBe(false)
  })

  it('throws explicit errors for invalid versions', async () => {
    const { isVersionGreater } = await import('./gui-updater-support')
    expect(() => isVersionGreater('release-next', '1.0.0')).toThrow('Invalid update version')
    expect(() => isVersionGreater('1.0.0', 'not-semver')).toThrow('Invalid current version')
  })
})

describe('update feed resolution', () => {
  it('probes candidates concurrently and selects the first successful source', async () => {
    const pending: Array<(value: Response) => void> = []
    const fetchMock = vi.fn(() => new Promise<Response>((resolve) => pending.push(resolve)))
    vi.stubGlobal('fetch', fetchMock)
    const { resolveUpdateFeedUrl } = await import('./gui-updater-support')
    const resolving = resolveUpdateFeedUrl('stable')
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3))
    // 完成顺序决定胜出者：kun-agent 源最先成功。
    pending[1](new Response(null, { status: 200 }))
    pending[2](new Response(null, { status: 200 }))
    pending[0](new Response(null, { status: 404 }))
    await expect(resolving).resolves.toEqual({
      ok: true,
      url: 'https://kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/'
    })
  })

  it('returns the first success immediately without waiting for slow sources', async () => {
    vi.useFakeTimers()
    const aborts: AbortSignal[] = []
    const fast: Array<(value: Response) => void> = []
    const fetchMock = vi.fn((_url: string, init: RequestInit) => {
      aborts.push(init.signal!)
      const url = String(_url)
      return url.includes('www.kun-agent.com')
        ? new Promise<Response>((resolve) => fast.push(resolve))
        : new Promise<Response>(() => undefined)
    })
    vi.stubGlobal('fetch', fetchMock)
    const { resolveUpdateFeedUrl, UPDATE_FEED_PROBE_TIMEOUT_MS } = await import('./gui-updater-support')
    const resolving = resolveUpdateFeedUrl('stable')
    await vi.advanceTimersByTimeAsync(0)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    fast[0](new Response(null, { status: 200 }))
    await vi.advanceTimersByTimeAsync(100)
    await expect(resolving).resolves.toEqual({
      ok: true,
      url: 'https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/'
    })
    // 未推进到全局 deadline 前就已返回，且剩余请求已被 abort。
    vi.advanceTimersByTime(UPDATE_FEED_PROBE_TIMEOUT_MS)
    expect(aborts.slice(1).every((signal) => signal.aborted)).toBe(true)
  })

  it('returns an explicit failure when every source fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 404 })))
    const { resolveUpdateFeedUrl } = await import('./gui-updater-support')
    await expect(resolveUpdateFeedUrl('stable')).resolves.toMatchObject({ ok: false, code: 'update_feed_unavailable' })
  })

  it('enforces one total deadline', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(() => undefined)))
    const { resolveUpdateFeedUrl, UPDATE_FEED_PROBE_TIMEOUT_MS } = await import('./gui-updater-support')
    const resolving = resolveUpdateFeedUrl('frontier')
    await vi.advanceTimersByTimeAsync(UPDATE_FEED_PROBE_TIMEOUT_MS)
    await expect(resolving).resolves.toMatchObject({ ok: false, message: expect.stringContaining('deadline') })
  })

  it('uses bounded GET fallback only for rejected HEAD', async () => {
    process.env.KUN_UPDATE_URL = 'https://updates.test/{channel}/'
    const cancel = vi.fn()
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: false, status: 405 })
      .mockResolvedValueOnce({ ok: true, status: 206, body: { cancel } })
    vi.stubGlobal('fetch', fetchMock)
    const { resolveUpdateFeedUrl } = await import('./gui-updater-support')
    await expect(resolveUpdateFeedUrl('stable')).resolves.toEqual({ ok: true, url: 'https://updates.test/stable/' })
    expect(fetchMock).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      method: 'GET', headers: expect.objectContaining({ Range: 'bytes=0-0' })
    }))
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('configures manual manifest fetch with a ten-second timeout signal', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response('version: 1.0.0'))
    vi.stubGlobal('fetch', fetchMock)
    const { fetchUpdateFeedManifest, MANUAL_UPDATE_FETCH_TIMEOUT_MS } = await import('./gui-updater-support')

    await fetchUpdateFeedManifest('https://updates.test/stable/', '0.3.0')

    expect(MANUAL_UPDATE_FETCH_TIMEOUT_MS).toBe(10_000)
    expect(fetchMock).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ signal: expect.any(AbortSignal) }))
  })

  it('atomically preserves independent per-channel successes', async () => {
    const fetchMock = vi.fn(async (url: string) => new Response(null, { status: url.includes('/stable/') ? 200 : 404 }))
    vi.stubGlobal('fetch', fetchMock)
    const { resolveUpdateFeedUrl, updateFeedCachePath } = await import('./gui-updater-support')
    await resolveUpdateFeedUrl('stable')
    fetchMock.mockImplementation(async (url: string) => new Response(null, { status: url.includes('/frontier/') ? 200 : 404 }))
    await resolveUpdateFeedUrl('frontier')
    expect(JSON.parse(files.get(updateFeedCachePath()) ?? '{}')).toEqual({
      stable: expect.objectContaining({ url: 'https://www.kun-agent.com/api/r2/deepseek-gui/channels/stable/latest/' }),
      frontier: expect.objectContaining({ url: 'https://www.kun-agent.com/api/r2/deepseek-gui/channels/frontier/latest/' })
    })
  })
})
