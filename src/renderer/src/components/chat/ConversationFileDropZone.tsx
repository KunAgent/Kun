import {
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type ReactElement,
  type ReactNode
} from 'react'
import { FileUp } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  canAcceptComposerFileDrop,
  routeComposerFileDrop,
  type ComposerFileDropOptions
} from './composer-file-drop'

type Props = {
  children: ReactNode
  className?: string
  options: ComposerFileDropOptions
}

export function ConversationFileDropZone({
  children,
  className = '',
  options
}: Props): ReactElement {
  const { t } = useTranslation('common')
  const dragDepthRef = useRef(0)
  const [active, setActive] = useState(false)

  const resetDragState = (): void => {
    dragDepthRef.current = 0
    setActive(false)
  }

  const handleDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!canAcceptComposerFileDrop(event.dataTransfer, options)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    dragDepthRef.current += 1
    setActive(true)
  }

  const handleDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    if (!canAcceptComposerFileDrop(event.dataTransfer, options)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
    if (dragDepthRef.current === 0) dragDepthRef.current = 1
    setActive(true)
  }

  const handleDragLeave = (): void => {
    if (dragDepthRef.current === 0) return
    dragDepthRef.current -= 1
    if (dragDepthRef.current === 0) setActive(false)
  }

  const handleDrop = (event: ReactDragEvent<HTMLDivElement>): void => {
    const acceptable = canAcceptComposerFileDrop(event.dataTransfer, options)
    resetDragState()
    if (!acceptable) return
    event.preventDefault()
    event.stopPropagation()
    routeComposerFileDrop(event.dataTransfer, options)
  }

  return (
    <div
      className={`ds-no-drag relative ${className}`}
      data-conversation-file-drop-active={active ? 'true' : 'false'}
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {children}
      {active ? (
        <div
          role="status"
          aria-live="polite"
          data-conversation-file-drop-overlay
          className="pointer-events-none absolute inset-3 z-40 flex items-center justify-center rounded-[28px] border-2 border-dashed border-accent-tint/55 bg-ds-card/88 text-ds-ink shadow-[0_18px_60px_rgba(20,47,95,0.14)] backdrop-blur-md dark:bg-ds-card/92"
        >
          <div className="flex items-center gap-3 rounded-2xl bg-ds-card/95 px-5 py-3 text-[14px] font-semibold shadow-sm">
            <FileUp className="h-5 w-5 text-accent" strokeWidth={1.9} />
            <span>{t('composerDropFilesHere')}</span>
          </div>
        </div>
      ) : null}
    </div>
  )
}
