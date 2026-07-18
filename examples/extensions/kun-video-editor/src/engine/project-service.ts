import { randomUUID } from 'node:crypto'
import {
  lstat,
  mkdir,
  open,
  readFile,
  readdir,
  realpath,
  rename,
  rm
} from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { VideoEngineError, engineError, type VideoEngineErrorCode } from './errors.js'
import {
  MAX_PROJECT_HISTORY,
  PROJECT_SCHEMA_VERSION,
  migrateProject,
  migrateProjectWithReport,
  syncActiveSequenceProjection,
  validateProjectRoundTrip,
  type MutationReceipt,
  type Rational,
  type Revision,
  type RevisionAuthor,
  type TimelineOperation,
  type VideoProject
} from './schema.js'
import {
  buildMutationReceipt,
  type CommandAttribution,
  type ProjectCommandRequest,
  type ProjectCommandResult,
  type ProjectSelectionPatch,
  type SelectionUpdateResult
} from './command-service.js'
import { generateTimelineMarkdown } from './script.js'
import { applyTimelineOperations, assertValidTimeline, canvasForPreset } from './timeline.js'

export type CreateProjectInput = {
  id: string
  name: string
  fps?: Rational
  canvasPreset?: VideoProject['canvas']['preset']
}

export type ImportProjectInput = {
  project: VideoProject
  targetProjectId: string
  expectedSourceProjectId: string
  expectedSourceRevision: number
  sourceDocumentDigest: string
}

export type CommitMetadata = {
  author: RevisionAuthor
  actorId?: string
  transactionId?: string
  sourceOperation: string
  summary: string
  operations?: TimelineOperation[]
  inverseOperations?: TimelineOperation[]
  restoredFromRevision?: number
}

export type ProjectSummary = {
  id: string
  name: string
  currentRevision: number
  updatedAt: string
  durationFrames: number
}

export type ProjectDiagnostic = {
  id: string
  code: VideoEngineErrorCode
}

export type ProjectListResult = {
  projects: ProjectSummary[]
  diagnostics: ProjectDiagnostic[]
}

export type ProjectServiceOptions = {
  historyLimit?: number
  now?: () => Date
  commitPhaseHook?: (phase: 'pending' | 'snapshot' | 'project' | 'timeline') => void | Promise<void>
  sourceProbe?: (asset: VideoProject['assets'][number]) => Promise<{
    availability: NonNullable<VideoProject['assets'][number]['availability']>
    sourceIdentity?: VideoProject['assets'][number]['sourceIdentity']
  }>
}

type PendingProjectCommit = {
  schemaVersion: 1
  projectId: string
  previousRevision: number
  project: VideoProject
}

export class ProjectService {
  readonly workspaceRoot: string
  readonly dataRoot: string
  private readonly historyLimit: number
  private readonly now: () => Date
  private readonly commitPhaseHook?: ProjectServiceOptions['commitPhaseHook']
  private readonly sourceProbe?: ProjectServiceOptions['sourceProbe']
  private readonly operations = new Map<string, Promise<unknown>>()
  private readonly lastReceipts = new Map<string, MutationReceipt>()

  constructor(workspaceRoot: string, options: ProjectServiceOptions = {}) {
    if (!isAbsolute(workspaceRoot)) {
      throw engineError('path_escape', 'ProjectService requires an absolute workspace root')
    }
    this.workspaceRoot = resolve(workspaceRoot)
    this.dataRoot = join(this.workspaceRoot, '.kun-video')
    this.historyLimit = Math.max(2, Math.min(MAX_PROJECT_HISTORY, options.historyLimit ?? MAX_PROJECT_HISTORY))
    this.now = options.now ?? (() => new Date())
    this.commitPhaseHook = options.commitPhaseHook
    this.sourceProbe = options.sourceProbe
  }

