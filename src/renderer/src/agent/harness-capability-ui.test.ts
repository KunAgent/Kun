import { describe, expect, it } from 'vitest'
import type {
  HarnessCapabilities,
  HarnessCapabilityKey
} from '@shared/harness-capabilities'
import {
  canAbort,
  canApproveForMe,
  canAttachImages,
  canFork,
  canRewind,
  canSteer,
  canSwitchModelMidSession,
  capabilityReason,
  contextTelemetryKnown,
  kunToolsAvailable,
  showEffortControl,
  showHarnessModeIcons,
  showHarnessSlashCommands,
  showPlanModeToggle,
  usageReportingAvailable
} from './harness-capability-ui'
import type { DelegatedRuntimeState } from './types'

const allSupported: HarnessCapabilities = {
  statuses: Object.fromEntries(
    [
      'nativeResume', 'fork', 'rewind', 'structuredStreaming', 'reasoningStream',
      'abort', 'sameTurnSteer', 'switchModelMidSession',
      'setPermissionModeMidSession', 'effort', 'planMode', 'manualCompact',
      'kunTools', 'externalApproval', 'nativeToolInterception', 'fsMediated',
      'terminalMediated', 'nativeContextTelemetry', 'imageInput', 'fileInput',
      'nativeCommands', 'modes', 'userInput'
    ].map((key) => [key, { supported: true }])
  ) as HarnessCapabilities['statuses'],
  facts: { sandbox: 'host', usageReporting: 'exact', compactionOwner: 'kun' }
}

const unsupported = (key: HarnessCapabilityKey): HarnessCapabilities => ({
  ...allSupported,
  statuses: {
    ...allSupported.statuses,
    [key]: { supported: false, reason: 'upstream', upstreamRef: 'test' }
  }
})

const runtime = (caps: HarnessCapabilities): DelegatedRuntimeState => ({
  threadId: 't1',
  providerKind: 'agent-sdk',
  providerId: 'p1',
  harnessId: 'claude-code',
  capabilitiesV2: caps,
  phase: 'portable',
  capabilities: {
    nativeResume: true,
    structuredStreaming: true,
    kunTools: true,
    externalApproval: true,
    liveSteering: true,
    nativeContextTelemetry: true,
    fork: true
  }
})

describe('harness capability degrade contract', () => {
  it('keeps Kun-native defaults when no snapshot exists', () => {
    for (const fn of [
      canSteer, canAbort, canSwitchModelMidSession, showEffortControl,
      showPlanModeToggle, showHarnessModeIcons, showHarnessSlashCommands,
      canAttachImages, kunToolsAvailable, contextTelemetryKnown,
      usageReportingAvailable, canRewind, canFork, canApproveForMe
    ]) {
      expect(fn(null)).toBe(true)
      expect(fn(runtime(allSupported))).toBe(true)
    }
  })

  it('falls back to the legacy liveSteering flag without a v2 snapshot', () => {
    const legacy = runtime(allSupported)
    delete legacy.capabilitiesV2
    expect(canSteer(legacy)).toBe(true)
    legacy.capabilities.liveSteering = false
    expect(canSteer(legacy)).toBe(false)
  })

  it.each([
    ['sameTurnSteer', canSteer],
    ['abort', canAbort],
    ['switchModelMidSession', canSwitchModelMidSession],
    ['effort', showEffortControl],
    ['planMode', showPlanModeToggle],
    ['modes', showHarnessModeIcons],
    ['nativeCommands', showHarnessSlashCommands],
    ['imageInput', canAttachImages],
    ['kunTools', kunToolsAvailable],
    ['nativeContextTelemetry', contextTelemetryKnown],
    ['rewind', canRewind],
    ['fork', canFork],
    ['externalApproval', canApproveForMe]
  ] as const)('%s unsupported degrades its affordance', (key, fn) => {
    expect(fn(runtime(unsupported(key)))).toBe(false)
    expect(fn(runtime(allSupported))).toBe(true)
  })

  it('usageReporting fact of none hides usage', () => {
    const caps: HarnessCapabilities = {
      ...allSupported,
      facts: { ...allSupported.facts, usageReporting: 'none' }
    }
    expect(usageReportingAvailable(runtime(caps))).toBe(false)
    expect(usageReportingAvailable(runtime(allSupported))).toBe(true)
  })

  it('exposes the unsupported reason for tooltips', () => {
    const caps: HarnessCapabilities = {
      ...allSupported,
      statuses: {
        ...allSupported.statuses,
        rewind: { supported: false, reason: 'platform' }
      }
    }
    expect(capabilityReason(runtime(caps), 'rewind')).toBe('platform')
    expect(capabilityReason(runtime(allSupported), 'rewind')).toBeUndefined()
    expect(capabilityReason(null, 'rewind')).toBeUndefined()
  })
})
