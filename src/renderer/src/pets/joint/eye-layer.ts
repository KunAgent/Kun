import { clamp, skinPoint, type JointActor } from './geometry'

type CartoonEyeSpec = {
  box: [number, number, number, number]
  pupilX: number
  pupilY: number
  rx: number
  ry: number
  shiftX: number
  shiftY: number
  color: string
  catchlight?: boolean
}

type CartoonCellOverlay = {
  kind: 'cartoon'
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  scale: number
  mask: HTMLCanvasElement
  scratch: HTMLCanvasElement
  eyes: Array<{
    cx: number
    cy: number
    rx: number
    ry: number
    shiftX: number
    shiftY: number
    color: string
    sMinX: number
    sMaxX: number
    sMinY: number
    sMaxY: number
    catchlight?: boolean
  }>
}

type SapphireCellOverlay = {
  kind: 'sapphire'
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  scale: number
  mask: HTMLCanvasElement
  scratch: HTMLCanvasElement
  eyes: Array<{
    side: -1 | 1
    ix: number
    iy: number
    irx: number
    iry: number
    shiftX: number
    shiftY: number
  }>
}

type CatCellOverlay = {
  kind: 'cat'
  cropX: number
  cropY: number
  cropW: number
  cropH: number
  scale: number
  mask: HTMLCanvasElement
  scratch: HTMLCanvasElement
  eyes: Array<{
    ix: number
    iy: number
    prx: number
    pry: number
    shiftX: number
    shiftY: number
  }>
}

export type PetEyeCellOverlay = CartoonCellOverlay | SapphireCellOverlay | CatCellOverlay
export type PetEyeOverlaySet = Partial<Record<number, PetEyeCellOverlay>>

function makeCanvas(width: number, height: number): HTMLCanvasElement | null {
  if (typeof document === 'undefined') return null
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  return canvas
}

function petKind(petId: string): 'xiao-kun' | 'ikun' | 'whale-girl' | 'kurocat' | null {
  if (petId === 'xiao-kun' || petId.endsWith(':xiao-kun')) return 'xiao-kun'
  if (petId === 'ikun' || petId.endsWith(':ikun')) return 'ikun'
  if (petId === 'whale-girl' || petId.endsWith(':whale-girl')) return 'whale-girl'
  if (petId === 'kurocat' || petId.endsWith(':kurocat')) return 'kurocat'
  return null
}

export function buildEyeOverlays(
  petId: string,
  atlas: HTMLCanvasElement,
  rigRow: number
): PetEyeOverlaySet | undefined {
  const kind = petKind(petId)
  if (!kind) return undefined
  const ctx = atlas.getContext('2d')
  if (!ctx) return undefined
  const result: PetEyeOverlaySet = {}
  for (const col of [0, 5]) {
    const cell = kind === 'whale-girl'
      ? buildWhaleGirlCell(ctx, col)
      : kind === 'kurocat'
        ? buildKurocatCell(ctx, col)
        : buildCartoonCell(ctx, col, kind, rigRow)
    if (cell) result[col] = cell
  }
  return Object.keys(result).length ? result : undefined
}

