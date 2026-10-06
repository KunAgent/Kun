import { useEffect, useState, type ReactElement } from 'react'
import type { KunHarnessSettingsV1 } from '@shared/app-settings'
import { AGENT_SETTINGS_TIMEOUT_MS, waitForAgentSettings } from './agent-enablement-settings'
import type { IntegrationT } from './AgentIntegrationLocations'

export function AgentApplicationPathSettings({ harnessId, settings, onSetBinaryPath, beforeSave, onSaved, t }: {
  harnessId: string
  settings: KunHarnessSettingsV1
  onSetBinaryPath: (path: string) => void
  beforeSave?: () => Promise<boolean>
  onSaved: () => void
  t: IntegrationT
}): ReactElement {
  const binaryPath = settings.binaryPaths[harnessId] ?? ''
  const [draft, setDraft] = useState(binaryPath)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => { setDraft(binaryPath) }, [binaryPath])
  const save = async (): Promise<void> => {
    if (saving) return
    const path = draft.trim()
    const binaryPaths = { ...settings.binaryPaths }
    if (path) binaryPaths[harnessId] = path
    else delete binaryPaths[harnessId]
    setSaving(true)
    setError('')
    try {
      onSetBinaryPath(path)
      if (beforeSave && !await beforeSave()) throw new Error(t('agentIntegrations.applicationPathSaveFailed'))
      await waitForAgentSettings({ ...settings, binaryPaths }, AbortSignal.timeout(AGENT_SETTINGS_TIMEOUT_MS), { harnessId })
      onSaved()
    } catch (cause) {
      setError(cause instanceof Error && cause.message.startsWith('agentEnablement.')
        ? t(cause.message) : t('agentIntegrations.applicationPathSaveFailed'))
    } finally { setSaving(false) }
  }
  return <details className="mt-3 rounded-lg border border-ds-border-muted px-3 py-2" data-agent-application-path-settings>
    <summary className="cursor-pointer text-[12px] font-medium text-ds-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      {t('agentIntegrations.specifyApplicationPath')}
    </summary>
    <p className="mt-2 text-[11px] text-ds-faint">{t('agentIntegrations.applicationPathHint')}</p>
    <label className="mt-2 block text-[12px] text-ds-muted">
      {t('agentIntegrations.applicationPath')}
      <input type="text" value={draft} disabled={saving} spellCheck={false} data-agent-application-path-input
        onChange={(event) => { setDraft(event.target.value); setError('') }}
        placeholder={t('agentIntegrations.applicationPathPlaceholder')}
        className="mt-1 w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 font-mono text-[12px] text-ds-ink focus:border-accent focus:outline-none disabled:opacity-50" />
    </label>
    <button type="button" disabled={saving || (!error && draft.trim() === binaryPath.trim())} aria-busy={saving}
      data-agent-save-application-path onClick={() => void save()}
      className="mt-2 rounded-lg border border-ds-border-muted px-3 py-1.5 text-[12px] text-ds-ink hover:bg-ds-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-45">
      {t(saving ? 'agentIntegrations.applicationPathSaving' : 'agentIntegrations.applicationPathSave')}
    </button>
    {error ? <p role="alert" className="mt-2 text-[12px] text-ds-status-danger">{error}</p> : null}
  </details>
}
