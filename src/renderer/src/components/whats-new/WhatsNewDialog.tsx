import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, ArrowUpRight, Check, ChevronDown, Sparkles, Wrench, X } from 'lucide-react'
import { firstSentence, isCatchAllItem, pickHighlights, type ReleaseNoteItem } from '@shared/release-notes-summary'
import kunCheerUrl from '../../../../asset/img/kun_cheer.png'
import kunMagicUrl from '../../../../asset/img/kun_magic.png'
import { openArtifactsPage } from '../../artifacts/artifact-library-store'
import { pulseFocusModeSwitch } from '../../lib/focus-mode'
import type { WhatsNewContent } from './whats-new-content'
import { WhatsNewArtifactsSpotlight } from './WhatsNewArtifactsSpotlight'
import { WhatsNewFocusSpotlight } from './WhatsNewFocusSpotlight'
import { WhatsNewOlderVersions } from './WhatsNewOlderVersions'
import { SPOTLIGHT_HIGHLIGHT_LIMIT, whatsNewSpotlight } from './whats-new-spotlights'

type Props = {
  content: WhatsNewContent
  onClose: () => void
}

const FOCUSABLE = 'button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'

function openChangelog(url: string): void {
  void window.kunGui?.openExternal?.(url)
}

function FixRow({ item }: { item: ReleaseNoteItem }): ReactElement {
  const body = item.body ? firstSentence(item.body, 64) : ''
  return (
    <li>
      {item.title ? <strong>{item.title}</strong> : null}
      {item.title && body ? <span aria-hidden="true"> · </span> : null}
      {body}
    </li>
  )
}

