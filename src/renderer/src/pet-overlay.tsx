import { petTypingCutouts, petTypingRig } from './pets/typing/typing-rig'
import { loadJointTexture } from './pets/joint/assets'
import type { PetVisit } from '@shared/pets-visits'
import { defaultPetVisits } from '@shared/pets-visits'
import { PetReactionStage } from './pets/pet-reaction-stage'
import { usePetPresence } from './pets/use-pet-presence'
import { startPetTypingPresence } from './pets/pet-presence-client'
import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  type PetActivitySnapshot,
  type PetAnimationState,
  type PetOverlayBootstrap,
  type PetOverlayLayout
} from '@shared/pets'
import { PetResidentSprite } from './pets/pet-resident-sprite'
import { acceptPetSnapshot, earliestPetNotificationExpiry, visiblePetNotifications } from './pets/pet-activity'
import { PetWorkBubbles } from './pets/pet-bubble'
import { PetQuickChat } from './pets/pet-quick-chat'
import { PetContextMenu } from './pets/pet-context-menu'
import { effectivePetBusinessState, nextDragDirection, resolveOverlayAnimationState, type PetDragDirection } from './pets/pet-overlay-state'
import { petContextMenuLabels } from './pets/pet-menu-labels'
import { classifyPointerGesture, nextMascotWidth, overlayKeyAction, pointInsidePetHit, welcomeUntil } from './pets/pet-pointer'
import { petControlsBridge, petSurfaceLayout } from './pets/pet-layout'
import { usePetSurfaceSize } from './pets/use-pet-surface-size'
import { PetVisitStage } from './pets/pet-visit-stage'
import { usePetVisits } from './pets/use-pet-visits'
import './pet-overlay.css'

