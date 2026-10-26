import { normalizeHarnessPermissionMode } from './harness-permission-mode'
import { BUILTIN_HARNESS_IDS } from '../../kun/src/contracts/builtin-harness-ids.js'
import { HarnessGatewayBindingSchema } from '../../kun/src/contracts/harness-gateway-binding.js'
import { ADE_DISPATCH_PREFERENCE_MAX_CHARS, normalizeDispatchPreferences } from './ade-collaboration-settings'
import {
  GENERIC_ACP_BASE,
  HarnessProviderOverrideSchema,
  TERMINAL_BASE,
  harnessProviderOverrides
} from '../../kun/src/config/kun-config-harness-providers.js'
import type {
  KunAdeSettingsV1,
  KunHarnessCustomEntryV1,
  KunHarnessDefaultsEntryV1,
  KunHarnessProviderOverrideV1,
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
import { normalizeEnabledProfiles } from './harness-enablement'
import { normalizeAdeProjectDefaultsMap } from './ade-project-defaults'

/**
 * Settings normalization for `agents.kun.harnesses` / `agents.kun.ade`.
 * Unknown keys are dropped; numeric fields are
 * clamped to the kun config schema bounds so the generated config stays valid.
 */

/** Builtin harness ids; custom entries colliding with these are dropped. */
export { BUILTIN_HARNESS_IDS } from '../../kun/src/contracts/builtin-harness-ids.js'

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
 * `secretEnv` rows: name must be a valid env var, `secretRef` an
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
    enabledProfiles: [],
    disabledIds: [],
    providers: {},
    defaults: {},
    defaultHarnessId: 'kun',
    agentOrder: []
  }
}

const TERMINAL_AGENT_HOOKS = new Set(['none', 'claude-settings'])

