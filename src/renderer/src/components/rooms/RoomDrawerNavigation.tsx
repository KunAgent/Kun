import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import type { RoomContentReference } from '@shared/rooms-api'
import { RoomDetailsDrawer, type RoomDetailsSection } from './RoomDetailsDrawer'
import './rooms-replies.css'

export type RoomDrawerTarget =
  | { kind: 'agent'; agentId?: string }
  | { kind: 'handoffs'; selectedId?: string }
  | { kind: 'section'; section: RoomDetailsSection; memberId?: string; rootRequestId?: string }
  | { kind: 'task'; taskId: string }
  | { kind: 'reply'; messageId: string }
  | { kind: 'run'; runId: string }
  | { kind: 'content'; reference: RoomContentReference; messageId?: string }
  | { kind: 'files' }
  | { kind: 'models' }
  | { kind: 'settings' }
  | { kind: 'directory' }
export type RoomDrawerFrame = { key: number; target: RoomDrawerTarget; returnFocus: HTMLElement | null }

export function useRoomDrawerNavigation(roomId: string | null) {
  const [state, setState] = useState<{ roomId: string | null; frames: RoomDrawerFrame[] }>({ roomId, frames: [] })
  const serial = useRef(0)
  const frames = useMemo(() => state.roomId === roomId ? state.frames : [], [state, roomId])
  useEffect(() => setState({ roomId, frames: [] }), [roomId])
  const restore = (element: HTMLElement | null) => {
    requestAnimationFrame(() => { if (element?.isConnected) element.focus() })
  }
  const open = useCallback((target: RoomDrawerTarget, replace = false) => {
    const returnFocus = document.activeElement as HTMLElement | null
    setState((current) => {
      const previous = current.roomId === roomId ? current.frames : []
      const existing = previous.findIndex((frame) => JSON.stringify(frame.target) === JSON.stringify(target))
      if (!replace && existing >= 0) return { roomId, frames: previous.slice(0, existing + 1) }
      const frame = { key: ++serial.current, target, returnFocus }
      return { roomId, frames: replace ? [frame] : [...previous, frame] }
    })
  }, [roomId])
  const back = () => {
    const previous = frames.at(-1)?.returnFocus ?? null
    setState({ roomId, frames: frames.slice(0, -1) })
    restore(previous)
  }
  const close = () => {
    const previous = frames[0]?.returnFocus ?? null
    setState({ roomId, frames: [] })
    restore(previous)
  }
  const replaceTop = (target: RoomDrawerTarget) => setState((current) => {
    const previous = current.roomId === roomId ? current.frames : []
    const frame = { key: ++serial.current, target, returnFocus: previous.at(-1)?.returnFocus ?? null }
    return { roomId, frames: [...previous.slice(0, -1), frame] }
  })
  return { frames, open, back, close, replaceTop, section: (section: RoomDetailsSection) => open({ kind: 'section', section }, true) }
}

export function RoomDrawerNavigation({ frames, onBack, onClose, onSection, render }: {
  frames: RoomDrawerFrame[]
  onBack: () => void
  onClose: () => void
  onSection: (section: RoomDetailsSection) => void
  render: (target: RoomDrawerTarget, key: number, active: boolean) => ReactNode
}) {
  const { t } = useTranslation('common')
  const current = frames.at(-1)
  const panel = useRef<HTMLDivElement>(null)
  useEffect(() => {
    panel.current?.querySelector<HTMLElement>('[data-active-drawer-page="true"] [data-drawer-focus], [data-active-drawer-page="true"] button')?.focus()
  }, [current?.key])
  if (!current) return null
  const section = [...frames].reverse().find((frame) => frame.target.kind === 'section')?.target
  const title = current.target.kind === 'handoffs' ? t('agentsHandoffs') : current.target.kind === 'agent' ? t(current.target.agentId ? 'agentsProfileAndMemory' : 'agentsCreate') : current.target.kind === 'reply' ? t('roomsReplyThreadTitle') : current.target.kind === 'content' ? t('roomsReplyContentTitle') : current.target.kind === 'run' ? t('roomsAgentSession') : current.target.kind === 'files' ? t('directFiles') : current.target.kind === 'models' ? t('directModels') : current.target.kind === 'settings' ? t('roomsSettings') : current.target.kind === 'directory' ? t('agentsDirectory') : undefined
  return <RoomDetailsDrawer section={section?.kind === 'section' ? section.section : 'discussion'}
    onSection={onSection} onClose={onClose} onBack={onBack} frameKey={current.key}
    taskOpen={current.target.kind === 'task'} runOpen={current.target.kind === 'run'}
    childOpen={current.target.kind !== 'section' || frames.length > 1}
    title={title} backLabel={t('roomsReplyBack')}>
    <div ref={panel} className="rooms-drawer-pages">
      {frames.map((frame) => {
        const active = frame.key === current.key
        return <div key={frame.key} className={`rooms-drawer-page${frame.target.kind === 'section' ? ' is-section' : ''}`}
          data-active-drawer-page={active ? 'true' : 'false'} aria-hidden={!active ? true : undefined} inert={!active ? true : undefined}
          style={!active ? { visibility: 'hidden', pointerEvents: 'none' } : undefined}>
          {render(frame.target, frame.key, active)}
        </div>
      })}
    </div>
  </RoomDetailsDrawer>
}