  async createProject(input: CreateProjectInput): Promise<VideoProject> {
    validateProjectId(input.id)
    return await this.serialize(input.id, async () => {
      await this.ensureDataRoot()
      const projectDirectory = this.projectDirectory(input.id)
      const stagingDirectory = join(this.projectsRoot(), `.${input.id}.${randomUUID()}.tmp`)
      try {
        await lstat(projectDirectory)
        throw engineError('project_exists', `Project already exists: ${input.id}`)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
      await mkdir(join(stagingDirectory, 'revisions'), { recursive: true, mode: 0o700 })
      const timestamp = this.now().toISOString()
      const initialRevision: Revision = {
        revision: 0,
        parentRevision: null,
        author: 'system',
        sourceOperation: 'project.create',
        timestamp,
        summary: 'Created project',
        operations: [],
        inverseOperations: []
      }
      const sequenceId = 'sequence-main'
      const tracks: VideoProject['tracks'] = [
        { id: 'video-1', name: 'Video 1', kind: 'video', order: 0, overlap: 'reject' },
        { id: 'audio-1', name: 'Audio 1', kind: 'audio', order: 1, overlap: 'mix' },
        { id: 'captions-1', name: 'Captions', kind: 'caption', order: 2, overlap: 'reject' }
      ]
      const project: VideoProject = {
        schemaVersion: PROJECT_SCHEMA_VERSION,
        id: input.id,
        name: input.name,
        createdAt: timestamp,
        updatedAt: timestamp,
        fps: input.fps ?? { numerator: 30, denominator: 1 },
        canvas: canvasForPreset(input.canvasPreset ?? '16:9'),
        assets: [],
        mediaFolders: [],
        tracks,
        items: [],
        captions: [],
        sequences: [{
          id: sequenceId,
          name: input.name,
          tracks: structuredClone(tracks),
          items: [],
          captions: [],
          viewState: { zoom: 1, scrollFrame: 0, open: true }
        }],
        activeSequenceId: sequenceId,
        linkGroups: [],
        selection: {
          generation: 0,
          revision: 0,
          sequenceId,
          playheadFrame: 0,
          selectedAssetIds: [],
          selectedItemIds: [],
          selectedCaptionIds: [],
          selectedWordIds: []
        },
        transcripts: [],
        derivedReferences: [],
        multicamGroups: [],
        currentRevision: 0,
        eventGeneration: 0,
        revisions: [initialRevision],
        undoStack: [],
        redoStack: [],
        agentUndoStack: [],
        recovery: {
          mode: 'healthy',
          unreadableManifestKinds: [],
          interruptedJobIds: [],
          notes: []
        }
      }
      assertValidTimeline(project)
      try {
        await writeSnapshotAt(stagingDirectory, project)
        await atomicWriteJson(join(stagingDirectory, 'project.json'), project)
        await atomicWriteText(join(stagingDirectory, 'timeline.md'), generateTimelineMarkdown(project))
        await rename(stagingDirectory, projectDirectory)
      } catch (error) {
        await rm(stagingDirectory, { recursive: true, force: true })
        if (isNodeError(error, 'EEXIST') || isNodeError(error, 'ENOTEMPTY')) {
          throw engineError('project_exists', `Project already exists: ${input.id}`)
        }
        throw error
      }
      return structuredClone(project)
    })
  }

  /**
   * Materializes an already validated interchange snapshot as a new project.
   * The destination identity is explicit and creation is atomic: an existing
   * project is never replaced, merged, or truncated by import.
   */
  async importProject(input: ImportProjectInput): Promise<VideoProject> {
    validateProjectId(input.targetProjectId)
    validateProjectId(input.expectedSourceProjectId)
    if (!Number.isSafeInteger(input.expectedSourceRevision) || input.expectedSourceRevision < 0) {
      throw engineError('revision_conflict', 'Imported source revision fence is invalid')
    }
    if (!/^[a-f0-9]{64}$/u.test(input.sourceDocumentDigest)) {
      throw engineError('invalid_project', 'Imported source document digest is invalid')
    }
    const source = validateProjectRoundTrip(input.project)
    if (
      source.id !== input.expectedSourceProjectId ||
      source.currentRevision !== input.expectedSourceRevision
    ) {
      throw engineError('revision_conflict', 'Imported project identity or revision changed after preview', {
        expectedProjectId: input.expectedSourceProjectId,
        actualProjectId: source.id,
        expectedRevision: input.expectedSourceRevision,
        currentRevision: source.currentRevision
      })
    }
    if (source.currentRevision >= Number.MAX_SAFE_INTEGER) {
      throw engineError('invalid_project', 'Imported project revision cannot be advanced safely')
    }
    return await this.serialize(input.targetProjectId, async () => {
      await this.ensureDataRoot()
      const projectDirectory = this.projectDirectory(input.targetProjectId)
      try {
        await lstat(projectDirectory)
        throw engineError('project_exists', `Project already exists: ${input.targetProjectId}`)
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
      const stagingDirectory = join(
        this.projectsRoot(),
        `.${input.targetProjectId}.${randomUUID()}.tmp`
      )
      const timestamp = this.now().toISOString()
      const importedRevision = source.currentRevision + 1
      const project = syncActiveSequenceProjection({
        ...structuredClone(source),
        id: input.targetProjectId,
        updatedAt: timestamp,
        currentRevision: importedRevision,
        eventGeneration: source.eventGeneration + 1,
        selection: {
          ...structuredClone(source.selection),
          revision: importedRevision,
          generation: source.selection.generation + 1
        },
        revisions: [...source.revisions, {
          revision: importedRevision,
          parentRevision: source.currentRevision,
          author: 'manual' as const,
          sourceOperation: 'interchange.otio.import',
          timestamp,
          summary: `Imported OTIO document ${input.sourceDocumentDigest.slice(0, 12)}`,
          operations: [],
          inverseOperations: []
        }].slice(-this.historyLimit),
        undoStack: [],
        redoStack: [],
        agentUndoStack: [],
        recovery: {
          ...structuredClone(source.recovery),
          notes: [
            ...source.recovery.notes,
            `Imported from OTIO project ${input.expectedSourceProjectId} at revision ${input.expectedSourceRevision}.`,
            'Media references remain offline until explicitly relinked through Host grants.'
          ].slice(-64)
        }
      })
      assertValidTimeline(project)
      const validated = validateProjectRoundTrip(project)
      try {
        await mkdir(join(stagingDirectory, 'revisions'), { recursive: true, mode: 0o700 })
        await writeSnapshotAt(stagingDirectory, validated)
        await atomicWriteJson(join(stagingDirectory, 'project.json'), validated)
        await atomicWriteText(
          join(stagingDirectory, 'timeline.md'),
          generateTimelineMarkdown(validated)
        )
        await rename(stagingDirectory, projectDirectory)
      } catch (error) {
        await rm(stagingDirectory, { recursive: true, force: true })
        if (isNodeError(error, 'EEXIST') || isNodeError(error, 'ENOTEMPTY')) {
          throw engineError('project_exists', `Project already exists: ${input.targetProjectId}`)
        }
        throw error
      }
      return structuredClone(validated)
    })
  }

  async loadProject(projectId: string): Promise<VideoProject> {
    validateProjectId(projectId)
    await this.ensureDataRoot()
    await this.assertProjectDirectory(projectId)
    await this.recoverPendingCommit(projectId)
    try {
      await assertConfinedRegularFile(this.projectDirectory(projectId), this.projectPath(projectId))
      const rawText = await readFile(this.projectPath(projectId), 'utf8')
      const raw: unknown = JSON.parse(rawText)
      const migration = migrateProjectWithReport(raw)
      let project = validateProjectRoundTrip(migration.project)
      if (project.id !== projectId) {
        throw engineError('invalid_project', 'Project identity does not match its directory')
      }
      const beforeReconciliation = JSON.stringify(project)
      project = await this.reconcileRestartState(project)
      assertValidTimeline(project)
      if (migration.migrated) {
        await this.persistMigration(projectId, migration.sourceVersion, rawText, project)
      } else if (JSON.stringify(project) !== beforeReconciliation) {
        await atomicWriteJson(this.projectPath(projectId), project)
      }
      if (this.sourceProbe) {
        const beforeProbe = JSON.stringify(project)
        project = await this.probeSources(project)
        if (JSON.stringify(project) !== beforeProbe) {
          assertValidTimeline(project)
          await atomicWriteJson(this.projectPath(projectId), project)
        }
      }
      project = await this.reconcileAuxiliaryManifests(projectId, project)
      assertValidTimeline(project)
      return project
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw engineError('project_not_found', `Project does not exist: ${projectId}`)
      }
      if (
        error instanceof VideoEngineError &&
        ['unsupported_schema_version', 'path_escape', 'project_not_found'].includes(error.code)
      ) throw error
      return await this.loadRecoverableSnapshot(projectId, error)
    }
  }

  async listProjects(): Promise<ProjectSummary[]> {
    return (await this.listProjectsWithDiagnostics()).projects
  }

  async listProjectsWithDiagnostics(): Promise<ProjectListResult> {
    await this.ensureDataRoot()
    const projectsRoot = this.projectsRoot()
    const entries = await readdir(projectsRoot, { withFileTypes: true })
    const summaries: ProjectSummary[] = []
    const diagnostics: ProjectDiagnostic[] = []
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (!entry.isDirectory() || !isProjectId(entry.name)) continue
      let project: VideoProject
      try {
        project = await this.loadProject(entry.name)
      } catch (error) {
        diagnostics.push({
          id: entry.name,
          code: error instanceof VideoEngineError ? error.code : 'invalid_project'
        })
        continue
      }
      summaries.push({
        id: project.id,
        name: project.name,
        currentRevision: project.currentRevision,
        updatedAt: project.updatedAt,
        durationFrames: project.items.reduce(
          (maximum, item) => Math.max(maximum, item.timelineStartFrame + item.durationFrames),
          0
        )
      })
    }
    return {
      projects: summaries.sort((left, right) =>
        right.updatedAt.localeCompare(left.updatedAt) || left.id.localeCompare(right.id)
      ),
      diagnostics
    }
  }