/**
 * `terminalAgents[]` rows: ids must not collide with builtins or
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
 * `defaults[harnessId]` entries: every field optional; unknown
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
    if (rawEntry.gatewayBinding !== undefined && entry.credentialMode === 'kun-gateway') {
      const binding = HarnessGatewayBindingSchema.safeParse(rawEntry.gatewayBinding)
      if (binding.success) { entry.gatewayBinding = binding.data; delete entry.providerId }
    }
    const model = nonEmpty(rawEntry.model, 512)
    if (model) entry.model = model
    const permissionMode = normalizeHarnessPermissionMode(rawEntry.permissionMode)
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
 * Legacy `defaultPermissionMode[harnessId]` folds into
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

/** Legacy `custom[]` rows, sanitized before they fold into `providers`. */
function legacyCustomList(value: unknown, builtinIds: ReadonlySet<string>): KunHarnessCustomEntryV1[] {
  const custom: KunHarnessCustomEntryV1[] = []
  if (Array.isArray(value)) {
    const seen = new Set<string>()
    for (const entry of value) {
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
  return custom
}

/** Drop invalid env rows and clamp the label instead of losing the whole entry. */
function sanitizeProviderOverride(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = { ...raw }
  if (typeof raw.label === 'string') out.label = raw.label.trim().slice(0, 64) || undefined
  if (isRecord(raw.env)) {
    out.env = Object.fromEntries(Object.entries(raw.env).filter(([name, value]) =>
      HARNESS_ENV_NAME.test(name) && typeof value === 'string' && value.length <= 1_024))
  }
  if (raw.secretEnv !== undefined) out.secretEnv = secretEnvList(raw.secretEnv)
  return out
}

/**
 * `providers` with the legacy `binaryPaths`, `custom[]`
 * and `terminalAgents[]` folded in once; saved settings carry only the
 * result. Each entry validates on its own so one bad row never discards a
 * sibling. A builtin id only takes launch patches; any other id must name
 * what it extends, and generic ACP or terminal Agents need a command.
 */
function normalizeHarnessProviders(
  input: Record<string, unknown>,
  builtinIds: ReadonlySet<string>
): Record<string, KunHarnessProviderOverrideV1> {
  const custom = legacyCustomList(input.custom, builtinIds)
  const folded = harnessProviderOverrides({
    providers: isRecord(input.providers) ? input.providers as Record<string, KunHarnessProviderOverrideV1> : {},
    binaryPaths: stringRecord(input.binaryPaths),
    custom,
    terminalAgents: terminalAgentsList(input.terminalAgents, new Set([...builtinIds, ...custom.map((entry) => entry.id)]))
  })
  const out: Record<string, KunHarnessProviderOverrideV1> = {}
  for (const [rawId, raw] of Object.entries(folded)) {
    const id = nonEmpty(rawId, 48)
    if (!id || !/^[a-z][a-z0-9-]{1,47}$/.test(id) || !isRecord(raw)) continue
    const parsed = HarnessProviderOverrideSchema.safeParse(sanitizeProviderOverride(raw))
    if (!parsed.success) continue
    const { extends: base, terminal, ...patch } = parsed.data
    const generic = base === GENERIC_ACP_BASE || base === TERMINAL_BASE
    if (builtinIds.has(id)) {
      if (Object.keys(patch).length) out[id] = patch
    } else if (base && (generic ? patch.command : builtinIds.has(base))) {
      out[id] = { extends: base, ...patch, ...(base === TERMINAL_BASE && terminal ? { terminal } : {}) }
    }
    if (Object.keys(out).length >= 64) break
  }
  return out
}

export function normalizeKunHarnessSettings(value: unknown): KunHarnessSettingsV1 {
  const input = isRecord(value) ? value : {}
  const defaults = defaultKunHarnessSettings()
  const builtinIds = new Set<string>(BUILTIN_HARNESS_IDS)
  const providers = normalizeHarnessProviders(input, builtinIds)
  const defaultHarnessId = nonEmpty(input.defaultHarnessId, 128)
  return {
    enabledProfiles: normalizeEnabledProfiles(input.enabledProfiles),
    // The native Kun loop is the host runtime itself; it cannot be disabled.
    disabledIds: stringList(input.disabledIds).filter(
      (id) => builtinIds.has(id) && id !== 'kun'
    ),
    providers,
    defaults: foldLegacyPermissionModes(
      normalizeHarnessDefaults(input.defaults),
      input.defaultPermissionMode
    ),
    defaultHarnessId: defaultHarnessId ?? defaults.defaultHarnessId,
    agentOrder: agentOrderList(input.agentOrder, builtinIds, providers)
  }
}

/**
 * ADE worker-selection preference: an ordered harness-id list.
 * Unknown/duplicate ids drop; user Agents that can host turns are allowed
 * alongside builtins.
 */
function agentOrderList(
  value: unknown,
  builtinIds: ReadonlySet<string>,
  providers: Readonly<Record<string, KunHarnessProviderOverrideV1>>
): string[] {
  if (!Array.isArray(value)) return []
  const known = new Set<string>([...builtinIds, ...Object.entries(providers)
    .flatMap(([id, entry]) => entry.extends && entry.extends !== TERMINAL_BASE ? [id] : [])])
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
  // A stored legacy settings file arrives here as a patch; its command
  // paths, custom and terminal Agents fold into `providers` once.
  const legacy = patch as Record<string, unknown>
  return normalizeKunHarnessSettings({
    enabledProfiles: patch.enabledProfiles ?? base.enabledProfiles,
    disabledIds: patch.disabledIds ?? base.disabledIds,
    providers: patch.providers ?? base.providers,
    binaryPaths: legacy.binaryPaths,
    custom: legacy.custom,
    terminalAgents: legacy.terminalAgents,
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
    agentOrder: patch.agentOrder ?? base.agentOrder
  })
}

export function defaultKunAdeSettings(): KunAdeSettingsV1 {
  return {
    enabled: false,
    projectDefaults: {},
    harnessRouter: true,
    deterministicHandoff: true,
    managerMayApprove: false,
    allowUnattendedFullAccess: false,
    limits: { softWorkers: 4, hardWorkers: 8 },
    hibernation: { enabled: true, idleMinutes: 30 },
    stall: { structuredMinutes: 10, terminalMinutes: 20 },
    dispatch: { autoStartSeconds: 60, autoStartWhenConfirmationRequired: true, preferencePrompt: '', preferences: [] },
    tasks: { autoStartSeconds: 0, worktree: true, inheritContext: false },
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
  const dispatch = isRecord(input.dispatch) ? input.dispatch : {}
  const tasks = isRecord(input.tasks) ? input.tasks : {}
  const notifications = isRecord(input.notifications) ? input.notifications : {}
  return {
    enabled: bool(input.enabled, defaults.enabled),
    projectDefaults: normalizeAdeProjectDefaultsMap(input.projectDefaults),
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
    dispatch: {
      autoStartSeconds: clampInt(
        dispatch.autoStartSeconds, 0, 3_600, defaults.dispatch.autoStartSeconds
      ),
      autoStartWhenConfirmationRequired: bool(
        dispatch.autoStartWhenConfirmationRequired,
        defaults.dispatch.autoStartWhenConfirmationRequired
      ),
      preferences: normalizeDispatchPreferences(dispatch.preferences),
      preferencePrompt: typeof dispatch.preferencePrompt === 'string'
        ? dispatch.preferencePrompt.slice(0, ADE_DISPATCH_PREFERENCE_MAX_CHARS)
        : defaults.dispatch.preferencePrompt
    },
    tasks: {
      autoStartSeconds: clampInt(tasks.autoStartSeconds, 0, 3_600, defaults.tasks.autoStartSeconds),
      worktree: bool(tasks.worktree, defaults.tasks.worktree),
      inheritContext: bool(tasks.inheritContext, defaults.tasks.inheritContext)
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
    projectDefaults: patch.projectDefaults ?? base.projectDefaults,
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
    dispatch: { ...base.dispatch, ...(patch.dispatch ?? {}) },
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
