import { describe, expect, it } from 'vitest'
import { resolveComposerPrimaryActionKind } from './floating-composer-policy'

function resolve(overrides: Partial<Parameters<typeof resolveComposerPrimaryActionKind>[0]> = {}) {
  return resolveComposerPrimaryActionKind({
    busy: true,
    input: '',
    attachmentUploadEnabled: true,
    attachmentCount: 0,
    fileReferenceEnabled: true,
    fileReferenceCount: 0,
    ...overrides
  })
}

describe('resolveComposerPrimaryActionKind', () => {
  it('keeps the interrupt action while a running composer has no draft', () => {
    expect(resolve()).toBe('interrupt')
    expect(resolve({ input: '   \n  ' })).toBe('interrupt')
  })

  it('replaces interrupt with submit while a running composer has text', () => {
    expect(resolve({ input: 'Follow up after this reply' })).toBe('submit')
  })

  it('treats enabled attachments and file references as submit payloads', () => {
    expect(resolve({ attachmentCount: 1 })).toBe('submit')
    expect(resolve({ fileReferenceCount: 1 })).toBe('submit')
    expect(resolve({ attachmentUploadEnabled: false, attachmentCount: 1 })).toBe('interrupt')
    expect(resolve({ fileReferenceEnabled: false, fileReferenceCount: 1 })).toBe('interrupt')
  })

  it('always presents the normal submit action while idle', () => {
    expect(resolve({ busy: false })).toBe('submit')
    expect(resolve({ busy: false, input: 'Ready' })).toBe('submit')
  })
})
