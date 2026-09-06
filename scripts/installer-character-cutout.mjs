import sharp from 'sharp'

const WHITE_MIN_CHANNEL = 210
const WHITE_MAX_CHROMA = 45
const HALO_MAX_THICKNESS = 5
const HALO_MAX_BACKGROUND_DISTANCE = 12
const CANVAS_MIN_LUMA = 249
const CANVAS_MAX_LUMA_STD = 3.5
const MASK_CONTRACT_PIXELS = 2
const SOLID_NEIGHBOR_COUNT = 6
const NEIGHBOR_OFFSETS = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1]
]

function isWhiteBackgroundPixel(data, offset) {
  const red = data[offset]
  const green = data[offset + 1]
  const blue = data[offset + 2]
  const darkest = Math.min(red, green, blue)
  const lightest = Math.max(red, green, blue)

  return darkest >= WHITE_MIN_CHANNEL && lightest - darkest <= WHITE_MAX_CHROMA
}

function floodFillConnectedBackground(data, width, height, channels) {
  const pixelCount = width * height
  const connectedBackground = new Uint8Array(pixelCount)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  const enqueue = (pixel) => {
    if (connectedBackground[pixel]) return
    if (!isWhiteBackgroundPixel(data, pixel * channels)) return
    connectedBackground[pixel] = 1
    queue[queueEnd] = pixel
    queueEnd += 1
  }

  for (let x = 0; x < width; x += 1) {
    enqueue(x)
    enqueue((height - 1) * width + x)
  }
  for (let y = 0; y < height; y += 1) {
    enqueue(y * width)
    enqueue(y * width + width - 1)
  }

  while (queueStart < queueEnd) {
    const pixel = queue[queueStart]
    queueStart += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    if (x > 0) enqueue(pixel - 1)
    if (x + 1 < width) enqueue(pixel + 1)
    if (y > 0) enqueue(pixel - width)
    if (y + 1 < height) enqueue(pixel + width)
  }

  return connectedBackground
}

function computeChebyshevDistance(width, height, sources) {
  const pixelCount = width * height
  const distance = new Int32Array(pixelCount)
  distance.fill(1_000_000)
  const queue = new Int32Array(pixelCount)
  let queueStart = 0
  let queueEnd = 0

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!sources[pixel]) continue
    distance[pixel] = 0
    queue[queueEnd] = pixel
    queueEnd += 1
  }

  while (queueStart < queueEnd) {
    const pixel = queue[queueStart]
    queueStart += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const nextDistance = distance[pixel] + 1

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighbor = ny * width + nx
      if (nextDistance >= distance[neighbor]) continue
      distance[neighbor] = nextDistance
      queue[queueEnd] = neighbor
      queueEnd += 1
    }
  }

  return distance
}

function collectWhiteComponents(data, width, height, channels, connectedBackground) {
  const pixelCount = width * height
  const seen = new Uint8Array(pixelCount)
  const components = []

  for (let start = 0; start < pixelCount; start += 1) {
    if (seen[start] || connectedBackground[start]) continue
    if (!isWhiteBackgroundPixel(data, start * channels)) continue

    const members = []
    const queue = [start]
    seen[start] = 1

    const enqueueWhite = (pixel) => {
      if (seen[pixel] || connectedBackground[pixel]) return
      if (!isWhiteBackgroundPixel(data, pixel * channels)) return
      seen[pixel] = 1
      queue.push(pixel)
    }

    while (queue.length > 0) {
      const pixel = queue.pop()
      members.push(pixel)
      const x = pixel % width
      const y = Math.floor(pixel / width)
      if (x > 0) enqueueWhite(pixel - 1)
      if (x + 1 < width) enqueueWhite(pixel + 1)
      if (y > 0) enqueueWhite(pixel - width)
      if (y + 1 < height) enqueueWhite(pixel + width)
    }

    components.push(members)
  }

  return components
}

