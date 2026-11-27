import { createElement } from 'react'
import { act, create, type ReactTestInstance } from 'react-test-renderer'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ColabAccelerator, ColabResourceSample } from '@shared/colab/colab-types'
import i18n from '../../i18n'
import { ResourceDetails, type ResourceDetailsSession } from './ResourceDetails'

const NOW = Date.UTC(2026, 10, 27, 3, 32, 0)
const INTERVAL_MS = 5000
const WINDOW_MS = 300_000

let renderer: ReturnType<typeof create> | undefined

function collectText(
  node: ReactTestInstance | string | number | null | undefined
): string {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  return node.children.map((child) => collectText(child)).join(' ')
}

function sample(
  offsetMs: number,
  patch: Partial<ColabResourceSample> = {}
): ColabResourceSample {
  return {
    at: NOW + offsetMs,
    gpuPct: null,
    vramUsedGiB: null,
    vramTotalGiB: null,
    ramUsedGiB: null,
    ramTotalGiB: null,
    diskPct: null,
    ...patch
  }
}

function session(
  overrides: Partial<ResourceDetailsSession> = {}
): ResourceDetailsSession {
  return {
    id: 'session-a',
    accelerator: 'G4' as ColabAccelerator,
    vramGb: 16,
    ramGb: 32,
    diskUsedPct: 18,
    resourceHistory: [],
    ...overrides
  }
}

async function mount(target: ResourceDetailsSession): Promise<ReturnType<typeof create>> {
  let next: ReturnType<typeof create> | undefined
  await act(async () => {
    next = create(
      createElement(ResourceDetails, {
        session: target,
        intervalMs: INTERVAL_MS,
        windowMs: WINDOW_MS,
        nowMs: NOW
      })
    )
  })
  renderer = next
  return next!
}

async function update(target: ResourceDetailsSession): Promise<void> {
  await act(async () => {
    renderer?.update(
      createElement(ResourceDetails, {
        session: target,
        intervalMs: INTERVAL_MS,
        windowMs: WINDOW_MS,
        nowMs: NOW
      })
    )
  })
}

beforeAll(async () => {
  await i18n.changeLanguage('en')
})

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
})

afterEach(async () => {
  if (renderer) {
    await act(async () => renderer?.unmount())
    renderer = undefined
  }
  vi.unstubAllGlobals()
})

