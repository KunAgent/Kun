import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Check,
  Copy,
  Download,
  ExternalLink,
  Laptop,
  Loader2,
  MoreHorizontal,
  Plus,
  Server
} from 'lucide-react'
import type { JupyterServerView } from '@shared/colab/colab-notebook-types'
import { useColabNotebookStore } from './colab-notebook-store'
import { useNotebookPullStore } from './notebook-pull-store'
import type { ColabNotebookRuntime } from './use-colab-notebook-runtime'

const LOCAL_JUPYTER_URL = 'http://127.0.0.1:8888'
const LOCAL_JUPYTER_CMD = 'jupyter lab --no-browser --port 8888'

const smallBtn =
  'rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 text-[11.5px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-45'
const primaryBtn =
  'rounded-[7px] bg-accent px-2.5 py-1 text-[11.5px] font-semibold text-white hover:opacity-90 disabled:opacity-45'
const field =
  'w-full min-w-0 rounded-[7px] border border-ds-border bg-ds-main px-2.5 py-1.5 text-[12px] text-ds-ink focus:border-accent focus:outline-none'

export function isLocalJupyterUrl(baseUrl: string): boolean {
  try {
    const host = new URL(baseUrl).hostname.toLowerCase()
    return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]' || host === '0.0.0.0'
  } catch {
    return /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/i.test(baseUrl)
  }
}

export function formatJupyterAuthLabel(
  server: Pick<JupyterServerView, 'authMode' | 'hasAuth'>,
  t: (key: string) => string
): string {
  if (server.authMode === 'password') return t('colabNb.jupyterAuthPassword')
  if (server.authMode === 'token' || server.hasAuth) return t('colabNb.jupyterAuthToken')
  return t('colabNb.jupyterAuthNone')
}

