import { useEffect, useState, type ReactElement } from 'react'
import type { KunHarnessProviderOverrideV1 } from '@shared/app-settings'
import { agentExtraArgs } from '@shared/harness-provider-settings'
import { SettingRow } from '../settings-controls'
import { parseEnvLines } from './agent-center-custom-form'

type T = (key: string, options?: Record<string, unknown>) => string

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,63}$/
const envText = (env: Readonly<Record<string, string>> | undefined): string =>
  Object.entries(env ?? {}).map(([name, value]) => `${name}=${value}`).join('\n')
const inputClass = 'w-full rounded-xl border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink shadow-sm focus:border-accent focus:outline-none'

/**
 * Extra arguments and environment for a builtin Agent's launch
 * (docs/ade/17 §4.3). Drafts stay local while typing and save on blur, so a
 * half-typed argument or variable never reaches the runtime.
 */
export function AgentLaunchOverrideFields({ id, providers, tSettings, onChange }: {
  id: string
  providers: Readonly<Record<string, KunHarnessProviderOverrideV1>>
  tSettings: T
  onChange: (patch: { args?: string[]; env?: Record<string, string> }) => void
}): ReactElement {
  const storedArgs = agentExtraArgs(providers, id).join(' ')
  const storedEnv = envText(providers[id]?.env)
  const [args, setArgs] = useState(storedArgs)
  const [env, setEnv] = useState(storedEnv)
  const [envInvalid, setEnvInvalid] = useState(false)
  useEffect(() => setArgs(storedArgs), [storedArgs])
  useEffect(() => { setEnv(storedEnv); setEnvInvalid(false) }, [storedEnv])

  const commitArgs = (): void => {
    const values = args.trim() ? args.trim().split(/\s+/) : []
    if (values.join(' ') !== storedArgs) onChange({ args: values })
  }
  const commitEnv = (): void => {
    const parsed = parseEnvLines(env)
    if (!parsed || Object.keys(parsed).some((name) => !ENV_NAME.test(name))) { setEnvInvalid(true); return }
    setEnvInvalid(false)
    if (envText(parsed) !== storedEnv) onChange({ env: parsed })
  }

  return (
    <>
      <SettingRow
        wideControl
        title={tSettings('adeSettings.harnessExtraArgs')}
        description={tSettings('adeSettings.harnessExtraArgsDesc')}
        control={<input data-agent-extra-args className={inputClass} value={args} spellCheck={false}
          onChange={(event) => setArgs(event.target.value)} onBlur={commitArgs} />}
      />
      <SettingRow
        wideControl
        title={tSettings('adeSettings.harnessLaunchEnv')}
        description={tSettings('adeSettings.harnessLaunchEnvDesc')}
        control={<div className="w-full">
          <textarea data-agent-launch-env className={`${inputClass} resize-none`} rows={2} value={env} spellCheck={false}
            aria-invalid={envInvalid} onChange={(event) => setEnv(event.target.value)} onBlur={commitEnv} />
          {envInvalid ? <div className="mt-1 text-[11px] text-ds-status-danger">{tSettings('adeSettings.acpFormEnvInvalid')}</div> : null}
        </div>}
      />
    </>
  )
}