describe('resource details charts', () => {
  it('renders live GPU stats and GiB memory legends from actual samples', async () => {
    const details = await mount(
      session({
        resourceHistory: [
          sample(-20_000, {
            gpuPct: 20,
            vramUsedGiB: 4,
            vramTotalGiB: 16,
            ramUsedGiB: 8,
            ramTotalGiB: 32
          }),
          sample(-10_000, {
            gpuPct: 80,
            vramUsedGiB: 14,
            vramTotalGiB: 16,
            ramUsedGiB: 28,
            ramTotalGiB: 32
          }),
          sample(0, {
            gpuPct: 40,
            vramUsedGiB: 12,
            vramTotalGiB: 16,
            ramUsedGiB: 24,
            ramTotalGiB: 32
          })
        ]
      })
    )
    const root = details.root

    expect(root.findByProps({ 'data-resource-session-id': 'session-a' })).toBeDefined()
    expect(root.findByProps({ 'data-resource-status': 'live' })).toBeDefined()
    expect(collectText(root.findByProps({ 'data-resource-gpu-value': true }))).toContain('40')
    expect(collectText(root.findByProps({ 'data-resource-gpu-avg': true }))).toContain('47%')
    expect(collectText(root.findByProps({ 'data-resource-gpu-peak': true }))).toContain('80%')
    expect(collectText(root.findByProps({ 'data-resource-gpu-points': true }))).toContain(
      '3 samples · 5 min window'
    )
    expect(collectText(root.findByProps({ 'data-resource-legend-vram': true }))).toContain(
      '12 / 16 GiB'
    )
    expect(collectText(root.findByProps({ 'data-resource-legend-ram': true }))).toContain(
      '24 / 32 GiB'
    )
    expect(collectText(root.findByProps({ 'data-resource-disk': true }))).toContain('18%')
    expect(collectText(root)).toContain('Sample interval 5s · last 5 min')
    expect(root.findByProps({ 'data-resource-threshold': 90 })).toBeDefined()
    expect(collectText(root.findByProps({ 'data-resource-threshold': 90 }))).toContain(
      '90% alert'
    )
    const gpuChart = root.findByProps({ 'data-resource-chart': 'gpu' })
    expect(collectText(gpuChart.findByProps({ 'data-resource-x-tick': 0 }))).toContain('Now')
    expect(collectText(gpuChart.findByProps({ 'data-resource-x-tick': -300_000 }))).toContain(
      '-5m'
    )

    const memorySvg = root.findByProps({ 'data-resource-svg': 'memory' })
    await act(async () => memorySvg.props.onFocus())
    const memoryTooltip = collectText(root.findByProps({ 'data-resource-tooltip': 'memory' }))
    expect(memoryTooltip).toContain('12 / 16 GiB')
    expect(memoryTooltip).toContain('75%')
  })

  it('keeps the memory axis at 100% so high usage is not compressed into a 40% cap', async () => {
    const details = await mount(
      session({
        resourceHistory: [
          sample(-10_000, {
            gpuPct: 10,
            vramUsedGiB: 4,
            vramTotalGiB: 16,
            ramUsedGiB: 8,
            ramTotalGiB: 32
          }),
          sample(0, {
            gpuPct: 20,
            vramUsedGiB: 12,
            vramTotalGiB: 16,
            ramUsedGiB: 24,
            ramTotalGiB: 32
          })
        ]
      })
    )
    const memory = details.root.findByProps({ 'data-resource-chart': 'memory' })

    expect(memory.findByProps({ 'data-resource-y-tick': 100 })).toBeDefined()
    expect(memory.findAllByProps({ 'data-resource-y-tick': 40 })).toHaveLength(0)
    const vramMarker = memory.findByProps({ 'data-resource-series-last': 'vram' })
    const ramMarker = memory.findByProps({ 'data-resource-series-last': 'ram' })
    // 75% of capacity must sit between the top and the midway line, not clamp to the top.
    expect(Number(vramMarker.props.cy)).toBeGreaterThan(20)
    expect(Number(vramMarker.props.cy)).toBeLessThan(48)
    expect(Number(ramMarker.props.cy)).toBeGreaterThan(20)
    expect(Number(ramMarker.props.cy)).toBeLessThan(48)
  })

  it('breaks GPU lines at missing scrapes and keeps zero in the average', async () => {
    const details = await mount(
      session({
        resourceHistory: [
          sample(-30_000, { gpuPct: 10 }),
          sample(-25_000, { gpuPct: 20 }),
          sample(-15_000, { gpuPct: 0 }),
          sample(-10_000, { gpuPct: 30 }),
          sample(-5_000, { gpuPct: 40 })
        ]
      })
    )
    const root = details.root

    expect(root.findAllByProps({ 'data-resource-series-line': 'gpu' })).toHaveLength(2)
    expect(collectText(root.findByProps({ 'data-resource-gpu-avg': true }))).toContain('20%')
    expect(collectText(root.findByProps({ 'data-resource-gpu-value': true }))).toContain('40')
  })

  it('shows a waiting state without drawing invented samples', async () => {
    const details = await mount(session({ resourceHistory: undefined }))
    const root = details.root

    expect(root.findByProps({ 'data-resource-status': 'waiting' })).toBeDefined()
    expect(root.findAllByProps({ 'data-resource-empty': true })).toHaveLength(2)
    expect(collectText(root.findByProps({ 'data-resource-gpu-value': true }))).toContain('—')
    expect(root.findAllByProps({ 'data-resource-series-line': 'gpu' })).toHaveLength(0)
    expect(root.findAllByProps({ 'data-resource-series-point': 'gpu' })).toHaveLength(0)
    expect(collectText(root.findByProps({ 'data-resource-disk': true }))).toContain('18%')
  })

  it('does not plot samples whose metrics are all null', async () => {
    const details = await mount(
      session({ resourceHistory: [sample(-5000), sample(0)] })
    )
    const root = details.root

    expect(root.findByProps({ 'data-resource-status': 'live' })).toBeDefined()
    expect(root.findAllByProps({ 'data-resource-empty': true })).toHaveLength(2)
    expect(collectText(root.findByProps({ 'data-resource-gpu-value': true }))).toContain('—')
    expect(root.findAllByProps({ 'data-resource-series-line': 'gpu' })).toHaveLength(0)
  })

  it.each(['CPU', 'V6E1'] as const)(
    'hides GPU trends for %s runtimes while keeping real RAM samples',
    async (accelerator) => {
      const details = await mount(
        session({
          accelerator,
          vramGb: null,
          resourceHistory: [
            sample(-10_000, { ramUsedGiB: 6, ramTotalGiB: null }),
            sample(0, { ramUsedGiB: 8, ramTotalGiB: null })
          ]
        })
      )
      const root = details.root

      expect(root.findAllByProps({ 'data-resource-gpu': true })).toHaveLength(0)
      expect(root.findByProps({ 'data-resource-gpu-unavailable': true })).toBeDefined()
      expect(root.findAllByProps({ 'data-resource-legend-vram': true })).toHaveLength(0)
      // A hardware catalogue estimate is not a measurement of this VM's capacity.
      expect(collectText(root.findByProps({ 'data-resource-legend-ram': true }))).toContain(
        '8 / — GiB'
      )
      expect(collectText(root.findByProps({ 'data-resource-memory-value': true }))).toContain(
        '8'
      )
    }
  )

  it('labels stalled sampling as stale with the real last-sample age', async () => {
    const details = await mount(
      session({
        resourceHistory: [sample(-360_000, { gpuPct: 55 })]
      })
    )
    const root = details.root
    const chip = root.findByProps({ 'data-resource-status': 'stale' })

    expect(collectText(chip)).toContain('Stale')
    expect(chip.props.title).toBe('Last sample 6m ago')
    expect(collectText(root.findByProps({ 'data-resource-last-sample': true }))).toContain(
      '6m ago'
    )
    expect(root.findAllByProps({ 'data-resource-empty': true })).toHaveLength(2)
  })

  it('exposes hover and keyboard focus sample values', async () => {
    const details = await mount(
      session({
        resourceHistory: [
          sample(-10_000, { gpuPct: 10 }),
          sample(0, { gpuPct: 90 })
        ]
      })
    )
    const root = details.root
    const svg = root.findByProps({ 'data-resource-svg': 'gpu' })

    await act(async () => svg.props.onFocus())
    expect(collectText(root.findByProps({ 'data-resource-tooltip': 'gpu' }))).toContain('90%')

    await act(async () =>
      svg.props.onKeyDown({ key: 'ArrowLeft', preventDefault: vi.fn() })
    )
    expect(collectText(root.findByProps({ 'data-resource-tooltip': 'gpu' }))).toContain('10%')

    await act(async () => svg.props.onBlur())
    expect(root.findAllByProps({ 'data-resource-tooltip': 'gpu' })).toHaveLength(0)

    const hitArea = root.findByProps({ 'data-resource-hit-area': 'gpu' })
    await act(async () =>
      hitArea.props.onPointerMove({
        clientX: 298,
        currentTarget: {
          getBoundingClientRect: () => ({ left: 0, width: 308 })
        }
      })
    )
    expect(collectText(root.findByProps({ 'data-resource-tooltip': 'gpu' }))).toContain('10%')
  })

  it('drops the previous session values and hover state when the runtime switches', async () => {
    await mount(
      session({
        id: 'session-a',
        resourceHistory: [sample(0, { gpuPct: 11, ramUsedGiB: 10, ramTotalGiB: 32 })]
      })
    )
    const root = renderer!.root
    const svg = root.findByProps({ 'data-resource-svg': 'gpu' })
    await act(async () => svg.props.onFocus())
    expect(collectText(root.findByProps({ 'data-resource-tooltip': 'gpu' }))).toContain('11%')

    await update(
      session({
        id: 'session-b',
        resourceHistory: [sample(0, { gpuPct: 88, ramUsedGiB: 20, ramTotalGiB: 32 })]
      })
    )

    const nextRoot = renderer!.root
    expect(nextRoot.findByProps({ 'data-resource-session-id': 'session-b' })).toBeDefined()
    expect(collectText(nextRoot.findByProps({ 'data-resource-gpu-value': true }))).toContain('88')
    expect(nextRoot.findAllByProps({ 'data-resource-tooltip': 'gpu' })).toHaveLength(0)
    expect(collectText(nextRoot)).not.toContain('11%')
  })
})
