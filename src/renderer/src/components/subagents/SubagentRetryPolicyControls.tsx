import type { ReactElement } from 'react'
import type { TFunction } from 'i18next'
import type { KunSubagentsSettingsV1 } from '@shared/app-settings'
import { Toggle } from '../settings-controls'
import { CompactPolicySetting } from './SubagentCatalogControls'
import { BoundedNumberInput } from './SubagentCatalogViews'

export function SubagentRetryPolicyControls({
  subagents,
  patchSubagents,
  tSettings
}: {
  subagents: KunSubagentsSettingsV1
  patchSubagents: (patch: Partial<KunSubagentsSettingsV1>) => void
  tSettings: TFunction<'settings'>
}): ReactElement {
  const retry = subagents.proactiveRetry ?? { enabled: true, maxAttempts: 3 }
  return (
    <>
      <div className="sm:col-span-2">
        <CompactPolicySetting
          title={tSettings('subagentsProactiveRetry')}
          description={tSettings('subagentsProactiveRetryDesc')}
        >
          <Toggle
            checked={retry.enabled}
            onChange={(enabled) => patchSubagents({
              proactiveRetry: { enabled, maxAttempts: retry.maxAttempts }
            })}
            ariaLabel={tSettings('subagentsProactiveRetry')}
          />
        </CompactPolicySetting>
      </div>
      <div className="sm:col-span-2">
        <CompactPolicySetting
          title={tSettings('subagentsProactiveRetryAttempts')}
          description={tSettings('subagentsProactiveRetryAttemptsDesc')}
        >
          <BoundedNumberInput
            value={retry.maxAttempts}
            min={1}
            max={3}
            onCommit={(maxAttempts) => patchSubagents({
              proactiveRetry: { enabled: retry.enabled, maxAttempts }
            })}
          />
        </CompactPolicySetting>
      </div>
    </>
  )
}
