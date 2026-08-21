import sharp from 'sharp'

function isConnectedBackgroundPixel(data, offset) {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  const darkest = Math.min(red, green, blue)
  const lightest = Math.max(red, green, blue)

  return darkest >= 210 && lightest - darkest <= 45
}

export async function createInstallerCharacterCutout(characterPath) {
  const { data, info } = await sharp(characterPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })
  const pixelCount = info.width * info.height
  const connectedBackground = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const enqueue = (pixel) => {
    if (connectedBackground[pixel]) return
    const offset = pixel * info.channels
    if (!isConnectedBackgroundPixel(data, offset)) return
    connectedBackground[pixel] = 1
    queue[queueEnd] = pixel
    queueEnd += 1
  }

  for (let x = 0; x < info.width; x += 1) {
    enqueue(x)
    enqueue((info.height - 1) * info.width + x)
  }
  for (let y = 0; y < info.height; y += 1) {
    enqueue(y * info.width)
    enqueue(y * info.width + info.width - 1)
  }

  while (queueStart < queueEnd) {
    const pixel = queue[queueStart]
    queueStart += 1
    const x = pixel % info.width
    const y = Math.floor(pixel / info.width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < info.width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - info.width)
    if (y + 1 < info.height) enqueue(pixel + info.width)
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (connectedBackground[pixel]) data[pixel * info.channels + 3] = 0
  }

  return sharp(data, {
    raw: {
      width: info.width,
      height: info.height,
      channels: info.channels
    }
  })
    .png()
    .toBuffer()
}
