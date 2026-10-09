import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactElement, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { KUN_AVATAR_RARITIES, KUN_WARDROBE_RULES, type KunAvatarRarity, type KunWardrobeDrop } from '@shared/rooms-api'
import { WardrobeBottleGlow, WardrobeBottleIcon } from './RoomWardrobeBottle'
import { WardrobeResultCard, wardrobeDropDetails } from './RoomWardrobeResultCard'
import { WardrobeCardViewer, WardrobeTenGrid, wardrobeFlipOrder } from './RoomWardrobeTenPull'
import { openWardrobeDrops, useWardrobe, wardrobeShelf, type WardrobeOpenResult } from './room-wardrobe'
import './room-wardrobe.css'
import './room-wardrobe-opening.css'

type Mode = 'idle' | 'single' | 'ten'
/** A ten-pull deals its cards face down (`reveal`), waits on the table to be flipped (`table`), then sums up (`done`). */
type Phase = 'idle' | 'shake' | 'charge' | 'burst' | 'reveal' | 'table' | 'done'
const TEN = KUN_WARDROBE_RULES.tenPull
const rank = (rarity: KunAvatarRarity) => KUN_AVATAR_RARITIES.indexOf(rarity)
const prefersStill = () => typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
const SPARKS: Record<KunAvatarRarity, number> = { common: 0, rare: 6, epic: 12, legendary: 20 }

export type WardrobeOpenerOptions = {
  /** "Wear" on a single result: editors put it on their draft, the panel saves it as the user's avatar. */
  onWear?: (drop: KunWardrobeDrop) => void | Promise<void>
  /** Opens the dress-up studio after a ten-pull; editors that already show it leave this out. */
  onDress?: () => void
}

/**
 * Opens bottles from the shelf with the gacha stage: one at a time, a
 * ten-pull, or the idle shelf view that offers both.
 */
export function useWardrobeOpener(options: WardrobeOpenerOptions = {}) {
  const state = useWardrobe()
  const latest = useRef(state.wardrobe)
  latest.current = state.wardrobe
  const serial = useRef(0)
  const [session, setSession] = useState<{ key: number; mode: Mode; result: WardrobeOpenResult | null; error: string } | null>(null)
  const start = useCallback(async (mode: 'single' | 'ten', dropId?: string) => {
    const shelf = wardrobeShelf(latest.current)
    const ids = mode === 'ten' ? shelf.slice(0, TEN).map((drop) => drop.id) : [dropId ?? shelf[0]?.id].filter((id): id is string => Boolean(id))
    if (!ids.length || (mode === 'ten' && ids.length < TEN)) return
    const key = ++serial.current
    setSession({ key, mode, result: null, error: '' })
    try {
      const result = await openWardrobeDrops(ids)
      setSession((current) => current?.key === key ? { ...current, result } : current)
    } catch (cause) {
      setSession((current) => current?.key === key ? { ...current, error: String(cause) } : current)
    }
  }, [])
  const openOne = useCallback((dropId?: string) => { void start('single', dropId) }, [start])
  const openTen = useCallback(() => { void start('ten') }, [start])
  const showShelf = useCallback(() => setSession({ key: ++serial.current, mode: 'idle', result: null, error: '' }), [])
  const close = useCallback(() => setSession(null), [])
  const { onWear, onDress } = options
  const overlay: ReactNode = session ? <RoomWardrobeOpening key={session.key} mode={session.mode} result={session.result}
    error={session.error} shelfCount={wardrobeShelf(state.wardrobe).length} onClose={close} onOpenOne={() => openOne()}
    onOpenTen={openTen} onWear={onWear} onDress={onDress ? () => { close(); onDress() } : undefined} /> : null
  return { openOne, openTen, showShelf, opening: Boolean(session), overlay }
}

