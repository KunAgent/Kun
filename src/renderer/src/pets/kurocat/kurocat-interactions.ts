import type { PetCursorSample } from '@shared/pets'
import type { KuroCatTailKeyMode } from '@shared/pets-kurocat'
import type { PetTypingState } from '@shared/pets-typing'
import { petAudio } from '../pet-audio'
import type { KuroCatTailState } from './kurocat-body-renderer'
import type { KuroCatFxParticle, KuroCatPawState } from './kurocat-eyes-renderer'
import {
  getKuroCatKeyboardLayout,
  resolveKuroCatKeyForStrike,
  type KuroCatKeyAnim,
  type KuroCatKeyBubble,
  type KuroCatKeySpec,
  type KuroCatMouseBadge,
  type Vec2
} from './kurocat-keyboard-desk'
import {
  clampToKuroCatKeyboardSurface,
  getKuroCatKeyWorldCenter,
  kuroCatViewportTransform,
  projectKuroCatKeyboardPoint,
  spawnKuroCatKeyBubble,
  type KuroCatBoardGeometry
} from './kurocat-paw-stepper'

const TAIL_PAT_WINDUP_GAP_MS = 260

export interface KuroCatHeldSlot {
  specId: string
  x: number
  y: number
  at: number
  tail: boolean
}

export interface KuroCatStrikeHost {
  geo: KuroCatBoardGeometry
  tailKeyMode: KuroCatTailKeyMode
  tailKeyIdSet: ReadonlySet<string>
  showKeyBubbles: boolean
  catCenterX: number
  mouseButtons: number
  lastMouseMoveAt: number
  lastAnyKeyAt: number
  recentKeyTimes: number[]
  lastSpacePaw: 'left' | 'right'
  typingEnergy: number
  typingGroovePhase: number
  lastKeyBias: number
  bodyBob: number
  kbBounce: number
  strikeRockVel: number
  typingSwayVel: number
  earTwitchLeft: number
  earTwitchRight: number
  crossUntil: number
  leftPaw: KuroCatPawState
  rightPaw: KuroCatPawState
  tailState: KuroCatTailState
  tailCtrl: { active: boolean; targetX: number; targetY: number; tapAt: number; patAt: number; releaseAt: number }
  heldSlots: Map<'left' | 'right', KuroCatHeldSlot>
  keyAnims: Map<string, KuroCatKeyAnim>
  bubbles: KuroCatKeyBubble[]
  nextBubbleId: () => number
  wakeCat: (now: number, mode: 'gentle' | 'abrupt') => void
  kickSquash: (dv: number) => void
  kickHeadTilt: (dv: number) => void
  spinePoint: (t: number, breath: number) => Vec2
  liveShoulder: (paw: KuroCatPawState, breath: number) => Vec2
  liveCurledPawPos: (paw: KuroCatPawState, breath: number) => Vec2
}

function shouldUseTail(host: KuroCatStrikeHost, spec: KuroCatKeySpec, activelyMousing: boolean, prevKeyAt: number, now: number): boolean {
  if (host.tailKeyMode === 'off') return false
  if (host.tailKeyMode === 'custom') return host.tailKeyIdSet.has(spec.id)
  if (spec.id === 'enter' || spec.id === 'bs' || spec.id === 'esc' || spec.id === 'np_ent') return true
  return spec.id === 'space' && (activelyMousing || (now - prevKeyAt < 420 && host.recentKeyTimes.length >= 2))
}

