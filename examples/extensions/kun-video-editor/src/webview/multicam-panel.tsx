import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent
} from 'react'
import './multicam-panel.css'

export type MulticamPanelRange = {
  startFrame: number
  endFrame: number
}

export type MulticamPanelAsset = {
  id: string
  name: string
  kind: 'video' | 'audio' | 'image' | 'animation' | 'generated'
  available: boolean
}

export type MulticamPanelMember = {
  id: string
  assetId: string
  memberLabel: string
  angleLabel: string
  sync: {
    status: 'reference' | 'verified' | 'uncertain' | 'unknown'
    offsetFrames: number
    confidence?: number
  }
  coverage: MulticamPanelRange[]
}

export type MulticamPanelLayout = {
  id: string
  label: string
  memberIds: string[]
}

export type MulticamPanelProgramFragment = MulticamPanelRange & {
  id: string
  selection:
    | { kind: 'angle'; memberId: string }
    | { kind: 'layout'; layoutId: string }
}

export type MulticamPanelGroup = {
  id: string
  sequenceId: string
  name: string
  durationFrames: number
  referenceMemberId: string
  members: MulticamPanelMember[]
  layouts: MulticamPanelLayout[]
  programFragments: MulticamPanelProgramFragment[]
}

export type MulticamCreateRequest = {
  name: string
  assetIds: string[]
  referenceAssetId: string
}

export type MulticamRenameRequest = {
  groupId: string
  groupName?: string
  memberId?: string
  memberLabel?: string
  angleLabel?: string
}

export type MulticamSyncConfirmation = {
  groupId: string
  memberId: string
  offsetFrames: number
  status: 'verified' | 'uncertain'
  confidence: number
}

export type MulticamSelectionRequest = {
  groupId: string
  range: MulticamPanelRange
  coveragePolicy: 'reject' | 'clamp'
}

export type MulticamSwitchRequest = MulticamSelectionRequest & {
  memberId: string
}

export type MulticamLayoutRequest = MulticamSelectionRequest & {
  layoutId: string
}

export type MulticamPanelMessages = {
  title: string
  subtitle: string
  createGroup: string
  newGroupName: string
  sources: string
  sourceUnavailable: string
  referenceAngle: string
  create: string
  groups: string
  emptyTitle: string
  emptyBody: string
  duration: string
  groupName: string
  saveName: string
  editRange: string
  startFrame: string
  endFrame: string
  coveragePolicy: string
  rejectIncomplete: string
  clampIncomplete: string
  members: string
  source: string
  memberLabel: string
  angleLabel: string
  saveLabels: string
  reference: string
  syncStatus: string
  syncConfidence: string
  offsetFrames: string
  coverage: string
  confirmSync: string
  verified: string
  uncertain: string
  unknown: string
  switchToAngle: string
  layouts: string
  applyLayout: string
  noLayouts: string
  program: string
  noProgram: string
  angle: string
  layout: string
  previewRange: string
  mergeAdjacent: string
  actionFailed: string
  working: string
}

export type MulticamPanelProps = {
  groups: readonly MulticamPanelGroup[]
  assets: readonly MulticamPanelAsset[]
  busy?: boolean
  messages?: Partial<MulticamPanelMessages>
  onCreate(request: MulticamCreateRequest): void | Promise<void>
  onRenameLabels(request: MulticamRenameRequest): void | Promise<void>
  onConfirmSync(request: MulticamSyncConfirmation): void | Promise<void>
  onSwitch(request: MulticamSwitchRequest): void | Promise<void>
  onMerge(groupId: string): void | Promise<void>
  onApplyLayout(request: MulticamLayoutRequest): void | Promise<void>
  onPreview(request: MulticamSelectionRequest): void | Promise<void>
}

