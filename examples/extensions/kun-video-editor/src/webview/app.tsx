import type { GeneratedArtifact, JobSnapshot, MediaCapabilityFeature } from '@kun/extension-api'
import { replaceAsciiControlCharacters } from '../text-safety.js'
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent as ReactKeyboardEvent,
  type PropsWithChildren,
  type ReactNode,
  type CSSProperties
} from 'react'
import {
  artifactUsesPlayer,
  artifactsForJobs,
  type EditorController,
  type PreviewResource
} from './controller.js'
import { formatMessage, messagesFor, type Messages } from './i18n.js'
import { GenerationPanel } from './generation-panel.js'
import { MediaIntelligencePanel } from './media-intelligence.js'
import { MulticamPanel, type MulticamPanelMessages } from './multicam-panel.js'
import { SpatialTimeline, linkedMoveOperations, linkedProjectItemIds, linkedTrimOperations } from './spatial-timeline.js'
import {
  VIEW_LIMITS,
  activeTranscriptSegment,
  frameToSeconds,
  projectFrameFromSourceTime,
  proofIsStale,
  timelineSourceAtFrame,
  type AssetProjection,
  type CaptionProjection,
  type DerivedMediaKind,
  type DerivedMediaRecordProjection,
  type EditorNotice,
  type EditorState,
  type EditorWorkspace,
  type ItemProjection,
  type InterchangeLossManifestProjection,
  type OtioExportTicket,
  type ProjectPackageTicket,
  type ProjectProjection,
  type RenderTicket,
  type RevisionProjection,
  type SpeakerAttributionProjection,
  type TimelineOperation,
  type TimelineSource,
  type TrackProjection
} from './model.js'

const HOST_THEME_TOKEN_VARIABLES: Readonly<Record<string, readonly string[]>> = Object.freeze({
  background: ['--bg', '--app-glow'],
  sidebarBackground: ['--surface-raised', '--surface-soft', '--control', '--control-hover'],
  surface: ['--surface'],
  foreground: ['--text'],
  mutedForeground: ['--muted'],
  border: ['--border', '--border-strong'],
  accent: ['--accent', '--accent-strong'],
  focusRing: ['--focus'],
  success: ['--green'],
  danger: ['--danger']
})

export type VideoEditorWorkbenchProps = {
  controller: EditorController
}

const SIDEBAR_BREAKPOINT_QUERY = '(max-width: 1180px)'

type WorkbenchIconName =
  | 'script'
  | 'clips'
  | 'timeline'
  | 'properties'
  | 'output'
  | 'project'
  | 'playhead'
  | 'proof'
  | 'back'
  | 'play'
  | 'pause'
  | 'forward'
  | 'split'
  | 'delete'

function WorkbenchIcon({ name }: { name: WorkbenchIconName }): React.JSX.Element {
  const paths: Readonly<Record<WorkbenchIconName, ReactNode>> = {
    script: <><path d="M5 4.5h10v15H5z" /><path d="M8 8h4M8 11h5M8 14h3" /></>,
    clips: <><rect x="3.5" y="5" width="17" height="14" rx="2" /><path d="m8 13 2.5-2.5L15 15l2-2 3.5 3.5M8 9h.01" /></>,
    timeline: <><path d="M4 7h16M4 12h16M4 17h16" /><path d="M8 4v6M15 9v6M11 14v6" /></>,
    properties: <><path d="M4 7h9M17 7h3M4 17h3M11 17h9M4 12h3M11 12h9" /><circle cx="15" cy="7" r="2" /><circle cx="9" cy="12" r="2" /><circle cx="9" cy="17" r="2" /></>,
    output: <><path d="M12 4v11M8 8l4-4 4 4" /><path d="M5 13v6h14v-6" /></>,
    project: <><path d="M4 6h6l2 2h8v10H4z" /></>,
    playhead: <><circle cx="12" cy="12" r="8" /><path d="M12 8v4l3 2" /></>,
    proof: <><path d="m5 12 4 4L19 6" /></>,
    back: <><path d="m11 7-5 5 5 5M18 7v10" /></>,
    play: <><path d="m9 7 8 5-8 5z" /></>,
    pause: <><path d="M9 7v10M15 7v10" /></>,
    forward: <><path d="m13 7 5 5-5 5M6 7v10" /></>,
    split: <><circle cx="7" cy="7" r="2" /><circle cx="7" cy="17" r="2" /><path d="m9 8 9 8M9 16l9-8" /></>,
    delete: <><path d="M5 7h14M9 7V5h6v2M8 10v7M12 10v7M16 10v7M7 7l1 13h8l1-13" /></>
  }
  return (
    <svg className="workbench-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {paths[name]}
    </svg>
  )
}

function multicamPanelMessages(messages: Messages): MulticamPanelMessages {
  return {
    title: messages.multicamTitle,
    subtitle: messages.multicamSubtitle,
    createGroup: messages.multicamCreateGroup,
    newGroupName: messages.multicamNewGroupName,
    sources: messages.multicamSources,
    sourceUnavailable: messages.multicamSourceUnavailable,
    referenceAngle: messages.multicamReferenceAngle,
    create: messages.multicamCreate,
    groups: messages.multicamGroups,
    emptyTitle: messages.multicamEmptyTitle,
    emptyBody: messages.multicamEmptyBody,
    duration: messages.multicamDuration,
    groupName: messages.multicamGroupName,
    saveName: messages.multicamSaveName,
    editRange: messages.multicamEditRange,
    startFrame: messages.multicamStartFrame,
    endFrame: messages.multicamEndFrame,
    coveragePolicy: messages.multicamCoveragePolicy,
    rejectIncomplete: messages.multicamRejectIncomplete,
    clampIncomplete: messages.multicamClampIncomplete,
    members: messages.multicamMembers,
    source: messages.multicamSource,
    memberLabel: messages.multicamMemberLabel,
    angleLabel: messages.multicamAngleLabel,
    saveLabels: messages.multicamSaveLabels,
    reference: messages.multicamReference,
    syncStatus: messages.multicamSyncStatus,
    syncConfidence: messages.multicamSyncConfidence,
    offsetFrames: messages.multicamOffsetFrames,
    coverage: messages.multicamCoverage,
    confirmSync: messages.multicamConfirmSync,
    verified: messages.multicamVerified,
    uncertain: messages.multicamUncertain,
    unknown: messages.multicamUnknown,
    switchToAngle: messages.multicamSwitchToAngle,
    layouts: messages.multicamLayouts,
    applyLayout: messages.multicamApplyLayout,
    noLayouts: messages.multicamNoLayouts,
    program: messages.multicamProgram,
    noProgram: messages.multicamNoProgram,
    angle: messages.multicamAngle,
    layout: messages.multicamLayout,
    previewRange: messages.multicamPreviewRange,
    mergeAdjacent: messages.multicamMergeAdjacent,
    actionFailed: messages.multicamActionFailed,
    working: messages.multicamWorking
  }
}

export function VideoEditorWorkbench({ controller }: VideoEditorWorkbenchProps): React.JSX.Element {
  const { state } = controller
  const messages = useMemo(() => messagesFor(state.locale), [state.locale])
  const alertRef = useRef<HTMLDivElement>(null)
  const compactSidebar = useCompactSidebar()
  const activeSection = state.activeWorkspace
  const project = state.project
  const [previewExpanded, setPreviewExpanded] = useState(() =>
    Boolean(
      project &&
      project.durationFrames > 0 &&
      (!compactSidebar || (typeof window !== 'undefined' && window.innerWidth >= 540))
    )
  )
  const initializationFailed = !project && (
    state.connection === 'offline' ||
    state.notices.some(({ messageKey }) => messageKey === 'editorInitializeFailed')
  )
  const projectJobIds = new Set(
    state.renderTickets.filter(({ projectId }) => projectId === project?.id).map(({ jobId }) => jobId)
  )
  const projectJobs = state.jobs.filter(({ id }) => projectJobIds.has(id))
  const selectedItem = project?.items.find(({ id }) => id === state.selectedItemId)
  const selectedCaption = project?.captions.find(({ id }) => id === state.selectedCaptionId)
  const artifacts = useMemo(() => artifactsForJobs(projectJobs), [projectJobs])
  const activeArtifact = artifacts.find(({ mediaHandleId }) => mediaHandleId === state.activeMediaHandleId)
  const activeAsset = visibleProjectAssets(state).find(({ mediaHandleId }) => mediaHandleId === state.activeMediaHandleId)
  const timelineSource = project ? timelineSourceAtFrame(project, state.playheadFrame) : undefined
  const currentComposedArtifact = project && activeArtifact && artifactMatchesPlayback(
    activeArtifact,
    project,
    state.playheadFrame
  ) ? activeArtifact : undefined
  const sourceFastPath = project?.playback.mode === 'source-fast-path' &&
    project.playback.revision === project.currentRevision &&
    timelineSource?.asset.id === project.playback.sourceAssetId
  const openAsset = controller.openAsset

  useEffect(() => {
    if (state.notices.at(-1)?.severity === 'error') alertRef.current?.focus()
  }, [state.notices])

  useEffect(() => {
    syncDocumentPresentation(document.documentElement, state.theme, state.locale)
    document.title = messages.appName
  }, [messages.appName, state.locale, state.theme])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const target = event.target
      if (
        target instanceof HTMLElement &&
        target.closest('button, input, select, textarea, a[href], summary, [contenteditable="true"], [role="button"], [role="tab"]')
      ) return
      if (event.key === ' ' && project) {
        event.preventDefault()
        controller.togglePlaying()
      } else if (event.key.toLowerCase() === 's' && selectedItem && project) {
        event.preventDefault()
        void splitAtPlayhead(controller, project, selectedItem, messages)
      } else if ((event.key === 'Delete' || event.key === 'Backspace') && selectedItem) {
        event.preventDefault()
        if (window.confirm(messages.deleteItemConfirm)) {
          void controller.applyOperations(
            [{ type: 'delete-item', itemId: selectedItem.id }],
            formatMessage(messages.deleteSummary, { id: selectedItem.id })
          )
        }
      } else if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z') {
        event.preventDefault()
        void (event.shiftKey ? controller.redo() : controller.undo())
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [controller, messages, project, selectedItem])

  useEffect(() => {
    if (
      !currentComposedArtifact &&
      sourceFastPath &&
      timelineSource?.asset.mediaHandleId &&
      timelineSource.asset.mediaHandleId !== state.activeMediaHandleId
    ) {
      void openAsset(timelineSource.asset.id)
    }
  }, [currentComposedArtifact, openAsset, sourceFastPath, state.activeMediaHandleId, timelineSource?.asset.id, timelineSource?.asset.mediaHandleId])

  if (state.resultPreview) {
    return <ResultPreviewWorkbench controller={controller} messages={messages} />
  }

  return (
    <div
      className="editor-app"
      data-theme={state.theme?.kind ?? 'dark'}
      data-reduced-motion={state.theme?.reducedMotion ? 'true' : 'false'}
      dir={state.locale?.direction ?? 'ltr'}
      lang={state.locale?.language ?? 'en'}
      style={themeStyle(state.theme)}
    >
      <a className="skip-link" href="#video-editor-main">{messages.skipEditor}</a>
      <ProjectBar controller={controller} messages={messages} />
      <div className="notice-stack" aria-live="polite" aria-relevant="additions">
        {state.connection === 'reconnecting' && <StatusNotice severity="warning">{messages.reconnecting}</StatusNotice>}
        {state.conflict && <StatusNotice severity="warning">{messages.conflict}</StatusNotice>}
        {state.notices.map((notice, index) => (
          <div
            className={`notice notice-${notice.severity}`}
            key={notice.id}
            role={notice.severity === 'error' ? 'alert' : 'status'}
            tabIndex={notice.severity === 'error' && index === state.notices.length - 1 ? -1 : undefined}
            ref={notice.severity === 'error' && index === state.notices.length - 1 ? alertRef : undefined}
          >
            <span>{noticeMessage(notice, messages)}</span>
            {notice.interactionRequired && <strong>{messages.interactionRequired}</strong>}
            {notice.capabilityDetails && notice.capabilityDetails.length > 0 && (
              <details className="notice-capability-details" open>
                <summary>{formatMessage(messages.renderCapabilityDetails, {
                  count: notice.capabilityDetails.length
                })}</summary>
                <ul>
                  {notice.capabilityDetails.map((detail) => (
                    <li key={`${detail.nodeId}:${detail.capability}`}>
                      <strong>{detail.nodeId}</strong>
                      <span>{messages.renderCapabilityRequired}: <code>{detail.capability}</code></span>
                      {detail.message && <span>{detail.message}</span>}
                      {detail.guidance && <small>{messages.renderCapabilityGuidance}: {detail.guidance}</small>}
                    </li>
                  ))}
                </ul>
              </details>
            )}
            <button type="button" className="quiet-button" onClick={() => controller.dismissNotice(notice.id)}>
              {messages.dismiss}
            </button>
          </div>
        ))}
      </div>

      {!state.initialized ? (
        <main className="center-state" aria-busy="true"><Spinner /> {messages.loadingEditor}</main>
      ) : !project && initializationFailed ? (
        <InitializationRecovery controller={controller} messages={messages} />
      ) : !project ? (
        <EmptyProject controller={controller} messages={messages} />
      ) : (
        <main id="video-editor-main" className="workbench" data-layout="responsive-sidebar" data-workspace={activeSection} aria-label={messages.appName} aria-busy={state.busy}>
          <details
            className="preview-drawer"
            open={previewExpanded}
            onToggle={(event) => setPreviewExpanded(event.currentTarget.open)}
          >
            <summary>
              <strong>{messages.player}</strong>
              <span className="subtle">{formatTime(frameToSeconds(project, state.playheadFrame))} / {formatTime(frameToSeconds(project, project.durationFrames))}</span>
              <span className="preview-drawer-action">{previewExpanded ? messages.collapsePreview : messages.expandPreview}</span>
            </summary>
            <div className="preview-drawer-body">
              {!currentComposedArtifact && !sourceFastPath ? (
                <div className={`player-stage aspect-${project.canvas.preset.replace(':', '-')}`}>
                  <EmptyState>
                    <p>{messages.composedPreviewRequired}</p>
                    <button
                      type="button"
                      disabled={!canRender(state, 'preview', 'none')}
                      onClick={() => void controller.startRender('preview', 'none')}
                    >{messages.renderComposedPreview}</button>
                  </EmptyState>
                </div>
              ) : (
                <div className="preview-media-shell">
                  <span className="preview-aspect-badge" aria-hidden="true">{project.canvas.preset}</span>
                  <MediaPlayer
                    url={state.activeMediaUrl}
                    kind={currentComposedArtifact?.mediaKind ?? activeAsset?.kind}
                    title={currentComposedArtifact?.displayName ?? activeAsset?.name}
                    project={project}
                    timelineSource={currentComposedArtifact ? undefined : timelineSource}
                    caption={undefined}
                    playheadFrame={state.playheadFrame}
                    playing={state.playing}
                    onSeek={controller.seek}
                    onPlaybackChange={(playing) => playing !== state.playing && controller.togglePlaying()}
                    onResourceError={() => void controller.refreshActiveLease()}
                    messages={messages}
                  />
                  <PlayerControls controller={controller} project={project} messages={messages} />
                </div>
              )}
            </div>
          </details>

          <ProjectStatusStrip state={state} project={project} messages={messages} />

          <WorkbenchSectionTabs activeSection={activeSection} onChange={controller.setActiveWorkspace} messages={messages} />
          <SequenceNavigator controller={controller} messages={messages} />

          <aside
            id="video-editor-pane-clips"
            className="workbench-pane clips-pane"
            data-sidebar-active={activeSection === 'clips'}
            aria-label={messages.sourceMaterial}
            aria-labelledby={compactSidebar ? 'video-editor-tab-clips' : undefined}
            role={compactSidebar ? 'tabpanel' : undefined}
            hidden={compactSidebar && activeSection !== 'clips'}
          >
            <MediaLibrary controller={controller} messages={messages} />
            <WorkspaceDisclosure title={messages.workspaceMediaProcessing}>
              <DerivedMediaPanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceMediaIntelligence}>
              <MediaIntelligencePanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
          </aside>

          <section
            id="video-editor-pane-script"
            className="workbench-pane script-pane"
            data-sidebar-active={activeSection === 'script'}
            aria-label={messages.transcript}
            aria-labelledby={compactSidebar ? 'video-editor-tab-script' : undefined}
            role={compactSidebar ? 'tabpanel' : undefined}
            hidden={compactSidebar && activeSection !== 'script'}
          >
            <TranscriptPanel controller={controller} messages={messages} />
          </section>

          <section
            id="video-editor-pane-timeline"
            className="workbench-pane timeline-pane"
            data-sidebar-active={activeSection === 'timeline'}
            aria-label={messages.timeline}
            aria-labelledby={compactSidebar ? 'video-editor-tab-timeline' : undefined}
            role={compactSidebar ? 'tabpanel' : undefined}
            hidden={compactSidebar && activeSection !== 'timeline'}
          >
            <TimelinePanel controller={controller} messages={messages} />
            <WorkspaceDisclosure title={messages.workspaceCaptions}>
              <CaptionPanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceMulticam}>
              <MulticamPanel
              groups={project.multicamGroups.map((group) => ({
                id: group.id,
                sequenceId: group.sequenceId,
                name: group.name,
                durationFrames: group.durationFrames,
                referenceMemberId: group.referenceMemberId,
                members: group.members.map((member) => ({
                  id: member.id,
                  assetId: member.assetId,
                  memberLabel: member.memberLabel,
                  angleLabel: member.angleLabel,
                  sync: {
                    status: member.sync.status,
                    offsetFrames: member.sync.offsetFrames,
                    ...(member.sync.confidence === undefined ? {} : { confidence: member.sync.confidence })
                  },
                  coverage: member.coverage.map(({ startFrame, endFrame }) => ({ startFrame, endFrame }))
                })),
                layouts: group.layouts.map((layout) => ({
                  id: layout.id,
                  label: layout.label,
                  memberIds: layout.slots.map(({ memberId }) => memberId)
                })),
                programFragments: group.programFragments
              }))}
              assets={project.assets.map((asset) => ({
                id: asset.id,
                name: asset.name,
                kind: asset.kind,
                available: (asset.availability ?? 'online') === 'online'
              }))}
              busy={state.busy}
              messages={multicamPanelMessages(messages)}
              onCreate={controller.createMulticam}
              onRenameLabels={controller.renameMulticamLabels}
              onConfirmSync={controller.confirmMulticamSync}
              onSwitch={controller.switchMulticam}
              onMerge={controller.mergeMulticam}
              onApplyLayout={controller.applyMulticamLayout}
              onPreview={controller.previewMulticam}
              />
            </WorkspaceDisclosure>
          </section>

          <aside
            id="video-editor-pane-properties"
            className="workbench-pane properties-pane"
            data-sidebar-active={activeSection === 'properties'}
            aria-label={messages.inspectorAndAgent}
            aria-labelledby={compactSidebar ? 'video-editor-tab-properties' : undefined}
            role={compactSidebar ? 'tabpanel' : undefined}
            hidden={compactSidebar && activeSection !== 'properties'}
          >
            <InspectorPanel controller={controller} item={selectedItem} caption={selectedCaption} messages={messages} />
            <AgentSyncPanel controller={controller} messages={messages} />
          </aside>

          <section
            id="video-editor-pane-output"
            className="workbench-pane output-pane"
            data-sidebar-active={activeSection === 'output'}
            aria-label={messages.projectOutputAndHistory}
            aria-labelledby={compactSidebar ? 'video-editor-tab-output' : undefined}
            role={compactSidebar ? 'tabpanel' : undefined}
            hidden={compactSidebar && activeSection !== 'output'}
          >
            <ExportPanel controller={controller} jobs={projectJobs} messages={messages} />
            <WorkspaceDisclosure title={messages.workspacePreviewProof}>
              <PreviewPanel controller={controller} artifacts={artifacts} messages={messages} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceRevisionHistory}>
              <RevisionPanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceGeneration}>
              <GenerationPanel
              locale={state.locale}
              projectId={project.id}
              projectRevision={project.currentRevision}
              catalog={state.generation.catalog}
              catalogOutcome={state.generation.outcome}
              unavailableMessage={state.generation.unavailableMessage}
              assets={project.assets.map((asset) => ({
                id: asset.id,
                name: asset.name,
                kind: asset.kind === 'audio' ? 'audio' : asset.kind === 'video' ? 'video' : 'image',
                available: (asset.availability ?? 'online') === 'online' && Boolean(asset.mediaHandleId)
              }))}
              records={state.generation.records}
              busy={state.busy}
              onRequest={controller.requestGeneration}
              onRefresh={controller.refreshGeneration}
              onCancel={controller.cancelGeneration}
              onRetry={controller.retryGeneration}
              onInsert={controller.insertGeneratedVariant}
              />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceInterchange}>
              <InterchangePanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
            <WorkspaceDisclosure title={messages.workspaceProjectPackage}>
              <ProjectPackagePanel controller={controller} messages={messages} />
            </WorkspaceDisclosure>
          </section>
        </main>
      )}

      <footer className="editor-footer">
        <span>{messages.localOnly}</span>
        <span>{messages.keyboardHelp}</span>
      </footer>
    </div>
  )
}