export function triggerKuroCatStrike(
  host: KuroCatStrikeHost,
  side: 'left' | 'right',
  col: number | undefined,
  row: number | undefined,
  sequence: number,
  isSpace: boolean,
  now: number
): void {
  const { geo } = host
  const { spec, bubbleLabel } = resolveKuroCatKeyForStrike({ layoutId: geo.keyboardLayout, side, col, row, sequence, isSpace })
  host.wakeCat(now, 'abrupt')
  const prevKeyAt = host.lastAnyKeyAt
  host.lastAnyKeyAt = now
  host.recentKeyTimes.push(now)
  if (host.recentKeyTimes.length > 26) host.recentKeyTimes.shift()
  if (host.recentKeyTimes.filter((t) => now - t <= 165).length >= 5) host.crossUntil = Math.max(host.crossUntil, now + 1800)

  const anim = host.keyAnims.get(spec.id) ?? { pressed: false, pressAmount: 0, lastHitAt: 0 }
  anim.pressed = true; anim.pressAmount = 1; anim.lastHitAt = now
  host.keyAnims.set(spec.id, anim)

  host.bodyBob = Math.min(1.15, host.bodyBob + 0.65)
  host.kbBounce = Math.min(1, host.kbBounce + 0.45)
  host.kickSquash(1.85)
  if (Math.random() < 0.16) {
    if (Math.random() < 0.5) host.earTwitchLeft = 1; else host.earTwitchRight = 1
  }

  const layout = getKuroCatKeyboardLayout(geo.keyboardLayout)
  const isCat = geo.keyboardOrientation === 'cat'
  const keyColCenter = spec.uStart + spec.uWidth * 0.5
  const screenKeyCol = isCat ? layout.totalUnits - keyColCenter : keyColCenter
  const keyBias = Math.max(-1, Math.min(1, (screenKeyCol - layout.totalUnits * 0.5) / (layout.totalUnits * 0.34)))
  host.lastKeyBias = keyBias
  host.typingGroovePhase += 1.22

  const activelyMousing = host.mouseButtons !== 0 || now - host.lastMouseMoveAt < 380
  const rawPt = getKuroCatKeyWorldCenter(geo, spec)
  if (shouldUseTail(host, spec, activelyMousing, prevKeyAt, now)) {
    const clampedTail = clampToKuroCatKeyboardSurface(geo, rawPt)
    if (!host.tailCtrl.active && host.tailState.reach < 0.08) {
      const hip = host.spinePoint(0.84, 0)
      host.tailState.tipX = hip.x + 126; host.tailState.tipY = hip.y - 37
    }
    host.tailCtrl.active = true; host.tailCtrl.targetX = clampedTail.x; host.tailCtrl.targetY = clampedTail.y
    if (now - host.tailCtrl.patAt >= TAIL_PAT_WINDUP_GAP_MS) host.tailCtrl.tapAt = now
    host.tailCtrl.patAt = now; host.tailState.impactSquash = 1.0
    host.heldSlots.set(side, { specId: spec.id, x: clampedTail.x, y: clampedTail.y, at: now, tail: true })
    const tSign = clampedTail.x >= host.catCenterX ? 1 : -1
    host.strikeRockVel += tSign * (0.95 + host.typingEnergy * 0.65)
    host.kickHeadTilt(tSign * 0.32)
    if (host.showKeyBubbles) spawnKuroCatKeyBubble(host.bubbles, geo, host.nextBubbleId(), bubbleLabel, spec.id === 'space', clampedTail.x, now)
    return
  }

  let chosen: KuroCatPawState
  let targetPoint = rawPt
  if (spec.id === 'space') {
    if (activelyMousing) chosen = host.rightPaw
    else {
      host.lastSpacePaw = host.lastSpacePaw === 'left' ? 'right' : 'left'
      chosen = host.lastSpacePaw === 'left' ? host.leftPaw : host.rightPaw
    }
    const spaceU = isCat
      ? (chosen.side === 'left' ? spec.uStart + spec.uWidth * 0.68 : spec.uStart + spec.uWidth * 0.32)
      : (chosen.side === 'left' ? spec.uStart + spec.uWidth * 0.32 : spec.uStart + spec.uWidth * 0.68)
    targetPoint = projectKuroCatKeyboardPoint(geo, spaceU, (spec.rowY ?? spec.row) + 0.5)
  } else if (activelyMousing) {
    chosen = host.rightPaw
  } else {
    const splitCol = geo.keyboardLayout === '108' ? (isCat ? 12.2 : 8.4) : 7.5
    chosen = screenKeyCol < splitCol ? host.leftPaw : host.rightPaw
  }

  const sideSign = chosen.side === 'left' ? -1 : 1
  host.strikeRockVel += sideSign * (1.75 + host.typingEnergy * 1.25)
  host.kickHeadTilt(sideSign * 0.42)
  if (!activelyMousing) host.typingSwayVel += (keyBias * 2.1 + Math.cos(host.typingGroovePhase) * 1.65) * (0.9 + host.typingEnergy * 0.45)

  const prevShoulder = host.liveShoulder(chosen, 0)
  if (chosen.mode === 'poke' && Math.hypot(targetPoint.x - chosen.pos.x, targetPoint.y - chosen.pos.y) > 22) {
    chosen.smears.push({ sx: prevShoulder.x, sy: prevShoulder.y, px: chosen.pos.x, py: chosen.pos.y, alpha: 0.28 })
    if (chosen.smears.length > 3) chosen.smears.shift()
  }
  if (chosen.mode === 'curled' || chosen.mode === 'idle') {
    const start = host.liveCurledPawPos(chosen, 0)
    chosen.pos = { x: start.x, y: start.y }
  }
  const clampedTarget = clampToKuroCatKeyboardSurface(geo, targetPoint)
  chosen.mode = 'poke'; chosen.target = clampedTarget; chosen.pokeTime = 0; chosen.impactSquash = 0.85; chosen.lastActiveAt = now
  host.heldSlots.set(side, { specId: spec.id, x: clampedTarget.x, y: clampedTarget.y, at: now, tail: false })

  const other = chosen.side === 'left' ? host.rightPaw : host.leftPaw
  if (other.mode === 'idle' && !activelyMousing) { other.mode = 'curled'; other.lastActiveAt = now }
  if (host.showKeyBubbles) spawnKuroCatKeyBubble(host.bubbles, geo, host.nextBubbleId(), bubbleLabel, spec.id === 'space', clampedTarget.x, now)
}

