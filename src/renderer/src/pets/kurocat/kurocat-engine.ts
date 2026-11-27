import type { PetCursorSample, PetSessionStatus } from '@shared/pets'
import {
  DEFAULT_KUROCAT_TAIL_KEY_IDS,
  defaultKuroCatUserPrefs,
  resolveKuroCatSkin,
  type KuroCatCollarColor,
  type KuroCatHeadphoneMode,
  type KuroCatKeyboardLayout,
  type KuroCatKeyboardOrientation,
  type KuroCatSkinConfig,
  type KuroCatTailKeyMode,
  type KuroCatUserPrefs,
  type ResolvedKuroCatSkin
} from '@shared/pets-kurocat'
import type { PetTypingState } from '@shared/pets-typing'
import { petAudio } from '../pet-audio'
import { drawKuroCatBody, drawKuroCatTail, type KuroCatTailState } from './kurocat-body-renderer'
import {
  drawKuroCatAliveFx,
  drawKuroCatPaw,
  type KuroCatFxParticle,
  type KuroCatPawState,
  type KuroCatVisualContext
} from './kurocat-face-arms-renderer'
import {
  applyKuroCatCursorSample,
  applyKuroCatStageTap,
  diffKuroCatTypingState,
  triggerKuroCatStrike,
  type KuroCatHeldSlot
} from './kurocat-interactions'
import {
  drawKuroCatKeyBubbles,
  drawKuroCatKeyboard,
  drawKuroCatMiniMouse,
  drawKuroCatMouseBadges,
  type KuroCatKeyAnim,
  type KuroCatKeyBubble,
  type KuroCatMouseBadge,
  type Vec2
} from './kurocat-keyboard-desk'
import {
  KuroSpring,
  clampToKuroCatKeyboardSurface,
  evaluateKuroCatIdleAct,
  kuroCatHitPathCss,
  kuroCatViewportTransform,
  stepKuroCatBubblesAndParticles,
  stepKuroCatPaw,
  stepKuroCatTailKinematics,
  type IdleActKind,
  type IdleFidget,
  type KuroCatBoardGeometry
} from './kurocat-paw-stepper'

export class KuroCatEngine {
  private catBreed: 'black' | 'ragdoll' = 'black'
  private customSkin: ResolvedKuroCatSkin | null = null
  private keyboardLayout: KuroCatKeyboardLayout = '65'
  private keyboardOrientation: KuroCatKeyboardOrientation = 'cat'
  private tailKeyMode: KuroCatTailKeyMode = 'smart'
  private tailKeyIdSet = new Set<string>(DEFAULT_KUROCAT_TAIL_KEY_IDS)
  private showKeyBubbles = true
  private collarColor: KuroCatCollarColor = 'none'
  private headphoneMode: KuroCatHeadphoneMode = 'auto'

  private logicalW = 420
  private logicalH = 440
  private catCenterX = 196
  private catTopY = 82
  private catBaseY = 308
  private get catHeight(): number { return this.catBaseY - this.catTopY }
  private kbCenterX = 214
  private kbCenterY = 353
  private kbWidth = 266
  private kbHeight = 74
  private kbTiltRad = (3.4 * Math.PI) / 180
  private mouseBaseX = 54
  private mouseBaseY = 334

  private lastNow: number | null = null
  private elapsed = 0
  private breathPhase = 0
  private tailDriftPhase = 0
  private typingGroovePhase = 0
  private kneadPhase = 0
  private thumpPhase = 0

  private spineLeanSpring = new KuroSpring(0, 1.9, 0.78)
  private headTiltSpring = new KuroSpring(0, 3.1, 0.68)
  private hunchSpring = new KuroSpring(0, 3.6, 0.84)
  private squashSpring = new KuroSpring(0, 4.4, 0.48)
  private earPerkSpring = new KuroSpring(0, 5.2, 0.36)
  private eyeXSpring = new KuroSpring(0, 9.5, 0.96)
  private eyeYSpring = new KuroSpring(0, 9.5, 0.96)
  private faceTurnSpring = new KuroSpring(0, 2.9, 0.86)
  private deskHopSpring = new KuroSpring(0, 7.2, 0.42)
  private headsetSpring = new KuroSpring(0, 3.8, 0.62)

  private spineLean = 0
  private headTilt = 0
  private typingHunch = 0
  private typingEnergy = 0
  private typingSway = 0
  private typingSwayVel = 0
  private strikeRock = 0
  private strikeRockVel = 0
  private bodyBob = 0
  private kbBounce = 0
  private deskHopY = 0
  private lastKeyBias = 0
  private eyeLookX = 0
  private eyeLookY = 0
  private faceTurnX = 0

  private isBlinking = false
  private blinkProgress = 0
  private nextBlinkAt = 2.4
  private earTwitchLeft = 0
  private earTwitchRight = 0
  private squintAmount = 0
  private petEnergy = 0
  private chinAmount = 0
  private chinUntil = 0
  private boopCrossEye = 0
  private boopShake = 0
  private boopAt = -10000
  private tailRecoil = 0
  private sleepAmount = 0
  private asleep = false
  private nextZAt = 0
  private curiousAmount = 0
  private curiousUntil = 0
  private crossAmount = 0
  private crossUntil = 0
  private lastSlamAt = -10000
  private thumpLift = 0
  private thumpLash = 0
  private dozeLidClose = 0
  private dozeNod = 0
  private yawnAmount = 0
  private stretchAmount = 0
  private groomAmount = 0
  private groomLickAmount = 0
  private groomEarPressLeft = 0
  private groomEarPressRight = 0
  private idleFlags = { dozeJoltFired: false, groomSparkleSpawned: false }
  private kneadAmount = 0
  private dragging = false
  private scruffAmount = 0
  private scruffSwing = 0
  private scruffSwingVel = 0
  private headphonesOn = false
  private workStatus: PetSessionStatus = 'idle'

