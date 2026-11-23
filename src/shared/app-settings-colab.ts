export type KunColabSettingsV1 = {
  /** Require user approval before the Agent creates, upgrades, or extends a Colab session. */
  requireApprovalForAgent: boolean
  /** Automatically stop idle Colab sessions to prevent runaway CU charges. */
  idleAutoStopEnabled: boolean
  /** Idle minutes before auto-stopping a session without active execution. */
  idleAutoStopMinutes: number
  /** Notify when a connected Colab account drops below `lowBalanceThresholdCu`. */
  lowBalanceReminderEnabled: boolean
  /** Compute-unit threshold for low-balance notifications. */
  lowBalanceThresholdCu: number
  /** Stop all active Colab sessions when quitting Kun. */
  stopSessionsOnQuit: boolean
}

export type KunColabSettingsPatchV1 = Partial<KunColabSettingsV1>

export const DEFAULT_COLAB_IDLE_AUTO_STOP_MINUTES = 10
export const DEFAULT_COLAB_LOW_BALANCE_THRESHOLD_CU = 10

export function defaultKunColabSettings(): KunColabSettingsV1 {
  return {
    requireApprovalForAgent: true,
    idleAutoStopEnabled: true,
    idleAutoStopMinutes: DEFAULT_COLAB_IDLE_AUTO_STOP_MINUTES,
    lowBalanceReminderEnabled: true,
    lowBalanceThresholdCu: DEFAULT_COLAB_LOW_BALANCE_THRESHOLD_CU,
    stopSessionsOnQuit: false
  }
}

function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Math.round(value)))
}

function clampPositiveNumber(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.max(min, Math.min(max, Number(value.toFixed(1))))
}

export function normalizeKunColabSettings(value: unknown): KunColabSettingsV1 {
  const defaults = defaultKunColabSettings()
  if (!value || typeof value !== 'object' || Array.isArray(value)) return defaults
  const raw = value as Record<string, unknown>
  return {
    requireApprovalForAgent:
      typeof raw.requireApprovalForAgent === 'boolean'
        ? raw.requireApprovalForAgent
        : defaults.requireApprovalForAgent,
    idleAutoStopEnabled:
      typeof raw.idleAutoStopEnabled === 'boolean'
        ? raw.idleAutoStopEnabled
        : defaults.idleAutoStopEnabled,
    idleAutoStopMinutes: clampInt(
      raw.idleAutoStopMinutes,
      defaults.idleAutoStopMinutes,
      1,
      240
    ),
    lowBalanceReminderEnabled:
      typeof raw.lowBalanceReminderEnabled === 'boolean'
        ? raw.lowBalanceReminderEnabled
        : defaults.lowBalanceReminderEnabled,
    lowBalanceThresholdCu: clampPositiveNumber(
      raw.lowBalanceThresholdCu,
      defaults.lowBalanceThresholdCu,
      1,
      1000
    ),
    stopSessionsOnQuit:
      typeof raw.stopSessionsOnQuit === 'boolean'
        ? raw.stopSessionsOnQuit
        : defaults.stopSessionsOnQuit
  }
}

export function mergeKunColabSettings(
  current: KunColabSettingsV1 | undefined,
  patch: KunColabSettingsPatchV1 | undefined
): KunColabSettingsV1 {
  const base = normalizeKunColabSettings(current)
  if (!patch) return base
  return normalizeKunColabSettings({
    ...base,
    ...patch
  })
}
