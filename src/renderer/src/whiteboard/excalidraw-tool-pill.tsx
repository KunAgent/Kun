import { useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowRight,
  Circle,
  Crosshair,
  Diamond,
  Eraser,
  Frame,
  Globe,
  Hand,
  Image as ImageIcon,
  Library,
  Lock,
  Minus,
  MoreHorizontal,
  MousePointer2,
  Pencil,
  Square,
  Type
} from 'lucide-react'
import type { ExcalidrawImperativeAPI } from '@excalidraw/excalidraw/types'
import {
  CANVAS_CHROME_DIVIDER,
  CANVAS_CHROME_MENU,
  CANVAS_CHROME_PILL,
  CanvasChromeMenuItem,
  canvasChromeButtonClass,
  useCanvasChromeDismiss
} from '../components/design/canvas/chrome/canvas-chrome-primitives'

/** Excalidraw tool types the Kun tool pill drives through the imperative API. */
export type ExcalidrawPillTool =
  | 'selection' | 'hand' | 'rectangle' | 'diamond' | 'ellipse' | 'arrow' | 'line'
  | 'freedraw' | 'text' | 'image' | 'eraser' | 'laser' | 'frame' | 'embeddable'

type ToolSpec = {
  type: ExcalidrawPillTool
  labelKey: string
  shortcut: string
  icon: ReactNode
  /** Tools that move into the overflow menu when the board is narrow. */
  collapsible?: boolean
}

const ICON = 'h-[17px] w-[17px]'

const PRIMARY_TOOLS: ToolSpec[] = [
  { type: 'selection', labelKey: 'whiteboardToolSelect', shortcut: 'V', icon: <MousePointer2 className={ICON} strokeWidth={1.8} /> },
  { type: 'hand', labelKey: 'whiteboardToolHand', shortcut: 'H', icon: <Hand className={ICON} strokeWidth={1.8} /> }
]

const SHAPE_TOOLS: ToolSpec[] = [
  { type: 'rectangle', labelKey: 'whiteboardToolRectangle', shortcut: 'R', icon: <Square className={ICON} strokeWidth={1.8} /> },
  { type: 'diamond', labelKey: 'whiteboardToolDiamond', shortcut: 'D', icon: <Diamond className={ICON} strokeWidth={1.8} /> },
  { type: 'ellipse', labelKey: 'whiteboardToolEllipse', shortcut: 'O', icon: <Circle className={ICON} strokeWidth={1.8} /> },
  { type: 'arrow', labelKey: 'whiteboardToolArrow', shortcut: 'A', icon: <ArrowRight className={ICON} strokeWidth={1.8} /> },
  { type: 'line', labelKey: 'whiteboardToolLine', shortcut: 'L', icon: <Minus className={ICON} strokeWidth={1.8} />, collapsible: true },
  { type: 'freedraw', labelKey: 'whiteboardToolDraw', shortcut: 'P', icon: <Pencil className={ICON} strokeWidth={1.8} /> },
  { type: 'text', labelKey: 'whiteboardToolText', shortcut: 'T', icon: <Type className={ICON} strokeWidth={1.8} /> },
  { type: 'image', labelKey: 'whiteboardToolImage', shortcut: '9', icon: <ImageIcon className={ICON} strokeWidth={1.8} />, collapsible: true },
  { type: 'eraser', labelKey: 'whiteboardToolEraser', shortcut: 'E', icon: <Eraser className={ICON} strokeWidth={1.8} />, collapsible: true }
]

const EXTRA_TOOLS: ToolSpec[] = [
  { type: 'laser', labelKey: 'whiteboardToolLaser', shortcut: 'K', icon: <Crosshair className="h-4 w-4" strokeWidth={1.8} /> },
  { type: 'frame', labelKey: 'whiteboardToolFrame', shortcut: 'F', icon: <Frame className="h-4 w-4" strokeWidth={1.8} /> },
  { type: 'embeddable', labelKey: 'whiteboardToolEmbed', shortcut: '', icon: <Globe className="h-4 w-4" strokeWidth={1.8} /> }
]

/** Below this board width the line, image and eraser tools move into the overflow menu. */
export const EXCALIDRAW_PILL_COMPACT_WIDTH = 520

export function excalidrawPillLayout(width: number): { inline: ToolSpec[]; overflow: ToolSpec[] } {
  const compact = width > 0 && width < EXCALIDRAW_PILL_COMPACT_WIDTH
  const inline = compact ? SHAPE_TOOLS.filter((tool) => !tool.collapsible) : SHAPE_TOOLS
  const overflow = compact ? [...SHAPE_TOOLS.filter((tool) => tool.collapsible), ...EXTRA_TOOLS] : EXTRA_TOOLS
  return { inline, overflow }
}