export function diffKuroCatTypingState(
  typing: PetTypingState | undefined,
  seen: { seq: [number, number] | null; struckAt: [number, number] },
  now: number,
  onStrike: (side: 'left' | 'right', col: number | undefined, row: number | undefined, sequence: number, isSpace: boolean) => void,
  onRelease: (side: 'left' | 'right') => void
): void {
  const held = typing?.held ?? 0
  if (!typing) {
    onRelease('left'); onRelease('right')
    return
  }
  if (!seen.seq) {
    seen.seq = [typing.left.sequence, typing.right.sequence]
    seen.struckAt = [typing.left.struckAt, typing.right.struckAt]
    const lFresh = typing.left.struckAt > 0 && now - typing.left.struckAt < 220
    const rFresh = typing.right.struckAt > 0 && now - typing.right.struckAt < 220
    if (lFresh && rFresh && typing.left.struckAt === typing.right.struckAt) {
      onStrike('right', 2, 2, typing.left.sequence, true)
    } else {
      if (lFresh) onStrike('left', typing.left.col, typing.left.row, typing.left.sequence, false)
      if (rFresh) onStrike('right', typing.right.col, typing.right.row, typing.right.sequence, false)
    }
  } else {
    const lNew = (typing.left.sequence > seen.seq[0] || typing.left.struckAt > seen.struckAt[0]) && now - typing.left.struckAt < 350
    const rNew = (typing.right.sequence > seen.seq[1] || typing.right.struckAt > seen.struckAt[1]) && now - typing.right.struckAt < 350
    seen.seq[0] = typing.left.sequence; seen.seq[1] = typing.right.sequence
    if (typing.left.struckAt > seen.struckAt[0]) seen.struckAt[0] = typing.left.struckAt
    if (typing.right.struckAt > seen.struckAt[1]) seen.struckAt[1] = typing.right.struckAt
    if (lNew && rNew && typing.left.struckAt === typing.right.struckAt) {
      onStrike('right', 2, 2, typing.left.sequence, true)
    } else {
      if (lNew) onStrike('left', typing.left.col, typing.left.row, typing.left.sequence, false)
      if (rNew) onStrike('right', typing.right.col, typing.right.row, typing.right.sequence, false)
    }
  }
  if ((held & 1) === 0) onRelease('left')
  if ((held & 2) === 0) onRelease('right')
}