const DEFAULT_MESSAGES: MulticamPanelMessages = {
  title: 'Multicam',
  subtitle: 'Source-preserving angle and layout program',
  createGroup: 'Create multicam group',
  newGroupName: 'Group name',
  sources: 'Camera sources',
  sourceUnavailable: 'Unavailable',
  referenceAngle: 'Reference camera',
  create: 'Create group',
  groups: 'Multicam groups',
  emptyTitle: 'No multicam group yet',
  emptyBody: 'Choose at least two available video sources to create a group.',
  duration: 'Duration',
  groupName: 'Group name',
  saveName: 'Save group name',
  editRange: 'Program range',
  startFrame: 'Start frame',
  endFrame: 'End frame',
  coveragePolicy: 'Incomplete coverage',
  rejectIncomplete: 'Refuse uncovered range',
  clampIncomplete: 'Clamp to covered range',
  members: 'Angles',
  source: 'Source',
  memberLabel: 'Member label',
  angleLabel: 'Angle label',
  saveLabels: 'Save labels',
  reference: 'Reference',
  syncStatus: 'Sync',
  syncConfidence: 'Confidence',
  offsetFrames: 'Offset frames',
  coverage: 'Coverage',
  confirmSync: 'Confirm synchronization',
  verified: 'Verified',
  uncertain: 'Uncertain',
  unknown: 'Unknown',
  switchToAngle: 'Switch range to angle',
  layouts: 'Layouts',
  applyLayout: 'Apply layout to range',
  noLayouts: 'No saved layouts.',
  program: 'Program fragments',
  noProgram: 'The program has no fragments.',
  angle: 'Angle',
  layout: 'Layout',
  previewRange: 'Preview selected range',
  mergeAdjacent: 'Merge adjacent fragments',
  actionFailed: 'The multicam action failed.',
  working: 'Working'
}

export function MulticamPanel(props: MulticamPanelProps): React.JSX.Element {
  const copy = { ...DEFAULT_MESSAGES, ...props.messages }
  const titleId = useId()
  const [activeGroupId, setActiveGroupId] = useState(props.groups[0]?.id ?? '')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([])
  const activeGroup = props.groups.find(({ id }) => id === activeGroupId) ?? props.groups[0]
  const disabled = Boolean(props.busy || pending)

  useEffect(() => {
    if (!props.groups.some(({ id }) => id === activeGroupId)) {
      setActiveGroupId(props.groups[0]?.id ?? '')
    }
  }, [activeGroupId, props.groups])

  const run = (operation: () => void | Promise<void>): void => {
    if (disabled) return
    setError('')
    setPending(true)
    Promise.resolve()
      .then(operation)
      .catch((reason: unknown) => {
        setError(reason instanceof Error && reason.message ? reason.message : copy.actionFailed)
      })
      .finally(() => setPending(false))
  }

  const activateRelativeGroup = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let nextIndex: number | undefined
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
      nextIndex = (index + 1) % props.groups.length
    } else if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
      nextIndex = (index - 1 + props.groups.length) % props.groups.length
    } else if (event.key === 'Home') {
      nextIndex = 0
    } else if (event.key === 'End') {
      nextIndex = props.groups.length - 1
    }
    if (nextIndex === undefined) return
    event.preventDefault()
    setActiveGroupId(props.groups[nextIndex]!.id)
    tabRefs.current[nextIndex]?.focus()
  }

  return (
    <section className="panel multicam-panel" aria-labelledby={titleId} aria-busy={disabled}>
      <header className="multicam-panel-heading">
        <div>
          <h2 id={titleId}>{copy.title}</h2>
          <p>{copy.subtitle}</p>
        </div>
        {disabled && <span className="multicam-working" role="status">{copy.working}</span>}
      </header>

      {error && <p className="multicam-error" role="alert">{error}</p>}

      <CreateGroupForm
        assets={props.assets}
        copy={copy}
        disabled={disabled}
        onCreate={(request) => run(() => props.onCreate(request))}
      />

      {props.groups.length === 0 ? (
        <div className="multicam-empty" role="status">
          <strong>{copy.emptyTitle}</strong>
          <p>{copy.emptyBody}</p>
        </div>
      ) : (
        <>
          <div className="multicam-group-tabs" role="tablist" aria-label={copy.groups}>
            {props.groups.map((group, index) => (
              <button
                key={group.id}
                id={`${titleId}-tab-${index}`}
                ref={(node) => { tabRefs.current[index] = node }}
                type="button"
                role="tab"
                aria-controls={`${titleId}-panel-${index}`}
                aria-selected={activeGroup?.id === group.id}
                tabIndex={activeGroup?.id === group.id ? 0 : -1}
                onClick={() => setActiveGroupId(group.id)}
                onKeyDown={(event) => activateRelativeGroup(event, index)}
              >
                <span>{group.name}</span>
                <small>{group.members.length}</small>
              </button>
            ))}
          </div>

          {activeGroup && (
            <GroupEditor
              key={activeGroup.id}
              id={`${titleId}-panel-${props.groups.findIndex(({ id }) => id === activeGroup.id)}`}
              labelledBy={`${titleId}-tab-${props.groups.findIndex(({ id }) => id === activeGroup.id)}`}
              group={activeGroup}
              assets={props.assets}
              copy={copy}
              disabled={disabled}
              run={run}
              callbacks={props}
            />
          )}
        </>
      )}
    </section>
  )
}

