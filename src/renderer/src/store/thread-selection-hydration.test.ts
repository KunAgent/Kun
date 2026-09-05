import { describe, expect, it } from 'vitest'
import { runtimeErrorToError } from '@shared/runtime-error'
import { isThreadHydrationCancellation } from './thread-selection-hydration'

describe('isThreadHydrationCancellation', () => {
  it('accepts a DOMException named AbortError', () => {
    expect(isThreadHydrationCancellation(new DOMException('aborted', 'AbortError'))).toBe(true)
  })

  it('accepts an Error named AbortError', () => {
    expect(isThreadHydrationCancellation(Object.assign(new Error('x'), { name: 'AbortError' }))).toBe(true)
  })

  it('accepts the Kun stable aborted error code', () => {
    const error = runtimeErrorToError({ code: 'aborted', message: 'Runtime request was cancelled.' })
    expect(isThreadHydrationCancellation(error)).toBe(true)
  })

  it('rejects real errors that merely mention "aborted"', () => {
    expect(isThreadHydrationCancellation(new Error('transaction aborted'))).toBe(false)
    expect(isThreadHydrationCancellation(new Error('worker aborted unexpectedly'))).toBe(false)
    expect(isThreadHydrationCancellation(new Error('request aborted by runtime'))).toBe(false)
  })

  it('rejects non-Error values', () => {
    expect(isThreadHydrationCancellation('aborted')).toBe(false)
    expect(isThreadHydrationCancellation(undefined)).toBe(false)
  })
})
