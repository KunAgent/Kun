import sharp from 'sharp'

export const AVATAR_FACEBOX_CANDIDATES = {
  current: [232, 300, 792, 860], A: [232, 252, 792, 812], B: [200, 236, 824, 860]
}
const linear = Array.from({ length: 256 }, (_, value) => {
  const channel = value / 255
  return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
})
export const luminance = (r, g, b) => 0.2126 * linear[r] + 0.7152 * linear[g] + 0.0722 * linear[b]
const median = (values) => {
  if (!values.length) return null
  values.sort((a, b) => a - b)
  const half = Math.floor(values.length / 2)
  return values.length % 2 ? values[half] : (values[half - 1] + values[half]) / 2
}
export async function readAvatarPixels(file, size) {
  let image = sharp(file)
  if (size) image = image.resize(size, size)
  const { data, info } = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return { data, width: info.width, height: info.height }
}
export function alphaMask(image, threshold = 96) {
  const mask = new Uint8Array(image.width * image.height)
  for (let i = 0; i < mask.length; i++) mask[i] = +(image.data[i * 4 + 3] >= threshold)
  return mask
}
export function silhouetteIou(left, right) {
  if (left.length !== right.length) throw new Error('Silhouette masks must have equal dimensions')
  let intersection = 0, union = 0
  for (let i = 0; i < left.length; i++) {
    if (left[i] || right[i]) union++
    if (left[i] && right[i]) intersection++
  }
  return union ? intersection / union : null
}
export function lowContrastRatio(image, hex) {
  const rgb = hex.replace('#', '').match(/../g).map((value) => parseInt(value, 16))
  const background = luminance(...rgb)
  let opaque = 0, low = 0
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 200) continue
    opaque++
    const pixel = luminance(...image.data.subarray(i, i + 3))
    if ((Math.max(pixel, background) + 0.05) / (Math.min(pixel, background) + 0.05) < 1.5) low++
  }
  return { ratio: opaque ? low / opaque : null, lowPixels: low, opaquePixels: opaque }
}
/** The section 0 row-run proxy is preserved independently of the F6 distance measurement. */
export function darkEdgeRowWidth({ data, width, height }) {
  const runs = []
  for (let y = 0; y < height; y++) {
    let x = 0
    while (x < width && data[(y * width + x) * 4 + 3] < 200) x++
    if (x === width) continue
    let run = 0
    while (x < width) {
      const i = (y * width + x) * 4
      if (data[i + 3] < 200 || luminance(data[i], data[i + 1], data[i + 2]) >= 0.03) break
      run++; x++
    }
    runs.push(run)
  }
  return { median: median(runs), rows: runs.length }
}
/** Adjacent horizontal/vertical pairs are counted once, only when both pixels are opaque.
 * Transparent RGB is undefined and must not create fake detail at the alpha boundary.
 * Section 0 does not specify the opacity cutoff; all detail/color metrics use alpha >=200.
 */