function measureComponentThickness(members, width, height) {
  const inComponent = new Uint8Array(width * height)
  for (const pixel of members) inComponent[pixel] = 1

  const queue = new Int32Array(members.length)
  const distance = new Int16Array(width * height)
  let queueStart = 0
  let queueEnd = 0
  let maxThickness = 1

  for (const pixel of members) {
    const x = pixel % width
    const y = Math.floor(pixel / width)
    let onBorder = x === 0 || y === 0 || x === width - 1 || y === height - 1
    if (!onBorder) {
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        if (!inComponent[(y + dy) * width + (x + dx)]) {
          onBorder = true
          break
        }
      }
    }
    if (!onBorder) continue
    distance[pixel] = 1
    queue[queueEnd] = pixel
    queueEnd += 1
  }

  while (queueStart < queueEnd) {
    const pixel = queue[queueStart]
    queueStart += 1
    const x = pixel % width
    const y = Math.floor(pixel / width)
    const nextDistance = distance[pixel] + 1

    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
      const neighbor = ny * width + nx
      if (!inComponent[neighbor] || distance[neighbor] !== 0) continue
      distance[neighbor] = nextDistance
      if (nextDistance > maxThickness) maxThickness = nextDistance
      queue[queueEnd] = neighbor
      queueEnd += 1
    }
  }

  return maxThickness
}

function measureLumaStats(members, data, channels) {
  let sum = 0
  let sumSquares = 0
  for (const pixel of members) {
    const offset = pixel * channels
    const luma = (data[offset] + data[offset + 1] + data[offset + 2]) / 3
    sum += luma
    sumSquares += luma * luma
  }

  const mean = sum / members.length
  const variance = sumSquares / members.length - mean * mean
  return {
    mean,
    std: Math.sqrt(Math.max(0, variance))
  }
}

function isResidualWhiteRegion(members, data, channels, minBackgroundDistance, thickness) {
  const luma = measureLumaStats(members, data, channels)
  const leftoverCanvas = luma.mean >= CANVAS_MIN_LUMA && luma.std <= CANVAS_MAX_LUMA_STD
  const thinHalo =
    thickness <= HALO_MAX_THICKNESS && minBackgroundDistance <= HALO_MAX_BACKGROUND_DISTANCE
  return leftoverCanvas || thinHalo
}

function removeResidualWhiteRegions(data, width, height, channels, connectedBackground) {
  const backgroundDistance = computeChebyshevDistance(width, height, connectedBackground)

  for (const members of collectWhiteComponents(
    data,
    width,
    height,
    channels,
    connectedBackground
  )) {
    let minBackgroundDistance = 1_000_000
    for (const pixel of members) {
      if (backgroundDistance[pixel] < minBackgroundDistance) {
        minBackgroundDistance = backgroundDistance[pixel]
      }
    }

    const thickness = measureComponentThickness(members, width, height)
    if (!isResidualWhiteRegion(members, data, channels, minBackgroundDistance, thickness)) {
      continue
    }

    for (const pixel of members) data[pixel * channels + 3] = 0
  }
}

function countOpaqueNeighbors(opaque, width, height, pixel) {
  const x = pixel % width
  const y = Math.floor(pixel / width)
  let count = 0
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    if (opaque[ny * width + nx]) count += 1
  }
  return count
}

function contractOpaqueMask(data, width, height, channels, pixels) {
  const pixelCount = width * height
  const opaque = new Uint8Array(pixelCount)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    opaque[pixel] = data[pixel * channels + 3] > 0 ? 1 : 0
  }

  for (let pass = 0; pass < pixels; pass += 1) {
    const remove = []
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      if (!opaque[pixel]) continue
      const x = pixel % width
      const y = Math.floor(pixel / width)
      let onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1
      if (!onEdge) {
        for (const [dx, dy] of NEIGHBOR_OFFSETS) {
          if (!opaque[(y + dy) * width + (x + dx)]) {
            onEdge = true
            break
          }
        }
      }
      if (onEdge) remove.push(pixel)
    }
    for (const pixel of remove) {
      data[pixel * channels + 3] = 0
      opaque[pixel] = 0
    }
  }
}