export default function WhatsNewDialog({ content, onClose: dismiss }: Props): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  const featuresId = useId()
  const dialogRef = useRef<HTMLElement>(null)
  const primaryRef = useRef<HTMLButtonElement>(null)
  const summary = content.current
  const spotlight = summary ? whatsNewSpotlight(content.version) : null
  const picked = useMemo(() => (summary
    ? pickHighlights(summary, spotlight ? { exclude: spotlight.covers, limit: SPOTLIGHT_HIGHLIGHT_LIMIT } : {})
    : null), [spotlight, summary])
  const fixesOnly = Boolean(summary && !spotlight && !picked?.highlights.length && summary.fixes.length)
  const [featuresOpen, setFeaturesOpen] = useState(false)
  const [fixesOpen, setFixesOpen] = useState(fixesOnly)
  const otherFeatures = spotlight?.id === 'artifacts' && summary
    ? summary.features.filter((item) => !spotlight.covers.test(item.title) && !isCatchAllItem(item)).slice(SPOTLIGHT_HIGHLIGHT_LIMIT)
    : []
  const fixesRef = useRef<HTMLDivElement>(null)
  const skipped = content.older.length
  // Closing after the Focus card rings the sidebar switch, so the user sees where it lives.
  const onClose = useCallback((): void => {
    if (spotlight?.id === 'focus-mode') pulseFocusModeSwitch()
    dismiss()
  }, [dismiss, spotlight])
  const openArtifacts = useCallback((): void => {
    dismiss()
    openArtifactsPage()
  }, [dismiss])

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    primaryRef.current?.focus()
    return () => previousFocus?.focus?.()
  }, [])

  useEffect(() => {
    if (fixesOpen && !fixesOnly) fixesRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' })
  }, [fixesOnly, fixesOpen])

  const onKeyDown = (event: KeyboardEvent<HTMLElement>): void => {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>(FOCUSABLE)]
    if (!focusable.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  const closeButton = (
    <button type="button" className="kun-wn-x" aria-label={t('whatsNewClose')} onClick={onClose}>
      <X className="h-4 w-4" strokeWidth={2} aria-hidden />
    </button>
  )

  if (!summary) {
    return (
      <div className="kun-wn ds-no-drag">
        <div className="kun-wn-scrim" aria-hidden="true" onClick={onClose} />
        <section
          ref={dialogRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          className="kun-wn-dialog kun-wn-dialog--empty"
          data-whats-new-dialog="missing"
          onKeyDown={onKeyDown}
        >
          {closeButton}
          <img className="kun-wn-empty-art" src={kunMagicUrl} alt="" draggable={false} />
          <h2 id={titleId} className="kun-wn-empty-title">{t('whatsNewPatchTitle', { version: content.version })}</h2>
          <p className="kun-wn-empty-body">{t('whatsNewMissingBody')}</p>
          <div className="kun-wn-empty-actions">
            <button type="button" className="kun-wn-secondary" onClick={onClose}>{t('whatsNewLater')}</button>
            <button
              ref={primaryRef}
              type="button"
              className="kun-wn-primary"
              onClick={() => {
                openChangelog(content.changelogUrl)
                onClose()
              }}
            >
              {t('whatsNewViewChangelog')}
            </button>
          </div>
        </section>
      </div>
    )
  }

  const highlights = picked?.highlights ?? []
  const alsoUpdated = picked?.alsoUpdated ?? []

  return (
    <div className="kun-wn ds-no-drag">
      <div className="kun-wn-scrim" aria-hidden="true" onClick={onClose} />
      <section
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="kun-wn-dialog"
        data-whats-new-dialog={fixesOnly ? 'patch' : skipped ? 'skipped' : 'release'}
        data-variant={fixesOnly ? 'patch' : undefined}
        data-spotlight={spotlight?.id}
        onKeyDown={onKeyDown}
      >
        <header className="kun-wn-hero">
          <span className="kun-wn-glow" aria-hidden="true" />
          <img className="kun-wn-art" src={kunCheerUrl} alt="" draggable={false} />
          <div className="kun-wn-heading">
            {fixesOnly ? null : (
              <span className="kun-wn-badge">
                <Check className="h-3 w-3" strokeWidth={2.6} aria-hidden />
                {skipped ? t('whatsNewSkipped', { n: skipped + 1 }) : t('whatsNewBadge')}
              </span>
            )}
            <h2 id={titleId} className="kun-wn-title">
              {t(fixesOnly ? 'whatsNewPatchTitle' : 'whatsNewTitle', { version: content.version })}
            </h2>
            {content.previousVersion ? (
              <div className="kun-wn-path">
                <span>{content.previousVersion}</span>
                <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                <strong>{content.version}</strong>
                {fixesOnly ? <span className="kun-wn-path-note">{t('whatsNewPatchSubtitle')}</span> : null}
              </div>
            ) : fixesOnly ? <div className="kun-wn-path">{t('whatsNewPatchSubtitle')}</div> : null}
          </div>
          {closeButton}
        </header>

        <div className="kun-wn-body">
          {summary.intro && !fixesOnly ? <p className="kun-wn-intro">{summary.intro}</p> : null}

          {spotlight?.id === 'focus-mode' ? <WhatsNewFocusSpotlight /> : null}
          {spotlight?.id === 'artifacts' ? <WhatsNewArtifactsSpotlight onOpen={openArtifacts} /> : null}

          {highlights.length ? (
            <>
              <div className="kun-wn-label">{t('whatsNewHighlights')}</div>
              <ul className="kun-wn-highlights">
                {highlights.map((item, index) => (
                  <li key={`${item.title}-${index}`} className="kun-wn-highlight" data-tone={index % 3}>
                    <span className="kun-wn-tile" aria-hidden="true">
                      <Sparkles className="h-[18px] w-[18px]" strokeWidth={1.9} />
                    </span>
                    <div className="kun-wn-highlight-text">
                      {item.title ? <div className="kun-wn-highlight-title">{item.title}</div> : null}
                      {item.body ? <div className="kun-wn-highlight-body">{item.body}</div> : null}
                    </div>
                  </li>
                ))}
              </ul>
            </>
          ) : null}

          {otherFeatures.length ? (
            <div className="kun-wn-more-features">
              <button
                type="button"
                className="kun-wn-disclosure"
                data-whats-new-more-features
                aria-expanded={featuresOpen}
                aria-controls={featuresId}
                onClick={() => setFeaturesOpen((value) => !value)}
              >
                <Sparkles className="h-4 w-4" strokeWidth={2} aria-hidden />
                <span className="kun-wn-disclosure-label">{t('whatsNewAlsoUpdated')}</span>
                <span className="kun-wn-count">{otherFeatures.length}</span>
                <ChevronDown className="kun-wn-chevron h-4 w-4" strokeWidth={2} aria-hidden />
              </button>
              <ul id={featuresId} className="kun-wn-feature-list" hidden={!featuresOpen}>
                {otherFeatures.map((item, index) => (
                  <li key={`${item.title}-${index}`}>
                    <strong>{item.title}</strong>
                    <span>{firstSentence(item.body, 140)}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : alsoUpdated.length ? (
            <div className="kun-wn-chips">
              <span className="kun-wn-chips-label">{t('whatsNewAlsoUpdated')}</span>
              {alsoUpdated.map((title) => <span key={title} className="kun-wn-chip">{title}</span>)}
            </div>
          ) : null}

          {summary.fixes.length ? (
            <div ref={fixesRef} className="kun-wn-fixes">
              {fixesOnly ? null : (
                <button
                  type="button"
                  className="kun-wn-disclosure"
                  data-whats-new-fixes
                  aria-expanded={fixesOpen}
                  onClick={() => setFixesOpen((value) => !value)}
                >
                  <Wrench className="kun-wn-fix-icon h-4 w-4" strokeWidth={2} aria-hidden />
                  <span className="kun-wn-disclosure-label">{t('whatsNewFixes')}</span>
                  <span className="kun-wn-count">{summary.fixes.length}</span>
                  <ChevronDown className="kun-wn-chevron h-4 w-4" strokeWidth={2} aria-hidden />
                </button>
              )}
              {fixesOpen ? (
                <ul className="kun-wn-fix-list">
                  {summary.fixes.map((item, index) => <FixRow key={`${item.title}-${index}`} item={item} />)}
                </ul>
              ) : null}
            </div>
          ) : null}

          {skipped ? <WhatsNewOlderVersions versions={content.older} /> : null}
        </div>

        <footer className="kun-wn-footer">
          <button type="button" className="kun-wn-link" onClick={() => openChangelog(content.changelogUrl)}>
            {t('whatsNewChangelog')}
            <ArrowUpRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
          </button>
          <button ref={primaryRef} type="button" className="kun-wn-primary" data-whats-new-primary onClick={onClose}>
            {t(fixesOnly ? 'whatsNewDone' : 'whatsNewStart')}
          </button>
        </footer>
      </section>
    </div>
  )
}
