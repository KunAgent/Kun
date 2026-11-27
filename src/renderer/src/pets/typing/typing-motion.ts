import type { PetCursorSample } from '@shared/pets'
import { emptyPetTyping, type PetTypingState } from '@shared/pets-typing'

export type PawMotion = {
  down: number
  glow: number
  col?: number
  row?: number
  sequence?: number
  onMouse?: boolean
}

export type MouseDeskMotion = {
  active: number
  nx: number
  ny: number
  leftButton: boolean
  rightButton: boolean
  middleButton?: boolean
  leftPress: number
  rightPress: number
  middlePress: number
  wheelGlow: number
  wheelDir: -1 | 0 | 1
}

export type TypingKeyPop = {
  id: number
  kind: 'key' | 'space' | 'mouse-left' | 'mouse-right' | 'mouse-middle'
  col: number
  pawSide?: 0 | 1
  progress: number
}

export type TypingMotion = {
  left: PawMotion
  right: PawMotion
  moving: boolean
  desk?: number
  bounce?: number
  gaze?: { x: number; y: number }
  lean?: number
  headTilt?: number
  shiftX?: number
  space?: { down: number; glow: number }
  pops?: TypingKeyPop[]
  mouse?: MouseDeskMotion
}

export type PetGazeMemory = {
  gx: number; vx: number
  gy: number; vy: number
  tilt: number; vtilt: number
  lean: number; vlean: number
  lastAt: number | null
}

export type TypingDeskInput = {
  cursor?: PetCursorSample | null
  typingActive?: boolean
  deskExpiresAt?: number
  gaze?: PetGazeMemory
}

type Spring = { position: number; velocity: number; token: string }
type ScalarSpring = { pos: number; vel: number }

const clamp = (n: number, min = 0, max = 1): number => Math.max(min, Math.min(max, n))

export function createPetGazeMemory(): PetGazeMemory {
  return { gx: 0, vx: 0, gy: 0, vy: 0, tilt: 0, vtilt: 0, lean: 0, vlean: 0, lastAt: null }
}

function stepSecondOrder(
  state: ScalarSpring,
  target: number,
  freqHz: number,
  damping: number,
  delta: number,
  snap: boolean,
  eps = 0.0015
): boolean {
  if (snap) {
    state.pos = target
    state.vel = 0
    return false
  }
  const omega = 2 * Math.PI * freqHz
  const steps = Math.max(1, Math.ceil(delta * 240))
  const dt = delta / steps
  for (let i = 0; i < steps; i++) {
    const accel = omega * omega * (target - state.pos) - 2 * damping * omega * state.vel
    state.vel += accel * dt
    state.pos += state.vel * dt
  }
  if (Math.abs(state.pos - target) < eps && Math.abs(state.vel) < eps * 12) {
    state.pos = target
    state.vel = 0
    return false
  }
  return true
}

/** 240Hz lead-lag eye gaze (9.5Hz) and head/body parallax (2.9Hz) shared across idle and desk stages. */
export function stepPetGaze(
  memory: PetGazeMemory,
  targetX: number,
  targetY: number,
  extraTilt: number,
  extraLean: number,
  now: number,
  reduced: boolean
): { gaze: { x: number; y: number }; headTilt: number; lean: number; moving: boolean } {
  const rawElapsed = memory.lastAt === null ? 1 / 60 : Math.max(0, now - memory.lastAt) / 1000
  memory.lastAt = now
  const snap = reduced || rawElapsed > 0.6
  const delta = Math.min(rawElapsed, 0.05)

  const sx = { pos: memory.gx, vel: memory.vx }
  const sy = { pos: memory.gy, vel: memory.vy }
  const st = { pos: memory.tilt, vel: memory.vtilt }
  const sl = { pos: memory.lean, vel: memory.vlean }

  const m1 = stepSecondOrder(sx, clamp(targetX, -1, 1), 9.5, 1.0, delta, snap)
  const m2 = stepSecondOrder(sy, clamp(targetY, -1, 1), 9.5, 1.0, delta, snap)
  const tiltTarget = clamp(targetX * 0.066 + extraTilt, -0.095, 0.095)
  const leanTarget = clamp(targetX * 0.032 + extraLean, -0.088, 0.088)
  const m3 = stepSecondOrder(st, tiltTarget, 2.9, 0.92, delta, snap, 0.0008)
  const m4 = stepSecondOrder(sl, leanTarget, 2.9, 0.92, delta, snap, 0.0008)

  memory.gx = sx.pos; memory.vx = sx.vel
  memory.gy = sy.pos; memory.vy = sy.vel
  memory.tilt = st.pos; memory.vtilt = st.vel
  memory.lean = sl.pos; memory.vlean = sl.vel

  return {
    gaze: { x: memory.gx, y: memory.gy },
    headTilt: memory.tilt,
    lean: memory.lean,
    moving: !reduced && (m1 || m2 || m3 || m4)
  }
}