function buildCartoonCell(
  atlasCtx: CanvasRenderingContext2D,
  col: number,
  kind: 'xiao-kun' | 'ikun',
  rigRow: number
): CartoonCellOverlay | null {
  const ikunSolo = kind === 'ikun' && rigRow === 0
  const cropX = kind === 'xiao-kun' ? 42 : ikunSolo ? 82 : 78
  const cropY = kind === 'xiao-kun' ? 86 : 32
  const cropW = kind === 'xiao-kun' ? 80 : ikunSolo ? 54 : 46
  const cropH = kind === 'xiao-kun' ? 34 : ikunSolo ? 80 : 72
  const scale = 3
  const mask = makeCanvas(cropW * scale, cropH * scale)
  const scratch = makeCanvas(cropW * scale, cropH * scale)
  if (!mask || !scratch) return null
  const mctx = mask.getContext('2d')
  if (!mctx) return null

  const image = atlasCtx.getImageData(col * 192 + cropX, cropY, cropW, cropH)
  const d = image.data
  const alphaMask = new Uint8ClampedArray(cropW * cropH * 4)

  const specs: CartoonEyeSpec[] = kind === 'xiao-kun'
    ? [
        { box: [45, 89, 79, 115], pupilX: 64.0, pupilY: 105.0, rx: 6.1, ry: 6.4, shiftX: 5.2, shiftY: 3.5, color: '#050d18' },
        { box: [82, 90, 117, 116], pupilX: 94.5, pupilY: 106.2, rx: 6.1, ry: 6.4, shiftX: 5.2, shiftY: 3.5, color: '#050d18' }
      ]
    : ikunSolo
      ? [
          { box: [86, 87, 109, 109], pupilX: 98.0, pupilY: 97.5, rx: 3.6, ry: 3.8, shiftX: 3.8, shiftY: 2.8, color: '#080c14' },
          { box: [109, 87, 134, 109], pupilX: 119.5, pupilY: 97.5, rx: 3.6, ry: 3.8, shiftX: 3.8, shiftY: 2.8, color: '#080c14' },
          { box: [94, 36, 101, 43], pupilX: 97.5, pupilY: 39.8, rx: 1.15, ry: 1.25, shiftX: 0.9, shiftY: 0.7, color: '#101218' },
          { box: [101, 35, 108, 42], pupilX: 104.2, pupilY: 38.0, rx: 1.15, ry: 1.25, shiftX: 0.9, shiftY: 0.7, color: '#101218' }
        ]
      : [
          { box: [83, 81, 98, 100], pupilX: 92.8, pupilY: 90.6, rx: 3.1, ry: 3.3, shiftX: 2.9, shiftY: 2.3, color: '#080c14' },
          { box: [98, 81, 120, 100], pupilX: 106.3, pupilY: 90.2, rx: 3.3, ry: 3.5, shiftX: 3.5, shiftY: 2.4, color: '#080c14' },
          { box: [89, 35, 95, 41], pupilX: 92.2, pupilY: 38.2, rx: 1.05, ry: 1.15, shiftX: 0.85, shiftY: 0.65, color: '#101218' },
          { box: [95, 35, 101, 41], pupilX: 97.6, pupilY: 38.0, rx: 1.05, ry: 1.15, shiftX: 0.85, shiftY: 0.65, color: '#101218' }
        ]

  const eyes: CartoonCellOverlay['eyes'] = []

  for (const spec of specs) {
    const [x0, y0, x1, y1] = spec.box
    let sMinX = x1, sMaxX = x0, sMinY = y1, sMaxY = y0, scleraCount = 0
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const lx = x - cropX, ly = y - cropY
        if (lx < 0 || lx >= cropW || ly < 0 || ly >= cropH) continue
        const i = (ly * cropW + lx) * 4
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
        if (a > 200 && Math.min(r, g, b) >= 195 && Math.max(r, g, b) - Math.min(r, g, b) <= 30) {
          sMinX = Math.min(sMinX, x); sMaxX = Math.max(sMaxX, x)
          sMinY = Math.min(sMinY, y); sMaxY = Math.max(sMaxY, y)
          scleraCount++
        }
      }
    }
    if (scleraCount < 4) continue

    let pxSum = 0, pySum = 0, pCount = 0
    const searchR = Math.max(spec.rx, spec.ry) + 2.2
    for (let y = Math.max(y0, sMinY); y <= Math.min(y1, sMaxY); y++) {
      for (let x = Math.max(x0, sMinX); x <= Math.min(x1, sMaxX); x++) {
        if (Math.hypot(x - spec.pupilX, y - spec.pupilY) > searchR) continue
        const lx = x - cropX, ly = y - cropY
        const i = (ly * cropW + lx) * 4
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
        if (a > 200 && Math.max(r, g, b) < 95 && r - b < 25) {
          pxSum += x; pySum += y; pCount++
        }
      }
    }
    const cx = pCount >= 2 ? pxSum / pCount : spec.pupilX
    const cy = pCount >= 2 ? pySum / pCount : spec.pupilY

    for (let y = sMinY; y <= sMaxY; y++) {
      for (let x = sMinX; x <= sMaxX; x++) {
        const lx = x - cropX, ly = y - cropY
        const i = (ly * cropW + lx) * 4
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
        if (a < 200) continue
        const warmBeakOrBlush = r - b > 36 && r > 155
        const blueBody = b - r > 22 && b > 95
        if (warmBeakOrBlush || blueBody) continue
        const minC = Math.min(r, g, b), spread = Math.max(r, g, b) - minC
        const deepInterior = kind === 'xiao-kun' && x >= sMinX + 4 && x <= sMaxX - 4 && y >= sMinY + 3 && y <= sMaxY - 3
        const inPupil = deepInterior || Math.hypot((x - cx) / (spec.rx + 2.4), (y - cy) / (spec.ry + 2.4)) <= 1
        if ((minC >= 184 && spread <= 32) || inPupil) {
          const edgeFade = minC >= 205 || inPupil ? 255 : Math.round(((minC - 180) / 25) * 255)
          alphaMask[i + 3] = Math.max(alphaMask[i + 3], clamp(edgeFade, 0, 255))
          alphaMask[i] = 255; alphaMask[i + 1] = 255; alphaMask[i + 2] = 255
        }
      }
    }

    eyes.push({
      cx: cx - cropX + 0.5,
      cy: cy - cropY + 0.5,
      rx: spec.rx,
      ry: spec.ry,
      shiftX: spec.shiftX,
      shiftY: spec.shiftY,
      color: spec.color,
      sMinX: sMinX - cropX,
      sMaxX: sMaxX - cropX + 1,
      sMinY: sMinY - cropY,
      sMaxY: sMaxY - cropY + 1,
      catchlight: spec.catchlight
    })
  }

  if (!eyes.length) return null
  const rawMask = makeCanvas(cropW, cropH)
  const rctx = rawMask?.getContext('2d')
  if (!rawMask || !rctx) return null
  rctx.putImageData(new ImageData(alphaMask, cropW, cropH), 0, 0)
  mctx.imageSmoothingEnabled = true
  mctx.drawImage(rawMask, 0, 0, cropW * scale, cropH * scale)

  return { kind: 'cartoon', cropX, cropY, cropW, cropH, scale, mask, scratch, eyes }
}