  private idleAct: IdleFidget | null = null
  private nextIdleActAt = 0
  private lastAnyInputAt = 0
  private lastAnyKeyAt = -10000
  private recentKeyTimes: number[] = []
  private lastSpacePaw: 'left' | 'right' = 'right'
  private seenTyping = { seq: null as [number, number] | null, struckAt: [0, 0] as [number, number] }
  private heldSlots = new Map<'left' | 'right', KuroCatHeldSlot>()

  private cursorRelX = 0.5
  private cursorRelY = 0.5
  private lastCursorEyeAt = -10000
  private mouseOffsetX = 0
  private mouseOffsetY = 0
  private mouseTargetOffX = 0
  private mouseTargetOffY = 0
  private lastMouseMoveAt = -10000
  private lastMouseNx = -1
  private lastMouseNy = -1
  private mouseButtons = 0
  private mouseLeftPress = 0
  private mouseRightPress = 0
  private mouseMiddlePress = 0
  private mouseScrollFlash = 0
  private lastWheelSeq = 0
  private lastClickSeq = 0
  private cursorOverCat = false
  private lastHoverLocalX: number | null = null
  private lastHoverLocalY: number | null = null
  private hoverTravel = 0
  private lastHeartAt = -10000

  private readonly keyAnims = new Map<string, KuroCatKeyAnim>()
  private readonly bubbles: KuroCatKeyBubble[] = []
  private readonly mouseBadges: KuroCatMouseBadge[] = []
  private readonly fxParticles: KuroCatFxParticle[] = []
  private nextBubbleId = 1
  private leftPaw: KuroCatPawState
  private rightPaw: KuroCatPawState
  private tailState: KuroCatTailState
  private tailCtrl = { active: false, targetX: 320, targetY: 345, tapAt: -10000, patAt: -10000, releaseAt: -10000 }

  constructor() {
    this.leftPaw = this.makePaw('left')
    this.rightPaw = this.makePaw('right')
    this.tailState = {
      tipX: 320, tipY: 250, reach: 0, hover: 0, impactSquash: 0, crossLeft: 0,
      driftPhase: 0, tailFlick: 0, tailRecoil: 0, thumpLift: 0, thumpLash: 0,
      kbCenterY: this.kbCenterY, kbHeight: this.kbHeight, logicalW: this.logicalW,
      sampledPoints: []
    }
    this.syncLayoutPositions()
  }

  private makePaw(side: 'left' | 'right'): KuroCatPawState {
    const sign = side === 'left' ? -1 : 1
    return {
      side, shoulderNormY: 0.58, shoulderHalfX: sign * 32,
      pos: { x: this.catCenterX + sign * 19, y: this.catBaseY },
      target: { x: this.catCenterX + sign * 19, y: this.catBaseY },
      mode: 'idle', idleWeight: 1, curlWeight: 0, pokeTime: 0, impactSquash: 0, lastActiveAt: -10000, smears: []
    }
  }

  private boardGeo(): KuroCatBoardGeometry {
    return {
      keyboardLayout: this.keyboardLayout, keyboardOrientation: this.keyboardOrientation,
      kbCenterX: this.kbCenterX, kbCenterY: this.kbCenterY, kbWidth: this.kbWidth,
      kbHeight: this.kbHeight, kbTiltRad: this.kbTiltRad, logicalW: this.logicalW,
      mouseBaseX: this.mouseBaseX, mouseBaseY: this.mouseBaseY
    }
  }

  private syncLayoutPositions(): void {
    if (this.keyboardLayout === '108') {
      this.logicalW = 540; this.logicalH = 456; this.catCenterX = 278; this.catTopY = 66; this.catBaseY = 292
      this.kbCenterX = 290; this.kbCenterY = 356; this.kbWidth = 398; this.kbHeight = 96; this.kbTiltRad = (2.4 * Math.PI) / 180
      this.mouseBaseX = 46; this.mouseBaseY = 342
    } else {
      this.logicalW = 420; this.logicalH = 440; this.catCenterX = 196; this.catTopY = 82; this.catBaseY = 308
      this.kbCenterX = 214; this.kbCenterY = 353; this.kbWidth = 266; this.kbHeight = 74; this.kbTiltRad = (3.4 * Math.PI) / 180
      this.mouseBaseX = 54; this.mouseBaseY = 334
    }
    this.tailState.kbCenterY = this.kbCenterY
    this.tailState.kbHeight = this.kbHeight
    this.tailState.logicalW = this.logicalW
  }

