import type { KuroCatKeyboardLayout, KuroCatKeyboardOrientation } from '@shared/pets-kurocat'
import type { KuroCatTailState } from './kurocat-body-renderer'
import type { KuroCatFxParticle, KuroCatPawState } from './kurocat-eyes-renderer'
import {
  getKuroCatKeyboardLayout,
  type KuroCatKeyBubble,
  type KuroCatKeySpec,
  type KuroCatMouseBadge,
  type Vec2
} from './kurocat-keyboard-desk'

export class KuroSpring {
  public x: number
  public v = 0
  constructor(initial = 0, public hz = 2.4, public damping = 0.72) {
    this.x = initial
  }
  step(target: number, dt: number): number {
    const w = 2 * Math.PI * this.hz
    const n = Math.max(1, Math.ceil(dt * 240))
    const h = dt / n
    for (let i = 0; i < n; i++) {
      this.v += (w * w * (target - this.x) - 2 * this.damping * w * this.v) * h
      this.x += this.v * h
    }
    return this.x
  }
  kick(dv: number): void { this.v += dv }
  set(val: number): void { this.x = val; this.v = 0 }
}

export type IdleActKind = 'tilt' | 'ear' | 'slowBlink' | 'look' | 'tail' | 'doze' | 'yawn' | 'stretch' | 'groom' | 'knead'
export interface IdleFidget { kind: IdleActKind; t0: number; dur: number; side: -1 | 1 }

export function smoothstep01(a: number, b: number, x: number): number {
  const u = Math.max(0, Math.min(1, (x - a) / (b - a)))
  return u * u * (3 - 2 * u)
}

export interface KuroCatBoardGeometry {
  keyboardLayout: KuroCatKeyboardLayout
  keyboardOrientation: KuroCatKeyboardOrientation
  kbCenterX: number
  kbCenterY: number
  kbWidth: number
  kbHeight: number
  kbTiltRad: number
  logicalW: number
  mouseBaseX: number
  mouseBaseY: number
}

export function projectKuroCatKeyboardPoint(geo: KuroCatBoardGeometry, uCol: number, rowPos: number): Vec2 {
  const layout = getKuroCatKeyboardLayout(geo.keyboardLayout)
  const isCat = geo.keyboardOrientation === 'cat'
  const screenU = isCat ? layout.totalUnits - uCol : uCol
  const screenRow = isCat ? layout.totalRows - rowPos : rowPos
  const innerW = geo.kbWidth - 14
  const innerH = geo.kbHeight - 12
  const localX = -innerW * 0.5 + (screenU / layout.totalUnits) * innerW
  const localY = -innerH * 0.5 + (screenRow / layout.totalRows) * innerH
  const px = localX * (0.94 + (screenRow / layout.totalRows) * 0.09)
  const cos = Math.cos(geo.kbTiltRad)
  const sin = Math.sin(geo.kbTiltRad)
  return { x: geo.kbCenterX + px * cos - localY * sin, y: geo.kbCenterY + px * sin + localY * cos }
}

export function getKuroCatKeyWorldCenter(geo: KuroCatBoardGeometry, spec: KuroCatKeySpec): Vec2 {
  const layout = getKuroCatKeyboardLayout(geo.keyboardLayout)
  const isCat = geo.keyboardOrientation === 'cat'
  const uClamped = Math.max(0.65, Math.min(layout.totalUnits - 0.65, spec.uStart + spec.uWidth * 0.5))
  const rY = spec.rowY ?? spec.row
  const rSpan = spec.rowSpan ?? 1
  let rowPos = rY + rSpan * 0.5
  if (isCat && rY <= 0.1) rowPos = rY + 0.68
  else if (!isCat && rY + rSpan >= layout.totalRows - 0.1) rowPos = rY + rSpan - 0.68
  return projectKuroCatKeyboardPoint(geo, uClamped, rowPos)
}

