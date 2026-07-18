import { useEffect, useMemo, useState, type FormEvent } from 'react'
import {
  searchProjectMedia,
  type MediaSearchPage,
  type MediaSearchResult
} from '../engine/media-search.js'
import type { EditorController } from './controller.js'
import { formatMessage, type Messages } from './i18n.js'
import {
  projectFrameFromSourceTime,
  type AssetProjection,
  type ItemProjection,
  type ProjectProjection
} from './model.js'
import { SpeakerDiarizationPanel } from './speaker-diarization-panel.js'

const PAGE_SIZE = 8

export function MediaIntelligencePanel(props: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { controller, messages } = props
  const project = controller.state.project!
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState<string | undefined>()
  const [history, setHistory] = useState<string[]>([])
  const visualAssets = project.assets.filter(({ kind, mediaHandleId }) =>
    Boolean(mediaHandleId) && (kind === 'video' || kind === 'image' || kind === 'animation')
  )
  const audioAssets = project.assets.filter(({ kind, mediaHandleId }) =>
    Boolean(mediaHandleId) && (kind === 'video' || kind === 'audio')
  )
  const analysisAsset = audioAssets.find(({ id }) => id === controller.state.selectedAssetId) ?? audioAssets[0]
  const audioItems = project.items.filter(({ assetId }) => audioAssets.some(({ id }) => id === assetId))
  const [referenceItemId, setReferenceItemId] = useState(audioItems[0]?.id ?? '')
  const [targetItemId, setTargetItemId] = useState(audioItems.find(({ id }) => id !== audioItems[0]?.id)?.id ?? '')
  const [syncSeed, setSyncSeed] = useState(0)
  useEffect(() => {
    if (!audioItems.some(({ id }) => id === referenceItemId)) setReferenceItemId(audioItems[0]?.id ?? '')
    if (!audioItems.some(({ id }) => id === targetItemId) || targetItemId === referenceItemId) {
      setTargetItemId(audioItems.find(({ id }) => id !== referenceItemId)?.id ?? '')
    }
  }, [audioItems, referenceItemId, targetItemId])
  const page = useMemo<MediaSearchPage | undefined>(() => {
    if (!query) return undefined
    return searchProjectMedia(project, {
      query,
      cursor,
      pageSize: PAGE_SIZE,
      spokenCompleteness: project.transcripts.some(({ truncated }) => truncated) ? 'partial' : 'complete'
    })
  }, [cursor, project, query])

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    const normalized = input.normalize('NFKC').trim()
    if (!normalized) return
    setQuery(normalized)
    setCursor(undefined)
    setHistory([])
  }

  const next = (): void => {
    if (!page?.nextCursor) return
    setHistory((values) => [...values, cursor ?? ''])
    setCursor(page.nextCursor)
  }

  const previous = (): void => {
    setHistory((values) => {
      const copy = [...values]
      const previousCursor = copy.pop()
      setCursor(previousCursor || undefined)
      return copy
    })
  }

  return (
    <section className="panel media-intelligence-panel" aria-labelledby="media-intelligence-title">
      <div className="panel-heading">
        <h2 id="media-intelligence-title">{messages.mediaSearchTitle}</h2>
      </div>
      <p className="boundary-note">{messages.mediaSearchHelp}</p>
      <form className="media-search-form" role="search" onSubmit={submit}>
        <label>
          <span>{messages.mediaSearchQuery}</span>
          <input
            type="search"
            value={input}
            maxLength={256}
            placeholder={messages.mediaSearchPlaceholder}
            onChange={(event) => setInput(event.target.value)}
          />
        </label>
        <button type="submit" disabled={!input.trim()}>{messages.mediaSearchAction}</button>
      </form>
      {page && (
        <div className="media-search-results" aria-live="polite">
          <p className="subtle">
            {formatMessage(messages.mediaSearchResultCount, { count: page.totalMatches })} · {' '}
            {page.completeness.spoken === 'complete' ? messages.searchIndexComplete : messages.searchIndexPartial}
          </p>
          {page.results.length === 0 ? <p>{messages.mediaSearchNoResults}</p> : (
            <ol>
              {page.results.map((result) => (
                <SearchResultRow
                  key={result.id}
                  controller={controller}
                  project={project}
                  result={result}
                  messages={messages}
                />
              ))}
            </ol>
          )}
          <div className="button-row media-search-pagination">
            <button type="button" className="quiet-button" disabled={history.length === 0} onClick={previous}>
              {messages.previous}
            </button>
            <button type="button" className="quiet-button" disabled={!page.nextCursor} onClick={next}>
              {messages.next}
            </button>
          </div>
        </div>
      )}
      <details className="local-analysis-controls">
        <summary>{messages.localAnalysisTitle}</summary>
        <p className="boundary-note">{messages.localAnalysisHelp}</p>
        <VisualAnalysisWorkbench
          controller={controller}
          messages={messages}
          assets={visualAssets}
        />
        <AudioAnalysisWorkbench
          controller={controller}
          messages={messages}
          asset={analysisAsset}
          items={audioItems}
          referenceItemId={referenceItemId}
          targetItemId={targetItemId}
          seed={syncSeed}
          onReferenceItemChange={setReferenceItemId}
          onTargetItemChange={setTargetItemId}
          onSeedChange={setSyncSeed}
        />
      </details>
    </section>
  )
}

