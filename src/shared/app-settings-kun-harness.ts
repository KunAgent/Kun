import type {
  KunAdeSettingsV1,
  KunHarnessCustomEntryV1,
  KunHarnessDefaultsEntryV1,
  KunHarnessSettingsV1,
  KunTerminalAgentEntryV1,
  KunWorktreeSettingsV1,
  KunWorktreeSharedPathV1
} from './app-settings-types-kun-runtime'
import type {
  KunAdeSettingsPatchV1,
  KunHarnessSettingsPatchV1,
  KunWorktreeSettingsPatchV1
} from './app-settings-types-kun-services'

/**
 * Settings normalization for `agents.kun.harnesses` / `agents.kun.ade`
 * (plan 01 §7.1, 13 §3.1). Unknown keys are dropped; numeric fields are
 * clamped to the kun config schema bounds so the generated config stays valid.
 */

/** Builtin harness ids; custom entries colliding with these are dropped. */
export const BUILTIN_HARNESS_IDS = [
  'kun',
  'claude-code',
  'cursor',
  'antigravity',
  'gemini-cli',
  'codex',
  'opencode'
] as const

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const nonEmpty = (value: unknown, max = 1_024): string | undefined =>
  typeof value === 'string' && value.trim() && value.length <= max
    ? value.trim()
    : undefined

const clampInt = (value: unknown, min: number, max: number, fallback: number): number => {
  const n = typeof value === 'number' && Number.isFinite(value)
    ? Math.trunc(value)
    : fallback
  return Math.min(max, Math.max(min, n))
}

const bool = (value: unknown, fallback: boolean): boolean =>
  typeof value === 'boolean' ? value : fallback

const stringList = (value: unknown, max = 64): string[] => {
  if (!Array.isArray(value)) return []
  const out: string[] = []
  for (const entry of value) {
    const s = nonEmpty(entry)
    if (s && !out.includes(s)) out.push(s)
    if (out.length >= max) break
  }
  return out
}

const stringRecord = (value: unknown): Record<string, string> => {
  if (!isRecord(value)) return {}
  const out: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    const s = nonEmpty(entry, 4_096)
    if (nonEmpty(key, 128) && s) out[key.trim()] = s
  }
  return out
}

const HARNESS_ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/

/**
 * `secretEnv` rows (p4 §3.7): name must be a valid env var, `secretRef` an
 * opaque credential-store id. Last write wins on duplicate names.
 */
const secretEnvList = (
  value: unknown
): { name: string; secretRef: string }[] => {
  if (!Array.isArray(value)) return []
  const byName = new Map<string, string>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const name = nonEmpty(entry.name, 64)
    const secretRef = nonEmpty(entry.secretRef, 256)
    if (!name || !HARNESS_ENV_NAME.test(name) || !secretRef) continue
    byName.set(name, secretRef)
    if (byName.size >= 32) break
  }
  return [...byName.entries()].map(([name, secretRef]) => ({ name, secretRef }))
}

export function defaultKunHarnessSettings(): KunHarnessSettingsV1 {
  return {
    disabledIds: [],
    binaryPaths: {},
    custom: [],
    defaults: {},
    defaultHarnessId: 'kun',
    agentOrder: [],
    terminalAgents: []
  }
}

const TERMINAL_AGENT_HOOKS = new Set(['none', 'claude-settings'])

/**
 * `terminalAgents[]` rows (p4 §3.8): ids must not collide with builtins or
 * `custom[]` (both win — terminal entries are turn-inert by design).
 * Unknown `hooks` values drop; everything else is string-list hygiene.
 */
function terminalAgentsList(
  value: unknown,
  reservedIds: ReadonlySet<string>
): KunTerminalAgentEntryV1[] {
  if (!Array.isArray(value)) return []
  const out: KunTerminalAgentEntryV1[] = []
  const seen = new Set<string>()
  for (const entry of value) {
    if (!isRecord(entry)) continue
    const id = nonEmpty(entry.id, 128)
    const command = nonEmpty(entry.command, 4_096)
    if (!id || !command || reservedIds.has(id) || seen.has(id)) continue
    seen.add(id)
    const taskFlag = nonEmpty(entry.taskFlag, 64)
    const resumeArgs = stringList(entry.resumeArgs, 32)
    const hooks =
      typeof entry.hooks === 'string' && TERMINAL_AGENT_HOOKS.has(entry.hooks)
        ? (entry.hooks as KunTerminalAgentEntryV1['hooks'])
        : undefined
    out.push({
      id,
      displayName: nonEmpty(entry.displayName, 128) ?? id,
      command,
      args: stringList(entry.args, 32),
      ...(taskFlag ? { taskFlag } : {}),
      ...(resumeArgs.length > 0 ? { resumeArgs } : {}),
      ...(hooks ? { hooks } : {})
    })
    if (out.length >= 32) break
  }
  return out
}

