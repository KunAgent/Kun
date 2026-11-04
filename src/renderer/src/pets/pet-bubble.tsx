import type { MouseEvent, ReactElement } from 'react'
import type { PetActivityItem } from '@shared/pets'
import { petBubbleBody, petBubbleClock } from './pet-follow-up'

export function PetWorkBubbles(props: {
  notifications: PetActivityItem[]
  mascotWidth: number
  reservedHeight?: number
  expanded: boolean
  editing: string | null
  drafts: Record<string, string>
  queued: Record<string, string>
  sending: ReadonlySet<string>
  errors: Record<string, string>
  now: number
  onOpen: (item: PetActivityItem) => void
  onEdit: (threadId: string) => void
  onDraft: (threadId: string, value: string) => void
  onQueue: (threadId: string, prompt: string) => void
  onStop: (item: PetActivityItem) => void
  onDismiss: (item: PetActivityItem, event: MouseEvent) => void
  onAnswer: (item: PetActivityItem) => void
  onCollapse: () => void
}): ReactElement {
  const visible = props.expanded ? props.notifications : props.notifications.slice(0, 1)
  return (
    <div
      className={`pet-bubble-list${!props.expanded && props.notifications.length > 1 ? ' pet-bubble-stack' : ''}`}
      style={{ maxHeight: Math.max(64, Math.min(248, 363 - Math.ceil(props.mascotWidth * 208 / 192) - (props.reservedHeight ?? 0))) }}
    >
      {visible.map((item) => {
        const id = item.threadId
        const queued = props.queued[id]
        return (
          <div key={item.key} className="pet-work-bubble">
            <div className="pet-bubble-row">
              <button
                type="button"
                className="pet-work-bubble-content"
                aria-expanded={props.expanded}
                onClick={() => props.onOpen(item)}
              >
                <span className="pet-work-bubble-title">
                  {item.status === 'review' ? <ReviewMark /> : null}
                  {item.title}
                </span>
                <span className="pet-work-bubble-body">
                  {petBubbleClock(
                    petBubbleBody({ status: item.status, stalled: item.stalled, subtitle: item.subtitle, queued, sending: props.sending.has(id) }),
                    item.status,
                    item.liveSinceMs,
                    props.now
                  )}
                </span>
              </button>
              <button type="button" className="pet-round-action" aria-label="输入跟进消息" aria-pressed={props.editing === id} onClick={() => props.onEdit(id)}>
                <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M20 5v5a4 4 0 0 1-4 4H4m5-5-5 5 5 5" />
                </svg>
              </button>
              {item.status === 'running' && item.turnId ? (
                <button type="button" className="pet-round-action" aria-label="终止当前运行" onClick={() => props.onStop(item)}>
                  <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="5" width="14" height="14" rx="2.5" fill="currentColor" /></svg>
                </button>
              ) : null}
              <button type="button" className="pet-bubble-dismiss" aria-label="关闭气泡" onClick={(event) => props.onDismiss(item, event)}>×</button>
            </div>
            {props.editing === id ? (
              <input
                autoFocus
                aria-label="继续跟进"
                placeholder="继续跟进"
                maxLength={16000}
                className="pet-bubble-input"
                value={props.drafts[id] ?? ''}
                readOnly={Boolean(queued)}
                onChange={(event) => props.onDraft(id, event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Enter' || event.nativeEvent.isComposing) return
                  event.preventDefault()
                  const prompt = props.drafts[id]?.trim()
                  if (!prompt || queued) return
                  props.onQueue(id, prompt)
                }}
              />
            ) : null}
            {item.status === 'waiting' ? (
              <button type="button" className="pet-bubble-collapse" onClick={() => props.onAnswer(item)}>在会话中回答</button>
            ) : null}
            {props.errors[id] ? <div className="pet-bubble-error" role="alert">{props.errors[id]}</div> : null}
          </div>
        )
      })}
      {props.expanded && props.notifications.length > 1 ? (
        <button type="button" className="pet-bubble-collapse" onClick={props.onCollapse}>收起</button>
      ) : null}
    </div>
  )
}

function ReviewMark(): ReactElement {
  return (
    <svg className="pet-bubble-done" viewBox="0 0 16 16" role="img" aria-label="已完成">
      <circle cx="8" cy="8" r="8" fill="#079b46" />
      <path d="m4.75 8 2.15 2.15 4.35-4.3" fill="none" stroke="white" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
