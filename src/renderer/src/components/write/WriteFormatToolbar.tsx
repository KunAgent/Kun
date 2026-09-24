import { useEffect, useLayoutEffect, useRef, useState, type MutableRefObject, type ReactElement } from 'react'
import {
  Bold,
  Code,
  Heading1,
  Heading2,
  Heading3,
  ImageIcon,
  Italic,
  List,
  ListOrdered,
  ListTodo,
  MoreHorizontal,
  Quote,
  Strikethrough,
  Underline,
  type LucideIcon
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { WriteRichEditorHandle } from '../../write/tiptap/WriteRichEditor'
import {
  richToolbarState,
  runRichToolbarToggle,
  type WriteToolbarState,
  type WriteToolbarToggle
} from '../../write/tiptap/rich-format-commands'

type FormatAction = {
  id: WriteToolbarToggle | 'image'
  icon: LucideIcon
  labelKey: string
  /** Separators are drawn between different groups. */
  group: number
}

const FORMAT_ACTIONS: FormatAction[] = [
  { id: 'heading1', icon: Heading1, labelKey: 'writeBlockTypeHeading1', group: 0 },
  { id: 'heading2', icon: Heading2, labelKey: 'writeBlockTypeHeading2', group: 0 },
  { id: 'heading3', icon: Heading3, labelKey: 'writeBlockTypeHeading3', group: 0 },
  { id: 'quote', icon: Quote, labelKey: 'writeBlockTypeQuote', group: 0 },
  { id: 'bold', icon: Bold, labelKey: 'writeFormatBold', group: 1 },
  { id: 'italic', icon: Italic, labelKey: 'writeFormatItalic', group: 1 },
  { id: 'underline', icon: Underline, labelKey: 'writeFormatUnderline', group: 1 },
  { id: 'strike', icon: Strikethrough, labelKey: 'writeFormatStrikethrough', group: 1 },
  { id: 'code', icon: Code, labelKey: 'writeFormatCode', group: 1 },
  { id: 'bullet', icon: List, labelKey: 'writeBlockTypeBullet', group: 2 },
  { id: 'ordered', icon: ListOrdered, labelKey: 'writeBlockTypeOrdered', group: 2 },
  { id: 'task', icon: ListTodo, labelKey: 'writeBlockTypeTaskList', group: 2 },
  { id: 'image', icon: ImageIcon, labelKey: 'writeBlockTypeImage', group: 2 }
]

const BUTTON_WIDTH = 32
const SEPARATOR_WIDTH = 13

/** How many leading actions fit in `available` px, reserving room for the
 * overflow button whenever anything is left out. */
export function visibleFormatActionCount(available: number, actions: FormatAction[] = FORMAT_ACTIONS): number {
  let used = 0
  for (let index = 0; index < actions.length; index += 1) {
    const separator = index > 0 && actions[index].group !== actions[index - 1].group ? SEPARATOR_WIDTH : 0
    const reserve = index < actions.length - 1 ? BUTTON_WIDTH : 0
    if (used + separator + BUTTON_WIDTH + reserve > available) return index
    used += separator + BUTTON_WIDTH
  }
  return actions.length
}

function stateSignature(state: WriteToolbarState | null): string {
  return state ? Object.values(state).map((value) => (value ? '1' : '0')).join('') : ''
}

type Props = {
  richHandleRef: MutableRefObject<WriteRichEditorHandle | null>
  disabled: boolean
}

/**
 * Fixed WYSIWYG format bar (Agentero-style): block styles, inline marks and
 * lists in three groups, collapsing into a "more" menu when narrow.
 */
export function WriteFormatToolbar({ richHandleRef, disabled }: Props): ReactElement {
  const { t } = useTranslation('common')
  const containerRef = useRef<HTMLDivElement | null>(null)
  const moreRef = useRef<HTMLDivElement | null>(null)
  const [visibleCount, setVisibleCount] = useState(FORMAT_ACTIONS.length)
  const [moreOpen, setMoreOpen] = useState(false)
  // The handle is re-read on every parent render; switching files re-renders
  // the workspace through the selection change the new editor emits.
  const editor = richHandleRef.current?.getEditor() ?? null
  const [state, setState] = useState<WriteToolbarState | null>(() => richToolbarState(editor))

  useEffect(() => {
    setState(richToolbarState(editor))
    if (!editor) return
    const sync = (): void => {
      const next = richToolbarState(editor)
      setState((current) => (stateSignature(current) === stateSignature(next) ? current : next))
    }
    editor.on('transaction', sync)
    return () => {
      editor.off('transaction', sync)
    }
  }, [editor])

  useLayoutEffect(() => {
    const container = containerRef.current
    if (!container) return
    const update = (): void => setVisibleCount(visibleFormatActionCount(container.clientWidth))
    const observer = new ResizeObserver(update)
    observer.observe(container)
    update()
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!moreOpen) return
    const close = (event: MouseEvent): void => {
      if (!moreRef.current?.contains(event.target as Node)) setMoreOpen(false)
    }
    const escape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', escape)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', escape)
    }
  }, [moreOpen])

  const inactive = disabled || !editor
  const run = (action: FormatAction): void => {
    if (inactive) return
    if (action.id === 'image') richHandleRef.current?.insertImage()
    else runRichToolbarToggle(editor, false, action.id)
  }
  const visible = FORMAT_ACTIONS.slice(0, visibleCount)
  const hidden = FORMAT_ACTIONS.slice(visibleCount)

  return (
    <div ref={containerRef} className="write-format-toolbar" role="toolbar" aria-label={t('writeBlockTypeLabel')}>
      {visible.map((action, index) => {
        const Icon = action.icon
        const pressed = action.id !== 'image' && Boolean(state?.[action.id])
        const label = t(action.labelKey)
        return (
          <div key={action.id} className="flex shrink-0 items-center">
            {index > 0 && action.group !== visible[index - 1].group ? (
              <span className="write-format-toolbar-separator" aria-hidden="true" />
            ) : null}
            <button
              type="button"
              className="write-format-toolbar-button"
              data-pressed={pressed || undefined}
              aria-pressed={action.id === 'image' ? undefined : pressed}
              aria-label={label}
              title={label}
              disabled={inactive}
              // Keep the editor selection: focus stays in ProseMirror.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => run(action)}
            >
              <Icon className="h-4 w-4" strokeWidth={1.9} />
            </button>
          </div>
        )
      })}
      {hidden.length > 0 ? (
        <div ref={moreRef} className="relative flex shrink-0 items-center">
          <button
            type="button"
            className="write-format-toolbar-button"
            data-pressed={moreOpen || undefined}
            aria-haspopup="menu"
            aria-expanded={moreOpen}
            aria-label={t('writeToolbarMore')}
            title={t('writeToolbarMore')}
            disabled={inactive}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => setMoreOpen((open) => !open)}
          >
            <MoreHorizontal className="h-4 w-4" strokeWidth={1.9} />
          </button>
          {moreOpen ? (
            <div role="menu" className="write-format-toolbar-menu">
              {hidden.map((action, index) => {
                const Icon = action.icon
                return (
                  <div key={action.id}>
                    {index > 0 && action.group !== hidden[index - 1].group ? (
                      <div className="my-1 h-px bg-ds-border-muted" />
                    ) : null}
                    <button
                      type="button"
                      role="menuitem"
                      className="write-format-toolbar-menu-item"
                      data-pressed={(action.id !== 'image' && state?.[action.id]) || undefined}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => {
                        run(action)
                        setMoreOpen(false)
                      }}
                    >
                      <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} />
                      <span className="truncate">{t(action.labelKey)}</span>
                    </button>
                  </div>
                )
              })}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
