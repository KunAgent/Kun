import { describe, expect, it, vi } from 'vitest'
import {
  isLowRiskAutomaticAction,
  withBrowserUseDeadline,
  type BrowserTarget
} from './browser-use-manager-support'

vi.mock('electron', () => ({
  BrowserWindow: class {},
  WebContentsView: class {}
}))

function target(role: string, name: string): BrowserTarget {
  return {
    ref: 'opaque-ref',
    tabId: 'tab-1',
    documentGeneration: 1,
    backendNodeId: 7,
    role,
    name,
    sensitive: false,
    disabled: false,
    rect: { x: 10, y: 10, width: 100, height: 40 },
    fingerprint: 'fingerprint'
  }
}

describe('Browser Use operation deadlines', () => {
  it('returns a named timeout and runs cleanup for a stalled boundary', async () => {
    vi.useFakeTimers()
    const cleanup = vi.fn()
    const pending = withBrowserUseDeadline(
      new Promise<never>(() => undefined), new AbortController().signal,
      25, 'navigation_timeout', 'Navigation timed out.', cleanup
    )
    const rejection = expect(pending).rejects.toMatchObject({ code: 'navigation_timeout' })
    await vi.advanceTimersByTimeAsync(25)
    await rejection
    expect(cleanup).toHaveBeenCalledOnce()
    vi.useRealTimers()
  })

  it('prefers abort over a later timeout', async () => {
    vi.useFakeTimers()
    const controller = new AbortController()
    const pending = withBrowserUseDeadline(
      new Promise<never>(() => undefined), controller.signal,
      25, 'navigation_timeout', 'Navigation timed out.'
    )
    controller.abort()
    await expect(pending).rejects.toMatchObject({ name: 'BrowserUseOperationAbortedError' })
    await vi.advanceTimersByTimeAsync(25)
    vi.useRealTimers()
  })
})

describe('Browser Use automatic interaction classification', () => {
  it('never treats a target-focused key press as an automatic interaction', () => {
    expect(isLowRiskAutomaticAction(
      { action: 'press', key: 'Escape' } as never,
      target('button', 'Continue')
    )).toBe(false)
  })

  it.each([
    ['link', 'Account'],
    ['link', ''],
    ['tab', 'Billing'],
    ['tab', '   ']
  ])('requires consent for an unallowlisted %s named %j', (role, name) => {
    expect(isLowRiskAutomaticAction(
      { action: 'click' } as never,
      target(role, name)
    )).toBe(false)
  })

  it.each([
    ['button', 'Expand'],
    ['tab', 'Show more']
  ])('retains the narrow non-empty page-control allowlist for %s %j', (role, name) => {
    expect(isLowRiskAutomaticAction(
      { action: 'click' } as never,
      target(role, name)
    )).toBe(true)
  })

  it.each([
    ['link', 'Learn more'],
    ['checkbox', 'Close'],
    ['radio', 'Dismiss'],
    ['button', 'Close'],
    ['button', 'Dismiss'],
    ['button', 'Cancel'],
    ['button', 'Next page']
  ])('requires consent outside the narrow page-control allowlist for %s %j', (role, name) => {
    expect(isLowRiskAutomaticAction(
      { action: 'click' } as never,
      target(role, name)
    )).toBe(false)
  })
})