function SequenceNavigator({ controller, messages }: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const project = controller.state.project!
  const [name, setName] = useState('')
  const nestedBy = new Set(project.items.flatMap(({ nestedSequenceId }) => nestedSequenceId ? [nestedSequenceId] : []))
  const create = (event: FormEvent): void => {
    event.preventDefault()
    if (!name.trim()) return
    void controller.createSequence(name, true)
    setName('')
  }
  return (
    <section className="sequence-navigator" aria-label={messages.sequences}>
      <div className="sequence-strip" role="tablist" aria-label={messages.openSequences}>
        {project.sequences.filter(({ viewState }) => viewState.open).map((sequence) => (
          <button
            type="button"
            role="tab"
            key={sequence.id}
            aria-selected={sequence.id === project.activeSequenceId}
            onClick={() => void controller.selectSequence(sequence.id)}
          >
            <span>{sequence.name}</span>
            <small>{formatTime(frameToSeconds(project, sequence.durationFrames))}</small>
          </button>
        ))}
      </div>
      <details className="sequence-menu">
        <summary>{messages.manageSequences}</summary>
        <form className="sequence-create" onSubmit={create}>
          <label><span>{messages.sequenceName}</span><input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} /></label>
          <button type="submit" disabled={!name.trim() || controller.state.busy}>{messages.createSequence}</button>
        </form>
        <ul className="sequence-list">
          {project.sequences.map((sequence) => {
            const active = sequence.id === project.activeSequenceId
            const deleteSafe = project.sequences.length > 1 && !active && !sequence.viewState.open &&
              !nestedBy.has(sequence.id) && (sequence.nestedByCount ?? 0) === 0
            return <li key={sequence.id}>
              <button type="button" className="sequence-identity" aria-current={active ? 'page' : undefined} onClick={() => void controller.selectSequence(sequence.id)}>
                <strong>{sequence.name}</strong>
                <small>{formatMessage(messages.sequenceCounts, { items: sequence.itemCount, captions: sequence.captionCount })}</small>
              </button>
              <div className="button-row sequence-actions">
                <button type="button" onClick={() => {
                  const next = window.prompt(messages.renameSequencePrompt, sequence.name)
                  if (next?.trim()) void controller.renameSequence(sequence.id, next)
                }}>{messages.rename}</button>
                <button type="button" onClick={() => {
                  const next = window.prompt(messages.duplicateSequencePrompt, `${sequence.name} ${messages.copySuffix}`)
                  if (next?.trim()) void controller.duplicateSequence(sequence.id, next, true)
                }}>{messages.duplicate}</button>
                {sequence.viewState.open
                  ? <button type="button" disabled={project.sequences.length < 2} onClick={() => void controller.closeSequence(sequence.id)}>{messages.close}</button>
                  : <button type="button" onClick={() => void controller.selectSequence(sequence.id)}>{messages.open}</button>}
                <button
                  type="button"
                  className="danger-button"
                  disabled={!deleteSafe}
                  title={!deleteSafe ? messages.sequenceDeleteBlocked : undefined}
                  onClick={() => window.confirm(formatMessage(messages.deleteSequenceConfirm, { name: sequence.name })) && void controller.deleteSequence(sequence.id)}
                >{messages.delete}</button>
              </div>
            </li>
          })}
        </ul>
      </details>
    </section>
  )
}

function useCompactSidebar(): boolean {
  const [compact, setCompact] = useState(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return true
    return window.matchMedia(SIDEBAR_BREAKPOINT_QUERY).matches
  })
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
    const query = window.matchMedia(SIDEBAR_BREAKPOINT_QUERY)
    const update = (): void => setCompact(query.matches)
    update()
    query.addEventListener('change', update)
    return () => query.removeEventListener('change', update)
  }, [])
  return compact
}

function WorkbenchSectionTabs(props: {
  activeSection: EditorWorkspace
  onChange(section: EditorWorkspace): void
  messages: Messages
}): React.JSX.Element {
  const sections: ReadonlyArray<{ id: EditorWorkspace; label: string; icon: WorkbenchIconName }> = [
    { id: 'script', label: props.messages.workspaceScript, icon: 'script' },
    { id: 'clips', label: props.messages.workspaceClips, icon: 'clips' },
    { id: 'timeline', label: props.messages.workspaceTimeline, icon: 'timeline' },
    { id: 'properties', label: props.messages.workspaceProperties, icon: 'properties' },
    { id: 'output', label: props.messages.workspaceOutput, icon: 'output' }
  ]
  const handleKeyDown = (event: ReactKeyboardEvent<HTMLElement>): void => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
    const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'))
    const current = tabs.indexOf(event.target as HTMLButtonElement)
    if (current < 0) return
    event.preventDefault()
    const direction = event.currentTarget.ownerDocument?.dir === 'rtl' ? -1 : 1
    const next = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? tabs.length - 1
        : (current + (event.key === 'ArrowRight' ? direction : -direction) + tabs.length) % tabs.length
    tabs[next]?.focus()
    tabs[next]?.click()
  }
  return (
    <nav className="workbench-tabs" role="tablist" aria-label={props.messages.workspaceTabs} onKeyDown={handleKeyDown}>
      {sections.map((section) => (
        <button
          type="button"
          id={`video-editor-tab-${section.id}`}
          key={section.id}
          data-section={section.id}
          role="tab"
          aria-selected={props.activeSection === section.id}
          aria-controls={`video-editor-pane-${section.id}`}
          tabIndex={props.activeSection === section.id ? 0 : -1}
          onClick={() => props.onChange(section.id)}
        >
          <WorkbenchIcon name={section.icon} />
          <span>{section.label}</span>
        </button>
      ))}
    </nav>
  )
}

function ProjectStatusStrip(props: {
  state: EditorState
  project: ProjectProjection
  messages: Messages
}): React.JSX.Element {
  const { state, project, messages } = props
  const completedArtifactJobIds = new Set(state.jobs
    .filter((job) => job.state === 'completed' && (job.result?.generatedArtifacts.length ?? 0) > 0)
    .map(({ id }) => id))
  const latestProof = [...state.renderTickets]
    .filter((ticket) =>
      ticket.projectId === project.id &&
      (ticket.renderKind === 'proof-frame' || ticket.renderKind === 'preview') &&
      completedArtifactJobIds.has(ticket.jobId)
    )
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.jobId.localeCompare(left.jobId))[0]
  const proofState = !latestProof ? 'missing' : proofIsStale(latestProof, project) ? 'stale' : 'current'
  const proofLabel = !latestProof
    ? messages.proofFreshnessMissing
    : formatMessage(
        proofState === 'stale' ? messages.proofFreshnessStale : messages.proofFreshnessCurrent,
        { revision: latestProof.pinnedRevision }
      )
  return <div
    className="project-status-strip"
    role="status"
    aria-atomic="true"
    aria-label={messages.compactProjectStatus}
    data-proof-state={proofState}
  >
    <span className="project-status-item project-status-project" data-status-kind="project">
      <WorkbenchIcon name="project" />
      <strong>{messages.projectStatusProject}</strong>
      <span title={project.name}>{project.name} · r{project.currentRevision}</span>
    </span>
    <span className="project-status-item" data-status-kind="playhead">
      <WorkbenchIcon name="playhead" />
      <strong>{messages.projectStatusPlayhead}</strong>
      <span>{state.playheadFrame}f · {formatTime(frameToSeconds(project, state.playheadFrame))}</span>
    </span>
    <span className="project-status-item" data-status-kind="proof">
      <WorkbenchIcon name="proof" />
      <strong>{messages.projectStatusProof}</strong>
      <span>{proofLabel}</span>
    </span>
  </div>
}

export function syncDocumentPresentation(
  documentRoot: Pick<HTMLElement, 'dataset' | 'dir' | 'lang'> & {
    style?: Pick<CSSStyleDeclaration, 'setProperty' | 'removeProperty'>
  },
  theme: EditorState['theme'],
  locale: EditorState['locale']
): void {
  documentRoot.dataset.theme = theme?.kind ?? 'dark'
  documentRoot.dataset.reducedMotion = theme?.reducedMotion ? 'true' : 'false'
  documentRoot.dataset.zoomFactor = String(theme?.zoomFactor ?? 1)
  documentRoot.lang = locale?.language ?? 'en'
  documentRoot.dir = locale?.direction ?? 'ltr'
  if (documentRoot.style) {
    for (const variables of Object.values(HOST_THEME_TOKEN_VARIABLES)) {
      for (const variable of variables) documentRoot.style.removeProperty(variable)
    }
    for (const [token, value] of Object.entries(theme?.tokens ?? {})) {
      for (const variable of HOST_THEME_TOKEN_VARIABLES[token] ?? []) {
        documentRoot.style.setProperty(variable, value)
      }
    }
    const zoomFactor = Math.min(3, Math.max(0.5, theme?.zoomFactor ?? 1))
    documentRoot.style.setProperty('font-size', `${16 * zoomFactor}px`)
    documentRoot.style.setProperty('color-scheme', themeColorScheme(theme))
  }
}

export function themeStyle(theme: EditorState['theme']): CSSProperties {
  const style: Record<string, string | number> = {
    colorScheme: themeColorScheme(theme)
  }
  for (const [token, value] of Object.entries(theme?.tokens ?? {})) {
    for (const variable of HOST_THEME_TOKEN_VARIABLES[token] ?? []) style[variable] = value
  }
  return style as CSSProperties
}

export function noticeMessage(notice: EditorNotice, messages: Messages): string {
  return notice.messageKey
    ? formatMessage(messages[notice.messageKey], notice.messageValues)
    : notice.message
}

function themeColorScheme(theme: EditorState['theme']): 'light' | 'dark' {
  if (theme?.kind === 'light') return 'light'
  if (theme?.kind === 'dark') return 'dark'
  const background = theme?.tokens.background?.trim().toLowerCase()
  if (background === '#fff' || background === '#ffffff' || background === 'white') return 'light'
  return 'dark'
}

function WorkspaceDisclosure(props: PropsWithChildren<{ title: string }>): React.JSX.Element {
  return (
    <details className="workspace-disclosure">
      <summary><strong>{props.title}</strong><span aria-hidden="true">⌄</span></summary>
      <div className="workspace-disclosure-body">{props.children}</div>
    </details>
  )
}

function ProjectBar({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const { state } = controller
  const [name, setName] = useState(messages.untitledInterview)
  const previousDefaultName = useRef(messages.untitledInterview)
  const [preset, setPreset] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [fpsPreset, setFpsPreset] = useState('30/1')
  const [creating, setCreating] = useState(false)
  useEffect(() => {
    setName((current) => current === previousDefaultName.current ? messages.untitledInterview : current)
    previousDefaultName.current = messages.untitledInterview
  }, [messages.untitledInterview])
  useEffect(() => {
    if (state.project) setCreating(false)
  }, [state.project])
  const create = (event: FormEvent): void => {
    event.preventDefault()
    const [numerator, denominator] = fpsPreset.split('/').map(Number)
    void controller.createProject(name, preset, { numerator, denominator })
  }
  return (
    <header className="project-bar">
      <div className="brand-block">
        <span className="brand-mark" aria-hidden="true">K</span>
        <div><strong>{state.project?.name ?? messages.appName}</strong><small>{state.project ? `${messages.activeRevision} r${state.project.currentRevision}` : messages.workbenchSubtitle}</small></div>
      </div>
      {state.project && <nav className="project-controls" aria-label={messages.projects}>
        <div className="project-switcher">
          <label>
            <span>{messages.projects}</span>
            <select
              value={state.project?.id ?? ''}
              onChange={(event) => event.target.value && void controller.openProject(event.target.value)}
              disabled={state.busy}
            >
              <option value="">{messages.selectProject}</option>
              {!state.projects.some(({ id }) => id === state.project?.id) && <option value={state.project.id}>{state.project.name} · r{state.project.currentRevision}</option>}
              {state.projects.map((project) => <option key={project.id} value={project.id}>{project.name} · r{project.currentRevision}</option>)}
            </select>
          </label>
          <button
            type="button"
            className="create-project-toggle"
            aria-expanded={creating}
            aria-controls="video-editor-create-project-form"
            onClick={() => setCreating((current) => !current)}
          >
            <span aria-hidden="true">＋</span><span className="create-project-label">{messages.createProject}</span>
          </button>
        </div>
        <form id="video-editor-create-project-form" className="new-project-form" data-expanded={creating} onSubmit={create}>
          <label><span>{messages.projectName}</span><input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} required /></label>
          <label><span>{messages.canvas}</span><select value={preset} onChange={(event) => setPreset(event.target.value as typeof preset)}>
            <option value="16:9">16:9</option><option value="9:16">9:16</option><option value="1:1">1:1</option>
          </select></label>
          <label><span>{messages.frameRate}</span><select value={fpsPreset} onChange={(event) => setFpsPreset(event.target.value)}>
            <option value="24/1">24 fps</option>
            <option value="25/1">25 fps</option>
            <option value="30000/1001">29.97 fps</option>
            <option value="30/1">30 fps</option>
            <option value="60/1">60 fps</option>
          </select></label>
          <button type="submit" disabled={state.busy}>{messages.createProject}</button>
        </form>
      </nav>}
      <div className="project-actions">
        {state.project ? <>
          <div className="project-health" aria-label={messages.compactProjectStatus}>
            <span className={`connection connection-${state.connection}`}>{connectionLabel(messages, state.connection)}</span>
            <span className="revision-badge">r{state.project.currentRevision}</span>
            <MediaCapabilityStatus state={state} messages={messages} />
          </div>
          <div className="project-action-buttons">
            <button type="button" className="primary-action" onClick={() => void controller.importMedia()} disabled={state.busy || !canImportMedia(state)}>{messages.importMedia}</button>
            <button type="button" className="icon-action" title={messages.undo} aria-label={messages.undo} onClick={() => void controller.undo()} disabled={!(state.project.canUndo ?? state.project.currentRevision > 0) || state.busy}>↶</button>
            <button type="button" className="icon-action" title={messages.redo} aria-label={messages.redo} onClick={() => void controller.redo()} disabled={!(state.project.canRedo ?? state.project.currentRevision > 0) || state.busy}>↷</button>
            <button type="button" className="icon-action quiet-button" title={messages.refresh} aria-label={messages.refresh} onClick={() => void controller.refreshAll()} disabled={state.busy}>↻</button>
          </div>
        </> : <button type="button" className="icon-action quiet-button" title={messages.refresh} aria-label={messages.refresh} onClick={() => void controller.refreshAll()} disabled={state.busy}>↻</button>}
      </div>
    </header>
  )
}

