import { describe, expect, it } from 'vitest'
import {
  GEN_UI_MODEL_CONTEXT_MAX_BYTES,
  GEN_UI_STATE_MAX_BYTES,
  GenUiRenderInputSchema,
  isGenUiWidgetId,
  parseGenUiWidgetState,
  selectGenUiModelContext
} from './gen-ui.js'

describe('gen-ui contracts', () => {
  it('requires exactly one of html or path', () => {
    expect(GenUiRenderInputSchema.safeParse({ title: 'Demo', html: '<p>x</p>' }).success).toBe(true)
    expect(GenUiRenderInputSchema.safeParse({ title: 'Demo', path: 'demo.html' }).success).toBe(true)
    expect(GenUiRenderInputSchema.safeParse({ title: 'Demo' }).success).toBe(false)
    expect(GenUiRenderInputSchema.safeParse({ title: 'Demo', html: 'a', path: 'b.html' }).success).toBe(false)
    expect(GenUiRenderInputSchema.safeParse({ title: 'Demo', html: 'a', extra: true }).success).toBe(false)
  })

  it('normalizes widget state snapshots and rejects non-JSON or oversized state', () => {
    expect(parseGenUiWidgetState({ modelContent: { count: 3 } })).toEqual({
      modelContent: { count: 3 },
      privateContent: null
    })
    expect(() => parseGenUiWidgetState({ modelContent: Number.NaN })).toThrow(/JSON/)
    expect(() => parseGenUiWidgetState({ other: 1 })).toThrow(/Unknown widget state field/)
    expect(() => parseGenUiWidgetState([])).toThrow(/object/)
    expect(() => parseGenUiWidgetState({ privateContent: 'x'.repeat(GEN_UI_STATE_MAX_BYTES) })).toThrow(/exceeds/)
  })

  it('selects model-visible state in stable order within the byte budget', () => {
    const selected = selectGenUiModelContext([
      { title: 'b', state: { modelContent: { v: 2 }, privateContent: null } },
      { title: 'a', state: { modelContent: { v: 1 }, privateContent: 'secret' } },
      { title: 'c', state: { modelContent: null, privateContent: { kept: true } } }
    ])
    expect(selected).toEqual([{ widget: 'a', state: { v: 1 } }, { widget: 'b', state: { v: 2 } }])
    const large = Array.from({ length: 10 }, (_, index) => ({
      title: `w${index}`,
      state: { modelContent: 'x'.repeat(GEN_UI_MODEL_CONTEXT_MAX_BYTES / 4), privateContent: null }
    }))
    expect(selectGenUiModelContext(large).length).toBeLessThan(4)
  })

  it('accepts only content-addressed widget ids', () => {
    expect(isGenUiWidgetId(`gw_${'a'.repeat(64)}`)).toBe(true)
    expect(isGenUiWidgetId('gw_../../etc')).toBe(false)
    expect(isGenUiWidgetId(`gw_${'A'.repeat(64)}`)).toBe(false)
  })
})
