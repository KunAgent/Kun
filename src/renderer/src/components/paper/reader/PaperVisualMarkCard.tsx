import { useEffect, useRef, useState, type ReactElement } from 'react'
import { Image as ImageIcon, Link2, MessageSquareShare, Pencil, Trash2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperVisualMark } from '@shared/paper/paper-marks-types'
import {
  removePaperMarkCard,
  setPaperMarkCardComment,
  usePaperMarksStore
} from '../../../paper/paper-marks-store'
import { usePaperModeStore } from '../../../paper/paper-mode-store'
import { paperCitationMarkdown } from '../../../paper/paper-citation-copy'
import { PaperGutterNoteEditor } from './PaperGutterNoteEditor'

/**
 * Gutter card for an R2.4 visual (region) mark: captured PNG thumbnail, an
 * editable note, and ops — 「加入对话」 sends the image through the existing
 * composer attachment channel plus a page link line; when the model can't
 * take images the text still lands in the composer.
 */
export function PaperVisualMarkCard({
  mark,
  workspaceRoot,
  unitDir,
  paperTitle,
  pdfFile,
  onJumpToPage,
  t
}: {
  mark: PaperVisualMark
  workspaceRoot: string
  unitDir: string
  paperTitle: string
  pdfFile?: string
  onJumpToPage: (page: number) => void
  t: TFunction
}): ReactElement {
  const editing = usePaperMarksStore((s) => s.editingMarkId === mark.id)
  const cachedImage = usePaperMarksStore((s) => s.visualMarkImages[mark.id])
  const [imageSrc, setImageSrc] = useState<string | null>(cachedImage ?? null)
  const [busy, setBusy] = useState(false)
  const cardImageRef = useRef<string | null>(null)
  cardImageRef.current = imageSrc

  useEffect(() => {
    if (imageSrc) return
    const api = window.kunGui?.readWorkspaceImage
    if (typeof api !== 'function' || !workspaceRoot) return
    let canceled = false
    void api({ workspaceRoot, path: `${unitDir}/marks/${mark.image.path}` })
      .then((result) => {
        if (canceled || !result.ok) return
        setImageSrc(result.dataUrl)
        usePaperMarksStore.setState((state) => ({
          visualMarkImages: { ...state.visualMarkImages, [mark.id]: result.dataUrl }
        }))
      })
      .catch(() => undefined)
    return () => {
      canceled = true
    }
  }, [imageSrc, workspaceRoot, unitDir, mark.id, mark.image.path])

  const sendToAssistant = async (): Promise<void> => {
    const bridge = usePaperModeStore.getState().composerBridge
    if (!bridge) return
    setBusy(true)
    try {
      const prompt = t('writePaperReaderRegionAskPrompt', {
        title: paperTitle,
        page: mark.page,
        comment: mark.comment ?? ''
      })
      const dataUrl = cardImageRef.current
      let attached = false
      if (dataUrl && bridge.attachImage) {
        attached = await bridge
          .attachImage({ dataBase64: dataUrl.split(',')[1] ?? '', name: `paper-region-p${mark.page}.png` })
          .catch(() => false)
      }
      if (bridge.submit) {
        bridge.submit(attached ? prompt : `${prompt}\n${t('writePaperReaderRegionNoImage')}`)
      } else {
        bridge.setInput(attached ? prompt : `${prompt}\n${t('writePaperReaderRegionNoImage')}`)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <div className="mb-1 flex items-start justify-between gap-2">
        <button
          type="button"
          className="min-w-0 flex-1 text-left"
          onClick={() => onJumpToPage(mark.page)}
        >
          <span className="mr-1 inline-block h-2 w-2 rounded-[2px] border border-dashed border-[#3b82f6]" />
          <span className="text-[10.5px] text-ds-faint">
            {t('writePdfPageLabel', { page: mark.page })} · {t('writePaperReaderRegionMark')}
          </span>
        </button>
        <span className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className="write-pdf-icon-button"
            aria-label={t('writePaperReaderComment')}
            title={t('writePaperReaderComment')}
            onClick={() => usePaperMarksStore.setState({ editingMarkId: editing ? null : mark.id })}
          >
            <Pencil className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="write-pdf-icon-button"
            aria-label={t('writePaperReaderCopyCitation')}
            title={t('writePaperReaderCopyCitation')}
            onClick={() => {
              void navigator.clipboard
                .writeText(
                  paperCitationMarkdown({
                    quote: mark.comment ?? '',
                    title: paperTitle,
                    page: mark.page,
                    unitDir,
                    pdfFile,
                    comment: mark.comment
                  })
                )
                .catch(() => undefined)
            }}
          >
            <Link2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
          <button
            type="button"
            className="write-pdf-icon-button"
            aria-label={t('writePaperReaderDelete')}
            title={t('writePaperReaderDelete')}
            onClick={() => removePaperMarkCard(mark.id)}
          >
            <Trash2 className="h-3.5 w-3.5" strokeWidth={1.9} />
          </button>
        </span>
      </div>
      {imageSrc ? (
        <img
          src={imageSrc}
          alt={mark.comment ?? t('writePaperReaderRegionMark')}
          className="mb-1.5 max-h-[120px] w-auto max-w-full rounded border border-ds-border object-contain"
        />
      ) : (
        <div className="mb-1.5 flex h-16 items-center justify-center rounded border border-dashed border-ds-border text-ds-faint">
          <ImageIcon className="h-4 w-4" strokeWidth={1.6} />
        </div>
      )}
      {editing ? (
        <PaperGutterNoteEditor
          initial={mark.comment ?? ''}
          placeholder={t('writePaperReaderCommentPlaceholder')}
          onCommit={(value) => setPaperMarkCardComment(mark.id, value)}
          onDone={() => usePaperMarksStore.setState({ editingMarkId: null })}
          t={t}
        />
      ) : mark.comment ? (
        <p className="text-[12px] leading-4 text-ds-ink">{mark.comment}</p>
      ) : null}
      <button
        type="button"
        disabled={busy}
        className="mt-1.5 inline-flex items-center gap-1 rounded-md border border-ds-border px-1.5 py-0.5 text-[11px] text-ds-muted transition hover:border-accent hover:text-accent disabled:opacity-50"
        onClick={() => void sendToAssistant()}
      >
        <MessageSquareShare className="h-3 w-3" strokeWidth={1.9} />
        {t('writePaperReaderRegionAsk')}
      </button>
    </div>
  )
}
