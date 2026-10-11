import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { PaperImportHintMeta } from '@shared/paper/paper-types'
import type { PaperVenueCatalogEntry } from '@shared/paper/paper-library-types'
import { useWriteWorkspaceStore } from '../../write/write-workspace-store'
import './mobile-paper.css'

type Card = { id: string; title: string; detail: string; input: string; meta: PaperImportHintMeta }
type Source = 'feeds' | 'today' | 'venue'
const VENUE_PAGE_SIZE = 50
type Props = { root: string; papersDir: string; onBusyChange: (busy: boolean) => void; onImported: () => void }

export function MobilePaperBrowse({ root, papersDir, onBusyChange, onImported }: Props) {
  const { t } = useTranslation('common')
  const paperMode = useWriteWorkspaceStore((state) => state.paperMode)
  const [source, setSource] = useState<Source>('today')
  const [feedId, setFeedId] = useState('')
  const [venues, setVenues] = useState<PaperVenueCatalogEntry[]>([])
  const [venue, setVenue] = useState('')
  const [skip, setSkip] = useState(0)
  const [total, setTotal] = useState(0)
  const [cards, setCards] = useState<Card[]>([])
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const serial = useRef(0)
  const job = useRef<string | null>(null)
  useEffect(() => { onBusyChange(importing); return () => onBusyChange(false) }, [importing, onBusyChange])
  useEffect(() => { serial.current += 1; setCards([]); setLoading(false); setError(''); setMessage('') }, [root, source])
  useEffect(() => window.kunGui.onPaperProgress((event) => {
    if (event.requestId === job.current) setMessage(event.message || event.stage)
  }), [])
  useEffect(() => () => { if (job.current) void window.kunGui.paperCancel({ requestId: job.current }) }, [])

  const load = async (): Promise<void> => {
    if (loading || importing || !root || !paperMode.libraries.includes(root)) return
    const request = ++serial.current
    setLoading(true); setError(''); setCards([]); setMessage('')
    try {
      if (source === 'feeds') {
        const feed = paperMode.discover.feeds.find((item) => item.id === feedId)
        if (!feed) throw new Error(t('mobileWorkPaperChooseFeedFirst'))
        const result = await window.kunGui.paperFetchFeed({ url: feed.url })
        if (!result.ok) throw new Error(result.message)
        if (request === serial.current) setCards(result.items.map((item, index) => ({
          id: `feed-${index}`, title: item.title, detail: item.publishedAt || feed.title,
          input: item.arxivId || item.doi || item.url,
          meta: { title: item.title, arxivId: item.arxivId, doi: item.doi, sourceUrl: item.url }
        })))
      } else if (source === 'today') {
        const result = await window.kunGui.paperArxivToday({ categories: paperMode.discover.arxivCategories })
        if (!result.ok) throw new Error(result.message)
        if (request === serial.current) setCards(result.items.map((item) => ({
          id: item.arxivId, title: item.title, detail: `${item.categories.join('、')} · ${item.publishedAt || result.date}`,
          input: item.arxivId, meta: { title: item.title, authors: item.authors, abstract: item.abstract,
            arxivId: item.arxivId, year: item.publishedAt?.slice(0, 4) }
        })))
      } else {
        if (!venue) throw new Error(t('mobileWorkPaperChooseVenueFirst'))
        const result = await window.kunGui.paperListVenue({ venue, skip })
        if (!result.ok) throw new Error(result.message)
        if (request === serial.current) {
          setTotal(result.total)
          setCards(result.items.map((item) => ({ id: item.coolId, title: item.title,
            detail: `${venue} · ${item.group || ''} · ${item.authors.slice(0, 3).join(', ')}`,
            input: item.coolId, meta: { title: item.title, authors: item.authors, abstract: item.abstract,
              coolId: item.coolId, pdfUrl: item.pdfUrl, sourceUrl: item.sourceUrl }
          })))
        }
      }
    } catch (cause) { if (request === serial.current) setError(String(cause)) }
    finally { if (request === serial.current) setLoading(false) }
  }
  const loadVenues = async (): Promise<void> => {
    setLoading(true); setError('')
    try {
      const result = await window.kunGui.paperVenueCatalog({})
      if (!result.ok) throw new Error(result.message)
      setVenues(result.venues); setVenue(result.venues[0]?.id ?? '')
    } catch (cause) { setError(String(cause)) }
    finally { setLoading(false) }
  }
  const importCard = async (card: Card): Promise<void> => {
    if (importing || !paperMode.libraries.includes(root)) return
    const requestId = crypto.randomUUID()
    job.current = requestId
    setImporting(true); setError(''); setMessage(t('mobileWorkPaperImportingNamed', { title: card.title }))
    try {
      const result = await window.kunGui.paperImport({ workspaceRoot: root, parentDir: papersDir,
        input: card.input, meta: card.meta, requestId })
      if (!result.ok) throw new Error(result.message)
      onImported(); setMessage(t('mobileWorkPaperImportedNamed', { title: card.title }))
    } catch (cause) { setError(String(cause)) }
    finally { job.current = null; setImporting(false) }
  }
  return <section className="kun-mobile-paper-browse">
    <nav aria-label={t('mobileWorkPaperBrowse')} className="kun-mobile-paper-actions">
      <button type="button" disabled={importing} aria-current={source === 'today' ? 'page' : undefined} onClick={() => setSource('today')}>{t('mobileWorkPaperArxivToday')}</button>
      <button type="button" disabled={importing} aria-current={source === 'feeds' ? 'page' : undefined} onClick={() => setSource('feeds')}>{t('mobileWorkPaperFeeds')}</button>
      <button type="button" disabled={importing} aria-current={source === 'venue' ? 'page' : undefined} onClick={() => setSource('venue')}>{t('mobileWorkPaperVenues')}</button>
    </nav>
    {source === 'feeds' ? <div className="kun-mobile-paper-search">
      <label>{t('mobileWorkPaperFeedChoice')} <select value={feedId} onChange={(event) => { setFeedId(event.target.value); setCards([]) }}>
        <option value="">{t('mobileWorkPaperChooseSource')}</option>{paperMode.discover.feeds.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select></label>
      <p role="status">{t('mobileWorkPaperFeedsHostHint')}</p>
    </div> : null}
    {source === 'venue' ? <div className="kun-mobile-paper-search">
      <button type="button" disabled={loading || importing} onClick={() => void loadVenues()}>{t('mobileWorkPaperVenueCatalog')}</button>
      <label>{t('mobileWorkPaperVenueChoice')} <select value={venue} onChange={(event) => { setVenue(event.target.value); setSkip(0); setTotal(0); setCards([]) }}>
        <option value="">{t('mobileWorkPaperChooseVenue')}</option>{venues.map((item) => <option key={item.id} value={item.id}>{item.id}</option>)}
      </select></label>
      {total > 0 ? <p>{skip + 1}–{Math.min(skip + VENUE_PAGE_SIZE, total)} / {total}</p> : null}
      <button type="button" disabled={loading || importing || skip === 0} onClick={() => { setSkip((value) => Math.max(0, value - VENUE_PAGE_SIZE)); setCards([]) }}>{t('mobileWorkPaperPrev')}</button>
      <button type="button" disabled={loading || importing || !total || skip + VENUE_PAGE_SIZE >= total} onClick={() => { setSkip((value) => value + VENUE_PAGE_SIZE); setCards([]) }}>{t('mobileWorkPaperNext')}</button>
    </div> : null}
    <button type="button" disabled={loading || importing || source === 'feeds' && !feedId || source === 'venue' && !venue}
      onClick={() => void load()}>{loading ? t('mobileWorkPaperLoading') : t('mobileWorkPaperLoad')}</button>
    {message ? <p role="status">{message}</p> : null}
    {error ? <p role="alert">{error}</p> : null}
    <ul className="kun-mobile-paper-list">{cards.map((card) => <li key={card.id}>
      <strong>{card.title}</strong><p>{card.detail}</p>
      <button type="button" disabled={importing} onClick={() => void importCard(card)}>{t('mobileWorkPaperImportToLibrary')}</button>
    </li>)}</ul>
    {!loading && !cards.length && !error ? <p role="status">{t('mobileWorkPaperPickSource')}</p> : null}
  </section>
}