const POP_LIFETIME_MS = 540
export const DESK_EXIT_FADE_MS = 480

/** Real edges drive paw, mouse, and head-gaze springs. A held key never starts an artificial tapping loop. */
export class PetTypingMotion {
  private readonly paws: [Spring, Spring] = [
    { position: 0, velocity: 0, token: '' }, { position: 0, velocity: 0, token: '' }
  ]
  private readonly cols: [ScalarSpring, ScalarSpring] = [{ pos: 1, vel: 0 }, { pos: 4, vel: 0 }]
  private readonly rows: [ScalarSpring, ScalarSpring] = [{ pos: 1, vel: 0 }, { pos: 1, vel: 0 }]
  private readonly mouseMode: ScalarSpring = { pos: 0, vel: 0 }
  private readonly mouseNx: ScalarSpring = { pos: 0.5, vel: 0 }
  private readonly mouseNy: ScalarSpring = { pos: 0.5, vel: 0 }
  private readonly shiftX: ScalarSpring = { pos: 0, vel: 0 }
  private readonly desk: ScalarSpring = { pos: 0, vel: 0 }
  private readonly kbBounce: ScalarSpring = { pos: 0, vel: 0 }
  private readonly localGaze = createPetGazeMemory()
  private readonly activePops: Array<{ id: number; kind: TypingKeyPop['kind']; col: number; pawSide?: 0 | 1; createdAt: number }> = []
  private nextPopId = 1
  private seenSeq: [number, number] | null = null
  private seenStruckAt: [number, number] = [0, 0]
  private seenButtons = 0
  private seenClickSeq: number | null = null
  private lastClickedAt: [number, number, number] = [-Infinity, -Infinity, -Infinity]
  private buttonPress: [number, number, number] = [0, 0, 0]
  private lastWheelSeq = 0
  private lastWheelAt = -Infinity
  private lastWheelDir: -1 | 0 | 1 = 0
  private previous: number | null = null
  private frozen: TypingMotion = { left: { down: 0, glow: 0 }, right: { down: 0, glow: 0 }, moving: false }

  private pushPop(kind: TypingKeyPop['kind'], col: number, now: number, pawSide?: 0 | 1): void {
    if (this.activePops.length >= 6) this.activePops.shift()
    this.activePops.push({ id: this.nextPopId++, kind, col, pawSide, createdAt: now })
  }