  setAppearance(petId: string | null | undefined, skin?: KuroCatSkinConfig | null, prefs?: KuroCatUserPrefs | null): void {
    const p = prefs ?? defaultKuroCatUserPrefs()
    const prevLayout = this.keyboardLayout
    this.keyboardLayout = p.keyboardLayout
    this.keyboardOrientation = p.keyboardOrientation
    this.tailKeyMode = p.tailKeyMode
    this.tailKeyIdSet = new Set(p.tailKeyIds)
    this.showKeyBubbles = p.showKeyBubbles
    this.collarColor = p.collarColor
    this.headphoneMode = p.headphoneMode

    if (skin) {
      if ((skin.id === 'black' || skin.id === 'ragdoll') && skin.builtin) {
        this.catBreed = skin.id; this.customSkin = null
      } else {
        this.catBreed = 'black'; this.customSkin = resolveKuroCatSkin(skin)
      }
    } else if (petId?.endsWith(':ragdoll')) {
      this.catBreed = 'ragdoll'; this.customSkin = null
    } else {
      this.catBreed = 'black'; this.customSkin = null
    }

    if (prevLayout !== this.keyboardLayout) {
      this.syncLayoutPositions()
      this.leftPaw.pos = { x: this.catCenterX - 19, y: this.catBaseY }
      this.rightPaw.pos = { x: this.catCenterX + 19, y: this.catBaseY }
    }
    this.syncHeadphonesTarget()
  }

  syncWorkState(status: PetSessionStatus, now: number): void {
    if (this.workStatus !== status) {
      if (status === 'failed') this.crossUntil = Math.max(this.crossUntil, now + 2600)
      this.workStatus = status
    }
    this.syncHeadphonesTarget()
  }

  private syncHeadphonesTarget(): void {
    const next = this.headphoneMode === 'on' || (this.headphoneMode === 'auto' && this.workStatus === 'running')
    if (next !== this.headphonesOn) {
      this.headphonesOn = next
      if (next) this.headsetSpring.kick(2.2)
    }
  }

  setDragging(dragging: boolean, velX = 0, now = Date.now()): void {
    if (this.dragging === dragging) {
      if (dragging) this.scruffSwingVel += velX * 0.015
      return
    }
    this.dragging = dragging
    if (dragging) {
      this.wakeCat(now, 'abrupt')
      petAudio.setPurrIntensity(0)
    } else {
      this.deskHopSpring.kick(-26); this.squashSpring.kick(2.4)
      this.earTwitchLeft = 1; this.earTwitchRight = 1
    }
  }

  private wakeCat = (now: number, mode: 'gentle' | 'abrupt'): void => {
    this.lastAnyInputAt = now
    if (this.asleep) {
      this.asleep = false
      if (mode === 'abrupt' && this.sleepAmount > 0.65) this.crossUntil = Math.max(this.crossUntil, now + 2200)
    }
  }

  private spinePoint = (t: number, breath: number): Vec2 => {
    const u = Math.max(0, Math.min(1, 1 - t))
    const sc = u * u * (3 - 2 * u)
    const leanAmp = this.keyboardLayout === '108' ? 76 : 46
    const scruffX = this.scruffAmount * this.scruffSwing * 30 * Math.pow(Math.max(0, t - 0.14), 1.3)
    const leanX = (this.spineLean * leanAmp + this.typingSway * 25 + this.strikeRock * 10) * sc + scruffX
    const stretchY = this.stretchAmount * (-9.5 * sc + 8.5 * Math.sin(t * Math.PI))
    const scruffY = Math.min(1, this.scruffAmount) * (-14 + (t - 0.18) * 16)
    const hunchY = (this.typingHunch * 13 + this.bodyBob * 3.2 + breath) * sc + Math.abs(this.typingSway) * 4 * sc
      + this.sleepAmount * 16.5 * sc + this.squashSpring.x * 6.5 * sc + this.dozeNod * 15.5 * sc
      - this.yawnAmount * 6.5 * sc - this.chinAmount * 7.5 * sc + stretchY + scruffY
    return { x: this.catCenterX + leanX, y: this.catTopY + t * this.catHeight + hunchY + Math.abs(this.spineLean) * 6 * sc }
  }

  private liveShoulder = (paw: KuroCatPawState, breath: number): Vec2 => {
    const sp = this.spinePoint(paw.shoulderNormY, breath)
    return { x: sp.x + paw.shoulderHalfX, y: sp.y }
  }

  private liveCurledPawPos = (paw: KuroCatPawState, breath: number): Vec2 => {
    const sp = this.spinePoint(0.84, breath)
    const bob = Math.sin(this.elapsed * 12 + (paw.side === 'left' ? 0 : Math.PI)) * (1.5 + this.typingEnergy * 2.0)
    return { x: sp.x + (paw.side === 'left' ? -24 : 24), y: sp.y + bob }
  }

  private clampToKeyboardSurface = (pt: Vec2): Vec2 => clampToKuroCatKeyboardSurface(this.boardGeo(), pt)