  async saveProject(
    candidate: VideoProject,
    expectedRevision: number,
    metadata: CommitMetadata
  ): Promise<VideoProject> {
    return (await this.saveProjectWithReceipt(candidate, expectedRevision, metadata)).project
  }

  async saveProjectWithReceipt(
    candidate: VideoProject,
    expectedRevision: number,
    metadata: CommitMetadata
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId: candidate.id,
      expectedRevision,
      attribution: attributionFromMetadata(metadata),
      command: { kind: 'replace-project', project: candidate }
    })
  }

  async applyOperations(
    projectId: string,
    expectedRevision: number,
    operations: readonly TimelineOperation[],
    metadata: Omit<CommitMetadata, 'operations' | 'inverseOperations'>
  ): Promise<VideoProject> {
    return (await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: attributionFromMetadata(metadata),
      command: { kind: 'timeline', operations: [...operations] }
    })).project
  }

  async applyOperationsWithReceipt(
    projectId: string,
    expectedRevision: number,
    operations: readonly TimelineOperation[],
    metadata: Omit<CommitMetadata, 'operations' | 'inverseOperations'>
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: attributionFromMetadata(metadata),
      command: { kind: 'timeline', operations: [...operations] }
    })
  }

  async undo(
    projectId: string,
    expectedRevision: number,
    author: RevisionAuthor = 'manual'
  ): Promise<VideoProject> {
    return (await this.undoWithReceipt(projectId, expectedRevision, author)).project
  }

  async undoWithReceipt(
    projectId: string,
    expectedRevision: number,
    author: RevisionAuthor = 'manual'
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: {
        author,
        ...(author === 'agent' ? { actorId: 'kun-agent' } : {}),
        sourceOperation: 'history.undo',
        summary: 'Restored the previous project revision'
      },
      command: { kind: 'history-undo' }
    })
  }

  async redo(
    projectId: string,
    expectedRevision: number,
    author: RevisionAuthor = 'manual'
  ): Promise<VideoProject> {
    return (await this.redoWithReceipt(projectId, expectedRevision, author)).project
  }

  async redoWithReceipt(
    projectId: string,
    expectedRevision: number,
    author: RevisionAuthor = 'manual'
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: {
        author,
        ...(author === 'agent' ? { actorId: 'kun-agent' } : {}),
        sourceOperation: 'history.redo',
        summary: 'Restored the next project revision'
      },
      command: { kind: 'history-redo' }
    })
  }

  async undoAgent(
    projectId: string,
    expectedRevision: number,
    actorId: string
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: {
        author: 'agent',
        actorId,
        sourceOperation: 'history.agent-undo',
        summary: 'Undid the Agent\'s most recent eligible edit'
      },
      command: { kind: 'agent-undo', actorId }
    })
  }

  async relinkMedia(
    projectId: string,
    expectedRevision: number,
    input: Omit<Extract<ProjectCommandRequest['command'], { kind: 'relink-media' }>, 'kind'>,
    attribution: CommandAttribution = {
      author: 'manual',
      sourceOperation: 'media.relink',
      summary: 'Relinked offline media'
    }
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution,
      command: { kind: 'relink-media', ...input }
    })
  }

  async cleanupDerivedCache(
    projectId: string,
    expectedRevision: number,
    derivedIds?: string[]
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: {
        author: 'manual',
        sourceOperation: 'derived.cleanup',
        summary: 'Removed disposable derived cache references'
      },
      command: { kind: 'cleanup-derived-cache', ...(derivedIds ? { derivedIds } : {}) }
    })
  }

  async confirmRecovery(
    projectId: string,
    expectedRevision: number
  ): Promise<ProjectCommandResult> {
    return await this.executeCommand({
      projectId,
      expectedRevision,
      attribution: {
        author: 'manual',
        sourceOperation: 'project.confirm-recovery',
        summary: 'Confirmed recovery from a retained project snapshot'
      },
      command: { kind: 'confirm-recovery' }
    })
  }

  getLastReceipt(projectId: string): MutationReceipt | undefined {
    const receipt = this.lastReceipts.get(projectId)
    return receipt ? structuredClone(receipt) : undefined
  }

  async updateSelection(
    projectId: string,
    expectedRevision: number,
    expectedGeneration: number,
    patch: ProjectSelectionPatch
  ): Promise<SelectionUpdateResult> {
    validateProjectId(projectId)
    return await this.serialize(projectId, async () => {
      const current = await this.loadProject(projectId)
      assertExpectedRevision(current, expectedRevision)
      if (current.selection.generation !== expectedGeneration) {
        throw engineError('revision_conflict', 'Video selection generation has changed', {
          expectedRevision,
          currentRevision: current.currentRevision,
          expectedGeneration,
          currentGeneration: current.selection.generation
        })
      }
      if (current.recovery.mode === 'write-blocked') {
        throw engineError('recovery_required', 'Selection cannot be persisted until recovery is confirmed')
      }
      const project = syncActiveSequenceProjection({
        ...structuredClone(current),
        eventGeneration: current.eventGeneration + 1,
        selection: {
          ...structuredClone(current.selection),
          ...structuredClone(patch),
          generation: current.selection.generation + 1,
          revision: current.currentRevision
        }
      })
      assertValidTimeline(project)
      await atomicWriteJson(this.projectPath(projectId), project)
      return {
        projectId,
        revision: project.currentRevision,
        generation: project.selection.generation,
        eventGeneration: project.eventGeneration,
        selection: structuredClone(project.selection)
      }
    })
  }

  async executeCommand(request: ProjectCommandRequest): Promise<ProjectCommandResult> {
    validateProjectId(request.projectId)
    validateAttribution(request.attribution)
    if (!Number.isSafeInteger(request.expectedRevision) || request.expectedRevision < 0) {
      throw engineError('revision_conflict', 'Expected revision must be a non-negative integer')
    }
    return await this.serialize(request.projectId, async () => {
      const current = await this.loadProject(request.projectId)
      assertExpectedRevision(current, request.expectedRevision)
      if (current.recovery.mode === 'write-blocked' && request.command.kind !== 'confirm-recovery') {
        throw engineError(
          'recovery_required',
          'The recovered project is write-blocked until recovery is explicitly confirmed',
          {
            projectId: current.id,
            recoveredFromRevision: current.recovery.recoveredFromRevision,
            unreadableManifestKinds: current.recovery.unreadableManifestKinds
          }
        )
      }

      const transactionId = randomUUID()
      let candidate: VideoProject
      let operationNotes: MutationReceipt['notes'] = []
      let metadata: CommitMetadata = {
        ...request.attribution,
        transactionId
      }
      let stacks = {
        undoStack: [...current.undoStack, current.currentRevision],
        redoStack: [] as number[],
        agentUndoStack: structuredClone(current.agentUndoStack)
      }

      switch (request.command.kind) {
        case 'timeline': {
          const result = applyTimelineOperations(current, request.command.operations)
          candidate = result.project
          operationNotes = result.notes
          metadata = {
            ...metadata,
            operations: structuredClone(request.command.operations),
            inverseOperations: result.inverseOperations
          }
          break
        }
        case 'replace-project':
          candidate = syncActiveSequenceProjection(request.command.project)
          break
        case 'history-undo': {
          const targetRevision = current.undoStack.at(-1)
          if (targetRevision === undefined) {
            throw engineError('history_unavailable', 'No retained project revision is available to undo')
          }
          candidate = await this.loadSnapshot(request.projectId, targetRevision)
          metadata = {
            ...metadata,
            summary: `Restored revision ${targetRevision}`,
            operations: [],
            inverseOperations: [],
            restoredFromRevision: targetRevision
          }
          stacks = {
            undoStack: current.undoStack.slice(0, -1),
            redoStack: [...current.redoStack, current.currentRevision],
            agentUndoStack: structuredClone(current.agentUndoStack)
          }
          break
        }
        case 'history-redo': {
          const targetRevision = current.redoStack.at(-1)
          if (targetRevision === undefined) {
            throw engineError('history_unavailable', 'No retained project revision is available to redo')
          }
          candidate = await this.loadSnapshot(request.projectId, targetRevision)
          metadata = {
            ...metadata,
            summary: `Restored revision ${targetRevision}`,
            operations: [],
            inverseOperations: [],
            restoredFromRevision: targetRevision
          }
          stacks = {
            undoStack: [...current.undoStack, current.currentRevision],
            redoStack: current.redoStack.slice(0, -1),
            agentUndoStack: structuredClone(current.agentUndoStack)
          }
          break
        }
        case 'agent-undo': {
          const eligible = current.agentUndoStack.at(-1)
          if (
            !eligible ||
            eligible.revision !== current.currentRevision ||
            eligible.actorId !== request.command.actorId
          ) {
            throw engineError(
              'agent_undo_fenced',
              'Agent undo refused because newer manual or foreign work intervened',
              {
                currentRevision: current.currentRevision,
                eligibleRevision: eligible?.revision,
                eligibleActorId: eligible?.actorId
              }
            )
          }
          const parentRevision = current.revisions.at(-1)?.parentRevision
          if (parentRevision === null || parentRevision === undefined) {
            throw engineError('history_unavailable', 'The Agent transaction has no retained parent revision')
          }
          candidate = await this.loadSnapshot(request.projectId, parentRevision)
          metadata = {
            ...metadata,
            summary: `Undid Agent transaction ${eligible.transactionId}`,
            operations: [],
            inverseOperations: [],
            restoredFromRevision: parentRevision
          }
          stacks = {
            undoStack: [...current.undoStack, current.currentRevision],
            redoStack: [],
            agentUndoStack: current.agentUndoStack.slice(0, -1)
          }
          break
        }
        case 'relink-media':
          candidate = relinkMedia(current, request.command, this.now().toISOString())
          break
        case 'cleanup-derived-cache':
          candidate = cleanupDerivedReferences(current, request.command.derivedIds)
          break
        case 'confirm-recovery':
          await this.preserveRecoveryEvidence(current)
          candidate = {
            ...structuredClone(current),
            recovery: {
              mode: 'healthy',
              unreadableManifestKinds: [],
              interruptedJobIds: structuredClone(current.recovery.interruptedJobIds),
              notes: ['Recovery explicitly confirmed; the preserved unreadable manifest was not deleted.']
            }
          }
          break
      }

      const next = await this.commit(current, candidate, metadata, stacks)
      const receipt = buildMutationReceipt(current, next, transactionId, request.attribution, operationNotes)
      this.lastReceipts.set(next.id, receipt)
      return { project: next, receipt }
    })
  }

  async loadRevision(projectId: string, revision: number): Promise<VideoProject> {
    validateProjectId(projectId)
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw engineError('history_unavailable', 'Revision must be a non-negative integer')
    }
    await this.ensureDataRoot()
    await this.assertProjectDirectory(projectId)
    return await this.loadSnapshot(projectId, revision)
  }

  private async commit(
    current: VideoProject,
    candidate: VideoProject,
    metadata: CommitMetadata,
    stacks: { undoStack: number[]; redoStack: number[]; agentUndoStack: VideoProject['agentUndoStack'] }
  ): Promise<VideoProject> {
    const synchronizedCandidate = syncActiveSequenceProjection(candidate)
    if (synchronizedCandidate.id !== current.id || synchronizedCandidate.createdAt !== current.createdAt) {
      throw engineError('invalid_project', 'A project commit cannot change stable identity fields')
    }
    const revisionNumber = current.currentRevision + 1
    const timestamp = this.now().toISOString()
    const revision: Revision = {
      revision: revisionNumber,
      parentRevision: current.currentRevision,
      author: metadata.author,
      ...(metadata.actorId ? { actorId: metadata.actorId } : {}),
      ...(metadata.transactionId ? { transactionId: metadata.transactionId } : {}),
      sourceOperation: metadata.sourceOperation,
      timestamp,
      summary: metadata.summary,
      operations: structuredClone(metadata.operations ?? []),
      inverseOperations: structuredClone(metadata.inverseOperations ?? []),
      ...(metadata.restoredFromRevision === undefined
        ? {}
        : { restoredFromRevision: metadata.restoredFromRevision })
    }
    const retainedRevisions = [...current.revisions, revision].slice(-this.historyLimit)
    const retainedNumbers = new Set(retainedRevisions.map(({ revision: number }) => number))
    const nextAgentUndoStack = metadata.author === 'agent' &&
      metadata.actorId !== undefined &&
      !metadata.sourceOperation.startsWith('history.')
      ? [...stacks.agentUndoStack, {
          revision: revisionNumber,
          actorId: metadata.actorId,
          transactionId: metadata.transactionId ?? randomUUID()
        }]
      : stacks.agentUndoStack
    const next: VideoProject = {
      ...structuredClone(synchronizedCandidate),
      schemaVersion: PROJECT_SCHEMA_VERSION,
      id: current.id,
      createdAt: current.createdAt,
      updatedAt: timestamp,
      currentRevision: revisionNumber,
      eventGeneration: current.eventGeneration + 1,
      selection: {
        ...structuredClone(synchronizedCandidate.selection),
        revision: revisionNumber,
        sequenceId: synchronizedCandidate.activeSequenceId
      },
      revisions: retainedRevisions,
      undoStack: stacks.undoStack.filter((number) => retainedNumbers.has(number)).slice(-this.historyLimit),
      redoStack: stacks.redoStack.filter((number) => retainedNumbers.has(number)).slice(-this.historyLimit),
      agentUndoStack: nextAgentUndoStack
        .filter(({ revision: number }) => retainedNumbers.has(number))
        .slice(-this.historyLimit)
    }
    const validated = syncActiveSequenceProjection(next)
    assertValidTimeline(validated)
    const pending: PendingProjectCommit = {
      schemaVersion: 1,
      projectId: validated.id,
      previousRevision: current.currentRevision,
      project: structuredClone(validated)
    }
    await atomicWriteJson(this.pendingCommitPath(validated.id), pending)
    await this.commitPhaseHook?.('pending')
    let snapshotWritten = false
    let projectCommitted = false
    try {
      await this.writeSnapshot(validated)
      snapshotWritten = true
      await this.commitPhaseHook?.('snapshot')
      await atomicWriteJson(this.projectPath(validated.id), validated)
      projectCommitted = true
      await this.commitPhaseHook?.('project')
      await atomicWriteText(this.timelinePath(validated.id), generateTimelineMarkdown(validated))
      await this.commitPhaseHook?.('timeline')
      await rm(this.pendingCommitPath(validated.id), { force: true })
    } catch (error) {
      if (!projectCommitted) {
        if (snapshotWritten) await rm(this.snapshotPath(validated.id, revisionNumber), { force: true })
        await rm(this.pendingCommitPath(validated.id), { force: true })
        throw error
      }
      // project.json is the transaction commit point. Once it has moved into
      // place, finish the journal rather than reporting a false rollback to a
      // caller that could retry the same revision.
      await this.recoverPendingCommit(validated.id)
    }
    await this.pruneSnapshots(validated.id, retainedNumbers)
    return structuredClone(validated)
  }

  private async recoverPendingCommit(projectId: string): Promise<void> {
    const pendingPath = this.pendingCommitPath(projectId)
    let raw: unknown
    try {
      await assertConfinedRegularFile(this.projectDirectory(projectId), pendingPath)
      raw = JSON.parse(await readFile(pendingPath, 'utf8'))
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return
      throw error
    }
    const pending = parsePendingProjectCommit(raw, projectId)
    let current: VideoProject
    try {
      await assertConfinedRegularFile(this.projectDirectory(projectId), this.projectPath(projectId))
      current = migrateProject(JSON.parse(await readFile(this.projectPath(projectId), 'utf8')))
      assertValidTimeline(current)
    } catch (error) {
      throw engineError('invalid_project', 'Pending project commit cannot read its commit point', {
        cause: error instanceof Error ? error.message : String(error)
      })
    }

    if (current.currentRevision === pending.previousRevision) {
      await rm(this.snapshotPath(projectId, pending.project.currentRevision), { force: true })
      await rm(pendingPath, { force: true })
      return
    }
    if (current.currentRevision > pending.project.currentRevision) {
      await rm(pendingPath, { force: true })
      return
    }
    if (
      current.currentRevision !== pending.project.currentRevision ||
      JSON.stringify(current) !== JSON.stringify(pending.project)
    ) {
      throw engineError('invalid_project', 'Pending project commit disagrees with project.json')
    }

    await atomicWriteJson(this.snapshotPath(projectId, current.currentRevision), current)
    await atomicWriteText(this.timelinePath(projectId), generateTimelineMarkdown(current))
    await rm(pendingPath, { force: true })
  }

  private async loadSnapshot(projectId: string, revision: number): Promise<VideoProject> {
    try {
      await assertConfinedRegularFile(
        this.projectDirectory(projectId),
        this.snapshotPath(projectId, revision)
      )
      const raw: unknown = JSON.parse(await readFile(this.snapshotPath(projectId, revision), 'utf8'))
      const project = migrateProject(raw)
      assertValidTimeline(project)
      return project
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw engineError('history_unavailable', `Revision ${revision} is no longer retained`)
      }
      throw error
    }
  }

  private async persistMigration(
    projectId: string,
    sourceVersion: number,
    rawText: string,
    project: VideoProject
  ): Promise<void> {
    const backupDirectory = this.backupDirectory(projectId)
    await rejectSymbolicPath(this.projectDirectory(projectId), backupDirectory)
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
    const backupPath = join(backupDirectory, `project.schema-v${sourceVersion}.json`)
    try {
      const handle = await open(backupPath, 'wx', 0o600)
      try {
        await handle.writeFile(rawText, 'utf8')
        await handle.sync()
      } finally {
        await handle.close()
      }
    } catch (error) {
      // A migration backup is immutable. Retrying a migration must never
      // replace the first recoverable source document.
      if (!isNodeError(error, 'EEXIST')) throw error
    }
    const validated = validateProjectRoundTrip(project)
    await atomicWriteJson(this.projectPath(projectId), validated)
    await atomicWriteText(this.timelinePath(projectId), generateTimelineMarkdown(validated))
  }

  private async loadRecoverableSnapshot(projectId: string, cause: unknown): Promise<VideoProject> {
    const entries = await readdir(this.revisionDirectory(projectId)).catch(() => [])
    const revisions = entries.flatMap((entry) => {
      const match = /^revision-(\d+)\.json$/u.exec(entry)
      return match ? [Number(match[1])] : []
    }).sort((left, right) => right - left)
    for (const revision of revisions) {
      try {
        const recovered = await this.loadSnapshot(projectId, revision)
        const project = syncActiveSequenceProjection({
          ...recovered,
          recovery: {
            mode: 'write-blocked',
            recoveredFromRevision: revision,
            unreadableManifestKinds: ['project'],
            interruptedJobIds: structuredClone(recovered.recovery.interruptedJobIds),
            notes: [
              `project.json was preserved after a read failure: ${boundedCause(cause)}`
            ]
          }
        })
        assertValidTimeline(project)
        return project
      } catch (error) {
        if (error instanceof VideoEngineError && error.code === 'unsupported_schema_version') throw error
      }
    }
    throw engineError('invalid_project', 'Project manifest is unreadable and no valid snapshot is retained', {
      cause: boundedCause(cause)
    })
  }

  private async reconcileRestartState(project: VideoProject): Promise<VideoProject> {
    const next = structuredClone(project)
    const interrupted = new Set(next.recovery.interruptedJobIds)
    let changed = false
    for (const reference of next.derivedReferences) {
      if (reference.status !== 'processing') continue
      reference.status = 'interrupted'
      reference.errorCode = 'process_interrupted_by_restart'
      reference.updatedAt = this.now().toISOString()
      interrupted.add(reference.id)
      changed = true
    }
    if (!changed) return next
    next.recovery.interruptedJobIds = [...interrupted].slice(-128)
    next.recovery.notes = [
      ...next.recovery.notes,
      'In-flight derived work was reconciled as interrupted after restart.'
    ].slice(-128)
    return next
  }

  private async probeSources(project: VideoProject): Promise<VideoProject> {
    if (!this.sourceProbe) return structuredClone(project)
    const next = structuredClone(project)
    for (const asset of next.assets) {
      let result: Awaited<ReturnType<NonNullable<ProjectServiceOptions['sourceProbe']>>>
      try {
        result = await this.sourceProbe(asset)
      } catch {
        result = { availability: 'offline' }
      }
      const identityChanged = asset.sourceIdentity !== undefined &&
        result.sourceIdentity !== undefined &&
        JSON.stringify(asset.sourceIdentity) !== JSON.stringify(result.sourceIdentity)
      const availability = identityChanged ? 'changed' : result.availability
      asset.availability = availability
      asset.recovery = availability === 'online'
        ? { lastVerifiedAt: this.now().toISOString() }
        : {
            reason: availability === 'offline' ? 'missing' : availability,
            lastVerifiedAt: this.now().toISOString(),
            ...(asset.mediaHandleId ? { previousMediaHandleId: asset.mediaHandleId } : {})
          }
      if (availability !== 'online') {
        for (const reference of next.derivedReferences) {
          if (reference.sourceAssetId === asset.id) {
            reference.status = 'invalid'
            reference.errorCode = `source_${availability}`
            reference.updatedAt = this.now().toISOString()
          }
        }
      }
    }
    return next
  }

  private async reconcileAuxiliaryManifests(
    projectId: string,
    project: VideoProject
  ): Promise<VideoProject> {
    const next = structuredClone(project)
    for (const kind of ['media', 'derived'] as const) {
      const path = join(this.projectDirectory(projectId), `${kind}-manifest.json`)
      try {
        await assertConfinedRegularFile(this.projectDirectory(projectId), path)
        JSON.parse(await readFile(path, 'utf8'))
      } catch (error) {
        if (isNodeError(error, 'ENOENT')) continue
        if (error instanceof VideoEngineError && error.code === 'path_escape') throw error
        next.recovery.mode = 'write-blocked'
        next.recovery.unreadableManifestKinds = [
          ...new Set([...next.recovery.unreadableManifestKinds, kind])
        ]
        next.recovery.notes = [
          ...next.recovery.notes,
          `${kind}-manifest.json was preserved after a read failure: ${boundedCause(error)}`
        ].slice(-128)
        if (kind === 'media') {
          for (const asset of next.assets) {
            asset.availability = 'offline'
            asset.recovery = {
              reason: 'manifest-unreadable',
              ...(asset.mediaHandleId ? { previousMediaHandleId: asset.mediaHandleId } : {})
            }
          }
        } else {
          for (const reference of next.derivedReferences) {
            reference.status = 'invalid'
            reference.errorCode = 'manifest_unreadable'
          }
        }
      }
    }
    return next
  }

  private async preserveRecoveryEvidence(project: VideoProject): Promise<void> {
    if (project.recovery.mode !== 'write-blocked') return
    const backupDirectory = this.backupDirectory(project.id)
    await rejectSymbolicPath(this.projectDirectory(project.id), backupDirectory)
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
    for (const kind of project.recovery.unreadableManifestKinds) {
      const sourcePath = kind === 'project'
        ? this.projectPath(project.id)
        : join(this.projectDirectory(project.id), `${kind}-manifest.json`)
      const destination = join(backupDirectory, `unreadable-${kind}-manifest.json`)
      try {
        await assertConfinedRegularFile(this.projectDirectory(project.id), sourcePath)
        const content = await readFile(sourcePath)
        try {
          const handle = await open(destination, 'wx', 0o600)
          try {
            await handle.writeFile(content)
            await handle.sync()
          } finally {
            await handle.close()
          }
        } catch (error) {
          if (!isNodeError(error, 'EEXIST')) throw error
        }
        if (kind !== 'project') await rm(sourcePath, { force: true })
      } catch (error) {
        if (!isNodeError(error, 'ENOENT')) throw error
      }
    }
  }

  private async writeSnapshot(project: VideoProject): Promise<void> {
    await writeSnapshotAt(this.projectDirectory(project.id), project)
  }

  private async pruneSnapshots(projectId: string, retained: ReadonlySet<number>): Promise<void> {
    const directory = this.revisionDirectory(projectId)
    const entries = await readdir(directory)
    await Promise.all(entries.flatMap((entry) => {
      const match = /^revision-(\d+)\.json$/u.exec(entry)
      if (!match || retained.has(Number(match[1]))) return []
      return [rm(join(directory, entry), { force: true })]
    }))
  }

  private async ensureDataRoot(): Promise<void> {
    await mkdir(this.workspaceRoot, { recursive: true, mode: 0o700 })
    const workspaceCanonical = await realpath(this.workspaceRoot)
    await rejectSymbolicPath(this.workspaceRoot, this.dataRoot)
    await mkdir(this.dataRoot, { recursive: true, mode: 0o700 })
    const dataCanonical = await realpath(this.dataRoot)
    assertInside(workspaceCanonical, dataCanonical)
    await rejectSymbolicPath(this.dataRoot, this.projectsRoot())
    await mkdir(this.projectsRoot(), { recursive: true, mode: 0o700 })
    const projectsCanonical = await realpath(this.projectsRoot())
    assertInside(dataCanonical, projectsCanonical)
  }

  private async assertProjectDirectory(projectId: string): Promise<void> {
    const projectDirectory = this.projectDirectory(projectId)
    try {
      const stats = await lstat(projectDirectory)
      if (!stats.isDirectory() || stats.isSymbolicLink()) {
        throw engineError('path_escape', 'Project directory must be a real confined directory')
      }
      const canonicalProjects = await realpath(this.projectsRoot())
      const canonicalProject = await realpath(projectDirectory)
      assertInside(canonicalProjects, canonicalProject)
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) {
        throw engineError('project_not_found', `Project does not exist: ${projectId}`)
      }
      throw error
    }
  }

  private projectsRoot(): string {
    return join(this.dataRoot, 'projects')
  }

  private projectDirectory(projectId: string): string {
    validateProjectId(projectId)
    return join(this.projectsRoot(), projectId)
  }

  private projectPath(projectId: string): string {
    return join(this.projectDirectory(projectId), 'project.json')
  }

  private timelinePath(projectId: string): string {
    return join(this.projectDirectory(projectId), 'timeline.md')
  }

  private revisionDirectory(projectId: string): string {
    return join(this.projectDirectory(projectId), 'revisions')
  }

  private backupDirectory(projectId: string): string {
    return join(this.projectDirectory(projectId), 'backups')
  }

  private snapshotPath(projectId: string, revision: number): string {
    return join(this.revisionDirectory(projectId), `revision-${String(revision).padStart(8, '0')}.json`)
  }

  private pendingCommitPath(projectId: string): string {
    return join(this.projectDirectory(projectId), '.pending-commit.json')
  }

  private async serialize<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.operations.get(projectId) ?? Promise.resolve()
    const current = previous.then(operation, operation)
    this.operations.set(projectId, current)
    try {
      return await current
    } finally {
      if (this.operations.get(projectId) === current) this.operations.delete(projectId)
    }
  }
}

