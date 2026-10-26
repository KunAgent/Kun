import { useTranslation } from 'react-i18next'
import type { HtmlFrameLayerMenu as LayerMenuState } from './use-html-frame-element-selection'

type Props = {
  menu: LayerMenuState
  screenWidth: number
  screenHeight: number
  onPreview: (id: number | null) => void
  onChoose: (id: number) => void
  onClose: () => void
}

const MENU_WIDTH = 200
const ROW_HEIGHT = 26

/** Right-click list of every layer under the pointer, innermost first. */
export function HtmlFrameLayerMenu({
  menu, screenWidth, screenHeight, onPreview, onChoose, onClose
}: Props): React.JSX.Element {
  const { t } = useTranslation('common')
  const height = menu.items.length * ROW_HEIGHT + 30
  const left = Math.max(4, Math.min(menu.x, screenWidth - MENU_WIDTH - 4))
  const top = Math.max(4, Math.min(menu.y, screenHeight - height - 4))
  return (
    <>
      <div
        className="pointer-events-auto absolute inset-0 z-30"
        onPointerDown={(event) => { event.stopPropagation(); onClose() }}
        onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); onClose() }}
      />
      <div
        role="menu"
        aria-label={t('canvasElementLayers')}
        className="pointer-events-auto absolute z-30 rounded-[8px] border border-ds-border bg-white p-1 shadow-[0_10px_28px_rgba(15,23,42,0.18)] dark:bg-[#171b22]"
        style={{ left, top, width: MENU_WIDTH }}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerLeave={() => onPreview(null)}
        data-canvas-element-layer-menu="true"
      >
        <div className="px-2 py-1 text-[10.5px] font-medium text-ds-faint">{t('canvasElementLayers')}</div>
        {menu.items.map((item) => (
          <button
            key={item.id}
            type="button"
            role="menuitem"
            className="flex w-full items-center truncate rounded-[5px] py-1 pr-2 text-left text-[11.5px] text-ds-ink transition hover:bg-accent-soft hover:text-accent"
            style={{ height: ROW_HEIGHT, paddingLeft: 8 }}
            onPointerEnter={() => onPreview(item.id)}
            onFocus={() => onPreview(item.id)}
            onClick={() => onChoose(item.id)}
          >
            <span className="min-w-0 truncate">{item.label}</span>
          </button>
        ))}
      </div>
    </>
  )
}
