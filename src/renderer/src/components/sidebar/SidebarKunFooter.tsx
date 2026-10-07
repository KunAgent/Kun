import type { ReactElement } from 'react'
import { Focus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useChatStore } from '../../store/chat-store'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import { RoomAvatarPortrait } from '../rooms/RoomAvatar'

/**
 * Theme packs with their own sidebar scene chrome style the original
 * mascot + Focus pill, so they keep that footer.
 */
export function useSidebarSceneFooter(): boolean {
  return useUiPluginStore((state) => {
    const runtime = state.activeRuntime
    if (!runtime || state.uiMode !== runtime.manifest.id) return false
    const chrome = runtime.manifest.scene?.chrome.sidebar
    return Boolean(chrome && chrome !== 'inherit')
  })
}

const STATUS_KEYS = {
  ready: 'sidebarKunStatusReady',
  checking: 'sidebarKunStatusStarting',
  idle: 'sidebarKunStatusStarting',
  offline: 'sidebarKunStatusOffline'
} as const

/** Kun as a small companion: its face and what the runtime is doing. */
export function SidebarKunStatus({ onOpen }: { onOpen: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const connection = useChatStore((state) => state.runtimeConnection)
  const label = t(STATUS_KEYS[connection] ?? STATUS_KEYS.checking)
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      data-runtime-connection={connection}
      onClick={onOpen}
      title={t('sidebarKunStatusOpen')}
      aria-label={`Kun · ${label}. ${t('sidebarKunStatusOpen')}`}
      className="ds-sidebar-kun-status group flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left outline-none transition hover:bg-[var(--ds-sidebar-row-hover)] focus-visible:ring-2 focus-visible:ring-accent-tint/25"
    >
      <span className="ds-sidebar-kun-face rooms-avatar" aria-hidden="true">
        <RoomAvatarPortrait index={0} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-4 text-ds-ink">Kun</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-4 text-ds-faint">
          <span className="ds-sidebar-kun-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
      </span>
    </button>
  )
}

/** Focus mode as an icon switch beside the phone and theme buttons. */
export function SidebarFocusModeSwitch({ enabled, onChange }: {
  enabled: boolean
  onChange: (enabled: boolean) => void
}): ReactElement {
  const { t } = useTranslation('common')
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      role="switch"
      aria-checked={enabled}
      aria-label={t('focusModeToggleLabel')}
      title={`${t('focusModeToggleTitle')} · ${enabled ? t('switchOn') : t('switchOff')}`}
      onClick={() => onChange(!enabled)}
      className={`ds-focus-mode-switch inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--ds-radius-control)] outline-none transition focus-visible:ring-2 focus-visible:ring-accent-tint/25 ${
        enabled ? 'bg-accent-soft text-accent' : 'text-ds-muted hover:bg-[var(--ds-sidebar-row-hover)] hover:text-ds-ink'
      }`}
    >
      <Focus className="h-4 w-4" strokeWidth={1.75} aria-hidden="true" />
    </button>
  )
}