function buildWhaleGirlCell(atlasCtx: CanvasRenderingContext2D, col: number): SapphireCellOverlay | null {
  const cropX = 76, cropY = 88, cropW = 40, cropH = 16, scale = 4
  const mask = makeCanvas(cropW * scale, cropH * scale)
  const scratch = makeCanvas(cropW * scale, cropH * scale)
  if (!mask || !scratch) return null
  const mctx = mask.getContext('2d')
  if (!mctx) return null

  const image = atlasCtx.getImageData(col * 192 + cropX, cropY, cropW, cropH)
  const d = image.data

  const sockets = [
    { side: -1 as const, sx: 85.35, sy: 96.25, srx: 4.55, sry: 3.45, ix: 85.45, iy: 96.15, irx: 3.25, iry: 3.35 },
    { side: 1 as const, sx: 104.75, sy: 96.25, srx: 4.55, sry: 3.45, ix: 104.55, iy: 96.15, irx: 3.25, iry: 3.35 }
  ]

  // Build high-res socket mask and subtract original hair bangs, dark upper lash line, and lower cheek skin.
  mctx.clearRect(0, 0, cropW * scale, cropH * scale)
  mctx.fillStyle = '#ffffff'
  for (const s of sockets) {
    mctx.beginPath()
    mctx.ellipse((s.sx - cropX) * scale, (s.sy - cropY) * scale, s.srx * scale, s.sry * scale, 0, 0, Math.PI * 2)
    mctx.fill()
  }

  const hi = mctx.getImageData(0, 0, cropW * scale, cropH * scale)
  const hd = hi.data
  for (let hy = 0; hy < cropH * scale; hy++) {
    const y = cropY + (hy + 0.5) / scale
    const py = clamp(Math.floor(y - cropY), 0, cropH - 1)
    for (let hx = 0; hx < cropW * scale; hx++) {
      const hiIdx = (hy * cropW * scale + hx) * 4
      if (hd[hiIdx + 3] === 0) continue
      const x = cropX + (hx + 0.5) / scale
      const px = clamp(Math.floor(x - cropX), 0, cropW - 1)
      const pIdx = (py * cropW + px) * 4
      const r = d[pIdx], g = d[pIdx + 1], b = d[pIdx + 2], a = d[pIdx + 3]
      if (a < 180) { hd[hiIdx + 3] = 0; continue }
      const upperLash = y <= 93.3 && Math.max(r, g, b) < 76
      const centerOrSideBangs = ((x >= 90.0 && x <= 100.2 && y <= 97.5) || x <= 80.2 || x >= 109.8) && (b > r + 14)
      const lowerCheekSkin = y >= 99.3 && r > 215 && r > b + 6
      if (upperLash || centerOrSideBangs || lowerCheekSkin) {
        hd[hiIdx + 3] = 0
      }
    }
  }
  mctx.putImageData(hi, 0, 0)

  return {
    kind: 'sapphire',
    cropX,
    cropY,
    cropW,
    cropH,
    scale,
    mask,
    scratch,
    eyes: sockets.map((s) => ({
      side: s.side,
      ix: s.ix - cropX,
      iy: s.iy - cropY,
      irx: s.irx,
      iry: s.iry,
      shiftX: 1.75,
      shiftY: 1.25
    }))
  }
}