export function clampToKuroCatKeyboardSurface(geo: KuroCatBoardGeometry, pt: Vec2): Vec2 {
  const dx = pt.x - geo.kbCenterX
  const dy = pt.y - geo.kbCenterY
  const cos = Math.cos(-geo.kbTiltRad)
  const sin = Math.sin(-geo.kbTiltRad)
  const lx = dx * cos - dy * sin
  const ly = dx * sin + dy * cos
  const maxX = geo.kbWidth * 0.5 - 15
  const minY = -geo.kbHeight * 0.5 + 8
  const maxY = geo.kbHeight * 0.5 - 14
  const cx = Math.max(-maxX, Math.min(maxX, lx))
  const cy = Math.max(minY, Math.min(maxY, ly))
  const rcos = Math.cos(geo.kbTiltRad)
  const rsin = Math.sin(geo.kbTiltRad)
  return { x: geo.kbCenterX + cx * rcos - cy * rsin, y: geo.kbCenterY + cx * rsin + cy * rcos }
}

export function kuroCatViewportTransform(
  keyboardLayout: KuroCatKeyboardLayout,
  stageW: number,
  stageH: number
): { offsetX: number; offsetY: number; uniformScale: number } {
  const contentW = keyboardLayout === '108' ? 516 : 396
  const contentH = keyboardLayout === '108' ? 404 : 386
  const centerX = keyboardLayout === '108' ? 270 : 208
  const centerY = keyboardLayout === '108' ? 232 : 226
  const scale = Math.min(stageW / contentW, stageH / contentH)
  return { uniformScale: scale, offsetX: stageW * 0.5 - centerX * scale, offsetY: stageH * 0.5 - centerY * scale }
}

export function kuroCatHitPathCss(
  geo: KuroCatBoardGeometry,
  stageW: number,
  stageH: number,
  spinePoint: (t: number, breath: number) => Vec2
): string {
  const vt = kuroCatViewportTransform(geo.keyboardLayout, stageW, stageH)
  const pt = (lx: number, ly: number): string => `${(vt.offsetX + lx * vt.uniformScale).toFixed(1)},${(vt.offsetY + ly * vt.uniformScale).toFixed(1)}`
  const head = spinePoint(0.14, 0)
  const hip = spinePoint(0.95, 0)
  const mx = geo.mouseBaseX - 24
  const rx = Math.min(geo.logicalW - 8, Math.max(geo.kbCenterX + geo.kbWidth * 0.54, hip.x + 125))
  const topY = Math.max(24, head.y - 46)
  const botY = geo.kbCenterY + geo.kbHeight * 0.56
  return `M ${pt(head.x - 78, topY)} L ${pt(head.x + 82, topY)} L ${pt(rx, hip.y - 36)} L ${pt(rx, botY)} L ${pt(mx, botY)} L ${pt(mx, geo.mouseBaseY - 32)} L ${pt(head.x - 78, hip.y - 24)} Z`
}

export function spawnKuroCatKeyBubble(
  bubbles: KuroCatKeyBubble[],
  geo: KuroCatBoardGeometry,
  id: number,
  label: string,
  isSpace: boolean,
  keyX: number,
  now: number
): void {
  if (bubbles.length >= 6) bubbles.shift()
  const minX = geo.keyboardLayout === '108' ? 145 : 125
  const maxX = geo.logicalW - 95
  const baseX = Math.max(minX, Math.min(maxX, keyX * 0.45 + geo.kbCenterX * 0.55))
  const staggerY = 258 + ((id % 3) - 1) * 9
  bubbles.push({
    id, label, isSpace, x: baseX, targetX: baseX, y: 292, targetY: staggerY,
    rot: ((Math.random() - 0.5) * 4.5 * Math.PI) / 180, createdAt: now, lifetime: 920
  })
  const widths = bubbles.map((b) => (b.isSpace ? 40 : 26))
  const totalW = widths.reduce((a, b) => a + b, 0) + 3.5 * (bubbles.length - 1)
  let cursor = Math.max(minX, Math.min(maxX - totalW + 20, geo.kbCenterX + 8 - totalW * 0.5))
  for (let i = 0; i < bubbles.length; i++) {
    bubbles[i].targetX = cursor + widths[i] * 0.5
    cursor += widths[i] + 3.5
  }
}

