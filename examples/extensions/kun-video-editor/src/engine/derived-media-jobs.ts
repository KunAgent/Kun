import { engineError } from './errors.js'
import {
  DerivedMediaStore,
  derivedDedupeKey,
  type DerivedMediaKind,
  type DerivedMediaPriority,
  type DerivedMediaRecord,
  type DerivedRequest
} from './derived-media.js'

export type BrokeredDerivedKind = 'waveform' | 'thumbnail' | 'filmstrip' | 'proxy' | 'proof' | 'preview'

export type DerivedJobPlan = {
  schemaVersion: 1
  kind: BrokeredDerivedKind
  arguments: string[]
  inputs: { source: string }
  outputs: { derived: string }
  idempotencyKey: string
  scheduling: {
    priority: DerivedMediaPriority
    maxAttempts: 3
    retryBaseDelayMs: 250
  }
  metadata: {
    derivedId: string
    dedupeKey: string
    derivedKind: BrokeredDerivedKind
    producerId: string
    producerVersion: string
    priority: DerivedMediaPriority
    sourceFingerprint: string
    projectId?: string
    assetId?: string
    pinnedRevision?: number
    derivedPhase: string
    derivedPhaseIndex: number
    derivedPhaseCount: number
  }
  expectedArtifact: {
    mediaKind: 'image' | 'video'
    mimeType: 'image/png' | 'video/mp4'
  }
  progressive: boolean
  phases: Array<{ id: string; fraction: number; partial: boolean }>
}

export type DerivedJobPlanRequest = {
  record: DerivedMediaRecord
  sourceHandleId: string
  outputHandleId: string
  pinnedRevision?: number
  seekUs?: number
  durationUs?: number
  width?: number
  height?: number
  filmstripIntervalUs?: number
  filmstripColumns?: number
  filmstripRows?: number
  phase?: {
    id: string
    index: number
    count: number
    partial: boolean
  }
}

export type DerivedWorkResult = {
  bytes: number
  artifactHandleIds: string[]
}

export type DerivedWorkRunner = (
  record: DerivedMediaRecord,
  context: {
    signal: AbortSignal
    report(progress: {
      completed: number
      total: number
      unit: string
      message?: string
      partialArtifactHandleIds?: readonly string[]
    }): Promise<void>
  }
) => Promise<DerivedWorkResult>

export type DerivedWorkTicket = {
  record: DerivedMediaRecord
  deduplicated: boolean
  completion: Promise<DerivedMediaRecord>
}

type QueueEntry = {
  request: DerivedRequest
  record: DerivedMediaRecord
  runner: DerivedWorkRunner
  controller: AbortController
  completion: Promise<DerivedMediaRecord>
  resolve(record: DerivedMediaRecord): void
  reject(error: unknown): void
}

const PRIORITY_ORDER: Readonly<Record<DerivedMediaPriority, number>> = Object.freeze({
  background: 100,
  user: 200,
  interactive: 300,
  export: 400
})

export class DerivedWorkCoordinator {
  private readonly queued: QueueEntry[] = []
  private readonly active = new Map<string, QueueEntry>()
  private readonly completions = new Map<string, Promise<DerivedMediaRecord>>()
  private running = 0
  private exportActive = false

  constructor(
    private readonly store: DerivedMediaStore,
    private readonly maxConcurrent = 2
  ) {
    if (!Number.isSafeInteger(maxConcurrent) || maxConcurrent < 1 || maxConcurrent > 16) {
      throw engineError('invalid_operation', 'Derived concurrency must be from 1 through 16')
    }
  }

  async request(request: DerivedRequest, runner: DerivedWorkRunner): Promise<DerivedWorkTicket> {
    const requested = await this.store.request(request)
    const existingCompletion = this.completions.get(requested.record.id)
    if (requested.deduplicated) {
      return {
        record: requested.record,
        deduplicated: true,
        completion: existingCompletion ?? Promise.resolve(requested.record)
      }
    }
    let resolve!: (record: DerivedMediaRecord) => void
    let reject!: (error: unknown) => void
    const completion = new Promise<DerivedMediaRecord>((accept, fail) => {
      resolve = accept
      reject = fail
    })
    const entry: QueueEntry = {
      request,
      record: requested.record,
      runner,
      controller: new AbortController(),
      completion,
      resolve,
      reject
    }
    this.queued.push(entry)
    this.completions.set(entry.record.id, completion)
    this.sortQueue()
    this.pump()
    return { record: requested.record, deduplicated: false, completion }
  }

  setExportActive(active: boolean): void {
    this.exportActive = active
    if (!active) this.pump()
  }