function CreateGroupForm(props: {
  assets: readonly MulticamPanelAsset[]
  copy: MulticamPanelMessages
  disabled: boolean
  onCreate(request: MulticamCreateRequest): void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [assetIds, setAssetIds] = useState<string[]>([])
  const [referenceAssetId, setReferenceAssetId] = useState('')
  const videoAssets = useMemo(
    () => props.assets.filter(({ kind }) => kind === 'video'),
    [props.assets]
  )
  const selectedAvailableAssets = assetIds.filter((id) =>
    videoAssets.some((asset) => asset.id === id && asset.available)
  )
  const canSubmit = name.trim().length > 0 && selectedAvailableAssets.length >= 2 &&
    selectedAvailableAssets.includes(referenceAssetId) && !props.disabled

  const toggleAsset = (asset: MulticamPanelAsset, checked: boolean): void => {
    if (!asset.available) return
    setAssetIds((current) => checked
      ? current.includes(asset.id) ? current : [...current, asset.id]
      : current.filter((id) => id !== asset.id))
    if (!checked && referenceAssetId === asset.id) setReferenceAssetId('')
  }

  const submit = (event: FormEvent): void => {
    event.preventDefault()
    if (!canSubmit) return
    props.onCreate({
      name: name.normalize('NFKC').trim(),
      assetIds: selectedAvailableAssets,
      referenceAssetId
    })
  }

  return (
    <details className="multicam-create" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary>{props.copy.createGroup}</summary>
      <form onSubmit={submit}>
        <label>
          <span>{props.copy.newGroupName}</span>
          <input value={name} maxLength={96} disabled={props.disabled} onChange={(event) => setName(event.target.value)} />
        </label>
        <fieldset className="multicam-source-picker">
          <legend>{props.copy.sources}</legend>
          {videoAssets.map((asset) => (
            <label key={asset.id}>
              <input
                type="checkbox"
                checked={assetIds.includes(asset.id)}
                disabled={props.disabled || !asset.available}
                onChange={(event) => toggleAsset(asset, event.target.checked)}
              />
              <span>{asset.name}</span>
              {!asset.available && <small>{props.copy.sourceUnavailable}</small>}
            </label>
          ))}
        </fieldset>
        <label>
          <span>{props.copy.referenceAngle}</span>
          <select
            value={referenceAssetId}
            disabled={props.disabled || selectedAvailableAssets.length === 0}
            onChange={(event) => setReferenceAssetId(event.target.value)}
          >
            <option value="">—</option>
            {selectedAvailableAssets.map((assetId) => {
              const asset = videoAssets.find(({ id }) => id === assetId)!
              return <option key={asset.id} value={asset.id}>{asset.name}</option>
            })}
          </select>
        </label>
        <button type="submit" disabled={!canSubmit}>{props.copy.create}</button>
      </form>
    </details>
  )
}

function GroupEditor(props: {
  id: string
  labelledBy: string
  group: MulticamPanelGroup
  assets: readonly MulticamPanelAsset[]
  copy: MulticamPanelMessages
  disabled: boolean
  run(operation: () => void | Promise<void>): void
  callbacks: Pick<
    MulticamPanelProps,
    'onRenameLabels' | 'onConfirmSync' | 'onSwitch' | 'onMerge' | 'onApplyLayout' | 'onPreview'
  >
}): React.JSX.Element {
  const { group, copy } = props
  const [groupName, setGroupName] = useState(group.name)
  const [startFrame, setStartFrame] = useState(0)
  const [endFrame, setEndFrame] = useState(group.durationFrames)
  const [coveragePolicy, setCoveragePolicy] = useState<'reject' | 'clamp'>('reject')
  const range = normalizedRange(startFrame, endFrame, group.durationFrames)

  useEffect(() => setGroupName(group.name), [group.name])
  useEffect(() => {
    setStartFrame((current) => clamp(current, 0, Math.max(0, group.durationFrames - 1)))
    setEndFrame((current) => clamp(current, 1, group.durationFrames))
  }, [group.durationFrames])

  return (
    <div
      id={props.id}
      className="multicam-group-editor"
      role="tabpanel"
      aria-labelledby={props.labelledBy}
    >
      <div className="multicam-group-summary">
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const normalized = groupName.normalize('NFKC').trim()
            if (!normalized || normalized === group.name) return
            props.run(() => props.callbacks.onRenameLabels({ groupId: group.id, groupName: normalized }))
          }}
        >
          <label>
            <span>{copy.groupName}</span>
            <input
              value={groupName}
              maxLength={96}
              disabled={props.disabled}
              onChange={(event) => setGroupName(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.disabled || !groupName.trim() || groupName.trim() === group.name}>
            {copy.saveName}
          </button>
        </form>
        <small>{copy.duration}: 0–{group.durationFrames}</small>
      </div>

      <fieldset className="multicam-range">
        <legend>{copy.editRange}</legend>
        <label>
          <span>{copy.startFrame}</span>
          <input
            type="number"
            min={0}
            max={Math.max(0, group.durationFrames - 1)}
            step={1}
            value={startFrame}
            disabled={props.disabled}
            onChange={(event) => setStartFrame(integerInput(event.target.value, 0))}
          />
        </label>
        <label>
          <span>{copy.endFrame}</span>
          <input
            type="number"
            min={1}
            max={group.durationFrames}
            step={1}
            value={endFrame}
            disabled={props.disabled}
            onChange={(event) => setEndFrame(integerInput(event.target.value, group.durationFrames))}
          />
        </label>
        <label className="multicam-range-policy">
          <span>{copy.coveragePolicy}</span>
          <select
            value={coveragePolicy}
            disabled={props.disabled}
            onChange={(event) => setCoveragePolicy(event.target.value as 'reject' | 'clamp')}
          >
            <option value="reject">{copy.rejectIncomplete}</option>
            <option value="clamp">{copy.clampIncomplete}</option>
          </select>
        </label>
      </fieldset>

      <section className="multicam-section" aria-labelledby={`${props.id}-members`}>
        <h3 id={`${props.id}-members`}>{copy.members}</h3>
        <ul className="multicam-member-list">
          {group.members.map((member) => (
            <MemberCard
              key={member.id}
              group={group}
              member={member}
              asset={props.assets.find(({ id }) => id === member.assetId)}
              range={range}
              coveragePolicy={coveragePolicy}
              copy={copy}
              disabled={props.disabled}
              run={props.run}
              onRenameLabels={props.callbacks.onRenameLabels}
              onConfirmSync={props.callbacks.onConfirmSync}
              onSwitch={props.callbacks.onSwitch}
            />
          ))}
        </ul>
      </section>

      <section className="multicam-section" aria-labelledby={`${props.id}-layouts`}>
        <h3 id={`${props.id}-layouts`}>{copy.layouts}</h3>
        {group.layouts.length === 0 ? (
          <p className="multicam-muted">{copy.noLayouts}</p>
        ) : (
          <ul className="multicam-layout-list">
            {group.layouts.map((layout) => (
              <li key={layout.id}>
                <span><strong>{layout.label}</strong><small>{layout.memberIds.length}</small></span>
                <button
                  type="button"
                  disabled={props.disabled}
                  onClick={() => props.run(() => props.callbacks.onApplyLayout({
                    groupId: group.id,
                    layoutId: layout.id,
                    range,
                    coveragePolicy
                  }))}
                >{copy.applyLayout}</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="multicam-section" aria-labelledby={`${props.id}-program`}>
        <h3 id={`${props.id}-program`}>{copy.program}</h3>
        {group.programFragments.length === 0 ? (
          <p className="multicam-muted">{copy.noProgram}</p>
        ) : (
          <ol className="multicam-program-list">
            {group.programFragments.map((fragment) => (
              <li key={fragment.id}>
                <button
                  type="button"
                  className="multicam-fragment"
                  disabled={props.disabled}
                  onClick={() => {
                    setStartFrame(fragment.startFrame)
                    setEndFrame(fragment.endFrame)
                  }}
                  aria-label={`${selectionLabel(group, fragment, copy)}, ${fragment.startFrame}–${fragment.endFrame}`}
                >
                  <span>{selectionLabel(group, fragment, copy)}</span>
                  <small>{fragment.startFrame}–{fragment.endFrame}</small>
                  <i
                    aria-hidden="true"
                    style={{
                      insetInlineStart: `${percentage(fragment.startFrame, group.durationFrames)}%`,
                      inlineSize: `${Math.max(1, percentage(fragment.endFrame - fragment.startFrame, group.durationFrames))}%`
                    }}
                  />
                </button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <div className="multicam-program-actions">
        <button
          type="button"
          disabled={props.disabled}
          onClick={() => props.run(() => props.callbacks.onPreview({
            groupId: group.id,
            range,
            coveragePolicy
          }))}
        >{copy.previewRange}</button>
        <button
          type="button"
          disabled={props.disabled || group.programFragments.length < 2}
          onClick={() => props.run(() => props.callbacks.onMerge(group.id))}
        >{copy.mergeAdjacent}</button>
      </div>
    </div>
  )
}

function MemberCard(props: {
  group: MulticamPanelGroup
  member: MulticamPanelMember
  asset?: MulticamPanelAsset
  range: MulticamPanelRange
  coveragePolicy: 'reject' | 'clamp'
  copy: MulticamPanelMessages
  disabled: boolean
  run(operation: () => void | Promise<void>): void
  onRenameLabels(request: MulticamRenameRequest): void | Promise<void>
  onConfirmSync(request: MulticamSyncConfirmation): void | Promise<void>
  onSwitch(request: MulticamSwitchRequest): void | Promise<void>
}): React.JSX.Element {
  const { group, member, copy } = props
  const isReference = member.id === group.referenceMemberId
  const [memberLabel, setMemberLabel] = useState(member.memberLabel)
  const [angleLabel, setAngleLabel] = useState(member.angleLabel)
  const [offsetFrames, setOffsetFrames] = useState(member.sync.offsetFrames)
  const [confidence, setConfidence] = useState(member.sync.confidence ?? 0)
  const [syncStatus, setSyncStatus] = useState<'verified' | 'uncertain'>(
    member.sync.status === 'verified' ? 'verified' : 'uncertain'
  )
  const coverage = coveragePercent(member.coverage, group.durationFrames)
  const syncText = syncStatusLabel(member.sync.status, copy)
  const confidenceText = member.sync.confidence === undefined
    ? '—'
    : `${Math.round(member.sync.confidence * 100)}%`

  useEffect(() => setMemberLabel(member.memberLabel), [member.memberLabel])
  useEffect(() => setAngleLabel(member.angleLabel), [member.angleLabel])
  useEffect(() => setOffsetFrames(member.sync.offsetFrames), [member.sync.offsetFrames])
  useEffect(() => setConfidence(member.sync.confidence ?? 0), [member.sync.confidence])
  useEffect(() => {
    setSyncStatus(member.sync.status === 'verified' ? 'verified' : 'uncertain')
  }, [member.sync.status])

  return (
    <li className="multicam-member-card" data-sync-status={member.sync.status}>
      <header>
        <div>
          <strong>{member.angleLabel}</strong>
          <span>{member.memberLabel}</span>
        </div>
        {isReference && <span className="multicam-reference-badge">{copy.reference}</span>}
      </header>
      <dl className="multicam-member-facts">
        <div><dt>{copy.source}</dt><dd>{props.asset?.name ?? member.assetId}</dd></div>
        <div><dt>{copy.coverage}</dt><dd>{coverage}%</dd></div>
        <div>
          <dt>{copy.syncStatus}</dt>
          <dd aria-label={`${copy.syncStatus}: ${syncText}; ${copy.syncConfidence}: ${confidenceText}`}>
            {syncText} · {confidenceText}
          </dd>
        </div>
        <div><dt>{copy.offsetFrames}</dt><dd>{member.sync.offsetFrames}</dd></div>
      </dl>
      <div className="multicam-coverage-meter" aria-label={`${copy.coverage}: ${coverage}%`}>
        <span style={{ inlineSize: `${coverage}%` }} />
      </div>

      <details className="multicam-member-editor">
        <summary>{copy.saveLabels}</summary>
        <form
          onSubmit={(event) => {
            event.preventDefault()
            const nextMemberLabel = memberLabel.normalize('NFKC').trim()
            const nextAngleLabel = angleLabel.normalize('NFKC').trim()
            if (!nextMemberLabel || !nextAngleLabel) return
            props.run(() => props.onRenameLabels({
              groupId: group.id,
              memberId: member.id,
              memberLabel: nextMemberLabel,
              angleLabel: nextAngleLabel
            }))
          }}
        >
          <label>
            <span>{copy.memberLabel}</span>
            <input
              value={memberLabel}
              maxLength={96}
              disabled={props.disabled}
              onChange={(event) => setMemberLabel(event.target.value)}
            />
          </label>
          <label>
            <span>{copy.angleLabel}</span>
            <input
              value={angleLabel}
              maxLength={96}
              disabled={props.disabled}
              onChange={(event) => setAngleLabel(event.target.value)}
            />
          </label>
          <button type="submit" disabled={props.disabled || !memberLabel.trim() || !angleLabel.trim()}>
            {copy.saveLabels}
          </button>
        </form>
      </details>

      {!isReference && (
        <details className="multicam-sync-editor">
          <summary>{copy.confirmSync}</summary>
          <form
            onSubmit={(event) => {
              event.preventDefault()
              props.run(() => props.onConfirmSync({
                groupId: group.id,
                memberId: member.id,
                offsetFrames,
                status: syncStatus,
                confidence: Number.isFinite(confidence) ? clamp(confidence, 0, 1) : 0
              }))
            }}
          >
            <label>
              <span>{copy.offsetFrames}</span>
              <input
                type="number"
                step={1}
                value={offsetFrames}
                disabled={props.disabled}
                onChange={(event) => setOffsetFrames(integerInput(event.target.value, 0))}
              />
            </label>
            <label>
              <span>{copy.syncConfidence}</span>
              <input
                type="number"
                min={0}
                max={1}
                step={0.01}
                required
                value={confidence}
                disabled={props.disabled}
                onChange={(event) => setConfidence(Number(event.target.value))}
              />
            </label>
            <label>
              <span>{copy.syncStatus}</span>
              <select
                value={syncStatus}
                disabled={props.disabled}
                onChange={(event) => setSyncStatus(event.target.value as 'verified' | 'uncertain')}
              >
                <option value="verified">{copy.verified}</option>
                <option value="uncertain">{copy.uncertain}</option>
              </select>
            </label>
            <button type="submit" disabled={props.disabled}>{copy.confirmSync}</button>
          </form>
        </details>
      )}

      <button
        type="button"
        className="multicam-switch-button"
        disabled={props.disabled || member.sync.status === 'unknown'}
        onClick={() => props.run(() => props.onSwitch({
          groupId: group.id,
          memberId: member.id,
          range: props.range,
          coveragePolicy: props.coveragePolicy
        }))}
      >{copy.switchToAngle}</button>
    </li>
  )
}

function normalizedRange(startFrame: number, endFrame: number, durationFrames: number): MulticamPanelRange {
  const start = clamp(Math.trunc(startFrame), 0, Math.max(0, durationFrames - 1))
  return {
    startFrame: start,
    endFrame: clamp(Math.trunc(endFrame), start + 1, durationFrames)
  }
}

function coveragePercent(coverage: readonly MulticamPanelRange[], durationFrames: number): number {
  if (durationFrames <= 0) return 0
  const normalized = coverage
    .map(({ startFrame, endFrame }) => ({
      startFrame: clamp(Math.trunc(startFrame), 0, durationFrames),
      endFrame: clamp(Math.trunc(endFrame), 0, durationFrames)
    }))
    .filter(({ startFrame, endFrame }) => endFrame > startFrame)
    .sort((left, right) => left.startFrame - right.startFrame || left.endFrame - right.endFrame)
  let covered = 0
  let cursorStart = -1
  let cursorEnd = -1
  for (const range of normalized) {
    if (range.startFrame > cursorEnd) {
      if (cursorEnd > cursorStart) covered += cursorEnd - cursorStart
      cursorStart = range.startFrame
      cursorEnd = range.endFrame
    } else {
      cursorEnd = Math.max(cursorEnd, range.endFrame)
    }
  }
  if (cursorEnd > cursorStart) covered += cursorEnd - cursorStart
  return Math.round((covered / durationFrames) * 100)
}

function selectionLabel(
  group: MulticamPanelGroup,
  fragment: MulticamPanelProgramFragment,
  copy: MulticamPanelMessages
): string {
  const selection = fragment.selection
  if (selection.kind === 'angle') {
    const member = group.members.find(({ id }) => id === selection.memberId)
    return `${copy.angle}: ${member?.angleLabel ?? selection.memberId}`
  }
  const layout = group.layouts.find(({ id }) => id === selection.layoutId)
  return `${copy.layout}: ${layout?.label ?? selection.layoutId}`
}

function syncStatusLabel(status: MulticamPanelMember['sync']['status'], copy: MulticamPanelMessages): string {
  if (status === 'reference') return copy.reference
  if (status === 'verified') return copy.verified
  if (status === 'uncertain') return copy.uncertain
  return copy.unknown
}

function percentage(value: number, total: number): number {
  return total > 0 ? clamp((value / total) * 100, 0, 100) : 0
}

function integerInput(value: string, fallback: number): number {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.trunc(parsed) : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
