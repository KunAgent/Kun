import { test } from 'node:test'
import assert from 'node:assert/strict'
import { alphaMask, cropCoverage, darkEdgeRowWidth, detailDensity, distanceTransform,
  effectCoverage, eyebrowPixels, featherHue, lowContrastRatio, outlineDistanceWidth,
  quantizedColorCount, rasterDifference, silhouetteIou } from './kun-avatar-art-metrics.mjs'

function pixels(width, height, sample) {
  const data = Buffer.alloc(width * height * 4)
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    data.set(sample(x, y), (y * width + x) * 4)
  }
  return { data, width, height }
}

test('low contrast uses WCAG linear luminance and alpha >=200 denominator', () => {
  const image = pixels(4, 1, (x) => [[74, 74, 74, 255], [255, 255, 255, 200],
    [74, 74, 74, 199], [0, 0, 0, 255]][x])
  assert.deepEqual(lowContrastRatio(image, '#4a4a4a'), { ratio: 1 / 3, lowPixels: 1, opaquePixels: 3 })
})

test('silhouette binary cutoff is inclusive and empty silhouettes do not receive an invented score', () => {
  const mask = alphaMask(pixels(3, 1, (x) => [0, 0, 0, [95, 96, 255][x]]))
  assert.deepEqual([...mask], [0, 1, 1])
  assert.equal(silhouetteIou(mask, Uint8Array.from([1, 1, 0])), 1 / 3)
  assert.equal(silhouetteIou(new Uint8Array(2), new Uint8Array(2)), null)
  assert.throws(() => silhouetteIou(mask, new Uint8Array(2)), /equal dimensions/)
})

test('detail counts each opaque neighboring pair once and ignores transparent RGB noise', () => {
  const image = pixels(2, 2, (x) => x ? [255, 255, 255, 255] : [0, 0, 0, 255])
  assert.equal(detailDensity(image).density, 0.5)
  assert.equal(detailDensity(image, [1, 0, 2, 2]).density, 0)
  const noisy = pixels(2, 1, (x) => x ? [255, 0, 255, 0] : [0, 0, 0, 255])
  assert.equal(detailDensity(noisy).density, 0)
})

test('colors use floor-by-32 channel bins and exclude translucent pixels', () => {
  const image = pixels(4, 1, (x) => [[0, 0, 0, 255], [31, 31, 31, 255],
    [32, 0, 0, 200], [255, 255, 255, 199]][x])
  assert.equal(quantizedColorCount(image), 2)
})

test('row-run starts at first opaque pixel and stops at a gap or bright fill', () => {
  const image = pixels(9, 3, (x, y) => {
    if (x < 1 || x > 7 || y === 2) return [0, 0, 0, 0]
    return x <= (y === 0 ? 2 : 4) ? [0, 0, 0, 255] : [255, 255, 255, 255]
  })
  assert.deepEqual(darkEdgeRowWidth(image), { median: 3, rows: 2 })
})

test('crop is half-open, includes alpha 16, and divides by all visible item pixels', () => {
  const image = pixels(4, 1, (x) => [0, 0, 0, [15, 16, 255, 255][x]])
  assert.deepEqual(cropCoverage(image, [1, 0, 3, 1]), { ratio: 2 / 3, insidePixels: 2, visiblePixels: 3 })
})

test('FX uses alpha>64 while eyebrows use alpha>=64 and y<457', () => {
  const image = pixels(2, 458, (x, y) => [255, 255, 255, y === 456 ? 64 + x : y === 457 ? 255 : 0])
  const fx = effectCoverage(image, [0, 456, 1, 457])
  assert.equal(fx.visiblePixels, 3)
  assert.equal(fx.insidePixels, 0)
  assert.equal(fx.faceBoxAnyAlphaPixels, 1)
  assert.equal(fx.maximumAlpha, 1)
  assert.deepEqual(eyebrowPixels(image), { count: 2, top: 456 })
})

test('raster differences ignore invisible RGB and retain the stated visible threshold', () => {
  const left = pixels(3, 1, (x) => [[255, 0, 0, 0], [40, 40, 40, 255], [40, 40, 40, 255]][x])
  const right = pixels(3, 1, (x) => [[0, 255, 0, 0], [64, 40, 40, 255], [65, 40, 40, 255]][x])
  assert.equal(rasterDifference(left, right, 24).ratio, 1 / 3)
  assert.equal(rasterDifference(left, right, 0).ratio, 2 / 3)
})

test('distance transform retains Euclidean diagonal distances', () => {
  const mask = Uint8Array.from([0, 1, 1, 1, 1, 1, 1, 1, 1])
  const result = distanceTransform(mask, 3, 3)
  assert.equal(result[4], Math.sqrt(2))
  assert.equal(result[8], Math.sqrt(8))
})

test('outline distance samples outer contour rather than connected interior seams', () => {
  const shape = (seam) => pixels(80, 80, (x, y) => {
    if (x < 5 || x >= 75 || y < 5 || y >= 75) return [0, 0, 0, 0]
    const ink = x < 9 || x >= 71 || y < 9 || y >= 71 || seam && x >= 38 && x <= 41
    return ink ? [0, 0, 0, 255] : [200, 200, 200, 255]
  })
  assert.equal(outlineDistanceWidth(shape(false)).median, 4)
  assert.equal(outlineDistanceWidth(shape(true)).median, 4)
  assert.equal(outlineDistanceWidth(pixels(10, 10, () => [0, 0, 0, 255])).median, null)
})

test('feather hue ignores navy ink, white belly and orange beak', () => {
  const image = pixels(4, 1, (x) => [[149, 203, 246, 255], [14, 47, 102, 255],
    [255, 255, 255, 255], [250, 146, 23, 255]][x])
  const result = featherHue(image)
  assert.equal(result.sampledPixels, 1)
  assert.ok(result.hue > 206 && result.hue < 207)
})
