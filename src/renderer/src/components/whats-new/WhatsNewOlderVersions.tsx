import { useState, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import type { ReleaseNotesSummary } from '@shared/release-notes-summary'

/** Titles shown when a skipped version's row is expanded. */
const MAX_TITLES = 8

function versionTitles(summary: ReleaseNotesSummary): string[] {
  return [...summary.features, ...summary.fixes]
    .map((item) => item.title || item.body)
    .filter(Boolean)
}

/** Versions skipped in one update: one collapsed row each, newest first. */
export function WhatsNewOlderVersions({ versions }: { versions: ReleaseNotesSummary[] }): ReactElement {
  const { t } = useTranslation('common')
  const [expanded, setExpanded] = useState<string | null>(null)
  return (
    <div className="kun-wn-older">
      <div className="kun-wn-label">{t('whatsNewOlder')}</div>
      {versions.map((summary) => {
        const titles = versionTitles(summary)
        const isOpen = expanded === summary.version
        const preview = summary.features.filter((item) => item.title).slice(0, 2).map((item) => item.title)
        return (
          <div key={summary.version}>
            <button
              type="button"
              className="kun-wn-disclosure"
              aria-expanded={isOpen}
              onClick={() => setExpanded(isOpen ? null : summary.version)}
            >
              <span className="kun-wn-older-version">{summary.version}</span>
              <span className="kun-wn-disclosure-label kun-wn-older-preview">
                {preview.length ? preview.join(t('whatsNewListSeparator')) : t('whatsNewFixes')}
              </span>
              <span className="kun-wn-count">{titles.length}</span>
              <ChevronDown className="kun-wn-chevron h-4 w-4" strokeWidth={2} aria-hidden />
            </button>
            {isOpen ? (
              <ul className="kun-wn-fix-list">
                {titles.slice(0, MAX_TITLES).map((title, index) => <li key={`${title}-${index}`}>{title}</li>)}
                {titles.length > MAX_TITLES ? <li className="kun-wn-more">…</li> : null}
              </ul>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}