export function stepKuroCatBubblesAndParticles(
  bubbles: KuroCatKeyBubble[],
  mouseBadges: KuroCatMouseBadge[],
  fxParticles: KuroCatFxParticle[],
  dt: number,
  now: number
): void {
  for (let i = fxParticles.length - 1; i >= 0; i--) {
    const fx = fxParticles[i]
    if (now - fx.createdAt >= fx.lifetime) { fxParticles.splice(i, 1); continue }
    fx.x += fx.vx * dt
    fx.y += fx.vy * dt
  }
  for (let i = bubbles.length - 1; i >= 0; i--) {
    const b = bubbles[i]
    if (now - b.createdAt >= b.lifetime) { bubbles.splice(i, 1); continue }
    const age = (now - b.createdAt) / b.lifetime
    b.x += (b.targetX - b.x) * (1 - Math.exp(-18 * dt))
    b.y += (b.targetY - age * 10 - b.y) * (1 - Math.exp(-16 * dt))
  }
  for (let i = mouseBadges.length - 1; i >= 0; i--) {
    if (now - mouseBadges[i].createdAt >= mouseBadges[i].lifetime) mouseBadges.splice(i, 1)
  }
}

export function evaluateKuroCatIdleAct(
  act: IdleFidget | null,
  now: number,
  dt: number,
  flags: { dozeJoltFired: boolean; groomSparkleSpawned: boolean },
  onDozeJolt: () => void,
  onGroomSparkle: (side: -1 | 1) => void
): {
  actU: number
  actEnv: number
  tDozeLid: number
  tDozeNod: number
  tYawn: number
  tStretch: number
  tGroom: number
  tLick: number
  tEarL: number
  tEarR: number
  tKnead: number
  kneadDelta: number
  groomTilt: number
  dozeTilt: number
} {
  const actU = act ? Math.max(0, Math.min(1, (now - act.t0) / act.dur)) : 0
  const actEnv = act ? smoothstep01(0, 0.25, actU) * (1 - smoothstep01(0.7, 1, actU)) : 0
  let tDozeLid = 0, tDozeNod = 0, tYawn = 0, tStretch = 0, tGroom = 0, tLick = 0
  let tEarL = 0, tEarR = 0, tKnead = 0, kneadDelta = 0, groomTilt = 0, dozeTilt = 0
  if (act?.kind === 'doze') {
    if (actU < 0.54) {
      const p = actU / 0.54
      const dip = p < 0.42 ? Math.sin((p / 0.42) * Math.PI) * 0.45 : smoothstep01(0.38, 1, p)
      tDozeLid = Math.min(0.86, 0.25 + dip * 0.65)
      tDozeNod = dip
      dozeTilt = act.side * 0.14 * dip
    } else {
      if (!flags.dozeJoltFired) {
        flags.dozeJoltFired = true
        onDozeJolt()
      }
      tDozeNod = -0.18 * (1 - smoothstep01(0, 0.35, (actU - 0.54) / 0.46))
    }
  } else if (act?.kind === 'yawn') {
    tYawn = smoothstep01(0.06, 0.34, actU) * (1 - smoothstep01(0.68, 0.94, actU))
  } else if (act?.kind === 'stretch') {
    tStretch = smoothstep01(0.06, 0.28, actU) * (1 - smoothstep01(0.74, 0.96, actU))
  } else if (act?.kind === 'groom') {
    tGroom = smoothstep01(0, 0.14, actU) * (1 - smoothstep01(0.86, 1, actU))
    if (actU >= 0.12 && actU < 0.44) {
      tLick = Math.sin((((actU - 0.12) / 0.32) * 2 % 1) * Math.PI)
      groomTilt = act.side * 0.13
    } else if (actU >= 0.44 && actU < 0.84) {
      const frac = (((actU - 0.44) / 0.40) * 2) % 1
      const ec = Math.sin(smoothstep01(0.18, 0.78, frac) * Math.PI)
      if (act.side < 0) tEarL = ec
      else tEarR = ec
      groomTilt = act.side * (-0.10 + Math.sin(frac * Math.PI) * 0.18)
    } else if (actU >= 0.84 && !flags.groomSparkleSpawned) {
      flags.groomSparkleSpawned = true
      onGroomSparkle(act.side)
    }
  } else if (act?.kind === 'knead') {
    tKnead = smoothstep01(0, 0.14, actU) * (1 - smoothstep01(0.84, 1, actU))
    kneadDelta = dt * 4.4
  }
  return { actU, actEnv, tDozeLid, tDozeNod, tYawn, tStretch, tGroom, tLick, tEarL, tEarR, tKnead, kneadDelta, groomTilt, dozeTilt }
}