export function applyKuroCatCursorSample(
  cursor: PetCursorSample | null | undefined,
  now: number,
  state: {
    cursorRelX: number; cursorRelY: number; lastCursorEyeAt: number
    lastMouseNx: number; lastMouseNy: number; lastMouseMoveAt: number
    mouseTargetOffX: number; mouseTargetOffY: number; mouseOffsetX: number; mouseOffsetY: number
    mouseBaseX: number; mouseBaseY: number
    mouseButtons: number; mouseLeftPress: number; mouseRightPress: number; mouseMiddlePress: number; mouseScrollFlash: number
    lastClickSeq: number; lastWheelSeq: number; curiousUntil: number
    leftPaw: KuroCatPawState; mouseBadges: KuroCatMouseBadge[]
    colors: { left: string; right: string; middle: string }
    nextBadgeId: () => number
    wakeGentle: () => void
  }
): void {
  if (!cursor) return
  if (cursor.active) {
    state.cursorRelX = cursor.nx; state.cursorRelY = cursor.ny; state.lastCursorEyeAt = now
    const step = state.lastMouseNx >= 0 ? Math.hypot(cursor.nx - state.lastMouseNx, cursor.ny - state.lastMouseNy) : 0
    if (step > 0.004 && !cursor.overMascot) {
      state.lastMouseMoveAt = now; state.wakeGentle()
      state.mouseTargetOffX = (0.5 - cursor.nx) * 34; state.mouseTargetOffY = (0.5 - cursor.ny) * 20
      if (state.leftPaw.mode !== 'poke') state.leftPaw.mode = 'mouse'
      if (step > 0.085) state.curiousUntil = Math.max(state.curiousUntil, now + 1800)
    }
    state.lastMouseNx = cursor.nx; state.lastMouseNy = cursor.ny
  }
  const prevBtns = state.mouseButtons
  state.mouseButtons = cursor.buttons & 7
  const newlyPressed = state.mouseButtons & ~prevBtns
  const clickTrigger = cursor.clickSeq && cursor.clickSeq !== state.lastClickSeq ? (cursor.clickMask ?? 0) : 0
  if (cursor.clickSeq) state.lastClickSeq = cursor.clickSeq
  const badgeMask = newlyPressed | clickTrigger
  if (badgeMask !== 0 && !cursor.overMascot) {
    state.lastMouseMoveAt = now; state.wakeGentle()
    if (state.leftPaw.mode !== 'poke') state.leftPaw.mode = 'mouse'
    const pushBadge = (label: 'LMB' | 'RMB' | 'MMB', color: string): void => {
      if (state.mouseBadges.length >= 3) state.mouseBadges.shift()
      state.mouseBadges.push({ id: state.nextBadgeId(), label, color, x: state.mouseBaseX + state.mouseOffsetX, y: state.mouseBaseY + state.mouseOffsetY - 28, createdAt: now, lifetime: 780 })
    }
    if (badgeMask & 1) { state.mouseLeftPress = 1; pushBadge('LMB', state.colors.left) }
    if (badgeMask & 2) { state.mouseRightPress = 1; pushBadge('RMB', state.colors.right) }
    if (badgeMask & 4) { state.mouseMiddlePress = 1; pushBadge('MMB', state.colors.middle) }
  }
  if (cursor.wheelSeq !== state.lastWheelSeq) {
    state.lastWheelSeq = cursor.wheelSeq
    if (!cursor.overMascot) {
      state.mouseScrollFlash = 1; state.lastMouseMoveAt = now
      if (state.leftPaw.mode !== 'poke') state.leftPaw.mode = 'mouse'
    }
  }
}

export function applyKuroCatStageTap(
  geo: KuroCatBoardGeometry,
  stageX: number,
  stageY: number,
  stageW: number,
  stageH: number,
  now: number,
  tailPoints: ReadonlyArray<Vec2>,
  faceTurnX: number,
  spinePoint: (t: number, breath: number) => Vec2,
  fxParticles: KuroCatFxParticle[],
  callbacks: {
    wakeGentle: () => void
    onTailPoke: () => void
    onNoseBoop: () => void
    onChinTap: () => void
    onHeadPat: () => void
  }
): void {
  const vt = kuroCatViewportTransform(geo.keyboardLayout, stageW, stageH)
  const lx = (stageX - vt.offsetX) / vt.uniformScale
  const ly = (stageY - vt.offsetY) / vt.uniformScale
  callbacks.wakeGentle()

  for (const pt of tailPoints) {
    if (Math.hypot(lx - pt.x, ly - pt.y) < 22) {
      callbacks.onTailPoke()
      petAudio.playPatBoop()
      return
    }
  }
  const head = spinePoint(0.24, 0)
  if (Math.hypot(lx - (head.x + faceTurnX * 0.72), ly - (head.y + 11)) < 16) {
    callbacks.onNoseBoop()
    fxParticles.push({ kind: 'sneeze', x: head.x + 14, y: head.y + 16, vx: 22, vy: 8, size: 14, createdAt: now, lifetime: 520 })
    petAudio.playPatBoop()
    return
  }
  if (ly > head.y + 14 && ly < head.y + 46 && Math.abs(lx - head.x) < 38) callbacks.onChinTap()
  else callbacks.onHeadPat()
  const crown = spinePoint(0.16, 0)
  fxParticles.push({ kind: 'heart', x: crown.x + (Math.random() - 0.5) * 32, y: crown.y - 18, vx: (Math.random() - 0.5) * 14, vy: -34, size: 15, createdAt: now, lifetime: 980 })
  petAudio.playPatBoop()
}