export function RoomWardrobeOpening({ mode, result, error, shelfCount, onClose, onOpenOne, onOpenTen, onWear, onDress }: {
  mode: Mode; result: WardrobeOpenResult | null; error: string; shelfCount: number
  onClose: () => void; onOpenOne: () => void; onOpenTen: () => void
  onWear?: (drop: KunWardrobeDrop) => void | Promise<void>; onDress?: () => void
}): ReactElement {
  const { t, i18n } = useTranslation('common')
  const language = i18n.language.startsWith('zh') ? 'zh' : 'en'
  const dialog = useRef<HTMLDialogElement>(null)
  const [phase, setPhase] = useState<Phase>(mode === 'idle' ? 'idle' : 'shake')
  const [shaken, setShaken] = useState(false), [wearing, setWearing] = useState(false)
  const [open, setOpen] = useState<ReadonlySet<number>>(() => new Set()), [faceUp, setFaceUp] = useState(true)
  const [viewing, setViewing] = useState<number | null>(null), [flash, setFlash] = useState(false)
  const flips = useRef<ReturnType<typeof setTimeout>[]>([])
  const drops = useMemo(() => result?.drops ?? [], [result])
  const everything = useMemo(() => new Set(drops.map((_, index) => index)), [drops])
  const top = drops.reduce<KunAvatarRarity>((best, drop) => rank(drop.rarity) > rank(best) ? drop.rarity : best, 'common')
  useEffect(() => {
    const node = dialog.current
    if (node && !node.open && typeof node.showModal === 'function') node.showModal()
    return () => { if (node?.open) node.close() }
  }, [])
  useEffect(() => () => flips.current.forEach((timer) => clearTimeout(timer)), [])
  // The bottle shakes for at least 0.7 seconds, however fast the result arrives.
  useEffect(() => {
    if (mode === 'idle') return
    const timer = setTimeout(() => setShaken(true), 700)
    return () => clearTimeout(timer)
  }, [mode])
  useEffect(() => {
    if (!result || phase !== 'shake') return
    if (prefersStill()) { setOpen(everything); setPhase('done') } else if (shaken) setPhase('charge')
  }, [result, shaken, phase, everything])
  useEffect(() => {
    const steps: Partial<Record<Phase, [Phase, number]>> = {
      // A legendary bottle holds its light a little longer before it bursts.
      charge: ['burst', top === 'legendary' ? 900 : rank(top) >= 2 ? 600 : 450],
      burst: ['reveal', 450],
      // A single card lands face down, glows, then turns over; ten cards are dealt and wait on the table.
      reveal: mode === 'ten' ? ['table', drops.length * 80 + 550] : ['done', 700]
    }
    const step = steps[phase]
    if (!step) return
    const timer = setTimeout(() => setPhase(step[0]), step[1])
    return () => clearTimeout(timer)
  }, [phase, top, mode, drops.length])
  // Once every card on the table is face up, the ten-pull sums up.
  useEffect(() => {
    if (phase !== 'table' || !drops.length || open.size < drops.length) return
    const timer = setTimeout(() => setPhase('done'), 450)
    return () => clearTimeout(timer)
  }, [phase, open, drops.length])
  const animating = phase === 'shake' || phase === 'charge' || phase === 'burst' || phase === 'reveal'
  const clearFlips = () => { flips.current.forEach((timer) => clearTimeout(timer)); flips.current = [] }
  const goldFlash = () => { setFlash(true); flips.current.push(setTimeout(() => setFlash(false), 900)) }
  const skip = () => { if (!result) return; clearFlips(); setFlash(false); setOpen(everything); setPhase('done') }
  const flipAll = () => {
    clearFlips()
    for (const step of wardrobeFlipOrder(drops, open)) flips.current.push(setTimeout(() => {
      setOpen((current) => new Set(current).add(step.index))
      if (step.flash) goldFlash()
    }, step.at))
  }
  const pickCard = (index: number) => {
    if (open.has(index)) { setViewing(index); return }
    setOpen((current) => new Set(current).add(index))
    if (drops[index]?.rarity === 'legendary') goldFlash()
  }
  const revealed = phase === 'reveal' || phase === 'table' || phase === 'done'
  const single = drops[0]
  const lit = phase === 'charge' || phase === 'burst' || revealed
  const banner = phase !== 'done' || mode !== 'ten' ? '' : top === 'legendary'
    ? t('roomsGachaLegendary', { name: wardrobeDropDetails(drops.find((drop) => drop.rarity === 'legendary')!, language).name })
    : result?.guaranteed ? t('roomsGachaPity') : top === 'epic'
      ? t('roomsGachaEpic', { name: wardrobeDropDetails(drops.find((drop) => drop.rarity === 'epic')!, language).name }) : ''
  const caption = phase === 'idle' ? t(shelfCount ? 'roomsGachaIdle' : 'roomsGachaEmpty')
    : phase === 'shake' ? t('roomsGachaShake') : phase === 'charge' ? t('roomsGachaCharge') : phase === 'burst' || phase === 'reveal' ? ''
      : phase === 'table' ? t('roomsGachaTableHint')
        : mode === 'ten' ? t('roomsGachaDoneTen') : single?.duplicate ? t('roomsGachaDoneDuplicate')
          : single?.kind === 'card' ? t('roomsGachaDoneCard') : t('roomsGachaDoneNew')
  const hint = phase === 'done' && !prefersStill() ? t(mode === 'ten' ? 'roomsGachaViewHint' : 'roomsGachaTiltHint') : ''
  const wear = async () => {
    if (!single || !onWear) return
    setWearing(true)
    try { await onWear(single); onClose() } finally { setWearing(false) }
  }
  const sparks = mode === 'single' && single && phase === 'done' ? Array.from({ length: SPARKS[single.rarity] }, (_, index) => {
    const angle = index / SPARKS[single.rarity] * Math.PI * 2, distance = 190 + (index % 3) * 40
    return <span key={index} className="kun-gacha-spark" style={{ '--dx': `${Math.round(Math.cos(angle) * distance)}px`,
      '--dy': `${Math.round(Math.sin(angle) * distance)}px`, '--i': index } as CSSProperties} />
  }) : null
  const content = <dialog ref={dialog} className="kun-gacha" data-phase={phase} data-mode={mode} data-top-rarity={lit ? top : undefined}
    aria-label={t(mode === 'ten' ? 'roomsGachaTitleTen' : 'roomsGachaTitle')} data-wardrobe-opening={phase} data-flash={flash || undefined}
    data-viewing={viewing !== null || undefined}
    onCancel={(event) => {
      event.preventDefault()
      if (viewing !== null) setViewing(null)
      else if (animating && result) skip()
      else if (!animating || error) onClose()
    }}>
    <div className="kun-gacha-backdrop" aria-hidden="true" />
    {/* Centered so the window's traffic lights keep the top-left corner. */}
    <header className="kun-gacha-head">
      <span className="kun-gacha-title">
        <WardrobeBottleIcon size={26} state="sealed" />
        <strong>{t(mode === 'ten' ? 'roomsGachaTitleTen' : 'roomsGachaTitle')}</strong>
        {mode === 'ten' ? <span className="kun-gacha-pill" data-tone="gold">{t('roomsGachaTenPromise')}</span> : null}
        <span className="kun-gacha-pill">{t('roomsGachaShelfLeft', { count: shelfCount })}</span>
      </span>
      <span className="kun-gacha-head-actions">
        {(animating || phase === 'table') && result ? <button type="button" className="kun-gacha-ghost" onClick={skip} data-gacha-skip>{t('roomsGachaSkip')}</button> : null}
        <button type="button" className="kun-gacha-close" aria-label={t('roomsClose')} disabled={animating && !error} onClick={onClose}><X size={18} /></button>
      </span>
    </header>
    {banner ? <div className="kun-gacha-banner" role="status">{banner}</div> : null}
    {mode === 'ten' ? <WardrobeTenGrid drops={drops} phase={phase} lit={lit} open={open} language={language} onCard={pickCard} />
      : <div className="kun-gacha-stage rooms-wardrobe-rarity" data-rarity={lit && single ? single.rarity : undefined}>
        {phase === 'done' && single && rank(single.rarity) > 0 ? <span className="kun-gacha-rays" aria-hidden="true" /> : null}
        <span className="kun-gacha-haze" aria-hidden="true" />
        {phase === 'burst' ? <span className="kun-gacha-flash" aria-hidden="true" /> : null}
        {revealed && single ? <div className="kun-gacha-deal">
          <WardrobeResultCard drop={single} size="large" faceUp={phase === 'done' && faceUp} hint={phase === 'reveal' && rank(single.rarity) >= 1}
            sway language={language} onClick={phase === 'done' ? () => setFaceUp((current) => !current) : undefined} />
        </div> : <button type="button" className="kun-gacha-bottle" data-state={phase} disabled={phase !== 'idle' || !shelfCount}
          aria-label={t('roomsGachaOpenOne')} onClick={onOpenOne}>
          {phase === 'charge' || phase === 'burst' ? <WardrobeBottleGlow className="kun-gacha-bottle-glow" /> : null}
          <WardrobeBottleIcon size={220} state="sealed" />
        </button>}
        {sparks}
      </div>}
    {flash ? <span className="kun-gacha-goldflash" aria-hidden="true" /> : null}
    {phase === 'done' && mode === 'ten' && result ? <div className="kun-gacha-summary" data-gacha-summary>
      <span data-tone="rare">{t('roomsGachaSumNew', { count: drops.filter((drop) => !drop.duplicate).length })}</span>
      <span data-tone="legendary">{t('roomsGachaSumDuplicate', { count: drops.filter((drop) => drop.duplicate).length, feathers: result.feathers })}</span>
      {drops.some((drop) => drop.kind === 'card' && !drop.duplicate) ? <span data-tone="epic">
        {t('roomsGachaSumCards', { count: drops.filter((drop) => drop.kind === 'card' && !drop.duplicate).length })}</span> : null}
      {result.guaranteed ? <span data-tone="pity">{t('roomsGachaSumPity')}</span> : null}
    </div> : null}
    <p className="kun-gacha-caption" aria-live="polite">{error || caption}{hint && !error ? <small>{hint}</small> : null}</p>
    <footer className="kun-gacha-actions">
      {phase === 'idle' ? <>
        <button type="button" className="kun-gacha-secondary" disabled={!shelfCount} onClick={onOpenOne} data-gacha-open="one">{t('roomsGachaOpenOne')}</button>
        <button type="button" className="kun-gacha-gold" disabled={shelfCount < TEN} onClick={onOpenTen} data-gacha-open="ten">
          {t('roomsGachaOpenTen')}<small>{shelfCount < TEN ? t('roomsGachaShort', { count: TEN - shelfCount }) : t('roomsGachaTenPromiseShort')}</small></button>
      </> : null}
      {phase === 'table' ? <button type="button" className="kun-gacha-light" onClick={flipAll} data-gacha-flip-all>
        {t('roomsGachaFlipAll')}<small>{t('roomsGachaFlipLeft', { count: drops.length - open.size })}</small></button> : null}
      {phase === 'done' && mode === 'single' && single ? <>
        {onWear && !single.duplicate ? <button type="button" className="kun-gacha-primary" disabled={wearing} onClick={() => void wear()} data-gacha-wear>
          {t(single.kind === 'card' ? 'roomsWardrobeWearSet' : 'roomsWardrobeWearOnMe')}</button> : null}
        <button type="button" className="kun-gacha-secondary" onClick={onClose} data-gacha-keep>{t('roomsGachaKeep')}</button>
        {shelfCount ? <button type="button" className="kun-gacha-secondary" onClick={onOpenOne} data-gacha-again>{t('roomsGachaAgain')}</button> : null}
      </> : null}
      {phase === 'done' && mode === 'ten' ? <>
        <button type="button" className="kun-gacha-primary" onClick={onClose} data-gacha-keep>{t('roomsGachaKeepAll')}</button>
        {onDress ? <button type="button" className="kun-gacha-secondary" onClick={onDress}>{t('roomsWardrobeGoDress')}</button> : null}
        <button type="button" className="kun-gacha-gold" disabled={shelfCount < TEN} onClick={onOpenTen} data-gacha-again>
          {t('roomsGachaAgainTen')}{shelfCount < TEN ? <small>{t('roomsGachaShort', { count: TEN - shelfCount })}</small> : null}</button>
      </> : null}
      {error ? <button type="button" className="kun-gacha-secondary" onClick={onClose}>{t('roomsClose')}</button> : null}
    </footer>
    {viewing !== null ? <WardrobeCardViewer drops={drops} open={open} index={viewing} language={language}
      onMove={setViewing} onClose={() => setViewing(null)} /> : null}
  </dialog>
  return typeof document === 'undefined' ? content : createPortal(content, document.body)
}