function EmptyProject({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const [name, setName] = useState(messages.untitledInterview)
  const [preset, setPreset] = useState<'16:9' | '9:16' | '1:1'>('16:9')
  const [fpsPreset, setFpsPreset] = useState('30/1')
  const create = (event: FormEvent): void => {
    event.preventDefault()
    const [numerator, denominator] = fpsPreset.split('/').map(Number)
    void controller.createProject(name, preset, { numerator, denominator })
  }
  return (
    <main id="video-editor-main" className="empty-project">
      <section className="onboarding-intro">
        <p className="eyebrow">{messages.localFirstEditing}</p>
        <h1>{messages.onboardingTitle}</h1>
        <p>{messages.onboardingSubtitle}</p>
      </section>

      <form className="onboarding-project-card" onSubmit={create}>
        <div className="onboarding-card-heading">
          <span className="onboarding-card-icon" aria-hidden="true">＋</span>
          <div><strong>{messages.projectSetup}</strong><small>{messages.localOnly}</small></div>
        </div>
        <label className="onboarding-name"><span>{messages.projectName}</span><input value={name} maxLength={160} onChange={(event) => setName(event.target.value)} required autoFocus /></label>
        <fieldset className="onboarding-choice onboarding-aspects"><legend>{messages.canvasRatio}</legend><div>{([
          ['16:9', messages.aspectLandscape, messages.aspectLandscapeHint],
          ['9:16', messages.aspectPortrait, messages.aspectPortraitHint],
          ['1:1', messages.aspectSquare, messages.aspectSquareHint]
        ] as const).map(([value, label, hint]) => <button type="button" key={value} aria-pressed={preset === value} onClick={() => setPreset(value)}><span className="onboarding-aspect-visual" data-aspect={value} aria-hidden="true"><i /></span><span><strong>{value}</strong><small>{label} · {hint}</small></span></button>)}</div></fieldset>
        <fieldset className="onboarding-choice onboarding-fps"><legend>{messages.frameRate}</legend><div>{[['24/1', '24'], ['25/1', '25'], ['30/1', '30'], ['50/1', '50'], ['60/1', '60']].map(([value, label]) => <button type="button" key={value} aria-pressed={fpsPreset === value} onClick={() => setFpsPreset(value!)}><strong>{label}</strong><small>fps</small></button>)}</div></fieldset>
        <button type="submit" className="empty-project-primary" disabled={controller.state.busy}>{messages.createAndStart}<span aria-hidden="true">→</span></button>
      </form>

      <section className="onboarding-recent" aria-labelledby="video-editor-recent-projects">
        <div className="onboarding-section-heading"><h2 id="video-editor-recent-projects">{messages.recentProjects}</h2><span>{controller.state.projects.length}</span></div>
        {controller.state.projects.length === 0 ? <p className="onboarding-empty-recent">{messages.noProject}</p> : <div className="onboarding-recent-list">{controller.state.projects.slice(0, 4).map((project) => (
          <button type="button" key={project.id} onClick={() => void controller.openProject(project.id)}>
            <span className="recent-project-thumb" aria-hidden="true"><i /><i /><i /></span>
            <span><strong>{project.name}</strong><small>r{project.currentRevision}</small></span><b aria-hidden="true">→</b>
          </button>
        ))}</div>}
      </section>

      <section className="onboarding-steps" aria-label={messages.onboardingWorkflow}>
        {[
          [messages.onboardingStepCreate, messages.onboardingStepCreateBody, '01'],
          [messages.onboardingStepImport, messages.onboardingStepImportBody, '02'],
          [messages.onboardingStepEdit, messages.onboardingStepEditBody, '03']
        ].map(([title, body, step]) => <article key={step}><span>{step}</span><div><strong>{title}</strong><p>{body}</p></div></article>)}
      </section>

      <div className="empty-illustration" aria-hidden="true">
        <div className="empty-preview-stage"><span className="empty-aspect">{preset}</span><b>▶</b></div>
        <div className="empty-preview-transport"><span>00:18</span><i /></div>
        <div className="empty-preview-timeline"><i /><i /><i /></div>
      </div>
    </main>
  )
}

function InitializationRecovery({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  return (
    <main id="video-editor-main" className="initialization-recovery" aria-labelledby="video-editor-initialization-error">
      <div className="initialization-recovery-card">
        <p className="eyebrow">{messages.appName}</p>
        <h1 id="video-editor-initialization-error">{messages.editorInitializeFailed}</h1>
        <p>{messages.editorInitializeRecovery}</p>
        <button
          type="button"
          className="empty-project-primary"
          disabled={controller.state.connection === 'reconnecting' || controller.state.busy}
          onClick={() => void controller.retryInitialization()}
        >
          {messages.retryInitialization}
        </button>
      </div>
    </main>
  )
}

function MediaLibrary({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const project = controller.state.project!
  const [folderId, setFolderId] = useState('')
  const [query, setQuery] = useState('')
  const [kindFilter, setKindFilter] = useState<'all' | 'video' | 'image' | 'audio'>('all')
  const [windowStart, setWindowStart] = useState(0)
  const [selected, setSelected] = useState<string[]>([])
  const normalizedQuery = query.trim()
  const page = controller.state.mediaLibrary
  const filterMatches = Boolean(
    page &&
    page.projectId === project.id &&
    page.revision === project.currentRevision &&
    (page.folderId ?? '') === folderId &&
    page.query === normalizedQuery
  )
  const pageMatches = filterMatches && page?.offset === windowStart
  const assets = pageMatches
    ? page!.assets
    : windowStart === 0 && !folderId && !normalizedQuery
      ? project.assets.slice(0, VIEW_LIMITS.virtualWindow)
      : []
  const visibleAssets = assets.filter((asset) => kindFilter === 'all' || asset.kind === kindFilter || (kindFilter === 'image' && asset.kind === 'animation'))
  const total = filterMatches ? page!.total : project.assets.length
  const activeFolderNonEmpty = Boolean(folderId && (
    project.assets.some((asset) => asset.folderId === folderId) ||
    project.mediaFolders.some((folder) => folder.parentId === folderId) ||
    (filterMatches && !normalizedQuery && page!.total > 0)
  ))
  useEffect(() => {
    void controller.loadMediaLibraryPage({
      ...(folderId ? { folderId } : {}),
      ...(normalizedQuery ? { query: normalizedQuery } : {}),
      offset: windowStart,
      limit: VIEW_LIMITS.virtualWindow
    })
  }, [controller.loadMediaLibraryPage, folderId, normalizedQuery, project.currentRevision, project.id, windowStart])
  const toggleSelected = (assetId: string): void => {
    setSelected((current) => current.includes(assetId)
      ? current.filter((id) => id !== assetId)
      : [...current, assetId].slice(-64))
  }
  return (
    <Panel title={messages.mediaLibrary} className="media-library-panel" actions={<button type="button" className="primary-action media-import-action" onClick={() => void controller.importMedia({ folderId: folderId || undefined, addToTimeline: false })} disabled={controller.state.busy || !canImportMedia(controller.state)}>{messages.importMedia}</button>}>
      <div className="media-library-toolbar">
        <label><span>{messages.folder}</span><select value={folderId} onChange={(event) => {
          setFolderId(event.target.value)
          setWindowStart(0)
        }}>
          <option value="">{messages.allMedia}</option>
          {project.mediaFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select></label>
        <label><span>{messages.search}</span><input type="search" value={query} maxLength={256} placeholder={messages.searchMedia} onChange={(event) => {
          setQuery(event.target.value)
          setWindowStart(0)
        }} /></label>
        <button type="button" onClick={() => {
          const name = window.prompt(messages.newFolderPrompt)
          if (name?.trim()) void controller.createMediaFolder(name, folderId || undefined)
        }}>{messages.newFolder}</button>
        {folderId && <>
          <button type="button" onClick={() => {
            const current = project.mediaFolders.find(({ id }) => id === folderId)
            const name = window.prompt(messages.renameFolderPrompt, current?.name)
            if (name?.trim()) void controller.updateMediaFolder(folderId, { name })
          }}>{messages.rename}</button>
          <button
            type="button"
            className="danger-button"
            disabled={activeFolderNonEmpty}
            title={activeFolderNonEmpty ? messages.emptyFolderBeforeDelete : undefined}
            onClick={() => window.confirm(messages.deleteFolderConfirm) && void controller.deleteMediaFolder(folderId)}
          >{messages.delete}</button>
        </>}
      </div>
      <div className="media-kind-filters" role="group" aria-label={messages.mediaKinds}>
        {([
          ['all', messages.allKinds],
          ['video', messages.videoKind],
          ['image', messages.imageKind],
          ['audio', messages.audioKind]
        ] as const).map(([value, label]) => <button type="button" key={value} aria-pressed={kindFilter === value} onClick={() => setKindFilter(value)}>{label}</button>)}
      </div>
      <div className="media-organize-row" data-active={selected.length > 0 ? 'true' : 'false'}>
        <span>{formatMessage(messages.mediaSelectedCount, { count: selected.length })}</span>
        <select aria-label={messages.moveSelectedToFolder} defaultValue="" onChange={(event) => {
          if (!selected.length) return
          void controller.organizeMedia(selected, event.target.value || undefined)
        }}>
          <option value="">{messages.moveToRoot}</option>
          {project.mediaFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
        </select>
        {selected.length > 0 && <button type="button" className="quiet-button" onClick={() => setSelected([])}>{messages.clearSelection}</button>}
      </div>
      {visibleAssets.length === 0 ? <EmptyState>{messages.noMedia}</EmptyState> : (
        <ul className="media-list" aria-label={messages.importedMedia}>
          {visibleAssets.map((asset) => {
            const revoked = asset.availability === 'revoked' || Boolean(asset.mediaHandleId && controller.state.revokedHandles.includes(asset.mediaHandleId))
            const offline = revoked || asset.availability === 'offline' || asset.availability === 'changed'
            return (
              <li key={asset.id} data-kind={asset.kind} data-availability={asset.availability ?? 'online'}>
                <label className="media-select"><input type="checkbox" checked={selected.includes(asset.id)} onChange={() => toggleSelected(asset.id)} /><span className="sr-only">{formatMessage(messages.selectMediaItem, { name: asset.name })}</span></label>
                <button
                  type="button"
                  className={controller.state.selectedAssetId === asset.id ? 'selected media-card' : 'media-card'}
                  onClick={() => void controller.openAsset(asset.id)}
                  aria-pressed={controller.state.selectedAssetId === asset.id}
                >
                  <span className={`media-kind media-kind-${asset.kind}`}>{assetKindAbbreviation(messages, asset.kind)}</span>
                  <span><strong>{asset.name}</strong><small>{formatTime(asset.durationUs / 1_000_000)} · {asset.still ? `${asset.still.width}×${asset.still.height}` : asset.container}</small>{asset.generatedLineage && <em>{messages.generatedAsset}</em>}</span>
                </button>
                {offline && (
                  <button
                    type="button"
                    className="quiet-button reauthorize-button"
                    onClick={() => void controller.recoverMedia(asset.id)}
                  >
                    {messages.reauthorize}
                  </button>
                )}
              </li>
            )
          })}
        </ul>
      )}
      <VirtualControls start={windowStart} total={total} onChange={setWindowStart} messages={messages} />
      {(total > visibleAssets.length || kindFilter !== 'all') && <p className="subtle">{formatMessage(messages.filteredAssets, { visible: visibleAssets.length, total })}</p>}
    </Panel>
  )
}

function DerivedMediaPanel({ controller, messages }: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { state } = controller
  const selectedAsset = visibleProjectAssets(state).find(({ id }) => id === state.selectedAssetId)
  const canGenerate = Boolean(
    selectedAsset?.mediaHandleId &&
    !state.busy &&
    state.mediaCapabilities?.ffmpeg.available !== false
  )
  const usage = state.derivedUsage
  const actions = (
    <button
      type="button"
      className="quiet-button"
      onClick={() => void controller.refreshDerived()}
      disabled={state.busy}
    >
      {messages.derivedRefresh}
    </button>
  )
  return (
    <Panel title={messages.derivedMedia} actions={actions} className="derived-media-panel">
      <p className="boundary-note">{messages.derivedMediaHelp}</p>
      <div className="derived-create-grid" aria-label={messages.derivedMedia}>
        <button type="button" disabled={!canGenerate} onClick={() => void controller.startDerived('waveform')}>
          {messages.generateWaveform}
        </button>
        <button type="button" disabled={!canGenerate} onClick={() => void controller.startDerived('thumbnail')}>
          {messages.generateThumbnail}
        </button>
        <button type="button" disabled={!canGenerate} onClick={() => void controller.startDerived('filmstrip')}>
          {messages.generateFilmstrip}
        </button>
        <button type="button" disabled={!canGenerate} onClick={() => void controller.startDerived('proxy')}>
          {messages.generateProxy}
        </button>
      </div>
      {usage && (
        <p className="derived-usage">
          {formatMessage(messages.derivedStorage, {
            used: formatBytes(usage.usedBytes),
            quota: formatBytes(usage.quotaBytes),
            count: usage.recordCount
          })}
        </p>
      )}
      {state.derivedRecoveryDiagnostics.length > 0 && (
        <StatusNotice severity="warning">{messages.derivedRecoveryWarning}</StatusNotice>
      )}
      {state.derivedRecords.length === 0 ? <EmptyState>{messages.derivedEmpty}</EmptyState> : (
        <ul className="derived-list" aria-label={messages.derivedMedia}>
          {state.derivedRecords.map((record) => (
            <li key={record.id} data-status={record.status}>
              <div className="derived-record-heading">
                <strong>{derivedKindLabel(messages, record.kind)}</strong>
                <span className={`derived-status derived-status-${record.status}`}>
                  {derivedStatusLabel(messages, record.status)}
                </span>
              </div>
              <small>
                {record.assetId ?? state.project?.name} · {formatBytes(record.bytes)} · {formatMessage(messages.attempt, { attempt: record.attempt })}
              </small>
              {record.progress && (
                <progress
                  aria-label={derivedStatusLabel(messages, record.status)}
                  max={record.progress.total}
                  value={record.progress.completed}
                />
              )}
              {record.error?.message && <p className="derived-error">{record.error.message}</p>}
              <div className="button-row derived-record-actions">
                {['queued', 'running', 'partial'].includes(record.status) && (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={state.busy}
                    onClick={() => void controller.cancelDerived(record.id)}
                  >
                    {messages.derivedCancel}
                  </button>
                )}
                {['failed', 'cancelled', 'interrupted', 'invalid'].includes(record.status) && (
                  <button
                    type="button"
                    className="quiet-button"
                    disabled={state.busy}
                    onClick={() => void controller.retryDerived(record)}
                  >
                    {messages.derivedRetry}
                  </button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="button-row derived-cleanup-actions">
        <button type="button" className="quiet-button" disabled={state.busy} onClick={() => void controller.cleanupDerived(false)}>
          {messages.derivedCleanupFailures}
        </button>
        <button type="button" className="quiet-button" disabled={state.busy} onClick={() => void controller.cleanupDerived(true)}>
          {messages.derivedClearCache}
        </button>
      </div>
    </Panel>
  )
}

function derivedKindLabel(messages: Messages, kind: DerivedMediaKind): string {
  const keys: Record<DerivedMediaKind, keyof Messages> = {
    waveform: 'derivedKindWaveform',
    thumbnail: 'derivedKindThumbnail',
    filmstrip: 'derivedKindFilmstrip',
    transcript: 'derivedKindTranscript',
    analysis: 'derivedKindAnalysis',
    embedding: 'derivedKindEmbedding',
    proxy: 'derivedKindProxy',
    proof: 'derivedKindProof',
    preview: 'derivedKindPreview'
  }
  return messages[keys[kind]]
}

function derivedStatusLabel(messages: Messages, status: DerivedMediaRecordProjection['status']): string {
  const keys: Record<DerivedMediaRecordProjection['status'], keyof Messages> = {
    queued: 'derivedStateQueued',
    running: 'derivedStateRunning',
    partial: 'derivedStatePartial',
    ready: 'derivedStateReady',
    failed: 'derivedStateFailed',
    cancelled: 'derivedStateCancelled',
    interrupted: 'derivedStateInterrupted',
    invalid: 'derivedStateInvalid'
  }
  return messages[keys[status]]
}

function TranscriptPanel({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const { state } = controller
  const project = state.project!
  const [query, setQuery] = useState('')
  const transcripts = state.selectedAssetId
    ? project.transcripts.filter(({ assetId }) => assetId === state.selectedAssetId)
    : project.transcripts
  const allSegments = transcripts.flatMap((transcript) => transcript.segments.map((segment) => ({ ...segment, assetId: transcript.assetId })))
  const normalizedQuery = query.trim().toLocaleLowerCase(state.locale?.language)
  const segments = normalizedQuery
    ? allSegments.filter((segment) => segment.text.toLocaleLowerCase(state.locale?.language).includes(normalizedQuery))
    : allSegments
  const start = Math.min(state.transcriptWindowStart, Math.max(0, segments.length - 1))
  const visible = segments.slice(start, start + VIEW_LIMITS.virtualWindow)
  const active = activeTranscriptSegment(project, state.selectedAssetId, state.playheadFrame)
  return (
    <Panel title={messages.smartScript} className="transcript-panel" actions={<span className="local-ready-status"><i aria-hidden="true" />{messages.localTranscriptReady}</span>}>
      <div className="transcript-toolbar">
        <label className="transcript-search"><span className="sr-only">{messages.searchTranscript}</span><input type="search" value={query} placeholder={messages.searchTranscript} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="transcript-actions">
          <button type="button" className="quiet-button" onClick={() => void controller.importTranscript()}>{messages.importTranscript}</button>
          <button type="button" className="quiet-button" onClick={() => void controller.checkLocalTranscriber()}>{messages.checkLocalTranscriber}</button>
          <button type="button" className="primary-action" disabled={allSegments.length === 0} onClick={() => void controller.generateCaptions()}>{messages.generateCaptions}</button>
        </div>
        <VirtualControls start={start} total={segments.length} onChange={controller.setTranscriptWindow} messages={messages} />
      </div>
      {segments.length === 0 ? <EmptyState>{messages.noTranscript}</EmptyState> : (
        <ol
          className="transcript-list"
          start={start + 1}
          aria-label={messages.timedTranscriptSegments}
          data-scroll-region="transcript"
          data-total={segments.length}
          tabIndex={0}
        >
          {visible.map((segment) => (
            <li key={`${segment.assetId}:${segment.id}`} className="transcript-row">
              <button
                type="button"
                className={active?.id === segment.id ? 'transcript-segment active' : 'transcript-segment'}
                aria-current={active?.id === segment.id ? 'true' : undefined}
                onClick={() => controller.seek(segmentTimelineFrame(project, segment.assetId, segment.startUs))}
              >
                <span className="transcript-identity"><span className="transcript-avatar" aria-hidden="true">✦</span><time>{formatTime(segment.startUs / 1_000_000)}</time></span>
                <span className="transcript-copy">
                  <span>{segment.text}</span>
                  {segment.speakerAttribution && (
                    <small className={`speaker-attribution ${segment.speakerAttribution.status}`}>
                      {speakerAttributionLabel(messages, segment.speakerAttribution)}
                    </small>
                  )}
                </span>
                {segment.tags?.map((tag) => <em key={tag}>{transcriptTagLabel(messages, tag)}</em>)}
              </button>
              <button
                type="button"
                className="quiet-button transcript-cut"
                aria-label={messages.removeTranscriptRange}
                title={messages.removeTranscriptRange}
                onClick={() => void controller.applyScript([{
                  assetId: segment.assetId,
                  startUs: segment.startUs,
                  endUs: segment.endUs,
                  reason: segment.tags?.includes('silence') ? 'silence' : segment.tags?.includes('filler') ? 'filler' : 'selection'
                }])}
              >
                <span aria-hidden="true">•••</span>
              </button>
            </li>
          ))}
        </ol>
      )}
      {transcripts.some(({ truncated }) => truncated) && <p className="notice notice-warning">{messages.transcriptTruncated}</p>}
      <p className="boundary-note">{messages.transcriptEvidenceBoundary}</p>
      <ScriptReview controller={controller} messages={messages} />
    </Panel>
  )
}

function ScriptReview({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const script = controller.state.script
  const [ranges, setRanges] = useState('[]')
  const [rangeError, setRangeError] = useState('')
  const apply = (): void => {
    try {
      const parsed: unknown = JSON.parse(ranges)
      if (!Array.isArray(parsed)) throw new Error(messages.rangesRequired)
      setRangeError('')
      void controller.applyScript(parsed as Array<{ assetId: string; startUs: number; endUs: number; reason?: 'filler' | 'silence' | 'selection' }>)
    } catch {
      setRangeError(messages.invalidRanges)
    }
  }
  return (
    <details className="script-review">
      <summary>{messages.readScript}</summary>
      {!script ? (
        <button type="button" onClick={() => void controller.readScript()}>{messages.readScript}</button>
      ) : (
        <div className="field-stack">
          <span className="subtle">{messages.revisionLabel} {script.revision} · {messages.digestLabel} {script.digest.slice(0, 12) || messages.unavailable}</span>
          <label><span>{messages.revisionBoundTimeline}</span><textarea rows={12} value={script.markdown} readOnly /></label>
          <small>{messages.revisionBoundTimelineReadonly}</small>
          <label><span>{messages.explicitSourceRanges} (JSON)</span><textarea rows={4} value={ranges} onChange={(event) => setRanges(event.target.value)} aria-describedby="range-help" /></label>
          <small id="range-help">{messages.example}: [{`{"assetId":"asset-1","startUs":1000000,"endUs":1300000,"reason":"filler"}`}]</small>
          {rangeError && <p className="field-error" role="alert">{rangeError}</p>}
          <div className="button-row"><button type="button" onClick={apply} disabled={controller.state.busy}>{messages.apply}</button><button type="button" className="quiet-button" onClick={() => void controller.readScript()}>{messages.reload}</button></div>
        </div>
      )}
    </details>
  )
}

function MediaPlayer(props: {
  url?: string
  kind?: string
  title?: string
  project: ProjectProjection
  timelineSource?: TimelineSource
  caption?: CaptionProjection
  playheadFrame: number
  playing: boolean
  onSeek(frame: number): void
  onPlaybackChange(playing: boolean): void
  onResourceError(): void
  messages: Messages
}): React.JSX.Element {
  const mediaRef = useRef<HTMLMediaElement | null>(null)
  const seconds = props.timelineSource
    ? props.timelineSource.sourceTimeUs / 1_000_000
    : frameToSeconds(props.project, props.playheadFrame)
  useEffect(() => {
    const media = mediaRef.current
    if (media && Math.abs(media.currentTime - seconds) > 0.2) media.currentTime = seconds
  }, [props.url, seconds])
  useEffect(() => {
    const media = mediaRef.current
    if (!media) return
    media.playbackRate = props.timelineSource?.playbackRate ?? 1
    if (props.playing) void media.play().catch(() => props.onPlaybackChange(false))
    else media.pause()
  }, [props.playing, props.timelineSource?.playbackRate, props.url])
  const bind = (element: HTMLMediaElement | null): void => { mediaRef.current = element }
  const update = (): void => {
    const media = mediaRef.current
    if (!media) return
    props.onSeek(props.timelineSource
      ? projectFrameFromSourceTime(props.project, props.timelineSource, media.currentTime)
      : Math.round(media.currentTime * props.project.fps.numerator / props.project.fps.denominator))
  }
  if (!props.url) {
    return <div className={`player-stage aspect-${props.project.canvas.preset.replace(':', '-')}`}><EmptyState>{props.messages.selectMediaPreview}</EmptyState></div>
  }
  if (props.kind === 'image') {
    return <div className={`player-stage aspect-${props.project.canvas.preset.replace(':', '-')}`}><img src={props.url} alt={props.title ? `${props.messages.proofFrame}: ${props.title}` : props.messages.generatedProofFrame} onError={props.onResourceError} /></div>
  }
  if (props.kind === 'audio') {
    return <div className="player-stage audio-stage"><div className="audio-visual" aria-hidden="true">{props.messages.audioAbbreviation}</div><audio ref={bind} src={props.url} controls onTimeUpdate={update} onPlay={() => props.onPlaybackChange(true)} onPause={() => props.onPlaybackChange(false)} onError={props.onResourceError} aria-label={props.title ?? props.messages.audioPreview} />{props.caption && <CaptionOverlay caption={props.caption} />}</div>
  }
  const videoStyle: CSSProperties = props.timelineSource ? {
    objectFit: props.project.canvas.fit === 'crop' ? 'cover' : 'contain',
    opacity: props.timelineSource.item.opacity,
    transform: `translate(${props.timelineSource.item.transform.x}px, ${props.timelineSource.item.transform.y}px) scale(${props.timelineSource.item.transform.scaleX}, ${props.timelineSource.item.transform.scaleY}) rotate(${props.timelineSource.item.transform.rotation}deg)`
  } : {}
  return <div className={`player-stage aspect-${props.project.canvas.preset.replace(':', '-')}`} style={{ background: props.project.canvas.background }}><video ref={bind} src={props.url} style={videoStyle} controls playsInline onTimeUpdate={update} onPlay={() => props.onPlaybackChange(true)} onPause={() => props.onPlaybackChange(false)} onError={props.onResourceError} aria-label={props.title ?? props.messages.videoPreview} />{props.caption && <CaptionOverlay caption={props.caption} />}</div>
}

function CaptionOverlay({ caption }: { caption: CaptionProjection }): React.JSX.Element {
  return <div
    className={`caption-overlay caption-${caption.placement}`}
    style={{
      color: caption.style?.color,
      background: caption.style?.background,
      fontSize: caption.style?.fontSize
    }}
  >{caption.text}</div>
}

function PlayerControls({ controller, project, messages }: { controller: EditorController; project: ProjectProjection; messages: Messages }): React.JSX.Element {
  return (
    <div className="transport" aria-label={messages.playerControls}>
      <button type="button" className="transport-icon" aria-label="-5s" title="-5s" onClick={() => controller.seek(Math.max(0, controller.state.playheadFrame - Math.round(project.fps.numerator / project.fps.denominator * 5)))}><WorkbenchIcon name="back" /></button>
      <button type="button" className="primary-transport transport-icon" aria-label={controller.state.playing ? messages.pause : messages.play} aria-pressed={controller.state.playing} onClick={controller.togglePlaying}><WorkbenchIcon name={controller.state.playing ? 'pause' : 'play'} /><span className="sr-only">{controller.state.playing ? messages.pause : messages.play}</span></button>
      <button type="button" className="transport-icon" aria-label="+5s" title="+5s" onClick={() => controller.seek(Math.min(project.durationFrames, controller.state.playheadFrame + Math.round(project.fps.numerator / project.fps.denominator * 5)))}><WorkbenchIcon name="forward" /></button>
      <label className="scrubber"><span>{messages.timelinePosition}</span><input type="range" min={0} max={Math.max(1, project.durationFrames)} value={controller.state.playheadFrame} onChange={(event) => controller.seek(Number(event.target.value))} /></label>
      <output>{formatTime(frameToSeconds(project, controller.state.playheadFrame))} / {formatTime(frameToSeconds(project, project.durationFrames))}</output>
    </div>
  )
}

function TimelinePanel({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const project = controller.state.project!
  return (
    <Panel title={messages.timeline} className="timeline-panel">
      <SpatialTimeline controller={controller} messages={messages} />
      <EditToolbar controller={controller} project={project} messages={messages} />
    </Panel>
  )
}

function EditToolbar({ controller, project, messages }: { controller: EditorController; project: ProjectProjection; messages: Messages }): React.JSX.Element {
  const item = project.items.find(({ id }) => id === controller.state.selectedItemId)
  const [trimStart, setTrimStart] = useState(0)
  const [trimEnd, setTrimEnd] = useState(0)
  const [trackId, setTrackId] = useState('')
  const [beforeItemId, setBeforeItemId] = useState('')
  useEffect(() => {
    if (!item) return
    setTrimStart(item.timelineStartFrame)
    setTrimEnd(item.timelineStartFrame + item.durationFrames)
    setTrackId(item.trackId)
  }, [item])
  return (
    <div className="edit-toolbar" aria-label={messages.manualTimelineEditing}>
      <div className="selection-quick-summary" data-empty={item ? 'false' : 'true'}>
        <span className="selection-quick-icon"><WorkbenchIcon name="clips" /></span>
        <span><strong>{item?.id ?? messages.timeline}</strong><small>{item ? `${item.durationFrames}f · ${trackDisplayName(messages, project.tracks.find(({ id }) => id === item.trackId) ?? project.tracks[0]!)}` : messages.noSelection}</small></span>
      </div>
      <div className="selection-quick-actions">
        <button type="button" aria-label={messages.splitAtPlayhead} onClick={() => item && void splitAtPlayhead(controller, project, item, messages)} disabled={!item}><WorkbenchIcon name="split" /><span>{messages.splitAtPlayhead}</span></button>
        <button type="button" className="danger-button" aria-label={messages.deleteItem} onClick={() => item && window.confirm(messages.deleteItemConfirm) && void deleteTimelineItem(controller, project, item, messages)} disabled={!item}><WorkbenchIcon name="delete" /><span>{messages.deleteItem}</span></button>
        <button type="button" aria-label={messages.workspaceProperties} onClick={() => controller.setActiveWorkspace('properties')} disabled={!item}><WorkbenchIcon name="properties" /><span>{messages.workspaceProperties}</span></button>
      </div>
      <details className="precision-edit">
        <summary>{messages.manualTimelineEditing}</summary>
        <div className="precision-edit-grid">
          <label><span>{messages.trimIn} ({messages.frames})</span><input type="number" min={item?.timelineStartFrame ?? 0} max={trimEnd - 1} value={trimStart} onChange={(event) => setTrimStart(Number(event.target.value))} disabled={!item} /></label>
          <label><span>{messages.trimOut} ({messages.frames})</span><input type="number" min={trimStart + 1} max={item ? item.timelineStartFrame + item.durationFrames : 1} value={trimEnd} onChange={(event) => setTrimEnd(Number(event.target.value))} disabled={!item} /></label>
          <button type="button" disabled={!item} onClick={() => item && applyToolbarTrim(controller, project, item, trimStart, trimEnd, messages)}>{messages.applyTrim}</button>
          <label><span>{messages.track}</span><select value={trackId} onChange={(event) => setTrackId(event.target.value)} disabled={!item}>{compatibleTracks(project.tracks, item).map((track) => <option key={track.id} value={track.id}>{trackDisplayName(messages, track)}</option>)}</select></label>
          <button type="button" disabled={!item || !trackId} onClick={() => item && applyToolbarMove(controller, project, item, trackId, messages)}>{messages.moveTrack}</button>
          <label><span>{messages.placeBefore}</span><select value={beforeItemId} onChange={(event) => setBeforeItemId(event.target.value)} disabled={!item}><option value="">{messages.endOfTrack}</option>{project.items.filter((candidate) => candidate.trackId === item?.trackId && candidate.id !== item?.id).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.id}</option>)}</select></label>
          <button type="button" disabled={!item} onClick={() => item && void controller.applyOperations([{ type: 'reorder-item', itemId: item.id, ...(beforeItemId ? { beforeItemId } : {}) }], formatMessage(messages.reorderSummary, { id: item.id }))}>{messages.reorder}</button>
        </div>
      </details>
    </div>
  )
}

function applyToolbarTrim(
  controller: EditorController,
  project: ProjectProjection,
  item: ItemProjection,
  startFrame: number,
  endFrame: number,
  messages: Messages
): void {
  const operations = linkedTrimOperations(project, item, startFrame, endFrame)
  if (operations.length === 0) return
  void controller.applyOperations(
    operations,
    formatMessage(operations.length > 1 ? messages.trimLinkedSummary : messages.trimSummary, { id: item.id })
  )
}

function applyToolbarMove(
  controller: EditorController,
  project: ProjectProjection,
  item: ItemProjection,
  trackId: string,
  messages: Messages
): void {
  const operations = linkedMoveOperations(project, item, item.timelineStartFrame, trackId)
  if (operations.length === 0) return
  void controller.applyOperations(
    operations,
    formatMessage(operations.length > 1 ? messages.moveLinkedSummary : messages.moveSummary, { id: item.id })
  )
}

const KEYFRAME_PROPERTIES = [
  'transform.x', 'transform.y', 'transform.scaleX', 'transform.scaleY', 'transform.rotation',
  'crop.left', 'crop.top', 'crop.right', 'crop.bottom', 'opacity', 'volume'
] as const

const EFFECT_CATALOG = [
  { type: 'color.basic', label: (messages: Messages) => messages.effectColorBasic, parameters: {
    brightness: { defaultValue: 0, min: -1, max: 1, step: 0.01 },
    contrast: { defaultValue: 1, min: 0, max: 2, step: 0.01 },
    saturation: { defaultValue: 1, min: 0, max: 3, step: 0.01 },
    gamma: { defaultValue: 1, min: 0.1, max: 10, step: 0.05 }
  } },
  { type: 'color.temperature', label: (messages: Messages) => messages.effectColorTemperature, parameters: {
    temperature: { defaultValue: 0, min: -1, max: 1, step: 0.01 },
    tint: { defaultValue: 0, min: -1, max: 1, step: 0.01 }
  } },
  { type: 'blur', label: (messages: Messages) => messages.effectBlur, parameters: {
    radius: { defaultValue: 2, min: 0, max: 100, step: 1 }
  } },
  { type: 'sharpen', label: (messages: Messages) => messages.effectSharpen, parameters: {
    amount: { defaultValue: 1, min: 0, max: 5, step: 0.05 }
  } },
  { type: 'vignette', label: (messages: Messages) => messages.effectVignette, parameters: {
    intensity: { defaultValue: 0.35, min: 0, max: 1, step: 0.01 }
  } }
] as const

function EffectRow(props: {
  item: ItemProjection
  effect: NonNullable<ItemProjection['effects']>[number]
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { item, effect, controller, messages } = props
  const [parameters, setParameters] = useState(effect.parameters)
  useEffect(() => setParameters(effect.parameters), [effect.parameters])
  const definition = EFFECT_CATALOG.find(({ type }) => type === effect.type)
  const update = (next: Partial<typeof effect> = {}): void => {
    void controller.applyOperations([{
      type: 'set-item-effects',
      itemId: item.id,
      effects: (item.effects ?? []).map((candidate) => candidate.id === effect.id
        ? { ...candidate, ...next, parameters }
        : candidate)
    }], formatMessage(messages.effectUpdatedSummary, { effect: effect.type, id: item.id }))
  }
  const remove = (): void => {
    const keyframes = (item.keyframes ?? []).filter(({ property }) => !property.startsWith(`effect.${effect.id}.`))
    void controller.applyOperations([
      { type: 'set-item-keyframes', itemId: item.id, keyframes },
      { type: 'set-item-effects', itemId: item.id, effects: (item.effects ?? []).filter(({ id }) => id !== effect.id) }
    ], formatMessage(messages.effectRemovedSummary, { effect: effect.type, id: item.id }))
  }
  return <article className="effect-row">
    <header><label><input type="checkbox" checked={effect.enabled} onChange={(event) => update({ enabled: event.target.checked })} />{definition?.label(messages) ?? effect.type}</label><button type="button" onClick={remove}>{messages.remove}</button></header>
    <div className="effect-parameters">{Object.entries(parameters).map(([key, value]) => {
      const parameter = definition?.parameters[key as keyof typeof definition.parameters] as { min: number; max: number; step: number } | undefined
      return typeof value === 'number'
        ? <label key={key}><span>{key}</span><input type="number" min={parameter?.min} max={parameter?.max} step={parameter?.step ?? 0.01} value={value} onChange={(event) => setParameters((current) => ({ ...current, [key]: Number(event.target.value) }))} onBlur={() => update()} /></label>
        : null
    })}</div>
  </article>
}

function decimalRational(value: number): { numerator: number; denominator: number } {
  const denominator = 1_000
  const numerator = Math.max(1, Math.round(value * denominator))
  const divisor = greatestCommonDivisor(numerator, denominator)
  return { numerator: numerator / divisor, denominator: denominator / divisor }
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = Math.abs(left)
  let b = Math.abs(right)
  while (b > 0) [a, b] = [b, a % b]
  return a || 1
}

function InspectorPanel(props: { controller: EditorController; item?: ItemProjection; caption?: CaptionProjection; messages: Messages }): React.JSX.Element {
  const { controller, item, caption, messages } = props
  const project = controller.state.project!
  const [x, setX] = useState(0)
  const [y, setY] = useState(0)
  const [scale, setScale] = useState(1)
  const [rotation, setRotation] = useState(0)
  const [opacity, setOpacity] = useState(1)
  const [crop, setCrop] = useState({ left: 0, top: 0, right: 0, bottom: 0 })
  const [blendMode, setBlendMode] = useState<NonNullable<ItemProjection['blendMode']>>('normal')
  const [speed, setSpeed] = useState(1)
  const [volume, setVolume] = useState(1)
  const [fadeInFrames, setFadeInFrames] = useState(0)
  const [fadeOutFrames, setFadeOutFrames] = useState(0)
  const [muted, setMuted] = useState(false)
  const [effectType, setEffectType] = useState<string>(EFFECT_CATALOG[0]!.type)
  const [keyframeProperty, setKeyframeProperty] = useState('opacity')
  const [keyframeValue, setKeyframeValue] = useState(1)
  const [keyframeInterpolation, setKeyframeInterpolation] = useState<'hold' | 'linear' | 'ease'>('linear')
  useEffect(() => {
    if (!item) return
    setX(item.transform.x)
    setY(item.transform.y)
    setScale(item.transform.scaleX)
    setRotation(item.transform.rotation)
    setOpacity(item.opacity)
    setCrop(item.crop ?? { left: 0, top: 0, right: 0, bottom: 0 })
    setBlendMode(item.blendMode ?? 'normal')
    setSpeed(item.speed.numerator / item.speed.denominator)
    setVolume(item.volume ?? 1)
    setFadeInFrames(item.fadeInFrames)
    setFadeOutFrames(item.fadeOutFrames)
    setMuted(item.muted ?? false)
  }, [item])
  const selectedAsset = item ? project.assets.find(({ id }) => id === item.assetId) : undefined
  const applyComposition = (): void => {
    if (!item || crop.left + crop.right >= 1 || crop.top + crop.bottom >= 1 || speed <= 0) return
    const operations: TimelineOperation[] = [
      { type: 'update-transform', itemId: item.id, transform: { x, y, scaleX: scale, scaleY: scale, rotation } },
      { type: 'update-item-composition', itemId: item.id, crop, opacity, blendMode }
    ]
    if (Math.abs(speed - item.speed.numerator / item.speed.denominator) > 0.000001) {
      operations.push({ type: 'retime-item', itemId: item.id, speed: decimalRational(speed) })
    }
    void controller.applyOperations(operations, formatMessage(messages.compositionSummary, { id: item.id }))
  }
  const addEffect = (): void => {
    if (!item) return
    const definition = EFFECT_CATALOG.find(({ type }) => type === effectType)
    if (!definition) return
    const effect = {
      id: `${effectType.replace(/[^a-z0-9]+/giu, '-')}-${Date.now().toString(36)}`.slice(0, 128),
      type: definition.type,
      enabled: true,
      parameters: Object.fromEntries(Object.entries(definition.parameters).map(([key, value]) => [key, value.defaultValue]))
    }
    void controller.applyOperations(
      [{ type: 'set-item-effects', itemId: item.id, effects: [...(item.effects ?? []), effect] }],
      formatMessage(messages.effectAddedSummary, { effect: definition.label(messages), id: item.id })
    )
  }
  const applyAudio = (): void => {
    if (!item) return
    void controller.applyOperations([{
      type: 'update-item-properties',
      itemId: item.id,
      volume,
      fadeInFrames: Math.max(0, Math.round(fadeInFrames)),
      fadeOutFrames: Math.max(0, Math.round(fadeOutFrames)),
      muted
    }], formatMessage(messages.audioPropertiesSummary, { id: item.id }))
  }
  const upsertKeyframe = (): void => {
    if (!item || !Number.isFinite(keyframeValue)) return
    const localFrame = Math.max(0, Math.min(item.durationFrames, controller.state.playheadFrame - item.timelineStartFrame))
    const tracks = structuredClone(item.keyframes ?? [])
    let track = tracks.find(({ property }) => property === keyframeProperty)
    if (!track) {
      track = {
        id: `keyframes-${keyframeProperty.replace(/[^a-z0-9]+/giu, '-')}`.slice(0, 128),
        property: keyframeProperty,
        interpolation: keyframeInterpolation,
        points: []
      }
      tracks.push(track)
    }
    track.interpolation = keyframeInterpolation
    track.points = [
      ...track.points.filter(({ frame }) => frame !== localFrame),
      { id: `${track.id}-${localFrame}`.slice(0, 128), frame: localFrame, value: keyframeValue }
    ].sort((left, right) => left.frame - right.frame)
    void controller.applyOperations(
      [{ type: 'set-item-keyframes', itemId: item.id, keyframes: tracks }],
      formatMessage(messages.keyframeSummary, { property: keyframeProperty, frame: localFrame })
    )
  }
  return (
    <Panel title={messages.inspector}>
      {!item && !caption ? <EmptyState>{messages.noSelection}</EmptyState> : item ? (
        <div className="inspector-stack">
          <section className="selected-item-hero">
            <span className={`selected-item-thumb media-kind-${selectedAsset?.kind ?? 'video'}`} aria-hidden="true"><WorkbenchIcon name="clips" /></span>
            <span className="selected-item-copy"><small>{messages.selectedClip}</small><strong>{selectedAsset?.name ?? item.id}</strong><span>{formatTime(frameToSeconds(project, item.durationFrames))} · {item.trackId}</span></span>
            <button type="button" className="quiet-button" onClick={() => controller.seek(item.timelineStartFrame)}>{messages.locateOnTimeline}</button>
          </section>
          {item.nestedSequenceId && <div className="nested-sequence-actions wide-field"><strong>{messages.nestedSequence}</strong><span>{item.nestedSequenceId}</span><div className="button-row"><button type="button" onClick={() => void controller.selectSequence(item.nestedSequenceId!)}>{messages.openNestedSequence}</button><button type="button" onClick={() => window.confirm(messages.decomposeNestedConfirm) && void controller.decomposeNested(item.id)}>{messages.decomposeNestedSequence}</button></div></div>}
          <details className="inspector-section" open><summary>{messages.propertiesTransform}<span aria-hidden="true">⌄</span></summary><div className="field-grid inspector-grid">
            <label><span>X</span><input type="number" value={x} onChange={(event) => setX(Number(event.target.value))} /></label>
            <label><span>Y</span><input type="number" value={y} onChange={(event) => setY(Number(event.target.value))} /></label>
            <label><span>{messages.scale}</span><input type="number" min="0.01" max="10" step="0.05" value={scale} onChange={(event) => setScale(Number(event.target.value))} /></label>
            <label><span>{messages.rotation}</span><input type="number" step="1" value={rotation} onChange={(event) => setRotation(Number(event.target.value))} /></label>
            <label><span>{messages.speed}</span><input type="number" min="0.05" max="16" step="0.05" value={speed} onChange={(event) => setSpeed(Number(event.target.value))} /></label>
            <details className="inspector-crop-fields"><summary>{messages.crop}</summary><div className="field-grid">{(['left', 'top', 'right', 'bottom'] as const).map((edge) => <label key={edge}><span>{messages[`crop${edge[0]!.toUpperCase()}${edge.slice(1)}` as keyof Messages]}</span><input type="number" min="0" max="0.95" step="0.01" value={crop[edge]} onChange={(event) => setCrop((current) => ({ ...current, [edge]: Number(event.target.value) }))} /></label>)}</div></details>
          </div></details>
          <details className="inspector-section" open><summary>{messages.propertiesAppearance}<span aria-hidden="true">⌄</span></summary><div className="field-grid inspector-grid">
            <label className="property-slider wide-field"><span>{messages.opacity}</span><span><input type="range" min="0" max="1" step="0.01" value={opacity} onChange={(event) => setOpacity(Number(event.target.value))} /><output>{Math.round(opacity * 100)}%</output></span></label>
            <label><span>{messages.blendMode}</span><select value={blendMode} onChange={(event) => setBlendMode(event.target.value as typeof blendMode)}><option value="normal">{messages.blendNormal}</option><option value="multiply">{messages.blendMultiply}</option><option value="screen">{messages.blendScreen}</option><option value="overlay">{messages.blendOverlay}</option></select></label>
            <button type="button" className="primary-action" onClick={applyComposition}>{messages.applyComposition}</button>
          </div></details>
          <details className="inspector-section"><summary>{messages.propertiesAudio}<span aria-hidden="true">⌄</span></summary><div className="field-grid inspector-grid">
            <label className="property-slider wide-field"><span>{messages.volume}</span><span><input type="range" min="0" max="2" step="0.01" value={volume} onChange={(event) => setVolume(Number(event.target.value))} /><output>{Math.round(volume * 100)}%</output></span></label>
            <label><span>{messages.fadeIn}</span><input type="number" min="0" max={item.durationFrames} value={fadeInFrames} onChange={(event) => setFadeInFrames(Number(event.target.value))} /></label>
            <label><span>{messages.fadeOut}</span><input type="number" min="0" max={item.durationFrames} value={fadeOutFrames} onChange={(event) => setFadeOutFrames(Number(event.target.value))} /></label>
            <label className="checkbox-field wide-field"><input type="checkbox" checked={muted} onChange={(event) => setMuted(event.target.checked)} /><span>{messages.muted}</span></label>
            <button type="button" className="primary-action" onClick={applyAudio}>{messages.applyAudioProperties}</button>
          </div></details>
          <details className="inspector-section"><summary>{messages.effects}<span aria-hidden="true">⌄</span></summary><fieldset className="effect-editor"><legend className="sr-only">{messages.effects}</legend><div className="button-row"><select aria-label={messages.effectCatalog} value={effectType} onChange={(event) => setEffectType(event.target.value)}>{EFFECT_CATALOG.map((effect) => <option key={effect.type} value={effect.type}>{effect.label(messages)}</option>)}</select><button type="button" onClick={addEffect}>{messages.addEffect}</button></div>{(item.effects ?? []).map((effect) => <EffectRow key={effect.id} item={item} effect={effect} controller={controller} messages={messages} />)}</fieldset></details>
          <details className="inspector-section"><summary>{messages.propertiesAnimation}<span aria-hidden="true">⌄</span></summary><fieldset className="keyframe-editor"><legend className="sr-only">{messages.keyframes}</legend><label><span>{messages.keyframeProperty}</span><select value={keyframeProperty} onChange={(event) => setKeyframeProperty(event.target.value)}>{KEYFRAME_PROPERTIES.map((property) => <option key={property} value={property}>{property}</option>)}{(item.effects ?? []).flatMap((effect) => Object.entries(effect.parameters).filter(([, value]) => typeof value === 'number').map(([parameter]) => <option key={`${effect.id}.${parameter}`} value={`effect.${effect.id}.${parameter}`}>{effect.type} · {parameter}</option>))}</select></label><label><span>{messages.value}</span><input type="number" step="0.01" value={keyframeValue} onChange={(event) => setKeyframeValue(Number(event.target.value))} /></label><label><span>{messages.interpolation}</span><select value={keyframeInterpolation} onChange={(event) => setKeyframeInterpolation(event.target.value as typeof keyframeInterpolation)}><option value="hold">{messages.interpolationHold}</option><option value="linear">{messages.interpolationLinear}</option><option value="ease">{messages.interpolationEase}</option></select></label><button type="button" onClick={upsertKeyframe}>{messages.setKeyframeAtPlayhead}</button><ul>{(item.keyframes ?? []).map((track) => <li key={track.id}><span>{track.property} · {track.points.length}</span><button type="button" onClick={() => void controller.applyOperations([{ type: 'set-item-keyframes', itemId: item.id, keyframes: (item.keyframes ?? []).filter(({ id }) => id !== track.id) }], formatMessage(messages.removeKeyframeTrackSummary, { property: track.property }))}>{messages.remove}</button></li>)}</ul></fieldset></details>
        </div>
      ) : <p>{messages.captionSelected}: <strong>{caption?.id}</strong>. {messages.captions}</p>}
      <details className="inspector-section canvas-section"><summary>{messages.canvasAndFit}<span aria-hidden="true">⌄</span></summary><fieldset className="aspect-controls"><legend className="sr-only">{messages.canvasAndFit}</legend>{(['16:9', '9:16', '1:1'] as const).map((preset) => <button type="button" key={preset} aria-pressed={project.canvas.preset === preset} onClick={() => void controller.applyOperations([{ type: 'set-canvas', preset, fit: project.canvas.fit }], formatMessage(messages.canvasSummary, { preset }))}>{preset}</button>)}<label><span>{messages.fitPolicy}</span><select value={project.canvas.fit} onChange={(event) => void controller.applyOperations([{ type: 'set-canvas', preset: project.canvas.preset, fit: event.target.value as 'fit' | 'crop' | 'pad' }], messages.fitSummary)}><option value="fit">{messages.fit}</option><option value="crop">{messages.crop}</option><option value="pad">{messages.pad}</option></select></label></fieldset></details>
      <p className="boundary-note">{messages.canvasBoundary}</p>
    </Panel>
  )
}

function CaptionPanel({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const project = controller.state.project!
  const selected = project.captions.find(({ id }) => id === controller.state.selectedCaptionId)
  const [text, setText] = useState('')
  const [start, setStart] = useState(0)
  const [end, setEnd] = useState(30)
  const [placement, setPlacement] = useState<'top' | 'center' | 'bottom'>('bottom')
  const [animation, setAnimation] = useState<'none' | 'word-highlight' | 'fade'>('none')
  const [animationDuration, setAnimationDuration] = useState(0)
  useEffect(() => {
    if (!selected) return
    setText(selected.text)
    setStart(selected.startFrame)
    setEnd(selected.endFrame)
    setPlacement(selected.placement)
    setAnimation(selected.animation?.kind ?? 'none')
    setAnimationDuration(selected.animation?.durationFrames ?? 0)
  }, [selected])
  const save = (): void => {
    const captionTrack = project.tracks.find(({ kind }) => kind === 'caption')
    if (!captionTrack || !text.trim() || end <= start) return
    const captionAnimation = {
      kind: animation,
      ...(animation !== 'none' ? { durationFrames: Math.max(0, Math.round(animationDuration)) } : {})
    }
    const operation: TimelineOperation = selected
      ? { type: 'update-caption', captionId: selected.id, patch: { text: text.trim(), startFrame: start, endFrame: end, placement, animation: captionAnimation } }
      : { type: 'add-caption', caption: { id: `caption-${Date.now().toString(36)}`, trackId: captionTrack.id, startFrame: start, endFrame: end, text: text.trim(), placement, animation: captionAnimation } }
    void controller.applyOperations(
      [operation],
      selected ? formatMessage(messages.updateCaptionSummary, { id: selected.id }) : messages.addCaptionSummary
    )
  }
  return (
    <Panel title={messages.captions}>
      <div className="caption-layout">
        <ul className="caption-list">{project.captions.slice(0, VIEW_LIMITS.virtualWindow).map((caption) => <li key={caption.id}><button type="button" aria-pressed={selected?.id === caption.id} onClick={() => controller.selectCaption(caption.id)}><span className="caption-copy"><span>{caption.text}</span>{caption.speakerAttribution && <small className={`speaker-attribution ${caption.speakerAttribution.status}`}>{speakerAttributionLabel(messages, caption.speakerAttribution)}</small>}</span><small>{caption.startFrame}–{caption.endFrame}f</small></button></li>)}</ul>
        <div className="field-grid">
          <label className="wide-field"><span>{messages.captionText}</span><textarea rows={3} value={text} maxLength={4096} onChange={(event) => setText(event.target.value)} /></label>
          <label><span>{messages.startFrame}</span><input type="number" min={0} value={start} onChange={(event) => setStart(Number(event.target.value))} /></label>
          <label><span>{messages.endFrame}</span><input type="number" min={start + 1} max={Math.max(start + 1, project.durationFrames)} value={end} onChange={(event) => setEnd(Number(event.target.value))} /></label>
          <label><span>{messages.placement}</span><select value={placement} onChange={(event) => setPlacement(event.target.value as typeof placement)}><option value="top">{messages.top}</option><option value="center">{messages.center}</option><option value="bottom">{messages.bottom}</option></select></label>
          <label><span>{messages.captionAnimation}</span><select value={animation} onChange={(event) => setAnimation(event.target.value as typeof animation)}><option value="none">{messages.captionAnimationNone}</option><option value="word-highlight">{messages.captionAnimationWordHighlight}</option><option value="fade">{messages.captionAnimationFade}</option></select></label>
          <label><span>{messages.animationDurationFrames}</span><input type="number" min={0} max={Math.max(0, end - start)} value={animationDuration} disabled={animation === 'none'} onChange={(event) => setAnimationDuration(Number(event.target.value))} /></label>
          <button type="button" onClick={save}>{selected ? messages.updateCaption : messages.addCaption}</button>
          {selected && <button type="button" className="danger-button" onClick={() => window.confirm(messages.deleteCaptionConfirm) && void controller.applyOperations([{ type: 'delete-caption', captionId: selected.id }], formatMessage(messages.deleteCaptionSummary, { id: selected.id }))}>{messages.deleteCaption}</button>}
        </div>
      </div>
    </Panel>
  )
}

function RevisionPanel({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const project = controller.state.project!
  return (
    <Panel title={messages.revisions} actions={<span className="revision-badge">{messages.current} r{project.currentRevision}</span>}>
      <ol className="revision-list" reversed>{[...project.revisions].reverse().map((revision) => <li key={revision.revision} className={revision.revision === project.currentRevision ? 'current' : ''}><strong>r{revision.revision}</strong><span>{revisionSummaryLabel(messages, revision)}</span><small>{revisionAuthorLabel(messages, revision.author)} · {formatTimestamp(revision.timestamp, controller.state.locale?.language)}</small></li>)}</ol>
    </Panel>
  )
}

function AgentSyncPanel({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const { project, lastProjectChange, agentRun } = controller.state
  return (
    <Panel title={messages.agent} actions={<span className="revision-badge">r{project?.currentRevision ?? 0}</span>}>
      <div className="agent-sync-callout">
        <strong>{messages.mainAgent}</strong>
        <p>{messages.mainAgentHelp}</p>
      </div>
      <dl className="agent-sync-grid">
        <div><dt>{messages.activeProject}</dt><dd>{project?.name ?? messages.noProject}</dd></div>
        <div><dt>{messages.activeRevision}</dt><dd>{project ? `r${project.currentRevision}` : '—'}</dd></div>
        <div><dt>{messages.agentTool}</dt><dd><code>{messages.agentToolActive}</code></dd></div>
      </dl>
      <div className="agent-sync-status" role="status" aria-live="polite">
        <span className="agent-sync-dot" aria-hidden="true" />
        <span>{lastProjectChange && lastProjectChange.projectId === project?.id
          ? `${messages.lastSync}: ${projectChangeReasonLabel(messages, lastProjectChange.reason)} · r${lastProjectChange.revision}`
          : messages.agentReady}</span>
      </div>
      {agentRun ? <p className="subtle">{messages.legacyRun}: {agentStateLabel(messages, agentRun.state)}</p> : null}
      <p className="boundary-note">{messages.unsupported}</p>
    </Panel>
  )
}

function PreviewPanel(props: { controller: EditorController; artifacts: GeneratedArtifact[]; messages: Messages }): React.JSX.Element {
  const { controller, artifacts, messages } = props
  const project = controller.state.project!
  const [captionMode, setCaptionMode] = useState<'none' | 'burned'>('none')
  const [sourceKind, setSourceKind] = useState<'asset' | 'timeline' | 'generated'>('timeline')
  const [label, setLabel] = useState('')
  const [leftEntryId, setLeftEntryId] = useState('')
  const [rightEntryId, setRightEntryId] = useState('')
  const [compareMode, setCompareMode] = useState<'wipe' | 'side-by-side'>('wipe')
  const burnedAvailable = hasMediaFeature(controller.state, 'drawtext-filter')
  const history = controller.state.previewHistory
  const visibleAssets = visibleProjectAssets(controller.state)
  const selectedAsset = visibleAssets.find(({ id }) => id === controller.state.selectedAssetId) ?? project.assets[0]
  const generatedAsset = visibleAssets.find(({ generatedLineage }) => generatedLineage && (
    !controller.state.selectedAssetId || controller.state.selectedAssetId === generatedLineage.variantOfAssetId
  )) ?? visibleAssets.find(({ generatedLineage }) => generatedLineage)
  const timelineArtifact = artifacts.find((artifact) => {
    const ticket = ticketForArtifact(controller.state.renderTickets, artifact)
    return ticket?.projectId === project.id && ticket.pinnedRevision === project.currentRevision && artifactUsesPlayer(artifact)
  })
  const activeEntry = history.entries.find(({ id }) => id === history.activeEntryId)
  const comparisonIds = controller.state.previewComparison
    ? [controller.state.previewComparison.leftEntryId, controller.state.previewComparison.rightEntryId]
    : []
  const [comparisonResources, setComparisonResources] = useState<{
    left?: PreviewResource
    right?: PreviewResource
    loading: boolean
  }>({ loading: false })
  const canAddSource = sourceKind === 'timeline' || (sourceKind === 'asset' ? Boolean(selectedAsset) : Boolean(generatedAsset))
  const addSource = (): void => {
    const effectiveLabel = label.trim() || (sourceKind === 'timeline'
      ? messages.timelinePreviewDefaultLabel
      : sourceKind === 'generated'
        ? generatedAsset?.name
        : selectedAsset?.name)
    if (!effectiveLabel) return
    if (sourceKind === 'asset' && selectedAsset) {
      void controller.addPreview({ kind: 'asset', assetId: selectedAsset.id, startUs: 0, endUs: selectedAsset.durationUs }, effectiveLabel)
    } else if (sourceKind === 'generated' && generatedAsset?.generatedLineage) {
      void controller.addPreview({ kind: 'generated', assetId: generatedAsset.id, jobId: generatedAsset.generatedLineage.jobId, variantIndex: 0 }, effectiveLabel)
    } else if (sourceKind === 'timeline') {
      const range = project.selection.range
      void controller.addPreview({
        kind: 'timeline',
        sequenceId: project.activeSequenceId,
        revision: project.currentRevision,
        startFrame: range?.startFrame ?? 0,
        endFrame: range?.endFrame ?? Math.max(1, project.durationFrames),
        ...(timelineArtifact ? { artifactId: timelineArtifact.artifactId } : {})
      }, effectiveLabel)
    }
    setLabel('')
  }
  useEffect(() => {
    if (history.entries.length === 0) {
      setLeftEntryId('')
      setRightEntryId('')
      return
    }
    if (!history.entries.some(({ id }) => id === leftEntryId)) setLeftEntryId(history.entries[0]!.id)
    if (!history.entries.some(({ id }) => id === rightEntryId)) setRightEntryId(history.entries[1]?.id ?? history.entries[0]!.id)
  }, [history.entries, leftEntryId, rightEntryId])
  useEffect(() => {
    const comparison = controller.state.previewComparison
    if (!comparison) {
      setComparisonResources({ loading: false })
      return
    }
    let current = true
    setComparisonResources({ loading: true })
    void Promise.all([
      controller.openPreviewResource(comparison.leftEntryId),
      controller.openPreviewResource(comparison.rightEntryId)
    ]).then(([left, right]) => {
      if (current) setComparisonResources({ ...(left ? { left } : {}), ...(right ? { right } : {}), loading: false })
    }, () => {
      if (current) setComparisonResources({ loading: false })
    })
    return () => { current = false }
  }, [controller.openPreviewResource, controller.state.previewComparison])
  return (
    <Panel title={messages.preview}>
      <div className="button-row">
        <label className="inline-field"><span>{messages.captionsLabel}</span><select value={captionMode} onChange={(event) => setCaptionMode(event.target.value as typeof captionMode)}><option value="none">{messages.captionModeNone}</option><option value="burned" disabled={!burnedAvailable}>{messages.captionModeBurned}</option></select></label>
        <button type="button" disabled={!canRender(controller.state, 'proof-frame', captionMode)} onClick={() => void controller.startRender('proof-frame', captionMode)}>{messages.proofFrame}</button>
        <button type="button" disabled={!canRender(controller.state, 'preview', captionMode)} onClick={() => void controller.startRender('preview', captionMode)}>{messages.previewClip}</button>
      </div>
      {!burnedAvailable && <p className="boundary-note">{messages.burnedCaptionsUnavailable}</p>}
      <section className="preview-history-workbench" aria-label={messages.previewHistory}>
        <div className="preview-source-tabs" role="tablist" aria-label={messages.previewSources}>
          {(['asset', 'timeline', 'generated'] as const).map((kind) => <button
            type="button"
            role="tab"
            key={kind}
            aria-selected={sourceKind === kind}
            onClick={() => setSourceKind(kind)}
          >{kind === 'asset' ? messages.previewSourceAsset : kind === 'timeline' ? messages.previewSourceTimeline : messages.previewSourceGenerated}</button>)}
        </div>
        <div className="preview-source-form">
          <p>{sourceKind === 'asset'
            ? selectedAsset?.name ?? messages.noMedia
            : sourceKind === 'generated'
              ? generatedAsset?.name ?? messages.noGeneratedMedia
              : formatMessage(messages.timelinePreviewRange, {
                start: project.selection.range?.startFrame ?? 0,
                end: project.selection.range?.endFrame ?? project.durationFrames
              })}</p>
          <label><span>{messages.previewLabel}</span><input value={label} maxLength={160} placeholder={messages.previewLabelPlaceholder} onChange={(event) => setLabel(event.target.value)} /></label>
          <button type="button" disabled={!canAddSource || controller.state.busy} onClick={addSource}>{messages.addToPreviewHistory}</button>
        </div>
        {history.entries.length === 0 ? <EmptyState>{messages.emptyPreviewHistory}</EmptyState> : <ul className="preview-history-list">{[...history.entries].reverse().map((entry) => {
          const selected = entry.id === history.activeEntryId
          return <li key={entry.id} data-active={selected ? 'true' : 'false'}>
            <button type="button" className="preview-history-entry" aria-pressed={selected} onClick={() => void controller.selectPreview(entry.id)}>
              <strong>{entry.label}</strong>
              <small>{previewSourceLabel(messages, entry.source.kind)} · {formatTimestamp(entry.createdAt, controller.state.locale?.language)}</small>
            </button>
          </li>
        })}</ul>}
        <div className="preview-history-actions button-row">
          <button type="button" disabled={!activeEntry || !controller.state.selectedItemId || activeEntry.source.kind === 'timeline'} onClick={() => activeEntry && void controller.replaceSelectedFromPreview(activeEntry.id)}>{messages.replaceSelectedClip}</button>
          <button type="button" disabled={!activeEntry && comparisonIds.length === 0} onClick={() => void controller.attachSelection([...new Set([...(activeEntry ? [activeEntry.id] : []), ...comparisonIds])])}>{messages.attachSelectionToAgent}</button>
          <button type="button" onClick={() => void controller.refreshPreviewHistory()}>{messages.refresh}</button>
        </div>
        {history.entries.length >= 2 && <fieldset className="preview-compare"><legend>{messages.comparePreviews}</legend>
          <label><span>{messages.compareLeft}</span><select value={leftEntryId} onChange={(event) => setLeftEntryId(event.target.value)}>{history.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          <label><span>{messages.compareRight}</span><select value={rightEntryId} onChange={(event) => setRightEntryId(event.target.value)}>{history.entries.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select></label>
          <label><span>{messages.compareMode}</span><select value={compareMode} onChange={(event) => setCompareMode(event.target.value as typeof compareMode)}><option value="wipe">{messages.compareWipe}</option><option value="side-by-side">{messages.compareSideBySide}</option></select></label>
          <button type="button" disabled={!leftEntryId || !rightEntryId || leftEntryId === rightEntryId} onClick={() => void controller.comparePreviews(leftEntryId, rightEntryId, compareMode)}>{messages.compare}</button>
        </fieldset>}
        {controller.state.previewComparison && <p className="preview-comparison-status" role="status">{formatMessage(messages.previewComparisonActive, {
          mode: controller.state.previewComparison.mode === 'wipe' ? messages.compareWipe : messages.compareSideBySide,
          revision: controller.state.previewComparison.sameRevision ? messages.sameRevision : messages.differentRevision
        })}</p>}
        {controller.state.previewComparison && (
          comparisonResources.left && comparisonResources.right
            ? <PreviewComparisonViewer
                left={comparisonResources.left}
                right={comparisonResources.right}
                mode={controller.state.previewComparison.mode}
                messages={messages}
              />
            : <p className="subtle" role="status">
                {comparisonResources.loading ? messages.loadingEditor : messages.previewComparisonUnavailable}
              </p>
        )}
        <p className="boundary-note">{messages.previewContextBoundary}</p>
      </section>
      {artifacts.length === 0 ? <EmptyState>{messages.noProofArtifacts}</EmptyState> : <ul className="artifact-list">{artifacts.map((artifact) => {
        const ticket = ticketForArtifact(controller.state.renderTickets, artifact)
        const stale = ticket ? proofIsStale(ticket, project) : false
        const usesPlayer = artifactUsesPlayer(artifact)
        return <li key={artifact.artifactId}><div><strong>{artifact.displayName}</strong><small>{formatBytes(artifact.byteSize)} · {mediaKindLabel(messages, artifact.mediaKind)}</small></div>{stale && <span className="stale-badge">{messages.staleProof}</span>}<p>{messages.technicallyValidated}</p>{!usesPlayer && <p className="subtle">{messages.hostArtifactAction}</p>}<div className="button-row"><button type="button" disabled={artifact.availability !== 'available'} onClick={() => void controller.openArtifact(artifact)}>{usesPlayer ? messages.previewMedia : messages.openWithSystem}</button><button type="button" disabled={artifact.availability !== 'available'} onClick={() => void controller.revealArtifact(artifact)}>{messages.showInFolder}</button></div></li>
      })}</ul>}
    </Panel>
  )
}

export function PreviewComparisonViewer(props: {
  left: PreviewResource
  right: PreviewResource
  mode: 'wipe' | 'side-by-side'
  messages: Messages
}): React.JSX.Element {
  return <figure className={`preview-comparison-viewer mode-${props.mode}`}>
    <div className="preview-comparison-media comparison-left">
      <PreviewComparisonElement resource={props.left} />
      <figcaption>{props.messages.compareLeft}: {props.left.title}</figcaption>
    </div>
    <div className="preview-comparison-media comparison-right">
      <PreviewComparisonElement resource={props.right} />
      <figcaption>{props.messages.compareRight}: {props.right.title}</figcaption>
    </div>
  </figure>
}

function PreviewComparisonElement({ resource }: { resource: PreviewResource }): React.JSX.Element {
  if (resource.mediaKind === 'image') return <img src={resource.url} alt={resource.title} />
  if (resource.mediaKind === 'audio') return <audio src={resource.url} controls aria-label={resource.title} />
  return <video src={resource.url} controls muted playsInline aria-label={resource.title} />
}

function ExportPanel({ controller, jobs, messages }: { controller: EditorController; jobs: JobSnapshot[]; messages: Messages }): React.JSX.Element {
  const [captionMode, setCaptionMode] = useState<'none' | 'burned' | 'sidecar' | 'both'>('none')
  const [subtitleFormat, setSubtitleFormat] = useState<'srt' | 'vtt'>('srt')
  const [outputKind, setOutputKind] = useState<'h264-mp4' | 'audio-aac' | 'subtitles-srt' | 'subtitles-vtt'>('h264-mp4')
  const project = controller.state.project!
  const fps = project.fps.numerator / project.fps.denominator
  const outputOptions = [
    { kind: 'h264-mp4', label: messages.exportVideo, detail: 'MP4 · H.264' },
    { kind: 'audio-aac', label: messages.exportAudio, detail: 'AAC · M4A' },
    { kind: 'subtitles-srt', label: messages.exportSubRip, detail: 'SRT' },
    { kind: 'subtitles-vtt', label: messages.exportWebVtt, detail: 'WebVTT' }
  ] as const
  const canStartExport = outputKind === 'h264-mp4'
    ? canRender(controller.state, 'h264-mp4', captionMode)
    : outputKind === 'audio-aac'
      ? canRender(controller.state, 'audio-aac', 'none')
      : canRender(controller.state, 'subtitles', 'none')
  const startExport = (): void => {
    if (outputKind === 'h264-mp4') void controller.startRender('h264-mp4', captionMode, subtitleFormat)
    else if (outputKind === 'audio-aac') void controller.startRender('audio-aac', 'none')
    else void controller.startRender('subtitles', 'none', outputKind === 'subtitles-srt' ? 'srt' : 'vtt')
  }
  const selectedOutput = outputOptions.find(({ kind }) => kind === outputKind)!
  return (
    <Panel title={messages.export} className="export-panel">
      <section className="delivery-hero">
        <span className="delivery-icon" aria-hidden="true"><WorkbenchIcon name="output" /></span>
        <div><p className="eyebrow">{messages.readyToDeliver}</p><h2>{project.name}</h2><p>{formatMessage(messages.deliverySummary, { revision: project.currentRevision, duration: formatTime(frameToSeconds(project, project.durationFrames)) })}</p></div>
      </section>
      <fieldset className="output-kind-options"><legend>{messages.outputMode}</legend><div>{outputOptions.map((option) => <button type="button" key={option.kind} aria-pressed={outputKind === option.kind} onClick={() => setOutputKind(option.kind)}><span className="output-kind-icon"><WorkbenchIcon name={option.kind === 'h264-mp4' ? 'output' : option.kind === 'audio-aac' ? 'playhead' : 'script'} /></span><span><strong>{option.label}</strong><small>{option.detail}</small></span></button>)}</div></fieldset>
      <div className="export-settings-grid">
        {outputKind === 'h264-mp4' && <label><span>{messages.captionsLabel}</span><select value={captionMode} onChange={(event) => setCaptionMode(event.target.value as typeof captionMode)}><option value="none">{messages.captionModeNone}</option><option value="burned" disabled={!hasMediaFeature(controller.state, 'drawtext-filter')}>{messages.captionModeBurned}</option><option value="sidecar">{messages.captionModeSidecar}</option><option value="both" disabled={!hasMediaFeature(controller.state, 'drawtext-filter')}>{messages.captionModeBoth}</option></select></label>}
        {outputKind === 'h264-mp4' && (captionMode === 'sidecar' || captionMode === 'both') && <label><span>{messages.format}</span><select value={subtitleFormat} onChange={(event) => setSubtitleFormat(event.target.value as typeof subtitleFormat)}><option value="srt">SRT</option><option value="vtt">WebVTT</option></select></label>}
        <dl className="export-facts"><div><dt>{messages.canvas}</dt><dd>{project.canvas.preset}</dd></div><div><dt>{messages.frameRate}</dt><dd>{Number.isInteger(fps) ? fps : fps.toFixed(2)} fps</dd></div><div><dt>{messages.activeRevision}</dt><dd>r{project.currentRevision}</dd></div></dl>
      </div>
      <div className="export-primary-row"><button type="button" className="primary-action export-video-action" disabled={!canStartExport} onClick={startExport}>{selectedOutput.label}<span aria-hidden="true">→</span></button></div>
      {outputKind === 'h264-mp4' && !hasMediaFeature(controller.state, 'drawtext-filter') && <p className="boundary-note">{messages.burnedCaptionsUnavailable}</p>}
      <h3 className="export-jobs-title">{messages.exportQueue}</h3>
      {jobs.length === 0 ? <EmptyState>{messages.emptyJobs}</EmptyState> : <ul className="job-list">{jobs.map((job) => <JobRow key={job.id} job={job} controller={controller} messages={messages} />)}</ul>}
    </Panel>
  )
}

function InterchangePanel({ controller, messages }: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const project = controller.state.project!
  const preview = controller.state.otioImportPreview
  const [targetProjectId, setTargetProjectId] = useState('')
  useEffect(() => {
    setTargetProjectId(preview?.suggestedProjectId ?? '')
  }, [preview?.sourceDocumentDigest, preview?.suggestedProjectId])
  const tickets = controller.state.otioExportTickets
    .filter(({ projectId }) => projectId === project.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const normalizedTarget = targetProjectId.trim()
  const targetValid = /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(normalizedTarget) &&
    !controller.state.projects.some(({ id }) => id === normalizedTarget)
  return <Panel title={messages.interchangeTitle}>
    <p className="boundary-note">{messages.interchangeDescription}</p>
    <div className="button-row interchange-primary-actions">
      <button type="button" disabled={controller.state.busy} onClick={() => void controller.startOtioExport()}>
        {messages.interchangeExport}
      </button>
      <button type="button" disabled={controller.state.busy} onClick={() => void controller.previewOtioImport()}>
        {messages.interchangeImportPreview}
      </button>
    </div>

    {preview && <section className="interchange-import-preview" aria-label={messages.interchangeImportPreviewTitle}>
      <div className="interchange-heading">
        <strong>{messages.interchangeImportPreviewTitle}</strong>
        <span className="job-state">{preview.fidelity === 'kun-metadata'
          ? messages.interchangeFidelityKun
          : messages.interchangeFidelityPortable}</span>
      </div>
      <dl className="interchange-metrics">
        <div><dt>{messages.interchangeSourceDocument}</dt><dd>{preview.displayName}</dd></div>
        <div><dt>{messages.interchangeSourceProject}</dt><dd>{preview.sourceProjectId} · r{preview.sourceProjectRevision}</dd></div>
        <div><dt>{messages.interchangeFidelity}</dt><dd>{preview.fidelity === 'kun-metadata'
          ? messages.interchangeFidelityKun
          : messages.interchangeFidelityPortable}</dd></div>
      </dl>
      <p>{formatMessage(messages.interchangeRelinkRequired, {
        count: preview.mediaRelinkRequired.length
      })}</p>
      <p>{formatMessage(messages.interchangeTimecodeMappings, {
        count: preview.timecodeMappings.length + preview.timecodeMappingsTruncated
      })}</p>
      {preview.timecodeMappings.length > 0 && <details className="interchange-timecodes">
        <summary>{messages.interchangeTimecodeMappings.replace('{count}', String(preview.timecodeMappings.length))}</summary>
        <ul>{preview.timecodeMappings.slice(0, 8).map((mapping) => <li key={`${mapping.sequenceId}:${mapping.id}`}>
          <code>{mapping.id}</code><span>{mapping.startTimecode}–{mapping.endTimecode}</span>
        </li>)}</ul>
      </details>}
      <LossManifestView manifest={preview.lossManifest} messages={messages} />
      <label className="interchange-target-field">
        <span>{messages.interchangeTargetProject}</span>
        <input
          value={targetProjectId}
          maxLength={128}
          spellCheck={false}
          aria-invalid={!targetValid}
          onChange={(event) => setTargetProjectId(event.target.value)}
        />
      </label>
      <p className="boundary-note">{messages.interchangeImportCreatesNew}</p>
      <div className="button-row">
        <button
          type="button"
          disabled={controller.state.busy || !targetValid}
          onClick={() => void controller.confirmOtioImport(normalizedTarget)}
        >{messages.interchangeConfirmImport}</button>
        <button
          type="button"
          disabled={controller.state.busy}
          onClick={() => void controller.cancelOtioImportPreview()}
        >{messages.interchangeCancelImport}</button>
      </div>
    </section>}

    {tickets.length === 0
      ? <EmptyState>{messages.interchangeNoExports}</EmptyState>
      : <ul className="interchange-job-list">{tickets.map((ticket) => <InterchangeJobRow
          key={ticket.jobId}
          ticket={ticket}
          job={controller.state.jobs.find(({ id }) => id === ticket.jobId)}
          currentRevision={project.currentRevision}
          controller={controller}
          messages={messages}
        />)}</ul>}
  </Panel>
}

function InterchangeJobRow(props: {
  ticket: OtioExportTicket
  job?: JobSnapshot
  currentRevision: number
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { ticket, job, controller, messages } = props
  const terminal = job ? ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state) : false
  const progress = job?.progress?.percentage ?? (
    job?.progress?.completed !== undefined && job.progress.total
      ? job.progress.completed / job.progress.total * 100
      : undefined
  )
  const artifact = job?.result?.generatedArtifacts.find((candidate) =>
    candidate.mediaKind === 'document' && candidate.mimeType === 'application/x-otio+json'
  )
  return <li className={`interchange-job job-${job?.state ?? 'unknown'}`}>
    <div className="interchange-heading">
      <div><strong>{messages.interchangeJobTitle}</strong><small>{ticket.documentDigest.slice(0, 12)}</small></div>
      <span className="job-state">{job ? jobStateLabel(messages, job.state) : messages.interchangeStatusUnavailable}</span>
    </div>
    <p>{formatMessage(messages.interchangePinnedRevision, {
      revision: ticket.pinnedRevision,
      sequence: ticket.sequenceId
    })}</p>
    {ticket.pinnedRevision !== props.currentRevision && <p className="stale-badge">{messages.interchangeOlderRevision}</p>}
    <dl className="interchange-metrics">
      <div><dt>{messages.interchangeDocumentSize}</dt><dd>{formatBytes(ticket.documentBytes)}</dd></div>
      <div><dt>SHA-256</dt><dd>{ticket.documentDigest.slice(0, 16)}…</dd></div>
    </dl>
    <LossManifestView manifest={ticket.lossManifest} messages={messages} />
    {job && <progress
      max={100}
      value={progress ?? (job.state === 'completed' ? 100 : undefined)}
      aria-label={formatMessage(messages.progressLabel, {
        label: messages.interchangeJobTitle,
        value: Math.round(progress ?? 0)
      })}
    />}
    {job && <p>{jobDetailLabel(messages, job)}</p>}
    <div className="button-row">
      <button type="button" disabled={controller.state.busy} onClick={() => void controller.refreshOtioExport(ticket.jobId)}>
        {messages.interchangeRefreshStatus}
      </button>
      {job && !terminal && <button
        type="button"
        className="danger-button"
        disabled={controller.state.busy}
        onClick={() => void controller.cancelOtioExport(ticket.jobId)}
      >{messages.cancelJob}</button>}
      {artifact && <button
        type="button"
        disabled={artifact.availability !== 'available'}
        onClick={() => void controller.openArtifact(artifact)}
      >{messages.openWithSystem}</button>}
      {artifact && <button
        type="button"
        disabled={artifact.availability !== 'available'}
        onClick={() => void controller.revealArtifact(artifact)}
      >{messages.showInFolder}</button>}
    </div>
  </li>
}

function LossManifestView({ manifest, messages }: {
  manifest: InterchangeLossManifestProjection
  messages: Messages
}): React.JSX.Element {
  return <details className="interchange-loss" open={!manifest.portableLossless || !manifest.kunRoundTripLossless}>
    <summary>{messages.interchangeLossManifest}</summary>
    <p className={manifest.portableLossless ? 'package-complete' : 'package-incomplete'}>
      {manifest.portableLossless ? messages.interchangePortableLossless : messages.interchangePortableLossy}
    </p>
    <p className={manifest.kunRoundTripLossless ? 'package-complete' : 'package-incomplete'}>
      {manifest.kunRoundTripLossless ? messages.interchangeRoundTripLossless : messages.interchangeRoundTripLossy}
    </p>
    {manifest.entries.length === 0
      ? <p>{messages.interchangeNoReportedLosses}</p>
      : <ul>{manifest.entries.map((entry) => <li key={`${entry.code}:${entry.nodeId}`}>
          <strong>{entry.feature}</strong><code>{entry.nodeId}</code><span>{entry.message}</span>
        </li>)}</ul>}
    {manifest.truncated > 0 && <p className="package-incomplete">{formatMessage(
      messages.interchangeLossTruncated,
      { count: manifest.truncated }
    )}</p>}
  </details>
}

function ProjectPackagePanel({ controller, messages }: {
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const project = controller.state.project!
  const [missingMediaPolicy, setMissingMediaPolicy] = useState<'fail' | 'omit'>('fail')
  const [mediaScope, setMediaScope] = useState<'all' | 'selected'>('all')
  const [includeReceipts, setIncludeReceipts] = useState(true)
  const [includeAgentProvenance, setIncludeAgentProvenance] = useState(false)
  const selectedAssetIds = [...new Set([
    ...project.selection.selectedAssetIds,
    ...(controller.state.selectedAssetId ? [controller.state.selectedAssetId] : [])
  ])].filter((assetId) => project.assets.some(({ id }) => id === assetId))
  const tickets = controller.state.projectPackageTickets
    .filter(({ projectId }) => projectId === project.id)
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
  const submit = (event: FormEvent): void => {
    event.preventDefault()
    void controller.startProjectPackage({
      missingMediaPolicy,
      includeReceipts,
      includeAgentProvenance,
      mediaScope,
      ...(mediaScope === 'selected' ? { assetIds: selectedAssetIds } : {})
    })
  }
  return (
    <Panel title={messages.projectPackageTitle}>
      <form className="project-package-form" onSubmit={submit}>
        <div className="project-package-options">
          <label>
            <span>{messages.projectPackageMediaScope}</span>
            <select value={mediaScope} onChange={(event) => setMediaScope(event.target.value as typeof mediaScope)}>
              <option value="all">{messages.projectPackageAllMedia}</option>
              <option value="selected" disabled={selectedAssetIds.length === 0}>
                {formatMessage(messages.projectPackageSelectedMedia, { count: selectedAssetIds.length })}
              </option>
            </select>
          </label>
          <label>
            <span>{messages.projectPackageMissingPolicy}</span>
            <select value={missingMediaPolicy} onChange={(event) => setMissingMediaPolicy(event.target.value as typeof missingMediaPolicy)}>
              <option value="fail">{messages.projectPackageFailMissing}</option>
              <option value="omit">{messages.projectPackageOmitMissing}</option>
            </select>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeReceipts} onChange={(event) => setIncludeReceipts(event.target.checked)} />
            <span>{messages.projectPackageIncludeReceipts}</span>
          </label>
          <label className="checkbox-field">
            <input type="checkbox" checked={includeAgentProvenance} onChange={(event) => setIncludeAgentProvenance(event.target.checked)} />
            <span>{messages.projectPackageIncludeAgentReference}</span>
          </label>
        </div>
        <button
          type="submit"
          disabled={controller.state.busy || (mediaScope === 'selected' && selectedAssetIds.length === 0)}
        >{messages.projectPackageExport}</button>
        <p className="boundary-note">{messages.projectPackagePrivacyBoundary}</p>
      </form>
      {tickets.length === 0
        ? <EmptyState>{messages.projectPackageEmptyJobs}</EmptyState>
        : <ul className="project-package-list">{tickets.map((ticket) => {
            const job = controller.state.jobs.find(({ id }) => id === ticket.jobId)
            return <ProjectPackageRow
              key={ticket.jobId}
              ticket={ticket}
              job={job}
              currentRevision={project.currentRevision}
              controller={controller}
              messages={messages}
            />
          })}</ul>}
    </Panel>
  )
}

function ProjectPackageRow(props: {
  ticket: ProjectPackageTicket
  job?: JobSnapshot
  currentRevision: number
  controller: EditorController
  messages: Messages
}): React.JSX.Element {
  const { ticket, job, controller, messages } = props
  const terminal = job ? ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state) : false
  const progress = job?.progress?.percentage ?? (
    job?.progress?.completed !== undefined && job.progress.total
      ? job.progress.completed / job.progress.total * 100
      : undefined
  )
  const result = job ? projectPackageResultSummary(job) : undefined
  const stale = ticket.pinnedRevision !== props.currentRevision
  return (
    <li className={`project-package-job job-${job?.state ?? 'unknown'}`}>
      <div className="project-package-heading">
        <div>
          <strong>{messages.jobKindProjectPackage}</strong>
          <small>{ticket.packageId}</small>
        </div>
        <span className="job-state">{job ? jobStateLabel(messages, job.state) : messages.projectPackageStatusUnavailable}</span>
      </div>
      <p>{formatMessage(messages.projectPackagePinnedRevision, {
        revision: ticket.pinnedRevision,
        sequence: ticket.sequenceId
      })}</p>
      {stale && <p className="stale-badge">{messages.projectPackageOlderRevision}</p>}
      <dl className="project-package-metrics">
        <div><dt>{messages.projectPackageSelectedCount}</dt><dd>{ticket.selectedAssetCount}</dd></div>
        <div><dt>{messages.projectPackageEmbeddedCount}</dt><dd>{ticket.embeddedAssetCount}</dd></div>
        <div><dt>{messages.projectPackageUniqueCount}</dt><dd>{ticket.uniqueMediaCount}</dd></div>
        <div><dt>{messages.projectPackageDeduplicatedCount}</dt><dd>{ticket.deduplicatedAssetCount}</dd></div>
      </dl>
      <p className={ticket.complete ? 'package-complete' : 'package-incomplete'}>
        {ticket.complete ? messages.projectPackageComplete : messages.projectPackageIncomplete}
      </p>
      {ticket.missingAssetIds.length > 0 && <p className="project-package-missing">
        {formatMessage(messages.projectPackageMissingAssets, { ids: ticket.missingAssetIds.join(', ') })}
      </p>}
      <p className="subtle">{formatMessage(messages.projectPackageRequestedProvenance, {
        receipts: ticket.receiptsRequested ? messages.requested : messages.notRequested,
        agent: ticket.agentProvenanceRequested ? messages.requested : messages.notRequested
      })}</p>
      {job && <progress
        max={100}
        value={progress ?? (job.state === 'completed' ? 100 : undefined)}
        aria-label={formatMessage(messages.progressLabel, {
          label: messages.jobKindProjectPackage,
          value: Math.round(progress ?? 0)
        })}
      />}
      {job && <p>{jobDetailLabel(messages, job)}</p>}
      {result && <dl className="project-package-result">
        <div><dt>{messages.projectPackageOutput}</dt><dd>{result.displayName}</dd></div>
        <div><dt>{messages.projectPackageEntries}</dt><dd>{result.entryCount}</dd></div>
        <div><dt>{messages.projectPackageArchiveSize}</dt><dd>{formatBytes(result.archiveBytes)}</dd></div>
        <div><dt>SHA-256</dt><dd>{result.sha256}</dd></div>
      </dl>}
      <div className="button-row project-package-actions">
        <button type="button" disabled={controller.state.busy} onClick={() => void controller.refreshProjectPackage(ticket.jobId)}>
          {messages.projectPackageRefreshStatus}
        </button>
        {job && !terminal && <button
          type="button"
          className="danger-button"
          disabled={controller.state.busy}
          onClick={() => void controller.cancelProjectPackage(ticket.jobId)}
        >{messages.cancelJob}</button>}
      </div>
    </li>
  )
}

type ProjectPackageResultSummary = {
  entryCount: number
  archiveBytes: number
  sha256: string
  displayName: string
}

function projectPackageResultSummary(job: JobSnapshot): ProjectPackageResultSummary | undefined {
  const data = recordValue(job.result?.data)
  if (!data || data.schemaVersion !== 1 || data.format !== 'zip') return undefined
  const generatedMedia = recordValue(data.generatedMedia)
  if (
    !Number.isSafeInteger(data.entryCount) || Number(data.entryCount) < 1 ||
    !Number.isSafeInteger(data.archiveBytes) || Number(data.archiveBytes) < 1 ||
    typeof data.sha256 !== 'string' || !/^[a-f0-9]{64}$/u.test(data.sha256) ||
    typeof generatedMedia?.displayName !== 'string'
  ) return undefined
  return {
    entryCount: Number(data.entryCount),
    archiveBytes: Number(data.archiveBytes),
    sha256: data.sha256,
    displayName: safeHostDisplayName(generatedMedia.displayName)
  }
}

function JobRow({ job, controller, messages }: { job: JobSnapshot; controller: EditorController; messages: Messages }): React.JSX.Element {
  const terminal = ['completed', 'failed', 'cancelled', 'interrupted'].includes(job.state)
  const progress = job.progress?.percentage ?? (job.progress?.completed !== undefined && job.progress.total ? job.progress.completed / job.progress.total * 100 : undefined)
  return (
    <li className={`job job-${job.state}`}>
      <div><strong>{jobKindLabel(messages, job.kind)}</strong><small>{job.id} · {formatMessage(messages.attempt, { attempt: job.executionAttempt })}</small></div>
      <span className="job-state">{jobStateLabel(messages, job.state)}</span>
      <progress max={100} value={progress ?? (job.state === 'completed' ? 100 : undefined)} aria-label={formatMessage(messages.progressLabel, { label: jobKindLabel(messages, job.kind), value: Math.round(progress ?? 0) })} />
      <p>{jobDetailLabel(messages, job)}</p>
      {!terminal && <button type="button" className="danger-button" disabled={controller.state.busy} onClick={() => void controller.cancelJob(job.id)}>{messages.cancelJob}</button>}
    </li>
  )
}

function ResultPreviewWorkbench({ controller, messages }: { controller: EditorController; messages: Messages }): React.JSX.Element {
  const preview = controller.state.resultPreview!
  const source = preview.result
  const url = controller.state.activeMediaUrl
  const isImage = source.mimeType.startsWith('image/')
  const isAudio = source.mimeType.startsWith('audio/')
  return <div
    className="editor-app result-preview-app"
    data-theme={controller.state.theme?.kind ?? 'dark'}
    data-reduced-motion={controller.state.theme?.reducedMotion ? 'true' : 'false'}
    dir={controller.state.locale?.direction ?? 'ltr'}
    lang={controller.state.locale?.language ?? 'en'}
    style={themeStyle(controller.state.theme)}
  >
    <header className="project-bar">
      <div className="brand-block"><span className="brand-mark" aria-hidden="true">K</span><div><strong>{messages.preview}</strong><small>{source.name ?? source.mimeType}</small></div></div>
    </header>
    <main className="result-preview-main">
      {!url ? <EmptyState>{source.availability === 'unavailable' ? messages.artifactUnavailable : messages.loadingEditor}</EmptyState>
        : isImage ? <img src={url} alt={source.name ?? messages.generatedProofFrame} onError={() => void controller.refreshActiveLease()} />
          : isAudio ? <audio src={url} controls onError={() => void controller.refreshActiveLease()} aria-label={source.name ?? messages.audioPreview} />
            : <video src={url} controls playsInline onError={() => void controller.refreshActiveLease()} aria-label={source.name ?? messages.videoPreview} />}
      <p className="subtle">{messages.technicallyValidated}</p>
    </main>
  </div>
}

function MediaCapabilityStatus({ state, messages }: { state: EditorState; messages: Messages }): React.JSX.Element {
  const ready = Boolean(
    state.mediaCapabilities?.ffmpeg.available &&
    state.mediaCapabilities.ffprobe.available &&
    hasMediaFeature(state, 'libx264-encoder') &&
    hasMediaFeature(state, 'aac-encoder')
  )
  return <span
    className={ready ? 'connection connection-online' : 'connection connection-offline'}
    title={ready ? messages.mediaCapabilitiesReady : messages.mediaCapabilitiesLimited}
  >FFmpeg</span>
}

function Panel(props: PropsWithChildren<{ title: string; actions?: ReactNode; className?: string }>): React.JSX.Element {
  return <section className={`panel ${props.className ?? ''}`}><header className="panel-header"><h2>{props.title}</h2>{props.actions && <div className="panel-actions">{props.actions}</div>}</header><div className="panel-body">{props.children}</div></section>
}

function hasMediaFeature(state: EditorState, feature: MediaCapabilityFeature): boolean {
  return state.mediaCapabilities?.ffmpeg.features.includes(feature) ?? false
}

export function canImportMedia(state: EditorState): boolean {
  return state.mediaCapabilities?.ffprobe.available !== false
}

function canRender(
  state: EditorState,
  kind: RenderTicket['renderKind'],
  captionMode: 'none' | 'burned' | 'sidecar' | 'both'
): boolean {
  if ((kind === 'subtitles' || captionMode !== 'none') && !state.project?.captions.length) return false
  if (!state.mediaCapabilities?.ffprobe.available) return false
  if (kind !== 'subtitles' && !state.mediaCapabilities.ffmpeg.available) return false
  if ((kind === 'preview' || kind === 'h264-mp4') && !hasMediaFeature(state, 'libx264-encoder')) return false
  if ((kind === 'audio-aac' || kind === 'h264-mp4') && !hasMediaFeature(state, 'aac-encoder')) return false
  if ((captionMode === 'burned' || captionMode === 'both') && !hasMediaFeature(state, 'drawtext-filter')) return false
  return true
}

function EmptyState({ children }: PropsWithChildren): React.JSX.Element { return <div className="empty-state"><span aria-hidden="true">--</span><p>{children}</p></div> }
function StatusNotice({ severity, children }: PropsWithChildren<{ severity: 'info' | 'warning' | 'error' }>): React.JSX.Element { return <div className={`status-notice status-${severity}`} role={severity === 'error' ? 'alert' : 'status'}>{children}</div> }
function Spinner(): React.JSX.Element { return <span className="spinner" aria-hidden="true" /> }

function visibleProjectAssets(state: EditorState): AssetProjection[] {
  const project = state.project
  const mediaLibrary = state.mediaLibrary
  const page = project && mediaLibrary?.projectId === project.id &&
    mediaLibrary.revision === project.currentRevision
    ? mediaLibrary.assets
    : []
  return [...new Map([...(project?.assets ?? []), ...page].map((asset) => [asset.id, asset])).values()]
}

function VirtualControls(props: { start: number; total: number; onChange(start: number): void; messages: Messages }): React.JSX.Element | null {
  if (props.total <= VIEW_LIMITS.virtualWindow) return null
  return <div className="virtual-controls" aria-label={props.messages.virtualList}><button type="button" onClick={() => props.onChange(Math.max(0, props.start - VIEW_LIMITS.virtualWindow))} disabled={props.start === 0}>{props.messages.previous}</button><span>{props.start + 1}–{Math.min(props.total, props.start + VIEW_LIMITS.virtualWindow)} / {props.total}</span><button type="button" onClick={() => props.onChange(Math.min(props.total - 1, props.start + VIEW_LIMITS.virtualWindow))} disabled={props.start + VIEW_LIMITS.virtualWindow >= props.total}>{props.messages.next}</button></div>
}

async function splitAtPlayhead(controller: EditorController, project: ProjectProjection, item: ItemProjection, messages: Messages): Promise<void> {
  const frame = controller.state.playheadFrame
  if (frame <= item.timelineStartFrame || frame >= item.timelineStartFrame + item.durationFrames) return
  await controller.applyOperations(
    [{ type: 'split-item', itemId: item.id, atFrame: frame }],
    formatMessage(messages.splitSummary, { id: item.id, frame })
  )
}

async function deleteTimelineItem(
  controller: EditorController,
  project: ProjectProjection,
  item: ItemProjection,
  messages: Messages
): Promise<void> {
  const itemIds = linkedProjectItemIds(project, item.id)
  const itemIdSet = new Set(itemIds)
  const linkedGroupIds = project.linkGroups
    .filter((group) => group.locked && group.itemIds.some((itemId) => itemIdSet.has(itemId)))
    .map(({ id }) => id)
  const operations: TimelineOperation[] = [
    ...linkedGroupIds.map((linkGroupId) => ({ type: 'delete-link-group' as const, linkGroupId })),
    ...itemIds.map((itemId) => ({ type: 'delete-item' as const, itemId }))
  ]
  if (operations.length > 200) return
  await controller.applyOperations(operations, formatMessage(messages.deleteSummary, { id: item.id }))
}

function connectionLabel(messages: Messages, state: EditorController['state']['connection']): string {
  if (state === 'online') return messages.connected
  if (state === 'offline') return messages.offline
  if (state === 'reconnecting') return messages.reconnecting
  return messages.connecting
}

function revisionAuthorLabel(messages: Messages, author: string): string {
  if (author === 'agent') return messages.revisionAuthorAgent
  if (author === 'system') return messages.revisionAuthorSystem
  if (author === 'manual' || author === 'user') return messages.revisionAuthorManual
  return author
}

function revisionSummaryLabel(messages: Messages, revision: RevisionProjection): string {
  const labels: Readonly<Record<string, string>> = {
    'project.create': messages.revisionProjectCreated,
    'video-probe': messages.revisionMediaImported,
    'media.reauthorize': messages.revisionMediaReauthorized,
    'video-transcribe': messages.revisionTranscriptImported,
    'video-apply-script': messages.revisionScriptApplied,
    'video-update-timeline': messages.revisionTimelineUpdated,
    'history.undo': messages.revisionUndo,
    'history.redo': messages.revisionRedo
  }
  return labels[revision.sourceOperation] ?? revision.summary
}

function agentStateLabel(messages: Messages, state: string): string {
  const labels: Record<string, string> = {
    queued: messages.agentStateQueued,
    running: messages.agentStateRunning,
    'waiting-approval': messages.agentStateWaitingApproval,
    'waiting-user-input': messages.agentStateWaitingInput,
    completed: messages.agentStateCompleted,
    failed: messages.agentStateFailed,
    cancelled: messages.agentStateCancelled,
    'budget-exhausted': messages.agentStateBudgetExhausted
  }
  return labels[state] ?? state
}

function jobStateLabel(messages: Messages, state: JobSnapshot['state']): string {
  if (state === 'queued') return messages.jobStateQueued
  if (state === 'running') return messages.jobStateRunning
  if (state === 'completed') return messages.jobStateCompleted
  if (state === 'failed') return messages.jobStateFailed
  if (state === 'cancelled') return messages.jobStateCancelled
  return messages.jobStateInterrupted
}

function jobKindLabel(messages: Messages, kind: string): string {
  if (kind === 'media.ffmpeg') return messages.jobKindRender
  if (kind === 'media.ffprobe') return messages.jobKindProbe
  if (kind === 'media.archive') return messages.jobKindProjectPackage
  if (kind.includes('transcri')) return messages.jobKindTranscribe
  return kind
}

function jobDetailLabel(messages: Messages, job: JobSnapshot): string {
  if (job.state === 'completed') return messages.jobCompletedDetail
  if (job.state === 'failed') {
    return job.error?.code
      ? formatMessage(messages.jobFailedDetail, { code: job.error.code })
      : messages.jobFailedWithoutCode
  }
  if (job.state === 'cancelled') return messages.jobCancelledDetail
  if (job.state === 'interrupted') return messages.jobInterruptedDetail
  if (job.progress?.phase === 'encoding' || job.progress?.phase === 'encode') return messages.jobProgressEncoding
  if (job.progress?.phase === 'finalizing') return messages.jobProgressFinalizing
  if (job.progress) return messages.jobProgressRunning
  return messages.waitingProgress
}

function transcriptTagLabel(messages: Messages, tag: string): string {
  if (tag === 'filler') return messages.transcriptTagFiller
  if (tag === 'silence') return messages.transcriptTagSilence
  return tag
}

function speakerAttributionLabel(messages: Messages, attribution: SpeakerAttributionProjection): string {
  if (attribution.status === 'identified' && attribution.speakerLabel) return attribution.speakerLabel
  if (attribution.status === 'overlap') return messages.speakerStatusOverlap
  if (attribution.status === 'unknown') return messages.speakerStatusUnknown
  return messages.speakerStatusUncertain
}

function projectChangeReasonLabel(messages: Messages, reason: string): string {
  const labels: Record<string, string> = {
    'project-created': messages.projectChangeCreated,
    'active-project-changed': messages.projectChangeActive,
    'asset-imported': messages.projectChangeAssetImported,
    'asset-reauthorized': messages.projectChangeAssetReauthorized,
    'transcript-imported': messages.projectChangeTranscriptImported,
    'speaker-attribution-applied': messages.projectChangeSpeakerAttribution,
    'script-applied': messages.projectChangeScriptApplied,
    'timeline-updated': messages.projectChangeTimelineUpdated,
    'project-undo': messages.projectChangeUndone,
    'project-redo': messages.projectChangeRedone
  }
  return labels[reason] ?? messages.projectChanged
}

function trackKindLabel(messages: Messages, kind: TrackProjection['kind']): string {
  if (kind === 'video') return messages.trackKindVideo
  if (kind === 'audio') return messages.trackKindAudio
  return messages.trackKindCaption
}

function trackDisplayName(messages: Messages, track: TrackProjection): string {
  const labels: Readonly<Record<string, string>> = {
    'video-1': messages.defaultVideoTrack1,
    'video-2': messages.defaultVideoTrack2,
    'audio-1': messages.defaultAudioTrack1,
    'captions-1': messages.defaultCaptionTrack
  }
  return labels[track.id] ?? track.name
}

function mediaKindLabel(messages: Messages, kind: GeneratedArtifact['mediaKind']): string {
  if (kind === 'video') return messages.mediaKindVideo
  if (kind === 'audio') return messages.mediaKindAudio
  if (kind === 'image') return messages.mediaKindImage
  return messages.mediaKindSubtitle
}

function previewSourceLabel(messages: Messages, kind: 'asset' | 'timeline' | 'generated'): string {
  if (kind === 'asset') return messages.previewSourceAsset
  if (kind === 'generated') return messages.previewSourceGenerated
  return messages.previewSourceTimeline
}

function assetKindAbbreviation(messages: Messages, kind: ProjectProjection['assets'][number]['kind']): string {
  if (kind === 'video') return messages.videoAbbreviation
  if (kind === 'audio') return messages.audioAbbreviation
  if (kind === 'image') return messages.imageAbbreviation
  return messages.animationAbbreviation
}

function compatibleTracks(tracks: TrackProjection[], item?: ItemProjection): TrackProjection[] {
  if (!item) return []
  const current = tracks.find(({ id }) => id === item.trackId)
  return tracks.filter(({ kind }) => kind === current?.kind && kind !== 'caption')
}

function segmentTimelineFrame(project: ProjectProjection, assetId: string, startUs: number): number {
  const item = [...project.items].sort((a, b) => a.timelineStartFrame - b.timelineStartFrame).find((candidate) =>
    candidate.assetId === assetId && candidate.sourceStartUs <= startUs && startUs < candidate.sourceEndUs
  )
  if (!item) return Math.max(0, Math.round(startUs * project.fps.numerator / project.fps.denominator / 1_000_000))
  const sourceDelta = startUs - item.sourceStartUs
  const frameDelta = sourceDelta * project.fps.numerator * item.speed.denominator /
    (1_000_000 * project.fps.denominator * item.speed.numerator)
  return item.timelineStartFrame + Math.round(frameDelta)
}

function ticketForArtifact(tickets: RenderTicket[], artifact: GeneratedArtifact): RenderTicket | undefined {
  return artifact.provenance.jobId ? tickets.find(({ jobId }) => jobId === artifact.provenance.jobId) : undefined
}

function artifactMatchesPlayback(
  artifact: GeneratedArtifact,
  project: ProjectProjection,
  playheadFrame: number
): boolean {
  const metadata = artifact.provenance.metadata
  if (!metadata || Array.isArray(metadata)) return false
  const digest = metadata.renderIrDigest
  const capabilitiesDigest = metadata.backendCapabilitiesDigest
  if (
    artifact.availability !== 'available' ||
    metadata.projectId !== project.id ||
    metadata.sequenceId !== project.playback.sequenceId ||
    metadata.pinnedRevision !== project.currentRevision ||
    typeof digest !== 'string' || !/^[a-f0-9]{64}$/u.test(digest) ||
    typeof capabilitiesDigest !== 'string' || !/^[a-f0-9]{64}$/u.test(capabilitiesDigest)
  ) return false
  if (artifact.mediaKind === 'image' && metadata.renderKind === 'proof-frame') {
    return metadata.proofFrame === playheadFrame
  }
  if (
    artifact.mediaKind !== 'video' ||
    (metadata.renderKind !== 'preview' && metadata.renderKind !== 'h264-mp4') ||
    digest !== project.playback.irDigest
  ) return false
  const range = metadata.renderRange
  return Boolean(
    range && typeof range === 'object' && !Array.isArray(range) &&
    range.startFrame === 0 && range.endFrame === project.durationFrames
  )
}

function durationBand(duration: number, total: number): string {
  const share = total > 0 ? duration / total : 0
  return share > 0.5 ? 'xl' : share > 0.25 ? 'lg' : share > 0.1 ? 'md' : 'sm'
}

function formatTime(seconds: number): string {
  const safe = Math.max(0, Number.isFinite(seconds) ? seconds : 0)
  const minutes = Math.floor(safe / 60)
  const remaining = Math.floor(safe % 60)
  return `${minutes.toString().padStart(2, '0')}:${remaining.toString().padStart(2, '0')}`
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function formatTimestamp(value: string, locale?: string): string {
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString(locale)
}

function recordValue(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function safeHostDisplayName(value: string): string {
  const leaf = value.normalize('NFKC').replace(/\\/gu, '/').split('/').at(-1)?.trim() ?? ''
  return replaceAsciiControlCharacters(leaf, '').slice(0, 256) || 'project-package.zip'
}
