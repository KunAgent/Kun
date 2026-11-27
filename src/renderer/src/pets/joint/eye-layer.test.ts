import fs from 'node:fs'
import path from 'node:path'
import { createCanvas, loadImage, ImageData as NapiImageData } from '@napi-rs/canvas'
import sharp from 'sharp'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { PetSummary } from '@shared/pets'
import { updatePetTyping } from '@shared/pets-typing'
import { buildEyeOverlays, drawSoloLiveEyes } from './eye-layer'
import { JointCanvasRenderer } from './canvas-renderer'
import { petTypingCutouts, petTypingRig } from '../typing/typing-rig'
import { PetTypingMotion } from '../typing/typing-motion'
import { typingScene } from '../typing/typing-scene'

const previousGlobals: Record<string, unknown> = {}

beforeEach(() => {
  for (const key of ['ImageData', 'document', 'window']) previousGlobals[key] = (globalThis as Record<string, unknown>)[key]
  ;(globalThis as Record<string, unknown>).ImageData = NapiImageData
  ;(globalThis as Record<string, unknown>).window = { devicePixelRatio: 2 }
  ;(globalThis as Record<string, unknown>).document = {
    createElement(tag: string) {
      if (tag === 'canvas') return createCanvas(1, 1)
      throw new Error(`Unsupported tag: ${tag}`)
    }
  }
})

afterEach(() => {
  for (const [key, value] of Object.entries(previousGlobals)) {
    if (value === undefined) delete (globalThis as Record<string, unknown>)[key]
    else (globalThis as Record<string, unknown>)[key] = value
  }
})

async function decodePetImage(id: string) {
  const buf = await sharp(path.resolve('resources/pets', id, 'spritesheet.webp')).png().toBuffer()
  return loadImage(buf)
}

