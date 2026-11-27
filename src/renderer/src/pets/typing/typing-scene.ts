import { petTypingCutouts, petTypingRig } from './typing-rig'
import type { PetSummary } from '@shared/pets'
import type { JointFrame } from '../joint/timeline'
import { armLayerContact } from '../joint/arm-layer'
import { actor, ASPECT, bodyPoint, clamp, ease, grip, lerp, resetLimbs, type Point } from '../joint/geometry'
import type { KeyboardPopSurface, PetMousePadSurface } from './keyboard-surface'
import { DESK_EXIT_FADE_MS, type TypingMotion } from './typing-motion'

export function typingScene(input: {
  pet: PetSummary; width: number; height: number; mascotWidth: number; origin: Point
  motion: TypingMotion; expiresAt: number; now: number; enteredAt: number; paused: boolean; reduced?: boolean
}): JointFrame {
  const { width, height, motion, pet } = input
  const size = Math.min(input.mascotWidth, width - 30)
  const xiaoKun = pet.id === 'kun:xiao-kun'
  const boardW = Math.min(width - 24, size * (xiaoKun ? .98 : 1.12))
  const boardH = Math.max(xiaoKun ? 29 : 31, size * (xiaoKun ? .265 : .285))
  const boardInset = xiaoKun ? size * .055 + 1.5 : 1.5, caseDepth = Math.max(6, size * .055)
  const fadeWindow = motion.desk !== undefined ? DESK_EXIT_FADE_MS : 220
  const fade = input.paused ? 1 : ease(clamp((input.expiresAt - input.now) / fadeWindow))
  const entrance = motion.desk !== undefined
    ? (input.reduced ? (motion.desk > .5 ? 1 : 0) : Math.min(clamp(motion.desk), fade))
    : ease(clamp((input.now - input.enteredAt) / 70)) * fade

  const a = actor(pet, { x: input.origin.x, y: input.origin.y }, size)
  a.rig = petTypingRig(pet) ?? a.rig
  const cutouts = petTypingCutouts(pet)
  const shoulderOffset = (Math.max(...a.rig.arms.map((arm) => arm.shoulder[1])) - .5) * size * ASPECT

  const padGap = xiaoKun ? Math.max(4, size * .045) : Math.max(3.5, size * .038)
  const rawPadW = motion.mouse ? Math.min(Math.max(26, size * .37), width - boardW - padGap - 24) : 0
  const hasPad = Boolean(motion.mouse && rawPadW >= 22)
  const padW = hasPad ? rawPadW : 0
  const totalDeskW = hasPad ? boardW + padGap + padW : boardW

  const deskLeft = hasPad
    ? clamp(input.origin.x - totalDeskW / 2, 12, width - totalDeskW - 12)
    : clamp(input.origin.x - boardW / 2, 12, width - boardW - 12)
  const boardStartX = hasPad ? deskLeft + padW + padGap : deskLeft
  const boardCenterX = boardStartX + boardW / 2

  let fittedX = hasPad ? boardCenterX + (motion.shiftX ?? 0) * size * .045 : clamp(input.origin.x, boardW / 2 + 12, width - boardW / 2 - 12)
  if (hasPad && motion.mouse) {
    const padX = deskLeft
    const mouseX = padX + padW * (.38 + .34 * motion.mouse.nx)
    const shoulder0Offset = (a.rig.arms[0].shoulder[0] - .5) * size
    const comfortReach = xiaoKun ? size * .055 : pet.sourceId === 'whale-girl' ? size * .018 : pet.sourceId === 'kurocat' ? size * .038 : size * .032
    const mouseAnchorX = clamp(mouseX - shoulder0Offset + comfortReach, padX + padW * .48, boardCenterX)
    fittedX = clamp(lerp(fittedX, mouseAnchorX, motion.mouse.active), size * .42, width - size * .42)
  }
  const fittedY = Math.min(input.origin.y, height - boardH - Math.max(16, xiaoKun ? caseDepth + 4 : 16) - shoulderOffset - boardInset)

  a.root.x = lerp(input.origin.x, fittedX, entrance)
  a.root.y = lerp(input.origin.y, fittedY, entrance) + (a.rig.ground - .5) * size * ASPECT
  a.lean = (motion.lean ?? 0) * entrance
  a.headTilt = (motion.headTilt ?? 0) * entrance
  a.gaze = motion.gaze
  a.soloBlend = 1 - entrance
  resetLimbs(a)

  const shoulders = a.rig.arms.map((arm) => bodyPoint(a, arm.shoulder))
  const boardY = Math.max(...shoulders.map((p) => p.y)) + boardInset
  const boardX = hasPad ? boardStartX : clamp(a.root.x - boardW / 2, 12, width - boardW - 12)

  let mousePad: PetMousePadSurface | undefined
  if (hasPad && motion.mouse) {
    const padX = deskLeft
    const padH = boardH * 1.06, padY = boardY - boardH * .10
    mousePad = {
      x: padX, y: padY, width: padW, height: padH,
      mouseX: padX + padW * (.38 + .34 * motion.mouse.nx),
      mouseY: padY + padH * (.34 + .24 * motion.mouse.ny),
      leftButton: motion.mouse.leftButton,
      rightButton: motion.mouse.rightButton,
      middleButton: motion.mouse.middleButton,
      leftPress: motion.mouse.leftPress,
      rightPress: motion.mouse.rightPress,
      middlePress: motion.mouse.middlePress,
      wheelGlow: motion.mouse.wheelGlow,
      wheelDir: motion.mouse.wheelDir
    }
  }

  const keys = [motion.left, motion.right].map((paw, index) => {
    const side = index as 0 | 1, shoulder = shoulders[side], rest = a.hands[side]
    const originalLength = Math.hypot(rest.x - shoulder.x, rest.y - shoulder.y)
    const length = originalLength * (cutouts?.[side].scale ?? 1)
    const depth = Math.min(xiaoKun ? 1.3 : 1.8, length * .24), direction = (side ? 1 : -1) * (xiaoKun ? -1 : 1)
    const baseDownY = shoulder.y + length * .70 + depth
    const baseDownX = shoulder.x + direction * Math.sqrt(Math.max(0, length * length - (baseDownY - shoulder.y) ** 2))
    const lift = Math.min(xiaoKun ? 5 : 8, length * (xiaoKun ? .25 : .4))

    let downX = baseDownX
    let downY = baseDownY
    let x: number
    let y: number

    if (paw.col !== undefined && paw.row !== undefined) {
      const colCenter = side === 0 ? 1 : 4
      const zoneOffset = (paw.col - colCenter) / 1.5
      const rowOffset = paw.row - 1
      const wantDownY = clamp(baseDownY + rowOffset * Math.min(length * .16, boardH * .18), shoulder.y + length * .46, shoulder.y + length * .92)
      const wantDownX = baseDownX + zoneOffset * Math.min(length * .38, boardW * .14)
      const downAngle = Math.atan2(wantDownY - shoulder.y, wantDownX - shoulder.x)
      downX = shoulder.x + Math.cos(downAngle) * length
      downY = shoulder.y + Math.sin(downAngle) * length

      const liftY = clamp(downY - depth - lift * (1 - paw.down) + depth * paw.down, shoulder.y + length * .18, shoulder.y + length * .95)
      const liftAngle = Math.atan2(liftY - shoulder.y, wantDownX - shoulder.x)
      x = shoulder.x + Math.cos(liftAngle) * length
      y = shoulder.y + Math.sin(liftAngle) * length
    } else {
      y = downY - depth - lift * (1 - paw.down) + depth * paw.down
      x = shoulder.x + direction * Math.sqrt(Math.max(0, length * length - (y - shoulder.y) ** 2))
    }

    if (side === 0 && mousePad && motion.mouse && motion.mouse.active > .01) {
      const mBlend = motion.mouse.active
      const lPress = motion.mouse.leftPress ?? (motion.mouse.leftButton ? 1 : 0)
      const rPress = motion.mouse.rightPress ?? (motion.mouse.rightButton ? 1 : 0)
      const btnShiftX = (lPress - rPress) * Math.min(2.2, mousePad.width * .05)
      const mRestY = mousePad.mouseY - mousePad.height * .18
      const mPressY = mRestY - depth * (1 - paw.down) * .6 + Math.max(lPress, rPress, motion.mouse.middlePress ?? 0) * .55
      const mAngle = Math.atan2(mPressY - shoulder.y, mousePad.mouseX + btnShiftX - shoulder.x)
      const kDownAngle = Math.atan2(downY - shoulder.y, downX - shoulder.x)
      const kCurAngle = Math.atan2(y - shoulder.y, x - shoulder.x)
      const bDownAngle = lerp(kDownAngle, mAngle, mBlend)
      const bCurAngle = lerp(kCurAngle, mAngle, mBlend)
      downX = shoulder.x + Math.cos(bDownAngle) * length
      downY = shoulder.y + Math.sin(bDownAngle) * length
      x = shoulder.x + Math.cos(bCurAngle) * length
      y = shoulder.y + Math.sin(bCurAngle) * length
    }

    // Rotate a solid limb along a fixed-length arc. It cannot stretch into the desk.
    const from = Math.atan2(rest.y - shoulder.y, rest.x - shoulder.x)
    const to = Math.atan2(y - shoulder.y, x - shoulder.x)
    const angle = lerp(from, to, entrance), radius = lerp(originalLength, length, entrance)
    const target = { x: shoulder.x + Math.cos(angle) * radius, y: shoulder.y + Math.sin(angle) * radius }
    grip(a, side, { x: downX, y: downY }, 1)
    const contact = cutouts ? armLayerContact(a, side, cutouts[side]) : a.hands[side]
    grip(a, side, target, 1)
    const impact = xiaoKun && !paw.onMouse && !input.reduced && !input.paused ? clamp((paw.glow - .2) / .8) * ease((paw.down - .7) / .3) : 0
    return {
      x: contact.x, y: contact.y - depth, depth, down: paw.down, glow: paw.glow, impact,
      onMouse: paw.onMouse, col: paw.col, row: paw.row, sequence: paw.sequence
    }
  })

  if (cutouts) a.armLayers = { cutouts, contactY: [keys[0].y + keys[0].depth * keys[0].down, keys[1].y + keys[1].depth * keys[1].down] }
  else a.frontArms = true
  const accent = pet.sourceId === 'ikun'
    ? '#e6a75e'
    : pet.sourceId === 'whale-girl'
      ? '#83bfdc'
      : pet.sourceId === 'kurocat'
        ? '#d4f044'
        : '#c8b37c'
  const pops: KeyboardPopSurface[] | undefined = motion.pops?.map((pop) => {
    const isMouse = pop.kind === 'mouse-left' || pop.kind === 'mouse-right' || pop.kind === 'mouse-middle'
    const pawKey = pop.pawSide === 0 ? keys[0] : pop.pawSide === 1 ? keys[1] : undefined
    const px = isMouse && mousePad
      ? clamp(mousePad.mouseX - 5 + (pop.kind === 'mouse-left' ? 2.5 : pop.kind === 'mouse-right' ? -2.5 : 0), 15, width - 15)
      : pop.kind === 'space'
        ? boardX + boardW * 0.5
        : pawKey
          ? clamp(pawKey.x + (pop.col - (pop.pawSide === 0 ? 1 : 4)) * 1.8, boardX + 8, boardX + boardW - 8)
          : clamp(boardX + 10 + (clamp(pop.col, 0, 5) / 5) * (boardW - 20), 14, width - 14)
    const py = isMouse && mousePad ? mousePad.mouseY - mousePad.height * 0.42 - 3 : boardY - 3
    return { id: pop.id, kind: pop.kind, x: px, y: py, progress: pop.progress }
  })
  const keyboard = {
    x: boardX, y: boardY,
    width: boardW, height: boardH, left: keys[0], right: keys[1], opacity: entrance, accent,
    ...(motion.bounce !== undefined ? { bounce: motion.bounce } : {}),
    ...(motion.space ? { space: motion.space } : {}),
    ...(pops?.length ? { pops } : {}),
    ...(mousePad ? { mousePad } : {}),
    ...(xiaoKun ? { theme: 'xiao-kun' as const, caseDepth } : {})
  }
  return { actors: [a], keyboard, objects: [], links: [], blanket: null, charge: 0,
    contact: Math.max(motion.left.down, motion.right.down), beat: 0, focus: bodyPoint(a, a.rig.head),
    width, height, opacity: 1, phase: 'playing', progress: 0 }
}
