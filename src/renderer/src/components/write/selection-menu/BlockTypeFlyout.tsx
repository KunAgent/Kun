import { useCallback, useRef, useState, type ReactElement } from 'react'
import { Check, ChevronRight, Code, Heading1, Heading2, Heading3, List, ListOrdered, Pilcrow, Quote } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { WRITE_BLOCK_TYPES, type WriteBlockType } from '../../../write/block-type'
import { MenuButton } from './MenuButton'
import { MenuFlyout } from './MenuFlyout'
const meta = {
  paragraph: { icon: Pilcrow, label: 'writeBlockTypeParagraph', marker: '' },
  heading1: { icon: Heading1, label: 'writeBlockTypeHeading1', marker: '#' },
  heading2: { icon: Heading2, label: 'writeBlockTypeHeading2', marker: '##' },
  heading3: { icon: Heading3, label: 'writeBlockTypeHeading3', marker: '###' },
  quote: { icon: Quote, label: 'writeBlockTypeQuote', marker: '>' },
  bullet: { icon: List, label: 'writeBlockTypeBullet', marker: '-' },
  ordered: { icon: ListOrdered, label: 'writeBlockTypeOrdered', marker: '1.' },
  code: { icon: Code, label: 'writeBlockTypeCode', marker: '```' }
}
export function BlockTypeFlyout({ blockType = 'paragraph', onSet, focusMode }: {
  blockType?: WriteBlockType; onSet: (type: WriteBlockType) => void; focusMode?: boolean
}): ReactElement {
  const { t } = useTranslation('common'), anchor = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false), close = useCallback(() => setOpen(false), [])
  const Icon = meta[blockType].icon
  return <div ref={anchor}>
    <MenuButton role="menuitem" className="write-selection-menu-row" label={t('writeBlockTypeLabel')}
      aria-haspopup="menu" aria-expanded={open} onKeyDown={(event) => { if (event.key === 'ArrowRight') { event.preventDefault(); setOpen(true) } }}
      onActivate={() => setOpen(!open)}><Icon /><span>{t(meta[blockType].label)}</span><ChevronRight className="write-selection-menu-chevron" /></MenuButton>
    {open && <MenuFlyout anchor={anchor} onClose={close} focusMode={focusMode}>
      {WRITE_BLOCK_TYPES.map((type) => { const ItemIcon = meta[type].icon; return <div key={type}>
        {(type === 'heading1' || type === 'quote') && <div className="write-selection-menu-separator" />}
        <MenuButton role="menuitemradio" aria-checked={type === blockType} className="write-selection-menu-row"
          label={t(meta[type].label)} onActivate={() => { close(); onSet(type) }}>
          <ItemIcon /><span>{t(meta[type].label)}</span><code>{meta[type].marker}</code>{type === blockType && <Check className="is-check" />}
        </MenuButton></div> })}
    </MenuFlyout>}
  </div>
}
