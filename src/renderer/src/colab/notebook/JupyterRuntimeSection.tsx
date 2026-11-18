import { useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import { CloudDownload, ExternalLink, Loader2, Plus, Server } from 'lucide-react'
import type { JupyterServerView } from '@shared/colab/colab-notebook-types'
import { useColabNotebookStore } from './colab-notebook-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const button = 'rounded-md border border-ds-border px-2 py-1 text-[12px] text-ds-ink hover:bg-ds-hover disabled:opacity-45'
const primary = 'rounded-md bg-accent px-2.5 py-1.5 text-[12px] font-semibold text-white hover:opacity-90 disabled:opacity-45'
const field = 'w-full min-w-0 rounded-md border border-ds-border bg-ds-main px-2 py-1.5 text-[12px] text-ds-ink focus:border-accent focus:outline-none'

export function JupyterRuntimeSection({ runtime, onPull }: {
  runtime: ColabNotebookRuntime
  onPull: (server: JupyterServerView) => void
}): ReactElement {
  const { t } = useTranslation('common')
  const { jupyterServers, jupyterSession, jupyterConnecting, jupyterError, wsKey } = runtime
  const kernelBusy = useColabNotebookStore((s) => Boolean(s.runningCellId || s.queue.length || s.kunBusy))
  const [adding, setAdding] = useState(false)
  const [managing, setManaging] = useState<string | null>(null)
  const [kernelChoice, setKernelChoice] = useState('')
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)
  const [manageError, setManageError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [name, setName] = useState('')

  const closeForm = (): void => {
    setAdding(false)
    setUrl('')
    setSecret('')
    setName('')
    setFormError(null)
  }

  const submitNew = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!url.trim() || saving) return
    setSaving(true)
    setFormError(null)
    try {
      const result = await window.kunGui.jupyterSaveServer({
        url: url.trim(),
        tokenOrPassword: secret || undefined,
        name: name.trim() || undefined
      })
      if (result.ok) closeForm()
      else setFormError(result.message)
    } catch {
      setFormError(t('colabNb.jupyterSaveFailed'))
    } finally {
      setSaving(false)
    }
  }

  const removeServer = async (serverId: string): Promise<void> => {
    setRemoving(true)
    setManageError(null)
    try {
      const result = await window.kunGui.jupyterRemoveServer({ serverId })
      if (result.ok) setManaging(null)
      else setManageError(t('colabNb.jupyterRemoveFailed'))
    } catch {
      setManageError(t('colabNb.jupyterRemoveFailed'))
    } finally {
      setRemoveId(null)
      setRemoving(false)
    }
  }

  return (
    <section className="space-y-2 px-2 pb-2" aria-label={t('colabNb.jupyterBackendTab')}>
      <div className="flex items-center justify-between gap-1">
        <h3 className="min-w-0 text-[11.5px] font-semibold text-ds-faint">{t('colabNb.jupyterBackendTab')}</h3>
        <button type="button" onClick={() => setAdding(true)} disabled={adding} title={t('colabNb.jupyterAddServer')}
          aria-label={t('colabNb.jupyterAddServer')} className={`${button} inline-flex shrink-0 items-center gap-1`}>
          <Plus className="h-3 w-3" aria-hidden="true" />{t('colabNb.addConnection')}
        </button>
      </div>
      {!jupyterServers.length && !adding ? (
        <p className="px-0.5 text-[11.5px] text-ds-faint">{t('colabNb.jupyterNoServers')}</p>
      ) : null}
      {jupyterServers.map((server) => {
        const session = jupyterSession?.serverId === server.id ? jupyterSession : null
        const active = session && runtime.activeSessionId === session.id
        const expanded = managing === server.id
        return (
          <div key={server.id} className="rounded-xl border border-ds-border bg-ds-card px-2.5 py-2">
            <div className="flex items-center gap-1.5">
              <Server className={`h-3.5 w-3.5 shrink-0 ${session ? 'text-emerald-500' : 'text-ds-faint'}`} aria-hidden="true" />
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-ds-ink" title={server.name}>{server.name}</span>
              {session ? <span className="max-w-[42%] shrink-0 truncate text-[10px] text-emerald-600">{session.kernelName}</span> : null}
            </div>
            <div className="mt-0.5 truncate pl-5 text-[10.5px] text-ds-faint" title={server.baseUrl}>{server.baseUrl}</div>
            <div className="mt-1.5 flex flex-col items-start">
              <button type="button" disabled={!wsKey} onClick={() => onPull(server)}
                className="inline-flex items-center gap-1.5 rounded-md px-1 py-1 text-left text-[12px] font-medium text-accent hover:bg-ds-hover disabled:opacity-45">
                <CloudDownload className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{t('colabNb.jupyterBrowseNotebooks')}
              </button>
              <button type="button" aria-expanded={expanded} onClick={() => {
                setManaging(expanded ? null : server.id)
                setKernelChoice('')
                setManageError(null)
                setRemoveId(null)
              }} className="rounded-md px-1 py-1 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink">
                {t('colabNb.jupyterManageServer')}
              </button>
            </div>
            {expanded ? (
              <div className="mt-1 space-y-2 border-t border-ds-border pt-2">
                <p className="text-[11px] leading-relaxed text-ds-muted">
                  {jupyterSession && !session ? t('colabNb.jupyterReplaceKernel', { name: jupyterSession.serverName }) : t('colabNb.jupyterExecutionHint')}
                </p>
                {!session && server.availableKernels.length > 1 ? (
                  <label className="block space-y-1 text-[11px] text-ds-muted">
                    <span>{t('colabNb.jupyterKernelLabel')}</span>
                    <select value={kernelChoice || server.kernelName} onChange={(event) => setKernelChoice(event.target.value)} className={field}>
                      {server.availableKernels.map((kernel) => <option key={kernel} value={kernel}>{kernel}</option>)}
                    </select>
                  </label>
                ) : null}
                <div className="flex flex-wrap gap-1">
                  {session ? (
                    <>
                      {!active ? <button type="button" disabled={kernelBusy} className={primary}
                        onClick={() => runtime.setBackend('jupyter')}>{t('colabNb.useExecutionKernel')}</button> : null}
                      <button type="button" className={button} onClick={() => void runtime.disconnectJupyter()}>{t('colabNb.disconnect')}</button>
                    </>
                  ) : (
                    <button type="button" disabled={!wsKey || kernelBusy || jupyterConnecting} className={primary}
                      onClick={() => void runtime.connectJupyter({ serverId: server.id, kernelName: kernelChoice || undefined })}>
                      {jupyterConnecting ? t('colabNb.connecting') : t('colabNb.jupyterStartKernel')}
                    </button>
                  )}
                  <button type="button" className={button} title={t('colabNb.jupyterOpenLab')} aria-label={t('colabNb.jupyterOpenLab')}
                    onClick={() => void window.kunGui.jupyterOpenBrowser({ serverId: server.id })}><ExternalLink className="h-3.5 w-3.5" /></button>
                  <button type="button" className={button} disabled={removing} onClick={() => setRemoveId(server.id)}>{t('colabNb.jupyterRemoveServer')}</button>
                </div>
                {removeId === server.id ? (
                  <div className="space-y-1 border-t border-ds-border pt-2">
                    <p className="text-[11px] text-ds-muted">{t('colabNb.jupyterRemoveConfirm')}</p>
                    <div className="flex gap-1">
                      <button type="button" className={button} disabled={removing} onClick={() => setRemoveId(null)}>{t('cancel')}</button>
                      <button type="button" className={`${button} text-red-600`} disabled={removing} onClick={() => void removeServer(server.id)}>{t('colabNb.jupyterRemoveServer')}</button>
                    </div>
                  </div>
                ) : null}
                {manageError || jupyterError ? <p role="alert" className="break-words text-[11px] text-red-600">{manageError || jupyterError}</p> : null}
              </div>
            ) : null}
          </div>
        )
      })}
      {adding ? (
        <form onSubmit={(event) => void submitNew(event)} className="space-y-2 rounded-xl border border-ds-border bg-ds-card p-2.5">
          <h4 className="text-[12px] font-semibold text-ds-ink">{t('colabNb.jupyterAddServer')}</h4>
          <p className="text-[11px] leading-relaxed text-ds-muted">{t('colabNb.jupyterSaveHint')}</p>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterUrlLabel')}</span>
            <input type="text" required inputMode="url" value={url} onChange={(event) => setUrl(event.target.value)}
              placeholder="http://127.0.0.1:8888" className={field} autoComplete="off" />
          </label>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterTokenPlaceholder')}</span>
            <input type="password" value={secret} onChange={(event) => setSecret(event.target.value)} className={field} autoComplete="off" />
          </label>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterNamePlaceholder')}</span>
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} className={field} />
          </label>
          {formError ? <p role="alert" className="break-words text-[11px] text-red-600">{formError}</p> : null}
          <div className="flex flex-wrap justify-end gap-1">
            <button type="button" className={button} disabled={saving} onClick={closeForm}>{t('cancel')}</button>
            <button type="submit" className={`${primary} inline-flex items-center gap-1`} disabled={!url.trim() || saving}>
              {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
              {saving ? t('colabNb.jupyterVerifying') : t('colabNb.jupyterVerifyAndSave')}
            </button>
          </div>
        </form>
      ) : null}
    </section>
  )
}
