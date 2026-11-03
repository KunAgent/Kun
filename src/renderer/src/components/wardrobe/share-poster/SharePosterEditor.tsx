import { useEffect, useRef, useState } from 'react'
import { POSTER_SIZES, POSTER_STYLES, posterFileName, posterQrContent, type PosterSize, type PosterStyle } from './share-poster-model'
import { renderSharePoster, type PosterInput, type PosterResources } from './share-poster-render'
import './share-poster.css'

export type PosterLabels = {
  title: string; subtitle: string; preview: string; style: string; night: string; sunset: string; paper: string;
  size: string; portrait: string; square: string; showCode: string; privacy: string; save: string; copyImage: string;
  copyLink: string; generating: string; working: string; saved: string; copied: string; linkCopied: string;
  fallback: string; failed: string; missing: string; retry: string; reveal: string; close: string; hold: string
}
export type PosterSaveResult = { status: 'saved'; path?: string } | { status: 'cancelled' | 'hold' }
export type PosterActions = {
  save: (blob: Blob, name: string) => Promise<PosterSaveResult>
  copy: (blob: Blob) => Promise<void>
  copyLink: (link: string) => Promise<void>
  reveal?: (path: string) => Promise<unknown>
}
export type PosterEditorProps = {
  input: Pick<PosterInput, 'look' | 'code' | 'link' | 'language'>; labels: PosterLabels; resources: PosterResources;
  actions: PosterActions; onRetry: () => void; onBusy?: (busy: boolean) => void
}

/** Shared by the desktop and site. Each completed preview owns exactly one object URL. */
export function SharePosterEditor({ input, labels, resources, actions, onRetry, onBusy }: PosterEditorProps) {
  const [style, setStyle] = useState<PosterStyle>('night')
  const [size, setSize] = useState<PosterSize>('portrait')
  const [showCode, setShowCode] = useState(true)
  const [retry, setRetry] = useState(0)
  const [preview, setPreview] = useState<{ blob: Blob; url: string; key: string } | null>(null)
  const [failure, setFailure] = useState(false)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<keyof PosterLabels | ''>('')
  const [fallback, setFallback] = useState(false)
  const [path, setPath] = useState('')
  const lock = useRef(false), alive = useRef(true)
  const urlRef = useRef('')
  let valid = true
  try { posterQrContent(input.code, input.link) } catch { valid = false }
  const key = JSON.stringify({ ...input, style, size, showCode, retry })
  const generating = valid && preview?.key !== key && !failure
  const ready = valid && preview?.key === key && !busy
  useEffect(() => { alive.current = true; return () => { alive.current = false; URL.revokeObjectURL(urlRef.current) } }, [])
  useEffect(() => {
    onBusy?.(busy)
    return () => onBusy?.(false)
  }, [busy, onBusy])
  useEffect(() => {
    let live = true
    setFailure(false); setNotice(''); setFallback(false); setPath('')
    if (valid) {
      const next = JSON.parse(key) as PosterInput
      void renderSharePoster(next, resources).then((blob) => {
        if (!live) return
        const url = URL.createObjectURL(blob)
        URL.revokeObjectURL(urlRef.current); urlRef.current = url
        setPreview({ blob, url, key })
      }, () => { if (live) setFailure(true) })
    }
    return () => { live = false }
  }, [key, resources, valid])
  async function save(blob: Blob) {
    const result = await actions.save(blob, posterFileName(input.code, input.language))
    if (!alive.current) return
    if (result.status === 'saved') { setNotice('saved'); setPath(result.path ?? '') }
    else if (result.status === 'hold') setNotice('hold')
  }
  async function run(action: 'save' | 'copy' | 'link') {
    if (!ready || !preview || lock.current) return
    lock.current = true; setBusy(true); setNotice(''); setPath(''); setFallback(false)
    try {
      if (action === 'save') await save(preview.blob)
      else if (action === 'link') { await actions.copyLink(input.link); if (alive.current) setNotice('linkCopied') }
      else {
        try { await actions.copy(preview.blob); if (alive.current) setNotice('copied') }
        catch { if (alive.current) setFallback(true); await save(preview.blob) }
      }
    } catch { if (alive.current) setNotice('failed') }
    finally { lock.current = false; if (alive.current) setBusy(false) }
  }
  return <div className="kun-share-editor">
    <div className="kun-share-preview" aria-busy={generating}>
      {preview ? <img src={preview.url} alt={labels.preview} /> : <div className="kun-share-placeholder">{valid ? failure ? labels.failed : labels.generating : labels.missing}</div>}
      {generating ? <span className="kun-share-progress" role="status">{labels.generating}</span> : null}
    </div>
    <div className="kun-share-controls">
      <p className="kun-share-subtitle">{labels.subtitle}</p>
      <fieldset disabled={busy}><legend>{labels.style}</legend><div className="kun-share-options">
        {POSTER_STYLES.map((entry) => <button type="button" key={entry} aria-pressed={style === entry} onClick={() => setStyle(entry)}>
          <span className={`kun-share-swatch is-${entry}`} />{labels[entry]}</button>)}
      </div></fieldset>
      <fieldset disabled={busy}><legend>{labels.size}</legend><div className="kun-share-options">
        {POSTER_SIZES.map((entry) => <button type="button" key={entry} aria-pressed={size === entry} onClick={() => setSize(entry)}>{labels[entry]}</button>)}
      </div></fieldset>
      <label className="kun-share-toggle"><input type="checkbox" checked={showCode} disabled={busy} onChange={(event) => setShowCode(event.target.checked)} />{labels.showCode}</label>
      <p className="kun-share-privacy">{labels.privacy}</p>
      <div className="kun-share-actions">
        <button type="button" data-primary disabled={!ready} onClick={() => void run('save')}>{busy ? labels.working : labels.save}</button>
        <button type="button" disabled={!ready} onClick={() => void run('copy')}>{labels.copyImage}</button>
        <button type="button" className="kun-share-link" disabled={!ready} onClick={() => void run('link')}>{labels.copyLink}</button>
      </div>
      {!valid || failure ? <p role="alert">{valid ? labels.failed : labels.missing} <button type="button" onClick={() => { if (!valid) onRetry(); setRetry((value) => value + 1) }}>{labels.retry}</button></p> : null}
      <div className="kun-share-notice" role={notice === 'failed' ? 'alert' : 'status'} aria-live="polite">
        {fallback ? <p>{labels.fallback}</p> : null}
        {notice ? <p>{labels[notice]}</p> : null}
        {path && actions.reveal ? <button type="button" onClick={() => void actions.reveal!(path).catch(() => setNotice('failed'))}>{labels.reveal}</button> : null}
      </div>
    </div>
  </div>
}