function parsePendingProjectCommit(value: unknown, projectId: string): PendingProjectCommit {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw engineError('invalid_project', 'Pending project commit is invalid')
  }
  const candidate = value as Record<string, unknown>
  const keys = Object.keys(candidate).sort()
  if (
    JSON.stringify(keys) !==
      JSON.stringify(['previousRevision', 'project', 'projectId', 'schemaVersion']) ||
    candidate.schemaVersion !== 1 ||
    candidate.projectId !== projectId ||
    !Number.isSafeInteger(candidate.previousRevision) ||
    Number(candidate.previousRevision) < 0
  ) {
    throw engineError('invalid_project', 'Pending project commit metadata is invalid')
  }
  const project = migrateProject(candidate.project)
  assertValidTimeline(project)
  if (
    project.id !== projectId ||
    project.currentRevision !== Number(candidate.previousRevision) + 1
  ) {
    throw engineError('invalid_project', 'Pending project commit revision is invalid')
  }
  return {
    schemaVersion: 1,
    projectId,
    previousRevision: Number(candidate.previousRevision),
    project
  }
}

async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await atomicWriteText(path, `${JSON.stringify(value, null, 2)}\n`)
}

async function writeSnapshotAt(projectDirectory: string, project: VideoProject): Promise<void> {
  const path = join(
    projectDirectory,
    'revisions',
    `revision-${String(project.currentRevision).padStart(8, '0')}.json`
  )
  const handle = await open(path, 'wx', 0o600)
  try {
    await handle.writeFile(`${JSON.stringify(project, null, 2)}\n`, 'utf8')
    await handle.sync()
  } finally {
    await handle.close()
  }
}

