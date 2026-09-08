import { describe, expect, it } from 'vitest'
import {
  CUSTOM_HEADER_MAX_COUNT,
  CustomHeadersSchema,
  customHeaderValidationError
} from './custom-headers.js'

describe('custom header validation', () => {
  it('accepts a valid header map', () => {
    expect(customHeaderValidationError({ 'X-API-Key': 'abc', 'X-Project': 'p' })).toBeUndefined()
    expect(customHeaderValidationError({})).toBeUndefined()
  })

  it('rejects case-insensitive duplicate names', () => {
    expect(customHeaderValidationError({ 'X-A': '1', 'x-a': '2' })).toContain('duplicate')
  })

  it('rejects transport-control headers', () => {
    expect(customHeaderValidationError({ Host: 'example.test' })).toContain('not allowed')
    expect(customHeaderValidationError({ 'Content-Length': '10' })).toContain('not allowed')
    expect(customHeaderValidationError({ Connection: 'keep-alive' })).toContain('not allowed')
  })

  it('rejects invalid names and control characters in values', () => {
    expect(customHeaderValidationError({ 'Bad Name': 'x' })).toContain('invalid header name')
    expect(customHeaderValidationError({ 'X-A': 'a\nb' })).toContain('control characters')
  })

  it('rejects oversized maps', () => {
    const tooMany: Record<string, string> = {}
    for (let i = 0; i < CUSTOM_HEADER_MAX_COUNT + 1; i += 1) tooMany[`X-${i}`] = 'v'
    expect(customHeaderValidationError(tooMany)).toContain('at most')
  })

  it('parses through the zod schema', () => {
    expect(CustomHeadersSchema.parse({ 'X-A': '1' })).toEqual({ 'X-A': '1' })
    expect(() => CustomHeadersSchema.parse({ 'X-A': '1', 'x-a': '2' })).toThrow()
  })
})