/**
 * The Kun tool pill for an Excalidraw board. It replaces Excalidraw's own shape
 * toolbar (hidden by the host CSS) so both whiteboard engines share one
 * toolbar, and it never crowds the board header in a narrow side panel.
 */
export function ExcalidrawToolPill({
  api,
  activeTool,
  locked,
  width
}: {
  api: ExcalidrawImperativeAPI | null
  activeTool: string
  locked: boolean
  width: number
}): ReactElement {
  const { t } = useTranslation('common')
  const rootRef = useRef<HTMLDivElement | null>(null)
  const [moreOpen, setMoreOpen] = useState(false)
  const closeMore = useCallback(() => setMoreOpen(false), [])
  useCanvasChromeDismiss(moreOpen, rootRef, closeMore)
  const { inline, overflow } = excalidrawPillLayout(width)

  useEffect(() => {
    if (!api) setMoreOpen(false)
  }, [api])

  const pick = (type: ExcalidrawPillTool): void => {
    if (!api) return
    setMoreOpen(false)
    if (type === 'image') api.setActiveTool({ type, insertOnCanvasDirectly: false })
    else api.setActiveTool({ type, locked })
  }
  const toggleLock = (): void => {
    if (!api) return
    const current = api.getAppState().activeTool
    if (current.type === 'custom') return
    api.setActiveTool(current.type === 'image'
      ? { type: 'image', locked: !locked }
      : { type: current.type, locked: !locked })
  }
  const toggleLibrary = (): void => {
    if (!api) return
    setMoreOpen(false)
    api.toggleSidebar({ name: 'default', tab: 'library' })
  }

  const toolButton = (tool: ToolSpec): ReactElement => {
    const label = t(tool.labelKey)
    const title = tool.shortcut ? `${label} — ${tool.shortcut}` : label
    return (
      <button
        key={tool.type}
        type="button"
        disabled={!api}
        aria-label={label}
        aria-pressed={activeTool === tool.type}
        title={title}
        data-excalidraw-pill-tool={tool.type}
        className={canvasChromeButtonClass(activeTool === tool.type)}
        onClick={() => pick(tool.type)}
      >
        {tool.icon}
      </button>
    )
  }

  const overflowActive = overflow.some((tool) => tool.type === activeTool)
  return (
    <div ref={rootRef} className="relative" data-excalidraw-tool-pill="true">
      <div className={CANVAS_CHROME_PILL} role="toolbar" aria-label={t('whiteboardToolbar')}>
        {PRIMARY_TOOLS.map(toolButton)}
        <span className={CANVAS_CHROME_DIVIDER} aria-hidden="true" />
        {inline.map(toolButton)}
        <span className={CANVAS_CHROME_DIVIDER} aria-hidden="true" />
        <button
          type="button"
          disabled={!api}
          aria-label={t('whiteboardToolMore')}
          aria-haspopup="menu"
          aria-expanded={moreOpen}
          title={t('whiteboardToolMore')}
          className={canvasChromeButtonClass(moreOpen || overflowActive || locked)}
          onClick={() => setMoreOpen((open) => !open)}
        >
          <MoreHorizontal className={ICON} strokeWidth={1.8} />
        </button>
      </div>
      {moreOpen ? (
        <div role="menu" className={`${CANVAS_CHROME_MENU} right-0 top-[calc(100%+6px)] w-52`}>
          {overflow.map((tool) => (
            <CanvasChromeMenuItem
              key={tool.type}
              role="menuitemradio"
              checked={activeTool === tool.type}
              icon={tool.icon}
              label={t(tool.labelKey)}
              shortcut={tool.shortcut || undefined}
              onSelect={() => pick(tool.type)}
            />
          ))}
          <div className="my-1 h-px bg-ds-border-muted" />
          <CanvasChromeMenuItem
            icon={<Library className="h-4 w-4" strokeWidth={1.8} />}
            label={t('whiteboardToolLibrary')}
            onSelect={toggleLibrary}
          />
          <CanvasChromeMenuItem
            role="menuitemcheckbox"
            checked={locked}
            icon={<Lock className="h-4 w-4" strokeWidth={1.8} />}
            label={t('whiteboardToolLock')}
            onSelect={toggleLock}
          />
        </div>
      ) : null}
    </div>
  )
}