const HARNESS_CREDENTIAL_MODES = new Set(['native-login', 'provider', 'kun-gateway'])
const HARNESS_ISOLATION_MODES = new Set(['local', 'worktree'])

/**
 * `defaults[harnessId]` entries (p4 §3.6): every field optional; unknown
 * enum values and empty strings drop individually so one bad field never
 * discards a usable sibling. Entries left with no fields drop entirely.
 */
function normalizeHarnessDefaults(
  value: unknown
): Record<string, KunHarnessDefaultsEntryV1> {
  if (!isRecord(value)) return {}
  const out: Record<string, KunHarnessDefaultsEntryV1> = {}
  for (const [rawId, rawEntry] of Object.entries(value)) {
    const id = nonEmpty(rawId, 128)
    if (!id || !isRecord(rawEntry)) continue
    const entry: KunHarnessDefaultsEntryV1 = {}
    if (
      typeof rawEntry.credentialMode === 'string' &&
      HARNESS_CREDENTIAL_MODES.has(rawEntry.credentialMode)
    ) {
      entry.credentialMode =
        rawEntry.credentialMode as KunHarnessDefaultsEntryV1['credentialMode']
    }
    const providerId = nonEmpty(rawEntry.providerId, 128)
    if (providerId) entry.providerId = providerId
    const model = nonEmpty(rawEntry.model, 512)
    if (model) entry.model = model
    const permissionMode = nonEmpty(rawEntry.permissionMode, 64)
    if (permissionMode) entry.permissionMode = permissionMode
    if (
      typeof rawEntry.isolation === 'string' &&
      HARNESS_ISOLATION_MODES.has(rawEntry.isolation)
    ) {
      entry.isolation = rawEntry.isolation as KunHarnessDefaultsEntryV1['isolation']
    }
    if (Object.keys(entry).length > 0) out[id] = entry
    if (Object.keys(out).length >= 64) break
  }
  return out
}

/**
 * Pre-P4-11 `defaultPermissionMode[harnessId]` folds into
 * `defaults[harnessId].permissionMode`; an explicit `defaults` entry wins.
 */
function foldLegacyPermissionModes(
  defaults: Record<string, KunHarnessDefaultsEntryV1>,
  legacy: unknown
): Record<string, KunHarnessDefaultsEntryV1> {
  const out = { ...defaults }
  for (const [rawId, rawMode] of Object.entries(stringRecord(legacy))) {
    const id = rawId.trim()
    if (!out[id]?.permissionMode) out[id] = { ...out[id], permissionMode: rawMode }
  }
  return out
}

export function normalizeKunHarnessSettings(value: unknown): KunHarnessSettingsV1 {
  const input = isRecord(value) ? value : {}
  const defaults = defaultKunHarnessSettings()
  const builtinIds = new Set<string>(BUILTIN_HARNESS_IDS)
  const custom: KunHarnessCustomEntryV1[] = []
  if (Array.isArray(input.custom)) {
    const seen = new Set<string>()
    for (const entry of input.custom) {
      if (!isRecord(entry)) continue
      const id = nonEmpty(entry.id, 128)
      const command = nonEmpty(entry.command, 4_096)
      if (!id || !command || builtinIds.has(id) || seen.has(id)) continue
      seen.add(id)
      const secretEnv = secretEnvList(entry.secretEnv)
      custom.push({
        id,
        displayName: nonEmpty(entry.displayName, 128) ?? id,
        command,
        args: stringList(entry.args, 32),
        env: stringRecord(entry.env),
        ...(secretEnv.length > 0 ? { secretEnv } : {})
      })
      if (custom.length >= 32) break
    }
  }
  const defaultHarnessId = nonEmpty(input.defaultHarnessId, 128)
  return {
    // The native Kun loop is the host runtime itself; it cannot be disabled.
    disabledIds: stringList(input.disabledIds).filter(
      (id) => builtinIds.has(id) && id !== 'kun'
    ),
    binaryPaths: stringRecord(input.binaryPaths),
    custom,
    defaults: foldLegacyPermissionModes(
      normalizeHarnessDefaults(input.defaults),
      input.defaultPermissionMode
    ),
    defaultHarnessId: defaultHarnessId ?? defaults.defaultHarnessId,
    agentOrder: agentOrderList(input.agentOrder, builtinIds, custom),
    terminalAgents: terminalAgentsList(
      input.terminalAgents,
      new Set([...builtinIds, ...custom.map((entry) => entry.id)])
    )
  }
}

