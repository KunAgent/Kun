import { useMemo, useState } from 'react'
import type { EditorController } from './controller.js'
import { formatMessage, type Messages } from './i18n.js'
import type { AssetProjection } from './model.js'

export function SpeakerDiarizationPanel(props: {
  controller: EditorController
  messages: Messages
  asset?: AssetProjection
}): React.JSX.Element {
  const { controller, messages, asset } = props
  const [document, setDocument] = useState('')
  const localAdapter = controller.state.speakerAdapters.find(({ descriptor }) =>
    descriptor.execution === 'local-model'
  )
  const importAdapter = controller.state.speakerAdapters.find(({ descriptor }) =>
    descriptor.execution === 'import'
  )
  const record = useMemo(() => [...controller.state.audioAnalysisRecords]
    .reverse()
    .find((candidate) =>
      candidate.kind === 'speaker-diarization' &&
      candidate.assetId === asset?.id &&
      candidate.currentGrant !== false
    ), [asset?.id, controller.state.audioAnalysisRecords])
  const evidence = controller.state.mediaIntelligenceEvidence?.kind === 'speaker-diarization' &&
    controller.state.mediaIntelligenceEvidence.recordId === record?.id
    ? controller.state.mediaIntelligenceEvidence
    : undefined
  const plan = controller.state.speakerAttributionPlan?.analysisId === record?.id
    ? controller.state.speakerAttributionPlan
    : undefined
  const identities = controller.state.speakerIdentities

  return (
    <section className="audio-analysis-section speaker-diarization-section" aria-labelledby="speaker-diarization-title">
      <div className="analysis-section-heading">
        <div>
          <strong id="speaker-diarization-title">{messages.speakerDiarizationTitle}</strong>
          {asset && <small>{asset.name}</small>}
        </div>
      </div>
      <p className="boundary-note">{messages.speakerDiarizationHelp}</p>
      <ul className="speaker-adapter-list" aria-label={messages.speakerDiarizationTitle}>
        <li data-speaker-adapter="local-model">
          <span>{messages.localSpeakerLabel}</span>
          <strong>{localAdapter?.outcome === 'ready' ? messages.audioAnalysisReady : messages.audioAnalysisUnavailable}</strong>
          {localAdapter?.outcome !== 'ready' && <small>{messages.speakerLocalUnavailable}</small>}
        </li>
        <li data-speaker-adapter="import">
          <span>{messages.speakerImportDocument}</span>
          <strong>{importAdapter?.outcome === 'ready' ? messages.speakerImportAdapterReady : messages.audioAnalysisUnavailable}</strong>
        </li>
      </ul>
      <label className="speaker-import-field">
        <span>{messages.speakerImportDocument}</span>
        <textarea
          rows={7}
          maxLength={2_097_152}
          spellCheck={false}
          value={document}
          placeholder={messages.speakerImportPlaceholder}
          onChange={(event) => setDocument(event.target.value)}
        />
      </label>
      <button
        type="button"
        disabled={!asset || !document.trim() || importAdapter?.outcome !== 'ready' || controller.state.busy}
        onClick={() => asset && void controller.importSpeakerEvidence(asset.id, document)}
      >
        {messages.speakerImportAction}
      </button>
      <div className="speaker-registry" aria-live="polite">
        <strong>{formatMessage(messages.speakerRegistrySummary, { count: identities.length })}</strong>
        {identities.length === 0 ? <p className="subtle">{messages.speakerRegistryEmpty}</p> : (
          <ul>
            {identities.slice(0, 32).map((identity) => (
              <li key={identity.id}>
                <span>{identity.label}</span>
                {identity.aliases.length > 0 && <small>{identity.aliases.join(' · ')}</small>}
              </li>
            ))}
          </ul>
        )}
      </div>
      {record ? (
        <div className="speaker-evidence" aria-live="polite">
          <p className="subtle">
            {formatMessage(messages.speakerEvidenceSummary, {
              total: record.turnCount ?? 0,
              identified: record.identifiedTurnCount ?? 0,
              uncertain: record.uncertainTurnCount ?? 0
            })}
          </p>
          {evidence && evidence.evidence.length > 0 && (
            <ol className="analysis-evidence-list speaker-turn-list">
              {evidence.evidence.slice(0, 24).map((turn, index) => (
                <li key={String(turn.id ?? index)}>
                  <span>{formatEvidenceRange(turn)}</span>
                  <strong>{speakerTurnLabel(turn, messages)}</strong>
                  <small>{Math.round(Number(turn.confidence ?? 0) * 100)}%</small>
                </li>
              ))}
            </ol>
          )}
          <div className="button-row">
            <button
              type="button"
              className="quiet-button"
              disabled={controller.state.busy}
              onClick={() => void controller.previewSpeakerAttribution(record.id)}
            >
              {messages.speakerPreviewAction}
            </button>
            <button
              type="button"
              disabled={!plan || plan.transcriptSegmentCount + plan.captionCount === 0 || controller.state.busy}
              onClick={() => void controller.applySpeakerAttribution(record.id)}
            >
              {messages.speakerApplyAction}
            </button>
          </div>
          {plan && (
            <div className="speaker-attribution-plan">
              <p>{formatMessage(messages.speakerPlanSummary, {
                transcripts: plan.transcriptSegmentCount,
                captions: plan.captionCount,
                identified: plan.identifiedCount,
                uncertain: plan.uncertainCount
              })}</p>
              {plan.warnings.length > 0 && (
                <details>
                  <summary>{messages.speakerAttributionWarnings}</summary>
                  <ul>{plan.warnings.map((warning, index) => <li key={`${index}:${warning}`}>{warning}</li>)}</ul>
                </details>
              )}
            </div>
          )}
        </div>
      ) : <p className="subtle">{messages.speakerNoEvidence}</p>}
    </section>
  )
}

function speakerTurnLabel(
  turn: Record<string, string | number | boolean | string[]>,
  messages: Messages
): string {
  if (turn.status === 'identified' && typeof turn.speakerLabel === 'string') return turn.speakerLabel
  if (turn.status === 'overlap') return messages.speakerStatusOverlap
  if (turn.status === 'unknown') return messages.speakerStatusUnknown
  return messages.speakerStatusUncertain
}

function formatEvidenceRange(entry: Record<string, string | number | boolean | string[]>): string {
  const startUs = typeof entry.startUs === 'number' ? entry.startUs : 0
  const endUs = typeof entry.endUs === 'number' ? entry.endUs : startUs
  return `${formatSourceTime(startUs)}–${formatSourceTime(endUs)}`
}

function formatSourceTime(valueUs: number): string {
  const seconds = valueUs / 1_000_000
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}