async function atomicWriteText(path: string, value: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${randomUUID()}.tmp`)
  const handle = await open(temporary, 'wx', 0o600)
  try {
    await handle.writeFile(value, 'utf8')
    await handle.sync()
    await handle.close()
    await rename(temporary, path)
  } catch (error) {
    await handle.close().catch(() => undefined)
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  }
}

async function rejectSymbolicPath(root: string, target: string): Promise<void> {
  const fromRoot = relative(root, target)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw engineError('path_escape', 'Project path escapes the workspace')
  }
  let cursor = root
  for (const part of fromRoot.split(sep)) {
    cursor = join(cursor, part)
    try {
      if ((await lstat(cursor)).isSymbolicLink()) {
        throw engineError('path_escape', 'Symbolic links are not accepted in project storage')
      }
    } catch (error) {
      if (isNodeError(error, 'ENOENT')) return
      throw error
    }
  }
}

async function assertConfinedRegularFile(root: string, path: string): Promise<void> {
  const details = await lstat(path)
  if (!details.isFile() || details.isSymbolicLink()) {
    throw engineError('path_escape', 'Project state must be a real confined regular file')
  }
  assertInside(await realpath(root), await realpath(path))
}

function assertInside(root: string, candidate: string): void {
  const fromRoot = relative(root, candidate)
  if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw engineError('path_escape', 'Project path escapes the workspace')
  }
}

function assertExpectedRevision(project: VideoProject, expectedRevision: number): void {
  if (project.currentRevision !== expectedRevision) {
    throw engineError('revision_conflict', 'Project revision has changed', {
      expectedRevision,
      currentRevision: project.currentRevision
    })
  }
}

function attributionFromMetadata(metadata: CommitMetadata): CommandAttribution {
  return {
    author: metadata.author,
    ...(metadata.actorId
      ? { actorId: metadata.actorId }
      : metadata.author === 'agent'
        ? { actorId: 'kun-agent' }
        : {}),
    sourceOperation: metadata.sourceOperation,
    summary: metadata.summary
  }
}

function validateAttribution(attribution: CommandAttribution): void {
  if (!['manual', 'agent', 'system'].includes(attribution.author)) {
    throw engineError('invalid_operation', 'Command attribution contains an unsupported author')
  }
  if (
    attribution.author === 'agent' &&
    (typeof attribution.actorId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(attribution.actorId))
  ) {
    throw engineError('invalid_operation', 'Agent commands require a bounded actor identity')
  }
  if (
    typeof attribution.sourceOperation !== 'string' ||
    attribution.sourceOperation.length === 0 ||
    attribution.sourceOperation.length > 128 ||
    typeof attribution.summary !== 'string' ||
    attribution.summary.length === 0 ||
    attribution.summary.length > 1_024
  ) {
    throw engineError('invalid_operation', 'Command attribution is not bounded')
  }
}

function relinkMedia(
  source: VideoProject,
  command: Extract<ProjectCommandRequest['command'], { kind: 'relink-media' }>,
  timestamp: string
): VideoProject {
  const project = structuredClone(source)
  const asset = project.assets.find(({ id }) => id === command.assetId)
  if (!asset) throw engineError('media_relink_required', `Media asset does not exist: ${command.assetId}`)
  if (!command.replacement && !command.mediaHandleId && !command.workspaceRelativePath) {
    throw engineError('media_relink_required', 'Relink requires an opaque media handle or workspace-relative path')
  }
  const previousMediaHandleId = asset.mediaHandleId
  if (command.replacement) {
    if (command.replacement.id !== asset.id || command.replacement.kind !== asset.kind) {
      throw engineError('media_relink_required', 'Replacement media must preserve the asset identity and kind')
    }
    Object.assign(asset, structuredClone(command.replacement))
  }
  if (command.mediaHandleId) asset.mediaHandleId = command.mediaHandleId
  else if (!command.replacement) delete asset.mediaHandleId
  if (command.workspaceRelativePath) asset.workspaceRelativePath = command.workspaceRelativePath
  else if (!command.replacement) delete asset.workspaceRelativePath
  asset.availability = 'online'
  if (command.sourceIdentity) asset.sourceIdentity = structuredClone(command.sourceIdentity)
  asset.recovery = {
    lastVerifiedAt: timestamp,
    ...(previousMediaHandleId ? { previousMediaHandleId } : {})
  }
  for (const reference of project.derivedReferences) {
    if (reference.sourceAssetId !== asset.id) continue
    reference.status = 'invalid'
    reference.errorCode = 'source_relinked'
    reference.updatedAt = timestamp
  }
  return syncActiveSequenceProjection(project)
}

function cleanupDerivedReferences(
  source: VideoProject,
  requestedIds: readonly string[] | undefined
): VideoProject {
  const project = structuredClone(source)
  const requested = requestedIds ? new Set(requestedIds) : undefined
  if (requested) {
    for (const id of requested) {
      if (!project.derivedReferences.some((reference) => reference.id === id)) {
        throw engineError('invalid_operation', `Derived reference does not exist: ${id}`)
      }
    }
  }
  const byId = new Map(project.derivedReferences.map((reference) => [reference.id, reference]))
  const protectedIds = new Set(project.derivedReferences.filter(({ pinned }) => pinned).map(({ id }) => id))
  const visitDependencies = (id: string): void => {
    for (const dependencyId of byId.get(id)?.dependencyIds ?? []) {
      if (protectedIds.has(dependencyId)) continue
      protectedIds.add(dependencyId)
      visitDependencies(dependencyId)
    }
  }
  for (const id of [...protectedIds]) visitDependencies(id)
  project.derivedReferences = project.derivedReferences.filter((reference) =>
    protectedIds.has(reference.id) || (requested ? !requested.has(reference.id) : false)
  )
  return project
}

function boundedCause(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/[\r\n]+/gu, ' ').slice(0, 512)
}

function validateProjectId(value: string): void {
  if (!isProjectId(value)) {
    throw engineError('path_escape', 'Project ID is not a confined stable identifier')
  }
}

function isProjectId(value: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._~-]{0,127}$/u.test(value) && value !== '.' && value !== '..'
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && (error as NodeJS.ErrnoException).code === code
}