function buildKurocatCell(atlasCtx: CanvasRenderingContext2D, col: number): CatCellOverlay | null {
  const cropX = 62, cropY = 61, cropW = 56, cropH = 26, scale = 4
  const mask = makeCanvas(cropW * scale, cropH * scale)
  const scratch = makeCanvas(cropW * scale, cropH * scale)
  if (!mask || !scratch) return null
  const mctx = mask.getContext('2d')
  if (!mctx) return null

  const image = atlasCtx.getImageData(col * 192 + cropX, cropY, cropW, cropH)
  const d = image.data

  const searchBoxes: Array<[number, number, number, number]> = [
    [63, 62, 87, 86],
    [93, 62, 117, 86]
  ]
  const eyes: CatCellOverlay['eyes'] = []

  mctx.clearRect(0, 0, cropW * scale, cropH * scale)
  mctx.fillStyle = '#ffffff'

  for (const [x0, y0, x1, y1] of searchBoxes) {
    let sMinX = x1, sMaxX = x0, sMinY = y1, sMaxY = y0, irisCount = 0
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const lx = x - cropX, ly = y - cropY
        if (lx < 0 || lx >= cropW || ly < 0 || ly >= cropH) continue
        const i = (ly * cropW + lx) * 4
        const r = d[i], g = d[i + 1], b = d[i + 2], a = d[i + 3]
        if (a > 200 && g > 165 && r > 135 && b < 115) {
          sMinX = Math.min(sMinX, x); sMaxX = Math.max(sMaxX, x)
          sMinY = Math.min(sMinY, y); sMaxY = Math.max(sMaxY, y)
          irisCount++
        }
      }
    }
    if (irisCount < 12) continue
    const sx = (sMinX + sMaxX + 1) * 0.5
    const sy = (sMinY + sMaxY + 1) * 0.5
    const srx = Math.max(4, (sMaxX - sMinX + 1) * 0.5 - 0.1)
    const sry = Math.max(4, (sMaxY - sMinY + 1) * 0.5 - 0.1)

    mctx.beginPath()
    mctx.ellipse((sx - cropX) * scale, (sy - cropY) * scale, srx * scale, sry * scale, 0, 0, Math.PI * 2)
    mctx.fill()

    eyes.push({
      ix: sx - cropX,
      iy: sy - cropY,
      prx: 4.05,
      pry: 5.75,
      shiftX: Math.max(2.0, srx - 4.8),
      shiftY: Math.max(1.4, sry - 6.1)
    })
  }

  if (!eyes.length) return null

  const hi = mctx.getImageData(0, 0, cropW * scale, cropH * scale)
  const hd = hi.data
  for (let hy = 0; hy < cropH * scale; hy++) {
    const py = clamp(Math.floor((hy + 0.5) / scale), 0, cropH - 1)
    for (let hx = 0; hx < cropW * scale; hx++) {
      const hiIdx = (hy * cropW * scale + hx) * 4
      if (hd[hiIdx + 3] === 0) continue
      const px = clamp(Math.floor((hx + 0.5) / scale), 0, cropW - 1)
      const pIdx = (py * cropW + px) * 4
      if (d[pIdx + 3] < 200) hd[hiIdx + 3] = 0
    }
  }
  mctx.putImageData(hi, 0, 0)

  return { kind: 'cat', cropX, cropY, cropW, cropH, scale, mask, scratch, eyes }
}

