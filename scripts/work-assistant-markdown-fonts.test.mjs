import assert from 'node:assert/strict'
import test from 'node:test'
import { countWorkAssistantCjkGlyphs } from './work-assistant-markdown-fonts.mjs'

const platformFont = (patch = {}) => ({ familyName: 'PingFang SC', postScriptName: 'PingFangSC-Regular',
  isCustomFont: false, glyphCount: 16, ...patch })

test('recognizes the observed localized macOS family by verified PostScript identity', () => {
  const observed = platformFont({ familyName: '\u860b\u65b9-\u7c21' })
  assert.equal(countWorkAssistantCjkGlyphs([observed]), 16)
  assert.ok(countWorkAssistantCjkGlyphs([observed]) >= 13, 'all 13 observed Han characters need real CJK glyphs')
})

test('retains established platform CJK family matching', () => {
  for (const familyName of ['Noto Sans CJK SC', 'Noto Serif CJK JP', 'Noto Sans Mono CJK TC',
    'PingFang SC', 'Hiragino Sans GB', 'Hiragino Kaku Gothic ProN']) {
    assert.equal(countWorkAssistantCjkGlyphs([platformFont({ familyName, postScriptName: '' })]), 16, familyName)
  }
})

test('rejects unknown, tofu and near-match PostScript identities', () => {
  for (const font of [
    platformFont({ familyName: 'LastResort', postScriptName: 'LastResort' }),
    platformFont({ familyName: 'Unknown', postScriptName: '' }),
    platformFont({ familyName: '\u860b\u65b9-\u7c21', postScriptName: 'Unverified-Regular' }),
    platformFont({ familyName: 'Unknown', postScriptName: 'FakePingFangSC-Regular' }),
    platformFont({ familyName: 'Unknown', postScriptName: 'PingFangSC-Regular-Fake' })
  ]) assert.equal(countWorkAssistantCjkGlyphs([font]), 0)
})

test('requires a positive integer glyph count from a platform font', () => {
  for (const glyphCount of [0, -1, 1.5, NaN, Infinity, undefined, '16']) {
    assert.equal(countWorkAssistantCjkGlyphs([platformFont({ glyphCount })]), 0)
  }
  assert.equal(countWorkAssistantCjkGlyphs([platformFont({ isCustomFont: true })]), 0)
  assert.equal(countWorkAssistantCjkGlyphs([platformFont({ isCustomFont: undefined })]), 0)
  assert.equal(countWorkAssistantCjkGlyphs([]), 0)
})

test('counts only recognized glyphs and cannot pad coverage with unrelated fonts', () => {
  assert.equal(countWorkAssistantCjkGlyphs([
    platformFont({ glyphCount: 5 }),
    platformFont({ familyName: 'Noto Sans CJK SC', postScriptName: '', glyphCount: 8 }),
    platformFont({ familyName: 'Arial', postScriptName: 'ArialMT', glyphCount: 1000 })
  ]), 13)
})
