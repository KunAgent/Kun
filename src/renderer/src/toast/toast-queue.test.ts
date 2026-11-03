import { describe, expect, it } from 'vitest'
import { defaultToastDurationMs, splitToastWindow, toastSignature } from './toast-queue'
import type { ToastInput, ToastItem } from './toast-types'

function item(id: string, overrides: Partial<ToastItem> = {}): ToastItem {
  const input: ToastInput = { id, tone: 'success', title: id, ...overrides }
  const durationMs = overrides.durationMs === undefined ? 4_000 : overrides.durationMs
  return {
    ...input,
    sequence: Number(id.replace(/\D/g, '')) || 0,
    durationMs,
    remainingMs: durationMs,
    expiresAt: null,
    paused: false,
    signature: toastSignature(input)
  } as ToastItem
}

describe('splitToastWindow', () => {
  it('shows everything while the dock is not crowded', () => {
    const window = splitToastWindow([item('1'), item('2')])
    expect(window.visible.map((entry) => entry.id)).toEqual(['1', '2'])
    expect(window.waiting).toEqual([])
  })

  it('keeps the newest three transient cards and drops the older ones', () => {
    const window = splitToastWindow([item('1'), item('2'), item('3'), item('4')])
    expect(window.visible.map((entry) => entry.id)).toEqual(['2', '3', '4'])
    expect(window.waiting).toEqual([])
  })

  it('lets work in flight take a slot from a disposable success', () => {
    const window = splitToastWindow([
      item('1'),
      item('2'),
      item('3'),
      item('4', { tone: 'running', durationMs: null })
    ])
    expect(window.visible.map((entry) => entry.id)).toEqual(['2', '3', '4'])
    expect(window.waiting).toEqual([])
  })

  it('never drops a persistent card: it waits for a slot instead', () => {
    const window = splitToastWindow([
      item('1', { tone: 'running', durationMs: null }),
      item('2', { tone: 'error', durationMs: null }),
      item('3', { tone: 'running', durationMs: null }),
      item('4', { tone: 'error', durationMs: null })
    ])
    expect(window.visible.map((entry) => entry.id)).toEqual(['2', '3', '4'])
    expect(window.waiting.map((entry) => entry.id)).toEqual(['1'])
  })
})

describe('defaultToastDurationMs', () => {
  it('keeps running work and failures until the user acts', () => {
    expect(defaultToastDurationMs('running', undefined)).toBeNull()
    expect(defaultToastDurationMs('error', [{ label: 'Retry', run: () => {} }])).toBeNull()
  })

  it('gives actionable and informational cards their designed lifetimes', () => {
    expect(defaultToastDurationMs('success', [{ label: 'Undo', run: () => {} }])).toBe(12_000)
    expect(defaultToastDurationMs('success', undefined)).toBe(4_000)
  })
})

describe('toastSignature', () => {
  it('ignores callback identity but tracks every rendered field', () => {
    const first = toastSignature({ id: 'a', tone: 'success', title: 'Saved', actions: [{ label: 'Undo', run: () => {} }] })
    const second = toastSignature({ id: 'a', tone: 'success', title: 'Saved', actions: [{ label: 'Undo', run: () => {} }] })
    expect(first).toBe(second)
    expect(toastSignature({ id: 'a', tone: 'error', title: 'Saved' })).not.toBe(first)
    expect(toastSignature({ id: 'a', tone: 'success', title: 'Saved', description: 'new' })).not.toBe(first)
  })

  it('rounds progress so tiny byte updates do not rewrite the card', () => {
    const base = { id: 'a', tone: 'running' as const, title: 'Downloading' }
    const left = toastSignature({ ...base, progress: { label: 'Downloading', percent: 41.2 } })
    const right = toastSignature({ ...base, progress: { label: 'Downloading', percent: 41.4 } })
    expect(left).toBe(right)
  })
})
