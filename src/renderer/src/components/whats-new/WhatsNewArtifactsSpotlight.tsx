import { useId, type CSSProperties, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowRight, FileText, Image as ImageIcon, Layers, Palette, Presentation, Search, Shapes, Table2, type LucideIcon } from 'lucide-react'
import { LIBRARY_ARTIFACT_KIND_STYLE, LIBRARY_ARTIFACT_KINDS, type LibraryArtifactKind } from '../../artifacts/artifact-types'
import { ARTIFACT_KIND_LABEL_KEYS } from '../../artifacts/artifact-view-model'
import './whats-new-spotlight.css'

// Mirrors ARTIFACT_KIND_ICONS without pulling the card's preview loaders into the dialog chunk.
const KIND_ICONS: Record<LibraryArtifactKind, LucideIcon> = {
  design: Palette,
  doc: FileText,
  slides: Presentation,
  sheet: Table2,
  board: Shapes,
  image: ImageIcon
}

/** A small drawing of the Artifacts page: one tile per kind, filed in as the card opens. */
function ArtifactsPreview(): ReactElement {
  const { t } = useTranslation('common')
  return (
    <div className="kun-wn-ap" aria-hidden="true">
      <div className="kun-wn-ap-bar">
        <Layers className="h-3 w-3" strokeWidth={2} />
        <span className="kun-wn-ap-title">{t('artifactsNav')}</span>
        <span className="kun-wn-ap-search">
          <Search className="h-2 w-2" strokeWidth={2.4} />
        </span>
      </div>
      <div className="kun-wn-ap-grid">
        {LIBRARY_ARTIFACT_KINDS.map((kind, index) => {
          const Icon = KIND_ICONS[kind]
          return (
            <span key={kind} className="kun-wn-ap-tile" style={{ '--i': index } as CSSProperties}>
              <span className={`kun-wn-ap-thumb ${LIBRARY_ARTIFACT_KIND_STYLE[kind].tile}`}>
                <Icon className="h-3.5 w-3.5" strokeWidth={1.9} />
              </span>
              <span className="kun-wn-ap-label">{t(ARTIFACT_KIND_LABEL_KEYS[kind])}</span>
            </span>
          )
        })}
      </div>
    </div>
  )
}

/**
 * 0.4.2's card: the Artifacts library collects what Kun made across projects.
 * The action closes the dialog and opens the real page.
 */
export function WhatsNewArtifactsSpotlight({ onOpen }: { onOpen: () => void }): ReactElement {
  const { t } = useTranslation('common')
  const titleId = useId()
  return (
    <section className="kun-wn-spotlight" aria-labelledby={titleId} data-whats-new-spotlight="artifacts">
      <ArtifactsPreview />
      <div className="kun-wn-spotlight-text">
        <span className="kun-wn-spotlight-tag">
          <Layers className="h-3 w-3" strokeWidth={2} aria-hidden />
          {t('whatsNewArtifactsTag')}
        </span>
        <h3 id={titleId} className="kun-wn-spotlight-title">{t('whatsNewArtifactsTitle')}</h3>
        <p className="kun-wn-spotlight-body">{t('whatsNewArtifactsBody')}</p>
        <button type="button" className="kun-wn-spotlight-switch kun-wn-spotlight-action" data-whats-new-open-artifacts onClick={onOpen}>
          <span>{t('whatsNewArtifactsOpen')}</span>
          <ArrowRight className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
        </button>
        <span className="kun-wn-spotlight-where">{t('whatsNewArtifactsWhere')}</span>
      </div>
    </section>
  )
}