  async cancel(recordId: string): Promise<DerivedMediaRecord> {
    const queuedIndex = this.queued.findIndex(({ record }) => record.id === recordId)
    if (queuedIndex >= 0) {
      const [entry] = this.queued.splice(queuedIndex, 1)
      entry!.controller.abort()
      const cancelled = await this.store.cancel(recordId)
      entry!.resolve(cancelled)
      this.completions.delete(recordId)
      return cancelled
    }
    const active = this.active.get(recordId)
    if (active) {
      active.controller.abort()
      return await this.store.cancel(recordId)
    }
    const record = await this.store.get(recordId, false)
    if (!record) throw engineError('invalid_operation', `Derived work does not exist: ${recordId}`)
    return record
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const index = this.queued.findIndex(({ record }) =>
        !this.exportActive || record.priority === 'export'
      )
      if (index < 0) return
      const [entry] = this.queued.splice(index, 1)
      this.running += 1
      this.active.set(entry!.record.id, entry!)
      void this.run(entry!).finally(() => {
        this.running -= 1
        this.active.delete(entry!.record.id)
        this.completions.delete(entry!.record.id)
        this.pump()
      })
    }
  }

  private async run(entry: QueueEntry): Promise<void> {
    try {
      const running = await this.store.markRunning(entry.record.id, `local-derived-${entry.record.id}`)
      entry.record = running
      const result = await entry.runner(running, {
        signal: entry.controller.signal,
        report: async (progress) => {
          if (entry.controller.signal.aborted) throw abortError()
          entry.record = await this.store.reportProgress(entry.record.id, progress)
        }
      })
      if (entry.controller.signal.aborted) throw abortError()
      const ready = await this.store.complete(entry.record.id, result)
      entry.resolve(ready)
    } catch (error) {
      if (entry.controller.signal.aborted || isAbortError(error)) {
        const current = await this.store.get(entry.record.id, false)
        const cancelled = current?.status === 'cancelled'
          ? current
          : await this.store.cancel(entry.record.id)
        entry.resolve(cancelled)
        return
      }
      try {
        const failed = await this.store.fail(entry.record.id, {
          code: 'derived_failed',
          message: error instanceof Error ? error.message : String(error),
          retryable: true
        })
        entry.resolve(failed)
      } catch (transitionError) {
        entry.reject(transitionError)
      }
    }
  }

  private sortQueue(): void {
    this.queued.sort((left, right) =>
      PRIORITY_ORDER[right.record.priority] - PRIORITY_ORDER[left.record.priority] ||
      left.record.createdAt.localeCompare(right.record.createdAt) ||
      left.record.id.localeCompare(right.record.id)
    )
  }
}

