import type { DesktopStartupPhase } from '@shared/desktop-startup-state'

const STARTUP_PHASE_RANK: Record<DesktopStartupPhase, number> = {
  bootstrapping: 0,
  shell_ready: 1,
  services_starting: 2,
  data_migrating: 3,
  manager_starting: 4,
  runtime_handoff: 5,
  runtime_starting: 6,
  ready: 7,
  recovery_required: 7
}

export function mergeStartupPhase(
  current: DesktopStartupPhase,
  next: DesktopStartupPhase
): DesktopStartupPhase {
  if (current === 'ready' || current === 'recovery_required') return current
  return STARTUP_PHASE_RANK[next] >= STARTUP_PHASE_RANK[current] ? next : current
}

export function startupPhaseLabel(phase: DesktopStartupPhase): string {
  switch (phase) {
    case 'bootstrapping':
      return 'Preparing Kun desktop...'
    case 'shell_ready':
      return 'Kun window is ready. Starting background services...'
    case 'services_starting':
      return 'Starting background services...'
    case 'data_migrating':
      return 'Migrating Kun data...'
    case 'manager_starting':
      return 'Connecting to the Kun service manager...'
    case 'runtime_handoff':
      return 'Updating the bundled Kun runtime...'
    case 'runtime_starting':
      return 'Starting Kun runtime...'
    case 'recovery_required':
      return 'Kun startup requires recovery.'
    case 'ready':
      return 'Kun is ready.'
  }
}

/**
 * The workbench shell (window chrome, non-runtime views) may mount as soon as
 * the desktop shell exists; runtime-dependent features stay gated by the
 * startup state asserts in the IPC layer until `ready`.
 */
export function startupShellAllowsWorkbench(phase: DesktopStartupPhase): boolean {
  return phase === 'ready'
}