function renderEyeCellScratch(cell: PetEyeCellOverlay, gx: number, gy: number): boolean {
  const sctx = cell.scratch.getContext('2d')
  if (!sctx) return false
  const { cropW, cropH, scale } = cell
  sctx.save()
  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.clearRect(0, 0, cropW * scale, cropH * scale)
  sctx.scale(scale, scale)

  if (cell.kind === 'cartoon') {
    for (const eye of cell.eyes) {
      const grad = sctx.createLinearGradient(0, eye.sMinY, 0, eye.sMaxY)
      grad.addColorStop(0, '#e5eaf1')
      grad.addColorStop(0.18, '#fbfcfd')
      grad.addColorStop(1, '#ffffff')
      sctx.fillStyle = grad
      sctx.fillRect(eye.sMinX - 1, eye.sMinY - 1, eye.sMaxX - eye.sMinX + 2, eye.sMaxY - eye.sMinY + 2)
    }
    for (const eye of cell.eyes) {
      sctx.save()
      sctx.beginPath()
      sctx.rect(eye.sMinX - 0.5, eye.sMinY - 0.5, eye.sMaxX - eye.sMinX + 1, eye.sMaxY - eye.sMinY + 1)
      sctx.clip()
      const px = eye.cx + gx * eye.shiftX
      const py = eye.cy + gy * eye.shiftY
      sctx.fillStyle = eye.color
      sctx.beginPath()
      sctx.ellipse(px, py, eye.rx, eye.ry, 0, 0, Math.PI * 2)
      sctx.fill()
      sctx.restore()
    }
  } else if (cell.kind === 'sapphire') {
    const scleraGrad = sctx.createLinearGradient(0, 4.5, 0, 12)
    scleraGrad.addColorStop(0, '#bdb2cb')
    scleraGrad.addColorStop(0.32, '#e8dee6')
    scleraGrad.addColorStop(0.68, '#f7f0f4')
    scleraGrad.addColorStop(1, '#fcf8fa')
    sctx.fillStyle = scleraGrad
    sctx.fillRect(0, 3, cropW, cropH - 3)

    for (const eye of cell.eyes) {
      const icx = eye.ix + gx * eye.shiftX
      const icy = eye.iy + gy * eye.shiftY
      const { irx, iry } = eye

      sctx.fillStyle = '#131f47'
      sctx.beginPath()
      sctx.ellipse(icx, icy, irx, iry, 0, 0, Math.PI * 2)
      sctx.fill()

      const irisGrad = sctx.createLinearGradient(icx, icy - iry * 0.9, icx, icy + iry * 0.95)
      irisGrad.addColorStop(0, '#09184a')
      irisGrad.addColorStop(0.45, '#1d4da1')
      irisGrad.addColorStop(0.82, '#629ae6')
      irisGrad.addColorStop(1, '#84b4f5')
      sctx.fillStyle = irisGrad
      sctx.beginPath()
      sctx.ellipse(icx, icy, irx * 0.88, iry * 0.9, 0, 0, Math.PI * 2)
      sctx.fill()

      const pcx = icx + gx * 0.35
      const pcy = icy + gy * 0.28 - 0.15
      sctx.fillStyle = 'rgba(6, 20, 62, 0.95)'
      sctx.beginPath()
      sctx.ellipse(pcx, pcy, irx * 0.45, iry * 0.48, 0, 0, Math.PI * 2)
      sctx.fill()

      sctx.fillStyle = 'rgba(16, 26, 62, 0.38)'
      sctx.beginPath()
      sctx.ellipse(icx, icy - iry * 0.7, irx * 0.96, iry * 0.46, 0, 0, Math.PI * 2)
      sctx.fill()

      sctx.fillStyle = 'rgba(246, 251, 255, 0.97)'
      sctx.beginPath()
      sctx.arc(icx - 1.05, icy - iry * 0.52, 0.82, 0, Math.PI * 2)
      sctx.fill()

      sctx.fillStyle = 'rgba(232, 248, 255, 0.78)'
      sctx.beginPath()
      sctx.arc(icx + (eye.side === -1 ? 1.15 : 1.05), icy + iry * 0.34, 0.42, 0, Math.PI * 2)
      sctx.fill()
    }
  } else {
    sctx.fillStyle = '#d4f044'
    sctx.fillRect(0, 0, cropW, cropH)
    for (const eye of cell.eyes) {
      const px = eye.ix + gx * eye.shiftX
      const py = eye.iy + gy * eye.shiftY
      sctx.fillStyle = '#0e0e10'
      sctx.beginPath()
      sctx.ellipse(px, py, eye.prx, eye.pry, 0, 0, Math.PI * 2)
      sctx.fill()

      sctx.fillStyle = 'rgba(255, 255, 255, 0.38)'
      sctx.beginPath()
      sctx.arc(px - 2.1, py - 2.3, 1.55, 0, Math.PI * 2)
      sctx.fill()

      sctx.fillStyle = 'rgba(255, 255, 255, 0.28)'
      sctx.beginPath()
      sctx.arc(px + 1.9, py + 1.9, 0.8, 0, Math.PI * 2)
      sctx.fill()
    }
  }

  sctx.setTransform(1, 0, 0, 1, 0, 0)
  sctx.globalCompositeOperation = 'destination-in'
  sctx.drawImage(cell.mask, 0, 0)
  sctx.restore()
  return true
}