function VisualAnalysisWorkbench(props: {
  controller: EditorController
  messages: Messages
  assets: AssetProjection[]
}): React.JSX.Element {
  const { controller, messages, assets } = props
  const project = controller.state.project!
  const capability = controller.state.visualProvisioning
  const [assetId, setAssetId] = useState(
    assets.find(({ id }) => id === controller.state.selectedAssetId)?.id ?? assets[0]?.id ?? ''
  )
  const [query, setQuery] = useState('')
  const [submittedQuery, setSubmittedQuery] = useState('')
  useEffect(() => {
    if (!assets.some(({ id }) => id === assetId)) {
      setAssetId(assets.find(({ id }) => id === controller.state.selectedAssetId)?.id ?? assets[0]?.id ?? '')
    }
  }, [assetId, assets, controller.state.selectedAssetId])
  const record = [...controller.state.audioAnalysisRecords]
    .reverse()
    .find((candidate) =>
      candidate.kind === 'visual-index' && candidate.assetId === assetId && candidate.currentGrant !== false
    )
  const page = controller.state.visualMomentPage?.indexId === record?.id
    ? controller.state.visualMomentPage
    : undefined
  const runSearch = (event: FormEvent): void => {
    event.preventDefault()
    const normalized = query.normalize('NFKC').trim()
    if (!record || !normalized) return
    setSubmittedQuery(normalized)
    void controller.searchVisualMoments(record.id, normalized, 0)
  }
  const visualResults: MediaSearchResult[] = page?.results.map((moment) => {
    const asset = project.assets.find(({ id }) => id === moment.assetId)
    return {
      id: moment.id,
      assetId: moment.assetId,
      assetName: asset?.name ?? moment.assetId,
      evidenceKind: 'visual',
      sourceRange: moment.sourceRange,
      label: asset?.name ?? moment.assetId,
      excerpt: formatMessage(messages.visualSearchResult, {
        score: Math.round(moment.score * 100),
        time: formatSourceTime(moment.representativeUs)
      }),
      score: moment.score,
      scoreSemantics: 'uncalibrated',
      indexCompleteness: page.completeness,
      evidenceId: moment.sampleId,
      actions: {
        preview: { kind: 'preview-source-range', range: moment.sourceRange },
        insert: { kind: 'insert-source-range', range: moment.sourceRange }
      }
    }
  }) ?? []
  return (
    <section className="audio-analysis-section visual-analysis-section" aria-label={messages.visualModelStatus}>
      <div className="analysis-section-heading">
        <div>
          <strong>{messages.visualModelStatus}</strong>
          <small>{capability?.state === 'ready' ? messages.visualModelReady : messages.visualModelNotReady}</small>
        </div>
        <button type="button" className="quiet-button" onClick={() => void controller.refreshMediaIntelligence()}>
          {messages.visualModelCheck}
        </button>
      </div>
      <label className="analysis-opt-in">
        <input
          type="checkbox"
          checked={capability?.optIn ?? false}
          disabled={controller.state.busy}
          onChange={(event) => void controller.setVisualOptIn(event.target.checked)}
        />
        <span>{messages.visualModelOptIn}</span>
      </label>
      <p className="subtle">{messages.visualModelVerification}</p>
      {capability?.state === 'ready' && capability.verification.sourceVerified && capability.packageSource && (
        <p className="subtle" data-visual-package-source={capability.packageSource}>
          {capability.packageSource === 'bundled'
            ? messages.visualModelBundledSource
            : messages.visualModelDownloadedSource}
        </p>
      )}
      {capability?.model && (
        <p className="subtle">
          {capability.model.modelId} {capability.model.modelVersion} · {capability.model.embeddingDimensions}D
        </p>
      )}
      {capability?.state !== 'ready' && capability?.optIn && (
        <div className="notice notice-warning" data-visual-capability={capability.code}>
          <p>{capability.remediation || messages.visualModelUnavailable}</p>
          {capability.installSupported && (
            <button type="button" disabled={controller.state.busy} onClick={() => void controller.requestVisualModelInstall()}>
              {messages.visualModelInstall}
            </button>
          )}
        </div>
      )}
      <label>
        <span>{messages.visualIndexAsset}</span>
        <select value={assetId} onChange={(event) => setAssetId(event.target.value)}>
          <option value="">—</option>
          {assets.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
      </label>
      {!assetId ? <p className="notice notice-warning">{messages.visualIndexNoAsset}</p> : (
        <button
          type="button"
          disabled={capability?.state !== 'ready' || controller.state.busy}
          onClick={() => void controller.indexVisual(assetId)}
        >
          {messages.visualIndexRun}
        </button>
      )}
      {record && (
        <p className="subtle">
          {formatMessage(messages.visualIndexSummary, {
            indexed: record.indexedSampleCount ?? 0,
            planned: record.plannedSampleCount ?? 0,
            omitted: record.omittedSampleCount ?? 0
          })}
        </p>
      )}
      {record && capability?.state === 'ready' && (
        <>
          <form className="media-search-form" role="search" onSubmit={runSearch}>
            <label>
              <span>{messages.visualSearchQuery}</span>
              <input
                type="search"
                value={query}
                maxLength={256}
                placeholder={messages.visualSearchPlaceholder}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <button type="submit" disabled={!query.trim()}>{messages.visualSearchAction}</button>
          </form>
          <p className="boundary-note">{messages.visualSearchBoundary}</p>
          {page && (
            <div className="media-search-results" aria-live="polite">
              <p className="subtle">
                {formatMessage(messages.mediaSearchResultCount, { count: page.totalMatches })} · {' '}
                {page.completeness === 'complete' ? messages.searchIndexComplete : messages.searchIndexPartial}
              </p>
              {visualResults.length === 0 ? <p>{messages.mediaSearchNoResults}</p> : (
                <ol>
                  {visualResults.map((result) => (
                    <SearchResultRow
                      key={result.id}
                      controller={controller}
                      project={project}
                      result={result}
                      messages={messages}
                    />
                  ))}
                </ol>
              )}
              <div className="button-row media-search-pagination">
                <button
                  type="button"
                  className="quiet-button"
                  disabled={page.offset === 0}
                  onClick={() => void controller.searchVisualMoments(
                    record.id,
                    submittedQuery,
                    Math.max(0, page.offset - 20)
                  )}
                >
                  {messages.previous}
                </button>
                <button
                  type="button"
                  className="quiet-button"
                  disabled={page.nextOffset === undefined}
                  onClick={() => void controller.searchVisualMoments(record.id, submittedQuery, page.nextOffset)}
                >
                  {messages.next}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </section>
  )
}

function AudioAnalysisWorkbench(props: {
  controller: EditorController
  messages: Messages
  asset?: AssetProjection
  items: ItemProjection[]
  referenceItemId: string
  targetItemId: string
  seed: number
  onReferenceItemChange(value: string): void
  onTargetItemChange(value: string): void
  onSeedChange(value: number): void
}): React.JSX.Element {
  const {
    controller,
    messages,
    asset,
    items,
    referenceItemId,
    targetItemId,
    seed,
    onReferenceItemChange,
    onTargetItemChange,
    onSeedChange
  } = props
  const project = controller.state.project!
  const capabilities = controller.state.audioAnalysisCapabilities?.analyses ?? []
  const capability = (kind: 'silence' | 'beat-grid' | 'sync-features') =>
    capabilities.find(({ analysis }) => analysis === kind)
  const vadCapability = capability('silence')
  const beatCapability = capability('beat-grid')
  const syncCapability = capability('sync-features')
  const denoiseCapability = controller.state.denoiseMetadataCapability
  const localSpeakerReady = controller.state.speakerAdapters.some(({ descriptor, outcome }) =>
    descriptor.execution === 'local-model' && outcome === 'ready'
  )
  const speakerImportReady = controller.state.speakerAdapters.some(({ descriptor, outcome }) =>
    descriptor.execution === 'import' && outcome === 'ready'
  )
  const vadRecord = [...controller.state.audioAnalysisRecords]
    .reverse()
    .find(({ kind, assetId, currentGrant }) =>
      kind === 'vad' && assetId === asset?.id && currentGrant !== false
    )
  const vadEvidence = controller.state.mediaIntelligenceEvidence?.kind === 'vad' &&
    controller.state.mediaIntelligenceEvidence.recordId === vadRecord?.id
    ? controller.state.mediaIntelligenceEvidence
    : undefined
  const beatRecord = [...controller.state.audioAnalysisRecords]
    .reverse()
    .find(({ kind, assetId, currentGrant }) =>
      kind === 'beat-grid' && assetId === asset?.id && currentGrant !== false
    )
  const denoiseRecord = [...controller.state.audioAnalysisRecords]
    .reverse()
    .find(({ kind, assetId, currentGrant }) =>
      kind === 'denoise-metadata' && assetId === asset?.id && currentGrant !== false
    )
  const progress = controller.state.mediaIntelligenceOperations
    .filter(({ projectRevision }) => projectRevision === project.currentRevision)
    .slice(0, 8)
  const syncPreview = controller.state.audioSyncPreview
  const previewSuggestion = async (entry: Record<string, string | number | boolean | string[]>): Promise<void> => {
    if (!asset || typeof entry.startUs !== 'number') return
    const startUs = entry.startUs
    await controller.openAsset(asset.id)
    const item = project.items.find((candidate) =>
      candidate.assetId === asset.id &&
      candidate.sourceStartUs <= startUs &&
      startUs < candidate.sourceEndUs
    )
    if (item) {
      controller.seek(projectFrameFromSourceTime(project, { item }, startUs / 1_000_000))
    }
  }
  return (
    <div className="audio-analysis-workbench">
      <p className="subtle">{messages.audioAnalysisLocalBoundary}</p>
      <div className="button-row">
        <button type="button" className="quiet-button" onClick={() => void controller.refreshMediaIntelligence()}>
          {messages.audioAnalysisRefresh}
        </button>
      </div>
      <ul className="analysis-capability-list" aria-label={messages.localAnalysisTitle}>
        <CapabilityRow label={messages.localVadLabel} value={vadCapability} messages={messages} />
        <li>
          <span>{messages.localSpeakerLabel}</span>
          <strong>
            {localSpeakerReady
              ? messages.audioAnalysisReady
              : speakerImportReady ? messages.speakerImportAdapterReady : messages.audioAnalysisUnavailable}
          </strong>
        </li>
        <CapabilityRow label={messages.localBeatLabel} value={beatCapability} messages={messages} />
        <li data-analysis-capability="denoise-metadata">
          <span>{messages.localDenoiseLabel}</span>
          <strong>
            {denoiseCapability?.outcome === 'ready'
              ? messages.audioAnalysisReady
              : messages.audioAnalysisUnavailable}
          </strong>
        </li>
        <CapabilityRow label={messages.localSyncLabel} value={syncCapability} messages={messages} />
      </ul>
      {!asset ? <p className="notice notice-warning">{messages.audioAnalysisNoAsset}</p> : (
        <section className="audio-analysis-section" aria-label={messages.localVadLabel}>
          <div className="analysis-section-heading">
            <div><strong>{messages.localVadLabel}</strong><small>{asset.name}</small></div>
            <button
              type="button"
              disabled={!vadCapability?.available || controller.state.busy}
              onClick={() => void controller.analyzeVad(asset.id)}
            >
              {messages.audioAnalysisRunVad}
            </button>
          </div>
          {vadRecord ? (
            <>
              <p className="subtle">
                {formatMessage(messages.audioAnalysisSafeSuggestions, {
                  safe: vadRecord.safeSuggestionCount ?? 0,
                  total: vadRecord.silenceCount ?? 0,
                  threshold: Math.round((vadRecord.suggestionConfidenceThreshold ?? 0) * 100)
                })}
              </p>
              {vadEvidence && vadEvidence.evidence.length > 0 && (
                <ol className="analysis-evidence-list">
                  {vadEvidence.evidence.slice(0, 12).map((entry, index) => (
                    <li key={String(entry.suggestionId ?? index)}>
                      <span>{formatEvidenceRange(entry)}</span>
                      <strong>{Math.round(Number(entry.confidence ?? 0) * 100)}%</strong>
                      <button type="button" className="quiet-button" onClick={() => void previewSuggestion(entry)}>
                        {messages.audioAnalysisPreviewSuggestion}
                      </button>
                    </li>
                  ))}
                </ol>
              )}
              <button
                type="button"
                disabled={(vadRecord.safeSuggestionCount ?? 0) < 1 || controller.state.busy}
                onClick={() => void controller.applyVadAnalysis(vadRecord.id)}
              >
                {messages.audioAnalysisApplySilence}
              </button>
            </>
          ) : <p className="subtle">{messages.audioAnalysisNoEvidence}</p>}
        </section>
      )}
      <SpeakerDiarizationPanel controller={controller} messages={messages} asset={asset} />
      <section className="audio-analysis-section" aria-label={messages.localBeatLabel}>
        <div className="analysis-section-heading">
          <div><strong>{messages.localBeatLabel}</strong>{asset && <small>{asset.name}</small>}</div>
          <button
            type="button"
            disabled={!asset || !beatCapability?.available || controller.state.busy}
            onClick={() => asset && void controller.analyzeBeats(asset.id)}
          >
            {messages.audioAnalysisRunBeats}
          </button>
        </div>
        {!beatCapability?.available ? (
          <p className="notice notice-warning" data-analysis-unavailable="beat-grid">
            {messages.audioBeatUnavailable}
          </p>
        ) : beatRecord ? (
          <p className="subtle">
            {beatRecord.markerCount ?? 0} {messages.localBeatLabel}
            {beatRecord.tempoBpm === undefined ? '' : ` · ${beatRecord.tempoBpm} BPM`}
          </p>
        ) : <p className="subtle">{messages.audioAnalysisNoEvidence}</p>}
      </section>
      <section className="audio-analysis-section" aria-label={messages.localDenoiseLabel}>
        <div className="analysis-section-heading">
          <div><strong>{messages.localDenoiseLabel}</strong>{asset && <small>{asset.name}</small>}</div>
          <button
            type="button"
            disabled={!asset || denoiseCapability?.outcome !== 'ready' || controller.state.busy}
            onClick={() => asset && void controller.analyzeDenoiseMetadata(asset.id)}
          >
            {messages.audioAnalysisRunDenoise}
          </button>
        </div>
        {denoiseCapability?.outcome !== 'ready' ? (
          <p className="notice notice-warning" data-analysis-unavailable="denoise-metadata">
            {messages.audioDenoiseUnavailable}
          </p>
        ) : denoiseRecord?.noiseProfile && denoiseRecord.recommendation ? (
          <div className="denoise-metadata-summary" data-denoise-status={denoiseRecord.status}>
            <p className="subtle">
              {formatMessage(messages.audioDenoiseSummary, {
                floor: denoiseRecord.noiseProfile.levels.noiseFloorDbfs,
                snr: denoiseRecord.noiseProfile.levels.estimatedSnrDb,
                reduction: denoiseRecord.recommendation.reductionDb,
                confidence: Math.round(denoiseRecord.recommendation.confidence * 100)
              })}
            </p>
            {denoiseRecord.status === 'low-confidence' && (
              <p className="notice notice-warning">{messages.audioDenoiseLowConfidence}</p>
            )}
            <p className="boundary-note">{messages.audioDenoiseMetadataOnly}</p>
          </div>
        ) : <p className="subtle">{messages.audioAnalysisNoEvidence}</p>}
      </section>
      <section className="audio-analysis-section" aria-label={messages.localSyncLabel}>
        <strong>{messages.localSyncLabel}</strong>
        <div className="audio-sync-grid">
          <label>
            <span>{messages.audioSyncReference}</span>
            <select value={referenceItemId} onChange={(event) => onReferenceItemChange(event.target.value)}>
              <option value="">—</option>
              {items.map((item) => <option key={item.id} value={item.id}>{clipLabel(project, item)}</option>)}
            </select>
          </label>
          <label>
            <span>{messages.audioSyncTarget}</span>
            <select value={targetItemId} onChange={(event) => onTargetItemChange(event.target.value)}>
              <option value="">—</option>
              {items.map((item) => <option key={item.id} value={item.id}>{clipLabel(project, item)}</option>)}
            </select>
          </label>
          <label>
            <span>{messages.audioSyncSeed}</span>
            <input
              type="number"
              min={0}
              max={0x7fffffff}
              step={1}
              value={seed}
              onChange={(event) => onSeedChange(Math.max(0, Math.min(0x7fffffff, Math.floor(Number(event.target.value) || 0))))}
            />
          </label>
        </div>
        <button
          type="button"
          disabled={!syncCapability?.available || !referenceItemId || !targetItemId || referenceItemId === targetItemId || controller.state.busy}
          onClick={() => void controller.previewAudioSync(referenceItemId, targetItemId, seed)}
        >
          {messages.audioSyncPreviewAction}
        </button>
        {syncPreview && (
          <div className={`audio-sync-preview ${syncPreview.outcome}`} aria-live="polite">
            <p>{formatMessage(messages.audioSyncPreviewReady, {
              delta: syncPreview.deltaFrames,
              confidence: Math.round(syncPreview.confidence * 100),
              outcome: syncPreview.outcome === 'ready' ? messages.audioSyncQualified : messages.audioSyncUncertain
            })}</p>
            <button
              type="button"
              disabled={syncPreview.outcome !== 'ready' || controller.state.busy}
              onClick={() => void controller.applyAudioSync(
                syncPreview.analysisId,
                syncPreview.referenceItemId,
                syncPreview.targetItemId
              )}
            >
              {messages.audioSyncApplyAction}
            </button>
          </div>
        )}
      </section>
      {progress.length > 0 && (
        <div className="analysis-progress-list" aria-live="polite">
          {progress.map((operation) => {
            const value = Math.round(operation.completed / Math.max(1, operation.total) * 100)
            const running = operation.status === 'queued' || operation.status === 'running'
            return (
              <div key={operation.operationId}>
                <progress max={operation.total} value={operation.completed} />
                <span>{formatMessage(messages.audioAnalysisProgress, {
                  kind: analysisKindLabel(operation.kind, messages),
                  value,
                  status: analysisStatusLabel(operation.status, messages)
                })}</span>
                {running && (
                  <button type="button" className="quiet-button" onClick={() => void controller.cancelMediaIntelligence(operation.operationId)}>
                    {messages.audioAnalysisCancel}
                  </button>
                )}
                {operation.error && <small role="alert">{operation.error.message}</small>}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

function CapabilityRow(props: {
  label: string
  value?: { available: boolean; algorithm?: string; algorithmVersion?: string }
  messages: Messages
}): React.JSX.Element {
  const { label, value, messages } = props
  return (
    <li>
      <span>{label}</span>
      <strong>{value?.available ? messages.audioAnalysisReady : messages.audioAnalysisUnavailable}</strong>
      {value?.available && value.algorithm && (
        <small>{value.algorithm}{value.algorithmVersion ? ` ${value.algorithmVersion}` : ''}</small>
      )}
    </li>
  )
}

function clipLabel(project: ProjectProjection, item: ItemProjection): string {
  const asset = project.assets.find(({ id }) => id === item.assetId)
  return `${asset?.name ?? item.assetId} · ${item.id}`
}

function formatEvidenceRange(entry: Record<string, string | number | boolean | string[]>): string {
  const startUs = typeof entry.startUs === 'number' ? entry.startUs : 0
  const endUs = typeof entry.endUs === 'number' ? entry.endUs : startUs
  return `${formatSourceTime(startUs)}–${formatSourceTime(endUs)}`
}

function analysisKindLabel(kind: string, messages: Messages): string {
  if (kind === 'visual-index') return messages.visualModelStatus
  if (kind === 'vad') return messages.localVadLabel
  if (kind === 'beats') return messages.localBeatLabel
  if (kind === 'audio-sync') return messages.localSyncLabel
  if (kind === 'speaker') return messages.localSpeakerLabel
  return kind
}

function analysisStatusLabel(status: string, messages: Messages): string {
  if (status === 'queued') return messages.derivedStateQueued
  if (status === 'running') return messages.derivedStateRunning
  if (status === 'ready') return messages.derivedStateReady
  if (status === 'failed') return messages.derivedStateFailed
  if (status === 'cancelled') return messages.derivedStateCancelled
  return status
}

function SearchResultRow(props: {
  controller: EditorController
  project: ProjectProjection
  result: MediaSearchResult
  messages: Messages
}): React.JSX.Element {
  const { controller, project, result, messages } = props
  const asset = project.assets.find(({ id }) => id === result.assetId)
  const targetTrackKind = asset?.kind === 'audio' ? 'audio' : 'video'
  const track = project.tracks.find(({ kind }) => kind === targetTrackKind)
  const preview = async (): Promise<void> => {
    await controller.openAsset(result.assetId)
    const item = project.items.find((candidate) =>
      candidate.assetId === result.assetId &&
      candidate.sourceStartUs <= result.sourceRange.startUs &&
      result.sourceRange.startUs < candidate.sourceEndUs
    )
    if (item) {
      controller.seek(projectFrameFromSourceTime(
        project,
        { item },
        result.sourceRange.startUs / 1_000_000
      ))
    }
  }
  const insert = async (): Promise<void> => {
    if (!asset || !track) return
    const item = insertionItem(project, result, track.id, asset.kind, controller.state.playheadFrame)
    await controller.applyOperations(
      [{ type: 'add-item', item }],
      formatMessage(messages.searchInsertSummary, { name: asset.name })
    )
  }
  return (
    <li className="media-search-result">
      <div>
        <strong>{result.assetName}</strong>
        <span className="evidence-badge">
          {result.evidenceKind === 'spoken'
            ? messages.searchEvidenceSpoken
            : result.evidenceKind === 'visual'
              ? messages.searchEvidenceVisual
              : messages.searchEvidenceFilename}
        </span>
      </div>
      <p>{result.excerpt}</p>
      <small>
        {formatSourceTime(result.sourceRange.startUs)}–{formatSourceTime(result.sourceRange.endUs)} · {' '}
        {result.scoreSemantics}
      </small>
      <div className="button-row">
        <button type="button" className="quiet-button" onClick={() => void preview()}>
          {messages.previewSourceRange}
        </button>
        <button type="button" disabled={!track || controller.state.busy} onClick={() => void insert()}>
          {messages.insertSourceRange}
        </button>
      </div>
    </li>
  )
}

function insertionItem(
  project: ProjectProjection,
  result: MediaSearchResult,
  trackId: string,
  assetKind: AssetProjection['kind'],
  timelineStartFrame: number
): ItemProjection {
  const durationUs = result.sourceRange.endUs - result.sourceRange.startUs
  const durationFrames = Math.max(1, Math.round(
    durationUs * project.fps.numerator / (1_000_000 * project.fps.denominator)
  ))
  return {
    id: `search-insert-${Date.now().toString(36)}`,
    assetId: result.assetId,
    trackId,
    timelineStartFrame,
    durationFrames,
    sourceStartUs: result.sourceRange.startUs,
    sourceEndUs: result.sourceRange.endUs,
    speed: { numerator: 1, denominator: 1 },
    transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
    opacity: 1,
    fadeInFrames: 0,
    fadeOutFrames: 0,
    ...(assetKind === 'audio' ? { volume: 1 } : {})
  }
}

function formatSourceTime(valueUs: number): string {
  const seconds = valueUs / 1_000_000
  const minutes = Math.floor(seconds / 60)
  return `${minutes}:${(seconds - minutes * 60).toFixed(2).padStart(5, '0')}`
}
