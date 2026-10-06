import { accessSync, constants, existsSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, join } from 'node:path'
import { AGENT_ADAPTERS, agentAdapter } from './adapters.js'
import { createTwoFilesPatch } from 'diff'
import { applyWiringEdits, planWiringEdits, readFileText, restoreWiring, writeFileAtomic } from './engine.js'
import type { AgentWiringFilePreview } from './protocol.js'
import type { AgentAdapter, AgentWiringRecord, AgentWiringStatus, WiringContext, WiringProfile, WiringState, WiringTarget } from './types.js'

const PROFILE_NAME = /^[\p{L}\p{N}][\p{L}\p{N} ._-]{0,47}$/u

/** Folders agents are commonly installed into, beyond a GUI process's minimal PATH. */
function commonBinDirs(home: string, platform: NodeJS.Platform): string[] {
  if (platform === 'win32') return [join(home, 'AppData', 'Roaming', 'npm'), join(home, '.bun', 'bin'), join(home, '.local', 'bin')]
  return [join(home, '.local', 'bin'), join(home, '.bun', 'bin'), join(home, '.npm-global', 'bin'), join(home, '.opencode', 'bin'),
    join(home, '.claude', 'local'), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin']
}

export function createWiringContext(overrides: Partial<WiringContext> = {}): WiringContext {
  const env = overrides.env ?? process.env
  const home = overrides.home ?? homedir()
  const platform = overrides.platform ?? process.platform
  const stateFile = overrides.stateFile ?? env.KUN_AGENT_WIRING_STATE?.trim() ?? join(home, '.kun', 'agent-wiring.json')
  const dirs = [...(env.PATH ?? '').split(delimiter).filter(Boolean), ...commonBinDirs(home, platform)]
  const extensions = platform === 'win32' ? (env.PATHEXT ?? '.EXE;.CMD;.BAT').split(';').map((value) => value.toLowerCase()) : ['']
  const which = overrides.which ?? ((bin: string) => {
    for (const dir of dirs) {
      for (const extension of extensions) {
        const candidate = join(dir, bin + extension)
        try { accessSync(candidate, constants.X_OK); return candidate } catch { /* keep looking */ }
      }
    }
    return undefined
  })
  return { env, home, platform, stateFile, which }
}

function emptyState(): WiringState {
  return { version: 1, agents: {}, profiles: {} }
}

function emptyRecord(): AgentWiringRecord {
  return { connected: false, originals: {}, createdFiles: [], ownedArrays: [] }
}

export class AgentWiringError extends Error {
  constructor(message: string, readonly code: 'unknown_agent' | 'not_connected' | 'invalid_profile' | 'invalid_target' | 'config_unreadable') {
    super(message)
    this.name = 'AgentWiringError'
  }
}

export class AgentWiringService {
  constructor(private readonly ctx: WiringContext = createWiringContext()) {}

  adapters(): readonly AgentAdapter[] { return AGENT_ADAPTERS }

  private load(): WiringState {
    try {
      const parsed = JSON.parse(readFileSync(this.ctx.stateFile, 'utf8')) as Partial<WiringState>
      if (parsed.version !== 1 || typeof parsed.agents !== 'object') return emptyState()
      return { version: 1, agents: parsed.agents ?? {}, profiles: parsed.profiles ?? {} }
    } catch { return emptyState() }
  }

  private save(state: WiringState): void {
    writeFileAtomic(this.ctx.stateFile, JSON.stringify(state, null, 2) + '\n')
  }

  private adapter(id: string): AgentAdapter {
    const adapter = agentAdapter(id)
    if (!adapter) throw new AgentWiringError(`Unknown agent '${id}'`, 'unknown_agent')
    return adapter
  }

  status(id: string, origin: string): AgentWiringStatus {
    return this.describe(this.adapter(id), this.load().agents[id], origin)
  }

  list(origin: string): AgentWiringStatus[] {
    const state = this.load()
    return AGENT_ADAPTERS.map((adapter) => this.describe(adapter, state.agents[adapter.id], origin))
  }

  private describe(adapter: AgentAdapter, record: AgentWiringRecord | undefined, origin: string): AgentWiringStatus {
    const binary = adapter.bins.map((bin) => this.ctx.which(bin)).find(Boolean)
    const files = Object.values(adapter.files(this.ctx))
    const installed = Boolean(binary) || adapter.configDirs(this.ctx).some((dir) => existsSync(dir))
    let inspected: ReturnType<AgentAdapter['inspect']> = { pointsAtGateway: false }
    let error: string | undefined
    try { inspected = adapter.inspect(this.ctx, readFileText, record?.origin ?? origin) } catch (cause) {
      error = cause instanceof Error ? cause.message : String(cause)
    }
    const connected = record?.connected === true
    return {
      id: adapter.id, name: adapter.name, protocol: adapter.protocol, homepage: adapter.homepage,
      installed, ...(binary ? { binary } : {}), configFiles: files,
      connected, drifted: connected && !inspected.pointsAtGateway,
      ...(connected ? { model: inspected.model ?? record?.model } : inspected.model ? { model: inspected.model } : {}),
      ...(record?.smallModel && connected ? { smallModel: record.smallModel } : {}),
      ...(record?.effort && connected ? { effort: record.effort } : {}),
      efforts: adapter.efforts,
      ...(record?.clientId ? { clientId: record.clientId } : {}),
      restartRequired: adapter.restartRequired, keepsModelList: adapter.keepsModelList,
      pickInAgent: adapter.pickInAgent === true,
      ...(error ? { error } : {})
    }
  }

  private validTarget(adapter: AgentAdapter, target: WiringTarget): void {
    if (!target.model.trim() || !target.key || !/^https?:\/\//.test(target.origin)) {
      throw new AgentWiringError('Choose a model and make sure the gateway is running', 'invalid_target')
    }
    if (target.effort && adapter.efforts.length && !adapter.efforts.includes(target.effort) && target.effort !== 'auto') {
      throw new AgentWiringError(`${adapter.name} cannot be set to reasoning '${target.effort}'`, 'invalid_target')
    }
  }

  /**
   * What `connect` would write, as unified diffs, without touching disk.
   * `mask` replaces the key wherever it appears so previews can be shown.
   */
  preview(id: string, target: WiringTarget, mask: string): AgentWiringFilePreview[] {
    const adapter = this.adapter(id)
    this.validTarget(adapter, target)
    const current = this.load().agents[id]
    const record = current?.connected ? structuredClone(current) : emptyRecord()
    let writes
    try { writes = planWiringEdits(adapter.edits(this.ctx, target), record) } catch (cause) {
      throw new AgentWiringError(`Could not read ${adapter.name}'s config: ${cause instanceof Error ? cause.message : String(cause)}`, 'config_unreadable')
    }
    const hide = (text: string): string => text.split(target.key).join(mask)
    return writes.map((write) => ({ file: write.file, created: !write.before && !existsSync(write.file),
      diff: createTwoFilesPatch(write.file, write.file, hide(write.before), hide(write.after), '', '', { context: 2 })
        .split('\n').slice(2).join('\n') }))
  }

  /** Connects or switches an agent. The first connection stashes the user's original values. */
  connect(id: string, target: WiringTarget, clientId?: string): AgentWiringStatus {
    const adapter = this.adapter(id)
    this.validTarget(adapter, target)
    const state = this.load()
    const record = state.agents[id] ?? emptyRecord()
    if (!record.connected) Object.assign(record, emptyRecord())
    try {
      applyWiringEdits(adapter.edits(this.ctx, target), record)
    } catch (cause) {
      throw new AgentWiringError(`Could not update ${adapter.name}'s config: ${cause instanceof Error ? cause.message : String(cause)}`, 'config_unreadable')
    }
    const now = new Date().toISOString()
    state.agents[id] = { ...record, connected: true, model: target.model, origin: target.origin,
      ...(target.smallModel ? { smallModel: target.smallModel } : { smallModel: undefined }),
      ...(target.effort ? { effort: target.effort } : {}),
      ...(clientId ? { clientId } : {}), connectedAt: record.connectedAt ?? now, updatedAt: now }
    this.save(state)
    return this.describe(adapter, state.agents[id], target.origin)
  }

  /** Restores every value Kun changed. Returns the gateway client to revoke, if any. */
  disconnect(id: string, origin: string): { status: AgentWiringStatus; clientId?: string } {
    const adapter = this.adapter(id)
    const state = this.load()
    const record = state.agents[id]
    if (!record?.connected) throw new AgentWiringError(`${adapter.name} is not connected to Kun`, 'not_connected')
    try {
      restoreWiring(record, (_file, _path, item) => adapter.ownsArrayItem?.(item) === true)
    } catch (cause) {
      throw new AgentWiringError(`Could not restore ${adapter.name}'s config: ${cause instanceof Error ? cause.message : String(cause)}`, 'config_unreadable')
    }
    const clientId = record.clientId
    delete state.agents[id]
    this.save(state)
    return { status: this.describe(adapter, undefined, origin), ...(clientId ? { clientId } : {}) }
  }

  /** The gateway key currently written into a connected agent's config. */
  currentKey(id: string, origin: string): string | undefined {
    const record = this.load().agents[id]
    if (!record?.connected) return undefined
    try { return this.adapter(id).inspect(this.ctx, readFileText, record.origin ?? origin).key } catch { return undefined }
  }

  connectedRecord(id: string): AgentWiringRecord | undefined {
    const record = this.load().agents[id]
    return record?.connected ? record : undefined
  }

  /** Rewrites model lists for connected agents that keep their own copy. Returns the agents updated. */
  syncCatalog(models: WiringTarget['models'], origin: string): string[] {
    const synced: string[] = []
    const state = this.load()
    for (const [id, record] of Object.entries(state.agents)) {
      const adapter = agentAdapter(id)
      if (!adapter?.keepsModelList || !record.connected || !record.model) continue
      const key = this.currentKey(id, origin)
      if (!key) continue
      applyWiringEdits(adapter.edits(this.ctx, { origin: record.origin ?? origin, key, model: record.model,
        ...(record.smallModel ? { smallModel: record.smallModel } : {}), ...(record.effort ? { effort: record.effort } : {}), models }), record)
      record.updatedAt = new Date().toISOString()
      synced.push(id)
    }
    if (synced.length) this.save(state)
    return synced
  }

  listProfiles(): Record<string, WiringProfile> {
    return this.load().profiles
  }

  saveProfile(name: string): WiringProfile {
    if (!PROFILE_NAME.test(name)) throw new AgentWiringError('Profile names are 1-48 letters, digits, spaces, dots, dashes or underscores', 'invalid_profile')
    const state = this.load()
    const profile: WiringProfile = {}
    for (const [id, record] of Object.entries(state.agents)) {
      if (record.connected && record.model) {
        profile[id] = { model: record.model, ...(record.smallModel ? { smallModel: record.smallModel } : {}),
          ...(record.effort ? { effort: record.effort } : {}) }
      }
    }
    if (!Object.keys(profile).length) throw new AgentWiringError('Connect at least one agent before saving a profile', 'invalid_profile')
    state.profiles[name] = profile
    this.save(state)
    return profile
  }

  deleteProfile(name: string): void {
    const state = this.load()
    if (!state.profiles[name]) throw new AgentWiringError(`No profile named '${name}'`, 'invalid_profile')
    delete state.profiles[name]
    this.save(state)
  }

  profile(name: string): WiringProfile {
    const profile = this.load().profiles[name]
    if (!profile) throw new AgentWiringError(`No profile named '${name}'`, 'invalid_profile')
    return profile
  }
}