const soloEyeCache = new Map<string, Promise<PetEyeOverlaySet | undefined>>()

export function loadSoloEyeOverlays(petId: string, url: string): Promise<PetEyeOverlaySet | undefined> {
  if (!petKind(petId) || !url || typeof Image === 'undefined') return Promise.resolve(undefined)
  const key = `${petId}:${url}`
  let pending = soloEyeCache.get(key)
  if (!pending) {
    pending = (async () => {
      const image = new Image()
      if (!url.startsWith('file:')) image.crossOrigin = 'anonymous'
      image.src = url
      await image.decode()
      const atlas = makeCanvas(192 * 6, 208)
      const ctx = atlas?.getContext('2d')
      if (!atlas || !ctx) return undefined
      for (const col of [0, 5]) ctx.drawImage(image, col * 192, 0, 192, 208, col * 192, 0, 192, 208)
      return buildEyeOverlays(petId, atlas, 0)
    })()
    soloEyeCache.set(key, pending)
    while (soloEyeCache.size > 6) soloEyeCache.delete(soloEyeCache.keys().next().value!)
    void pending.catch(() => soloEyeCache.delete(key))
  }
  return pending
}

export function drawSoloLiveEyes(
  ctx: CanvasRenderingContext2D,
  overlays: PetEyeOverlaySet | undefined,
  column: number,
  width: number,
  height: number,
  gaze: { x: number; y: number } | undefined
): boolean {
  if (!overlays || !gaze) return false
  const cell = overlays[column]
  if (!cell) return false
  const gx = clamp(gaze.x, -1, 1), gy = clamp(gaze.y, -1, 1)
  const alpha = clamp((Math.hypot(gx, gy) - 0.025) / 0.32, 0, 1)
  if (alpha <= 0.015 || !renderEyeCellScratch(cell, gx, gy)) return false
  const { cropX, cropY, cropW, cropH, scale } = cell
  ctx.save()
  ctx.globalAlpha = alpha
  ctx.scale(width / 192, height / 208)
  ctx.drawImage(cell.scratch, 0, 0, cropW * scale, cropH * scale, cropX, cropY, cropW, cropH)
  ctx.restore()
  return true
}

export function drawActorLiveEyes(
  ctx: CanvasRenderingContext2D,
  actor: JointActor,
  overlays: PetEyeOverlaySet | undefined,
  column: number
): void {
  if (!overlays || !actor.gaze || actor.soloBlend > 0.85 || actor.opacity < 0.02) return
  const cell = overlays[column]
  if (!cell) return
  const gx = clamp(actor.gaze.x, -1, 1)
  const gy = clamp(actor.gaze.y, -1, 1)
  const mag = Math.hypot(gx, gy)
  const alpha = clamp((mag - 0.025) / 0.32, 0, 1) * (1 - actor.soloBlend) * actor.opacity
  if (alpha <= 0.015 || !renderEyeCellScratch(cell, gx, gy)) return

  // Map sprite pixel coordinates [0..192, 0..208] around the crop center through exact head/lean skinning.
  const { cropW, cropH, scale } = cell
  const refX = cell.cropX + cropW * 0.5
  const refY = cell.cropY + cropH * 0.5
  const p0 = skinPoint(actor, [refX / 192, refY / 208], false)
  const px = skinPoint(actor, [(refX + 8) / 192, refY / 208], false)
  const py = skinPoint(actor, [refX / 192, (refY + 8) / 208], false)
  const a = (px.x - p0.x) / 8
  const b = (px.y - p0.y) / 8
  const c = (py.x - p0.x) / 8
  const d = (py.y - p0.y) / 8
  const e = p0.x - a * refX - c * refY
  const f = p0.y - b * refX - d * refY

  ctx.save()
  ctx.globalAlpha *= alpha
  ctx.transform(a, b, c, d, e, f)
  ctx.drawImage(cell.scratch, 0, 0, cropW * scale, cropH * scale, cell.cropX, cell.cropY, cropW, cropH)
  ctx.restore()
}
