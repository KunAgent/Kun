import type {
  AttachmentMetadata,
  GraphOrchestrationStrategy,
  GraphRunV1,
  ThreadGoalStatus,
  ThreadSummary,
  ThreadTodoItem,
  ThreadTodoStatus
} from '../contracts/index.js'
import {
  kunToolPermissionModeFromSettings,
  type ApprovalPolicy,
  type ApprovalReviewer,
  type SandboxMode
} from '../contracts/policy.js'
import {
  isModelConnectionProfileUsable,
  type ModelConnectionProfile,
  type ModelConnectionSnapshot
} from '../contracts/model-connections.js'
import type { ModelReasoningEffort, ModelReasoningCapabilityMetadata } from '../contracts/capabilities.js'
import { redactSecretText } from '../config/secret-redaction.js'
import {
  cp,
  lstat,
  mkdir,
  open,
  readdir,
  readFile,
  realpath,
  rename as renameFile,
  rm,
  stat,
  writeFile
} from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { UserInputAnswer } from './client.js'
import { execFile as execFileCallback } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { promisify } from 'node:util'
import {
  KunTuiClient,
  TuiClientError,
  type TuiConnection
} from './client.js'
import type { TuiOptions } from './options.js'
import {
  applyRuntimeEvent,
  hydrateProjectedChildRuns,
  matchingRequestContextSnapshot,
  projectThreadSnapshot,
  setProjectionRunningTurn,
  type ThreadProjection
} from './state.js'
import {
  emptyTuiPersistentState,
  modelStateKey,
  readTuiPersistentState,
  writeTuiPersistentState,
  type TuiPersistentState,
  type TuiRecentModel
} from './persistence.js'
import { modelCapabilitiesForProviderModel } from '../loop/model-context-profile.js'
import { setVisualTheme, type TuiThemeName } from './visual-system.js'
import {
  KunProjectConfigSchema,
  loadKunProjectConfig,
  writeKunProjectConfig
} from '../config/project-config.js'
import { readRuntimeDiscovery } from '../server/runtime-discovery.js'
import { parsePastedFilePaths } from './pasted-paths.js'
import type { ClipboardImage } from './clipboard-image.js'
import {
  isTerminalGraphRun,
  latestTuiGraphRun,
  summarizeTuiGraphRun
} from './graph-mode.js'
import { parseTuiFileMentions } from './file-mentions.js'
const execFile = promisify(execFileCallback)
import { safeMessage, modelConnectionUnavailableMessage, isRefreshConflict, isMissingThread, replaceGraphRun, splitWords, extensionGrantArguments, todoInput, resolveTodo, attachmentIdsFromProjection, mergeAttachmentMetadata, attachmentMimeType, isLikelyUtf8Text, isVideoPath, formatBytes, normalizeSkillId, skillTemplate, assertPathMissing, writeTextAtomically, isPathInside, validateSkillImportTree } from './controller-utils.js'
import { TuiControllerIntegrations } from './controller-integrations.js'
import {
  applyImportPlan,
  buildImportPlan,
  describeImportPlan,
  parseImportArgs
} from '../instructions/instruction-import.js'
import { IMPORT_ADAPTERS, supportedToolIds } from '../instructions/import-adapters.js'

export abstract class TuiControllerCommands extends TuiControllerIntegrations {
  setTheme(value?: string): void {
    const themes: TuiThemeName[] = ['kun', 'ocean', 'mono']
    const requested = value?.trim().toLowerCase()
    const next = requested
      ? themes.find((theme) => theme === requested)
      : themes[(themes.indexOf(this.stateValue.theme) + 1) % themes.length]
    if (!next) {
      this.notify(`Unknown theme: ${value}. Available: ${themes.join(', ')}.`, 'error')
      return
    }
    setVisualTheme(next)
    this.persisted = { ...this.persisted, theme: next }
    this.patch({ theme: next })
    void this.savePersistentState()
    this.notify(`TUI theme: ${next}`)
  }

