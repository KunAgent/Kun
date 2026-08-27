export type DesktopStartupPhase =
  | 'bootstrapping'
  | 'shell_ready'
  | 'services_starting'
  | 'data_migrating'
  | 'manager_starting'
  | 'runtime_handoff'
  | 'runtime_starting'
  | 'ready'
  | 'recovery_required'

export type DesktopStartupStatePayload = {
  phase: DesktopStartupPhase
  /** Optional user-facing progress detail, e.g. the active background step. */
  detail?: string
}