function removeDetachedOutline(data, width, height, channels) {
  const pixelCount = width * height
  const opaque = new Uint8Array(pixelCount)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    opaque[pixel] = data[pixel * channels + 3] > 0 ? 1 : 0
  }

  const solid = new Uint8Array(pixelCount)
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!opaque[pixel]) continue
    if (countOpaqueNeighbors(opaque, width, height, pixel) >= SOLID_NEIGHBOR_COUNT) {
      solid[pixel] = 1
    }
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!opaque[pixel] || solid[pixel]) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    let hasSolidBacking = false
    let hasTransparentNeighbor = false
    for (const [dx, dy] of NEIGHBOR_OFFSETS) {
      const nx = x + dx
      const ny = y + dy
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) {
        hasTransparentNeighbor = true
        continue
      }
      const neighbor = ny * width + nx
      if (solid[neighbor]) hasSolidBacking = true
      if (!opaque[neighbor]) hasTransparentNeighbor = true
    }
    if (hasSolidBacking || !hasTransparentNeighbor) continue
    data[pixel * channels + 3] = 0
  }
}

function averageSolidNeighborColor(data, solid, width, height, channels, pixel) {
  const x = pixel % width
  const y = Math.floor(pixel / width)
  let red = 0
  let green = 0
  let blue = 0
  let count = 0

  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue
    const neighbor = ny * width + nx
    if (!solid[neighbor]) continue
    const offset = neighbor * channels
    red += data[offset]
    green += data[offset + 1]
    blue += data[offset + 2]
    count += 1
  }

  if (count === 0) return null
  return {
    red: Math.round(red / count),
    green: Math.round(green / count),
    blue: Math.round(blue / count)
  }
}

function defringeWhiteMatte(data, width, height, channels) {
  const pixelCount = width * height
  const opaque = new Uint8Array(pixelCount)
  const solid = new Uint8Array(pixelCount)

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    opaque[pixel] = data[pixel * channels + 3] > 0 ? 1 : 0
  }
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!opaque[pixel]) continue
    if (countOpaqueNeighbors(opaque, width, height, pixel) >= SOLID_NEIGHBOR_COUNT) {
      solid[pixel] = 1
    }
  }

  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if (!opaque[pixel]) continue
    const x = pixel % width
    const y = Math.floor(pixel / width)
    let onEdge = x === 0 || y === 0 || x === width - 1 || y === height - 1
    if (!onEdge) {
      for (const [dx, dy] of NEIGHBOR_OFFSETS) {
        if (!opaque[(y + dy) * width + (x + dx)]) {
          onEdge = true
          break
        }
      }
    }
    if (!onEdge) continue

    const interior = averageSolidNeighborColor(data, solid, width, height, channels, pixel)
    if (!interior) continue

    const offset = pixel * channels
    data[offset] = interior.red
    data[offset + 1] = interior.green
    data[offset + 2] = interior.blue
  }
}

export async function createInstallerCharacterCutout(characterPath) {
  const { data, info } = await sharp(characterPath)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true })

  const connectedBackground = floodFillConnectedBackground(
    data,
    info.width,
    info.height,
    info.channels
  )
  for (let pixel = 0; pixel < connectedBackground.length; pixel += 1) {
    if (connectedBackground[pixel]) data[pixel * info.channels + 3] = 0
  }

  removeResidualWhiteRegions(data, info.width, info.height, info.channels, connectedBackground)
  removeDetachedOutline(data, info.width, info.height, info.channels)
  contractOpaqueMask(data, info.width, info.height, info.channels, MASK_CONTRACT_PIXELS)
  defringeWhiteMatte(data, info.width, info.height, info.channels)

  for (let pixel = 0; pixel < connectedBackground.length; pixel += 1) {
    const offset = pixel * info.channels
    if (data[offset + 3] > 0) continue
    data[offset] = 0
    data[offset + 1] = 0
    data[offset + 2] = 0
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