function PetOverlayApp(): React.JSX.Element {
  const bridge = window.kunPetOverlay
  const [bootstrap, setBootstrap] = useState<PetOverlayBootstrap | null>(null)
  const reactions = usePetPresence(bridge, bootstrap)
  const heldReaction = useRef<typeof reactions | null>(null)
  const heldVisit = useRef<PetVisit | null>(null)
  const [snapshot, setSnapshot] = useState<PetActivitySnapshot | null>(null)
  const [width, setWidth] = useState(112)
  const [nativeLayout, setNativeLayout] = useState<PetOverlayLayout | null>(null)
  const [viewport, setViewport] = useState(() => ({ width: window.innerWidth, height: window.innerHeight }))
  const [now, setNow] = useState(() => Date.now())
  const [welcome, setWelcome] = useState<number | null>(null)
  const [hover, setHover] = useState(false)
  const [controlsHover, setControlsHover] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragDirection, setDragDirection] = useState<PetDragDirection>('right')
  const [expanded, setExpanded] = useState(false)
  const [bubblesCollapsed, setBubblesCollapsed] = useState(false)
  const [quickChatInteractive, setQuickChatInteractive] = useState(false)
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [queued, setQueued] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [closedKeys, setClosedKeys] = useState<string[]>([])
  const inFlight = useRef(new Set<string>())
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const companionRef = useRef<HTMLDivElement | null>(null)
  const controlsRef = useRef<HTMLDivElement | null>(null)
  const noticeRef = useRef<HTMLDivElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)
  const draggingRef = useRef(false)
  const interactiveRef = useRef(false)
  const controlsVisibleRef = useRef(false)
  draggingRef.current = dragging
  const controlsRevealed = controlsHover || dragging || menuOpen
  controlsVisibleRef.current = controlsRevealed || quickChatInteractive

  useEffect(() => {
    if (!draggingRef.current) return
    dragOrigin.current = null
    setDragging(false)
    bridge.cancelDrag()
  }, [bridge, bootstrap?.petId])

  useEffect(() => startPetTypingPresence(document), [])
  useEffect(() => {
    if (bootstrap?.petId && bootstrap.spritesheetUrl && bootstrap.interactions?.joint) {
      void loadJointTexture({ id: bootstrap.petId, spritesheetUrl: bootstrap.spritesheetUrl }, petTypingRig({ id: bootstrap.petId, interactions: bootstrap.interactions })!, petTypingCutouts({ id: bootstrap.petId })).catch(() => undefined)
    }
  }, [bootstrap?.petId, bootstrap?.spritesheetUrl, bootstrap?.interactions])

  useEffect(() => {
    let cancelled = false
    const applyActivity = (value: PetActivitySnapshot): void => {
      setSnapshot((current) => acceptPetSnapshot(current, value))
      setNow(Date.now())
    }
    void bridge.getBootstrap().then((value) => {
      if (cancelled) return
      setBootstrap(value)
      setWidth(value.mascotWidthPx)
      if (value.layout) setNativeLayout(value.layout)
      setBubblesCollapsed(value.bubblesCollapsed === true)
      if (value.activitySnapshot) applyActivity(value.activitySnapshot)
      setWelcome(welcomeUntil(value.petId, value.welcomedPetIds, Date.now()))
      if (value.petId && !value.welcomedPetIds.includes(value.petId)) void bridge.recordPetWelcomed(value.petId)
    })
    const stopBootstrap = bridge.onBootstrapChanged((value) => {
      setBootstrap(value)
      setWidth(value.mascotWidthPx)
      if (value.layout) setNativeLayout(value.layout)
      setBubblesCollapsed(value.bubblesCollapsed === true)
      if (value.activitySnapshot) applyActivity(value.activitySnapshot)
    })
    const stopActivity = bridge.onActivityChanged(applyActivity)
    const stopLayout = bridge.onLayoutChanged(setNativeLayout)
    const stopFocus = bridge.onMainWindowFocused(() => {
      setExpanded(false)
      setEditing(null)
      setMenuOpen(false)
    })
    return () => { cancelled = true; stopBootstrap(); stopActivity(); stopFocus(); stopLayout() }
  }, [bridge])

  useEffect(() => {
    const wants = hover || dragging || menuOpen
    if (interactiveRef.current === wants) return
    interactiveRef.current = wants
    bridge.setPointerInteractive(wants)
  }, [bridge, hover, dragging, menuOpen])

  useEffect(() => {
    let leaveTimer = 0
    let controlsLeaveTimer = 0
    const leave = (): void => {
      if (!leaveTimer) leaveTimer = window.setTimeout(() => { leaveTimer = 0; setHover(false) }, 180)
    }
    const leaveControls = (): void => {
      if (!controlsLeaveTimer) controlsLeaveTimer = window.setTimeout(() => { controlsLeaveTimer = 0; setControlsHover(false) }, 180)
    }
    const onMove = (event: MouseEvent): void => {
      const hit = hitRef.current
      const point = { x: event.clientX, y: event.clientY }
      const pet = hit?.querySelector<HTMLElement>('.pet-character-stage')?.getBoundingClientRect()
      const controls = hit?.querySelector<HTMLElement>(controlsVisibleRef.current
        ? '.pet-quick-composer, .pet-toolbar' : '.pet-toolbar-handle')?.getBoundingClientRect()
      const overJoint = Boolean(document.elementFromPoint(point.x, point.y)?.closest('.pet-joint-hit'))
      const overCompanion = overJoint || Array.from(hit?.querySelectorAll<HTMLElement>('.pet-sprite') ?? []).some((element) => pointInsidePetHit(point, element.getBoundingClientRect())) || pointInsidePetHit(point, controls ?? null) ||
        (controlsVisibleRef.current && pet && controls ? pointInsidePetHit(point, petControlsBridge(pet, controls)) : false)
      if (overCompanion || draggingRef.current) {
        window.clearTimeout(controlsLeaveTimer)
        controlsLeaveTimer = 0
        setControlsHover(true)
      } else leaveControls()
      const inside = overCompanion || Array.from(hit?.querySelectorAll<HTMLElement>('.pet-bubble-list, .pet-note, .pet-menu, .pet-visit-caption') ?? [])
        .some((element) => pointInsidePetHit(point, element.getBoundingClientRect()))
      if (inside || draggingRef.current) {
        window.clearTimeout(leaveTimer)
        leaveTimer = 0
        if (!interactiveRef.current) {
          interactiveRef.current = true
          bridge.setPointerInteractive(true)
        }
        setHover(true)
        return
      }
      leave()
    }
    const onLeave = (): void => { leave(); leaveControls() }
    const onOut = (event: MouseEvent): void => { if (!event.relatedTarget) onLeave() }
    window.addEventListener('mousemove', onMove, true)
    window.addEventListener('mouseout', onOut)
    window.addEventListener('blur', onLeave)
    return () => {
      window.clearTimeout(leaveTimer)
      window.clearTimeout(controlsLeaveTimer)
      window.removeEventListener('mousemove', onMove, true)
      window.removeEventListener('mouseout', onOut)
      window.removeEventListener('blur', onLeave)
    }
  }, [bridge])

  useEffect(() => {
    const resize = (): void => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])

  const dismissed = new Set([...(bootstrap?.dismissedNotificationKeys ?? []), ...closedKeys])
  const retained = new Set([...(editing ? [editing] : []), ...Object.keys(queued)])
  const notifications = snapshot ? visiblePetNotifications(snapshot, dismissed, now, retained) : []
  const active = notifications[0] ?? null
  const bubblesHidden = bubblesCollapsed || quickChatInteractive || !active
  const bubblesRevealed = !bubblesHidden && hover
  const controlsSize = usePetSurfaceSize(controlsRef, true, { width: 140, height: 44 })
  const noticeSize = usePetSurfaceSize(noticeRef, bubblesRevealed, { width: 330, height: 80 })
  const menuSize = usePetSurfaceSize(menuRef, menuOpen, { width: 136, height: 74 })
  const liveVisit = usePetVisits({ bridge, bootstrap, presence: reactions.presence, work: snapshot,
    blocked: dragging || menuOpen || quickChatInteractive || Boolean(editing) })
  const currentVisit = liveVisit?.primaryId === bootstrap?.petId ? liveVisit : null
  if (!dragging || heldVisit.current?.primaryId !== bootstrap?.petId) heldVisit.current = currentVisit
  const visit = dragging ? heldVisit.current : currentVisit
  if (!dragging) heldReaction.current = bootstrap?.spritesheetUrl && reactions.input ? reactions : null
  const reaction = heldReaction.current
  const reactionSize = { width: Math.min(viewport.width - 16, reaction?.input?.kind === 'typing' ? Math.max(180, width * 1.3 + 24) : Math.max(160, width + 32)),
    height: Math.min(viewport.height - 32, width * 208 / 192 + (reaction?.input?.kind === 'typing' ? 36 : 72)) }
  const visitSize = { width: Math.max(160, Math.min(404, viewport.width - 16)), height: Math.min(300, viewport.height - 32) }
  const placement = petSurfaceLayout({
    anchor: nativeLayout ?? { anchorX: viewport.width / 2, anchorY: viewport.height / 2,
      viewportWidth: viewport.width, viewportHeight: viewport.height },
    petWidth: width, ...(visit ? { petSize: visitSize } : reaction ? { petSize: reactionSize } : {}), controls: controlsSize, notification: noticeSize, menu: menuSize
  })
  const business = effectivePetBusinessState({ activeStatus: active?.status ?? null, welcomeUntilMs: welcome, nowMs: now })
  const animation: PetAnimationState = resolveOverlayAnimationState({ resizeMode: false, dragging, dragDirection, hover, effectiveBusinessState: business })
  const nextExpiry = earliestPetNotificationExpiry(notifications, now)
  useEffect(() => {
    if (!welcome) return undefined
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, welcome - Date.now()))
    return () => window.clearTimeout(timer)
  }, [welcome])
  const trackProcess = notifications.some((item) => item.status === 'running' && typeof item.liveSinceMs === 'number')
  useEffect(() => {
    if (!trackProcess) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 200)
    return () => window.clearInterval(timer)
  }, [trackProcess])
  useEffect(() => {
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextExpiry])
  const version = bootstrap?.spriteVersionNumber ?? 1
  const height = Math.round(width * (PET_CELL_HEIGHT / PET_CELL_WIDTH))

  useEffect(() => {
    if (!menuOpen) return undefined
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setMenuOpen(false)
    }
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Element && target.closest('.pet-menu, .pet-sprite, .pet-joint-hit')) return
      setMenuOpen(false)
    }
    const onBlur = (): void => setMenuOpen(false)
    window.addEventListener('keydown', onKey)
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('blur', onBlur)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('blur', onBlur)
    }
  }, [menuOpen])

  const menuLabels = petContextMenuLabels(window.navigator?.language ?? 'en')
  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
    setMenuOpen(false)
    event.currentTarget.setPointerCapture(event.pointerId)
    dragOrigin.current = { x: event.screenX, y: event.screenY }
    bridge.beginDrag({ x: event.screenX, y: event.screenY })
  }
  const onPointerMove = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (!dragOrigin.current) return
    const dx = event.screenX - dragOrigin.current.x
    const dy = event.screenY - dragOrigin.current.y
    setDragDirection((current) => nextDragDirection(current, dx))
    if (classifyPointerGesture({ cancelled: false, dx, dy }) === 'drag') setDragging(true)
    bridge.moveDrag({ x: event.screenX, y: event.screenY })
  }
  const finishPointer = (event: React.PointerEvent<HTMLButtonElement>, cancelled: boolean): void => {
    if (!dragOrigin.current) return
    const gesture = classifyPointerGesture({
      cancelled,
      dx: event.screenX - dragOrigin.current.x,
      dy: event.screenY - dragOrigin.current.y
    })
    dragOrigin.current = null
    setDragging(false)
    if (cancelled || gesture === 'cancel') bridge.cancelDrag()
    else bridge.endDrag({ x: event.screenX, y: event.screenY })
  }

  const dismissNotification = (key: string): void => {
    setClosedKeys((current) => current.includes(key) ? current : [...current, key])
    void bridge.dismissNotification({ key })
  }

  useEffect(() => {
    if (!active) setExpanded(false)
  }, [active])

  useEffect(() => {
    for (const [threadId, prompt] of Object.entries(queued)) {
      const item = snapshot?.items.find((candidate) => candidate.threadId === threadId)
      if (!item || item.status === 'running' || item.status === 'waiting' || inFlight.current.has(threadId)) continue
      inFlight.current.add(threadId)
      setSending((current) => new Set([...current, threadId]))
      void bridge.performAction({ type: 'follow-up', threadId, prompt, unitId: item.unitId, roomId: item.roomId }).then((result) => {
        if (!result.ok) {
          setErrors((current) => ({ ...current, [threadId]: '发送失败，请按回车重试' }))
          return
        }
        setDrafts((current) => ({ ...current, [threadId]: '' }))
        setErrors((current) => ({ ...current, [threadId]: '' }))
      }).finally(() => {
        setQueued((current) => {
          const next = { ...current }
          delete next[threadId]
          return next
        })
        setSending((current) => new Set([...current].filter((id) => id !== threadId)))
        inFlight.current.delete(threadId)
      })
    }
  }, [bridge, queued, snapshot])

  const runKey = (key: string): void => {
    const action = overlayKeyAction(key)
    if (action === 'close') void bridge.closeOverlay()
    if (action === 'expand' || action === 'shrink') {
      const next = nextMascotWidth(width, action === 'expand' ? 1 : -1)
      setWidth(next)
      bridge.resizeMascot(next)
      bridge.finishResize(next)
    }
    if (action === 'reply' && active) void bridge.performAction({ type: 'reply', threadId: active.threadId, unitId: active.unitId, roomId: active.roomId })
    if (action === 'stop' && active?.status === 'running' && active.turnId) {
      void bridge.performAction({ type: 'stop', threadId: active.threadId, turnId: active.turnId, unitId: active.unitId })
    }
    if (action === 'dismiss' && active) dismissNotification(active.key)
  }

  return (
    <div className="pet-overlay">
      <div className="pet-hit" ref={hitRef}>
        {bubblesRevealed && placement.notificationMaxHeight >= 48 ? (
          <div className="pet-notification-position" ref={noticeRef} style={{ left: placement.notification.left,
            top: placement.notification.top, width: placement.notification.width }}>
            <PetWorkBubbles
              notifications={notifications}
              mascotWidth={width}
              maxHeight={placement.notificationMaxHeight}
              expanded={expanded}
              editing={editing}
              drafts={drafts}
              queued={queued}
              sending={sending}
              errors={errors}
              now={now}
              onOpen={(item) => {
                if (!expanded && notifications.length > 1) {
                  setExpanded(true)
                  return
                }
                void bridge.performAction({ type: 'open', threadId: item.threadId, unitId: item.unitId, roomId: item.roomId })
              }}
              onEdit={(threadId) => setEditing(editing === threadId ? null : threadId)}
              onDraft={(threadId, value) => setDrafts((current) => ({ ...current, [threadId]: value }))}
              onQueue={(threadId, prompt) => {
                setErrors((current) => ({ ...current, [threadId]: '' }))
                setQueued((current) => ({ ...current, [threadId]: prompt }))
              }}
              onStop={(item) => {
                if (!item.turnId) return
                setErrors((current) => ({ ...current, [item.threadId]: '' }))
                void bridge.performAction({ type: 'stop', threadId: item.threadId, turnId: item.turnId, unitId: item.unitId }).then((result) => {
                  if (!result.ok) setErrors((current) => ({ ...current, [item.threadId]: '终止失败，请重试' }))
                })
              }}
              onDismiss={(item, event) => {
                event.stopPropagation()
                dismissNotification(item.key)
              }}
              onAnswer={(item) => {
                setClosedKeys((current) => current.includes(item.key) ? current : [...current, item.key])
                void bridge.performAction({ type: 'open', threadId: item.threadId, unitId: item.unitId, roomId: item.roomId })
              }}
              onCollapse={() => {
                setExpanded(false)
                setEditing(null)
              }}
            />
          </div>
        ) : null}
        <div className="pet-companion" ref={companionRef} onFocusCapture={(event) => {
          if ((event.target as HTMLElement).matches('.pet-sprite:focus-visible, .pet-joint-hit:focus-visible')) setControlsHover(true)
        }} onBlurCapture={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget)) setControlsHover(false)
        }}>
          <div className="pet-character-stage" style={placement.pet}>
            {visit && bootstrap ? <PetVisitStage visit={visit} pet={bootstrap} pets={bootstrap.ensemblePets ?? []}
              language={window.navigator.language} width={visitSize.width} height={visitSize.height} mascotWidth={width}
              primaryOrigin={{ x: (nativeLayout?.anchorX ?? viewport.width / 2) - placement.pet.left,
                y: (nativeLayout?.anchorY ?? viewport.height / 2) - placement.pet.top }}
              onDismiss={() => void bridge.dismissPetVisit()}
              actorEvents={{ onPointerDown, onPointerMove, onPointerUp: (event) => finishPointer(event, false),
                onPointerCancel: (event) => finishPointer(event, true),
                onContextMenu: (event) => { event.preventDefault(); setMenuOpen((open) => !open) },
                onKeyDown: (event) => { if (overlayKeyAction(event.key)) { event.preventDefault(); runKey(event.key) } }
              }} /> : reaction && bootstrap ? <PetReactionStage pet={bootstrap}
              typing={reaction.presence.input?.typing} expiresAt={reaction.presence.input?.expiresAt ?? 0}
              primaryOrigin={{ x: (nativeLayout?.anchorX ?? viewport.width / 2) - placement.pet.left,
                y: (nativeLayout?.anchorY ?? viewport.height / 2) - placement.pet.top }}
              eventId={reaction.presence.modelChangedAt} kind={reaction.input?.kind ?? 'typing'} level={reaction.input?.level ?? 0}
              language={window.navigator.language} width={reactionSize.width} height={reactionSize.height} mascotWidth={width} paused={dragging}
              actorEvents={{ onPointerDown, onPointerMove, onPointerUp: (event) => finishPointer(event, false),
                onPointerCancel: (event) => finishPointer(event, true),
                onContextMenu: (event) => { event.preventDefault(); setMenuOpen((open) => !open) },
                onKeyDown: (event) => { if (overlayKeyAction(event.key)) { event.preventDefault(); runKey(event.key) } }
              }} /> : <PetResidentSprite
              animation={animation} version={version} sheet={bootstrap?.spritesheetUrl}
              type="button"
              className="pet-sprite"
              aria-label={bootstrap?.displayName ?? 'Desktop pet'}
              aria-haspopup="menu"
              aria-expanded={menuOpen}
              aria-controls={menuOpen ? 'pet-context-menu' : undefined}
              style={{ width, height }}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={(event) => finishPointer(event, false)}
              onPointerCancel={(event) => finishPointer(event, true)}
              onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setMenuOpen((open) => !open) }}
              onKeyDown={(event) => {
                if (menuOpen && event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); setMenuOpen(false); return }
                if (overlayKeyAction(event.key)) { event.preventDefault(); runKey(event.key) }
              }}
            />}
          </div>
          {menuOpen ? <div className="pet-menu-position" ref={menuRef}
            style={{ left: placement.menu.left, top: placement.menu.top }}>
            <PetContextMenu labels={menuLabels}
              onEnsemble={() => { setMenuOpen(false); void bridge.requestPetVisit() }}
              onClose={() => { setMenuOpen(false); hitRef.current?.querySelector<HTMLButtonElement>('.pet-sprite, .pet-joint-hit')?.focus() }}
              onSettings={() => { setMenuOpen(false); bridge.openPetSettings() }}
              onHide={() => { setMenuOpen(false); void bridge.closeOverlay() }} />
          </div> : null}
          <div className="pet-controls-position" ref={controlsRef}
            style={{ left: placement.controls.left, top: placement.controls.top }}>
            <PetQuickChat bridge={bridge} notificationCount={notifications.length} bubblesHidden={bubblesHidden}
              revealed={controlsRevealed} visitsEnabled={(bootstrap?.visits ?? defaultPetVisits()).enabled}
              onToggleVisits={() => {
                const current = bootstrap?.visits ?? defaultPetVisits()
                if (current.enabled && visit) void bridge.dismissPetVisit()
                void bridge.setPetVisitPreferences({ ...current, enabled: !current.enabled })
              }}
              onInteractiveChange={setQuickChatInteractive} onToggleBubbles={() => {
                const collapsed = !bubblesHidden
                setBubblesCollapsed(collapsed)
                setExpanded(false)
                setEditing(null)
                void bridge.setBubblesCollapsed(collapsed)
              }} />
            {bootstrap?.interactionNote && (controlsRevealed || quickChatInteractive)
              ? <p className="pet-note">{bootstrap.interactionNote}</p> : null}
          </div>
        </div>

      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><PetOverlayApp /></React.StrictMode>)

declare global {
  interface Window { kunPetOverlay: import('@shared/pets').PetOverlayBridge }
}