  private triggerStrike(side: 'left' | 'right', col: number | undefined, row: number | undefined, sequence: number, isSpace: boolean, now: number): void {
    const host = {
      geo: this.boardGeo(), tailKeyMode: this.tailKeyMode, tailKeyIdSet: this.tailKeyIdSet,
      showKeyBubbles: this.showKeyBubbles, catCenterX: this.catCenterX, mouseButtons: this.mouseButtons,
      lastMouseMoveAt: this.lastMouseMoveAt, lastAnyKeyAt: this.lastAnyKeyAt, recentKeyTimes: this.recentKeyTimes,
      lastSpacePaw: this.lastSpacePaw, typingEnergy: this.typingEnergy, typingGroovePhase: this.typingGroovePhase,
      lastKeyBias: this.lastKeyBias, bodyBob: this.bodyBob, kbBounce: this.kbBounce,
      strikeRockVel: this.strikeRockVel, typingSwayVel: this.typingSwayVel,
      earTwitchLeft: this.earTwitchLeft, earTwitchRight: this.earTwitchRight, crossUntil: this.crossUntil,
      leftPaw: this.leftPaw, rightPaw: this.rightPaw, tailState: this.tailState, tailCtrl: this.tailCtrl,
      heldSlots: this.heldSlots, keyAnims: this.keyAnims, bubbles: this.bubbles,
      nextBubbleId: () => this.nextBubbleId++, wakeCat: this.wakeCat,
      kickSquash: (dv: number) => this.squashSpring.kick(dv),
      kickHeadTilt: (dv: number) => this.headTiltSpring.kick(dv),
      spinePoint: this.spinePoint, liveShoulder: this.liveShoulder, liveCurledPawPos: this.liveCurledPawPos
    }
    triggerKuroCatStrike(host, side, col, row, sequence, isSpace, now)
    this.lastAnyKeyAt = host.lastAnyKeyAt
    this.lastSpacePaw = host.lastSpacePaw
    this.typingGroovePhase = host.typingGroovePhase
    this.lastKeyBias = host.lastKeyBias
    this.bodyBob = host.bodyBob
    this.kbBounce = host.kbBounce
    this.strikeRockVel = host.strikeRockVel
    this.typingSwayVel = host.typingSwayVel
    this.earTwitchLeft = host.earTwitchLeft
    this.earTwitchRight = host.earTwitchRight
    this.crossUntil = host.crossUntil
  }

  syncTyping(typing: PetTypingState | undefined, now: number): void {
    diffKuroCatTypingState(
      typing,
      this.seenTyping,
      now,
      (side, col, row, sequence, isSpace) => this.triggerStrike(side, col, row, sequence, isSpace, now),
      (side) => this.releaseSlot(side, now)
    )
  }

  private releaseSlot(side: 'left' | 'right', now: number): void {
    const entry = this.heldSlots.get(side)
    if (!entry) return
    this.heldSlots.delete(side)
    const anim = this.keyAnims.get(entry.specId)
    if (anim) anim.pressed = false
    if (entry.tail) this.tailCtrl.releaseAt = now
  }

  syncCursor(cursor: PetCursorSample | null | undefined, now: number): void {
    const st = {
      cursorRelX: this.cursorRelX, cursorRelY: this.cursorRelY, lastCursorEyeAt: this.lastCursorEyeAt,
      lastMouseNx: this.lastMouseNx, lastMouseNy: this.lastMouseNy, lastMouseMoveAt: this.lastMouseMoveAt,
      mouseTargetOffX: this.mouseTargetOffX, mouseTargetOffY: this.mouseTargetOffY,
      mouseOffsetX: this.mouseOffsetX, mouseOffsetY: this.mouseOffsetY,
      mouseBaseX: this.mouseBaseX, mouseBaseY: this.mouseBaseY,
      mouseButtons: this.mouseButtons, mouseLeftPress: this.mouseLeftPress, mouseRightPress: this.mouseRightPress,
      mouseMiddlePress: this.mouseMiddlePress, mouseScrollFlash: this.mouseScrollFlash,
      lastClickSeq: this.lastClickSeq, lastWheelSeq: this.lastWheelSeq, curiousUntil: this.curiousUntil,
      leftPaw: this.leftPaw, mouseBadges: this.mouseBadges, colors: this.getMouseButtonColors(),
      nextBadgeId: () => this.nextBubbleId++, wakeGentle: () => this.wakeCat(now, 'gentle')
    }
    applyKuroCatCursorSample(cursor, now, st)
    this.cursorRelX = st.cursorRelX; this.cursorRelY = st.cursorRelY; this.lastCursorEyeAt = st.lastCursorEyeAt
    this.lastMouseNx = st.lastMouseNx; this.lastMouseNy = st.lastMouseNy; this.lastMouseMoveAt = st.lastMouseMoveAt
    this.mouseTargetOffX = st.mouseTargetOffX; this.mouseTargetOffY = st.mouseTargetOffY
    this.mouseButtons = st.mouseButtons; this.mouseLeftPress = st.mouseLeftPress
    this.mouseRightPress = st.mouseRightPress; this.mouseMiddlePress = st.mouseMiddlePress
    this.mouseScrollFlash = st.mouseScrollFlash; this.lastClickSeq = st.lastClickSeq
    this.lastWheelSeq = st.lastWheelSeq; this.curiousUntil = st.curiousUntil
  }

  noteLocalHover(localX: number | undefined, localY: number | undefined, overCat: boolean, buttons: number, now: number): void {
    this.cursorOverCat = overCat
    if (!overCat || buttons !== 0 || localX === undefined || localY === undefined) {
      this.lastHoverLocalX = null; this.lastHoverLocalY = null; this.hoverTravel = 0
      return
    }
    if (now - this.lastAnyKeyAt < 1200 || this.heldSlots.size > 0) return

    if (this.lastHoverLocalX !== null && this.lastHoverLocalY !== null) {
      const dist = Math.hypot(localX - this.lastHoverLocalX, localY - this.lastHoverLocalY)
      if (dist > 0.015 && dist < 0.85) {
        this.hoverTravel += dist
        if (this.hoverTravel > 0.24) {
          this.wakeCat(now, 'gentle')
          if (localY > -0.15 && localY < 0.35 && Math.abs(localX) < 0.45) this.chinUntil = now + 900
          else if (localY <= 0.15) this.petEnergy = Math.min(1, Math.max(this.petEnergy, 0.55) + dist * 1.4)
          if (now - this.lastHeartAt > 260) {
            this.lastHeartAt = now
            const head = this.spinePoint(0.18, 0)
            this.fxParticles.push({
              kind: 'heart', x: head.x + (Math.random() - 0.5) * 44, y: head.y - 22,
              vx: (Math.random() - 0.5) * 16, vy: -32 - Math.random() * 14, size: 13 + Math.random() * 4, createdAt: now, lifetime: 980
            })
          }
        }
      }
    }
    this.lastHoverLocalX = localX; this.lastHoverLocalY = localY
  }

