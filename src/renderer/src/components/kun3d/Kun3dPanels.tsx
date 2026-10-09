import type { ReactElement } from 'react'
import { Check, FolderOpen, Search, TriangleAlert } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_3D_ASSET_CATEGORIES, KUN_3D_REFERENCE_VIEWS, type Kun3dAssetEntry, type Kun3dReferenceView } from '@shared/kun-3d-assets'
import { kun3dCatalogLabel, kun3dEntryMatches } from './kun-3d-catalog'
import { formatKun3dBytes, formatKun3dMeters, type Kun3dBudgetCheck, type Kun3dModelStats } from './kun-3d-stats'

type Language = 'zh' | 'en'
export type Kun3dDropped = { name: string; data: ArrayBuffer }

/** The asset list: dropped previews first, then each category folder. */
export function Kun3dLibrary({ entries, dropped, selected, query, language, onQuery, onPick, onPickDropped, onOpenFolder }: {
  entries: Kun3dAssetEntry[]; dropped: Kun3dDropped | null; selected: string | null; query: string; language: Language
  onQuery: (query: string) => void; onPick: (entry: Kun3dAssetEntry) => void; onPickDropped: () => void; onOpenFolder: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const shown = entries.filter((entry) => kun3dEntryMatches(entry, query, language))
  return <aside className="kun3d-library" aria-label={t('kun3dLibrary')}>
    <label className="kun3d-search"><Search size={14} aria-hidden="true" />
      <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={t('kun3dSearch')} aria-label={t('kun3dSearch')} />
    </label>
    <div className="kun3d-library-list">
      {dropped ? <section><h3>{t('kun3dTemp')}</h3>
        <button type="button" className="kun3d-entry" aria-pressed={selected === 'drop'} onClick={onPickDropped} data-kun3d-entry="drop">
          <strong>{dropped.name}</strong><small>{t('kun3dTempHint')}</small>
        </button>
      </section> : null}
      {KUN_3D_ASSET_CATEGORIES.map((category) => {
        const items = shown.filter((entry) => entry.category === category)
        if (!items.length) return null
        return <section key={category}>
          <h3>{t(`kun3dCategory_${category}`)}<span>{items.length}</span></h3>
          {items.map((entry) => {
            const label = kun3dCatalogLabel(entry.category, entry.id, language)
            return <button key={entry.key} type="button" className="kun3d-entry" aria-pressed={selected === entry.key}
              onClick={() => onPick(entry)} data-kun3d-entry={entry.key}>
              <strong>{label ?? entry.id}</strong>
              <small>{label ? entry.id : t('kun3dUnmatched')} · {formatKun3dBytes(entry.bytes)}</small>
              {Object.keys(entry.references).length ? <span className="kun3d-entry-refs" aria-hidden="true">{Object.keys(entry.references).length}</span> : null}
            </button>
          })}
        </section>
      })}
      {!entries.length && !dropped ? <div className="kun3d-empty" data-kun3d-empty>
        <strong>{t('kun3dEmptyTitle')}</strong>
        <ol><li>{t('kun3dEmptyStep1')}</li><li>{t('kun3dEmptyStep2')}</li><li>{t('kun3dEmptyStep3')}</li></ol>
        <code>tripo generate multiview front.png left.png back.png --wait -o pilot-cap.glb</code>
        <button type="button" onClick={onOpenFolder}><FolderOpen size={14} aria-hidden="true" />{t('kun3dOpenFolder')}</button>
        <small>{t('kun3dEmptyDrop')}</small>
      </div> : null}
    </div>
  </aside>
}

/** Model numbers, the budget checks and the three-view drawings. */
export function Kun3dInfoPanel({ name, bytes, stats, checks, references, folder, compare, opacity, onCompare, onOpacity }: {
  name: string; bytes: number; stats: Kun3dModelStats | null; checks: Kun3dBudgetCheck[]
  references: Partial<Record<Kun3dReferenceView, string>>; folder: string | null; compare: Kun3dReferenceView | null; opacity: number
  onCompare: (view: Kun3dReferenceView | null) => void; onOpacity: (value: number) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const rows: Array<[string, string]> = stats ? [
    [t('kun3dStatFile'), name], [t('kun3dStatSize'), formatKun3dBytes(bytes)],
    [t('kun3dStatTriangles'), stats.triangles.toLocaleString('en-US')], [t('kun3dStatVertices'), stats.vertices.toLocaleString('en-US')],
    [t('kun3dStatMaterials'), String(stats.materials)],
    [t('kun3dStatTextures'), stats.textures ? t('kun3dStatTexturesValue', { count: stats.textures, size: `${stats.maxTexture}px` }) : '0'],
    [t('kun3dStatBones'), String(stats.bones)], [t('kun3dStatAnimations'), stats.animations.length ? stats.animations.join(', ') : '0'],
    [t('kun3dStatHeight'), formatKun3dMeters(stats.size.y)],
    [t('kun3dStatFootprint'), `${formatKun3dMeters(stats.size.x)} × ${formatKun3dMeters(stats.size.z)}`]
  ] : [[t('kun3dStatFile'), name]]
  const views = KUN_3D_REFERENCE_VIEWS.filter((view) => references[view])
  return <aside className="kun3d-info" aria-label={t('kun3dInfo')}>
    <section>
      <h3>{t('kun3dInfo')}</h3>
      <dl className="kun3d-stats">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd title={value}>{value}</dd></div>)}</dl>
    </section>
    {checks.length ? <section data-kun3d-budget>
      <h3>{t('kun3dBudget')}</h3>
      <ul className="kun3d-checks">{checks.map((check) => <li key={check.id} data-ok={check.ok || undefined} data-kun3d-check={check.id}>
        {check.ok ? <Check size={13} aria-hidden="true" /> : <TriangleAlert size={13} aria-hidden="true" />}
        <span>{check.id === 'origin' ? t('kun3dBudgetOrigin') : check.id === 'height' ? t('kun3dBudgetHeight')
          : t(`kun3dBudget${check.id[0]!.toUpperCase()}${check.id.slice(1)}`, { limit: check.limit })}</span>
        <b>{check.value}</b>
      </li>)}</ul>
      <small>{t('kun3dBudgetNote')}</small>
    </section> : null}
    <section>
      <h3>{t('kun3dReferences')}</h3>
      {views.length ? <>
        <div className="kun3d-refs">{views.map((view) => <button key={view} type="button" aria-pressed={compare === view}
          disabled={view === 'worn'} onClick={() => onCompare(compare === view ? null : view)} data-kun3d-ref={view}>
          <img src={references[view]} alt="" draggable={false} /><span>{t(`kun3dView_${view}`)}</span>
        </button>)}</div>
        {compare ? <label className="kun3d-opacity">{t('kun3dOpacity')}
          <input type="range" min="0.1" max="0.9" step="0.05" value={opacity} onChange={(event) => onOpacity(Number(event.target.value))} />
        </label> : null}
        <small>{compare ? t('kun3dCompareHint') : t('kun3dCompare')}</small>
      </> : <small>{t('kun3dReferencesNone', { folder: folder ?? '<category>/<id>' })}</small>}
    </section>
  </aside>
}
