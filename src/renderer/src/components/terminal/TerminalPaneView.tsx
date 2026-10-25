import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { Copy, Download, MessageCircle, RotateCw, Search, SquareTerminal, X } from 'lucide-react'
import { quoteShellWord } from '@shared/app-settings-terminal-dock'
import { useTerminalDockStore, updateSessionStatus } from './terminal-dock-store'
import { paneTitle, type TerminalPane } from './terminal-dock-model'
import {
  attachTerminal,
  ensureTerminalInstance,
  feedKunProcess,
  focusTerminal,
  onTerminalMark,
  onTerminalSelection,
  pasteIntoTerminal,
  restartTerminal,
  setTerminalVisible,
  terminalInstance
} from './terminal-instance-registry'
import type { ShellCommandRecord } from './terminal-shell-commands'
import {
  ptySessionIdFor,
  rerunCommand,
  sendCommandToKun,
  sendScreenToKun,
  sendSelectionToKun,
  type DockScope
} from './terminal-dock-actions'
import { TerminalFindBar } from './TerminalFindBar'
import { useKunProcessStore } from './terminal-kun-processes'
import { TerminalTargetIcon } from './TerminalIcon'
import {
  AgentUnitStrip,
  KunProcessInput,
  KunProcessStrip,
  TerminalErrorOverlay,
  TerminalExitBar,
  TerminalFailureBar
} from './TerminalPaneChrome'

type T = (key: string, options?: Record<string, unknown>) => string

type MarkMenu = { record: ShellCommandRecord; x: number; y: number }

