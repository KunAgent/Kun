import { createCanvas } from '@napi-rs/canvas'
import { describe, expect, it } from 'vitest'
import { BUILTIN_KUROCAT_SKINS } from '@shared/pets-kurocat-presets'
import { defaultKuroCatUserPrefs, parseKuroCatSkinConfig } from '@shared/pets-kurocat'
import { updatePetTyping } from '@shared/pets-typing'
import { KuroCatEngine } from './kurocat-engine'

function countOpaquePixelsInRect(
  data: Uint8ClampedArray,
  canvasWidth: number,
  x0: number,
  y0: number,
  w: number,
  h: number
): number {
  let count = 0
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const idx = (y * canvasWidth + x) * 4
      if (data[idx + 3] > 32) count++
    }
  }
  return count
}

describe('KuroCatEngine native live 2D renderer', () => {
  it('renders black, ragdoll, calico, and custom pinched skins with permanently grounded keyboard & mouse', async () => {
    const stageW = 420
    const stageH = 400
    const canvas = createCanvas(stageW, stageH)
    const ctx = canvas.getContext('2d') as unknown as CanvasRenderingContext2D
    const engine = new KuroCatEngine()

    // 1. Default classic black KuroCat idle
    engine.setAppearance('kun:kurocat', null, defaultKuroCatUserPrefs())
    engine.stepAndRender(ctx, stageW, stageH, 1, 1_000, false)
    const idleImg = canvas.getContext('2d').getImageData(0, 0, stageW, stageH)
    const catBodyPixels = countOpaquePixelsInRect(idleImg.data, stageW, 110, 70, 200, 210)
    const keyboardPixels = countOpaquePixelsInRect(idleImg.data, stageW, 90, 295, 250, 85)
    const mousePixels = countOpaquePixelsInRect(idleImg.data, stageW, 20, 285, 70, 70)
    expect(catBodyPixels).toBeGreaterThan(4_000)
    expect(keyboardPixels).toBeGreaterThan(6_000)
    expect(mousePixels).toBeGreaterThan(400)

    // 2. Typing burst + Spacebar tail pat + 25s pause: keyboard stays 100% present without disappearing
    let typing = updatePetTyping(undefined, 1, 1, 1_050, { col: 1, row: 1 })
    engine.syncTyping(typing, 1_050)
    expect(engine.stepAndRender(ctx, stageW, stageH, 1, 1_066, false)).toBe(true)

    typing = updatePetTyping(typing, 3, 3, 1_180, { col: 2, row: 2 })
    engine.syncTyping(typing, 1_180)
    engine.stepAndRender(ctx, stageW, stageH, 1, 1_200, false)

    // Release keys and advance 25 seconds: keyboard pixels must remain grounded
    typing = updatePetTyping(typing, 0, 0, 1_260)
    engine.syncTyping(typing, 1_260)
    engine.stepAndRender(ctx, stageW, stageH, 1, 26_500, false)
    const postPauseImg = canvas.getContext('2d').getImageData(0, 0, stageW, stageH)
    const postPauseKbPixels = countOpaquePixelsInRect(postPauseImg.data, stageW, 90, 295, 250, 85)
    expect(postPauseKbPixels).toBeGreaterThan(6_000)

    // 3. Ragdoll + Calico + Custom Fox/Star skin + 108-key layout + RGB headphones + mouse clicks + tap interactions
    const customFox = parseKuroCatSkinConfig({
      id: 'star-fox',
      name: '星眸狐喵',
      pattern: 'calico',
      coatColor: '#fef3c7',
      markingColor: '#ea580c',
      patch2Color: '#1e293b',
      eyeColor: '#10b981',
      eyeShape: 'slit',
      pupilShape: 'star',
      faceWidth: 1.25,
      earSize: 1.3,
      tailFluff: 1.4,
      spots: [{ part: 'body', x: 0, y: 0.1, rx: 0.25, ry: 0.2, color: '#ea580c' }]
    })
    expect(customFox).not.toBeNull()

    for (const skin of [BUILTIN_KUROCAT_SKINS[1], BUILTIN_KUROCAT_SKINS[3], customFox!]) {
      engine.setAppearance(`kurocat:${skin.id}`, skin, {
        ...defaultKuroCatUserPrefs(),
        keyboardLayout: '108',
        collarColor: 'gold',
        headphoneMode: 'on'
      })
      engine.syncWorkState('running', 30_000)
      engine.syncCursor({
        nx: 0.3, ny: 0.4, gx: -0.4, gy: -0.2, buttons: 1, clickSeq: 1, clickMask: 1,
        wheelSeq: 1, wheelDir: 1, deskActiveAt: 30_010, active: true, overMascot: false
      }, 30_010)
      engine.noteLocalHover(0.05, -0.2, true, 0, 30_020)
      engine.noteLocalHover(0.35, -0.15, true, 0, 30_040)
      engine.noteTap(stageW * 0.5, stageH * 0.32, stageW, stageH, 30_050)
      engine.setDragging(true, 18, 30_060)
      engine.stepAndRender(ctx, stageW, stageH, 1, 30_080, false)
      engine.setDragging(false, 0, 30_100)
      engine.stepAndRender(ctx, stageW, stageH, 1, 30_120, false)
      expect(engine.hitPathCss(stageW, stageH)).toMatch(/^M /)
    }

    if (process.env.KUN_PREVIEW_PNG) {
      const fs = await import('node:fs/promises')
      const grid = createCanvas(920, 840)
      const gctx = grid.getContext('2d')
      gctx.fillStyle = '#1e2433'
      gctx.fillRect(0, 0, 920, 840)
      const panels: Array<{ title: string; id: string; skin: typeof customFox; typing?: boolean; headphones?: boolean }> = [
        { title: 'Classic KuroCat (Typing + Tail Space)', id: 'kun:kurocat', skin: null, typing: true },
        { title: 'Ragdoll (RGB Headphones + Mouse)', id: 'kurocat:ragdoll', skin: BUILTIN_KUROCAT_SKINS[1], headphones: true },
        { title: 'Calico Companion Breed', id: 'kurocat:calico', skin: BUILTIN_KUROCAT_SKINS[3] },
        { title: 'Custom Plugin (Fox + Star Pupils)', id: 'kurocat:star-fox', skin: customFox }
      ]
      for (let i = 0; i < panels.length; i++) {
        const p = panels[i]
        const tile = createCanvas(440, 400)
        const tctx = tile.getContext('2d') as unknown as CanvasRenderingContext2D
        const eng = new KuroCatEngine()
        eng.setAppearance(p.id, p.skin, {
          ...defaultKuroCatUserPrefs(),
          collarColor: i === 3 ? 'gold' : i === 1 ? 'pink' : 'none',
          headphoneMode: p.headphones ? 'on' : 'off'
        })
        if (p.typing) {
          let st = updatePetTyping(undefined, 1, 1, 1_000, { col: 1, row: 1 })
          eng.syncTyping(st, 1_000)
          eng.stepAndRender(tctx, 440, 400, 1, 1_016, false)
          st = updatePetTyping(st, 3, 3, 1_040, { col: 2, row: 2 })
          eng.syncTyping(st, 1_040)
          eng.stepAndRender(tctx, 440, 400, 1, 1_060, false)
        } else if (p.headphones) {
          eng.syncWorkState('running', 1_000)
          eng.syncCursor({ nx: 0.32, ny: 0.44, gx: -0.35, gy: -0.1, buttons: 1, clickSeq: 1, clickMask: 1, wheelSeq: 0, wheelDir: 0, deskActiveAt: 1_000, active: true, overMascot: false }, 1_000)
          for (let t = 1_000; t <= 1_400; t += 16) eng.stepAndRender(tctx, 440, 400, 1, t, false)
        } else {
          eng.stepAndRender(tctx, 440, 400, 1, 1_000, false)
        }
        const gx = (i % 2) * 460 + 10
        const gy = Math.floor(i / 2) * 420 + 10
        gctx.fillStyle = 'rgba(255,255,255,0.06)'
        gctx.fillRect(gx, gy, 440, 400)
        gctx.drawImage(tile, gx, gy)
      }
      await fs.writeFile(process.env.KUN_PREVIEW_PNG, grid.toBuffer('image/png'))
    }
  })
})
