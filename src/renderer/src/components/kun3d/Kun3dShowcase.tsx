import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent, type ReactElement } from 'react'
import { createPortal } from 'react-dom'
import { FolderOpen, RefreshCw, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { Kun3dAssetEntry, Kun3dAssetsBridge, Kun3dReferenceView } from '@shared/kun-3d-assets'
import { KUN_3D_LIGHTINGS, KUN_3D_SHADINGS, KUN_3D_VIEWS, Kun3dViewer, type Kun3dLighting, type Kun3dShading, type Kun3dView } from './kun-3d-viewer'
import { checkKun3dBudget, type Kun3dModelStats } from './kun-3d-stats'
import { Kun3dInfoPanel, Kun3dLibrary, type Kun3dDropped } from './Kun3dPanels'
import './kun-3d-showcase.css'

type Status = 'empty' | 'loading' | 'ready' | 'error'
const bridge = (): Kun3dAssetsBridge | undefined => typeof window === 'undefined' ? undefined : window.kunGui?.kun3dAssets
const copyBuffer = (data: Uint8Array): ArrayBuffer => data.slice().buffer as ArrayBuffer

/** Full-window space for the 3D assets artists generate: list, view, measure and compare with the drawings. */
export default function Kun3dShowcase({ onClose }: { onClose: () => void }): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const dialog = useRef<HTMLDialogElement>(null)
  const host = useRef<HTMLDivElement>(null)
  const viewer = useRef<Kun3dViewer | null>(null)
  const serial = useRef(0)
  const [root, setRoot] = useState(''), [entries, setEntries] = useState<Kun3dAssetEntry[]>([]), [listError, setListError] = useState('')
  const [query, setQuery] = useState(''), [dropped, setDropped] = useState<Kun3dDropped | null>(null), [dragging, setDragging] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  const [status, setStatus] = useState<Status>('empty'), [error, setError] = useState(''), [webgl, setWebgl] = useState(true)
  const [stats, setStats] = useState<Kun3dModelStats | null>(null), [bytes, setBytes] = useState(0)
  const [view, setView] = useState<Kun3dView>('front'), [shading, setShading] = useState<Kun3dShading>('original')
  const [lighting, setLighting] = useState<Kun3dLighting>('studio'), [autoRotate, setAutoRotate] = useState(false), [grid, setGrid] = useState(false)
  const [animation, setAnimation] = useState(''), [references, setReferences] = useState<Partial<Record<Kun3dReferenceView, string>>>({})
  const [compare, setCompare] = useState<Kun3dReferenceView | null>(null), [opacity, setOpacity] = useState(0.5)
  const entry = entries.find((item) => item.key === selected) ?? null

  useEffect(() => {
    const node = dialog.current
    if (node && !node.open && typeof node.showModal === 'function') node.showModal()
    return () => { if (node?.open) node.close() }
  }, [])
  useEffect(() => {
    if (!host.current) return
    try { viewer.current = new Kun3dViewer(host.current) } catch { setWebgl(false) }
    return () => { viewer.current?.dispose(); viewer.current = null }
  }, [])

  const refresh = useCallback(async () => {
    const api = bridge()
    if (!api) return
    const result = await api.list().catch((cause: unknown) => ({ ok: false as const, root: '', message: String(cause) }))
    setRoot(result.root)
    if (!result.ok) { setListError(result.message); return }
    setListError('')
    setEntries((current) => JSON.stringify(current) === JSON.stringify(result.entries) ? current : result.entries)
  }, [])
  // New exports show up on their own: poll while visible and refresh when the window regains focus.
  useEffect(() => {
    void refresh()
    const timer = setInterval(() => { if (!document.hidden) void refresh() }, 4000)
    const focus = () => void refresh()
    window.addEventListener('focus', focus)
    return () => { clearInterval(timer); window.removeEventListener('focus', focus) }
  }, [refresh])

  const show = useCallback(async (key: string, read: () => Promise<{ data: ArrayBuffer; bytes: number }>) => {
    const id = ++serial.current
    setSelected(key); setStatus('loading'); setError(''); setStats(null); setAnimation(''); setCompare(null)
    viewer.current?.setOrthographic(null)
    try {
      const { data, bytes: size } = await read()
      if (!viewer.current) throw new Error(t('kun3dNoWebgl'))
      const measured = await viewer.current.load(data)
      if (id !== serial.current) return
      setStats(measured); setBytes(size); setStatus('ready'); setView('front')
    } catch (cause) {
      if (id !== serial.current) return
      const message = cause instanceof Error ? cause.message : String(cause)
      setStatus('error')
      setError(/draco/i.test(message) ? t('kun3dErrorDraco') : /basisu|ktx2/i.test(message) ? t('kun3dErrorBasis') : t('kun3dErrorGeneric', { message }))
    }
  }, [t])
  const pick = (item: Kun3dAssetEntry) => void show(item.key, async () => {
    const result = await bridge()!.read(item.key)
    if (!result.ok) throw new Error(result.message)
    return { data: copyBuffer(result.data), bytes: result.bytes }
  })
  const pickDropped = (file = dropped) => { if (file) void show('drop', async () => ({ data: file.data.slice(0), bytes: file.data.byteLength })) }

  // Reload the open model when its file changes on disk.
  const modifiedAt = entry?.modifiedAt
  useEffect(() => { if (entry && status === 'ready') pick(entry) }, [modifiedAt]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const urls: string[] = []
    let cancelled = false
    setReferences({})
    const api = bridge()
    if (!entry || !api) return
    void Promise.all(Object.entries(entry.references).map(async ([view, key]) => {
      const result = await api.read(key)
      if (!result.ok) return null
      const url = URL.createObjectURL(new Blob([copyBuffer(result.data)], { type: result.mimeType }))
      urls.push(url)
      return [view, url] as const
    })).then((pairs) => { if (!cancelled) setReferences(Object.fromEntries(pairs.filter((pair) => pair !== null))) })
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [entry?.key, JSON.stringify(entry?.references)]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { viewer.current?.setShading(shading) }, [shading])
  useEffect(() => { viewer.current?.setLighting(lighting) }, [lighting])
  useEffect(() => { viewer.current?.setAutoRotate(autoRotate && !compare) }, [autoRotate, compare])
  useEffect(() => { viewer.current?.setGrid(grid) }, [grid])
  useEffect(() => { viewer.current?.playAnimation(animation || null) }, [animation, stats])
  const chooseView = (next: Kun3dView) => { setView(next); setCompare(null); viewer.current?.setOrthographic(null); viewer.current?.setView(next) }
  const chooseCompare = (next: Kun3dReferenceView | null) => {
    setCompare(next)
    const target = next && next !== 'worn' ? next : null
    viewer.current?.setOrthographic(target)
    if (target) setView(target)
  }

  const onDrop = async (event: DragEvent) => {
    event.preventDefault()
    setDragging(false)
    const file = [...event.dataTransfer.files].find((item) => item.name.toLowerCase().endsWith('.glb'))
    if (!file) return
    const next = { name: file.name, data: await file.arrayBuffer() }
    setDropped(next)
    pickDropped(next)
  }
  const checks = useMemo(() => stats ? checkKun3dBudget(entry?.category ?? 'other', entry?.id ?? '', stats, bytes) : [], [stats, entry, bytes])
  const name = selected === 'drop' ? dropped?.name ?? '' : entry?.key ?? ''
  const folder = entry ? `${entry.category}/${entry.id}` : null
  const segment = <T extends string>(values: readonly T[], value: T, label: (item: T) => string, choose: (item: T) => void, attr: string) =>
    <div className="kun3d-segment" role="radiogroup">{values.map((item) => <button key={item} type="button" role="radio"
      aria-checked={value === item} onClick={() => choose(item)} {...{ [attr]: item }}>{label(item)}</button>)}</div>

  return createPortal(<dialog ref={dialog} className="kun3d" aria-label={t('kun3dTitle')} data-kun3d-state={status}
    onCancel={(event) => { event.preventDefault(); onClose() }} onDragOver={(event) => { event.preventDefault(); setDragging(true) }}
    onDragLeave={(event) => { if (event.currentTarget === event.target) setDragging(false) }} onDrop={(event) => void onDrop(event)}>
    <header className="kun3d-head">
      <strong>{t('kun3dTitle')}</strong>
      {root ? <span className="kun3d-path" title={root}>{root}</span> : null}
      <span className="kun3d-head-actions">
        <button type="button" onClick={() => void refresh()} title={t('kun3dRefresh')} aria-label={t('kun3dRefresh')}><RefreshCw size={15} /></button>
        <button type="button" onClick={() => void bridge()?.openFolder()} data-kun3d-open-folder><FolderOpen size={15} />{t('kun3dOpenFolder')}</button>
        <button type="button" className="kun3d-close" onClick={onClose} aria-label={t('kun3dClose')}><X size={18} /></button>
      </span>
    </header>
    <div className="kun3d-body">
      <Kun3dLibrary entries={entries} dropped={dropped} selected={selected} query={query} language={language} onQuery={setQuery}
        onPick={pick} onPickDropped={() => pickDropped()} onOpenFolder={() => void bridge()?.openFolder()} />
      <main className="kun3d-stage">
        <div ref={host} className="kun3d-canvas-host" data-shading={shading} />
        {compare && references[compare] ? <img className="kun3d-overlay" src={references[compare]} alt="" style={{ opacity }} /> : null}
        {status !== 'ready' ? <div className="kun3d-stage-note" role={status === 'error' || !webgl ? 'alert' : 'status'}>
          {!webgl ? t('kun3dNoWebgl') : status === 'loading' ? t('kun3dLoading') : status === 'error' ? error
            : listError ? t('kun3dErrorList', { message: listError }) : t('kun3dPickHint')}
        </div> : null}
        {dragging ? <div className="kun3d-drop">{t('kun3dDropHint')}</div> : null}
        <div className="kun3d-toolbar" data-disabled={status !== 'ready' || undefined}>
          <span><small>{t('kun3dView')}</small>{segment(KUN_3D_VIEWS, view, (item) => t(`kun3dView_${item}`), chooseView, 'data-kun3d-view')}</span>
          <span><small>{t('kun3dShading')}</small>{segment(KUN_3D_SHADINGS, shading, (item) => t(`kun3dShading_${item}`), setShading, 'data-kun3d-shading')}</span>
          <span><small>{t('kun3dLighting')}</small>{segment(KUN_3D_LIGHTINGS, lighting, (item) => t(`kun3dLighting_${item}`), setLighting, 'data-kun3d-lighting')}</span>
          <label className="kun3d-toggle"><input type="checkbox" checked={autoRotate} onChange={(event) => setAutoRotate(event.target.checked)} />{t('kun3dAutoRotate')}</label>
          <label className="kun3d-toggle"><input type="checkbox" checked={grid} onChange={(event) => setGrid(event.target.checked)} />{t('kun3dGrid')}</label>
          {stats?.animations.length ? <label className="kun3d-toggle">{t('kun3dAnimation')}
            <select value={animation} onChange={(event) => setAnimation(event.target.value)}>
              <option value="">{t('kun3dAnimationNone')}</option>
              {stats.animations.map((clip) => <option key={clip} value={clip}>{clip}</option>)}
            </select></label> : null}
        </div>
      </main>
      <Kun3dInfoPanel name={name} bytes={bytes} stats={stats} checks={checks} references={references} folder={folder}
        compare={compare} opacity={opacity} onCompare={chooseCompare} onOpacity={setOpacity} />
    </div>
  </dialog>, document.body)
}
