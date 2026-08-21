import { useEffect, useState, type FormEvent, type ReactElement } from 'react'
import { KeyRound, Plus, Server, Trash2, X } from 'lucide-react'
import type { RemoteSshAuth, RemoteSshHost, RemoteSshHostInput } from '@shared/remote-ssh'
import { SettingsCard } from '../settings-controls'

const EMPTY: RemoteSshHostInput = {
  label: '', hostname: '', port: 22, username: '', auth: { type: 'agent' }
}

export function SshServersCard({ t }: { t: (key: string, options?: Record<string, unknown>) => string }): ReactElement {
  const [hosts, setHosts] = useState<RemoteSshHost[]>([])
  const [editing, setEditing] = useState<RemoteSshHost | 'new' | null>(null)
  const [form, setForm] = useState<RemoteSshHostInput>(EMPTY)
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const refresh = (): void => { void window.kunGui.listRemoteSshHosts().then(setHosts) }
  useEffect(refresh, [])

  const open = (host?: RemoteSshHost): void => {
    setEditing(host ?? 'new')
    setForm(host ? { label: host.label, hostname: host.hostname, port: host.port, username: host.username, auth: host.auth } : EMPTY)
    setMessage(null)
  }
  const submit = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    setBusy('save')
    setMessage(null)
    try {
      if (editing === 'new') await window.kunGui.createRemoteSshHost(form)
      else if (editing) await window.kunGui.updateRemoteSshHost(editing.id, form)
      setEditing(null)
      refresh()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error))
    } finally { setBusy(null) }
  }
  const connect = async (host: RemoteSshHost): Promise<void> => {
    setBusy(host.id)
    setMessage(null)
    try {
      let result = await window.kunGui.connectRemoteSshHost(host.id)
      if (!result.ok && result.reason === 'hostKeyConfirmationRequired') {
        const accepted = window.confirm(`${t('sshTrustHostKey', { defaultValue: 'Trust this SSH host key?' })}\n\n${host.username}@${host.hostname}:${host.port}\n${result.fingerprint}`)
        if (accepted) {
          await window.kunGui.confirmRemoteSshHostKey(result)
          result = await window.kunGui.connectRemoteSshHost(host.id)
        }
      }
      setMessage(result.ok ? t('sshConnected', { defaultValue: 'SSH connection succeeded.' }) : ('message' in result ? result.message : t('sshNotTrusted', { defaultValue: 'Host key was not trusted.' })))
    } catch (error) { setMessage(error instanceof Error ? error.message : String(error)) }
    finally { setBusy(null) }
  }
  const remove = async (host: RemoteSshHost): Promise<void> => {
    if (!window.confirm(t('sshDeleteConfirm', { defaultValue: `Delete ${host.label}?`, name: host.label }))) return
    await window.kunGui.removeRemoteSshHost(host.id)
    refresh()
  }
  const setAuth = (auth: RemoteSshAuth): void => setForm((current) => ({ ...current, auth }))
  const inputClass = 'w-full rounded-lg border border-ds-border bg-ds-card px-3 py-2 text-[13px] text-ds-ink outline-none focus:border-accent/50'

  return (
    <SettingsCard title={t('sshServersTitle', { defaultValue: 'SSH servers' })}>
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-4">
          <p className="max-w-xl text-[12px] leading-5 text-ds-muted">{t('sshServersDescription', { defaultValue: 'Open remote shell tabs. Kun agents, files, and workspaces remain local.' })}</p>
          <button type="button" onClick={() => open()} className="inline-flex items-center gap-2 rounded-full bg-ds-userbubble px-3 py-1.5 text-[12px] font-semibold text-ds-userbubbleFg"><Plus className="h-4 w-4" />{t('sshAddServer', { defaultValue: 'Add server' })}</button>
        </div>
        {message ? <p role="status" className="rounded-lg bg-ds-subtle px-3 py-2 text-[12px] text-ds-ink">{message}</p> : null}
        {hosts.length === 0 ? <p className="rounded-xl border border-dashed border-ds-border p-5 text-center text-[12px] text-ds-muted">{t('sshNoServers', { defaultValue: 'No SSH servers configured.' })}</p> : hosts.map((host) => (
          <div key={host.id} className="flex items-center gap-3 rounded-xl border border-ds-border px-4 py-3">
            <Server className="h-5 w-5 shrink-0 text-ds-muted" />
            <button type="button" onClick={() => open(host)} className="min-w-0 flex-1 text-left"><span className="block truncate text-[13px] font-semibold text-ds-ink">{host.label}</span><span className="block truncate font-mono text-[11px] text-ds-muted">{host.username}@{host.hostname}:{host.port} · {host.auth.type === 'agent' ? 'ssh-agent' : 'identity file'}</span></button>
            <button type="button" disabled={busy === host.id} onClick={() => void connect(host)} className="rounded-full border border-ds-border px-3 py-1.5 text-[11px] font-medium text-ds-ink hover:bg-ds-hover disabled:opacity-50">{t('sshTestConnection', { defaultValue: 'Test' })}</button>
            <button type="button" onClick={() => void window.kunGui.resetRemoteSshHostKey(host.id).then(() => setMessage(t('sshTrustReset', { defaultValue: 'Host trust reset.' })))} className="rounded-lg p-2 text-ds-muted hover:bg-ds-hover" title={t('sshResetTrust', { defaultValue: 'Reset host trust' })}><KeyRound className="h-4 w-4" /></button>
            <button type="button" onClick={() => void remove(host)} className="rounded-lg p-2 text-ds-muted hover:bg-ds-dangerSoft hover:text-ds-danger" title={t('sshDeleteServer', { defaultValue: 'Delete server' })}><Trash2 className="h-4 w-4" /></button>
          </div>
        ))}
      </div>
      {editing ? <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/45 p-6" role="dialog" aria-modal="true"><form onSubmit={(event) => void submit(event)} className="w-full max-w-lg rounded-2xl border border-ds-border bg-ds-card p-5 shadow-2xl"><div className="mb-4 flex items-center justify-between"><h3 className="text-[16px] font-semibold text-ds-ink">{editing === 'new' ? t('sshAddServer', { defaultValue: 'Add server' }) : t('sshEditServer', { defaultValue: 'Edit server' })}</h3><button type="button" onClick={() => setEditing(null)} className="rounded-lg p-2 hover:bg-ds-hover"><X className="h-4 w-4" /></button></div><div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-[12px] text-ds-muted">{t('sshName', { defaultValue: 'Name' })}<input required maxLength={120} className={inputClass} value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
        <label className="text-[12px] text-ds-muted">Host<input required className={inputClass} value={form.hostname} onChange={(e) => setForm({ ...form, hostname: e.target.value })} /></label><label className="text-[12px] text-ds-muted">Port<input required type="number" min={1} max={65535} className={inputClass} value={form.port ?? 22} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
        <label className="col-span-2 text-[12px] text-ds-muted">Username<input required className={inputClass} value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></label>
        <label className="col-span-2 text-[12px] text-ds-muted">Authentication<select className={inputClass} value={form.auth.type} onChange={(e) => setAuth(e.target.value === 'agent' ? { type: 'agent' } : { type: 'identityFile', identityFile: '' })}><option value="agent">ssh-agent</option><option value="identityFile">Identity file</option></select></label>
        {form.auth.type === 'identityFile' ? <label className="col-span-2 text-[12px] text-ds-muted">Identity file path<div className="flex gap-2"><input required className={inputClass} value={form.auth.identityFile} onChange={(e) => setAuth({ type: 'identityFile', identityFile: e.target.value })} placeholder="~/.ssh/id_ed25519" /><button type="button" onClick={() => void window.kunGui.pickRemoteSshIdentityFile().then((path) => { if (path) setAuth({ type: 'identityFile', identityFile: path }) })} className="shrink-0 rounded-lg border border-ds-border px-3 text-ds-ink hover:bg-ds-hover">Browse</button></div></label> : null}
      </div><div className="mt-5 flex justify-end gap-2"><button type="button" onClick={() => setEditing(null)} className="rounded-full border border-ds-border px-4 py-2 text-[12px]">{t('cancel', { defaultValue: 'Cancel' })}</button><button disabled={busy === 'save'} type="submit" className="rounded-full bg-ds-userbubble px-4 py-2 text-[12px] font-semibold text-ds-userbubbleFg disabled:opacity-50">{t('save', { defaultValue: 'Save' })}</button></div></form></div> : null}
    </SettingsCard>
  )
}