export function detailDensity(image, box = [0, 0, image.width, image.height]) {
  const [left, top, right, bottom] = box
  let opaque = 0, difference = 0, totalLuminance = 0
  const value = (x, y) => {
    const i = (y * image.width + x) * 4
    return image.data[i + 3] < 200 ? null : luminance(image.data[i], image.data[i + 1], image.data[i + 2])
  }
  for (let y = top; y < bottom; y++) for (let x = left; x < right; x++) {
    const current = value(x, y)
    if (current === null) continue
    opaque++; totalLuminance += current
    if (x + 1 < right) { const next = value(x + 1, y); if (next !== null) difference += Math.abs(next - current) }
    if (y + 1 < bottom) { const next = value(x, y + 1); if (next !== null) difference += Math.abs(next - current) }
  }
  return { density: opaque ? difference / opaque : null, opaquePixels: opaque,
    meanLuminance: opaque ? totalLuminance / opaque : null }
}
export function quantizedColorCount({ data }) {
  const colors = new Set()
  for (let i = 0; i < data.length; i += 4) if (data[i + 3] >= 200) {
    colors.add((data[i] >> 5) * 64 + (data[i + 1] >> 5) * 8 + (data[i + 2] >> 5))
  }
  return colors.size
}
export function cropCoverage(image, box, threshold = 16) {
  let visible = 0, inside = 0
  for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] < threshold) continue
    visible++
    if (x >= box[0] && x < box[2] && y >= box[1] && y < box[3]) inside++
  }
  return { ratio: visible ? inside / visible : null, insidePixels: inside, visiblePixels: visible }
}
export function effectCoverage(image, box) {
  const coverage = cropCoverage(image, box, 65)
  const anyAlpha = cropCoverage(image, box, 1)
  let maximumAlpha = 0
  for (let i = 3; i < image.data.length; i += 4) maximumAlpha = Math.max(maximumAlpha, image.data[i])
  return { ...coverage, faceBoxAnyAlphaPixels: anyAlpha.insidePixels,
    canvasRatio: coverage.visiblePixels / (image.width * image.height), maximumAlpha: maximumAlpha / 255 }
}
export function rasterDifference(left, right, threshold = 24) {
  if (left.width !== right.width || left.height !== right.height) throw new Error('Raster dimensions must match')
  let changed = 0
  for (let i = 0; i < left.data.length; i += 4) {
    // Invisible RGB has no display meaning; premultiply each channel before comparison.
    const difference = [0, 1, 2].some((channel) => Math.abs(
      left.data[i + channel] * left.data[i + 3] / 255 - right.data[i + channel] * right.data[i + 3] / 255) > threshold)
    if (difference || Math.abs(left.data[i + 3] - right.data[i + 3]) > threshold) changed++
  }
  return { changedPixels: changed, totalPixels: left.width * left.height, ratio: changed / (left.width * left.height), threshold }
}
export function eyebrowPixels(image, boundary = 457) {
  let count = 0, top = null
  for (let y = 0; y < Math.min(boundary, image.height); y++) for (let x = 0; x < image.width; x++) {
    if (image.data[(y * image.width + x) * 4 + 3] >= 64) { count++; top ??= y }
  }
  return { count, top }
}
export function hueOf(r, g, b) {
  r /= 255; g /= 255; b /= 255
  const maximum = Math.max(r, g, b), minimum = Math.min(r, g, b), delta = maximum - minimum
  const hue = delta === 0 ? 0 : maximum === r ? (g - b) / delta : maximum === g ? (b - r) / delta + 2 : (r - g) / delta + 4
  return { hue: (hue * 60 + 360) % 360, saturation: maximum ? delta / maximum : 0, value: maximum }
}
/** Median hue in the feather fill; excludes ink, white belly, cheek and orange beak. */
export function featherHue(image) {
  const hues = []
  for (let i = 0; i < image.data.length; i += 4) {
    if (image.data[i + 3] < 200) continue
    const color = hueOf(...image.data.subarray(i, i + 3))
    if (color.hue >= 120 && color.hue <= 270 && color.saturation >= 0.2 && color.value >= 0.55) hues.push(color.hue)
  }
  return { hue: median(hues), sampledPixels: hues.length }
}

/** Exact squared Euclidean distance transform, lower envelope of parabolas (two passes). */
export function distanceTransform(mask, width, height) {
  const length = Math.max(width, height), f = new Float64Array(length), d = new Float64Array(length)
  const v = new Int32Array(length), z = new Float64Array(length + 1), result = new Float64Array(mask.length)
  const transform = (n) => {
    let k = 0; v[0] = 0; z[0] = -Infinity; z[1] = Infinity
    for (let q = 1; q < n; q++) {
      let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k])
      while (s <= z[k]) { k--; s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]) }
      k++; v[k] = q; z[k] = s; z[k + 1] = Infinity
    }
    k = 0
    for (let q = 0; q < n; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]] }
  }
  const infinity = width * width + height * height + 1
  for (let x = 0; x < width; x++) {
    for (let y = 0; y < height; y++) f[y] = mask[y * width + x] ? infinity : 0
    transform(height)
    for (let y = 0; y < height; y++) result[y * width + x] = d[y]
  }
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) f[x] = result[y * width + x]
    transform(width)
    for (let x = 0; x < width; x++) result[y * width + x] = Math.sqrt(d[x])
  }
  return result
}

/** Exterior-contour thickness: exact Euclidean distance from an opaque dark contour
 * pixel to the nearest opaque non-dark fill pixel. Sampling the exterior contour,
 * not every connected dark/fill interface, avoids counting connected interior seams.
 * Luminance<0.03 matches section 0's ink classifier; prescribed #0e2f66 is 0.030857,
 * so the classifier cannot certify every navy-colored outline. Report the raw
 * diagnostic and its limitations, never substitute the row-run measurement.
 */
export function outlineDistanceWidth(image) {
  const { width, height, data } = image, opaque = alphaMask(image, 200)
  const notFill = new Uint8Array(opaque.length)
  let fillPixels = 0
  for (let i = 0; i < notFill.length; i++) {
    notFill[i] = +(!opaque[i] || luminance(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]) < 0.03)
    if (!notFill[i]) fillPixels++
  }
  if (!fillPixels) return { median: null, samples: 0, p10: null, p90: null }
  const distances = distanceTransform(notFill, width, height), samples = []
  for (let y = 1; y < height - 1; y++) for (let x = 1; x < width - 1; x++) {
    const i = y * width + x
    if (opaque[i] && notFill[i] && [i - 1, i + 1, i - width, i + width].some((next) => !opaque[next])) {
      samples.push(distances[i])
    }
  }
  const measured = median(samples)
  return { median: measured, samples: samples.length,
    p10: samples.length ? samples[Math.floor((samples.length - 1) * 0.1)] : null,
    p90: samples.length ? samples[Math.floor((samples.length - 1) * 0.9)] : null }
}
