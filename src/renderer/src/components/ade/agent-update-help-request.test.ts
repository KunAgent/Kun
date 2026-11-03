import { describe, expect, it } from 'vitest'
import type { AdeHarnessRow } from '@shared/ade-harnesses'
import type { HarnessUpdateState } from '../../../../../kun/src/contracts/harness-update'
import { agentUpdateHelpRequest } from './agent-update-help-request'

const row = (status: Partial<AdeHarnessRow['status']> = {}): AdeHarnessRow => ({
  definition: { id: 'dsh', setup: { install: [{ platform: 'any', command: 'npm install -g @deepseek-ai/dsh' }], docsUrl: 'https://example.com/dsh' } },
  status: { harnessId: 'dsh', installed: 'yes', version: '0.2.1-rc.1', resolvedCommand: '/bin/dsh', ...status }
}) as AdeHarnessRow
const state = (patch: Partial<HarnessUpdateState> = {}): HarnessUpdateState => ({
  harnessId: 'dsh', current: { path: '/Users/me/.local/bin/dsh', source: 'npm', version: '0.2.1-rc.1', fingerprint: 'f' },
  status: 'available', latestVersion: '0.2.1-rc.2', channel: 'latest', canUpdate: false, canInstallManaged: false, ...patch
})

describe('agentUpdateHelpRequest', () => {
  it('collects what the update card already knows', () => {
    expect(agentUpdateHelpRequest(row(), state(), 'darwin')).toEqual({
      harnessId: 'dsh', currentVersion: '0.2.1-rc.1', currentPath: '/Users/me/.local/bin/dsh', source: 'npm', latestVersion: '0.2.1-rc.2',
      installCommand: 'npm install -g @deepseek-ai/dsh', docsUrl: 'https://example.com/dsh'
    })
  })

  it('stays out of the way when the Agent is current or not installed', () => {
    expect(agentUpdateHelpRequest(row(), state({ status: 'current' }), 'darwin')).toBeNull()
    expect(agentUpdateHelpRequest(row({ installed: 'no' }), undefined, 'darwin')).toBeNull()
    expect(agentUpdateHelpRequest(row(), state({ current: { source: 'unavailable', fingerprint: 'f' } }), 'darwin')).toBeNull()
  })

  it('still offers help before any check, or when the update check failed', () => {
    expect(agentUpdateHelpRequest(row(), undefined, 'darwin')).toMatchObject({ harnessId: 'dsh', currentVersion: '0.2.1-rc.1', currentPath: '/bin/dsh' })
    expect(agentUpdateHelpRequest(row(), state({ status: 'unknown', latestVersion: undefined }), 'darwin')).not.toBeNull()
  })

  it('flags a version Kun cannot connect to even when the registry says current', () => {
    expect(agentUpdateHelpRequest(row({ versionSupported: false }), state({ status: 'current' }), 'darwin')).toMatchObject({ versionTooLow: true })
    expect(agentUpdateHelpRequest(row({ reasonCode: 'version_too_low' }), undefined, 'darwin')).toMatchObject({ versionTooLow: true })
  })

  it('reports a newer local copy, the owning app, and drops non-https docs', () => {
    const request = agentUpdateHelpRequest(
      { ...row(), definition: { ...row().definition, setup: { docsUrl: 'http://insecure.test' } } },
      state({ current: { source: 'application', owner: 'Cursor', fingerprint: 'f' }, candidate: { source: 'npm', version: '0.3.0', fingerprint: 'c' } }), 'darwin')
    expect(request).toMatchObject({ source: 'application', owner: 'Cursor', localVersion: '0.3.0' })
    expect(request).not.toHaveProperty('docsUrl')
    expect(request).not.toHaveProperty('installCommand')
  })
})
