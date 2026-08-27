import type { ReactElement } from 'react'
import { Server, TerminalSquare } from 'lucide-react'
import type { RemoteSshHost } from '@shared/remote-ssh'

export type TerminalNewTabMenuAnchor = {
  /** Viewport x of the anchor button's left edge. */
  x: number
  /** Viewport y of the anchor button's top edge; the menu opens above it. */
  y: number
}

const MENU_MIN_WIDTH = 224

// Rendered through a portal to document.body so the overflow-x-auto tablist
// cannot clip it (unlike an absolutely-positioned child, which the scroll
// container both clips and isolates in its own stacking context).
export function TerminalNewTabMenu({
  anchor,
  remoteHosts,
  onNewLocalTab,
  onNewSshTab,
  t
}: {
  anchor: TerminalNewTabMenuAnchor
  remoteHosts: RemoteSshHost[]
  onNewLocalTab: () => void
  onNewSshTab: (host: RemoteSshHost) => void
  t: (key: string, options?: Record<string, unknown>) => string
}): ReactElement {
  const left = Math.min(Math.max(anchor.x, 8), window.innerWidth - MENU_MIN_WIDTH - 8)
  const bottom = Math.max(window.innerHeight - anchor.y + 8, 8)
  return (
    <div
      role="menu"
      aria-label={t('terminalNewTab')}
      className="ds-no-drag fixed z-[1000] min-w-[224px] rounded-xl border border-ds-border bg-ds-card p-1.5 text-[12px] shadow-[0_18px_48px_rgba(2,6,16,0.28)]"
      style={{ left, bottom }}
      onPointerDown={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.preventDefault()}
    >
      <button
        type="button"
        role="menuitem"
        onClick={onNewLocalTab}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-ds-ink hover:bg-ds-hover"
      >
        <TerminalSquare className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        {t('terminalNewLocalTab', { defaultValue: 'Local terminal' })}
      </button>
      {remoteHosts.map((host) => (
        <button
          key={host.id}
          type="button"
          role="menuitem"
          onClick={() => onNewSshTab(host)}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-ds-ink hover:bg-ds-hover"
        >
          <Server className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className="min-w-0">
            <span className="block truncate">SSH · {host.label}</span>
            <span className="block truncate text-[10px] text-ds-muted">
              {host.username}@{host.hostname}
            </span>
          </span>
        </button>
      ))}
      {remoteHosts.length === 0 ? (
        <p className="px-3 py-2 text-ds-muted">
          {t('terminalNoSshServers', { defaultValue: 'Add an SSH server in Terminal settings.' })}
        </p>
      ) : null}
    </div>
  )
}