  noteTap(stageX: number, stageY: number, stageW: number, stageH: number, now: number): void {
    applyKuroCatStageTap(
      this.boardGeo(), stageX, stageY, stageW, stageH, now,
      this.tailState.sampledPoints, this.faceTurnX, this.spinePoint, this.fxParticles,
      {
        wakeGentle: () => this.wakeCat(now, 'gentle'),
        onTailPoke: () => { this.tailRecoil = 1; this.earPerkSpring.kick(2.4) },
        onNoseBoop: () => { this.boopAt = now; this.boopCrossEye = 1 },
        onChinTap: () => { this.chinUntil = now + 1800 },
        onHeadPat: () => { this.petEnergy = 0.95 }
      }
    )
  }

  private getMouseButtonColors(): { left: string; right: string; middle: string } {
    const left = this.customSkin ? this.customSkin.accentColor : this.catBreed === 'ragdoll' ? '#7ac7ff' : '#d2f244'
    return { left, right: '#ff7b3b', middle: '#38bdf8' }
  }

  viewportTransform(stageW: number, stageH: number): { offsetX: number; offsetY: number; uniformScale: number } {
    return kuroCatViewportTransform(this.keyboardLayout, stageW, stageH)
  }

  hitPathCss(stageW: number, stageH: number): string {
    return kuroCatHitPathCss(this.boardGeo(), stageW, stageH, this.spinePoint)
  }

