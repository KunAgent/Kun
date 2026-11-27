import {
  COLAB_RESOURCE_INTERVAL_MS, COLAB_RESOURCE_WINDOW_MS,
  type ColabResourceSample, type ColabSessionView
} from '../../shared/colab/colab-types'
import { readRuntimeMetadata } from './colab-runtime-metadata'
import type { UploadAccess } from './runtime-file-upload'

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? value as Record<string, unknown> : {}
}

function number(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

function capacity(value: unknown): number | null {
  return number(value) || null // a zero capacity means the server could not measure it
}

function gib(bytes: number | null): number | null {
  return bytes === null ? null : bytes / 2 ** 30
}

export function parseColabResources(data: unknown, at: number): ColabResourceSample | null {
  const { memory, gpus, disks } = object(data)
  const ram = object(memory)
  const total = capacity(ram.totalBytes)
  const free = number(ram.freeBytes)
  const gpu = object(Array.isArray(gpus) ? gpus[0] : null)
  const utilization = number(gpu.gpuUtilization) // Colab reports a fraction, not percent.
  const filesystems = Array.isArray(disks) ? disks.map((d) => object(object(d).filesystem)) : []
  const disk = filesystems.find((fs) => fs.label === 'kernel' || fs.label === '/') ?? filesystems[0]
  const diskTotal = capacity(disk?.totalBytes)
  const used = number(disk?.usedBytes)
  const metrics = {
    gpuPct: utilization !== null && utilization <= 1 ? Math.round(utilization * 100) : null,
    vramUsedGiB: gib(number(gpu.memoryUsedBytes)),
    vramTotalGiB: gib(capacity(gpu.memoryTotalBytes)),
    ramUsedGiB: gib(total !== null && free !== null && free <= total ? total - free : null),
    ramTotalGiB: gib(total),
    diskPct: diskTotal !== null && used !== null && used <= diskTotal ? used / diskTotal * 100 : null
  }
  return Object.values(metrics).some((value) => value !== null) ? { at, ...metrics } : null
}

export function resourcePatch(current: ColabSessionView, sample: ColabResourceSample): Partial<ColabSessionView> {
  const maxPoints = Math.floor(COLAB_RESOURCE_WINDOW_MS / COLAB_RESOURCE_INTERVAL_MS) + 1
  const recent = (current.resourceHistory ?? []).filter(({ at }) =>
    at >= sample.at - COLAB_RESOURCE_WINDOW_MS && at < sample.at).slice(1 - maxPoints)
  return {
    resourceHistory: [...recent, sample],
    gpuHistory: sample.gpuPct === null ? current.gpuHistory : [...current.gpuHistory, sample.gpuPct].slice(-24),
    gpuUtilizationPct: sample.gpuPct,
    vramUsedGb: sample.vramUsedGiB,
    ramUsedGb: sample.ramUsedGiB,
    diskUsedPct: sample.diskPct,
    ...(sample.vramTotalGiB !== null && { vramGb: sample.vramTotalGiB }),
    ...(sample.ramTotalGiB !== null && { ramGb: sample.ramTotalGiB })
  }
}

// Anchor cadence to the timer, skipping busy ticks rather than queuing more requests.
export function startExclusivePoll(ms: number, signal: AbortSignal, poll: () => Promise<void>, immediate = true): void {
  if (signal.aborted) return
  let busy = false
  const tick = async (): Promise<void> => {
    if (busy || signal.aborted) return
    busy = true
    try {
      await poll()
    } catch {
      // Unavailable measurements remain gaps. Never log a credential-bearing runtime URL.
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => { void tick() }, ms)
  signal.addEventListener('abort', () => clearInterval(timer), { once: true })
  if (immediate) void tick()
}

export class ColabResourceMonitor {
  private readonly controllers = new Map<string, AbortController>()

  constructor(
    private readonly getSession: (id: string) => ColabSessionView | undefined,
    private readonly patchSession: (id: string, patch: Partial<ColabSessionView>) => void
  ) {}

  start(id: string, access: UploadAccess): void {
    if (this.controllers.has(id) || this.getSession(id)?.phase !== 'running') return
    const controller = new AbortController()
    this.controllers.set(id, controller)
    startExclusivePoll(COLAB_RESOURCE_INTERVAL_MS, controller.signal, async () => {
      const before = this.getSession(id)
      if (before?.phase !== 'running') { this.stop(id); return }
      const cutoff = Date.now() - COLAB_RESOURCE_WINDOW_MS
      if (before.resourceHistory?.some(({ at }) => at < cutoff)) {
        this.patchSession(id, { resourceHistory: before.resourceHistory.filter(({ at }) => at >= cutoff) })
      }
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(15_000)])
      const payload = await readRuntimeMetadata(access, 'api/colab/resources', signal)
      const current = this.getSession(id)
      if (signal.aborted || current?.phase !== 'running') return
      const sample = parseColabResources(payload, Date.now())
      if (sample) this.patchSession(id, resourcePatch(current, sample))
    })
  }

  stop(id: string): void {
    this.controllers.get(id)?.abort()
    this.controllers.delete(id)
  }

  stopAll(): void {
    for (const id of this.controllers.keys()) this.stop(id)
  }
}