  sample(
    input: PetTypingState | undefined,
    now: number,
    reduced = false,
    paused = false,
    deskInput?: TypingDeskInput
  ): TypingMotion {
    const state = input ?? emptyPetTyping()
    if (paused) { this.previous = now; return this.frozen }
    const previous = this.previous
    const elapsed = previous === null ? 1 / 60 : Math.max(0, now - previous) / 1000
    this.previous = now

    const cursor = deskInput?.cursor ?? null
    const mouseButtons = cursor?.buttons ?? 0
    let freshClickMask = 0
    if (deskInput && cursor) {
      if (cursor.clickSeq !== undefined) {
        if (this.seenClickSeq === null) {
          this.seenClickSeq = cursor.clickSeq
          if (cursor.clickSeq > 0 && cursor.clickedAt !== undefined && now >= cursor.clickedAt && now - cursor.clickedAt < 180) {
            freshClickMask |= cursor.clickMask ?? mouseButtons
          }
        } else if (cursor.clickSeq !== this.seenClickSeq) {
          this.seenClickSeq = cursor.clickSeq
          if (cursor.clickSeq > 0 && (cursor.clickedAt === undefined || (now >= cursor.clickedAt && now - cursor.clickedAt < 220))) {
            freshClickMask |= cursor.clickMask ?? (mouseButtons & ~this.seenButtons)
          }
        }
      }
      freshClickMask |= mouseButtons & ~this.seenButtons
    }
    this.seenButtons = mouseButtons

    const clickSpecs: Array<[0 | 1 | 2, number, TypingKeyPop['kind'], number]> = [
      [0, 1, 'mouse-left', -0.35],
      [1, 2, 'mouse-right', -0.85],
      [2, 4, 'mouse-middle', -0.6]
    ]
    for (const [idx, bit, popKind, popCol] of clickSpecs) {
      if (freshClickMask & bit) {
        this.lastClickedAt[idx] = now
        this.buttonPress[idx] = 1
        if (!reduced) this.pushPop(popKind, popCol, now)
      }
    }

    const latestMouseClickAt = Math.max(...this.lastClickedAt)
    const clickPulse = now - latestMouseClickAt < 110
    const rightKeyNewer = Boolean((state.held & 2) || (state.right.struckAt > 0 && state.right.struckAt >= Math.max(cursor?.deskActiveAt ?? 0, latestMouseClickAt)))
    const mouseRecent = Boolean(cursor && (mouseButtons !== 0 || clickPulse || (!rightKeyNewer && cursor.deskActiveAt > 0 && now - cursor.deskActiveAt < 950)))

    let moving = false
    const result = this.paws.map((spring, i): PawMotion => {
      if (deskInput && i === 0 && mouseRecent) {
        // Viewer-left paw (pet's right hand in mirror perspective) rests on the left-side mini-mouse.
        const clickHeld = Boolean(mouseButtons & 7) || clickPulse
        const target = clickHeld ? 1 : 0.24
        const delta = Math.min(elapsed, 0.05)
        if (!reduced && (freshClickMask & 7)) spring.velocity = Math.max(spring.velocity, 13)
        const sub = { pos: spring.position, vel: spring.velocity }
        const m = stepSecondOrder(sub, target, 13.5, 0.92, delta, reduced || elapsed > 0.4)
        spring.position = clamp(sub.pos, 0, 1.04)
        spring.velocity = sub.vel
        moving ||= !reduced && (m || clickPulse)
        return { down: clamp(spring.position), glow: clickHeld ? 0.8 : 0, onMouse: true }
      }

      // Without deskInput, preserve direct left/right channels; in desk mode, mirror user right->viewer left (0) and user left->viewer right (1).
      const useRerouted = Boolean(deskInput && i === 1 && mouseRecent && state.right.struckAt > state.left.struckAt)
      const paw = !deskInput
        ? (i ? state.right : state.left)
        : i === 0
          ? state.right
          : (useRerouted ? state.right : state.left)
      const heldMask = !deskInput
        ? (i ? 2 : 1)
        : i === 0
          ? 2
          : (mouseRecent ? 3 : 1)
      const held = Boolean(state.held & heldMask)
      const age = paw.struckAt ? Math.max(0, now - paw.struckAt) : Infinity
      const token = `${paw.sequence}:${paw.struckAt}`
      const target = held || age < 95 ? 1 : 0
      const fresh = (token !== spring.token && age < 140) ||
        (previous !== null && paw.releasedAt >= previous && now - paw.releasedAt < 120)
      const resumed = elapsed > .25 && !fresh
      const delta = Math.min(elapsed, fresh && elapsed > .25 ? 1 / 60 : .05)
      if (reduced || resumed) {
        spring.position = held ? 1 : 0; spring.velocity = 0; spring.token = token
      } else {
        if (spring.token !== token) {
          spring.token = token
          if (age < 140) spring.velocity = spring.position > .78 ? -7 : 30
        }
        const steps = Math.max(1, Math.ceil(delta * 120)), dt = delta / steps
        for (let step = 0; step < steps; step++) {
          spring.velocity += (900 * (target - spring.position) - 45 * spring.velocity) * dt
          spring.position = clamp(spring.position + spring.velocity * dt, -.04, 1.04)
        }
        if (Math.abs(spring.position - target) < .002 && Math.abs(spring.velocity) < .025) {
          spring.position = target; spring.velocity = 0
        }
      }
      const glow = reduced ? held ? .45 : 0 : Math.max(held ? .22 : 0, clamp(1 - age / 320))
      moving ||= !reduced && (Math.abs(spring.velocity) > .025 || Math.abs(spring.position - target) > .002 || age < 330)
      if (!deskInput) return { down: clamp(spring.position), glow }

      const activeKey = held || age < 2400
      const defaultCol = i ? 4 : 1
      const mirroredCol = paw.col !== undefined ? 5 - paw.col : undefined
      const mirroredRow = paw.row !== undefined ? 2 - paw.row : undefined
      const targetCol = !activeKey ? defaultCol
        : mirroredCol !== undefined ? (i === 1 && mouseRecent ? Math.max(1, mirroredCol) : mirroredCol)
        : i === 0 ? (paw.sequence * 2) % 3 : (mouseRecent ? 1 + ((paw.sequence * 2) % 5) : 3 + ((paw.sequence * 2) % 3))
      const targetRow = !activeKey ? 1 : mirroredRow !== undefined ? mirroredRow : (paw.sequence + i) % 3
      const mCol = stepSecondOrder(this.cols[i], targetCol, 13, 0.95, delta, reduced || resumed)
      const mRow = stepSecondOrder(this.rows[i], targetRow, 13, 0.95, delta, reduced || resumed)
      moving ||= !reduced && (mCol || mRow)
      return { down: clamp(spring.position), glow, col: this.cols[i].pos, row: this.rows[i].pos, sequence: paw.sequence }
    })

    if (!deskInput) {
      this.frozen = { left: result[0], right: result[1], moving }
      return this.frozen
    }

    const delta = Math.min(elapsed, 0.05)

    for (const [idx, bit] of clickSpecs) {
      const heldOrPulse = Boolean(mouseButtons & bit) || (now - this.lastClickedAt[idx] < 110)
      if (reduced) {
        this.buttonPress[idx] = (mouseButtons & bit) ? 1 : 0
      } else {
        const target = heldOrPulse ? 1 : 0
        const rate = target > this.buttonPress[idx] ? 44 : 18
        this.buttonPress[idx] += (target - this.buttonPress[idx]) * (1 - Math.exp(-rate * delta))
        if (!heldOrPulse && this.buttonPress[idx] < 0.008) this.buttonPress[idx] = 0
        if (this.buttonPress[idx] > 0 && !(mouseButtons & bit)) moving = true
      }
    }

    let freshKeyHit = false
    const rightKeyPaw: 0 | 1 = mouseRecent ? 1 : 0
    if (!this.seenSeq) {
      this.seenSeq = [state.left.sequence, state.right.sequence]
      this.seenStruckAt = [state.left.struckAt, state.right.struckAt]
      if (!reduced) {
        const leftFresh = state.left.struckAt > 0 && now - state.left.struckAt < 180
        const rightFresh = state.right.struckAt > 0 && now - state.right.struckAt < 180
        freshKeyHit = leftFresh || rightFresh
        if (leftFresh && rightFresh && state.left.struckAt === state.right.struckAt) {
          this.pushPop('space', 2.5, state.left.struckAt)
        } else {
          if (leftFresh) this.pushPop('key', 5 - (state.left.col ?? 1), state.left.struckAt, 1)
          if (rightFresh) this.pushPop('key', 5 - (state.right.col ?? 4), state.right.struckAt, rightKeyPaw)
        }
      }
    } else {
      const leftChanged = state.left.sequence > this.seenSeq[0] || state.left.struckAt > this.seenStruckAt[0]
      const rightChanged = state.right.sequence > this.seenSeq[1] || state.right.struckAt > this.seenStruckAt[1]
      const leftNew = leftChanged && state.left.struckAt > 0 && now - state.left.struckAt < 220
      const rightNew = rightChanged && state.right.struckAt > 0 && now - state.right.struckAt < 220
      freshKeyHit = leftNew || rightNew
      this.seenSeq[0] = state.left.sequence
      this.seenSeq[1] = state.right.sequence
      if (state.left.struckAt > this.seenStruckAt[0]) this.seenStruckAt[0] = state.left.struckAt
      if (state.right.struckAt > this.seenStruckAt[1]) this.seenStruckAt[1] = state.right.struckAt
      if (!reduced) {
        if (leftNew && rightNew && state.left.struckAt === state.right.struckAt) {
          this.pushPop('space', 2.5, now)
        } else {
          if (leftNew) this.pushPop('key', 5 - (state.left.col ?? ((state.left.sequence * 2) % 3)), now, 1)
          if (rightNew) this.pushPop('key', 5 - (state.right.col ?? (3 + ((state.right.sequence * 2) % 3))), now, rightKeyPaw)
        }
      }
    }

    const typingActive = Boolean(deskInput.typingActive || state.held !== 0 ||
      Math.max(state.left.struckAt, state.right.struckAt) > now - 1800)
    const expiresAt = deskInput.deskExpiresAt
    const exitAt = expiresAt === undefined ? Infinity : expiresAt - DESK_EXIT_FADE_MS
    const deskTarget = expiresAt !== undefined
      ? (now < exitAt || state.held !== 0 || mouseButtons !== 0 ? 1 : 0)
      : (typingActive || mouseButtons !== 0 || Boolean(cursor?.deskActiveAt && now - cursor.deskActiveAt < 2000) ? 1 : 0)
    const snap = reduced || (elapsed > 0.6 && !(this.desk.pos > 0.5 && deskTarget === 1))

    if (!reduced && freshKeyHit) this.kbBounce.vel = Math.min(22, this.kbBounce.vel + 14)
    const mBounce = stepSecondOrder(this.kbBounce, 0, 9.5, 0.52, delta, snap, 0.002)

    for (let i = this.activePops.length - 1; i >= 0; i--) {
      if (reduced || now - this.activePops[i].createdAt >= POP_LIFETIME_MS) this.activePops.splice(i, 1)
    }
    const pops: TypingKeyPop[] = this.activePops.map((p) => ({
      id: p.id,
      kind: p.kind,
      col: p.col,
      pawSide: p.pawSide,
      progress: clamp((now - p.createdAt) / POP_LIFETIME_MS)
    }))
    if (pops.length > 0) moving = true

    const spaceRecent = state.left.struckAt > 0 && state.left.struckAt === state.right.struckAt
    const spaceAge = spaceRecent ? Math.max(0, now - state.left.struckAt) : Infinity
    const spaceHeld = state.held === 3
    const spaceDown = spaceHeld ? 1 : spaceRecent ? clamp(1 - spaceAge / 155) : 0
    const spaceGlow = reduced ? (spaceHeld ? 0.45 : 0) : Math.max(spaceHeld ? 0.35 : 0, spaceRecent ? clamp(1 - spaceAge / 360) : 0)

    if (cursor && cursor.wheelSeq !== this.lastWheelSeq) {
      this.lastWheelSeq = cursor.wheelSeq
      this.lastWheelAt = now
      this.lastWheelDir = cursor.wheelDir
    }
    const wheelAge = now - this.lastWheelAt
    const wheelGlow = !reduced && wheelAge >= 0 && wheelAge < 300 ? clamp(1 - wheelAge / 300) : 0
    if (wheelGlow > 0) moving = true

    // The painter may have slept while the desk was open; that time doesn't count toward closing it.
    const exiting = deskTarget === 0 && expiresAt !== undefined && now < expiresAt
    const deskDelta = exiting ? Math.min(delta, (now - exitAt) / 1000) : delta
    const mDesk = stepSecondOrder(this.desk, deskTarget, deskTarget ? 5.2 : exiting ? 2.4 : 3.2,
      deskTarget ? 0.98 : 1.0, deskDelta, reduced || (snap && !exiting))
    const mMouse = stepSecondOrder(this.mouseMode, mouseRecent ? 1 : 0, 5.8, 0.96, delta, snap)
    const mNx = stepSecondOrder(this.mouseNx, cursor?.nx ?? 0.5, 12, 1.0, delta, snap)
    const mNy = stepSecondOrder(this.mouseNy, cursor?.ny ?? 0.5, 12, 1.0, delta, snap)

    const latestUserRight = state.right.struckAt >= state.left.struckAt
    const latestStrikeAt = Math.max(state.left.struckAt, state.right.struckAt)
    const activePawIndex = mouseRecent ? 1 : (latestUserRight ? 0 : 1)
    const activeCol = this.cols[activePawIndex].pos
    const activeRow = this.rows[activePawIndex].pos
    const keyShiftTarget = (state.held !== 0 || latestStrikeAt > now - 600) ? clamp((activeCol - 2.5) / 2.5, -1, 1) : 0
    const mShift = stepSecondOrder(this.shiftX, keyShiftTarget, 5.2, 0.92, delta, snap)
    moving ||= !reduced && (mDesk || mMouse || mNx || mNy || mShift || mBounce)

    // Gaze priority: active cursor -> recently struck keycap / left-side mouse -> neutral forward rest.
    let gazeTx = 0, gazeTy = 0
    if (cursor?.active) {
      gazeTx = cursor.gx
      gazeTy = cursor.gy
    } else if (state.held !== 0 || (latestStrikeAt > 0 && now - latestStrikeAt < 950)) {
      gazeTx = clamp((activeCol - 2.5) * 0.22 - this.mouseMode.pos * 0.28, -0.72, 0.72)
      gazeTy = clamp(0.56 + (activeRow - 1) * 0.12, 0.35, 0.78)
    } else if (mouseRecent) {
      gazeTx = -0.36
      gazeTy = 0.52
    }

    const pawBalance = (result[1].down - result[0].down) * this.desk.pos
    const extraTilt = pawBalance * 0.028 + this.shiftX.pos * 0.018 * this.desk.pos
    const extraLean = pawBalance * 0.022 + (this.shiftX.pos * 0.026 - this.mouseMode.pos * 0.024) * this.desk.pos
    const gazeState = stepPetGaze(deskInput.gaze ?? this.localGaze, gazeTx, gazeTy, extraTilt, extraLean, now, reduced)
    moving ||= gazeState.moving

    this.frozen = {
      left: { ...result[0], onMouse: this.mouseMode.pos > 0.55 },
      right: result[1],
      moving,
      desk: clamp(this.desk.pos),
      bounce: clamp(this.kbBounce.pos, -0.4, 1.2),
      gaze: gazeState.gaze,
      lean: gazeState.lean,
      headTilt: gazeState.headTilt,
      shiftX: this.shiftX.pos,
      space: spaceDown > 0 || spaceGlow > 0 ? { down: spaceDown, glow: spaceGlow } : undefined,
      pops: pops.length ? pops : undefined,
      mouse: {
        active: clamp(this.mouseMode.pos),
        nx: clamp(this.mouseNx.pos),
        ny: clamp(this.mouseNy.pos),
        leftButton: Boolean(mouseButtons & 1),
        rightButton: Boolean(mouseButtons & 2),
        middleButton: Boolean(mouseButtons & 4),
        leftPress: clamp(this.buttonPress[0]),
        rightPress: clamp(this.buttonPress[1]),
        middlePress: clamp(this.buttonPress[2]),
        wheelGlow,
        wheelDir: this.lastWheelDir
      }
    }
    return this.frozen
  }
}
