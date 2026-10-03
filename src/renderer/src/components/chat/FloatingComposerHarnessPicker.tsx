import { useCallback, useId, useState, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'
import { ChevronDown, History, Loader2, Settings2 } from 'lucide-react'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import { AgentIcon } from '../agent-icon'
import { useChatStore } from '../../store/chat-store'
import {
  harnessRowUnavailableDetail,
  harnessRowAvailable,
  useHarnessStore
} from '../../store/harness-store'
import { harnessConnectionPresentation, usesProviderOnlySdk } from '../../lib/harness-connection-presentation'
import { useComposerPickerPopover } from './use-composer-picker-popover'

const MENU_WIDTH = 288
const MENU_ESTIMATED_HEIGHT = 320

type Props = {
  disabled?: boolean
  /** Effective harness for the next turn ('kun' = the builtin loop). */
  harnessId: string
  harnessLabel: string
  rows: AdeHarnessRow[]
  loading: boolean
  /**
   * True when picking a different harness must be confirmed first — the
   * runtime starts a fresh native session and carries a handoff brief.
   */
  needsConfirm: (harnessId: string) => boolean
  /**
   * New-session continuation entry (01 §8): shown only for a fresh
   * one-to-one thread whose selected harness exposes a `historySource`
   * and the matching lab flag is on.
   */
  onContinueLocalSession?: () => void
  onOpen?: () => void
  onSelect: (harnessId: string) => void
}

/** New-turn picker: only explicitly enabled profiles with current readiness are selectable. */
export function FloatingComposerHarnessPicker({
  disabled = false,
  harnessId,
  harnessLabel,
  rows,
  loading,
  needsConfirm,
  onContinueLocalSession,
  onOpen,
  onSelect
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const [open, setOpen] = useState(false)
  const [pendingSwitch, setPendingSwitch] = useState<AdeHarnessRow | null>(null)
  const menuId = useId()

  const closeMenu = useCallback((): void => {
    setOpen(false)
    setPendingSwitch(null)
  }, [])
  const { triggerRef, menuRef, menuStyle } = useComposerPickerPopover({
    open,
    onClose: closeMenu,
    preferredWidth: MENU_WIDTH,
    estimatedHeight: MENU_ESTIMATED_HEIGHT
  })

  const pick = (row: AdeHarnessRow): void => {
    if (!harnessRowAvailable(row)) return
    if (row.definition.id === harnessId) {
      closeMenu()
      return
    }
    if (needsConfirm(row.definition.id)) {
      setPendingSwitch(row)
      return
    }
    onSelect(row.definition.id)
    setOpen(false)
  }

  const confirmSwitch = (): void => {
    if (!pendingSwitch || !rows.some((row) => row.definition.id === pendingSwitch.definition.id && harnessRowAvailable(row))) return
    onSelect(pendingSwitch.definition.id)
    setPendingSwitch(null)
    setOpen(false)
  }

  const openAgentSettings = (row?: AdeHarnessRow): void => {
    closeMenu()
    if (row && usesProviderOnlySdk(row)) useChatStore.getState().openSettings('providers')
    else {
      if (row) useHarnessStore.setState({ settingsHarnessId: row.definition.id })
      useChatStore.getState().openSettings('agentsHarnesses')
    }
  }

  const menu = open && typeof document !== 'undefined' ? (
    <div
      ref={menuRef}
      id={menuId}
      role="menu"
      aria-label={t('adeHarnessPicker.title')}
      style={{ ...menuStyle, overflowY: 'auto' }}
      data-harness-picker-menu
      className="ds-composer-harness-menu ds-no-drag fixed z-50 overflow-hidden rounded-lg border border-ds-border bg-ds-main shadow-xl"
    >
      <div className="px-3 py-2 text-[10px] uppercase tracking-wider text-ds-faint">
        {t('adeHarnessPicker.title')}
      </div>
      {pendingSwitch ? (
        <div className="px-3 py-2" data-harness-switch-confirm>
          <p className="text-[12px] leading-4 text-ds-ink">
            {t('adeHarnessPicker.switchConfirmTitle', {
              name: pendingSwitch.definition.displayName
            })}
          </p>
          <p className="mt-1 text-[11px] leading-4 text-ds-muted">
            {t('adeHarnessPicker.switchConfirmBody')}
          </p>
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setPendingSwitch(null)}
              className="rounded-lg px-2.5 py-1 text-[12px] font-medium text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              {t('cancel')}
            </button>
            <button
              type="button"
              onClick={confirmSwitch}
              className="rounded-lg bg-accent px-2.5 py-1 text-[12px] font-semibold text-white transition hover:brightness-95"
              data-harness-switch-confirm-yes
            >
              {t('adeHarnessPicker.switchConfirmYes')}
            </button>
          </div>
        </div>
      ) : (
        <>
          {rows.filter(harnessRowAvailable).map((row) => {
            const id = row.definition.id
            // P4-05: stable reason code → localized label + next step; the
            // raw message stays in the title tooltip as the "reason detail".
            const { code, labelKey, nextStepKey, configureProvider } = harnessConnectionPresentation(row)
            const detecting = code === 'detecting'
            const reasonText = labelKey ? t(labelKey) : null
            const nextStepText = nextStepKey ? t(nextStepKey) : null
            const detail = harnessRowUnavailableDetail(row)
            const reasonLine = [reasonText, nextStepText].filter(Boolean).join(' — ')
            const selected = id === harnessId
            const credential = row.definition.credentialModes[0]
            const credentialLabel = credential === 'native-login'
              ? t('adeCredential.nativeLogin')
              : credential === 'kun-gateway'
                ? t('adeCredential.kunGateway')
                : t('adeCredential.provider')
            return (
              <div
                key={id}
                className={`flex items-center gap-1 pr-2 ${selected ? 'bg-ds-subtle' : ''}`}
                title={[reasonLine || row.definition.displayName, detail].filter(Boolean).join(' · ')}
              >
                <button
                  type="button"
                  role="menuitem"
                  disabled={code != null}
                  onClick={() => pick(row)}
                  className="flex min-w-0 flex-1 items-start gap-2 px-3 py-2 text-left text-sm transition hover:bg-ds-hover disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:bg-transparent"
                  data-harness-id={id}
                >
                  <AgentIcon harnessId={id} size={16} className="mt-0.5 text-ds-muted" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-ds-ink">{row.definition.displayName}</span>
                    <span className="block truncate text-[11px] text-ds-faint">
                      {reasonLine || credentialLabel}
                    </span>
                  </span>
                  {detecting ? (
                    <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-ds-muted" strokeWidth={1.75} />
                  ) : null}
                </button>
                {(code && !detecting) || configureProvider ? (
                  <button
                    type="button"
                    role="menuitem"
                    onClick={() => openAgentSettings(row)}
                    aria-label={configureProvider ? t('adeAgentAction.configureProvider') : `${row.definition.displayName} ${t('adeHarnessOpenSettings')}`}
                    className="shrink-0 rounded-md p-1.5 text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ds-accent"
                    data-harness-repair={id}
                  >
                    <Settings2 className="h-4 w-4" strokeWidth={1.75} />
                  </button>
                ) : null}
              </div>
            )
          })}
          {onContinueLocalSession ? (
            <button
              type="button"
              onClick={() => {
                setOpen(false)
                onContinueLocalSession()
              }}
              className="flex w-full items-center gap-2 border-t border-ds-border px-3 py-2 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              data-continue-local-session
            >
              <History className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
              <span className="min-w-0 flex-1 truncate">
                {t('adeHarnessPicker.continueLocalSession')}
              </span>
            </button>
          ) : null}
          <button
            type="button"
            role="menuitem"
            onClick={() => openAgentSettings()}
            className="flex w-full items-center gap-2 border-t border-ds-border px-3 py-2 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            data-harness-manage
          >
            <Settings2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
            {t('adeHarnessOpenSettings')}
          </button>
          <div className="border-t border-ds-border px-3 py-2 text-[11px] text-ds-faint">
            {t('adeHarnessPicker.nextTurnHint')}
          </div>
        </>
      )}
    </div>
  ) : null

  return (
    <>
      <div className="ds-composer-harness-picker ds-no-drag relative">
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          aria-haspopup="menu"
          aria-controls={menuId}
          aria-expanded={open}
          onClick={() => {
            const next = !open
            setOpen(next)
            setPendingSwitch(null)
            if (next) onOpen?.()
          }}
          className="flex h-7 items-center gap-1 rounded-full border border-ds-border bg-ds-raised px-2 text-xs text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink disabled:cursor-not-allowed disabled:opacity-60"
          title={t('adeHarnessPicker.title')}
          aria-label={t('adeHarnessPicker.title')}
          data-composer-harness-picker
        >
          <AgentIcon harnessId={harnessId} size={14} />
          <span className="max-w-[120px] truncate">{harnessLabel}</span>
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin opacity-60" strokeWidth={1.75} />
          ) : (
            <ChevronDown className="h-3 w-3 opacity-60" strokeWidth={1.75} />
          )}
        </button>
      </div>
      {menu ? createPortal(menu, document.body) : null}
    </>
  )
}