  async showRuntimeConsole(): Promise<void> {
    try {
      const discovery = await readRuntimeDiscovery(this.options.dataDir)
      if (!discovery?.logPath) {
        this.inspect('Runtime console', ['The active runtime did not publish a log path.'])
        return
      }
      const handle = await open(discovery.logPath, 'r')
      let content = ''
      try {
        const metadata = await handle.stat()
        const maxBytes = 1024 * 1024
        const start = Math.max(0, metadata.size - maxBytes)
        const buffer = Buffer.alloc(Math.min(metadata.size, maxBytes))
        if (buffer.length) await handle.read(buffer, 0, buffer.length, start)
        content = buffer.toString('utf8')
      } finally {
        await handle.close()
      }
      const lines = content.split(/\r?\n/u)
      this.inspect('Runtime console', [
        `Log: ${discovery.logPath}`,
        '',
        ...lines.slice(-500)
      ])
    } catch (error) {
      this.fail(error)
    }
  }

  async showWorkspaceDiff(): Promise<void> {
    const workspace = this.stateValue.projection?.thread.workspace ?? this.options.workspace
    this.patch({ busy: true, busyLabel: 'Loading Git diff' })
    try {
      const [{ stdout: unstaged }, { stdout: staged }] = await Promise.all([
        execFile('git', ['diff', '--no-ext-diff', '--no-color'], {
          cwd: workspace,
          maxBuffer: 2 * 1024 * 1024,
          encoding: 'utf8'
        }),
        execFile('git', ['diff', '--cached', '--no-ext-diff', '--no-color'], {
          cwd: workspace,
          maxBuffer: 2 * 1024 * 1024,
          encoding: 'utf8'
        })
      ])
      this.patch({ busy: false })
      const lines = [
        ...(staged.trim() ? ['Staged', ...staged.split(/\r?\n/u), ''] : []),
        ...(unstaged.trim() ? ['Unstaged', ...unstaged.split(/\r?\n/u)] : [])
      ]
      this.inspect('Workspace diff', lines.length ? lines : ['Working tree has no staged or unstaged diff.'])
    } catch (error) {
      this.fail(error)
    }
  }

