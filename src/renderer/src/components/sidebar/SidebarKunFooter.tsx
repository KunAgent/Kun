import type { ReactElement } from 'react'
import { ChevronRight, Focus } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { kunWardrobeRules } from '@shared/rooms-api'
import { useChatStore } from '../../store/chat-store'
import { useUiPluginStore } from '../../store/ui-plugin-store'
import { RoomAvatar } from '../rooms/RoomAvatar'
import { WardrobeBottleIcon } from '../rooms/RoomWardrobeBottle'
import { useRoomUserProfileSync } from '../rooms/room-user-profile'
import { useWardrobe, wardrobeShelf } from '../rooms/room-wardrobe'
import { toggleWardrobePage } from '../wardrobe/wardrobe-route'
import '../rooms/room-wardrobe.css'

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

/**
 * Kun as a small companion: the user's own dressed-up look and what the runtime is doing.
 * The desktop app shows the account card instead; this stays for the remote browser client,
 * which has no account. It opens the wardrobe page (a second click goes back) and carries
 * the count of bottles waiting on the shelf.
 */
export function SidebarKunStatus({ onOpen = toggleWardrobePage }: { onOpen?: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const connection = useChatStore((state) => state.runtimeConnection)
  const active = useChatStore((state) => state.route === 'wardrobe')
  // The face is the avatar the user dresses in the wardrobe, so it follows every change.
  useRoomUserProfileSync()
  const wardrobe = useWardrobe().wardrobe
  const bottles = wardrobeShelf(wardrobe).length
  const ready = Boolean(wardrobe?.progress?.tenPull) && bottles >= kunWardrobeRules(wardrobe).tenPull
  const label = t(STATUS_KEYS[connection] ?? STATUS_KEYS.checking)
  const shelf = bottles ? t(ready ? 'wardrobePageBadgeReadyHint' : 'wardrobePageBadgeHint', { n: bottles }) : ''
  return (
    <button
      type="button"
      data-cursor-spotlight-target
      data-runtime-connection={connection}
      data-active={active || undefined}
      aria-current={active ? 'page' : undefined}
      onClick={onOpen}
      title={t('sidebarKunStatusOpen')}
      aria-label={`Kun · ${label}. ${t('sidebarKunStatusOpen')}${shelf ? `. ${shelf}` : ''}`}
      className="ds-sidebar-kun-status group flex w-full items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-left outline-none transition hover:bg-[var(--ds-sidebar-row-hover)] focus-visible:ring-2 focus-visible:ring-accent-tint/25"
    >
      <span className="ds-sidebar-kun-face" aria-hidden="true">
        <RoomAvatar user id="user" label="" size={30} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold leading-4 text-ds-ink">Kun</span>
        <span className="mt-0.5 flex items-center gap-1.5 text-[11.5px] leading-4 text-ds-faint">
          <span className="ds-sidebar-kun-dot h-1.5 w-1.5 shrink-0 rounded-full" aria-hidden="true" />
          <span className="truncate">{label}</span>
        </span>
      </span>
      {bottles ? (
        <span className="ds-sidebar-kun-bottles" data-ready={ready || undefined} data-sidebar-bottles={bottles} title={shelf} aria-hidden="true">
          <WardrobeBottleIcon size={16} state="sealed" />
          {ready ? t('wardrobePageBadgeReady') : bottles}
        </span>
      ) : null}
      {active ? <ChevronRight className="ds-sidebar-kun-open h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden="true" /> : null}
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
