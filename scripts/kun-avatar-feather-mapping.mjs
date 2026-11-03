import sharp from 'sharp'

export const FEATHER_TARGET_HUES = { sky: 206, periwinkle: 236, teal: 188, mint: 152 }
export const FEATHER_ORIGINAL_HUES = { sky: 206, periwinkle: 222, teal: 179, mint: 174 }

function hsv(red, green, blue) {
  const maximum = Math.max(red, green, blue), minimum = Math.min(red, green, blue), difference = maximum - minimum
  const hue = !difference ? 0 : maximum === red ? (green - blue) / difference % 6 * 60
    : maximum === green ? ((blue - red) / difference + 2) * 60 : ((red - green) / difference + 4) * 60
  return [(hue + 360) % 360, maximum ? difference / maximum : 0, maximum]
}

function rgb(hue, saturation, value) {
  const chroma = value * saturation, second = chroma * (1 - Math.abs(hue / 60 % 2 - 1)), offset = value - chroma
  const channels = hue < 60 ? [chroma, second, 0] : hue < 120 ? [second, chroma, 0]
    : hue < 180 ? [0, chroma, second] : hue < 240 ? [0, second, chroma]
      : hue < 300 ? [second, 0, chroma] : [chroma, 0, second]
  return channels.map((channel) => Math.round((channel + offset) * 255))
}

/** Proposed F7 mapping: only bright chromatic feather fill changes; alpha and navy/ivory ink remain exact. */
export function mapFeatherPixels(input, targetHue, sourceHue) {
  const output = Buffer.from(input)
  for (let index = 0; index < output.length; index += 4) {
    const [hue, saturation, value] = hsv(...[input[index], input[index + 1], input[index + 2]].map((channel) => channel / 255))
    if (!input[index + 3] || hue < 150 || hue > 250 || saturation <= 0.15 || value <= 0.5) continue
    const color = rgb((hue + targetHue - sourceHue + 360) % 360, saturation, value)
    output[index] = color[0]; output[index + 1] = color[1]; output[index + 2] = color[2]
  }
  return output
}

export async function mapFeatherImage(input, targetHue, sourceHue = FEATHER_ORIGINAL_HUES.sky) {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
  return sharp(mapFeatherPixels(data, targetHue, sourceHue), { raw: info }).png().toBuffer()
}
