import { useEffect, useState } from 'react'
import { Bot, Plus, RefreshCw, UsersRound } from 'lucide-react'
import { WorkspaceModeTabs } from '../components/chat/WorkspaceModeTabs'
import { SidebarFrame, SidebarIconButton } from '../components/sidebar/SidebarPrimitives'
import { useCollaborationStore } from './collaboration-store'

export function CollaborationSidebar(props: { onCodeOpen: () => void; onWriteOpen: () => void; onDesignOpen: () => void; onCollaborationOpen: () => void }): React.ReactElement {
  const { snapshot, selection, loading, error, load, select, dispatch } = useCollaborationStore()
  const [meetingTitle, setMeetingTitle] = useState('')
  useEffect(() => { void load() }, [load])
  const createMeeting = async (): Promise<void> => {
    const title = meetingTitle.trim()
    if (!title) return
    const meeting = await dispatch({ kind: 'meeting_create', title, description: '' }) as { id: string }
    setMeetingTitle(''); select({ kind: 'meeting', id: meeting.id })
  }
  const publishEmployee = async (): Promise<void> => {
    const employee = await dispatch({
      kind: 'employee_publish', employeeId: `reception-${Date.now()}`, displayName: 'Kun 接待助手',
      description: '在本机权限范围内处理远程协作请求。', allowedToolNames: ['read', 'grep'],
      meetingIds: selection?.kind === 'meeting' ? [selection.id] : [], taskIds: []
    }) as { id: string }
    select({ kind: 'employee', id: employee.id })
  }
  return <SidebarFrame title="Kun"><div className="px-1"><WorkspaceModeTabs activeView="collaboration" onCodeOpen={props.onCodeOpen} onWriteOpen={props.onWriteOpen} onDesignOpen={props.onDesignOpen} onCollaborationOpen={props.onCollaborationOpen} /></div>
    {error ? <div className="mx-2 mt-2 rounded-md bg-red-500/10 px-2 py-1.5 text-[11px] text-red-400">{error}</div> : null}
    <div className="flex min-h-0 flex-1 flex-col gap-2 p-2">
      <section className="flex min-h-[180px] flex-1 flex-col overflow-hidden border-b border-ds-border-muted pb-2"><Header icon={<UsersRound className="h-3.5 w-3.5" />} title="会议" count={snapshot.meetings.length} action={<SidebarIconButton title="刷新会议" ariaLabel="刷新会议" onClick={() => void load()}><RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} /></SidebarIconButton>} /><div className="mb-2 flex gap-1"><input value={meetingTitle} onChange={(event) => setMeetingTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createMeeting() }} placeholder="会议名称" className="min-w-0 flex-1 rounded-md border border-ds-border-muted bg-transparent px-2 py-1 text-[12px]" /><button type="button" onClick={() => void createMeeting()} disabled={!meetingTitle.trim()} className="inline-flex h-7 w-7 items-center justify-center rounded-md bg-accent text-white disabled:opacity-40" aria-label="创建会议" title="创建会议"><Plus className="h-3.5 w-3.5" /></button></div><div className="min-h-0 flex-1 overflow-y-auto">{snapshot.meetings.map((meeting) => <Row key={meeting.id} active={selection?.kind === 'meeting' && selection.id === meeting.id} title={meeting.title} meta={`${meeting.tasks.length} 个任务 · ${meeting.status}`} onClick={() => select({ kind: 'meeting', id: meeting.id })} />)}{snapshot.meetings.length === 0 ? <Empty text="暂无会议" /> : null}</div></section>
      <section className="flex min-h-[160px] flex-1 flex-col overflow-hidden"><Header icon={<Bot className="h-3.5 w-3.5" />} title="接待数字员工" count={snapshot.employees.length} action={<SidebarIconButton title="发布接待数字员工" ariaLabel="发布接待数字员工" onClick={() => void publishEmployee()}><Plus className="h-3.5 w-3.5" /></SidebarIconButton>} /><div className="min-h-0 flex-1 overflow-y-auto">{snapshot.employees.map((employee) => <Row key={employee.id} active={selection?.kind === 'employee' && selection.id === employee.id} title={employee.displayName} meta={`${employee.status} · ${employee.allowedToolNames.join(', ') || '无工具'}`} onClick={() => select({ kind: 'employee', id: employee.id })} />)}{snapshot.employees.length === 0 ? <Empty text="暂无已发布员工" /> : null}</div></section>
    </div></SidebarFrame>
}
function Header(props: { icon: React.ReactNode; title: string; count: number; action: React.ReactNode }) { return <div className="mb-2 flex h-8 items-center gap-1.5 text-[12px] font-medium text-ds-muted">{props.icon}<h2 className="flex-1">{props.title}</h2><span className="text-ds-faint">{props.count}</span>{props.action}</div> }
function Row(props: { active: boolean; title: string; meta: string; onClick: () => void }) { return <button type="button" onClick={props.onClick} className={`mb-1 w-full rounded-md px-2 py-2 text-left ${props.active ? 'bg-ds-hover' : 'hover:bg-ds-hover/60'}`}><div className="truncate text-[12px] font-medium text-ds-ink">{props.title}</div><div className="truncate text-[10px] text-ds-muted">{props.meta}</div></button> }
function Empty({ text }: { text: string }) { return <div className="py-5 text-center text-[11px] text-ds-faint">{text}</div> }
