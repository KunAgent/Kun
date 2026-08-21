import { describe, expect, it, vi, beforeEach } from 'vitest'
import { CanvasReceiptRegistry, type CanvasReceiptRegistryDeps } from './canvas-receipt-registry'

const call = { callId: 'call_1', toolName: 'design_update_shapes', arguments: {} }

function makeRegistry(recordBarrier?: Promise<void>) {
  const applied: unknown[] = []
  const records: Array<Record<string, unknown>> = []
  const record = vi.fn(async (event: unknown) => {
    records.push(event as Record<string, unknown>)
    await recordBarrier
  })
  const registry = new CanvasReceiptRegistry({
    turns: {
      applyItem: async (threadId: string, item: unknown) => {
        applied.push({ threadId, item })
      }
    },
    events: { record },
    nowIso: () => '2026-08-13T00:00:00.000Z'
  } as unknown as CanvasReceiptRegistryDeps)
  return { registry, applied, records }
}

describe('CanvasReceiptRegistry', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  it('finalizes a turn receipt as applied with the real outcome', async () => {
    const { registry, applied, records } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-abc',
      threadId: 'thread_1',
      turnId: 'turn_1',
      call,
      itemId: 'item_call_1',
      acceptedOutput: { ok: true, status: 'accepted', receiptKey: 'design-receipt-abc', ops: [] }
    })
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_1', 45_000)
    const fulfilled = await registry.fulfillTurn('thread_1', 'turn_1', {
      status: 'applied',
      affectedIds: ['shape-1']
    })
    await wait
    expect(fulfilled).toBe(true)
    expect(applied).toHaveLength(1)
    const item = (applied[0] as { item: { output: Record<string, unknown>; isError?: boolean } }).item
    expect(item.output).toMatchObject({ ok: true, status: 'applied', unverified: false, affectedIds: ['shape-1'] })
    expect(item.isError).toBe(false)
    expect(records.some((record) => record.kind === 'canvas_receipt' && record.status === 'applied')).toBe(true)
  })

  it('finalizes a failed turn receipt as an error result', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-xyz',
      threadId: 'thread_1',
      turnId: 'turn_2',
      call,
      itemId: 'item_call_2',
      acceptedOutput: { ok: true, status: 'accepted', ops: [] }
    })
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_2', 45_000)
    await registry.fulfillTurn('thread_1', 'turn_2', {
      status: 'failed',
      errors: [{ code: 'INVALID_OP', message: 'bad op' }]
    })
    await wait
    const item = (applied[0] as { item: { output: Record<string, unknown>; isError: boolean } }).item
    expect(item.output).toMatchObject({ ok: false, status: 'failed', unverified: false, errors: [{ code: 'INVALID_OP', message: 'bad op' }] })
    expect(item.isError).toBe(true)
  })

  it('persists generated files only after the renderer confirms the export', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-export',
      threadId: 'thread_1',
      turnId: 'turn_export',
      call: { ...call, toolName: 'design_export_canvas' },
      itemId: 'item_call_export',
      acceptedOutput: {
        ok: true,
        status: 'accepted',
        receiptKey: 'design-receipt-export',
        exportRequest: { relativePath: '.kun/images/architecture.png' }
      }
    })
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_export', 45_000)
    await registry.fulfillForTurn(
      'design-receipt-export',
      'thread_1',
      'turn_export',
      {
        status: 'applied',
        generatedFiles: [{
          name: 'architecture.png',
          relativePath: '.kun/images/architecture.png',
          absolutePath: '/workspace/.kun/images/architecture.png',
          mimeType: 'image/png',
          byteSize: 128
        }]
      }
    )
    await wait

    expect((applied[0] as { item: { output: unknown } }).item.output).toMatchObject({
      ok: true,
      status: 'applied',
      generatedFiles: [{
        relativePath: '.kun/images/architecture.png',
        mimeType: 'image/png',
        byteSize: 128
      }]
    })
  })

  it('times out to an explicit unverified result (never ok:true)', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-timeout',
      threadId: 'thread_1',
      turnId: 'turn_3',
      call,
      itemId: 'item_call_3',
      acceptedOutput: { ok: true, status: 'accepted', ops: [] }
    })
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_3', 100)
    await vi.advanceTimersByTimeAsync(200)
    await wait
    const item = (applied[0] as { item: { output: Record<string, unknown>; isError: boolean } }).item
    expect(item.output).toMatchObject({ ok: false, status: 'accepted', unverified: true })
    expect(item.isError).toBe(true)
  })

  it('is idempotent: a second turn receipt for a settled turn is ignored', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-dup',
      threadId: 'thread_1',
      turnId: 'turn_4',
      call,
      itemId: 'item_call_4',
      acceptedOutput: { ok: true, status: 'accepted', ops: [] }
    })
    const first = await registry.fulfillTurn('thread_1', 'turn_4', { status: 'applied' })
    const second = await registry.fulfillTurn('thread_1', 'turn_4', { status: 'failed' })
    expect(first).toBe(true)
    expect(second).toBe(false)
    expect(applied).toHaveLength(1)
  })

  it('finalizes a receipt that arrives before the loop starts waiting', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-early',
      threadId: 'thread_1',
      turnId: 'turn_early',
      call,
      itemId: 'item_call_early',
      acceptedOutput: { ok: true, status: 'accepted', receiptKey: 'design-receipt-early' }
    })

    expect(await registry.fulfillForTurn(
      'design-receipt-early', 'thread_1', 'turn_early', {
        status: 'applied', affectedIds: ['label-early']
      }
    )).toBe(true)
    await registry.awaitTurnReceipts('thread_1', 'turn_early', 45_000)

    expect(applied).toHaveLength(1)
    expect((applied[0] as { item: { output: unknown } }).item.output).toMatchObject({
      status: 'applied', affectedIds: ['label-early']
    })
  })

  it('keeps the loop waiting while an early receipt is being finalized', async () => {
    let releaseRecord: (() => void) | undefined
    const recordBarrier = new Promise<void>((resolve) => { releaseRecord = resolve })
    const { registry, applied } = makeRegistry(recordBarrier)
    registry.register({
      receiptKey: 'design-receipt-racing',
      threadId: 'thread_1',
      turnId: 'turn_racing',
      call,
      itemId: 'item_call_racing',
      acceptedOutput: { ok: true, status: 'accepted', receiptKey: 'design-receipt-racing' }
    })

    const fulfill = registry.fulfillForTurn(
      'design-receipt-racing', 'thread_1', 'turn_racing', { status: 'applied' }
    )
    let waitResolved = false
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_racing', 45_000)
      .then(() => { waitResolved = true })
    await Promise.resolve()
    expect(waitResolved).toBe(false)
    expect(applied).toHaveLength(0)

    releaseRecord?.()
    await fulfill
    await wait
    expect(applied).toHaveLength(1)
  })

  it('does not finalize twice when timeout wins during receipt recording', async () => {
    let releaseRecord: (() => void) | undefined
    const recordBarrier = new Promise<void>((resolve) => { releaseRecord = resolve })
    const { registry, applied } = makeRegistry(recordBarrier)
    registry.register({
      receiptKey: 'design-receipt-slow',
      threadId: 'thread_1',
      turnId: 'turn_slow',
      call,
      itemId: 'item_call_slow',
      acceptedOutput: { ok: true, status: 'accepted', receiptKey: 'design-receipt-slow' }
    })

    const fulfill = registry.fulfillForTurn(
      'design-receipt-slow', 'thread_1', 'turn_slow', { status: 'applied' }
    )
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_slow', 100)
    await vi.advanceTimersByTimeAsync(200)
    await wait
    expect(applied).toHaveLength(1)
    expect((applied[0] as { item: { output: unknown } }).item.output).toMatchObject({
      status: 'accepted', unverified: true
    })

    releaseRecord?.()
    await fulfill
    expect(applied).toHaveLength(1)
  })

  it('fulfills one key immediately and fences it to its owning turn', async () => {
    const { registry, applied } = makeRegistry()
    registry.register({
      receiptKey: 'design-receipt-scoped',
      threadId: 'thread_1',
      turnId: 'turn_5',
      call,
      itemId: 'item_call_5',
      acceptedOutput: { ok: true, status: 'accepted', receiptKey: 'design-receipt-scoped' }
    })
    const wait = registry.awaitTurnReceipts('thread_1', 'turn_5', 45_000)

    expect(await registry.fulfillForTurn(
      'design-receipt-scoped', 'thread_other', 'turn_5', { status: 'applied' }
    )).toBe(false)
    expect(await registry.fulfillForTurn(
      'design-receipt-scoped', 'thread_1', 'turn_other', { status: 'applied' }
    )).toBe(false)
    expect(await registry.fulfillForTurn(
      'design-receipt-scoped', 'thread_1', 'turn_5', {
        status: 'applied', affectedIds: ['label-1']
      }
    )).toBe(true)

    await wait
    expect(applied).toHaveLength(1)
    expect((applied[0] as { item: { output: unknown } }).item.output).toMatchObject({
      status: 'applied', affectedIds: ['label-1']
    })
  })
})