/**
 * ADE worker-selection preference (10 §3.2): an ordered harness-id list.
 * Unknown/duplicate ids drop; custom ACP ids are allowed alongside builtins.
 */
function agentOrderList(
  value: unknown,
  builtinIds: ReadonlySet<string>,
  custom: readonly KunHarnessCustomEntryV1[]
): string[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>([...builtinIds, ...custom.map((entry) => entry.id)])
  const out: string[] = []
  for (const entry of value) {
    const id = nonEmpty(entry, 128)
    if (!id || !known.has(id) || out.includes(id)) continue
    out.push(id)
    if (out.length >= 16) break
  }
  return out
}

export function mergeKunHarnessSettings(
  current: KunHarnessSettingsV1 | undefined,
  patch: KunHarnessSettingsPatchV1 | undefined
): KunHarnessSettingsV1 {
  const base = normalizeKunHarnessSettings(current)
  if (!patch) return base
  return normalizeKunHarnessSettings({
    disabledIds: patch.disabledIds ?? base.disabledIds,
    binaryPaths: patch.binaryPaths ?? base.binaryPaths,
    custom: patch.custom ?? base.custom,
    // `defaults` replaces whole like the other records. A legacy
    // `defaultPermissionMode` patch is a deliberate write, not a migration
    // fold — it overrides permissionMode on matching entries.
    defaults:
      patch.defaults ??
      (() => {
        const out = { ...base.defaults }
        for (const [id, mode] of Object.entries(
          stringRecord(patch.defaultPermissionMode)
        )) {
          out[id] = { ...out[id], permissionMode: mode }
        }
        return out
      })(),
    // When `defaults` came from the patch (e.g. the raw settings file), a
    // legacy map alongside it still folds into entries that lack
    // permissionMode — normalize's fold is fill-only, explicit wins.
    // With no `defaults` patch the legacy write already applied above.
    defaultPermissionMode:
      patch.defaults !== undefined ? patch.defaultPermissionMode : undefined,
    defaultHarnessId: patch.defaultHarnessId ?? base.defaultHarnessId,
    agentOrder: patch.agentOrder ?? base.agentOrder,
    terminalAgents: patch.terminalAgents ?? base.terminalAgents
  })
}

export function defaultKunAdeSettings(): KunAdeSettingsV1 {
  return {
    enabled: false,
    harnessRouter: true,
    deterministicHandoff: true,
    managerMayApprove: false,
    allowUnattendedFullAccess: false,
    limits: { softWorkers: 4, hardWorkers: 8 },
    hibernation: { enabled: true, idleMinutes: 30 },
    stall: { structuredMinutes: 10, terminalMinutes: 20 },
    notifications: {
      waiting: true,
      failed: true,
      done: true,
      stalled: true,
      sound: true,
      keepAwake: false
    }
  }
}

export function normalizeKunAdeSettings(value: unknown): KunAdeSettingsV1 {
  const input = isRecord(value) ? value : {}
  const defaults = defaultKunAdeSettings()
  const managerModel = isRecord(input.managerModel)
    ? {
        providerId: nonEmpty(input.managerModel.providerId, 128),
        model: nonEmpty(input.managerModel.model, 512)
      }
    : undefined
  const softWorkers = clampInt(
    isRecord(input.limits) ? input.limits.softWorkers : undefined,
    1, 16, defaults.limits.softWorkers
  )
  const hardWorkers = clampInt(
    isRecord(input.limits) ? input.limits.hardWorkers : undefined,
    softWorkers, 32, Math.max(softWorkers, defaults.limits.hardWorkers)
  )
  const budgetInput = isRecord(input.budget) ? input.budget : undefined
  const budget = budgetInput
    ? {
        ...(typeof budgetInput.softTokens === 'number' &&
          Number.isInteger(budgetInput.softTokens) && budgetInput.softTokens > 0
          ? { softTokens: budgetInput.softTokens }
          : {}),
        ...(typeof budgetInput.hardTokens === 'number' &&
          Number.isInteger(budgetInput.hardTokens) && budgetInput.hardTokens > 0
          ? { hardTokens: budgetInput.hardTokens }
          : {})
      }
    : undefined
  const hibernation = isRecord(input.hibernation) ? input.hibernation : {}
  const stall = isRecord(input.stall) ? input.stall : {}
  const notifications = isRecord(input.notifications) ? input.notifications : {}
  return {
    enabled: bool(input.enabled, defaults.enabled),
    harnessRouter: bool(input.harnessRouter, defaults.harnessRouter),
    deterministicHandoff: bool(input.deterministicHandoff, defaults.deterministicHandoff),
    ...(managerModel?.providerId && managerModel.model
      ? { managerModel: { providerId: managerModel.providerId, model: managerModel.model } }
      : {}),
    managerMayApprove: bool(input.managerMayApprove, defaults.managerMayApprove),
    allowUnattendedFullAccess: bool(
      input.allowUnattendedFullAccess,
      defaults.allowUnattendedFullAccess
    ),
    limits: { softWorkers, hardWorkers },
    ...(budget && (budget.softTokens !== undefined || budget.hardTokens !== undefined)
      ? { budget }
      : {}),
    hibernation: {
      enabled: bool(hibernation.enabled, defaults.hibernation.enabled),
      idleMinutes: clampInt(
        hibernation.idleMinutes, 1, 1_440, defaults.hibernation.idleMinutes
      )
    },
    stall: {
      structuredMinutes: clampInt(
        stall.structuredMinutes, 1, 240, defaults.stall.structuredMinutes
      ),
      terminalMinutes: clampInt(
        stall.terminalMinutes, 1, 480, defaults.stall.terminalMinutes
      )
    },
    notifications: {
      waiting: bool(notifications.waiting, defaults.notifications.waiting),
      failed: bool(notifications.failed, defaults.notifications.failed),
      done: bool(notifications.done, defaults.notifications.done),
      stalled: bool(notifications.stalled, defaults.notifications.stalled),
      sound: bool(notifications.sound, defaults.notifications.sound),
      keepAwake: bool(notifications.keepAwake, defaults.notifications.keepAwake)
    }
  }
}