  async showContext(): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const usage = await this.client.usage()
      const bucket = usage.buckets.find((entry) => entry.thread_id === projection.thread.id)
      const providerId = this.options.providerId ?? projection.thread.providerId
      const accountId = this.options.accountId ?? projection.thread.accountId
      const model = this.options.model ?? projection.thread.model
      const contextSnapshot = matchingRequestContextSnapshot(projection, {
        model,
        providerId
      })
      const configuredContextWindow = this.stateValue.modelConnections?.providers.find((provider) =>
        provider.id === providerId && provider.accountId === accountId
      )?.modelCapabilities?.[model]?.contextWindowTokens
      const contextWindow = configuredContextWindow ??
        modelCapabilitiesForProviderModel({ providerId, model }).contextWindowTokens
      const requestLines = contextSnapshot
        ? [
            `Latest request (estimated): ${contextSnapshot.estimatedInputTokens.toLocaleString()} / ${contextSnapshot.contextWindowTokens.toLocaleString()} tokens`,
            `Auto-compact threshold: ${contextSnapshot.softThresholdTokens.toLocaleString()} tokens`,
            `Hard threshold: ${contextSnapshot.hardThresholdTokens.toLocaleString()} tokens`
          ]
        : [
            'Latest request: no request-local context snapshot yet',
            `Context window: ${contextWindow ? `${contextWindow.toLocaleString()} tokens` : 'unknown'}`
          ]
      const usageLines = bucket
        ? [
            'Cumulative usage (not context occupancy):',
            `Input: ${bucket.input_tokens.toLocaleString()} tokens`,
            `Output: ${bucket.output_tokens.toLocaleString()} tokens`,
            `Reasoning: ${bucket.reasoning_tokens.toLocaleString()} tokens`,
            `Cached: ${bucket.cached_tokens.toLocaleString()} tokens`,
            `Total: ${bucket.total_tokens.toLocaleString()} tokens`,
            `Turns: ${bucket.turns}`
          ]
        : ['No cumulative usage has been recorded for this thread.']
      this.inspect('Context', [...requestLines, '', ...usageLines])
    } catch (error) {
      this.fail(error)
    }
  }

  showCapabilities(): void {
    const capabilities = this.runtime.runtimeInfo.capabilities
    const rows: Array<{
      name: string
      state: { enabled: boolean; available: boolean; reason?: string }
      action: string
      details?: string
    }> = [
      {
        name: 'Model chat',
        state: { enabled: true, available: true },
        action: '/connect · /model',
        details: capabilities.model.id
      },
      { name: 'Attachments', state: capabilities.attachments, action: '/attach <path>' },
      { name: 'Memory', state: capabilities.memory, action: '/memory' },
      {
        name: 'Skills',
        state: capabilities.skills,
        action: '/skills',
        details: `${capabilities.skills.discoveredSkills} discovered`
      },
      {
        name: 'MCP tools',
        state: capabilities.mcp,
        action: '/mcp',
        details: `${capabilities.mcp.connectedServers}/${capabilities.mcp.configuredServers} connected · ${capabilities.mcp.toolCount} tools`
      },
      {
        name: 'Subagents',
        state: capabilities.subagents,
        action: '/subagents',
        details: `${capabilities.subagents.maxParallel} parallel`
      },
      { name: 'Web fetch', state: capabilities.web.fetch, action: 'shared runtime config' },
      { name: 'Web search', state: capabilities.web.search, action: 'shared runtime config' },
      { name: 'Image generation', state: capabilities.imageGen, action: '/connect' },
      { name: 'Speech generation', state: capabilities.speechGen, action: '/connect' },
      { name: 'Music generation', state: capabilities.musicGen, action: '/connect' },
      { name: 'Video generation', state: capabilities.videoGen, action: '/connect' }
    ]
    this.inspect('Capabilities', rows.flatMap((row) => [
      `${row.state.available ? '✓' : row.state.enabled ? '!' : '○'} ${row.name} · ${row.state.available ? 'available' : row.state.enabled ? 'unavailable' : 'disabled'}${row.details ? ` · ${row.details}` : ''}`,
      `  ${row.state.available ? row.action : row.state.reason ?? `Enable it through ${row.action}.`}`
    ]))
  }

  async showQueue(action?: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    if (!projection.runningTurnId) {
      this.inspect('Queued guidance', ['No turn is running.'])
      return
    }
    try {
      const current = await this.client.steeringQueue(projection.thread.id, projection.runningTurnId)
      const value = action?.trim() ?? ''
      if (!value || value === 'list') {
        this.inspect('Queued guidance', current.entries.length
          ? current.entries.map((entry, index) => `${index + 1}. ${entry.displayText ?? entry.text}`)
          : ['No queued steer messages.'])
        return
      }
      const [verb = '', target = '', ...rest] = splitWords(value)
      let entries = current.entries.map((entry) => ({ ...entry }))
      if (verb === 'clear') {
        entries = []
      } else if (verb === 'delete') {
        const index = Number(target) - 1
        if (!Number.isSafeInteger(index) || !entries[index]) throw new Error('Usage: /queue delete <number>')
        entries.splice(index, 1)
      } else if (verb === 'edit') {
        const index = Number(target) - 1
        const text = rest.join(' ').trim()
        if (!Number.isSafeInteger(index) || !entries[index] || !text) {
          throw new Error('Usage: /queue edit <number> <text>')
        }
        entries[index] = { text, displayText: text }
      } else if (verb === 'move') {
        const from = Number(target) - 1
        const to = Number(rest[0]) - 1
        if (!Number.isSafeInteger(from) || !Number.isSafeInteger(to) || !entries[from] || to < 0 || to >= entries.length) {
          throw new Error('Usage: /queue move <from-number> <to-number>')
        }
        const [moved] = entries.splice(from, 1)
        entries.splice(to, 0, moved!)
      } else {
        throw new Error('Usage: /queue [list|delete <n>|edit <n> <text>|move <from> <to>|clear]')
      }
      await this.client.replaceSteeringQueue(projection.thread.id, projection.runningTurnId, { entries })
      this.notify('Queued guidance updated.')
    } catch (error) {
      this.fail(error)
    }
  }

  async initializeWorkspace(extra?: string): Promise<void> {
    const suffix = extra?.trim() ? `\nAdditional user guidance: ${extra.trim()}` : ''
    await this.submit(
      'Analyze this repository and create or update the workspace-root AGENTS.md with accurate project structure, development commands, conventions, validation steps, and safety constraints. Preserve useful existing instructions, verify facts from the repository, and keep the file concise and actionable.' + suffix
    )
  }

  async importAgentContext(args?: string): Promise<void> {
    const { tools, unknownTools, scopes, dryRun } = parseImportArgs(args, supportedToolIds())
    if (unknownTools.length > 0) {
      this.notify(`Unknown tool(s): ${unknownTools.join(', ')}. Supported: ${supportedToolIds().join(', ')}.`, 'error')
      return
    }

    const workspace = this.stateValue.projection?.thread.workspace ?? this.options.workspace
    try {
      const plan = await buildImportPlan({
        workspace,
        homeDir: homedir(),
        adapters: IMPORT_ADAPTERS,
        scopes,
        ...(tools.length > 0 ? { tools } : {})
      })
      if (dryRun) {
        this.inspect('Import agent context (dry run)', describeImportPlan(plan))
        return
      }
      const applied = await applyImportPlan(plan, { workspace })
      if (applied.length === 0) {
        this.inspect('Import agent context', ['Nothing to import.', '', ...describeImportPlan(plan)])
        return
      }
      const imported = [...new Set(plan.targets.flatMap((target) => target.tools))]
      this.notify(`Imported ${imported.join(', ')} into ${applied.length} AGENTS.md file(s).`)
      this.inspect('Import complete', describeImportPlan(plan))
    } catch (error) {
      this.fail(error)
    }
  }

  async invokeSkill(name: string, prompt?: string): Promise<void> {
    try {
      const skills = await this.client.skills(this.stateValue.projection?.thread.workspace ?? this.options.workspace)
      const normalized = name.toLowerCase()
      const skill = skills.skills.find((entry) => entry.id.toLowerCase() === normalized || entry.name.toLowerCase() === normalized)
      if (!skill) {
        this.notify(`Unknown skill: ${name}. Run /skills to browse available skills.`, 'error')
        return
      }
      await this.submit(`/skill:${skill.id} ${prompt?.trim() || 'Apply this skill and ask for any task details you still need.'}`)
    } catch (error) {
      this.fail(error)
    }
  }

  async manageSkills(
    action?: string,
    editText?: (initial: string) => Promise<string>
  ): Promise<boolean> {
    const value = action?.trim() ?? ''
    const [verb = '', idOrPath = '', ...rest] = splitWords(value)
    if (!['create', 'import', 'edit', 'enable', 'disable', 'delete'].includes(verb)) return false
    const workspace = this.stateValue.projection?.thread.workspace ?? this.options.workspace
    try {
      const workspaceRoot = await realpath(workspace)
      const managedRoot = join(workspaceRoot, '.kun', 'skills')
      const snapshot = await this.client.skills(workspaceRoot)
      if (!snapshot.enabled && ['create', 'import', 'enable'].includes(verb)) {
        await this.client.setSkillsEnabled(true)
      }
      if (verb === 'create') {
        const id = normalizeSkillId(idOrPath)
        if (!id) throw new Error('Usage: /skills create <id> [description]')
        const destination = join(managedRoot, id)
        await assertPathMissing(destination)
        await mkdir(destination, { recursive: true, mode: 0o700 })
        const description = rest.join(' ').trim() || `Workspace skill ${id}`
        await writeFile(join(destination, 'SKILL.md'), skillTemplate(id, description), {
          encoding: 'utf8',
          mode: 0o600
        })
        await this.client.refreshSkills()
        this.notify(`Created skill ${id}. Use /skills edit ${id} to add instructions.`)
        return true
      }
      if (verb === 'import') {
        if (!idOrPath) throw new Error('Usage: /skills import <directory>')
        const source = await realpath(isAbsolute(idOrPath) ? idOrPath : resolve(workspaceRoot, idOrPath))
        if (!(await stat(source)).isDirectory()) throw new Error('Skill import source must be a directory.')
        await stat(join(source, 'SKILL.md'))
        await validateSkillImportTree(source)
        const id = normalizeSkillId(rest[0] || basename(source))
        if (!id) throw new Error('Skill directory name is not a valid id.')
        const destination = join(managedRoot, id)
        await assertPathMissing(destination)
        await mkdir(managedRoot, { recursive: true, mode: 0o700 })
        try {
          await cp(source, destination, {
            recursive: true,
            errorOnExist: true,
            force: false,
            filter: (sourcePath) => basename(sourcePath) !== '.git'
          })
        } catch (error) {
          await rm(destination, { recursive: true, force: true }).catch(() => undefined)
          throw error
        }
        await this.client.refreshSkills()
        this.notify(`Imported skill ${id}.`)
        return true
      }
      if (verb === 'enable' || verb === 'disable') {
        const id = normalizeSkillId(idOrPath)
        if (!id) throw new Error(`Usage: /skills ${verb} <id>`)
        const loaded = await loadKunProjectConfig(workspaceRoot)
        if (loaded.status === 'invalid') throw new Error(loaded.message)
        const config = loaded.status === 'valid'
          ? loaded.config
          : KunProjectConfigSchema.parse({ version: 1 })
        const disabled = new Set(config.skills.disabledIds.map(normalizeSkillId).filter(Boolean))
        if (verb === 'disable') disabled.add(id)
        else disabled.delete(id)
        const next = {
          ...config,
          skills: { ...config.skills, disabledIds: [...disabled].sort() }
        }
        await writeKunProjectConfig(workspaceRoot, `${JSON.stringify(next, null, 2)}\n`)
        await this.client.refreshSkills()
        this.notify(`Skill ${id} ${verb}d for this workspace.`)
        return true
      }
      const skill = snapshot.skills.find((entry) =>
        entry.id === normalizeSkillId(idOrPath) || entry.name.toLowerCase() === idOrPath.toLowerCase()
      )
      if (!skill) throw new Error(`Unknown visible skill: ${idOrPath}`)
      if (verb === 'edit') {
        if (!editText) throw new Error('External editor integration is unavailable.')
        const path = join(skill.root, 'SKILL.md')
        const original = await readFile(path, 'utf8')
        const edited = await editText(original)
        await writeTextAtomically(path, edited)
        await this.client.refreshSkills()
        this.notify(`Updated skill ${skill.id}.`)
        return true
      }
      if (verb === 'delete') {
        if (rest[0] !== '--yes') {
          throw new Error(`Deleting a skill is permanent. Re-run: /skills delete ${skill.id} --yes`)
        }
        const canonicalManagedRoot = await realpath(managedRoot)
        const canonicalSkillRoot = await realpath(skill.root)
        if (!isPathInside(canonicalManagedRoot, canonicalSkillRoot) || canonicalSkillRoot === canonicalManagedRoot) {
          throw new Error('Only skills managed under <workspace>/.kun/skills can be deleted from TUI.')
        }
        await rm(canonicalSkillRoot, { recursive: true, force: false })
        await this.client.refreshSkills()
        this.notify(`Deleted managed skill ${skill.id}.`)
        return true
      }
      return false
    } catch (error) {
      this.fail(error)
      return true
    }
  }

  async addDirectory(path: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    try {
      const candidate = isAbsolute(path) ? path : resolve(projection.thread.workspace, path)
      const canonical = await realpath(candidate)
      if (!(await stat(canonical)).isDirectory()) throw new Error(`not a directory: ${canonical}`)
      const roots = new Set(await Promise.all(
        [projection.thread.workspace, ...(projection.thread.additionalWorkspaces ?? [])]
          .map((entry) => realpath(entry).catch(() => resolve(entry)))
      ))
      if (roots.has(canonical)) {
        this.notify(`Workspace already available: ${canonical}`)
        return
      }
      const thread = await this.client.updateThread(projection.thread.id, {
        additionalWorkspaces: [...(projection.thread.additionalWorkspaces ?? []), canonical]
      })
      this.patch({
        projection: { ...projection, thread: { ...projection.thread, ...thread } },
        notification: { kind: 'info', message: `Additional workspace added: ${canonical}` }
      })
    } catch (error) {
      this.fail(error)
    }
  }

  async askSideQuestion(question: string): Promise<void> {
    const projection = this.requireProjection()
    if (!projection) return
    const providerId = this.options.providerId ?? projection.thread.providerId
    const accountId = this.options.accountId ?? projection.thread.accountId
    const profile = this.stateValue.modelConnections?.providers.find((candidate) =>
      candidate.id === providerId && (!accountId || candidate.accountId === accountId)
    )
    if (
      this.stateValue.modelConnections &&
      (!profile || !isModelConnectionProfileUsable(profile))
    ) {
      this.notify(modelConnectionUnavailableMessage(profile, providerId), 'error')
      return
    }
    try {
      const side = await this.client.forkThread(projection.thread.id, {
        relation: 'side', title: `${projection.thread.title} · side`
      })
      await this.client.startTurn(side.id, {
        prompt: question,
        clientSurface: 'tui',
        model: side.model,
        mode: side.mode,
        approvalPolicy: side.approvalPolicy,
        sandboxMode: side.sandboxMode
      })
      await this.openThread(side.id)
      this.notify(`Side question started in ${side.id}; the main thread is unchanged.`)
    } catch (error) {
      this.fail(error)
    }
  }

  override inspect(title: string, lines: string[]): void {
    this.patch({ inspection: { title, lines } })
  }

  dismissInspection(): void {
    this.patch({ inspection: undefined })
  }

  async decideApproval(decision: 'allow' | 'deny'): Promise<void> {
    const pending = this.stateValue.projection?.pendingApproval
    if (!pending) return
    this.patch({ busy: true, busyLabel: decision === 'allow' ? 'Approving tool' : 'Denying tool' })
    try {
      await this.client.decideApproval(pending.approvalId, decision)
      this.patch({ busy: false })
    } catch (error) {
      await this.refreshActiveThread(error)
    }
  }

  async resolveUserInput(answers: UserInputAnswer[]): Promise<void> {
    const pending = this.stateValue.projection?.pendingUserInput
    if (!pending) return
    this.patch({ busy: true, busyLabel: 'Sending your answer' })
    try {
      await this.client.resolveUserInput(pending.inputId, answers)
      this.patch({ busy: false })
    } catch (error) {
      await this.refreshActiveThread(error)
    }
  }

  async cancelUserInput(): Promise<void> {
    const pending = this.stateValue.projection?.pendingUserInput
    if (!pending) return
    this.patch({ busy: true, busyLabel: 'Cancelling question' })
    try {
      await this.client.cancelUserInput(pending.inputId)
      this.patch({ busy: false })
    } catch (error) {
      await this.refreshActiveThread(error)
    }
  }
}
