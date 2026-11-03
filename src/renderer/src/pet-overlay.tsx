import React, { useEffect, useRef, useState } from 'react'
import ReactDOM from 'react-dom/client'
import {
  PET_CELL_HEIGHT,
  PET_CELL_WIDTH,
  PET_SHEET_COLUMNS,
  petSheetRowsForVersion,
  type PetActivitySnapshot,
  type PetAnimationState,
  type PetOverlayBootstrap
} from '@shared/pets'
import { frameAtElapsedMs, staticFrame } from './pets/pet-animation'
import { acceptPetSnapshot, earliestPetNotificationExpiry, visiblePetNotifications } from './pets/pet-activity'
import { PetWorkBubbles } from './pets/pet-bubble'
import { effectivePetBusinessState, nextDragDirection, resolveOverlayAnimationState, type PetDragDirection } from './pets/pet-overlay-state'
import { classifyPointerGesture, nextMascotWidth, overlayKeyAction, welcomeUntil } from './pets/pet-pointer'
import './pet-overlay.css'

function PetOverlayApp(): React.JSX.Element {
  const bridge = window.kunPetOverlay
  const [bootstrap, setBootstrap] = useState<PetOverlayBootstrap | null>(null)
  const [snapshot, setSnapshot] = useState<PetActivitySnapshot | null>(null)
  const [width, setWidth] = useState(112)
  const [now, setNow] = useState(() => Date.now())
  const [welcome, setWelcome] = useState<number | null>(null)
  const [hover, setHover] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [dragDirection, setDragDirection] = useState<PetDragDirection>('right')
  const [expanded, setExpanded] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [editing, setEditing] = useState<string | null>(null)
  const [drafts, setDrafts] = useState<Record<string, string>>({})
  const [queued, setQueued] = useState<Record<string, string>>({})
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [sending, setSending] = useState<Set<string>>(new Set())
  const [closedKeys, setClosedKeys] = useState<string[]>([])
  const inFlight = useRef(new Set<string>())
  const [reduced, setReduced] = useState(false)
  const [frameClock, setFrameClock] = useState(0)
  const dragOrigin = useRef<{ x: number; y: number } | null>(null)
  const hitRef = useRef<HTMLDivElement | null>(null)
  const started = useRef(0)

  useEffect(() => {
    const media = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    setReduced(Boolean(media?.matches))
    const onChange = (event: MediaQueryListEvent): void => setReduced(event.matches)
    media?.addEventListener('change', onChange)
    let cancelled = false
    void bridge.getBootstrap().then((value) => {
      if (cancelled) return
      setBootstrap(value)
      setWidth(value.mascotWidthPx)
      setWelcome(welcomeUntil(value.petId, value.welcomedPetIds, Date.now()))
      if (value.petId && !value.welcomedPetIds.includes(value.petId)) void bridge.recordPetWelcomed(value.petId)
    })
    const stopBootstrap = bridge.onBootstrapChanged((value) => {
      setBootstrap(value)
      setWidth(value.mascotWidthPx)
    })
    const stopActivity = bridge.onActivityChanged((value) => {
      setSnapshot((current) => acceptPetSnapshot(current, value))
      setNow(Date.now())
    })
    const stopFocus = bridge.onMainWindowFocused(() => {
      setExpanded(false)
      setSelected(null)
      setEditing(null)
    })
    return () => { cancelled = true; stopBootstrap(); stopActivity(); stopFocus(); media?.removeEventListener('change', onChange) }
  }, [bridge])

  useEffect(() => {
    bridge.setPointerInteractive(hover || dragging || expanded || editing !== null)
  }, [bridge, hover, dragging, expanded, editing])

  useEffect(() => {
    const element = hitRef.current
    if (!element) return undefined
    const observer = new ResizeObserver(() => {
      const rect = element.getBoundingClientRect()
      bridge.reportBounds({ width: Math.round(rect.width), height: Math.round(rect.height), anchorX: Math.round(rect.left), anchorY: Math.round(rect.top) })
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [bridge, bootstrap?.petId, expanded])

  const dismissed = new Set([...(bootstrap?.dismissedNotificationKeys ?? []), ...closedKeys])
  const retained = new Set([...(editing ? [editing] : []), ...Object.keys(queued)])
  const notifications = snapshot ? visiblePetNotifications(snapshot, dismissed, now, retained) : []
  const active = notifications[0] ?? null
  const business = effectivePetBusinessState({ activeStatus: active?.status ?? null, welcomeUntilMs: welcome, nowMs: now })
  const animation: PetAnimationState = resolveOverlayAnimationState({ resizeMode: false, dragging, dragDirection, hover, effectiveBusinessState: business })
  const nextExpiry = earliestPetNotificationExpiry(notifications, now)
  useEffect(() => {
    if (!welcome) return undefined
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, welcome - Date.now()))
    return () => window.clearTimeout(timer)
  }, [welcome])
  useEffect(() => {
    if (nextExpiry === null) return undefined
    const timer = window.setTimeout(() => setNow(Date.now()), Math.max(0, nextExpiry - Date.now() + 1))
    return () => window.clearTimeout(timer)
  }, [nextExpiry])
  useEffect(() => {
    if (reduced) return undefined
    started.current = performance.now()
    let frame = 0
    const tick = (time: number): void => { setFrameClock(time - started.current); frame = requestAnimationFrame(tick) }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [reduced, animation])
  const version = bootstrap?.spriteVersionNumber ?? 1
  const frame = reduced ? staticFrame(animation, version) : frameAtElapsedMs(animation, frameClock, version)
  const height = Math.round(width * (PET_CELL_HEIGHT / PET_CELL_WIDTH))
  const rows = petSheetRowsForVersion(version)

  const onPointerDown = (event: React.PointerEvent<HTMLButtonElement>): void => {
    if (event.button !== 0) return
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
      <div className={`pet-hit${active ? ' pet-hit-with-bubble' : ''}`} ref={hitRef} onMouseEnter={() => setHover(true)} onMouseLeave={() => setHover(false)}>
        {bootstrap?.interactionNote ? <p className="pet-note">{bootstrap.interactionNote}</p> : null}
        {active ? (
          <PetWorkBubbles
            notifications={notifications}
            mascotWidth={width}
            expanded={expanded}
            selected={selected}
            editing={editing}
            drafts={drafts}
            queued={queued}
            sending={sending}
            errors={errors}
            onToggle={(threadId) => {
              if (!expanded && notifications.length > 1) {
                setExpanded(true)
                return
              }
              const showActions = selected === threadId
              setSelected(showActions ? null : threadId)
              if (editing !== threadId || showActions) setEditing(null)
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
              setSelected(null)
              setEditing(null)
            }}
          />
        ) : null}
        <button
          type="button"
          className="pet-sprite"
          aria-label={bootstrap?.displayName ?? 'Desktop pet'}
          style={{
            width,
            height,
            backgroundImage: bootstrap?.spritesheetUrl ? `url("${bootstrap.spritesheetUrl}")` : undefined,
            backgroundSize: `${PET_SHEET_COLUMNS * 100}% ${rows * 100}%`,
            backgroundPosition: frame.backgroundPosition
          }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={(event) => finishPointer(event, false)}
          onPointerCancel={(event) => finishPointer(event, true)}
          onKeyDown={(event) => { if (overlayKeyAction(event.key)) { event.preventDefault(); runKey(event.key) } }}
        />
      </div>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><PetOverlayApp /></React.StrictMode>)

declare global {
  interface Window { kunPetOverlay: import('@shared/pets').PetOverlayBridge }
}