describe('built-in pet live eye overlays and desk rendering', () => {
  it.each(['xiao-kun', 'ikun', 'whale-girl', 'kurocat'])('renders %s eye gaze strictly inside open eye sockets without touching transparent margins', async (id) => {
    const img = await decodePetImage(id)
    const atlas = createCanvas(192 * 6, 208) as unknown as HTMLCanvasElement
    const actx = atlas.getContext('2d')!
    for (const col of [0, 5]) actx.drawImage(img as unknown as CanvasImageSource, col * 192, 0, 192, 208, col * 192, 0, 192, 208)
    const overlays = buildEyeOverlays(`kun:${id}`, atlas, 0)
    expect(overlays?.[0]).toBeDefined()
    expect(overlays?.[5]).toBeDefined()
    expect(overlays?.[2]).toBeUndefined()

    const restCanvas = createCanvas(192, 208)
    const rctx = restCanvas.getContext('2d')
    rctx.drawImage(img, 0, 0, 192, 208, 0, 0, 192, 208)
    expect(drawSoloLiveEyes(rctx as unknown as CanvasRenderingContext2D, overlays, 0, 192, 208, { x: 0, y: 0 })).toBe(false)

    const leftCanvas = createCanvas(192, 208)
    const lctx = leftCanvas.getContext('2d')
    lctx.drawImage(img, 0, 0, 192, 208, 0, 0, 192, 208)
    expect(drawSoloLiveEyes(lctx as unknown as CanvasRenderingContext2D, overlays, 0, 192, 208, { x: -0.9, y: 0.1 })).toBe(true)
    expect(drawSoloLiveEyes(lctx as unknown as CanvasRenderingContext2D, overlays, 2, 192, 208, { x: -0.9, y: 0.1 })).toBe(false)

    const rightCanvas = createCanvas(192, 208)
    const gctx = rightCanvas.getContext('2d')
    gctx.drawImage(img, 0, 0, 192, 208, 0, 0, 192, 208)
    expect(drawSoloLiveEyes(gctx as unknown as CanvasRenderingContext2D, overlays, 0, 192, 208, { x: 0.9, y: -0.2 })).toBe(true)

    const restData = rctx.getImageData(0, 0, 192, 208).data
    const leftData = lctx.getImageData(0, 0, 192, 208).data
    const rightData = gctx.getImageData(0, 0, 192, 208).data

    let changedPixels = 0
    for (let i = 0; i < restData.length; i += 4) {
      // Transparent background pixels must never gain alpha from eye drawing.
      if (restData[i + 3] === 0) {
        expect(leftData[i + 3]).toBe(0)
        expect(rightData[i + 3]).toBe(0)
      }
      if (Math.abs(leftData[i] - rightData[i]) > 18 || Math.abs(leftData[i + 2] - rightData[i + 2]) > 18) {
        changedPixels++
      }
    }
    expect(changedPixels).toBeGreaterThan(12)
  })

  it('paints desk keyboard, mousepad, mini-mouse and live eyes together on Canvas2D', async () => {
    const ids = ['xiao-kun', 'ikun', 'whale-girl', 'kurocat'] as const

    for (const id of ids) {
      const manifest = JSON.parse(fs.readFileSync(path.resolve('resources/pets', id, 'pet.json'), 'utf8'))
      const pet: PetSummary = { ...manifest, id: `kun:${id}`, sourceId: id, source: 'kun-builtin', available: true, sourceMissing: false }
      const img = await decodePetImage(id)
      const rig = pet.interactions!.joint!

      const atlas = createCanvas(192 * 7, 208) as unknown as HTMLCanvasElement
      const ctx = atlas.getContext('2d')!
      const headHeight = Math.round(rig.head[1] * 208)
      rig.blink.forEach((col, i) => {
        const x = i * 192
        ctx.drawImage(img as unknown as CanvasImageSource, rig.blink[0] * 192, rig.row * 208, 192, 208, x, 0, 192, 208)
        ctx.save(); ctx.beginPath(); ctx.rect(x, 0, 192, headHeight); ctx.clip()
        ctx.clearRect(x, 0, 192, headHeight)
        ctx.drawImage(img as unknown as CanvasImageSource, col * 192, rig.row * 208, 192, 208, x, 0, 192, 208)
        ctx.restore()
      })
      ctx.drawImage(img as unknown as CanvasImageSource, 0, 0, 192, 208, 192 * 6, 0, 192, 208)
      const cutouts = petTypingCutouts(pet)!
      const typingRig = petTypingRig(pet)!
      const arms = createCanvas(192 * 7, 208) as unknown as HTMLCanvasElement
      const actx = arms.getContext('2d')!
      rig.blink.forEach((_col, i) => {
        const x = i * 192
        for (const side of [0, 1] as const) {
          const cutout = cutouts[side]
          const trace = (c: CanvasRenderingContext2D, pts = cutout.contour) => {
            c.beginPath()
            pts.forEach(([u, v], idx) => { if (idx) c.lineTo(x + u * 192, v * 208); else c.moveTo(x + u * 192, v * 208) })
            c.closePath()
          }
          actx.save(); trace(actx); actx.clip()
          if (cutout.source) {
            const { row, column, offset, mirrorX } = cutout.source
            actx.translate(x + (mirrorX ? 192 : 0), 0)
            actx.scale(mirrorX ? -1 : 1, 1)
            actx.drawImage(img as unknown as CanvasImageSource, column * 192, row * 208, 192, 208, offset[0] * 192, offset[1] * 208, 192, 208)
          } else {
            actx.drawImage(img as unknown as CanvasImageSource, rig.blink[0] * 192, rig.row * 208, 192, 208, x, 0, 192, 208)
          }
          actx.restore()
          if (cutout.eraseContour !== null) {
            ctx.save(); ctx.beginPath()
            ctx.rect(x, cutout.eraseFrom ?? typingRig.arms[side].shoulder[1] * 208 + 2, 192, 208); ctx.clip()
            ctx.globalCompositeOperation = 'destination-out'; trace(ctx, cutout.eraseContour); ctx.fill()
            ctx.restore()
          }
        }
      })
      const eyes = buildEyeOverlays(pet.id, atlas, rig.row)
      const texture = { id: pet.id, atlas, arms, eyes }

      const scenarios = [
        () => {
          const m = new PetTypingMotion()
          let t = updatePetTyping(undefined, 1, 1, 1000, { col: 0, row: 0 })
          t = updatePetTyping(t, 3, 2, 1010, { col: 5, row: 2 })
          let state = m.sample(t, 1000, false, false, { typingActive: true, cursor: null })
          for (let now = 1016; now <= 1220; now += 16) state = m.sample(t, now, false, false, { typingActive: true, cursor: null })
          return typingScene({ pet, width: 240, height: 175, mascotWidth: 118, origin: { x: 120, y: 84 }, motion: state, now: 1220, enteredAt: 1000, expiresAt: 3000, paused: false })
        },
        () => {
          const m = new PetTypingMotion()
          const cursor = { nx: 0.2, ny: 0.35, gx: -0.85, gy: -0.35, buttons: 1, wheelSeq: 1, wheelDir: -1 as const, deskActiveAt: 1180, active: true }
          let state = m.sample(undefined, 1000, false, false, { typingActive: false, cursor })
          for (let now = 1016; now <= 1300; now += 16) state = m.sample(undefined, now, false, false, { typingActive: false, cursor })
          return typingScene({ pet, width: 240, height: 175, mascotWidth: 118, origin: { x: 120, y: 84 }, motion: state, now: 1300, enteredAt: 1000, expiresAt: 3000, paused: false })
        },
        () => {
          const m = new PetTypingMotion()
          const cursor = { nx: 0.85, ny: 0.6, gx: 0.85, gy: 0.35, buttons: 2, wheelSeq: 2, wheelDir: 1 as const, deskActiveAt: 1250, active: true }
          const t = updatePetTyping(undefined, 2, 2, 1260, { col: 3, row: 1 })
          let state = m.sample(t, 1000, false, false, { typingActive: true, cursor })
          for (let now = 1016; now <= 1320; now += 16) state = m.sample(t, now, false, false, { typingActive: true, cursor })
          return typingScene({ pet, width: 240, height: 175, mascotWidth: 118, origin: { x: 120, y: 84 }, motion: state, now: 1320, enteredAt: 1000, expiresAt: 3000, paused: false })
        }
      ]

      const rendered = scenarios.map((build) => {
        const frame = build()
        expect(frame.keyboard?.mousePad).toBeDefined()
        const outCanvas = createCanvas(480, 350)
        const outCtx = outCanvas.getContext('2d') as unknown as CanvasRenderingContext2D
        const renderer = new JointCanvasRenderer(outCtx, [texture], frame)
        renderer.paint(frame, 500, false)
        const pixels = outCanvas.getContext('2d').getImageData(0, 0, 480, 350).data
        let opaque = 0
        for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 32) opaque++
        expect(opaque).toBeGreaterThan(2000)
        return pixels
      })

      let deskGazeDiff = 0
      for (let i = 0; i < rendered[1].length; i += 4) {
        if (Math.abs(rendered[1][i] - rendered[2][i]) > 18 || Math.abs(rendered[1][i + 2] - rendered[2][i + 2]) > 18) {
          deskGazeDiff++
        }
      }
      expect(deskGazeDiff).toBeGreaterThan(20)
    }
  })
})
