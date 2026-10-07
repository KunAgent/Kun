import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import {
  harnessProfileEnabled,
  harnessProfileReady,
  selectedHarnessProfile
} from '@shared/harness-enablement'

/** Agents most people already have installed, in the order the guide lists them. */
export const ONBOARDING_FEATURED_AGENT_IDS = [
  'claude-code',
  'codex',
  'gemini-cli',
  'opencode',
  'cursor-cli',
  'devin',
  'kimi',
  'qoder',
  'copilot',
  'droid',
  'pi',
  'goose',
  'antigravity'
] as const

export type OnboardingAgentStatus =
  | 'detecting'
  | 'connected'
  | 'ready'
  | 'login'
  | 'outdated'
  | 'unavailable'
  | 'missing'

const STATUS_RANK: Readonly<Record<OnboardingAgentStatus, number>> = {
  connected: 0,
  ready: 1,
  login: 2,
  outdated: 3,
  unavailable: 4,
  detecting: 5,
  missing: 6
}

/**
 * The guide only offers Agents that can join a conversation with their own
 * sign-in: chat transports (ACP, SDK, app-server, RPC) whose selected profile
 * is native login. Terminal and desktop-application integrations stay in the
 * Agent Center, as do provider-routed profiles that need a Kun model first.
 */
export function onboardingAgentEligible(row: AdeHarnessRow, settings: KunHarnessSettingsV1): boolean {
  const definition = row.definition
  if (definition.id === 'kun' || definition.availability === 'retired') return false
  if (definition.transport === 'native-loop' || definition.transport === 'terminal' ||
    definition.transport === 'application') return false
  if (!definition.credentialModes.includes('native-login')) return false
  return selectedHarnessProfile(row, settings).credentialMode === 'native-login'
}

export function onboardingAgentStatus(row: AdeHarnessRow, settings: KunHarnessSettingsV1): OnboardingAgentStatus {
  const status = row.status
  if (status.detecting || status.installed === 'unknown') return 'detecting'
  if (status.installed === 'no') return 'missing'
  if (status.versionSupported === false || status.reasonCode === 'version_too_low') return 'outdated'
  const profile = selectedHarnessProfile(row, settings)
  if (harnessProfileEnabled(settings, profile) && harnessProfileReady(row, profile)) return 'connected'
  if (status.login === 'signed-out' || status.reasonCode === 'signed_out') return 'login'
  if (status.reasonCode === 'adapter_missing') return 'unavailable'
  return 'ready'
}

function featuredIndex(id: string): number {
  const index = (ONBOARDING_FEATURED_AGENT_IDS as readonly string[]).indexOf(id)
  return index === -1 ? ONBOARDING_FEATURED_AGENT_IDS.length : index
}

export type OnboardingAgentLists = {
  /** Installed (or still detecting) Agents, best first. */
  installed: AdeHarnessRow[]
  /** Popular Agents that are not installed, suggested for later. */
  suggestions: AdeHarnessRow[]
  detecting: boolean
}

/** `0.162.0-alpha.3 (build 41)` -> `0.162.0`; the card has room for the release number only. */
export function shortAgentVersion(version: string): string {
  const match = /\d+(?:\.\d+)+/.exec(version)
  return match ? match[0] : version.trim().split(/\s+/)[0] ?? ''
}

export function onboardingAgentLists(
  rows: readonly AdeHarnessRow[],
  settings: KunHarnessSettingsV1,
  suggestionLimit = 6
): OnboardingAgentLists {
  const eligible = rows.filter((row) => onboardingAgentEligible(row, settings))
  const statusOf = new Map(eligible.map((row) => [row.definition.id, onboardingAgentStatus(row, settings)]))
  const compare = (a: AdeHarnessRow, b: AdeHarnessRow): number =>
    (STATUS_RANK[statusOf.get(a.definition.id)!] - STATUS_RANK[statusOf.get(b.definition.id)!]) ||
    (featuredIndex(a.definition.id) - featuredIndex(b.definition.id)) ||
    a.definition.displayName.localeCompare(b.definition.displayName)
  const installed = eligible.filter((row) => statusOf.get(row.definition.id) !== 'missing').sort(compare)
  const suggestions = eligible
    .filter((row) => statusOf.get(row.definition.id) === 'missing' &&
      featuredIndex(row.definition.id) < ONBOARDING_FEATURED_AGENT_IDS.length)
    .sort(compare)
    .slice(0, suggestionLimit)
  return {
    installed,
    suggestions,
    detecting: eligible.some((row) => statusOf.get(row.definition.id) === 'detecting')
  }
}

/** Display names of the connected Agents, for the summary page. */
export function onboardingConnectedAgentNames(
  rows: readonly AdeHarnessRow[],
  settings: KunHarnessSettingsV1
): string[] {
  return onboardingAgentLists(rows, settings).installed
    .filter((row) => onboardingAgentStatus(row, settings) === 'connected')
    .map((row) => row.definition.displayName)
}

/** Connect requests run one at a time; later requests wait in arrival order. */
export function enqueueOnboardingAgent(queue: readonly string[], active: string | null, id: string): {
  queue: string[]
  active: string | null
} {
  if (active === id || queue.includes(id)) return { queue: [...queue], active }
  if (!active) return { queue: [...queue], active: id }
  return { queue: [...queue, id], active }
}

export function settleOnboardingAgent(queue: readonly string[], active: string | null, id: string): {
  queue: string[]
  active: string | null
} {
  if (active !== id) return { queue: queue.filter((entry) => entry !== id), active }
  const [next = null, ...rest] = queue
  return { queue: rest, active: next }
}