export function JupyterRuntimeSection({
  runtime,
  initialAdding = false,
  onConnected
}: {
  runtime: ColabNotebookRuntime
  initialAdding?: boolean
  onConnected?: () => void
}): ReactElement {
  const { t } = useTranslation('common')
  const { jupyterServers, jupyterSession, jupyterConnecting, jupyterError, wsKey } = runtime
  const kernelBusy = useColabNotebookStore((s) => Boolean(s.runningCellId || s.queue.length || s.kunBusy))
  const [adding, setAdding] = useState(initialAdding)
  const [managing, setManaging] = useState<string | null>(null)
  const [kernelChoices, setKernelChoices] = useState<Record<string, string>>({})
  const [removeId, setRemoveId] = useState<string | null>(null)
  const [removing, setRemoving] = useState(false)
  const [savingMode, setSavingMode] = useState<'save' | 'connect' | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [manageError, setManageError] = useState<string | null>(null)
  const [copiedCmd, setCopiedCmd] = useState(false)
  const [url, setUrl] = useState('')
  const [secret, setSecret] = useState('')
  const [name, setName] = useState('')

  useEffect(() => {
    if (initialAdding) setAdding(true)
  }, [initialAdding])

  const closeForm = (): void => {
    setAdding(false)
    setUrl('')
    setSecret('')
    setName('')
    setFormError(null)
  }

  const openAddForm = (presetUrl = ''): void => {
    setFormError(null)
    setUrl(presetUrl)
    setSecret('')
    setName('')
    setAdding(true)
  }

  const submitSaveOnly = async (): Promise<void> => {
    if (!url.trim() || savingMode) return
    setSavingMode('save')
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
      setSavingMode(null)
    }
  }

  const submitSaveAndConnect = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    if (!url.trim() || savingMode) return
    if (!wsKey) {
      await submitSaveOnly()
      return
    }
    setSavingMode('connect')
    setFormError(null)
    try {
      const ok = await runtime.connectJupyter({
        url: url.trim(),
        tokenOrPassword: secret || undefined,
        name: name.trim() || undefined
      })
      if (ok) {
        closeForm()
        onConnected?.()
      }
    } catch {
      setFormError(t('colabNb.jupyterSaveFailed'))
    } finally {
      setSavingMode(null)
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

  const openImportFromServer = (server: JupyterServerView): void => {
    if (!wsKey) return
    onConnected?.()
    useNotebookPullStore
      .getState()
      .open({ kind: 'jupyter', serverId: server.id, label: server.name }, wsKey)
  }

  const copyLocalCmd = async (): Promise<void> => {
    await navigator.clipboard?.writeText(LOCAL_JUPYTER_CMD)
    setCopiedCmd(true)
    setTimeout(() => setCopiedCmd(false), 1500)
  }

  return (
    <section className="px-1.5 py-1" data-colab-kernel-section="jupyter" aria-label={t('colabNb.jupyterCustomTab')}>
      {jupyterServers.length === 0 && !adding ? (
        <div className="mx-1.5 space-y-2.5 rounded-[10px] border border-ds-border/80 bg-ds-main/50 p-3">
          <div>
            <div className="text-[12.5px] font-semibold text-ds-ink">{t('colabNb.jupyterEmptyTitle')}</div>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ds-muted">{t('colabNb.jupyterEmptyDesc')}</p>
          </div>
          <div className="rounded-[8px] border border-ds-border/70 bg-ds-card px-2.5 py-2">
            <div className="mb-1 text-[10.5px] font-medium text-ds-faint">{t('colabNb.jupyterLocalCmdHint')}</div>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate font-mono text-[11px] text-ds-ink">
                {LOCAL_JUPYTER_CMD}
              </code>
              <button
                type="button"
                onClick={() => void copyLocalCmd()}
                aria-label={t('colabNb.copyUrlShort')}
                title={copiedCmd ? t('colabNb.copiedShort') : t('colabNb.copyUrlShort')}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
              >
                {copiedCmd ? <Check className="h-3.5 w-3.5 text-emerald-500" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => openAddForm(LOCAL_JUPYTER_URL)}
              className={`${primaryBtn} inline-flex flex-1 items-center justify-center gap-1.5 py-1.5`}
            >
              <Laptop className="h-3.5 w-3.5" />
              <span>{t('colabNb.jupyterQuickLocalBtn')}</span>
            </button>
            <button
              type="button"
              onClick={() => openAddForm()}
              className={`${smallBtn} inline-flex items-center justify-center gap-1 py-1.5`}
            >
              <Server className="h-3.5 w-3.5" />
              <span>{t('colabNb.jupyterAddRemoteBtn')}</span>
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-1">
        {jupyterServers.map((server) => {
          const session = jupyterSession?.serverId === server.id ? jupyterSession : null
          const active = Boolean(session && runtime.activeSessionId === session.id)
          const expanded = managing === server.id
          const local = isLocalJupyterUrl(server.baseUrl)
          const pickedKernel = kernelChoices[server.id] ?? (session ? session.kernelName : server.kernelName)

          return (
            <div
              key={server.id}
              className={`rounded-[10px] px-2.5 py-2 transition ${
                active ? 'bg-accent/[0.07]' : 'hover:bg-ds-hover/70'
              }`}
            >
              <div className="flex items-center gap-2.5">
                {local ? (
                  <Laptop
                    className={`h-4 w-4 shrink-0 ${session ? 'text-emerald-500' : 'text-ds-muted'}`}
                    aria-hidden="true"
                  />
                ) : (
                  <Server
                    className={`h-4 w-4 shrink-0 ${session ? 'text-emerald-500' : 'text-ds-muted'}`}
                    aria-hidden="true"
                  />
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-[12.5px] font-semibold text-ds-ink" title={server.name}>
                      {server.name}
                    </span>
                    <span className="shrink-0 rounded bg-ds-hover px-1.5 py-0.5 text-[10px] font-medium text-ds-muted">
                      {t(local ? 'colabNb.jupyterLocalTag' : 'colabNb.jupyterRemoteTag')}
                    </span>
                  </div>
                  <div className="truncate text-[11px] text-ds-faint" title={server.baseUrl}>
                    {session ? session.kernelName : server.kernelName} · {formatJupyterAuthLabel(server, t)} · {server.baseUrl}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {session ? (
                    <>
                      {!active ? (
                        <button
                          type="button"
                          disabled={kernelBusy}
                          className={primaryBtn}
                          onClick={() => {
                            runtime.setBackend('jupyter')
                            onConnected?.()
                          }}
                        >
                          {t('colabNb.useExecutionKernel')}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className={smallBtn}
                        onClick={() => void runtime.disconnectJupyter()}
                      >
                        {t('colabNb.disconnect')}
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={!wsKey || kernelBusy || jupyterConnecting}
                      onClick={() =>
                        void runtime
                          .connectJupyter({
                            serverId: server.id,
                            kernelName: pickedKernel || undefined
                          })
                          .then((ok) => {
                            if (ok) onConnected?.()
                          })
                      }
                      className="rounded-[7px] bg-accent/10 px-2.5 py-1 text-[12px] font-semibold text-accent hover:bg-accent/15 disabled:opacity-45"
                    >
                      {jupyterConnecting ? t('colabNb.connecting') : t('colabNb.connectJupyterShort')}
                    </button>
                  )}
                  <button
                    type="button"
                    aria-expanded={expanded}
                    aria-label={t('colabNb.jupyterManageServer')}
                    title={t('colabNb.jupyterManageServer')}
                    onClick={() => {
                      setManaging(expanded ? null : server.id)
                      setManageError(null)
                      setRemoveId(null)
                    }}
                    className="rounded-md p-1 text-ds-faint hover:bg-ds-hover hover:text-ds-ink"
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {server.availableKernels.length > 1 ? (
                <div className="mt-2 flex items-center gap-2 pl-6">
                  <span className="shrink-0 text-[11px] text-ds-muted">{t('colabNb.jupyterKernelLabel')}</span>
                  <select
                    aria-label={t('colabNb.jupyterSwitchKernel')}
                    disabled={kernelBusy || jupyterConnecting}
                    value={pickedKernel}
                    onChange={(event) => {
                      const nextKernel = event.target.value
                      setKernelChoices((prev) => ({ ...prev, [server.id]: nextKernel }))
                      if (session && nextKernel !== session.kernelName) {
                        void runtime.connectJupyter({ serverId: server.id, kernelName: nextKernel })
                      }
                    }}
                    className="min-w-0 flex-1 rounded-[7px] border border-ds-border bg-ds-card px-2 py-1 font-mono text-[11.5px] text-ds-ink focus:border-accent focus:outline-none disabled:opacity-50"
                  >
                    {server.availableKernels.map((kernel) => (
                      <option key={kernel} value={kernel}>
                        {kernel}
                      </option>
                    ))}
                  </select>
                </div>
              ) : null}

              {expanded ? (
                <div className="mt-2 space-y-2 border-t border-ds-border/70 pl-6 pt-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {wsKey ? (
                      <button
                        type="button"
                        className={`${smallBtn} inline-flex items-center gap-1`}
                        onClick={() => openImportFromServer(server)}
                      >
                        <Download className="h-3 w-3" />
                        <span>{t('colabNb.jupyterImportFromThis')}</span>
                      </button>
                    ) : null}
                    <button
                      type="button"
                      className={`${smallBtn} inline-flex items-center gap-1`}
                      onClick={() => void window.kunGui.jupyterOpenBrowser({ serverId: server.id })}
                    >
                      <ExternalLink className="h-3 w-3" />
                      <span>{t('colabNb.jupyterOpenLab')}</span>
                    </button>
                    <button
                      type="button"
                      className={`${smallBtn} text-red-600 dark:text-red-400`}
                      disabled={removing}
                      onClick={() => setRemoveId(server.id)}
                    >
                      {t('colabNb.jupyterRemoveServer')}
                    </button>
                  </div>
                  {removeId === server.id ? (
                    <div className="space-y-1.5 rounded-lg border border-ds-border bg-ds-main p-2">
                      <p className="text-[11px] text-ds-muted">{t('colabNb.jupyterRemoveConfirm')}</p>
                      <div className="flex justify-end gap-1.5">
                        <button
                          type="button"
                          className={smallBtn}
                          disabled={removing}
                          onClick={() => setRemoveId(null)}
                        >
                          {t('cancel')}
                        </button>
                        <button
                          type="button"
                          className={`${smallBtn} text-red-600`}
                          disabled={removing}
                          onClick={() => void removeServer(server.id)}
                        >
                          {t('colabNb.jupyterRemoveServer')}
                        </button>
                      </div>
                    </div>
                  ) : null}
                  {manageError ? (
                    <p role="alert" className="break-words text-[11px] text-red-600">
                      {manageError}
                    </p>
                  ) : null}
                </div>
              ) : null}
            </div>
          )
        })}
      </div>

      {jupyterError && !managing ? (
        <p role="alert" className="px-2.5 pt-1 text-[11px] text-red-600">
          {jupyterError}
        </p>
      ) : null}

      {adding ? (
        <form
          onSubmit={(event) => void submitSaveAndConnect(event)}
          className="mx-1.5 mt-1.5 space-y-2 rounded-[10px] border border-ds-border bg-ds-main/60 p-3"
        >
          <div className="flex items-center justify-between gap-2">
            <h4 className="text-[12px] font-semibold text-ds-ink">{t('colabNb.jupyterAddServer')}</h4>
            <button
              type="button"
              onClick={() => setUrl(LOCAL_JUPYTER_URL)}
              className="rounded-md bg-ds-hover px-1.5 py-0.5 font-mono text-[10.5px] text-ds-muted hover:text-ds-ink"
            >
              {t('colabNb.jupyterFillLocalPreset')}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-ds-muted">{t('colabNb.jupyterSaveHint')}</p>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterUrlLabel')}</span>
            <input
              type="text"
              required
              inputMode="url"
              value={url}
              onChange={(event) => setUrl(event.target.value)}
              placeholder="http://127.0.0.1:8888/?token=..."
              className={field}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterTokenPlaceholder')}</span>
            <input
              type="password"
              value={secret}
              onChange={(event) => setSecret(event.target.value)}
              className={field}
              autoComplete="off"
            />
          </label>
          <label className="block space-y-1 text-[11px] text-ds-muted">
            <span>{t('colabNb.jupyterNamePlaceholder')}</span>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              className={field}
            />
          </label>
          {formError ? (
            <p role="alert" className="break-words text-[11px] text-red-600">
              {formError}
            </p>
          ) : null}
          <div className="flex flex-wrap justify-end gap-1.5 pt-0.5">
            <button type="button" className={smallBtn} disabled={Boolean(savingMode)} onClick={closeForm}>
              {t('cancel')}
            </button>
            <button
              type="button"
              className={smallBtn}
              disabled={!url.trim() || Boolean(savingMode)}
              onClick={() => void submitSaveOnly()}
            >
              {savingMode === 'save' ? t('colabNb.jupyterVerifying') : t('colabNb.jupyterSaveOnly')}
            </button>
            <button
              type="submit"
              className={`${primaryBtn} inline-flex items-center gap-1`}
              disabled={!url.trim() || Boolean(savingMode) || kernelBusy}
            >
              {savingMode === 'connect' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              ) : null}
              {savingMode === 'connect'
                ? t('colabNb.connecting')
                : wsKey
                  ? t('colabNb.jupyterSaveAndConnect')
                  : t('colabNb.jupyterVerifyAndSave')}
            </button>
          </div>
        </form>
      ) : jupyterServers.length > 0 ? (
        <button
          type="button"
          onClick={() => openAddForm()}
          className="mt-1 flex w-full items-center gap-2 rounded-[8px] px-2.5 py-2 text-left text-[12px] text-ds-muted hover:bg-ds-hover hover:text-ds-ink"
        >
          <Plus className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>{t('colabNb.addJupyterServerRow')}</span>
        </button>
      ) : null}
    </section>
  )
}
