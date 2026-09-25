import { useEffect, useState, type ReactElement } from 'react'
import { ImageOff, Loader2 } from 'lucide-react'
import type { TFunction } from 'i18next'
import type { PaperFigureItemV1 } from '@shared/paper/paper-types'
import { writeJoinPath } from '../../../write/write-workspace-store'

/**
 * Reader drawer "figures" tab: the preprocessed `figures/index.json` list
 * (arXiv HTML / TeX / caption crop) with thumbnails; clicking jumps to the
 * figure's page. Thumbnails load lazily per item through readWorkspaceImage.
 */
export function PaperFiguresPane({
  workspaceRoot,
  unitDir,
  onJumpToPage,
  t
}: {
  workspaceRoot: string
  unitDir: string
  onJumpToPage: (page: number) => void
  t: TFunction
}): ReactElement {
  const [items, setItems] = useState<PaperFigureItemV1[] | null>(null)

  useEffect(() => {
    let canceled = false
    setItems(null)
    if (!workspaceRoot || !unitDir || typeof window.kunGui?.paperReadUnit !== 'function') {
      setItems([])
      return
    }
    void window.kunGui.paperReadUnit({ workspaceRoot, unitDir })
      .then((result) => {
        if (!canceled) setItems(result.ok ? result.figures?.items ?? [] : [])
      })
      .catch(() => { if (!canceled) setItems([]) })
    return () => { canceled = true }
  }, [workspaceRoot, unitDir])

  if (items === null) {
    return (
      <div className="flex items-center gap-2 p-2 text-[12px] text-ds-faint">
        <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
        {t('loading')}
      </div>
    )
  }
  if (items.length === 0) {
    return <p className="p-2 text-[12px] leading-5 text-ds-faint">{t('writePaperReaderNoFigures')}</p>
  }
  const unitAbs = writeJoinPath(workspaceRoot, unitDir)
  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.id}>
          <button
            type="button"
            disabled={!item.page}
            onClick={() => { if (item.page) onJumpToPage(item.page) }}
            className="w-full rounded-lg border border-ds-border-muted p-1.5 text-left transition hover:border-accent/40 hover:bg-ds-hover disabled:cursor-default"
          >
            <FigureThumb workspaceRoot={workspaceRoot} path={writeJoinPath(unitAbs, item.path)} />
            <div className="mt-1 flex items-baseline gap-1.5">
              <span className="shrink-0 text-[11.5px] font-medium text-ds-ink">{item.label}</span>
              {item.page ? (
                <span className="shrink-0 text-[10.5px] text-ds-faint">p.{item.page}</span>
              ) : null}
            </div>
            <p className="mt-0.5 line-clamp-3 text-[11px] leading-4 text-ds-muted">{item.caption}</p>
          </button>
        </li>
      ))}
    </ul>
  )
}

function FigureThumb({ workspaceRoot, path }: { workspaceRoot: string; path: string }): ReactElement {
  const [src, setSrc] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let canceled = false
    setSrc(null)
    setFailed(false)
    if (typeof window.kunGui?.readWorkspaceImage !== 'function') {
      setFailed(true)
      return
    }
    void window.kunGui.readWorkspaceImage({ workspaceRoot, path })
      .then((result) => {
        if (canceled) return
        if (result.ok) setSrc(result.dataUrl)
        else setFailed(true)
      })
      .catch(() => { if (!canceled) setFailed(true) })
    return () => { canceled = true }
  }, [workspaceRoot, path])
  if (failed) {
    return (
      <div className="flex h-16 items-center justify-center rounded bg-ds-subtle/60 text-ds-faint">
        <ImageOff className="h-4 w-4" strokeWidth={1.6} />
      </div>
    )
  }
  return src ? (
    <img src={src} alt="" className="max-h-40 w-full rounded bg-white object-contain" loading="lazy" />
  ) : (
    <div className="h-16 animate-pulse rounded bg-ds-subtle/60" />
  )
}