export function mergeKunAdeSettings(
  current: KunAdeSettingsV1 | undefined,
  patch: KunAdeSettingsPatchV1 | undefined
): KunAdeSettingsV1 {
  const base = normalizeKunAdeSettings(current)
  if (!patch) return base
  const managerModelPatch = patch.managerModel
    ? {
        providerId: patch.managerModel.providerId ?? base.managerModel?.providerId,
        model: patch.managerModel.model ?? base.managerModel?.model
      }
    : base.managerModel
  return normalizeKunAdeSettings({
    enabled: patch.enabled ?? base.enabled,
    harnessRouter: patch.harnessRouter ?? base.harnessRouter,
    deterministicHandoff: patch.deterministicHandoff ?? base.deterministicHandoff,
    ...(managerModelPatch ? { managerModel: managerModelPatch } : {}),
    managerMayApprove: patch.managerMayApprove ?? base.managerMayApprove,
    allowUnattendedFullAccess:
      patch.allowUnattendedFullAccess ?? base.allowUnattendedFullAccess,
    limits: { ...base.limits, ...(patch.limits ?? {}) },
    budget: patch.budget === null ? undefined : { ...base.budget, ...(patch.budget ?? {}) },
    hibernation: { ...base.hibernation, ...(patch.hibernation ?? {}) },
    stall: { ...base.stall, ...(patch.stall ?? {}) },
    notifications: { ...base.notifications, ...(patch.notifications ?? {}) }
  })
}

export function defaultKunWorktreeSettings(): KunWorktreeSettingsV1 {
  return { sharedPaths: {} }
}

const WORKTREE_SHARED_MODES = new Set(['symlink', 'clone', 'copy'])

export function normalizeKunWorktreeSettings(value: unknown): KunWorktreeSettingsV1 {
  const input = isRecord(value) ? value : {}
  const sharedPaths: KunWorktreeSettingsV1['sharedPaths'] = {}
  if (isRecord(input.sharedPaths)) {
    for (const [root, list] of Object.entries(input.sharedPaths)) {
      const repoRoot = nonEmpty(root, 4_096)
      if (!repoRoot || !Array.isArray(list)) continue
      const entries: KunWorktreeSharedPathV1[] = []
      for (const entry of list) {
        if (!isRecord(entry)) continue
        const path = nonEmpty(entry.path, 1_024)
        const mode = nonEmpty(entry.mode, 16) ?? 'symlink'
        if (!path || !WORKTREE_SHARED_MODES.has(mode) || entries.length >= 64) continue
        entries.push({ path, mode: mode as KunWorktreeSharedPathV1['mode'] })
      }
      if (entries.length) sharedPaths[repoRoot] = entries
      if (Object.keys(sharedPaths).length >= 64) break
    }
  }
  return { sharedPaths }
}

export function mergeKunWorktreeSettings(
  current: KunWorktreeSettingsV1 | undefined,
  patch: KunWorktreeSettingsPatchV1 | undefined
): KunWorktreeSettingsV1 {
  const base = normalizeKunWorktreeSettings(current)
  if (!patch) return base
  return normalizeKunWorktreeSettings({
    sharedPaths: patch.sharedPaths ?? base.sharedPaths
  })
}
