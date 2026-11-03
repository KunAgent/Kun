import { test } from 'node:test'
import assert from 'node:assert/strict'
import { FEATHER_TARGET_HUES, mapFeatherPixels } from './kun-avatar-feather-mapping.mjs'

test('candidate recoloring changes feather fill while preserving alpha, ink, ivory and blush exactly', () => {
  const source = Buffer.from([149, 203, 246, 255, 14, 47, 102, 255, 255, 239, 215, 180,
    255, 138, 122, 255, 149, 203, 246, 0])
  for (const hue of Object.values(FEATHER_TARGET_HUES)) {
    const result = mapFeatherPixels(source, hue, 206)
    assert.deepEqual(result.subarray(4), source.subarray(4))
    assert.equal(result[3], source[3])
    if (hue !== 206) assert.notDeepEqual(result.subarray(0, 3), source.subarray(0, 3))
  }
  assert.deepEqual(source.subarray(0, 4), Buffer.from([149, 203, 246, 255]))
})
