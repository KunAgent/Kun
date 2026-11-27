import { afterEach, expect, it, vi } from 'vitest'
import {
  COLAB_RESOURCE_INTERVAL_MS, COLAB_RESOURCE_WINDOW_MS, type ColabSessionView
} from '../../shared/colab/colab-types'
import { ColabResourceMonitor, parseColabResources, resourcePatch } from './colab-session-telemetry'

const GiB = 2 ** 30
const at = Date.UTC(2026, 0, 1)
const full = {
  memory: { totalBytes: 29.5 * GiB, freeBytes: 20 * GiB },
  gpus: [{ gpuUtilization: 0, memoryUsedBytes: 0, memoryTotalBytes: 15.75 * GiB }],
  disks: [{ filesystem: { label: 'kernel', totalBytes: 100 * GiB, usedBytes: 37.5 * GiB } }]
}
const emptyView = (): ColabSessionView => ({ phase: 'running', gpuHistory: [] }) as unknown as ColabSessionView

afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

it('decodes VM-reported byte capacities, idle GPU/VRAM and fractional disk usage', () => {
  expect(parseColabResources(full, at)).toEqual({ at, gpuPct: 0, vramUsedGiB: 0,
    vramTotalGiB: 15.75, ramUsedGiB: 9.5, ramTotalGiB: 29.5, diskPct: 37.5 })
})

it('keeps missing or invalid metrics independent; no hardware defaults or fabricated samples', () => {
  expect(parseColabResources({ memory: { totalBytes: GiB, freeBytes: '' },
    disks: [{ filesystem: { totalBytes: 0, usedBytes: 0 } }],
    gpus: [{ gpuUtilization: 0.75, memoryUsedBytes: NaN, memoryTotalBytes: -1 }]
  }, at)).toEqual({ at, gpuPct: 75, vramTotalGiB: null, vramUsedGiB: null,
    ramUsedGiB: null, ramTotalGiB: 1, diskPct: null })
  expect(parseColabResources({ memory: { totalBytes: GiB, freeBytes: GiB }, gpus: [] }, at))
    .toMatchObject({ gpuPct: null, ramUsedGiB: 0 })
  expect(parseColabResources({ disks: [{ filesystem: { totalBytes: 50, usedBytes: 0 } }] }, at)?.diskPct).toBe(0)
  for (const data of [null, {}, { gpus: [{ gpuUtilization: 30 }] }, { memory: { totalBytes: 0 } }]) {
    expect(parseColabResources(data, at)).toBeNull()
  }
})

it('accepts a legacy view and bounds history by both time and count', () => {
  const view = emptyView()
  const sample = parseColabResources(full, at)!
  Object.assign(view, resourcePatch(view, sample))
  expect(view).toMatchObject({ ramGb: 29.5, vramGb: 15.75, gpuHistory: [0], resourceHistory: [sample] })
  for (let i = 1; i <= 120; i++) Object.assign(view, resourcePatch(view, { ...sample, at: at + i }))
  expect(view.resourceHistory).toHaveLength(COLAB_RESOURCE_WINDOW_MS / COLAB_RESOURCE_INTERVAL_MS + 1)
  Object.assign(view, resourcePatch(view, { ...sample, at: at + 120 + COLAB_RESOURCE_WINDOW_MS }))
  expect(view.resourceHistory?.map((p) => p.at)).toEqual([at + 120, at + 120 + COLAB_RESOURCE_WINDOW_MS])
})

it('skips overlapping ticks, aborts on stop, rejects a late result from before reconnect', async () => {
  vi.useFakeTimers()
  const view = emptyView()
  const patch = vi.fn((_id, data) => Object.assign(view, data))
  const monitor = new ColabResourceMonitor(() => view, patch)
  let deliver!: (response: Response) => void
  const pending = new Promise<Response>((resolve) => { deliver = resolve })
  const fetchMock = vi.fn<typeof fetch>().mockReturnValueOnce(pending)
    .mockImplementation(async () => new Response(")]}'\n" + JSON.stringify(full)))
  vi.stubGlobal('fetch', fetchMock)
  const access = async () => ({ baseUrl: 'https://example.test/backend/', proxyToken: 'fixture' })
  monitor.start('s', access)
  monitor.start('s', access)
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchMock).toHaveBeenCalledTimes(1)
  const [url, init] = fetchMock.mock.calls[0]
  expect(new URL(String(url)).pathname).toBe('/backend/api/colab/resources')
  expect(init?.redirect).toBe('error')
  monitor.stop('s')
  expect(init?.signal?.aborted).toBe(true)
  monitor.start('s', access)
  await vi.advanceTimersByTimeAsync(0)
  expect(patch).toHaveBeenCalledTimes(1)
  deliver(Response.json({ memory: { totalBytes: GiB } }))
  await vi.advanceTimersByTimeAsync(0)
  expect(view.ramGb).toBe(29.5)
  view.phase = 'disconnected'
  await vi.advanceTimersByTimeAsync(10_000)
  expect(fetchMock).toHaveBeenCalledTimes(2)
  expect(vi.getTimerCount()).toBe(0)
})

it('does not invent zero samples on HTTP/parse errors; expires old live history and retries', async () => {
  vi.useFakeTimers(); vi.setSystemTime(at)
  const view = emptyView()
  view.resourceHistory = [parseColabResources(full, at - COLAB_RESOURCE_WINDOW_MS - 1)!]
  const monitor = new ColabResourceMonitor(() => view, (_id, patch) => Object.assign(view, patch))
  vi.stubGlobal('fetch', vi.fn<typeof fetch>().mockResolvedValueOnce(new Response('busy', { status: 503 }))
    .mockResolvedValueOnce(new Response('not JSON')).mockResolvedValueOnce(Response.json(full)))
  monitor.start('s', async () => ({ baseUrl: 'https://example.test' }))
  await vi.advanceTimersByTimeAsync(5_000)
  expect(view.resourceHistory).toEqual([])
  await vi.advanceTimersByTimeAsync(5_000)
  expect(view.resourceHistory).toEqual([parseColabResources(full, at + 10_000)])
  monitor.stopAll()
})