export function TerminalPaneView({
  scope,
  pane,
  focused,
  showHeader,
  visible,
  restore,
  findRequest,
  onCloseFind,
  onFocus,
  onClose,
  onNotify,
  t
}: {
  scope: DockScope
  pane: TerminalPane
  focused: boolean
  showHeader: boolean
  visible: boolean
  restore: boolean
  /** Bumped (with an optional seed query) to open find in this pane. */
  findRequest: { seq: number; query?: string } | null
  onCloseFind: () => void
  onFocus: () => void
  onClose: () => void
  onNotify: (message: string) => void
  t: T
}): ReactElement {
  const ptySessionId = ptySessionIdFor(scope.workspaceRoot, pane)
  const status = useTerminalDockStore((state) => state.status[ptySessionId])
  const viewportRef = useRef<HTMLDivElement>(null)
  const pointerRef = useRef<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState('')
  const [markMenu, setMarkMenu] = useState<MarkMenu | null>(null)
  const [dragging, setDragging] = useState(false)
  const [findSeed, setFindSeed] = useState<string | undefined>(undefined)
  const [findOpen, setFindOpen] = useState(false)

  useLayoutEffect(() => {
    ensureTerminalInstance({ ptySessionId, pane, workspaceRoot: scope.workspaceRoot, restore })
    if (pane.target.kind === 'kun-process') {
      const processId = pane.target.processId
      const process = useKunProcessStore.getState().processes.find((candidate) => candidate.id === processId)
      if (process) feedKunProcess(ptySessionId, process.output ?? '', process.status === 'running', process.exitCode)
    }
    const container = viewportRef.current
    if (!container) return
    return attachTerminal(ptySessionId, container)
    // The instance outlives this view; only identity changes re-attach.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ptySessionId])

  useEffect(() => {
    setTerminalVisible(ptySessionId, visible)
    return () => setTerminalVisible(ptySessionId, false)
  }, [ptySessionId, visible])

  useEffect(() => {
    if (focused && visible) requestAnimationFrame(() => focusTerminal(ptySessionId))
  }, [focused, ptySessionId, visible])

  useEffect(() => {
    if (!findRequest) return
    setFindSeed(findRequest.query)
    setFindOpen(true)
  }, [findRequest])

  useEffect(() => onTerminalSelection(ptySessionId, (text) => setSelection(text.trim() ? text : '')), [ptySessionId])
  useEffect(() => onTerminalMark(ptySessionId, (record, anchor) => {
    setMarkMenu({ record, x: anchor.left + anchor.width + 6, y: anchor.top - 4 })
  }), [ptySessionId])

  useEffect(() => {
    if (!markMenu) return
    const close = (): void => setMarkMenu(null)
    window.addEventListener('pointerdown', close)
    window.addEventListener('keydown', close)
    return () => {
      window.removeEventListener('pointerdown', close)
      window.removeEventListener('keydown', close)
    }
  }, [markMenu])

  const closeFind = (): void => {
    setFindOpen(false)
    onCloseFind()
    focusTerminal(ptySessionId)
  }
  const restart = (): void => { void restartTerminal(ptySessionId) }
  const notifyAttach = (ok: boolean): void => onNotify(ok ? t('termDockAttached') : t('termDockAttachUnavailable'))

  const copy = (text: string): void => { void navigator.clipboard.writeText(text).catch(() => undefined) }

  const onDrop = (event: DragEvent<HTMLDivElement>): void => {
    setDragging(false)
    if (pane.target.kind === 'kun-process' || !event.dataTransfer.files.length) return
    event.preventDefault()
    const paths = [...event.dataTransfer.files]
      .map((file) => window.kunGui.getPathForFile?.(file) ?? '')
      .filter(Boolean)
      .map(quoteShellWord)
    if (paths.length) pasteIntoTerminal(ptySessionId, `${paths.join(' ')} `)
    focusTerminal(ptySessionId)
  }

  const showFailure = status?.phase === 'ready' && status.lastFailure && pane.target.kind === 'local'
  const unitId = status?.unitId
  const toolbarPosition = pointerRef.current && viewportRef.current
    ? (() => {
        const bounds = viewportRef.current!.getBoundingClientRect()
        return { left: Math.max(8, Math.min(pointerRef.current!.x - bounds.left, bounds.width - 320)), top: Math.max(6, pointerRef.current!.y - bounds.top - 44) }
      })()
    : { left: 24, top: 8 }

  return (
    <div className="kun-terminal-pane" data-focused={focused ? 'true' : 'false'} onPointerDownCapture={onFocus}>
      {showHeader ? (
        <div className="kun-terminal-pane-header">
          {focused ? <span className="kun-terminal-status-dot" data-dot="running" aria-label={t('termDockFocusedPane')} /> : null}
          <TerminalTargetIcon target={pane.target} size={13} />
          <strong>{paneTitle(pane, status, t('termDockShell'))}</strong>
          {status?.cwd ? <span>{status.cwd.replace(window.kunGui?.homeDir ?? '\u0000', '~')}</span> : null}
          <span className="kun-terminal-spacer" />
          <button type="button" className="kun-terminal-icon-button" data-size="sm" aria-label={t('termDockClosePane')} title={t('termDockClosePane')} onClick={onClose}>
            <X className="h-3 w-3" strokeWidth={1.9} />
          </button>
        </div>
      ) : null}
      {pane.target.kind === 'kun-process' ? <KunProcessStrip processId={pane.target.processId} t={t} /> : null}
      {pane.target.kind === 'agent' && unitId ? <AgentUnitStrip unitId={unitId} t={t} /> : null}
      <div
        ref={viewportRef}
        className="kun-terminal-viewport"
        onMouseUp={(event) => { pointerRef.current = { x: event.clientX, y: event.clientY } }}
        onDragOver={(event) => {
          if (pane.target.kind === 'kun-process' || !event.dataTransfer.types.includes('Files')) return
          event.preventDefault()
          setDragging(true)
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        {status?.phase === 'error' ? <TerminalErrorOverlay message={status.error ?? ''} onRestart={restart} t={t} /> : null}
        {findOpen ? <TerminalFindBar key={findRequest?.seq ?? 0} ptySessionId={ptySessionId} initialQuery={findSeed} onClose={closeFind} t={t} /> : null}
        {selection && focused && !findOpen ? (
          <div className="kun-terminal-popover kun-terminal-toolbar" style={{ position: 'absolute', ...toolbarPosition }} role="toolbar" aria-label={t('termDockSelectionActions')}>
            <button type="button" onClick={() => copy(selection)}><Copy className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockCopy')}</button>
            <button type="button" data-tone="accent" onClick={() => void sendSelectionToKun(scope, pane, selection).then(notifyAttach)}>
              <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockSendSelection')}
            </button>
            <button type="button" onClick={() => { setFindSeed(selection.split('\n')[0]!.slice(0, 120)); setFindOpen(true) }}>
              <Search className="h-3.5 w-3.5" strokeWidth={1.9} />{t('termDockFind')}
            </button>
          </div>
        ) : null}
        {dragging ? (
          <div className="kun-terminal-drop">
            <Download className="h-5 w-5 text-[var(--ds-accent)]" strokeWidth={1.8} aria-hidden="true" />
            {t('termDockDropFiles')}
            <small>{t('termDockDropFilesNote')}</small>
          </div>
        ) : null}
      </div>
      {showFailure && status?.lastFailure ? (
        <TerminalFailureBar
          failure={status.lastFailure}
          onSend={() => void sendCommandToKun(scope, pane, status.lastFailure!.recordId).then(notifyAttach)}
          onRerun={() => rerunCommand(scope, pane, status.lastFailure!.command)}
          onDismiss={() => updateSessionStatus(ptySessionId, { lastFailure: undefined })}
          t={t}
        />
      ) : null}
      {status?.phase === 'exited' && pane.target.kind !== 'kun-process' ? (
        <TerminalExitBar
          status={status}
          ssh={pane.target.kind === 'ssh'}
          onRestart={restart}
          onClose={onClose}
          onSendToKun={() => void sendScreenToKun(scope, pane).then(notifyAttach)}
          t={t}
        />
      ) : null}
      {pane.target.kind === 'kun-process' ? <KunProcessInput processId={pane.target.processId} t={t} /> : null}
      {markMenu ? createPortal(
        <CommandMarkMenu
          menu={markMenu}
          onCopyCommand={() => copy(markMenu.record.command)}
          onCopyOutput={() => copy((terminalInstance(ptySessionId)?.commands?.output(markMenu.record) ?? []).join('\n'))}
          onRerun={() => rerunCommand(scope, pane, markMenu.record.command)}
          onSend={() => void sendCommandToKun(scope, pane, markMenu.record.id).then(notifyAttach)}
          onClose={() => setMarkMenu(null)}
          t={t}
        />,
        document.body
      ) : null}
    </div>
  )
}

function CommandMarkMenu({
  menu,
  onCopyCommand,
  onCopyOutput,
  onRerun,
  onSend,
  onClose,
  t
}: {
  menu: MarkMenu
  onCopyCommand: () => void
  onCopyOutput: () => void
  onRerun: () => void
  onSend: () => void
  onClose: () => void
  t: T
}): ReactElement {
  const run = (action: () => void) => () => {
    action()
    onClose()
  }
  const { record } = menu
  return (
    <div
      className="kun-terminal-popover kun-terminal-menu"
      role="menu"
      aria-label={t('termDockCommandActions')}
      style={{ left: Math.min(menu.x, window.innerWidth - 260), top: Math.min(menu.y, window.innerHeight - 220) }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="kun-terminal-menu-heading kun-terminal-mono" style={{ maxWidth: 260, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {record.command || t('termDockLastCommand')}
        {typeof record.exitCode === 'number' ? ` · ${t('termDockExitCode', { code: record.exitCode })}` : ''}
      </div>
      <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(onCopyCommand)} disabled={!record.command}>
        <SquareTerminal className="h-3.5 w-3.5" strokeWidth={1.9} /><span className="kun-terminal-menu-label">{t('termDockCopyCommand')}</span>
      </button>
      <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(onCopyOutput)}>
        <Copy className="h-3.5 w-3.5" strokeWidth={1.9} /><span className="kun-terminal-menu-label">{t('termDockCopyOutput')}</span>
      </button>
      <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(onRerun)} disabled={!record.command || record.state === 'running'}>
        <RotateCw className="h-3.5 w-3.5" strokeWidth={1.9} /><span className="kun-terminal-menu-label">{t('termDockRerun')}</span>
      </button>
      <button type="button" role="menuitem" className="kun-terminal-menu-item" onClick={run(onSend)} disabled={record.state === 'running'}>
        <MessageCircle className="h-3.5 w-3.5" strokeWidth={1.9} /><span className="kun-terminal-menu-label">{t('termDockSendToKun')}</span>
      </button>
    </div>
  )
}