  stepAndRender(ctx: CanvasRenderingContext2D, stageW: number, stageH: number, dpr: number, now: number, reduced: boolean): boolean {
    const rawDt = this.lastNow === null ? 1 / 60 : Math.max(0.001, (now - this.lastNow) / 1000)
    this.lastNow = now
    const dt = reduced ? 0.016 : Math.min(0.05, rawDt)
    if (this.lastAnyInputAt === 0) { this.lastAnyInputAt = now; this.nextIdleActAt = now + 4500 }

    this.elapsed += dt; this.breathPhase += dt * (this.asleep ? 1.55 : 2.35); this.tailDriftPhase += dt * 1.9
    const isTypingRecently = now - this.lastAnyKeyAt < 620 || this.heldSlots.size > 0
    const recentDensity = this.recentKeyTimes.filter((t) => now - t < 1200).length
    this.typingEnergy += ((isTypingRecently ? Math.min(1, 0.25 + recentDensity * 0.11) : 0) - this.typingEnergy) * (1 - Math.exp(-8 * dt))

    if (!this.dragging && now - this.lastAnyInputAt > 55_000) this.asleep = true
    this.sleepAmount += ((this.asleep ? 1 : 0) - this.sleepAmount) * (1 - Math.exp(-(this.asleep ? 2.2 : 9.5) * dt))
    this.scruffAmount += ((this.dragging ? 1 : 0) - this.scruffAmount) * (1 - Math.exp(-14 * dt))
    this.scruffSwingVel += (-this.scruffSwing * 46 - this.scruffSwingVel * 6.5) * dt
    this.scruffSwing = Math.max(-1.4, Math.min(1.4, this.scruffSwing + this.scruffSwingVel * dt))
    this.curiousAmount += (((now < this.curiousUntil && !this.asleep) ? 1 : 0) - this.curiousAmount) * (1 - Math.exp(-10 * dt))
    const isCross = now < this.crossUntil && !this.asleep
    this.crossAmount += ((isCross ? 1 : 0) - this.crossAmount) * (1 - Math.exp(-9 * dt))
    this.chinAmount += (((now < this.chinUntil) ? 1 : 0) - this.chinAmount) * (1 - Math.exp(-11 * dt))
    this.tailRecoil = Math.max(0, this.tailRecoil - dt * 3.8)
    const boopAge = (now - this.boopAt) / 1000
    this.boopCrossEye = boopAge >= 0 && boopAge < 0.75 ? Math.max(0, 1 - boopAge / 0.75) : 0
    this.boopShake = boopAge >= 0 && boopAge < 0.35 ? Math.sin(boopAge * 52) * 0.14 * (1 - boopAge / 0.35) : 0

    if (this.idleAct && now - this.idleAct.t0 >= this.idleAct.dur) this.idleAct = null
    if (!this.idleAct && !this.asleep && !isTypingRecently && !this.dragging && now >= this.nextIdleActAt) {
      const pool: IdleActKind[] = ['tilt', 'ear', 'slowBlink', 'look', 'tail', 'yawn', 'stretch', 'groom', 'knead', 'doze']
      const kind = pool[Math.floor(Math.random() * pool.length)]
      const durs: Record<IdleActKind, number> = { tilt: 1900, ear: 750, slowBlink: 1400, look: 2200, tail: 1100, doze: 3400, yawn: 2300, stretch: 2400, groom: 2900, knead: 3200 }
      this.idleFlags.dozeJoltFired = false; this.idleFlags.groomSparkleSpawned = false
      this.idleAct = { kind, t0: now, dur: durs[kind], side: Math.random() < 0.5 ? -1 : 1 }
      this.nextIdleActAt = now + durs[kind] + 4200 + Math.random() * 5200
    }

    const act = this.idleAct
    const idleEval = evaluateKuroCatIdleAct(
      act,
      now,
      dt,
      this.idleFlags,
      () => { this.squashSpring.kick(-2.2); this.earPerkSpring.kick(2.6) },
      (side) => {
        const hp = this.spinePoint(0.24, 0)
        this.fxParticles.push({ kind: 'sparkle', x: hp.x + side * 36, y: hp.y - 6, vx: side * 12, vy: -20, size: 10, createdAt: now, lifetime: 620 })
      }
    )
    this.kneadPhase += idleEval.kneadDelta
    const vLerp = 1 - Math.exp(-12 * dt)
    this.dozeLidClose += (idleEval.tDozeLid - this.dozeLidClose) * vLerp
    this.dozeNod += (idleEval.tDozeNod - this.dozeNod) * (1 - Math.exp(-9 * dt))
    this.yawnAmount += (idleEval.tYawn - this.yawnAmount) * vLerp
    this.stretchAmount += (idleEval.tStretch - this.stretchAmount) * (1 - Math.exp(-8 * dt))
    this.groomAmount += (idleEval.tGroom - this.groomAmount) * vLerp
    this.groomLickAmount += (idleEval.tLick - this.groomLickAmount) * (1 - Math.exp(-18 * dt))
    this.groomEarPressLeft += (idleEval.tEarL - this.groomEarPressLeft) * (1 - Math.exp(-16 * dt))
    this.groomEarPressRight += (idleEval.tEarR - this.groomEarPressRight) * (1 - Math.exp(-16 * dt))
    this.kneadAmount += (idleEval.tKnead - this.kneadAmount) * (1 - Math.exp(-9 * dt))

    const targetHunch = this.scruffAmount > 0.1 ? 0 : isTypingRecently ? 0.45 + this.typingEnergy * 0.55 : this.curiousAmount * 0.28 + this.kneadAmount * 0.24
    this.typingHunch = Math.max(0, Math.min(1.2, this.hunchSpring.step(targetHunch, dt)))
    this.squashSpring.step(this.sleepAmount * 0.35 - this.curiousAmount * 0.25 - this.yawnAmount * 0.30 - this.stretchAmount * 0.38 - this.scruffAmount * 0.28, dt)
    this.strikeRockVel += (-this.strikeRock * 140 - this.strikeRockVel * 14) * dt
    this.strikeRock = Math.max(-1, Math.min(1, this.strikeRock + this.strikeRockVel * dt))
    this.bodyBob = Math.max(0, this.bodyBob - dt * 11.5); this.kbBounce = Math.max(0, this.kbBounce - dt * 15)

    if (isTypingRecently && this.leftPaw.mode !== 'mouse') this.typingGroovePhase += dt * (4.8 + this.typingEnergy * 5.2)
    const grooveWave = Math.sin(this.typingGroovePhase) * (0.58 + this.typingEnergy * 0.44)
    const targetSway = isTypingRecently && this.leftPaw.mode !== 'mouse'
      ? Math.max(-1.1, Math.min(1.1, grooveWave * 0.72 + this.lastKeyBias * 0.55))
      : this.kneadAmount > 0.05 ? Math.sin(this.kneadPhase) * 0.22 * this.kneadAmount : 0
    this.typingSwayVel += ((targetSway - this.typingSway) * 118 - this.typingSwayVel * 12.5) * dt
    this.typingSway = Math.max(-1.2, Math.min(1.2, this.typingSway + this.typingSwayVel * dt))

    this.mouseOffsetX += (this.mouseTargetOffX - this.mouseOffsetX) * (1 - Math.exp(-22 * dt))
    this.mouseOffsetY += (this.mouseTargetOffY - this.mouseOffsetY) * (1 - Math.exp(-22 * dt))
    if (!(this.mouseButtons & 1)) this.mouseLeftPress = Math.max(0, this.mouseLeftPress - dt * 8)
    if (!(this.mouseButtons & 2)) this.mouseRightPress = Math.max(0, this.mouseRightPress - dt * 8)
    if (!(this.mouseButtons & 4)) this.mouseMiddlePress = Math.max(0, this.mouseMiddlePress - dt * 8)
    this.mouseScrollFlash = Math.max(0, this.mouseScrollFlash - dt * 5)

    const targetLean = this.leftPaw.mode === 'mouse'
      ? (this.rightPaw.mode === 'poke' ? -0.52 : -0.96) + (this.mouseOffsetX / 18) * 0.22
      : this.tailState.reach > 0.05 ? Math.max(-1, Math.min(1, (this.tailState.tipX - this.catCenterX) / (this.kbWidth * 0.5))) * 0.14 * this.tailState.reach : 0
    this.spineLean = this.spineLeanSpring.step(targetLean, dt)

    const gx = Math.tanh((this.cursorRelX - this.catCenterX / this.logicalW) * 2.15)
    const gy = Math.tanh((this.cursorRelY - (this.catTopY + 0.24 * this.catHeight) / this.logicalH) * 2.05)
    const fidgetTilt = act?.kind === 'tilt' ? act.side * 0.19 * idleEval.actEnv : 0
    this.headTilt = this.headTiltSpring.step(this.typingSway * 0.18 + this.spineLean * 0.085 + fidgetTilt + this.curiousAmount * 0.16 * gx + this.sleepAmount * 0.08 + idleEval.dozeTilt + idleEval.groomTilt - this.scruffAmount * this.scruffSwing * 0.16, dt) + this.boopShake

    this.petEnergy = Math.max(0, this.petEnergy - dt * (this.cursorOverCat ? 0.24 : 1.15))
    const wantSquint = (this.petEnergy > 0.3 || this.chinAmount > 0.25 || this.kneadAmount > 0.3) && !isCross && !this.dragging ? 1 : 0
    this.squintAmount += (wantSquint - this.squintAmount) * (1 - Math.exp(-12 * dt))
    if (!this.dragging) {
      if (this.chinAmount > 0.25 || (this.petEnergy > 0.3 && this.squintAmount > 0.25)) petAudio.setPurrIntensity(Math.max(this.chinAmount, this.squintAmount))
      else if (this.kneadAmount > 0.25) petAudio.setPurrIntensity(this.kneadAmount * 0.65)
      else petAudio.setPurrIntensity(0)
    }
    this.earPerkSpring.step(0.12 * this.typingEnergy * (1 - this.crossAmount) + 0.16 * this.curiousAmount - 0.18 * this.squintAmount - 0.58 * this.crossAmount - 0.22 * this.scruffAmount - 0.24 * this.yawnAmount, dt)

    const tailStep = stepKuroCatTailKinematics(this.tailState, this.tailCtrl, {
      anyTailHeld: [...this.heldSlots.values()].some((s) => s.tail),
      dt, now, hip: this.spinePoint(0.84, 0), kbWidth: this.kbWidth, logicalW: this.logicalW,
      actKind: act?.kind, actU: idleEval.actU, tailRecoil: this.tailRecoil, crossAmount: this.crossAmount,
      isCross, thumpPhase: this.thumpPhase, thumpLift: this.thumpLift, thumpLash: this.thumpLash,
      tailDriftPhase: this.tailDriftPhase,
      onSlam: (sx, sy) => {
        this.lastSlamAt = now
        this.fxParticles.push({ kind: 'bang', x: sx, y: sy, vx: 0, vy: -8, size: 16, createdAt: now, lifetime: 240 })
        this.deskHopSpring.kick(-34)
      }
    })
    this.thumpPhase = tailStep.thumpPhase
    this.thumpLift = tailStep.thumpLift
    this.thumpLash = tailStep.thumpLash

    this.deskHopY = this.deskHopSpring.step(0, dt)
    this.headsetSpring.step(this.headphonesOn ? 1 : 0, dt)

    if (this.sleepAmount > 0.68 && now >= this.nextZAt) {
      this.nextZAt = now + 1350; const hp = this.spinePoint(0.18, 0)
      this.fxParticles.push({ kind: 'z', x: hp.x + 42, y: hp.y - 18, vx: 9, vy: -24, size: 13, createdAt: now, lifetime: 2400 })
    }

    this.earTwitchLeft = Math.max(0, this.earTwitchLeft - dt * 8)
    this.earTwitchRight = Math.max(0, this.earTwitchRight - dt * 8)
    if (!this.isBlinking && this.elapsed >= this.nextBlinkAt) { this.isBlinking = true; this.blinkProgress = 0 }
    if (this.isBlinking) {
      this.blinkProgress += dt * 12
      if (this.blinkProgress >= 2) { this.isBlinking = false; this.blinkProgress = 0; this.nextBlinkAt = this.elapsed + 2.8 + Math.random() * 3.6 }
    }

    const cursorActive = now - this.lastCursorEyeAt < 2400
    const tgX = cursorActive ? gx : this.typingHunch * (this.typingSway * 0.55 + this.lastKeyBias * 0.32)
    const tgY = cursorActive ? gy : this.typingHunch * 0.72
    this.eyeLookX = Math.max(-1.05, Math.min(1.05, this.eyeXSpring.step(act?.kind === 'look' ? tgX * (1 - idleEval.actEnv) + act.side * 0.85 * idleEval.actEnv : tgX, dt)))
    this.eyeLookY = Math.max(-1.05, Math.min(1.05, this.eyeYSpring.step(tgY, dt)))
    this.faceTurnX = this.faceTurnSpring.step(gx * 5.2 + this.spineLean * 8 + this.typingSway * 8.5, dt)

    for (const anim of this.keyAnims.values()) {
      if (!anim.pressed && anim.pressAmount > 0) anim.pressAmount = Math.max(0, anim.pressAmount - dt * 5)
    }

    const pawCtx = {
      anyHeld: this.heldSlots.size > 0, idleAct: this.idleAct, scruffAmount: this.scruffAmount, scruffSwing: this.scruffSwing,
      groomAmount: this.groomAmount, stretchAmount: this.stretchAmount, kneadAmount: this.kneadAmount, kneadPhase: this.kneadPhase,
      faceTurnX: this.faceTurnX, catCenterX: this.catCenterX, catBaseY: this.catBaseY, kbCenterY: this.kbCenterY, kbHeight: this.kbHeight,
      mouseBaseX: this.mouseBaseX, mouseBaseY: this.mouseBaseY, mouseOffsetX: this.mouseOffsetX, mouseOffsetY: this.mouseOffsetY,
      mouseButtons: this.mouseButtons, mouseLeftPress: this.mouseLeftPress, mouseRightPress: this.mouseRightPress,
      mouseMiddlePress: this.mouseMiddlePress, lastMouseMoveAt: this.lastMouseMoveAt, lastAnyKeyAt: this.lastAnyKeyAt,
      elapsed: this.elapsed, spinePoint: this.spinePoint, liveCurledPawPos: this.liveCurledPawPos,
      clampToKeyboardSurface: this.clampToKeyboardSurface
    }
    const lHeld = this.heldSlots.get('left'), rHeld = this.heldSlots.get('right')
    stepKuroCatPaw(this.leftPaw, dt, now, { ...pawCtx, heldEntry: lHeld && !lHeld.tail ? lHeld : undefined })
    stepKuroCatPaw(this.rightPaw, dt, now, { ...pawCtx, heldEntry: rHeld && !rHeld.tail ? rHeld : undefined })
    stepKuroCatBubblesAndParticles(this.bubbles, this.mouseBadges, this.fxParticles, dt, now)

    ctx.setTransform(1, 0, 0, 1, 0, 0)
    ctx.clearRect(0, 0, stageW * dpr, stageH * dpr)
    ctx.save()
    ctx.scale(dpr, dpr)
    const vt = kuroCatViewportTransform(this.keyboardLayout, stageW, stageH)
    ctx.translate(vt.offsetX, vt.offsetY); ctx.scale(vt.uniformScale, vt.uniformScale)

    const breath = Math.sin(this.breathPhase) * (1.0 + this.sleepAmount * 0.65)
    const purrShift = this.squintAmount > 0.4 ? Math.sin(this.elapsed * 22) * 0.45 * this.squintAmount : 0
    const colors = this.getMouseButtonColors()

    drawKuroCatMiniMouse(ctx, {
      mx: this.mouseBaseX + this.mouseOffsetX, my: this.mouseBaseY + this.mouseOffsetY + this.deskHopY * 1.35,
      leftPress: this.mouseLeftPress, rightPress: this.mouseRightPress, middlePress: this.mouseMiddlePress,
      scrollFlash: this.mouseScrollFlash, leftColor: colors.left, rightColor: colors.right, middleColor: colors.middle
    })
    drawKuroCatKeyboard(ctx, {
      layoutId: this.keyboardLayout, orientation: this.keyboardOrientation, kbCenterX: this.kbCenterX, kbCenterY: this.kbCenterY,
      kbWidth: this.kbWidth, kbHeight: this.kbHeight, kbTiltRad: this.kbTiltRad, kbBounce: this.kbBounce, deskHopY: this.deskHopY,
      catBreed: this.catBreed, customSkin: this.customSkin, keyAnims: this.keyAnims, uniformScale: vt.uniformScale * dpr
    })

    const vc: KuroCatVisualContext = {
      catBreed: this.catBreed, customSkin: this.customSkin, elapsed: this.elapsed, now,
      isBlinking: this.isBlinking, blinkProgress: this.blinkProgress,
      slowBlinkVal: act?.kind === 'slowBlink' ? 0.92 * Math.sin(idleEval.actU * Math.PI) : 0,
      squintAmount: this.squintAmount, sleepAmount: this.sleepAmount, dozeLidClose: this.dozeLidClose,
      yawnAmount: this.yawnAmount, stretchAmount: this.stretchAmount, groomAmount: this.groomAmount,
      groomLickAmount: this.groomLickAmount, chinAmount: this.chinAmount, kneadAmount: this.kneadAmount,
      curiousAmount: this.curiousAmount, scruffAmount: this.scruffAmount, scruffSwing: this.scruffSwing,
      crossAmount: this.crossAmount, typingHunch: this.typingHunch, typingEnergy: this.typingEnergy,
      boopCrossEye: this.boopCrossEye, eyeLookX: this.eyeLookX, eyeLookY: this.eyeLookY,
      faceTurnX: this.faceTurnX, headTilt: this.headTilt, earPerk: this.earPerkSpring.x,
      earTwitchLeft: this.earTwitchLeft, earTwitchRight: this.earTwitchRight,
      earFlickLeft: act?.kind === 'ear' && act.side === -1 ? Math.sin(idleEval.actU * Math.PI * 3) * 0.24 * (1 - idleEval.actU) : 0,
      earFlickRight: act?.kind === 'ear' && act.side === 1 ? Math.sin(idleEval.actU * Math.PI * 3) * 0.24 * (1 - idleEval.actU) : 0,
      groomEarPressLeft: this.groomEarPressLeft, groomEarPressRight: this.groomEarPressRight,
      headsetAmount: this.headsetSpring.x, collarColor: this.collarColor,
      mouseLeftPress: this.mouseLeftPress, mouseRightPress: this.mouseRightPress, mouseMiddlePress: this.mouseMiddlePress,
      leftPawMode: this.leftPaw.mode, lastSlamAt: this.lastSlamAt,
      spinePoint: this.spinePoint, liveShoulder: this.liveShoulder, liveCurledPawPos: this.liveCurledPawPos
    }

    drawKuroCatTail(ctx, vc, this.tailState)
    drawKuroCatBody(ctx, vc, breath, purrShift)
    drawKuroCatPaw(ctx, vc, this.leftPaw, breath)
    drawKuroCatPaw(ctx, vc, this.rightPaw, breath)
    drawKuroCatAliveFx(ctx, vc, this.fxParticles, breath)
    if (this.showKeyBubbles) {
      drawKuroCatKeyBubbles(ctx, this.bubbles, now)
      drawKuroCatMouseBadges(ctx, this.mouseBadges, now)
    }
    ctx.restore()

    return isTypingRecently || this.dragging || this.bubbles.length > 0 || this.mouseBadges.length > 0 ||
      this.fxParticles.length > 0 || this.tailState.reach > 0.02 || this.squintAmount > 0.05 ||
      this.chinAmount > 0.05 || this.isBlinking || Boolean(this.idleAct) || now - this.lastMouseMoveAt < 2200
  }
}