export function buildDerivedJobPlan(request: DerivedJobPlanRequest): DerivedJobPlan {
  const kind = brokeredKind(request.record.kind)
  const sourceHandleId = opaqueHandle(request.sourceHandleId, 'sourceHandleId')
  const outputHandleId = opaqueHandle(request.outputHandleId, 'outputHandleId')
  const seekSeconds = secondsArgument(request.seekUs ?? 0, 'seekUs')
  const durationSeconds = secondsArgument(request.durationUs ?? 12_000_000, 'durationUs', true)
  const width = boundedInteger(request.width ?? (kind === 'thumbnail' || kind === 'proof' ? 960 : 1280), 64, 4096, 'width')
  const height = boundedInteger(request.height ?? (kind === 'waveform' ? 240 : 720), 64, 4096, 'height')
  const phase = normalizePhase(request.phase)
  let args: string[]
  let progressive = false
  let phases: DerivedJobPlan['phases']
  let mediaKind: 'image' | 'video'
  let mimeType: 'image/png' | 'video/mp4'
  switch (kind) {
    case 'waveform':
      args = [
        '-nostdin', '-ss', seekSeconds, '-t', durationSeconds,
        '-i', '{{input:source}}', '-filter_complex',
        `showwavespic=s=${width}x${height}:colors=white`, '-frames:v', '1', '-f', 'image2',
        '{{output:derived}}'
      ]
      progressive = true
      phases = progressPhases('waveform')
      mediaKind = 'image'
      mimeType = 'image/png'
      break
    case 'thumbnail':
    case 'proof':
      args = [
        '-nostdin', '-ss', seekSeconds, '-i', '{{input:source}}', '-frames:v', '1',
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease`, '-f', 'image2',
        '{{output:derived}}'
      ]
      phases = progressPhases(kind)
      mediaKind = 'image'
      mimeType = 'image/png'
      break
    case 'filmstrip': {
      const interval = secondsArgument(request.filmstripIntervalUs ?? 5_000_000, 'filmstripIntervalUs', true)
      const columns = boundedInteger(request.filmstripColumns ?? 5, 1, 12, 'filmstripColumns')
      const rows = boundedInteger(request.filmstripRows ?? 2, 1, 12, 'filmstripRows')
      args = [
        '-nostdin', '-ss', seekSeconds, '-t', durationSeconds,
        '-i', '{{input:source}}', '-vf',
        `fps=1/${interval},scale=${width}:-2,tile=${columns}x${rows}`, '-frames:v', '1', '-f', 'image2',
        '{{output:derived}}'
      ]
      progressive = true
      phases = progressPhases(kind)
      mediaKind = 'image'
      mimeType = 'image/png'
      break
    }
    case 'proxy':
    case 'preview':
      args = [
        '-nostdin', '-ss', seekSeconds, '-i', '{{input:source}}',
        '-t', durationSeconds,
        '-vf', `scale=${width}:${height}:force_original_aspect_ratio=decrease`,
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', kind === 'proxy' ? '24' : '28',
        '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', '-f', 'mp4',
        '{{output:derived}}'
      ]
      progressive = kind === 'proxy'
      phases = progressPhases(kind)
      mediaKind = 'video'
      mimeType = 'video/mp4'
      break
  }
  const key = request.record.dedupeKey || derivedDedupeKey({
    kind: request.record.kind,
    owner: request.record.owner,
    sourceFingerprint: request.record.sourceFingerprint,
    normalizedParameters: request.record.normalizedParameters,
    producer: request.record.producer,
    dependencies: request.record.dependencies,
    priority: request.record.priority,
    pinned: request.record.pinned
  })
  return {
    schemaVersion: 1,
    kind,
    arguments: args,
    inputs: { source: sourceHandleId },
    outputs: { derived: outputHandleId },
    idempotencyKey: `derived:${key}:${phase.index}:${phase.id}`.slice(0, 256),
    scheduling: {
      priority: request.record.priority,
      maxAttempts: 3,
      retryBaseDelayMs: 250
    },
    metadata: {
      derivedId: request.record.id,
      dedupeKey: key,
      derivedKind: kind,
      producerId: request.record.producer.id,
      producerVersion: request.record.producer.version,
      priority: request.record.priority,
      sourceFingerprint: request.record.sourceFingerprint.value,
      ...(request.record.owner.projectId === undefined
        ? {}
        : { projectId: request.record.owner.projectId }),
      ...(request.record.owner.assetId === undefined
        ? {}
        : { assetId: request.record.owner.assetId }),
      ...(request.pinnedRevision === undefined
        ? {}
        : { pinnedRevision: boundedInteger(request.pinnedRevision, 0, Number.MAX_SAFE_INTEGER, 'pinnedRevision') }),
      derivedPhase: phase.id,
      derivedPhaseIndex: phase.index,
      derivedPhaseCount: phase.count
    },
    expectedArtifact: { mediaKind, mimeType },
    progressive,
    phases
  }
}

function normalizePhase(phase: DerivedJobPlanRequest['phase']): {
  id: string
  index: number
  count: number
  partial: boolean
} {
  if (phase === undefined) return { id: 'final', index: 0, count: 1, partial: false }
  if (!/^[a-z][a-z0-9-]{0,63}$/u.test(phase.id)) {
    throw engineError('invalid_operation', 'Derived phase ID is invalid')
  }
  if (!Number.isSafeInteger(phase.index) || !Number.isSafeInteger(phase.count) ||
    phase.count < 1 || phase.count > 16 || phase.index < 0 || phase.index >= phase.count) {
    throw engineError('invalid_operation', 'Derived phase bounds are invalid')
  }
  if (phase.partial === (phase.index === phase.count - 1)) {
    throw engineError('invalid_operation', 'Only non-final derived phases may publish partial output')
  }
  return { ...phase }
}

function progressPhases(kind: BrokeredDerivedKind): DerivedJobPlan['phases'] {
  if (kind === 'filmstrip') return [
    { id: 'sample', fraction: 0.25, partial: true },
    { id: 'compose', fraction: 0.75, partial: true },
    { id: 'validate', fraction: 1, partial: false }
  ]
  if (kind === 'waveform' || kind === 'proxy') return [
    { id: 'decode', fraction: 0.2, partial: false },
    { id: 'derive', fraction: 0.8, partial: true },
    { id: 'validate', fraction: 1, partial: false }
  ]
  return [
    { id: 'derive', fraction: 0.8, partial: false },
    { id: 'validate', fraction: 1, partial: false }
  ]
}

function brokeredKind(kind: DerivedMediaKind): BrokeredDerivedKind {
  if (['waveform', 'thumbnail', 'filmstrip', 'proxy', 'proof', 'preview'].includes(kind)) {
    return kind as BrokeredDerivedKind
  }
  throw engineError('render_unsupported', `Derived kind ${kind} does not use the FFmpeg broker`)
}

function opaqueHandle(value: string, path: string): string {
  if (typeof value !== 'string' || value.length < 8 || value.length > 512 || !/^[A-Za-z0-9._~:-]+$/u.test(value)) {
    throw engineError('invalid_operation', `${path} must be an opaque Host media handle`)
  }
  return value
}

function secondsArgument(value: number, path: string, positive = false): string {
  if (!Number.isSafeInteger(value) || value < (positive ? 1 : 0)) {
    throw engineError('invalid_operation', `${path} must be ${positive ? 'a positive' : 'a non-negative'} integer microsecond value`)
  }
  return (value / 1_000_000).toFixed(6).replace(/0+$/u, '').replace(/\.$/u, '') || '0'
}

function boundedInteger(value: number, minimum: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw engineError('invalid_operation', `${path} must be from ${minimum} through ${maximum}`)
  }
  return value
}

function abortError(): Error {
  const error = new Error('Derived work was cancelled')
  error.name = 'AbortError'
  return error
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError'
}
