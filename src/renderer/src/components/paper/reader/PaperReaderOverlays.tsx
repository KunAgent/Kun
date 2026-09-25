import type { ReactElement, RefObject } from 'react'
import type { TFunction } from 'i18next'
import { PaperSelectionMenu } from './PaperSelectionMenu'
import { PaperAskPopover } from './PaperAskPopover'
import { PaperTranslateCard } from './PaperTranslateCard'
import { PaperTranslateSettingsDialog } from './PaperTranslateSettingsDialog'
import type { PaperTranslateCardState, PaperTranslateNotice } from './use-paper-translate-card'
import type { usePaperSelection } from './use-paper-selection'

type Selection = ReturnType<typeof usePaperSelection>

/**
 * Floating overlay stack inside the reader surface (R1/R2): selection menu,
 * ask popover, translate card + its collapsed mini chip, the bottom notice
 * pill (with a configure shortcut on `config` failures), and the translate
 * settings dialog. Everything floats over the page stack — opaque
 * `bg-ds-card` backgrounds, `ds-no-drag` where interactive.
 */
export function PaperReaderOverlays({
  selection,
  translateSelection,
  translateCard,
  setTranslateCard,
  setTranslateCardHovered,
  reopenTranslateCard,
  translateNotice,
  regionNotice,
  translateSettingsOpen,
  openTranslateSettings,
  closeTranslateSettings,
  onTranslateSettingsSaved,
  rootRef,
  t
}: {
  selection: Selection
  translateSelection: () => void
  translateCard: PaperTranslateCardState | null
  setTranslateCard: (card: PaperTranslateCardState | null) => void
  setTranslateCardHovered: (hovered: boolean) => void
  reopenTranslateCard: () => void
  translateNotice: PaperTranslateNotice | null
  regionNotice: string
  translateSettingsOpen: boolean
  openTranslateSettings: () => void
  closeTranslateSettings: () => void
  onTranslateSettingsSaved: () => void
  rootRef: RefObject<HTMLElement | null>
  t: TFunction
}): ReactElement {
  return <>
    {translateNotice || regionNotice ? (
      <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-ds-border bg-ds-card/95 px-3 py-1 text-[11px] text-ds-muted shadow">
        <span>{regionNotice || translateNotice?.message}</span>
        {!regionNotice && translateNotice?.config ? (
          <button
            type="button"
            className="pointer-events-auto font-medium text-accent hover:underline"
            onClick={openTranslateSettings}
          >
            {t('writePaperTranslateConfigure')}
          </button>
        ) : null}
      </div>
    ) : null}

    {selection.pending && !selection.askOpen ? (
      <PaperSelectionMenu
        anchor={selection.pending.anchor}
        containerRef={rootRef}
        selectionLength={selection.pending.text.length}
        onHighlight={selection.addHighlight}
        onAnnotate={(comment) => selection.addHighlight('yellow', comment)}
        onAsk={() => selection.setAskOpen(true)}
        onAddToChat={selection.addToConversation}
        onTranslate={translateSelection}
        onClose={selection.dismissPending}
        t={t}
      />
    ) : null}
    {selection.pending && selection.askOpen ? (
      <PaperAskPopover
        anchor={selection.pending.anchor}
        containerRef={rootRef}
        onSubmit={selection.submitQuickAsk}
        onClose={() => selection.setAskOpen(false)}
        t={t}
      />
    ) : null}
    {translateCard && !translateCard.collapsed ? (
      <PaperTranslateCard
        anchor={translateCard.anchor}
        containerRef={rootRef}
        quote={translateCard.quote}
        translation={translateCard.translation}
        model={translateCard.model}
        loading={translateCard.loading}
        error={translateCard.error}
        onConfigure={
          translateCard.errorCode === 'config' ? openTranslateSettings : undefined
        }
        onClose={() => setTranslateCard(null)}
        onHoverChange={setTranslateCardHovered}
        t={t}
      />
    ) : null}
    {translateCard?.collapsed ? (
      <button
        type="button"
        className="ds-no-drag absolute z-30 flex h-6 w-6 items-center justify-center rounded-full border border-ds-border bg-ds-card text-[10px] font-medium text-accent shadow-lg"
        style={{
          left: Math.max(8, translateCard.anchor.x - (rootRef.current?.getBoundingClientRect().left ?? 0) + 12),
          top: Math.max(8, translateCard.anchor.y - (rootRef.current?.getBoundingClientRect().top ?? 0) - 12)
        }}
        title={t('writePaperReaderTranslate')}
        aria-label={t('writePaperReaderTranslate')}
        onClick={reopenTranslateCard}
      >
        译
      </button>
    ) : null}
    {translateSettingsOpen ? (
      <PaperTranslateSettingsDialog
        onClose={closeTranslateSettings}
        onSaved={onTranslateSettingsSaved}
      />
    ) : null}
  </>
}
