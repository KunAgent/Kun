import { describe, expect, it } from 'vitest'
import { resolveAskKey } from './ask-keys'
import { barPlacement } from './edit-bar-placement'
const event = { key: 'Enter', metaKey: false, ctrlKey: false }
describe('selection keyboard', () => {
  it('handles platform modifiers, composition, whitespace and two-stage Escape', () => {
    expect(resolveAskKey(event, 'edit', true)).toBe('edit')
    expect(resolveAskKey({ ...event, metaKey: true }, 'chat', true)).toBe('chat')
    expect(resolveAskKey({ ...event, ctrlKey: true }, 'chat', false)).toBe('chat')
    expect(resolveAskKey({ ...event, metaKey: true }, 'edit', false)).toBe('edit')
    expect(resolveAskKey({ ...event, isComposing: true }, 'word', true)).toBeNull()
    expect(resolveAskKey({ ...event, keyCode: 229 }, 'word', true)).toBeNull()
    expect(resolveAskKey(event, ' ', true)).toBeNull()
    expect(resolveAskKey({ ...event, key: 'Escape' }, 'word', true)).toBe('clear')
    expect(resolveAskKey({ ...event, key: 'Escape' }, '', true)).toBe('blur')
  })
})
describe('edit bar positioning', () => {
  const anchor = { left: 200, right: 600, top: 300, bottom: 350, width: 400, height: 50 }
  const options = { width: 560, height: 88, viewportWidth: 1000, viewportHeight: 800, scale: 1 }
  it('places below, flips above and remains visible when the revision scrolls away', () => {
    expect(barPlacement(anchor, options)).toEqual({ left: 200, top: 360, width: 560 })
    expect(barPlacement({ ...anchor, top: 700, bottom: 780 }, options).top).toBe(602)
    expect(barPlacement({ ...anchor, top: -300, bottom: -200 }, options).top).toBe(696)
  })
  it('uses editor bounds and body zoom consistently', () => {
    expect(barPlacement({ ...anchor, left: 164, top: 246, bottom: 287 }, { ...options, scale: .82,
      viewportWidth: 820, viewportHeight: 656, bounds: { left: 82, right: 574, top: 0, bottom: 656 } })).toEqual({ left: 124, top: 360, width: 560 })
    expect(barPlacement(anchor, { ...options, viewportWidth: 300 }).width).toBe(268)
  })
})