export function stepKuroCatTailKinematics(
  tailState: KuroCatTailState,
  tailCtrl: { active: boolean; targetX: number; targetY: number; tapAt: number; patAt: number; releaseAt: number },
  params: {
    anyTailHeld: boolean
    dt: number
    now: number
    hip: Vec2
    kbWidth: number
    logicalW: number
    actKind?: IdleActKind
    actU: number
    tailRecoil: number
    crossAmount: number
    isCross: boolean
    thumpPhase: number
    thumpLift: number
    thumpLash: number
    tailDriftPhase: number
    onSlam: (sx: number, sy: number) => void
  }
): { thumpPhase: number; thumpLift: number; thumpLash: number } {
  const { anyTailHeld, dt, now, hip, kbWidth, logicalW } = params
  const tailAge = Math.max(0, now - tailCtrl.tapAt)
  const tailPressing = tailCtrl.active && (anyTailHeld || now - tailCtrl.patAt < 155)
  const sinceRelease = anyTailHeld ? 0 : Math.max(0, now - Math.max(tailCtrl.patAt + 155, tailCtrl.releaseAt))
  if (tailCtrl.active && !tailPressing && sinceRelease > 460) tailCtrl.active = false
  tailState.reach += ((tailCtrl.active ? 1 : 0) - tailState.reach) * (1 - Math.exp(-(tailCtrl.active ? 28 : 9.5) * dt))
  const targetHover = !tailCtrl.active ? 0 : tailAge < 75 ? Math.sin((tailAge / 75) * Math.PI) * 24 : tailPressing ? 0 : 13 + Math.sin(now * 0.012) * 2.2
  tailState.hover += (targetHover - tailState.hover) * (1 - Math.exp(-(tailAge < 75 ? 45 : tailPressing ? 52 : 16) * dt))
  const tipFollow = 1 - Math.exp(-34 * dt)
  tailState.tipX += (tailCtrl.targetX - tailState.tipX) * tipFollow
  tailState.tipY += (tailCtrl.targetY - tailState.tipY) * tipFollow
  tailState.impactSquash = Math.max(0, tailState.impactSquash - dt * 6.5)
  const tipRel = hip.x + 46 - tailState.tipX
  tailState.crossLeft += (Math.max(0, Math.min(1, tipRel / (kbWidth * 0.65))) - tailState.crossLeft) * (1 - Math.exp(-9 * dt))
  tailState.tailFlick = params.actKind === 'tail' ? Math.sin(params.actU * Math.PI * 2) * 7.5 : 0
  tailState.tailRecoil = params.tailRecoil

  let thumpPhase = params.thumpPhase
  let tLift = 0
  let tLash = 0
  if (params.crossAmount > 0.08 && tailState.reach < 0.25) {
    const prevP = thumpPhase
    thumpPhase += dt * 2.55
    const beat = Math.floor(thumpPhase)
    const u = thumpPhase - beat
    if (beat % 4 !== 3) {
      tLift = u < 0.58 ? smoothstep01(0, 0.58, u) : u < 0.72 ? 1 - ((u - 0.58) / 0.14) ** 2 : 0
      if (params.isCross && prevP < beat + 0.72 && thumpPhase >= beat + 0.72) {
        params.onSlam(Math.min(logicalW - 22, hip.x + 132), hip.y + 26)
      }
    }
    tLash = Math.sin(thumpPhase * Math.PI * 0.5)
  }
  const thumpLift = params.thumpLift + (tLift - params.thumpLift) * (1 - Math.exp(-38 * dt))
  const thumpLash = params.thumpLash + (tLash - params.thumpLash) * (1 - Math.exp(-18 * dt))
  tailState.thumpLift = thumpLift
  tailState.thumpLash = thumpLash
  tailState.driftPhase = params.tailDriftPhase
  return { thumpPhase, thumpLift, thumpLash }
}

