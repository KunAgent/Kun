import { useState } from 'react'
import {
  Check, Clipboard, Cloud, KeyRound, Link, LoaderCircle, LogIn, RefreshCw,
  ShieldAlert, ShieldCheck, UserCheck, UserPlus, Users, X
} from 'lucide-react'
import type { InvitationBundle } from '@kun/collaboration-protocol'
import type { CollaborationPendingJoinRequest } from '@shared/collaboration/contracts'
import { useCollaborationStore } from './collaboration-store'

type Panel = 'server' | 'join' | 'invite' | 'members' | null

export function NetworkCollaborationBar({ meetingId }: { meetingId?: string }): React.ReactElement {
  const { networkStatus: status, networkLoading, dispatchNetwork } = useCollaborationStore()
  const [panel, setPanel] = useState<Panel>(null)
  const [serverUrl, setServerUrl] = useState('https://127.0.0.1:19443')
  const [enrollmentToken, setEnrollmentToken] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [invitationText, setInvitationText] = useState('')
  const [createdInvitation, setCreatedInvitation] = useState('')
  const [joinRequests, setJoinRequests] = useState<CollaborationPendingJoinRequest[]>([])
  const [localServerRunning, setLocalServerRunning] = useState(false)
  const [localError, setLocalError] = useState<string | null>(null)

  const run = async (work: () => Promise<unknown>): Promise<unknown> => {
    setLocalError(null)
    try { return await work() } catch (cause) {
      setLocalError(cause instanceof Error ? cause.message : String(cause))
      return null
    }
  }
  const enroll = () => run(async () => {
    await dispatchNetwork({
      kind: 'network_operator_enroll', serverUrl: serverUrl.trim(),
      enrollmentToken: enrollmentToken.trim(), displayName: displayName.trim()
    })
    setEnrollmentToken(''); setPanel(null)
  })
  const toggleLocalServer = () => run(async () => {
    if (localServerRunning) {
      await dispatchNetwork({ kind: 'network_local_server_stop' })
      setLocalServerRunning(false)
      return
    }
    const result = await dispatchNetwork({ kind: 'network_local_server_start' }) as {
      serverUrl: string
      enrollmentToken?: string
    }
    setServerUrl(result.serverUrl)
    if (result.enrollmentToken) setEnrollmentToken(result.enrollmentToken)
    setLocalServerRunning(true)
  })
  const join = () => run(async () => {
    const invitation = JSON.parse(invitationText) as InvitationBundle
    await dispatchNetwork({ kind: 'network_invitation_join', invitation, displayName: displayName.trim() })
    setInvitationText(''); setPanel(null)
  })
  const createInvitation = () => meetingId && run(async () => {
    const invitation = await dispatchNetwork({
      kind: 'network_invitation_create', meetingId, role: 'member', expiresInSeconds: 86_400
    })
    setCreatedInvitation(JSON.stringify(invitation, null, 2))
  })
  const loadJoinRequests = () => meetingId && run(async () => {
    const result = await dispatchNetwork({ kind: 'network_join_requests', meetingId })
    setJoinRequests(result as CollaborationPendingJoinRequest[])
    setPanel('members')
  })

  const ready = status.state === 'ready'
  const securityBlocked = status.state === 'SECURITY_SYNC_REQUIRED' || status.e2eeState === 'blocked'
  return (
    <div className="shrink-0 border-b border-ds-border-muted bg-ds-card/40 text-ds-text">
      <div className="flex min-h-11 items-center gap-2 px-4">
        {securityBlocked ? <ShieldAlert className="h-4 w-4 text-red-500" /> : ready ? <ShieldCheck className="h-4 w-4 text-emerald-500" /> : <Cloud className="h-4 w-4 text-ds-muted" />}
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-medium">联网协作</div>
          <div className="truncate text-[10px] text-ds-muted">
            TLS 1.3 + SPKI · OpenMLS RFC 9420 · {securityLabel(status.state, status.e2eeState)}
          </div>
        </div>
        {networkLoading ? <LoaderCircle className="h-4 w-4 animate-spin text-ds-muted" /> : null}
        <IconButton label="配置服务器" onClick={() => setPanel(panel === 'server' ? null : 'server')}><KeyRound className="h-4 w-4" /></IconButton>
        <IconButton label="导入邀请" onClick={() => setPanel(panel === 'join' ? null : 'join')}><LogIn className="h-4 w-4" /></IconButton>
        {ready && meetingId && status.e2eeState === 'setup_required' ? <IconButton label="为会议启用端到端加密" onClick={() => void run(() => dispatchNetwork({ kind: 'network_meeting_enable', meetingId }))}><ShieldCheck className="h-4 w-4" /></IconButton> : null}
        {ready && meetingId && status.e2eeState === 'ready' ? <IconButton label="创建邀请" onClick={() => { setPanel('invite'); void createInvitation() }}><UserPlus className="h-4 w-4" /></IconButton> : null}
        {ready && meetingId && status.e2eeState === 'ready' ? <IconButton label="待加入成员" onClick={() => void loadJoinRequests()}><Users className="h-4 w-4" /></IconButton> : null}
        {ready && meetingId && status.e2eeState === 'ready' ? <IconButton label="同步会议" onClick={() => void run(() => dispatchNetwork({ kind: 'network_sync', meetingId }))}><RefreshCw className="h-4 w-4" /></IconButton> : null}
        {meetingId && status.e2eeState === 'pending_membership' && status.pendingInvitationId ? <IconButton label="刷新加入状态" onClick={() => void run(() => dispatchNetwork({ kind: 'network_join_refresh', meetingId, invitationId: status.pendingInvitationId! }))}><RefreshCw className="h-4 w-4" /></IconButton> : null}
      </div>
      {panel ? <div className="border-t border-ds-border-muted px-4 py-3">{panelContent()}</div> : null}
      {localError ? <div className="border-t border-red-500/30 bg-red-500/5 px-4 py-2 text-[11px] text-red-500">{localError}</div> : null}
    </div>
  )

  function panelContent(): React.ReactElement {
    if (panel === 'server') return <div className="grid grid-cols-[auto_minmax(180px,1fr)_minmax(140px,0.5fr)_minmax(180px,1fr)_auto] gap-2"><CommandButton label={localServerRunning ? '停止内置服务' : '启动内置服务'} onClick={() => void toggleLocalServer()} icon={<Cloud className="h-3.5 w-3.5" />} /><Field value={serverUrl} onChange={setServerUrl} placeholder="https://server:19443" /><Field value={displayName} onChange={setDisplayName} placeholder="显示名称" /><Field value={enrollmentToken} onChange={setEnrollmentToken} placeholder="操作员注册令牌" secret /><CommandButton label="注册并连接" onClick={() => void enroll()} icon={<Link className="h-3.5 w-3.5" />} /></div>
    if (panel === 'join') return <div className="grid grid-cols-[minmax(140px,0.35fr)_minmax(260px,1fr)_auto] gap-2"><Field value={displayName} onChange={setDisplayName} placeholder="显示名称" /><Field value={invitationText} onChange={setInvitationText} placeholder="邀请 JSON" /><CommandButton label="加入" onClick={() => void join()} icon={<LogIn className="h-3.5 w-3.5" />} /></div>
    if (panel === 'invite') return <div className="flex gap-2"><textarea readOnly value={createdInvitation} aria-label="一次性邀请" className="h-24 min-w-0 flex-1 resize-none rounded-md border border-ds-border-muted bg-ds-main px-2.5 py-2 font-mono text-[10px]" /><IconButton label="复制邀请" onClick={() => void navigator.clipboard.writeText(createdInvitation)}><Clipboard className="h-4 w-4" /></IconButton></div>
    return <div className="space-y-2">{joinRequests.map((request) => <div key={request.invitationId} className="flex items-center gap-3 border-b border-ds-border-muted pb-2"><UserCheck className="h-4 w-4 text-ds-muted" /><div className="min-w-0 flex-1"><div className="truncate text-[12px]">{request.displayName}</div><div className="truncate text-[10px] text-ds-muted">{request.deviceId} · {request.role}</div></div><IconButton label="批准加入" onClick={() => void run(async () => { await dispatchNetwork({ kind: 'network_join_approve', meetingId: request.meetingId, invitationId: request.invitationId }); setJoinRequests((items) => items.filter((item) => item.invitationId !== request.invitationId)) })}><Check className="h-4 w-4" /></IconButton></div>)}{joinRequests.length === 0 ? <div className="text-[11px] text-ds-muted">暂无待加入成员</div> : null}</div>
  }
}

function securityLabel(state: string, e2ee: string): string {
  if (state === 'SECURITY_SYNC_REQUIRED') return '安全同步已阻断'
  if (state === 'error') return '连接异常'
  if (e2ee === 'ready') return '端到端加密已就绪'
  if (e2ee === 'pending_membership') return '等待成员审批'
  return '未连接'
}

function IconButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) { return <button type="button" aria-label={label} title={label} onClick={onClick} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-ds-border-muted text-ds-muted hover:bg-ds-hover hover:text-ds-text">{children}</button> }
function Field({ value, onChange, placeholder, secret = false }: { value: string; onChange: (value: string) => void; placeholder: string; secret?: boolean }) { return <input type={secret ? 'password' : 'text'} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="h-8 min-w-0 rounded-md border border-ds-border-muted bg-ds-main px-2.5 text-[11px] outline-none focus:border-accent" /> }
function CommandButton({ label, onClick, icon }: { label: string; onClick: () => void; icon: React.ReactNode }) { return <button type="button" onClick={onClick} className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-[11px] text-white">{icon}{label}</button> }
