import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactElement
} from 'react'
import { Briefcase, Code2, MessagesSquare } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useRoomAttentionCount } from '../rooms/useRoomEvents'
import { useChatStore } from '../../store/chat-store'

type Props = {
  activeView:
    | 'chat'
    | 'write'
    | 'rooms'
    | 'design'
    | 'claw'
    | 'board'
    | 'schedule'
    | 'workflow'
    | 'subagents'
    | 'ade'
  onCodeOpen: () => void
  onWriteOpen: () => void
  onAdeOpen?: () => void
  disabled?: boolean
  disabledReason?: string
}

/**
 * Code, Work and Chats share one pill switch. Chats is the agent-chat route (private,
 * group and assistant conversations); the retired Rooms route is still shown as Code.
 */
type WorkspaceMode = 'chat' | 'write' | 'chats'

type Thumb = { left: number; width: number }

export function WorkspaceModeTabs({
  activeView,
  onCodeOpen,
  onWriteOpen,
  disabled = false,
  disabledReason
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const roomAttention = useRoomAttentionCount()
  const inChats = useChatStore((state) => state.route === 'agent-chat')
  const rootRef = useRef<HTMLDivElement>(null)
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const [thumb, setThumb] = useState<Thumb | null>(null)
  const selectedMode: WorkspaceMode =
    inChats ? 'chats' : activeView === 'write' ? 'write' : 'chat'
  const options = [
    { id: 'chat' as const, label: t('code'), Icon: Code2 },
    { id: 'write' as const, label: t('workspaceModeWorkLabel'), Icon: Briefcase },
    { id: 'chats' as const, label: t('workspaceModeChatsLabel'), Icon: MessagesSquare }
  ]
  const selectedIndex = options.findIndex((option) => option.id === selectedMode)
  const modesAriaLabel = `${t('code')} / ${t('workspaceModeWorkLabel')} / ${t('workspaceModeChatsLabel')}`

  useLayoutEffect(() => {
    const node = tabRefs.current[selectedIndex]
    if (!node) return
    setThumb((current) =>
      current && current.left === node.offsetLeft && current.width === node.offsetWidth
        ? current
        : { left: node.offsetLeft, width: node.offsetWidth }
    )
  }, [selectedIndex, t])

  useEffect(() => {
    const root = rootRef.current
    if (!root || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => {
      const node = tabRefs.current[selectedIndex]
      if (node) setThumb({ left: node.offsetLeft, width: node.offsetWidth })
    })
    observer.observe(root)
    return () => observer.disconnect()
  }, [selectedIndex])

  const selectMode = (mode: WorkspaceMode): void => {
    if (mode === 'write') {
      if (activeView !== 'write') onWriteOpen()
      return
    }
    if (mode === 'chats') {
      // The last conversation stays selected in its store, so the route alone reopens it.
      if (!inChats) useChatStore.getState().setRoute('agent-chat')
      return
    }
    // Automation and board views map to the Code tab but are not Code itself, and a
    // conversation is not a Code task: picking Code from either returns to the task.
    if (inChats || activeView !== 'chat') onCodeOpen()
  }

  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    event.preventDefault()
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? options.length - 1
          : (index + (event.key === 'ArrowRight' ? 1 : -1) + options.length) % options.length
    tabRefs.current[next]?.focus()
  }

  return (
    <div
      ref={rootRef}
      role="tablist"
      aria-label={modesAriaLabel}
      data-workspace-mode-trigger
      data-workspace-mode={selectedMode}
      data-cursor-spotlight-target
      className="kun-mode-pill ds-no-drag"
      title={disabled ? disabledReason : undefined}
    >
      <span
        aria-hidden
        className="kun-mode-thumb"
        data-ready={thumb ? 'true' : 'false'}
        style={thumb ? { transform: `translateX(${thumb.left}px)`, width: thumb.width } : undefined}
      />
      {options.map(({ id, label, Icon }, index) => {
        const selected = id === selectedMode
        const unread = id === 'chats' && !selected && roomAttention > 0
        return (
          <button
            key={id}
            ref={(node) => {
              tabRefs.current[index] = node
            }}
            type="button"
            role="tab"
            aria-selected={selected}
            aria-label={unread ? `${label} · ${t('roomsAttention')}` : label}
            data-workspace-mode={id}
            data-selected={selected ? 'true' : 'false'}
            data-thumb-pending={selected && !thumb ? 'true' : undefined}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            title={disabled ? disabledReason : label}
            onClick={() => selectMode(id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className="kun-mode-tab"
          >
            <Icon aria-hidden className="kun-mode-tab-icon h-[17px] w-[17px] shrink-0" strokeWidth={1.8} />
            {selected ? <span className="kun-mode-tab-label">{label}</span> : null}
            {unread ? <span aria-hidden className="kun-mode-tab-dot" /> : null}
          </button>
        )
      })}
    </div>
  )
}