export function stepKuroCatPaw(
  paw: KuroCatPawState,
  dt: number,
  now: number,
  ctx: {
    heldEntry?: { specId: string; x: number; y: number; at: number; tail: boolean }
    anyHeld: boolean
    idleAct: IdleFidget | null
    scruffAmount: number
    scruffSwing: number
    groomAmount: number
    stretchAmount: number
    kneadAmount: number
    kneadPhase: number
    faceTurnX: number
    catCenterX: number
    catBaseY: number
    kbCenterY: number
    kbHeight: number
    mouseBaseX: number
    mouseBaseY: number
    mouseOffsetX: number
    mouseOffsetY: number
    mouseButtons: number
    mouseLeftPress: number
    mouseRightPress: number
    mouseMiddlePress: number
    lastMouseMoveAt: number
    lastAnyKeyAt: number
    elapsed: number
    spinePoint: (t: number, breath: number) => Vec2
    liveCurledPawPos: (paw: KuroCatPawState, breath: number) => Vec2
    clampToKeyboardSurface: (pt: Vec2) => Vec2
  }
): void {
  const { heldEntry } = ctx
  const sideSign = paw.side === 'left' ? -1 : 1
  const act = ctx.idleAct
  const actU = act ? Math.max(0, Math.min(1, (now - act.t0) / act.dur)) : 0

  if (ctx.scruffAmount > 0.14) {
    paw.mode = 'scruff'
    const chest = ctx.spinePoint(0.72, 0)
    const sway = Math.max(-1.6, Math.min(1.6, ctx.scruffSwing)) * 7.5 + Math.sin(ctx.elapsed * 5.2 + sideSign * 0.7) * 2.5
    paw.target = { x: chest.x + sideSign * 22 + sway, y: chest.y + 8 }
  } else if (act?.kind === 'groom' && ((act.side < 0 && paw.side === 'left') || (act.side > 0 && paw.side === 'right')) && ctx.groomAmount > 0.08 && !heldEntry) {
    paw.mode = 'groom'
    const hp = ctx.spinePoint(0.24, 0)
    const mx = hp.x + ctx.faceTurnX * 0.55 + sideSign * 14, my = hp.y + 20
    if (actU < 0.44) {
      const beat = actU > 0.12 ? Math.sin((((actU - 0.12) / 0.32) * 2 % 1) * Math.PI) : 0
      paw.target = { x: mx, y: my - beat * 5.5 }
    } else {
      const frac = Math.min(1.999, ((actU - 0.44) / 0.40) * 2) % 1
      paw.target = frac < 0.35
        ? { x: mx + sideSign * 26 * (frac / 0.35), y: my - 52 * (frac / 0.35) }
        : { x: hp.x + sideSign * (42 - ((frac - 0.35) / 0.65) * 16), y: hp.y - 34 + ((frac - 0.35) / 0.65) * 50 }
    }
  } else if (ctx.stretchAmount > 0.10 && !heldEntry && paw.mode !== 'mouse') {
    paw.mode = 'stretch'
    const kbTop = ctx.kbCenterY - ctx.kbHeight * 0.28
    paw.target = { x: ctx.catCenterX + sideSign * (24 + ctx.stretchAmount * 34), y: ctx.catBaseY + ctx.stretchAmount * (kbTop - ctx.catBaseY + 12) }
  } else if (ctx.kneadAmount > 0.10 && !heldEntry && paw.mode !== 'mouse') {
    paw.mode = 'knead'
    const ph = ctx.kneadPhase + (paw.side === 'left' ? 0 : Math.PI)
    paw.target = {
      x: ctx.catCenterX + sideSign * 28,
      y: ctx.kbCenterY - ctx.kbHeight * 0.36 - Math.max(0, Math.sin(ph)) * 13 + Math.max(0, -Math.sin(ph)) * 3.5
    }
  } else if (paw.mode === 'scruff' || paw.mode === 'groom' || paw.mode === 'stretch' || paw.mode === 'knead') {
    paw.mode = heldEntry ? 'poke' : 'idle'
  }

  if (paw.mode === 'mouse') {
    const lrBias = ctx.mouseLeftPress - ctx.mouseRightPress
    const anyClick = Math.max(ctx.mouseLeftPress, ctx.mouseRightPress, ctx.mouseMiddlePress)
    paw.target = {
      x: ctx.mouseBaseX + ctx.mouseOffsetX + 1.2 + lrBias * 6.4,
      y: ctx.mouseBaseY + ctx.mouseOffsetY - 11.5 + anyClick * 3.6
    }
    if (ctx.mouseButtons === 0 && now - ctx.lastMouseMoveAt >= 2200) {
      paw.mode = heldEntry ? 'poke' : 'idle'
    }
  } else if (paw.mode !== 'scruff' && paw.mode !== 'groom' && paw.mode !== 'stretch' && paw.mode !== 'knead') {
    if (heldEntry) {
      paw.mode = 'poke'
      paw.target = { x: heldEntry.x, y: heldEntry.y }
      paw.pokeTime = Math.min(paw.pokeTime + dt, 0.10)
    } else if (paw.mode === 'poke') {
      paw.pokeTime += dt
      if (paw.pokeTime > 0.13) {
        paw.mode = paw.side === 'left' && (ctx.mouseButtons !== 0 || now - ctx.lastMouseMoveAt < 450)
          ? 'mouse'
          : (now - ctx.lastAnyKeyAt < 650 || ctx.anyHeld) ? 'curled' : 'idle'
      }
    } else if (paw.mode === 'curled' && now - ctx.lastAnyKeyAt > 680 && !ctx.anyHeld) {
      paw.mode = 'idle'
    }
    if (paw.mode === 'curled') paw.target = ctx.liveCurledPawPos(paw, 0)
    else if (paw.mode === 'idle') {
      const base = ctx.spinePoint(1.0, 0)
      paw.target = { x: base.x + sideSign * 19, y: base.y }
    }
  }

  const blend = 1 - Math.exp(-20 * dt)
  paw.idleWeight += ((paw.mode === 'idle' ? 1 : 0) - paw.idleWeight) * blend
  paw.curlWeight += ((paw.mode === 'curled' ? 1 : 0) - paw.curlWeight) * blend

  const rate = paw.mode === 'poke' ? 42 : paw.mode === 'mouse' ? 32 : 23
  const follow = 1 - Math.exp(-rate * dt)
  paw.pos.x += (paw.target.x - paw.pos.x) * follow
  paw.pos.y += (paw.target.y - paw.pos.y) * follow
  if (paw.mode === 'poke') {
    const clamped = ctx.clampToKeyboardSurface(paw.pos)
    paw.pos.x = clamped.x
    paw.pos.y = Math.min(paw.pos.y, clamped.y)
  }
  paw.impactSquash = Math.max(0, paw.impactSquash - dt * 7.5)
  for (const s of paw.smears) s.alpha -= dt * 3.8
  paw.smears = paw.smears.filter((s) => s.alpha > 0.02)
}
