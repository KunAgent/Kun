import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
import { setupInstallCommand } from './agent-center-actions'
import type { AgentUpdateRequest } from './agent-setup-help'

/**
 * What the Version tab hands to 小 Kun when the user asks for help updating,
 * or null when there is nothing to update: the Agent is current, or it is not
 * installed at all (that path belongs to the install flow).
 */
export function agentUpdateHelpRequest(row: AdeHarnessRow, state: HarnessUpdateState | undefined, platform: string): AgentUpdateRequest | null {
  const versionTooLow = row.status.versionSupported === false || row.status.reasonCode === 'version_too_low'
  if (!versionTooLow && state?.status === 'current') return null
  if (state?.current.source === 'unavailable' || row.status.installed === 'no') return null
  const version = state?.current.version ?? row.status.version
  const path = state?.current.path ?? row.status.resolvedCommand
  const installCommand = setupInstallCommand(row.definition.setup, platform)?.command
  const docsUrl = state?.docsUrl ?? row.definition.setup?.docsUrl
  return {
    harnessId: row.definition.id,
    ...(version ? { currentVersion: version } : {}),
    ...(path ? { currentPath: path } : {}),
    ...(state?.current.source ? { source: state.current.source } : {}),
    ...(state?.current.source === 'application' && state.current.owner ? { owner: state.current.owner } : {}),
    ...(state?.latestVersion ? { latestVersion: state.latestVersion } : {}),
    ...(state?.candidate?.version ? { localVersion: state.candidate.version } : {}),
    ...(installCommand ? { installCommand } : {}),
    ...(docsUrl?.startsWith('https://') ? { docsUrl } : {}),
    ...(versionTooLow ? { versionTooLow } : {})
  }
}
